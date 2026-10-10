/**
 * Errors, validation, sheet-value safety and crypto helpers.
 */

// ---------------------------------------------------------------- errors

/** An error that is safe to show to the user (code + message). Everything else becomes a generic error. */
function appError_(code, message) {
  var e = new Error(message);
  e.appCode = code;
  return e;
}

// ---------------------------------------------------------------- validation

function requireObject_(v, name) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw appError_('VALIDATION', name + ' is required');
  return v;
}

/** Trimmed string with length limits and an optional pattern. */
function requireText_(v, name, opts) {
  opts = opts || {};
  if (typeof v !== 'string') throw appError_('VALIDATION', name + ' is required');
  var s = v.trim();
  var min = opts.min === undefined ? 1 : opts.min;
  var max = opts.max === undefined ? LIMITS.maxTextLength : opts.max;
  if (s.length < min) throw appError_('VALIDATION', min <= 1 ? name + ' is required' : name + ' must have at least ' + min + ' characters');
  if (s.length > max) throw appError_('VALIDATION', name + ' must have at most ' + max + ' characters');
  if (opts.pattern && !opts.pattern.test(s)) throw appError_('VALIDATION', name + ' ' + (opts.patternMessage || 'is not valid'));
  return s;
}

function optionalText_(v, name, opts) {
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) return '';
  return requireText_(v, name, opts);
}

function requireOneOf_(v, name, allowed) {
  if (allowed.indexOf(v) < 0) throw appError_('VALIDATION', name + ' must be one of: ' + allowed.join(', '));
  return v;
}

var USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,39}$/;
var EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normaliseUsername_(v) {
  return requireText_(typeof v === 'string' ? v.toLowerCase() : v, 'Username',
    { min: 3, max: 40, pattern: USERNAME_PATTERN, patternMessage: 'may contain a–z, 0–9, dot, dash and underscore, and must start with a letter or digit' });
}

/** Password policy. Passwords are never trimmed (spaces are significant). */
function validatePassword_(pw, username) {
  if (typeof pw !== 'string') throw appError_('VALIDATION', 'Password is required');
  var min = Math.max(8, Math.min(64, Number(getSetting_('passwordMinLength')) || 10));
  if (pw.length < min) throw appError_('VALIDATION', 'Password must have at least ' + min + ' characters');
  if (pw.length > 128) throw appError_('VALIDATION', 'Password must have at most 128 characters');
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) throw appError_('VALIDATION', 'Password must contain letters and digits');
  if (username && pw.toLowerCase().indexOf(username.toLowerCase()) >= 0) throw appError_('VALIDATION', 'Password must not contain the username');
  return pw;
}

// ---------------------------------------------------------------- sheet safety

/**
 * Text written to a cell must never become a formula: a value starting with
 * = + - @ (or a tab / carriage return) is stored with a leading apostrophe,
 * which Google Sheets treats as "plain text" and does not return on read.
 */
function cellValue_(v) {
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(v)) return "'" + v;
  return v;
}

function nowIso_() { return new Date().toISOString(); }

// ---------------------------------------------------------------- crypto

function utf8Bytes_(s) { return Utilities.newBlob(s).getBytes(); }

function bytesToHex_(bytes) {
  var out = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = bytes[i] & 0xff;
    out += (b < 16 ? '0' : '') + b.toString(16);
  }
  return out;
}

function sha256Hex_(s) {
  return bytesToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8));
}

function hmac_(valueBytes, keyBytes) { return Utilities.computeHmacSha256Signature(valueBytes, keyBytes); }

/** 32 random bytes (from two random UUIDs, hashed). */
function randomBytes_() {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Utilities.getUuid(), Utilities.Charset.UTF_8);
}

/** 64-hex-character random token (256-bit). */
function randomToken_() { return bytesToHex_(randomBytes_()); }

/** Readable temporary password (letters + digits, no look-alikes). */
function randomPassword_(length) {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  var out = '';
  while (out.length < length) {
    var bytes = randomBytes_();
    for (var i = 0; i < bytes.length && out.length < length; i++) {
      var b = bytes[i] & 0xff;
      if (b < 224) out += chars.charAt(b % chars.length);   // 224 = 4 × 56: no modulo bias
    }
  }
  // guarantee the password policy (letters and digits)
  return out.slice(0, length - 2) + 'k' + String((randomBytes_()[0] & 0xff) % 8 + 2);
}

/** PBKDF2-HMAC-SHA256, one 32-byte block (dkLen = hLen). */
function pbkdf2_(passwordBytes, saltBytes, iterations) {
  var u = hmac_(saltBytes.concat([0, 0, 0, 1]), passwordBytes);
  var t = u.slice();
  for (var i = 1; i < iterations; i++) {
    u = hmac_(u, passwordBytes);
    for (var j = 0; j < t.length; j++) t[j] = t[j] ^ u[j];
  }
  return t;
}

/** The pepper lives only in Script Properties (never in the Sheet, never in the browser). */
function pepperBytes_() {
  var p = PropertiesService.getScriptProperties().getProperty('PASSWORD_PEPPER');
  if (!p) throw new Error('PASSWORD_PEPPER is not set — run setupDatabase() first');
  return utf8Bytes_(p);
}

function hashPassword_(password) {
  var salt = randomBytes_().slice(0, 16);
  var iterations = LIMITS.pbkdf2Iterations;
  var key = hmac_(utf8Bytes_(password), pepperBytes_());
  var dk = pbkdf2_(key, salt, iterations);
  return 'pbkdf2_sha256$' + iterations + '$' + Utilities.base64Encode(salt) + '$' + Utilities.base64Encode(dk);
}

function verifyPassword_(password, stored) {
  var parts = String(stored || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2_sha256') return false;
  var iterations = Number(parts[1]);
  if (!(iterations >= 1000 && iterations <= 1000000)) return false;
  var key = hmac_(utf8Bytes_(password), pepperBytes_());
  var dk = pbkdf2_(key, Utilities.base64Decode(parts[2]), iterations);
  return constantTimeEqual_(Utilities.base64Encode(dk), parts[3]);
}

function constantTimeEqual_(a, b) {
  a = String(a); b = String(b);
  var diff = a.length ^ b.length;
  for (var i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a.charCodeAt(i % (a.length || 1)) || 0) ^ (b.charCodeAt(i % (b.length || 1)) || 0);
  }
  return diff === 0;
}
