/**
 * User administration (Admin only for changes; Admin and Manager may view).
 * New users and password resets get a one-time temporary password that is
 * returned once to the administrator and must be changed at the first sign-in.
 */

function listUsers_(ctx) {
  return { users: readAll_('Users').map(publicUser_).sort(function (a, b) { return a.username < b.username ? -1 : 1; }) };
}

function activeAdminCount_(users) {
  return users.filter(function (u) { return u.role === 'Admin' && u.status === 'ACTIVE'; }).length;
}

function createUser_(ctx, data) {
  requireObject_(data, 'Request');
  var username = normaliseUsername_(data.username);
  var displayName = requireText_(data.displayName, 'Name', { max: 80 });
  var email = optionalText_(data.email, 'Email', { max: 120, pattern: EMAIL_PATTERN, patternMessage: 'is not a valid e-mail address' }).toLowerCase();
  var role = requireOneOf_(data.role, 'Role', ROLES);
  var temp = randomPassword_(14);
  return withLock_(function () {
    if (findBy_('Users', 'username', username)) throw appError_('DUPLICATE', 'Username "' + username + '" already exists');
    var now = nowIso_();
    var user = {
      userId: Utilities.getUuid(), username: username, displayName: displayName, email: email, role: role, status: 'ACTIVE',
      passwordHash: hashPassword_(temp), mustChangePassword: true, failedAttempts: 0, lockedUntil: '', lastLoginAt: '',
      passwordChangedAt: '', createdAt: now, createdBy: ctx.user.userId, updatedAt: now, updatedBy: ctx.user.userId
    };
    appendRecord_('Users', user);
    writeAudit_(ctx.user, 'USER_CREATE', username, 'OK', { role: role });
    return { user: publicUser_(user), temporaryPassword: temp };
  });
}

function updateUser_(ctx, data) {
  requireObject_(data, 'Request');
  var userId = requireText_(data.userId, 'User', { max: 64 });
  return withLock_(function () {
    var user = findBy_('Users', 'userId', userId);
    if (!user) throw appError_('NOT_FOUND', 'User not found');
    var patch = {}, changes = {};
    if (data.displayName !== undefined) patch.displayName = requireText_(data.displayName, 'Name', { max: 80 });
    if (data.email !== undefined) patch.email = optionalText_(data.email, 'Email', { max: 120, pattern: EMAIL_PATTERN, patternMessage: 'is not a valid e-mail address' }).toLowerCase();
    if (data.role !== undefined) patch.role = requireOneOf_(data.role, 'Role', ROLES);
    if (data.status !== undefined) patch.status = requireOneOf_(data.status, 'Status', USER_STATUS);

    var selfChange = user.userId === ctx.user.userId &&
      ((patch.role && patch.role !== user.role) || (patch.status && patch.status !== user.status));
    if (selfChange) throw appError_('FORBIDDEN', 'You cannot change your own role or status');

    var losesAdmin = user.role === 'Admin' && user.status === 'ACTIVE' &&
      ((patch.role && patch.role !== 'Admin') || patch.status === 'DISABLED');
    if (losesAdmin && activeAdminCount_(readAll_('Users')) <= 1) {
      throw appError_('FORBIDDEN', 'At least one active Admin must remain');
    }
    Object.keys(patch).forEach(function (k) { if (patch[k] !== user[k]) changes[k] = { from: user[k], to: patch[k] }; });
    if (!Object.keys(changes).length) return { user: publicUser_(user), changed: false };

    patch.updatedAt = nowIso_();
    patch.updatedBy = ctx.user.userId;
    updateRecord_('Users', user._row, 'userId', user.userId, patch);
    clearUserCache_(user.userId);
    var revoked = 0;
    if (changes.status && patch.status === 'DISABLED') revoked = revokeUserSessions_(user.userId, null);
    writeAudit_(ctx.user, 'USER_UPDATE', user.username, 'OK', { changes: changes, sessionsRevoked: revoked });
    Object.keys(patch).forEach(function (k) { user[k] = String(patch[k]); });
    return { user: publicUser_(user), changed: true };
  });
}

function resetPassword_(ctx, data) {
  requireObject_(data, 'Request');
  var userId = requireText_(data.userId, 'User', { max: 64 });
  var temp = randomPassword_(14);
  return withLock_(function () {
    var user = findBy_('Users', 'userId', userId);
    if (!user) throw appError_('NOT_FOUND', 'User not found');
    if (user.userId === ctx.user.userId) throw appError_('FORBIDDEN', 'Use "Change password" for your own account');
    var now = nowIso_();
    updateRecord_('Users', user._row, 'userId', user.userId, {
      passwordHash: hashPassword_(temp), mustChangePassword: true, failedAttempts: 0, lockedUntil: '',
      updatedAt: now, updatedBy: ctx.user.userId });
    clearUserCache_(user.userId);
    var revoked = revokeUserSessions_(user.userId, null);
    writeAudit_(ctx.user, 'PASSWORD_RESET', user.username, 'OK', { sessionsRevoked: revoked });
    return { temporaryPassword: temp };
  });
}

function unlockUser_(ctx, data) {
  requireObject_(data, 'Request');
  var userId = requireText_(data.userId, 'User', { max: 64 });
  return withLock_(function () {
    var user = findBy_('Users', 'userId', userId);
    if (!user) throw appError_('NOT_FOUND', 'User not found');
    updateRecord_('Users', user._row, 'userId', user.userId, { failedAttempts: 0, lockedUntil: '', updatedAt: nowIso_(), updatedBy: ctx.user.userId });
    clearUserCache_(user.userId);
    writeAudit_(ctx.user, 'USER_UNLOCK', user.username, 'OK', {});
    return { unlocked: true };
  });
}
