// Backend tests: the real apps-script/*.gs files, executed in the simulator.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pbkdf2Sync, createHmac } from 'node:crypto';
import { createGas } from './gas-sim.mjs';

/** Fresh database with one Admin (temporary password already changed). */
function setup() {
  const gas = createGas();
  gas.g.setupDatabase();
  const temp = gas.g.createAdminUser_('owner', 'Owner Name');
  const login = gas.post({ action: 'login', data: { username: 'owner', password: temp } });
  assert.equal(login.ok, true, JSON.stringify(login));
  const changed = gas.post({ action: 'changePassword', token: login.data.token, data: { currentPassword: temp, newPassword: 'Strong-pass-2026' } });
  assert.equal(changed.ok, true, JSON.stringify(changed));
  return { gas, adminToken: login.data.token };
}
function loginAs(gas, username, password) {
  const r = gas.post({ action: 'login', data: { username, password } });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.data.token;
}
/** Admin creates a user; the user signs in and replaces the temporary password. */
function addUser(gas, adminToken, username, role, password = `${role}-pass-2026x`) {
  const c = gas.post({ action: 'createUser', token: adminToken, data: { username, displayName: `${role} user`, role } });
  assert.equal(c.ok, true, JSON.stringify(c));
  const token = loginAs(gas, username, c.data.temporaryPassword);
  assert.equal(gas.post({ action: 'changePassword', token, data: { currentPassword: c.data.temporaryPassword, newPassword: password } }).ok, true);
  return { token, password, userId: c.data.user.userId };
}
const rows = (gas, name) => gas.g.readAll_(name);
const err = (r) => (r.ok ? 'OK' : r.error.code);

test('setup creates private tabs, plain-text columns, pepper and settings; running it again changes nothing', () => {
  const gas = createGas();
  gas.g.setupDatabase();
  assert.deepEqual([...gas.sheets.keys()].sort(), ['AuditLog', 'Sessions', 'Settings', 'Users']);
  assert.match(gas.properties.get('PASSWORD_PEPPER'), /^[0-9a-f]{128}$/);
  const settings = rows(gas, 'Settings').length;
  assert.equal(settings, 6);
  const pepper = gas.properties.get('PASSWORD_PEPPER');
  gas.g.setupDatabase();
  assert.equal(rows(gas, 'Settings').length, settings, 'no duplicate settings');
  assert.equal(gas.properties.get('PASSWORD_PEPPER'), pepper, 'pepper is never replaced (it would invalidate all passwords)');
  assert.equal(gas.sheets.get('Users').formats.get('500:1'), '@', 'data cells are plain text');
});

test('PBKDF2 implementation matches Node crypto (RFC 8018)', () => {
  const gas = createGas();
  const pw = gas.g.utf8Bytes_('correct horse battery staple');
  const salt = gas.g.utf8Bytes_('saltsaltsaltsalt');
  const ours = Buffer.from(gas.g.pbkdf2_(pw, salt, 1000).map((b) => b & 0xff)).toString('hex');
  const ref = pbkdf2Sync('correct horse battery staple', 'saltsaltsaltsalt', 1000, 32, 'sha256').toString('hex');
  assert.equal(ours, ref);
});

test('passwords are stored only as peppered PBKDF2 hashes; the Admin starts with a temporary password', () => {
  const gas = createGas();
  gas.g.setupDatabase();
  const temp = gas.g.createAdminUser_('owner', 'Owner');
  assert.match(temp, /^[A-Za-z0-9]{14}$/);
  const u = rows(gas, 'Users')[0];
  assert.match(u.passwordHash, /^pbkdf2_sha256\$5000\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  assert.ok(!JSON.stringify([...gas.sheets.get('Users').cells.values()]).includes(temp), 'plain password nowhere in the sheet');
  assert.equal(u.mustChangePassword, 'TRUE');
  assert.equal(u.role, 'Admin');
  // the pepper matters: the same hash does not verify with another pepper
  assert.equal(gas.g.verifyPassword_(temp, u.passwordHash), true);
  gas.properties.set('PASSWORD_PEPPER', 'other');
  assert.equal(gas.g.verifyPassword_(temp, u.passwordHash), false);
});

test('login: wrong password and unknown user give the same answer; failures are audited without the password', () => {
  const { gas } = setup();
  const wrong = gas.post({ action: 'login', data: { username: 'owner', password: 'not-it-123' } });
  const unknown = gas.post({ action: 'login', data: { username: 'nobody', password: 'not-it-123' } });
  assert.deepEqual(wrong.error, unknown.error);
  assert.equal(wrong.error.code, 'INVALID_CREDENTIALS');
  const audit = JSON.stringify(rows(gas, 'AuditLog'));
  assert.ok(audit.includes('LOGIN_FAILED'));
  assert.ok(!audit.includes('not-it-123'), 'attempted password never written');
});

test('temporary password: every action except me / changePassword / logout is refused until it is changed', () => {
  const gas = createGas();
  gas.g.setupDatabase();
  const temp = gas.g.createAdminUser_('owner', 'Owner');
  const login = gas.post({ action: 'login', data: { username: 'owner', password: temp } });
  assert.equal(login.data.mustChangePassword, true);
  const t = login.data.token;
  assert.equal(err(gas.post({ action: 'dashboard', token: t })), 'PASSWORD_CHANGE_REQUIRED');
  assert.equal(err(gas.post({ action: 'listUsers', token: t })), 'PASSWORD_CHANGE_REQUIRED');
  assert.equal(err(gas.post({ action: 'me', token: t })), 'OK');
  assert.equal(err(gas.post({ action: 'changePassword', token: t, data: { currentPassword: temp, newPassword: 'short1' } })), 'VALIDATION');
  assert.equal(err(gas.post({ action: 'changePassword', token: t, data: { currentPassword: temp, newPassword: 'owner-1234567' } })), 'VALIDATION', 'contains username');
  assert.equal(err(gas.post({ action: 'changePassword', token: t, data: { currentPassword: 'wrong', newPassword: 'Good-pass-2026' } })), 'VALIDATION');
  assert.equal(err(gas.post({ action: 'changePassword', token: t, data: { currentPassword: temp, newPassword: 'Good-pass-2026' } })), 'OK');
  assert.equal(err(gas.post({ action: 'dashboard', token: t })), 'OK');
});

test('roles are enforced on the server; a role sent by the browser is ignored', () => {
  const { gas, adminToken } = setup();
  const mgr = addUser(gas, adminToken, 'manager1', 'Manager');
  const staff = addUser(gas, adminToken, 'staff1', 'Staff');
  // Staff
  assert.equal(err(gas.post({ action: 'dashboard', token: staff.token })), 'OK');
  assert.equal(err(gas.post({ action: 'listUsers', token: staff.token })), 'FORBIDDEN');
  assert.equal(err(gas.post({ action: 'listAudit', token: staff.token })), 'FORBIDDEN');
  assert.equal(err(gas.post({ action: 'listUsers', token: staff.token, role: 'Admin', data: { role: 'Admin' }, user: { role: 'Admin' } })), 'FORBIDDEN',
    'forged role fields have no effect');
  assert.equal(err(gas.post({ action: 'createUser', token: staff.token, data: { username: 'x1x', displayName: 'X', role: 'Admin' } })), 'FORBIDDEN');
  const staffDash = gas.post({ action: 'dashboard', token: staff.token }).data;
  assert.equal(staffDash.users, undefined, 'staff dashboard has no user statistics');
  assert.equal(staffDash.recentActivity, undefined);
  // Manager: may view users and audit, may not change anything
  assert.equal(err(gas.post({ action: 'listUsers', token: mgr.token })), 'OK');
  assert.equal(err(gas.post({ action: 'listAudit', token: mgr.token })), 'OK');
  assert.equal(err(gas.post({ action: 'createUser', token: mgr.token, data: { username: 'x2x', displayName: 'X', role: 'Staff' } })), 'FORBIDDEN');
  assert.equal(err(gas.post({ action: 'updateUser', token: mgr.token, data: { userId: staff.userId, role: 'Admin' } })), 'FORBIDDEN');
  assert.ok(rows(gas, 'AuditLog').some((a) => a.action === 'ACCESS_DENIED' && a.username === 'staff1'), 'denials are audited');
  // a staff member promoted by the Admin gets the new rights on the next request (role read from the sheet)
  assert.equal(err(gas.post({ action: 'updateUser', token: adminToken, data: { userId: staff.userId, role: 'Manager' } })), 'OK');
  assert.equal(err(gas.post({ action: 'listUsers', token: staff.token })), 'OK');
});

test('sessions: forged, malformed, logged-out, idle and expired tokens are refused', () => {
  const { gas, adminToken } = setup();
  const staff = addUser(gas, adminToken, 'staff2', 'Staff');
  assert.equal(err(gas.post({ action: 'me' })), 'UNAUTHENTICATED');
  assert.equal(err(gas.post({ action: 'me', token: 'abc' })), 'UNAUTHENTICATED');
  assert.equal(err(gas.post({ action: 'me', token: 'f'.repeat(64) })), 'UNAUTHENTICATED');
  // logout
  assert.equal(err(gas.post({ action: 'logout', token: staff.token })), 'OK');
  assert.equal(err(gas.post({ action: 'me', token: staff.token })), 'SESSION_EXPIRED');
  // idle timeout: last activity 31 minutes ago
  const t2 = loginAs(gas, 'staff2', staff.password);
  const s = gas.g.findBy_('Sessions', 'tokenHash', gas.g.sha256Hex_(t2));
  gas.g.updateRecord_('Sessions', s._row, 'sessionId', s.sessionId, { lastSeenAt: new Date(Date.now() - 31 * 60000).toISOString() });
  gas.cache.clear();
  assert.equal(err(gas.post({ action: 'me', token: t2 })), 'SESSION_EXPIRED');
  // absolute expiry
  const t3 = loginAs(gas, 'staff2', staff.password);
  const s3 = gas.g.findBy_('Sessions', 'tokenHash', gas.g.sha256Hex_(t3));
  gas.g.updateRecord_('Sessions', s3._row, 'sessionId', s3.sessionId, { expiresAt: new Date(Date.now() - 1000).toISOString() });
  gas.cache.clear();
  assert.equal(err(gas.post({ action: 'me', token: t3 })), 'SESSION_EXPIRED');
  // the token itself is never stored, only its hash
  const sessions = JSON.stringify(rows(gas, 'Sessions'));
  assert.ok(!sessions.includes(t3) && sessions.includes(gas.g.sha256Hex_(t3)));
});

test('brute force: the account locks after 5 failures (even the right password is refused) until an Admin unlocks it', () => {
  const { gas, adminToken } = setup();
  const staff = addUser(gas, adminToken, 'staff3', 'Staff');
  for (let i = 0; i < 4; i++) assert.equal(err(gas.post({ action: 'login', data: { username: 'staff3', password: `bad-${i}-pass` } })), 'INVALID_CREDENTIALS');
  assert.equal(err(gas.post({ action: 'login', data: { username: 'staff3', password: 'bad-5-pass' } })), 'INVALID_CREDENTIALS');
  assert.equal(err(gas.post({ action: 'login', data: { username: 'staff3', password: staff.password } })), 'ACCOUNT_LOCKED');
  assert.ok(rows(gas, 'AuditLog').some((a) => a.action === 'ACCOUNT_LOCKED'));
  const listed = gas.post({ action: 'listUsers', token: adminToken }).data.users.find((u) => u.username === 'staff3');
  assert.equal(listed.locked, true);
  assert.equal(err(gas.post({ action: 'unlockUser', token: adminToken, data: { userId: staff.userId } })), 'OK');
  assert.equal(err(gas.post({ action: 'login', data: { username: 'staff3', password: staff.password } })), 'OK');
});

test('global brake: too many failed logins across accounts pause all logins', () => {
  const { gas } = setup();
  gas.cache.set('loginfail:global', { v: '200', until: Date.now() + 60000 });
  assert.equal(err(gas.post({ action: 'login', data: { username: 'owner', password: 'Strong-pass-2026' } })), 'RATE_LIMITED');
});

test('user administration: disable signs the user out at once; self-change and removing the last Admin are refused', () => {
  const { gas, adminToken } = setup();
  const staff = addUser(gas, adminToken, 'staff4', 'Staff');
  assert.equal(err(gas.post({ action: 'updateUser', token: adminToken, data: { userId: staff.userId, status: 'DISABLED' } })), 'OK');
  assert.equal(err(gas.post({ action: 'me', token: staff.token })), 'SESSION_EXPIRED');
  assert.equal(err(gas.post({ action: 'login', data: { username: 'staff4', password: staff.password } })), 'INVALID_CREDENTIALS');
  const me = gas.post({ action: 'me', token: adminToken }).data.user;
  assert.equal(err(gas.post({ action: 'updateUser', token: adminToken, data: { userId: me.userId, role: 'Staff' } })), 'FORBIDDEN');
  assert.equal(err(gas.post({ action: 'updateUser', token: adminToken, data: { userId: me.userId, status: 'DISABLED' } })), 'FORBIDDEN');
  // a second Admin cannot demote the only other Admin if that would leave none
  const admin2 = addUser(gas, adminToken, 'admin2', 'Admin');
  assert.equal(err(gas.post({ action: 'updateUser', token: admin2.token, data: { userId: me.userId, role: 'Manager' } })), 'OK');
  assert.equal(err(gas.post({ action: 'updateUser', token: admin2.token, data: { userId: admin2.userId, role: 'Staff' } })), 'FORBIDDEN');
  assert.equal(err(gas.post({ action: 'createUser', token: admin2.token, data: { username: 'staff4', displayName: 'Dup', role: 'Staff' } })), 'DUPLICATE');
});

test('password reset by an Admin: one-time temporary password, old sessions ended, change required', () => {
  const { gas, adminToken } = setup();
  const staff = addUser(gas, adminToken, 'staff5', 'Staff');
  const r = gas.post({ action: 'resetPassword', token: adminToken, data: { userId: staff.userId } });
  assert.equal(r.ok, true);
  assert.equal(err(gas.post({ action: 'me', token: staff.token })), 'SESSION_EXPIRED');
  assert.equal(err(gas.post({ action: 'login', data: { username: 'staff5', password: staff.password } })), 'INVALID_CREDENTIALS');
  const t = loginAs(gas, 'staff5', r.data.temporaryPassword);
  assert.equal(err(gas.post({ action: 'dashboard', token: t })), 'PASSWORD_CHANGE_REQUIRED');
  const me = gas.post({ action: 'me', token: adminToken }).data.user;
  assert.equal(err(gas.post({ action: 'resetPassword', token: adminToken, data: { userId: me.userId } })), 'FORBIDDEN', 'not for own account');
});

test('changing the own password signs out other devices but keeps the current one', () => {
  const { gas, adminToken } = setup();
  const staff = addUser(gas, adminToken, 'staff6', 'Staff');
  const other = loginAs(gas, 'staff6', staff.password);
  assert.equal(err(gas.post({ action: 'changePassword', token: staff.token, data: { currentPassword: staff.password, newPassword: 'Newer-pass-2026' } })), 'OK');
  assert.equal(err(gas.post({ action: 'me', token: staff.token })), 'OK');
  assert.equal(err(gas.post({ action: 'me', token: other })), 'SESSION_EXPIRED');
});

test('input validation and error format', () => {
  const { gas, adminToken } = setup();
  assert.equal(err(gas.post('')), 'BAD_REQUEST');
  assert.equal(err(gas.post('{not json')), 'BAD_REQUEST');
  assert.equal(err(gas.post('[]')), 'VALIDATION');
  assert.equal(err(gas.post({ action: 'deleteEverything', token: adminToken })), 'BAD_REQUEST');
  assert.equal(err(gas.post({ action: 'setupDatabase', token: adminToken })), 'BAD_REQUEST', 'setup is not reachable from the web');
  assert.equal(err(gas.post({ action: 'createAdminUser_', token: adminToken })), 'BAD_REQUEST');
  assert.equal(err(gas.post({ action: '__proto__', token: adminToken })), 'BAD_REQUEST');
  assert.equal(err(gas.post('x'.repeat(70 * 1024))), 'BAD_REQUEST');
  assert.equal(err(gas.post({ action: 'login', data: {} })), 'VALIDATION');
  const bad = [
    { username: 'A', displayName: 'X', role: 'Staff' },
    { username: 'good.name', displayName: '', role: 'Staff' },
    { username: 'good.name', displayName: 'X', role: 'Owner' },
    { username: 'good.name', displayName: 'X', role: 'Staff', email: 'not-an-email' },
    { username: '../etc', displayName: 'X', role: 'Staff' }
  ];
  for (const data of bad) assert.equal(err(gas.post({ action: 'createUser', token: adminToken, data })), 'VALIDATION', JSON.stringify(data));
  const r = gas.post({ action: 'listUsers', token: adminToken });
  assert.deepEqual(Object.keys(r).sort(), ['data', 'ok']);
});

test('formula injection: values starting with = + - @ are stored as text, never as formulas', () => {
  const { gas, adminToken } = setup();
  const evil = '=IMPORTXML("http://example.com","//a")';
  const c = gas.post({ action: 'createUser', token: adminToken, data: { username: 'formula1', displayName: evil, role: 'Staff' } });
  assert.equal(c.ok, true);
  const listed = gas.post({ action: 'listUsers', token: adminToken }).data.users.find((u) => u.username === 'formula1');
  assert.equal(listed.displayName, evil);
  assert.ok(![...gas.sheets.get('Users').cells.values()].some((v) => String(v).startsWith('#FORMULA')), 'no cell became a formula');
});

test('values that look like numbers stay text, also in rows added beyond the pre-formatted range', () => {
  const { gas } = setup();
  const sh = gas.sheets.get('AuditLog');
  sh.formats.clear();                                   // pretend the column formats were lost
  sh.maxRows = sh.getLastRow();                         // the next row must be inserted
  const hexLikeNumber = '1234567890' + 'e5';            // a token hash made of digits and one "e" parses as a number
  gas.g.writeAudit_(null, 'TEST', hexLikeNumber, 'OK', {});
  const last = gas.g.readLast_('AuditLog', 1)[0];
  assert.equal(last.target, hexLikeNumber);
  assert.equal(sh.convert(hexLikeNumber, undefined), 123456789000000, 'sanity: the simulator does convert unformatted cells');
});

test('no secrets in API responses or the audit log', () => {
  const { gas, adminToken } = setup();
  const staff = addUser(gas, adminToken, 'staff7', 'Staff');
  const answers = JSON.stringify([gas.post({ action: 'listUsers', token: adminToken }), gas.post({ action: 'me', token: staff.token }),
    gas.post({ action: 'dashboard', token: adminToken }), gas.post({ action: 'listAudit', token: adminToken, data: { limit: 100 } })]);
  for (const s of ['passwordHash', 'pbkdf2_sha256', 'tokenHash', 'PASSWORD_PEPPER', staff.token, staff.password, gas.properties.get('PASSWORD_PEPPER')]) {
    assert.ok(!answers.includes(s), `response leaks ${s.slice(0, 12)}`);
  }
  const audit = JSON.stringify(rows(gas, 'AuditLog'));
  for (const s of [staff.token, staff.password, 'pbkdf2_sha256']) assert.ok(!audit.includes(s));
});

test('unexpected server errors return a generic message (details only in the server log)', () => {
  const { gas, adminToken } = setup();
  gas.sheets.delete('AuditLog');
  const r = gas.post({ action: 'listAudit', token: adminToken });
  assert.equal(r.error.code, 'SERVER_ERROR');
  assert.ok(!/AuditLog|stack|at /.test(r.error.message));
  assert.ok(gas.logs.some(([level, msg]) => level === 'error' && msg.includes('AuditLog')));
  assert.equal(gas.isLockHeld(), false, 'lock released after an error');
});

test('doGet answers a health check without data; doPost returns JSON', () => {
  const gas = createGas();
  const health = JSON.parse(gas.g.doGet({}).getContent());
  assert.deepEqual(Object.keys(health.data).sort(), ['service', 'status', 'time']);
  const out = gas.g.doPost({ postData: { contents: '{}' } });
  assert.equal(out.mime, 'application/json');
});

test('HMAC uses the pepper as key (sanity check of the simulator against Node)', () => {
  const gas = createGas();
  const sig = gas.g.hmac_(gas.g.utf8Bytes_('value'), gas.g.utf8Bytes_('key')).map((b) => b & 0xff);
  assert.equal(Buffer.from(sig).toString('hex'), createHmac('sha256', 'key').update('value').digest('hex'));
});
