/**
 * Authentication and sessions.
 *
 * - Passwords: PBKDF2-HMAC-SHA256 over a peppered pre-hash (pepper in Script
 *   Properties). Only the hash is stored in the Users sheet.
 * - Sessions: a random 256-bit token is returned to the browser once; the server
 *   stores only its SHA-256 hash (Sessions sheet + short cache). Every request
 *   re-validates the session and re-reads the user's role and status on the server.
 * - Brute force: per-account lockout after N failures, plus a global brake.
 */

var DUMMY_HASH_ = 'pbkdf2_sha256$5000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
var TOKEN_PATTERN_ = /^[0-9a-f]{64}$/;

function publicUser_(u) {
  return { userId: u.userId, username: u.username, displayName: u.displayName, email: u.email, role: u.role,
           status: u.status, mustChangePassword: u.mustChangePassword === 'TRUE', lastLoginAt: u.lastLoginAt,
           locked: !!u.lockedUntil && u.lockedUntil > nowIso_(), createdAt: u.createdAt };
}

function permissionsOf_(role) { return (ROLE_PERMISSIONS[role] || []).slice(); }

function clearUserCache_(userId) { CacheService.getScriptCache().remove('user:' + userId); }

function getUserById_(userId) {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('user:' + userId);
  if (cached) return JSON.parse(cached);
  var u = findBy_('Users', 'userId', userId);
  if (u) cache.put('user:' + userId, JSON.stringify(u), 60);
  return u;
}

// ---------------------------------------------------------------- login

function login_(data, meta) {
  requireObject_(data, 'Request');
  if (typeof data.username !== 'string' || data.username.trim() === '') throw appError_('VALIDATION', 'Username is required');
  if (typeof data.password !== 'string' || data.password === '') throw appError_('VALIDATION', 'Password is required');
  if (data.password.length > 128) throw appError_('INVALID_CREDENTIALS', 'Invalid username or password');
  var username = data.username.trim().toLowerCase().slice(0, 40);

  var cache = CacheService.getScriptCache();
  var globalFails = Number(cache.get('loginfail:global') || 0);
  if (globalFails >= LIMITS.globalFailedLoginsPer10Min) {
    throw appError_('RATE_LIMITED', 'Too many failed sign-in attempts. Please try again in a few minutes.');
  }

  return withLock_(function () {
    var user = USERNAME_PATTERN.test(username) ? findBy_('Users', 'username', username) : null;
    var now = nowIso_();
    var fail = function (reason, auditUser) {
      cache.put('loginfail:global', String(globalFails + 1), 600);
      writeAudit_(auditUser || null, 'LOGIN_FAILED', username, 'DENIED', { reason: reason });
      return appError_('INVALID_CREDENTIALS', 'Invalid username or password');
    };

    if (!user) {
      verifyPassword_(data.password, DUMMY_HASH_);          // same work as a real check: no timing hint
      throw fail('unknown user');
    }
    if (user.lockedUntil && user.lockedUntil > now) {
      writeAudit_(user, 'LOGIN_FAILED', username, 'DENIED', { reason: 'locked' });
      throw appError_('ACCOUNT_LOCKED', 'This account is locked after too many failed attempts. Try again later or ask an administrator.');
    }
    var ok = verifyPassword_(data.password, user.passwordHash);
    if (!ok || user.status !== 'ACTIVE') {
      if (!ok) {
        var attempts = Number(user.failedAttempts || 0) + 1;
        var threshold = getNumberSetting_('lockoutThreshold', 3, 20);
        var patch = { failedAttempts: attempts };
        if (attempts >= threshold) {
          patch.failedAttempts = 0;
          patch.lockedUntil = new Date(Date.now() + getNumberSetting_('lockoutMinutes', 1, 1440) * 60000).toISOString();
          writeAudit_(user, 'ACCOUNT_LOCKED', username, 'DENIED', { attempts: attempts });
        }
        updateRecord_('Users', user._row, 'userId', user.userId, patch);
        clearUserCache_(user.userId);
      }
      throw fail(ok ? 'disabled' : 'wrong password', user);
    }

    updateRecord_('Users', user._row, 'userId', user.userId, { failedAttempts: 0, lockedUntil: '', lastLoginAt: now });
    clearUserCache_(user.userId);
    var session = createSession_(user, meta);
    writeAudit_(user, 'LOGIN', username, 'OK', {});
    var fresh = publicUser_(user);
    fresh.lastLoginAt = now;
    return {
      token: session.token,
      expiresAt: session.expiresAt,
      idleMinutes: getNumberSetting_('sessionIdleMinutes', 5, 1440),
      user: fresh,
      permissions: permissionsOf_(user.role),
      mustChangePassword: user.mustChangePassword === 'TRUE'
    };
  });
}

function createSession_(user, meta) {
  var token = randomToken_();
  var now = new Date();
  var record = {
    sessionId: Utilities.getUuid(),
    tokenHash: sha256Hex_(token),
    userId: user.userId,
    createdAt: now.toISOString(),
    lastSeenAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + getNumberSetting_('sessionMaxHours', 1, 168) * 3600000).toISOString(),
    revokedAt: '',
    userAgent: String((meta && meta.userAgent) || '').slice(0, 200)
  };
  appendRecord_('Sessions', record);
  return { token: token, expiresAt: record.expiresAt };
}

// ---------------------------------------------------------------- session check (every authenticated request)

/** Returns { session, user } or throws UNAUTHENTICATED. Role and status come from the Users sheet only. */
function requireSession_(token) {
  if (typeof token !== 'string' || !TOKEN_PATTERN_.test(token)) throw appError_('UNAUTHENTICATED', 'Please sign in');
  var tokenHash = sha256Hex_(token);
  var cache = CacheService.getScriptCache();
  var cached = cache.get('sess:' + tokenHash);
  var session = cached ? JSON.parse(cached) : findBy_('Sessions', 'tokenHash', tokenHash);
  if (!session) throw appError_('UNAUTHENTICATED', 'Please sign in');

  var nowMs = Date.now();
  var idleMs = getNumberSetting_('sessionIdleMinutes', 5, 1440) * 60000;
  if (session.revokedAt || new Date(session.expiresAt).getTime() <= nowMs ||
      new Date(session.lastSeenAt).getTime() + idleMs <= nowMs) {
    cache.remove('sess:' + tokenHash);
    throw appError_('SESSION_EXPIRED', 'Your session has ended. Please sign in again.');
  }
  var user = getUserById_(session.userId);
  if (!user || user.status !== 'ACTIVE') {
    cache.remove('sess:' + tokenHash);
    throw appError_('UNAUTHENTICATED', 'Please sign in');
  }

  // keep the idle timer running; written to the sheet at most every few minutes
  if (nowMs - new Date(session.lastSeenAt).getTime() > LIMITS.touchSessionEverySeconds * 1000) {
    withLock_(function () {
      var current = findBy_('Sessions', 'tokenHash', tokenHash);
      if (!current || current.revokedAt) throw appError_('UNAUTHENTICATED', 'Please sign in');
      session = current;
      session.lastSeenAt = new Date(nowMs).toISOString();
      updateRecord_('Sessions', session._row, 'sessionId', session.sessionId, { lastSeenAt: session.lastSeenAt });
    });
  }
  cache.put('sess:' + tokenHash, JSON.stringify(session), LIMITS.sessionCacheSeconds);
  return { session: session, user: user, tokenHash: tokenHash };
}

// ---------------------------------------------------------------- logout / revoke

function logout_(ctx) {
  withLock_(function () {
    var s = findBy_('Sessions', 'tokenHash', ctx.tokenHash);
    if (s && !s.revokedAt) updateRecord_('Sessions', s._row, 'sessionId', s.sessionId, { revokedAt: nowIso_() });
  });
  CacheService.getScriptCache().remove('sess:' + ctx.tokenHash);
  writeAudit_(ctx.user, 'LOGOUT', ctx.user.username, 'OK', {});
  return { loggedOut: true };
}

/** Revoke every open session of a user (optionally keeping one). Caller holds the lock. */
function revokeUserSessions_(userId, keepTokenHash) {
  var sh = sheet_('Sessions');
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var headers = headers_(sh);
  var cUser = headers.indexOf('userId'), cRev = headers.indexOf('revokedAt'), cHash = headers.indexOf('tokenHash');
  var range = sh.getRange(2, 1, last - 1, headers.length);
  var values = range.getValues();
  var now = nowIso_(), n = 0, cache = CacheService.getScriptCache();
  for (var i = 0; i < values.length; i++) {
    if (readCell_(values[i][cUser]) === userId && !readCell_(values[i][cRev]) && readCell_(values[i][cHash]) !== keepTokenHash) {
      values[i][cRev] = now;
      cache.remove('sess:' + readCell_(values[i][cHash]));
      n++;
    }
  }
  if (n) range.setValues(values);
  return n;
}

// ---------------------------------------------------------------- password change (own account)

function changePassword_(ctx, data) {
  requireObject_(data, 'Request');
  if (typeof data.currentPassword !== 'string' || data.currentPassword === '') throw appError_('VALIDATION', 'Current password is required');
  var next = validatePassword_(data.newPassword, ctx.user.username);
  if (next === data.currentPassword) throw appError_('VALIDATION', 'The new password must be different from the current one');
  return withLock_(function () {
    var user = findBy_('Users', 'userId', ctx.user.userId);
    if (!verifyPassword_(data.currentPassword, user.passwordHash)) {
      writeAudit_(user, 'PASSWORD_CHANGE', user.username, 'DENIED', { reason: 'wrong current password' });
      throw appError_('VALIDATION', 'The current password is not correct');
    }
    var now = nowIso_();
    updateRecord_('Users', user._row, 'userId', user.userId,
      { passwordHash: hashPassword_(next), mustChangePassword: false, passwordChangedAt: now, updatedAt: now, updatedBy: user.userId });
    clearUserCache_(user.userId);
    var revoked = revokeUserSessions_(user.userId, ctx.tokenHash);   // other devices are signed out
    writeAudit_(user, 'PASSWORD_CHANGE', user.username, 'OK', { otherSessionsSignedOut: revoked });
    return { changed: true, otherSessionsSignedOut: revoked };
  });
}
