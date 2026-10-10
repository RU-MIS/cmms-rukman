// Read-only check of a REAL Apps Script deployment (run after deploying it):
//   node check-deployment.mjs https://script.google.com/macros/s/<id>/exec [https://<site>.netlify.app]
// It sends no credentials and changes nothing: health check, one invalid request,
// one protected request without a token, one login with a random (non-existent) user.
// Exit code 0 = everything as expected.

const [url, siteOrigin = 'https://example.netlify.app'] = process.argv.slice(2);
if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url || '')) {
  console.error('usage: node check-deployment.mjs https://script.google.com/macros/s/<deployment-id>/exec [site-origin]');
  process.exit(2);
}
let failures = 0;
const check = (ok, label, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`); if (!ok) failures++; };

/** Follows the redirect manually so every hop can be inspected (a browser does the same automatically). */
async function call(method, body) {
  const first = await fetch(url, { method, body, redirect: 'manual', headers: { Origin: siteOrigin, ...(body ? { 'Content-Type': 'text/plain;charset=utf-8' } : {}) } });
  const hops = [{ status: first.status, acao: first.headers.get('access-control-allow-origin'), location: first.headers.get('location') }];
  let res = first;
  for (let i = 0; i < 3 && res.status >= 300 && res.status < 400; i++) {
    res = await fetch(res.headers.get('location'), { redirect: 'manual', headers: { Origin: siteOrigin } });
    hops.push({ status: res.status, acao: res.headers.get('access-control-allow-origin'), location: res.headers.get('location') });
  }
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { hops, json, text };
}

const health = await call('GET');
const final = health.hops[health.hops.length - 1];
check(health.hops[0].status === 302, 'web app answers with a redirect (as Apps Script does)', `first status ${health.hops[0].status}`);
check(final.status === 200 && health.json?.ok === true, 'health check returns JSON', health.json ? JSON.stringify(health.json.data) : health.text.slice(0, 120));
check(!/accounts\.google\.com|ServiceLogin/.test(health.hops.map((h) => h.location || '').join(' ')),
  'no Google sign-in redirect (deployment access must be "Anyone")');
check(health.hops.every((h) => h.acao === '*'),
  'every hop allows cross-origin reads (Access-Control-Allow-Origin: *)', health.hops.map((h) => `${h.status}:${h.acao}`).join(' → '));
check(health.hops.slice(1).every((h) => !h.location || h.location.startsWith('https://')), 'redirect stays on HTTPS');

const bad = await call('POST', JSON.stringify({ action: 'noSuchAction' }));
check(bad.json?.ok === false && bad.json.error.code === 'BAD_REQUEST', 'unknown action is refused', JSON.stringify(bad.json?.error));

const anon = await call('POST', JSON.stringify({ action: 'listUsers' }));
check(anon.json?.ok === false && anon.json.error.code === 'UNAUTHENTICATED', 'protected action without a session is refused', JSON.stringify(anon.json?.error));

const forged = await call('POST', JSON.stringify({ action: 'listUsers', token: 'f'.repeat(64), role: 'Admin' }));
check(forged.json?.ok === false && forged.json.error.code === 'UNAUTHENTICATED', 'forged token and role are refused', JSON.stringify(forged.json?.error));

const login = await call('POST', JSON.stringify({ action: 'login', data: { username: `nobody-${Date.now()}`, password: 'not-a-real-password-1' } }));
check(login.json?.ok === false && login.json.error.code === 'INVALID_CREDENTIALS', 'login with an unknown user is refused generically', JSON.stringify(login.json?.error));

const pre = await fetch(url, { method: 'OPTIONS', headers: { Origin: siteOrigin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
console.log(`INFO  CORS preflight (OPTIONS) answer: HTTP ${pre.status}, Access-Control-Allow-Origin: ${pre.headers.get('access-control-allow-origin')} — the app never sends a preflight`);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
