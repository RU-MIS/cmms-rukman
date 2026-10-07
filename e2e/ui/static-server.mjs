// Minimal static server for the exported web app (next build → web/out), with
// trailing-slash routes like a static host (Cloudflare Pages / nginx).
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? '../web/out');
const port = Number(process.argv[3] ?? 4173);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain', '.woff2': 'font/woff2' };

async function file(p) {
  try { const s = await stat(p); return s.isDirectory() ? file(join(p, 'index.html')) : p; } catch { return null; }
}

createServer(async (req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
  const target = normalize(join(root, url));
  if (!target.startsWith(root)) { res.writeHead(403).end(); return; }
  const found = (await file(target)) ?? (await file(`${target}.html`));
  if (!found) {
    const nf = await file(join(root, '404.html'));
    res.writeHead(404, { 'content-type': types['.html'] }).end(nf ? await readFile(nf) : 'Not found');
    return;
  }
  res.writeHead(200, { 'content-type': types[extname(found)] ?? 'application/octet-stream' }).end(await readFile(found));
}).listen(port, '127.0.0.1', () => console.log(`static server on http://127.0.0.1:${port} (${root})`));
