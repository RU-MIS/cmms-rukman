/**
 * One-time setup and maintenance, run by the spreadsheet owner from the
 * spreadsheet menu "Rukman DMS" (Extensions → Apps Script is only needed once
 * to paste the code). None of these functions is reachable from the web app.
 */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Rukman DMS')
    .addItem('1. Set up / repair database tabs', 'setupDatabase')
    .addItem('2. Create an Admin user', 'menuCreateAdmin')
    .addSeparator()
    .addItem('Sign out all users', 'menuSignOutAll')
    .addToUi();
}

/** Creates missing tabs and columns, the password pepper and default settings. Safe to run again. */
function setupDatabase() {
  var ss = ss_();
  Object.keys(SHEETS).forEach(function (name) {
    var headers = SHEETS[name];
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    var existing = sh.getLastColumn() > 0 ? headers_(sh) : [];
    var missing = headers.filter(function (h) { return existing.indexOf(h) < 0; });
    if (existing.filter(String).length === 0) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    } else if (missing.length) {
      sh.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);   // add, never remove
    }
    var cols = Math.max(sh.getLastColumn(), headers.length);
    sh.getRange(1, 1, sh.getMaxRows(), cols).setNumberFormat('@');                   // everything is plain text
    sh.getRange(1, 1, 1, cols).setFontWeight('bold');
    sh.setFrozenRows(1);
    if (sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).length === 0) {
      sh.protect().setDescription('Managed by Rukman DMS — change data in the app, not here').setWarningOnly(true);
    }
  });
  var blank = ss.getSheetByName('Sheet1');
  if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(blank);

  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('PASSWORD_PEPPER')) props.setProperty('PASSWORD_PEPPER', randomToken_() + randomToken_());

  withLock_(function () {
    var have = readAll_('Settings').map(function (r) { return r.key; });
    Object.keys(DEFAULT_SETTINGS).forEach(function (key) {
      if (have.indexOf(key) < 0) {
        appendRecord_('Settings', { key: key, value: DEFAULT_SETTINGS[key][0], description: DEFAULT_SETTINGS[key][1],
                                    updatedAt: nowIso_(), updatedBy: 'setup' });
      }
    });
  });
  CacheService.getScriptCache().remove('settings');
  return 'Database ready';
}

/** Internal: create an Admin with a temporary password. Returns the password (shown once). */
function createAdminUser_(username, displayName) {
  username = normaliseUsername_(username);
  displayName = requireText_(displayName || username, 'Name', { max: 80 });
  var temp = randomPassword_(14);
  return withLock_(function () {
    if (findBy_('Users', 'username', username)) throw appError_('DUPLICATE', 'Username "' + username + '" already exists');
    var now = nowIso_();
    var user = { userId: Utilities.getUuid(), username: username, displayName: displayName, email: '', role: 'Admin',
                 status: 'ACTIVE', passwordHash: hashPassword_(temp), mustChangePassword: true, failedAttempts: 0,
                 lockedUntil: '', lastLoginAt: '', passwordChangedAt: '', createdAt: now, createdBy: 'setup',
                 updatedAt: now, updatedBy: 'setup' };
    appendRecord_('Users', user);
    writeAudit_(null, 'USER_CREATE', username, 'OK', { role: 'Admin', via: 'spreadsheet menu' });
    return temp;
  });
}

/** Menu: asks for the username and shows the temporary password once (not logged anywhere). */
function menuCreateAdmin() {
  var ui = SpreadsheetApp.getUi();
  var r1 = ui.prompt('Create Admin user', 'Username (3–40 characters: a–z, 0–9, . _ -):', ui.ButtonSet.OK_CANCEL);
  if (r1.getSelectedButton() !== ui.Button.OK) return;
  var r2 = ui.prompt('Create Admin user', 'Display name:', ui.ButtonSet.OK_CANCEL);
  if (r2.getSelectedButton() !== ui.Button.OK) return;
  try {
    var temp = createAdminUser_(r1.getResponseText(), r2.getResponseText());
    ui.alert('Admin created',
      'Username: ' + r1.getResponseText().trim().toLowerCase() + '\nTemporary password: ' + temp +
      '\n\nWrite it down now — it is shown only once. It must be changed at the first sign-in.', ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Not created', e.message, ui.ButtonSet.OK);
  }
}

/** Menu: emergency sign-out of every session. */
function menuSignOutAll() {
  var ui = SpreadsheetApp.getUi();
  if (ui.alert('Sign out all users', 'Every user will have to sign in again. Continue?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  var n = signOutAll_();
  ui.alert('Done', n + ' session(s) ended.', ui.ButtonSet.OK);
}

function signOutAll_() {
  return withLock_(function () {
    var n = 0;
    readAll_('Users').forEach(function (u) { n += revokeUserSessions_(u.userId, null); });
    writeAudit_(null, 'SIGN_OUT_ALL', 'all users', 'OK', { sessions: n });
    return n;
  });
}
