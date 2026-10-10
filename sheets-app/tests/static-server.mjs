// Serves sheets-app/frontend like Netlify would: the files as they are, plus the
// headers from frontend/_headers (path rules "/*", "/js/*", "/*.html").
// For tests only, js/config.js is replaced so the app talks to the local mock, and
// the CSP connect-src gets the mock origins instead of Google's.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'frontend');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' };

function parseHeaders() {
  const rules = [];
  let current = null;
  for (const line of readFileSync(path.join(ROOT, '_headers'), 'utf8').split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) { current = { pattern: line.trim(), headers: {} }; rules.push(current); continue; }
    const i = line.indexOf(':');
    current.headers[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return rules;
}
const matches = (pattern, p) => new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$').test(p);

export async function startStatic({ port, apiUrl, apiOrigins }) {
  const rules = parseHeaders();
  const server = http.createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(ROOT, path.normalize(p));
    if (!file.startsWith(ROOT) || p.includes('_headers')) { res.writeHead(404); return res.end(); }
    let body;
    try {
      body = p === '/js/config.js'
        ? Buffer.from(`window.RDMS_CONFIG = Object.freeze({ apiUrl: ${JSON.stringify(apiUrl)}, requestTimeoutMs: 15000, allowTestUrl: true });\n`)
        : await readFile(file);
    } catch { res.writeHead(404); return res.end('not found'); }
    const headers = { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' };
    for (const r of rules) if (matches(r.pattern, p)) Object.assign(headers, r.headers);
    if (headers['Content-Security-Policy']) {
      headers['Content-Security-Policy'] = headers['Content-Security-Policy']
        .replace('https://script.google.com https://script.googleusercontent.com', apiOrigins.join(' '));
    }
    delete headers['Strict-Transport-Security'];            // plain http on localhost
    res.writeHead(200, headers);
    res.end(body);
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) };
}
