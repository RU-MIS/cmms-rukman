/**
 * Web app entry points.
 *
 * The browser calls the web app with POST and a text/plain body:
 *   { "action": "...", "token": "<session token or omitted>", "data": { ... }, "client": { "userAgent": "..." } }
 * text/plain keeps the request a CORS "simple request" (Apps Script cannot answer
 * a preflight). Apps Script always answers HTTP 200, so the outcome is in the body:
 *   { "ok": true,  "data": { ... } }
 *   { "ok": false, "error": { "code": "...", "message": "..." } }
 *
 * Only the actions listed in API_ACTIONS are reachable. Each one declares whether
 * it needs a session and which permission; the role is always read from the Users sheet.
 */

var API_ACTIONS = {
  login:          { auth: false, handler: function (ctx, data, meta) { return login_(data, meta); } },
  logout:         { auth: true, allowWhilePasswordChange: true, handler: function (ctx) { return logout_(ctx); } },
  me:             { auth: true, allowWhilePasswordChange: true, handler: function (ctx) { return me_(ctx); } },
  changePassword: { auth: true, allowWhilePasswordChange: true, handler: function (ctx, data) { return changePassword_(ctx, data); } },
  dashboard:      { auth: true, permission: 'dashboard.view', handler: function (ctx) { return dashboard_(ctx); } },
  listUsers:      { auth: true, permission: 'users.view',   handler: function (ctx) { return listUsers_(ctx); } },
  createUser:     { auth: true, permission: 'users.manage', handler: function (ctx, data) { return createUser_(ctx, data); } },
  updateUser:     { auth: true, permission: 'users.manage', handler: function (ctx, data) { return updateUser_(ctx, data); } },
  resetPassword:  { auth: true, permission: 'users.manage', handler: function (ctx, data) { return resetPassword_(ctx, data); } },
  unlockUser:     { auth: true, permission: 'users.manage', handler: function (ctx, data) { return unlockUser_(ctx, data); } },
  listAudit:      { auth: true, permission: 'audit.view',   handler: function (ctx, data) { return listAudit_(ctx, data); } }
};

function doPost(e) {
  return jsonOutput_(handleRequest_(e && e.postData ? e.postData.contents : ''));
}

/** GET only reports that the service is up (no data, no actions). */
function doGet() {
  return jsonOutput_({ ok: true, data: { service: APP_NAME, status: 'up', time: nowIso_() } });
}

function jsonOutput_(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}

/** Pure request handling (string in, object out) — also what the automated tests call. */
function handleRequest_(raw) {
  var action = '';
  try {
    if (typeof raw !== 'string' || raw === '') throw appError_('BAD_REQUEST', 'Empty request');
    if (raw.length > LIMITS.maxRequestBytes) throw appError_('BAD_REQUEST', 'Request too large');
    var req;
    try { req = JSON.parse(raw); } catch (parseError) { throw appError_('BAD_REQUEST', 'Request is not valid JSON'); }
    requireObject_(req, 'Request');
    action = typeof req.action === 'string' ? req.action : '';
    if (!Object.prototype.hasOwnProperty.call(API_ACTIONS, action)) throw appError_('BAD_REQUEST', 'Unknown action');
    var def = API_ACTIONS[action];
    var data = req.data === undefined ? {} : req.data;
    var meta = { userAgent: req.client && typeof req.client.userAgent === 'string' ? req.client.userAgent : '' };

    var ctx = null;
    if (def.auth) {
      ctx = requireSession_(req.token);
      if (ctx.user.mustChangePassword === 'TRUE' && !def.allowWhilePasswordChange) {
        throw appError_('PASSWORD_CHANGE_REQUIRED', 'Please change your temporary password first');
      }
      if (def.permission && permissionsOf_(ctx.user.role).indexOf(def.permission) < 0) {
        writeAudit_(ctx.user, 'ACCESS_DENIED', action, 'DENIED', { permission: def.permission });
        throw appError_('FORBIDDEN', 'You do not have permission for this action');
      }
    }
    return { ok: true, data: def.handler(ctx, data, meta) };
  } catch (err) {
    if (err && err.appCode) return { ok: false, error: { code: err.appCode, message: err.message } };
    console.error('API error in action "' + action + '": ' + (err && err.stack ? err.stack : err));
    return { ok: false, error: { code: 'SERVER_ERROR', message: 'Something went wrong on the server. Please try again.' } };
  }
}

function me_(ctx) {
  return {
    user: publicUser_(ctx.user),
    permissions: permissionsOf_(ctx.user.role),
    mustChangePassword: ctx.user.mustChangePassword === 'TRUE',
    idleMinutes: getNumberSetting_('sessionIdleMinutes', 5, 1440),
    appName: getSetting_('appName')
  };
}

/** Phase 1 dashboard: only real figures that exist in Phase 1 (users, recent activity). */
function dashboard_(ctx) {
  var perms = permissionsOf_(ctx.user.role);
  var out = { user: publicUser_(ctx.user), appName: getSetting_('appName'), serverTime: nowIso_() };
  if (perms.indexOf('users.view') >= 0) {
    var users = readAll_('Users');
    var byRole = {};
    ROLES.forEach(function (r) { byRole[r] = 0; });
    users.forEach(function (u) { if (u.status === 'ACTIVE') byRole[u.role] = (byRole[u.role] || 0) + 1; });
    out.users = { active: users.filter(function (u) { return u.status === 'ACTIVE'; }).length,
                  disabled: users.filter(function (u) { return u.status !== 'ACTIVE'; }).length,
                  locked: users.filter(function (u) { return u.lockedUntil && u.lockedUntil > nowIso_(); }).length,
                  byRole: byRole };
  }
  if (perms.indexOf('audit.view') >= 0) out.recentActivity = listAudit_(ctx, { limit: 8 }).entries;
  return out;
}
