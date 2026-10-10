// Local stand-in for the deployed Apps Script web app, for browser tests.
// It reproduces the browser-visible behaviour of a web app deployed with
// "Execute as: Me" and "Who has access: Anyone":
//   1. POST/GET  https://script.google.com/macros/s/<id>/exec
//        → 302 Found, Location: https://script.googleusercontent.com/macros/echo?user_content_key=…
//          (Access-Control-Allow-Origin: *)
//   2. GET the echo URL on a DIFFERENT origin → 200 + JSON (Access-Control-Allow-Origin: *)
//   3. OPTIONS (CORS preflight) is NOT supported → 405 without CORS headers,
//      so a client that sends custom headers or JSON content types fails, as with Google.
// The two origins are two local ports. The backend is the real .gs code in the simulator.
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { createGas } from './gas-sim.mjs';

export async function startMockGas({ execPort, echoPort }) {
  const gas = createGas();
  gas.g.setupDatabase();
  const outputs = new Map();
  const stats = { posts: 0, gets: 0, options: 0, echo: 0, contentTypes: [] };
  const echoOrigin = `http://127.0.0.1:${echoPort}`;

  const exec = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') { stats.options++; res.writeHead(405); return res.end(); }
    if (!req.url.startsWith('/macros/s/TESTDEPLOYMENT/exec')) { res.writeHead(404); return res.end(); }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let out;
      if (req.method === 'POST') {
        stats.posts++;
        stats.contentTypes.push(req.headers['content-type'] || '');
        out = gas.g.doPost({ postData: { contents: body, type: req.headers['content-type'] } }).getContent();
      } else {
        stats.gets++;
        out = gas.g.doGet({}).getContent();
      }
      const key = randomUUID();
      outputs.set(key, out);
      res.writeHead(302, { Location: `${echoOrigin}/macros/echo?user_content_key=${key}`, 'Access-Control-Allow-Origin': '*' });
      res.end();
    });
  });
  const echo = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') { stats.options++; res.writeHead(405); return res.end(); }
    const key = new URL(req.url, echoOrigin).searchParams.get('user_content_key');
    const out = outputs.get(key);
    outputs.delete(key);                                    // one-time, like Google's echo URLs
    stats.echo++;
    if (req.method !== 'GET' || !out) { res.writeHead(404, { 'Access-Control-Allow-Origin': '*' }); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end(out);
  });
  await new Promise((r) => exec.listen(execPort, '127.0.0.1', r));
  await new Promise((r) => echo.listen(echoPort, '127.0.0.1', r));
  return {
    gas, stats,
    apiUrl: `http://127.0.0.1:${execPort}/macros/s/TESTDEPLOYMENT/exec`,
    origins: [`http://127.0.0.1:${execPort}`, echoOrigin],
    close: () => Promise.all([new Promise((r) => exec.close(r)), new Promise((r) => echo.close(r))])
  };
}
