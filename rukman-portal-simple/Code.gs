// =====================================================================
//  Rukman Portal (Google Apps Script): backend + page in one project
//  Login ID + password, sessions, and email OTP for forgot / first-time password.
//  Deploy as: Web app, Execute as ME, Who has access: ANYONE.
//  Files in this project: Code.gs (this file) and Index.html.
// =====================================================================

// ====== SETTINGS ======
const SHEET_ID       = '1C5VYni5bUTOPCVbTprnzU4jDJ3V7qf66rlgFF5zY7V8';
const ACCESS_SHEET   = 'Portal_Access';   // EMAIL | TITLE | TYPE | URL | DEPARTMENT
const USERS_SHEET    = 'Users';           // EMAIL | NAME | LOGIN ID | SALT (auto) | HASH (auto) | STATUS
const SESSIONS_SHEET = 'Sessions';        // created automatically
const PORTAL_TITLE   = 'Rukman Portal';
const DEFAULT_DEPARTMENT = 'General';

const SESSION_DAYS_REMEMBER = 30;         // "Remember me" ticked; renewed every time the app is opened
const SESSION_MAX_DAYS      = 90;         // absolute limit: after this the user must sign in again
const SESSION_HOURS_SHORT   = 12;         // not ticked (never renewed)
const OTP_MINUTES           = 10;         // how long an OTP stays valid
const OTP_MAX_SENDS_PER_HOUR = 3;         // OTP emails per user per hour
const OTP_MAX_TRIES         = 5;          // wrong OTP guesses before it is cancelled
const LOGIN_MAX_FAILS       = 5;          // wrong passwords before a temporary lock
const LOCK_MINUTES          = 15;
const HASH_ROUNDS           = 600;
const MIN_PASSWORD_LENGTH   = 8;
// ======================

/* ------------------------------ entry points ------------------------------ */

/** Serves the portal page. */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle(PORTAL_TITLE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/** The page calls this through google.script.run. */
function api(req) {
  try {
    req = req || {};
    switch (req.action) {
      case 'login':   return login_(req);
      case 'session': return session_(req);
      case 'logout':  return logout_(req);
      case 'forgot':  return forgot_(req);
      case 'reset':   return reset_(req);
      default:        return fail_('Unknown request.');
    }
  } catch (err) {
    console.error(err && err.stack || err);
    return fail_('Something went wrong. Please try again.');
  }
}

/** Run this ONCE from the editor (Run > setup) and approve the permissions. */
function setup() {
  const ss = ss_();
  let users = ss.getSheetByName(USERS_SHEET);
  if (!users) users = ss.insertSheet(USERS_SHEET);
  users.getRange('A1:F1').setValues([['EMAIL', 'NAME', 'LOGIN ID', 'SALT (auto)', 'HASH (auto)', 'STATUS']]);
  users.getRange('C:E').setNumberFormat('@');      // keep as plain text
  sessionsSheet_().getRange('E1').setValue('REMEMBER');
  pepper_();
  const quota = MailApp.getRemainingDailyQuota();  // also triggers the "send email" permission prompt
  Logger.log('Setup complete. Emails you can still send today: ' + quota);
}

/* -------------------------------- actions --------------------------------- */

function login_(req) {
  const id = String(req.id || '').toLowerCase().trim();
  const pw = String(req.password || '');
  if (!id || !pw) return fail_('Please enter your login ID and password.');

  const user  = findUser_(id);
  const cache = CacheService.getScriptCache();
  const key   = 'fail:' + (user ? user.email : id);

  if (Number(cache.get(key) || 0) >= LOGIN_MAX_FAILS) {
    return fail_('Too many failed attempts. Please try again in ' + LOCK_MINUTES +
                 ' minutes, or reset your password.', 'LOCKED');
  }

  // Always hash, even for unknown users, so response time does not reveal who exists.
  const candidate = hashPw_(pw, user && user.salt ? user.salt : 'none');
  const good = !!(user && !user.disabled && user.hash && safeEqual_(candidate, user.hash));

  if (!good) {
    cache.put(key, String(Number(cache.get(key) || 0) + 1), LOCK_MINUTES * 60);
    return fail_('Incorrect login ID or password.');
  }

  cache.remove(key);
  const s = createSession_(user.email, req.remember !== false);
  return Object.assign({ ok: true, token: s.token }, payload_(user));
}

function session_(req) {
  const email = validate_(req.token);
  const user  = email ? findUser_(email) : null;
  if (!user || user.disabled) return fail_('Your session has expired. Please sign in again.', 'SESSION_EXPIRED');
  renewSession_(req.token);
  return Object.assign({ ok: true }, payload_(user));
}

function logout_(req) {
  const token = String(req.token || '');
  if (token.length >= 32) {
    const h = sha256_(token);
    CacheService.getScriptCache().remove('s:' + h);
    withLock_(function () {
      const sh = sessionsSheet_();
      const rows = sh.getDataRange().getValues();
      for (let i = rows.length - 1; i >= 1; i--) if (rows[i][0] === h) sh.deleteRow(i + 1);
    });
  }
  return { ok: true };
}

/** Sends a one-time code. Always answers "ok" so nobody can probe which IDs exist. */
function forgot_(req) {
  const user = findUser_(req.id);
  if (user && !user.disabled) {
    const cache  = CacheService.getScriptCache();
    const cntKey = 'otpn:' + user.email;
    const sent   = Number(cache.get(cntKey) || 0);
    if (sent < OTP_MAX_SENDS_PER_HOUR) {
      const otp = newOtp_();
      cache.put(cntKey, String(sent + 1), 3600);
      cache.put('otp:' + user.email, JSON.stringify({ h: otpHash_(otp, user.email), t: 0 }), OTP_MINUTES * 60);
      sendOtpEmail_(user, otp);
    }
  }
  return { ok: true };
}

function reset_(req) {
  const user = findUser_(req.id);
  const otp  = String(req.otp || '').replace(/\s/g, '');
  const pw   = String(req.password || '');
  const bad  = fail_('That code is incorrect or has expired. Please request a new one.');
  if (!user || user.disabled || !/^\d{6}$/.test(otp)) return bad;

  const cache = CacheService.getScriptCache();
  const key   = 'otp:' + user.email;
  const raw   = cache.get(key);
  if (!raw) return bad;

  const entry = JSON.parse(raw);
  if (entry.t >= OTP_MAX_TRIES) { cache.remove(key); return bad; }
  if (!safeEqual_(otpHash_(otp, user.email), entry.h)) {
    entry.t += 1;
    cache.put(key, JSON.stringify(entry), OTP_MINUTES * 60);
    return bad;
  }

  const problem = passwordProblem_(pw);
  if (problem) return fail_(problem, 'WEAK_PASSWORD');       // the code stays valid so they can retry

  const salt = Utilities.getUuid();
  const hash = hashPw_(pw, salt);
  withLock_(function () {
    ss_().getSheetByName(USERS_SHEET).getRange(user.row, 4, 1, 2).setValues([[salt, hash]]);
  });
  cache.remove(key);
  cache.remove('fail:' + user.email);
  revokeSessions_(user.email);                               // sign out every device
  return { ok: true };
}

/* ------------------------------- data access ------------------------------ */

function ss_() { return SpreadsheetApp.openById(SHEET_ID); }

function findUser_(id) {
  id = String(id || '').toLowerCase().trim();
  if (!id) return null;
  const sh = ss_().getSheetByName(USERS_SHEET);
  if (!sh) return null;
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const email = String(r[0]).toLowerCase().trim();
    const login = String(r[2] || '').toLowerCase().trim();
    if (email && (email === id || (login && login === id))) {
      return {
        row: i + 1,
        email: email,
        name: String(r[1] || '').trim(),
        salt: String(r[3] || ''),
        hash: String(r[4] || ''),
        disabled: String(r[5] || '').toLowerCase().trim() === 'disabled'
      };
    }
  }
  return null;
}

function payload_(user) {
  return { user: { name: user.name, email: user.email }, items: itemsFor_(user.email) };
}

function itemsFor_(email) {
  const rows = ss_().getSheetByName(ACCESS_SHEET).getDataRange().getValues().slice(1);
  return rows
    .filter(function (r) { return String(r[0]).toLowerCase().trim() === email && r[3]; })
    .map(function (r) {
      return {
        title: String(r[1]),
        type:  String(r[2]).toLowerCase().trim(),
        url:   String(r[3]).trim(),
        dept:  String(r[4] || '').trim() || DEFAULT_DEPARTMENT
      };
    });
}

/* -------------------------------- sessions -------------------------------- */

function sessionsSheet_() {
  const ss = ss_();
  let sh = ss.getSheetByName(SESSIONS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(SESSIONS_SHEET);
    sh.getRange('A1:E1').setValues([['TOKEN HASH', 'EMAIL', 'EXPIRES (ms)', 'CREATED', 'REMEMBER']]);
    sh.getRange('C:C').setNumberFormat('0');
  }
  return sh;
}

function createSession_(email, remember) {
  const token  = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  const ms     = remember ? SESSION_DAYS_REMEMBER * 864e5 : SESSION_HOURS_SHORT * 36e5;
  const expiry = Date.now() + ms;
  withLock_(function () {
    const sh = sessionsSheet_();
    const rows = sh.getDataRange().getValues();
    for (let i = rows.length - 1; i >= 1; i--) if (Number(rows[i][2]) < Date.now()) sh.deleteRow(i + 1);   // tidy up
    sh.appendRow([sha256_(token), email, expiry, new Date(), remember ? 'yes' : 'no']);
  });
  return { token: token, expiry: expiry };
}

/** "Remember me" sessions slide forward each time the app is opened (at most one write a day), up to SESSION_MAX_DAYS. */
function renewSession_(token) {
  const h = sha256_(String(token || '')), DAY = 864e5, now = Date.now();
  const next = function (row) {
    if (String(row[4]) !== 'yes') return 0;                                   // short sessions are never renewed
    const cap = new Date(row[3]).getTime() + SESSION_MAX_DAYS * DAY;
    const target = Math.min(now + SESSION_DAYS_REMEMBER * DAY, cap);
    return target - Number(row[2]) > DAY ? target : 0;                        // only when it gains a full day
  };

  const rows = sessionsSheet_().getDataRange().getValues();                   // cheap check first, no lock
  let need = false;
  for (let i = 1; i < rows.length; i++) if (rows[i][0] === h) { need = next(rows[i]) > 0; break; }
  if (!need) return;

  withLock_(function () {
    const sh = sessionsSheet_();
    const fresh = sh.getDataRange().getValues();                              // re-read inside the lock
    for (let i = 1; i < fresh.length; i++) {
      if (fresh[i][0] === h) {
        const t = next(fresh[i]);
        if (t) { sh.getRange(i + 1, 3).setValue(t); CacheService.getScriptCache().remove('s:' + h); }
        return;
      }
    }
  });
}

function validate_(token) {
  token = String(token || '');
  if (token.length < 32) return null;
  const h = sha256_(token);
  const cache = CacheService.getScriptCache();

  const hit = cache.get('s:' + h);
  if (hit) {
    const p = hit.split('|');
    if (Number(p[1]) > Date.now()) return p[0];
  }
  const rows = sessionsSheet_().getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === h) {
      if (Number(rows[i][2]) < Date.now()) return null;
      cache.put('s:' + h, rows[i][1] + '|' + rows[i][2], 120);
      return String(rows[i][1]);
    }
  }
  return null;
}

function revokeSessions_(email) {
  withLock_(function () {
    const sh = sessionsSheet_();
    const rows = sh.getDataRange().getValues();
    for (let i = rows.length - 1; i >= 1; i--) {
      if (String(rows[i][1]).toLowerCase() === email) sh.deleteRow(i + 1);
    }
  });
}

/* ------------------------------- crypto + mail ---------------------------- */

function pepper_() {
  const props = PropertiesService.getScriptProperties();
  let v = props.getProperty('PEPPER');
  if (!v) { v = Utilities.getUuid() + Utilities.getUuid(); props.setProperty('PEPPER', v); }
  return v;
}

function sha256_(s) {
  return Utilities.base64Encode(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8));
}

/** Salted + peppered, iterated SHA-256. */
function hashPw_(pw, salt) {
  let h = salt + ':' + pepper_() + ':' + pw;
  for (let i = 0; i < HASH_ROUNDS; i++) h = sha256_(salt + h);
  return h;
}

function otpHash_(otp, email) { return sha256_(pepper_() + ':otp:' + email + ':' + otp); }

function newOtp_() {
  const n = parseInt(Utilities.getUuid().replace(/-/g, '').slice(0, 10), 16) % 1000000;
  return ('000000' + n).slice(-6);
}

function safeEqual_(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function passwordProblem_(pw) {
  if (pw.length < MIN_PASSWORD_LENGTH) return 'Password must be at least ' + MIN_PASSWORD_LENGTH + ' characters long.';
  if (pw.length > 128) return 'Password is too long.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Password must contain at least one letter and one number.';
  return '';
}

function sendOtpEmail_(user, otp) {
  const first = (user.name || 'there').split(' ')[0];
  const html =
    '<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px;border:1px solid #e5e7eb;border-radius:12px">' +
    '<h2 style="margin:0 0 8px;color:#1e3a8a">' + PORTAL_TITLE + '</h2>' +
    '<p>Hello ' + first + ',</p>' +
    '<p>Use this code to set or reset your password:</p>' +
    '<p style="font-size:34px;font-weight:700;letter-spacing:8px;margin:16px 0;color:#4338ca">' + otp + '</p>' +
    '<p style="color:#6b7280;font-size:13px">The code expires in ' + OTP_MINUTES + ' minutes. ' +
    'If you did not request it, you can ignore this email; your password has not been changed.</p></div>';
  try {
    MailApp.sendEmail({
      to: user.email,
      subject: PORTAL_TITLE + ' verification code: ' + otp,
      htmlBody: html,
      body: 'Your ' + PORTAL_TITLE + ' verification code is ' + otp + '. It expires in ' + OTP_MINUTES + ' minutes.',
      name: PORTAL_TITLE
    });
  } catch (err) {
    console.error('OTP email failed: ' + err);
  }
}

/* --------------------------------- helpers -------------------------------- */

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function fail_(msg, code) { return { ok: false, error: msg, code: code || 'ERROR' }; }

