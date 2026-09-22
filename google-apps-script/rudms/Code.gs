/**
 * Rukman Udyog Docs Management System (RUDMS)
 * Backend: Drive folder setup, upload, permissions, indexing, search.
 *
 * File metadata (viewers/editors/uploadedBy) is stored directly on each
 * Drive file's description field as JSON, NOT in a separate Google
 * Sheet. This project went through extensive debugging where every
 * function that touched SpreadsheetApp (even ones whose final return
 * value contained no Sheets objects at all) reliably failed to have its
 * response delivered back to the client via google.script.run, while
 * every DriveApp-only function reliably worked - consistently, across
 * dozens of tests, in this specific environment. Rather than keep
 * fighting that, the whole app avoids SpreadsheetApp entirely.
 */

var ROOT_FOLDER_NAME = 'Rukman Udyog Docs Management System (RUDMS)';
var DEFAULT_CATEGORIES = ['RFQ', 'Purchase Orders', 'Purchase Bills', 'CAD Designs'];
var CONTACTS_FILE_NAME = 'RUDMS_Contacts.json';
var USERS_FILE_NAME = 'RUDMS_Users.json';
var SESSIONS_FILE_NAME = 'RUDMS_Sessions.json';
var SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// ---------------------------------------------------------------------------
// Web app entry point
// ---------------------------------------------------------------------------

function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('RUDMS - Document Management Portal')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ---------------------------------------------------------------------------
// Folder management
// ---------------------------------------------------------------------------

function getRootFolder_() {
  var props = PropertiesService.getScriptProperties();
  var cachedId = props.getProperty('ROOT_FOLDER_ID');

  if (cachedId) {
    try {
      var cached = DriveApp.getFolderById(cachedId);
      if (!cached.isTrashed()) return cached;
    } catch (err) {
      // Stale/deleted reference - fall through and re-resolve.
    }
  }

  var existing = DriveApp.getFoldersByName(ROOT_FOLDER_NAME);
  while (existing.hasNext()) {
    var folder = existing.next();
    if (!folder.isTrashed()) {
      props.setProperty('ROOT_FOLDER_ID', folder.getId());
      return folder;
    }
  }

  var created = DriveApp.createFolder(ROOT_FOLDER_NAME);
  props.setProperty('ROOT_FOLDER_ID', created.getId());
  return created;
}

function getOrCreateCategoryFolder_(rootFolder, categoryName) {
  var name = String(categoryName).trim();
  if (!name) throw new Error('Category name cannot be empty.');

  var iter = rootFolder.getFoldersByName(name);
  while (iter.hasNext()) {
    var folder = iter.next();
    if (!folder.isTrashed()) return folder;
  }
  return rootFolder.createFolder(name);
}

/**
 * Case-insensitive exact-name match within a single folder - "logo.png"
 * and "LOGO.PNG" count as duplicates, but "logo.png" and "logo.jpeg"
 * don't (different extension = different file).
 */
function fileNameExistsInFolder_(folder, fileName) {
  var target = String(fileName).toLowerCase();
  var files = folder.getFiles();
  while (files.hasNext()) {
    var file = files.next();
    if (!file.isTrashed() && file.getName().toLowerCase() === target) return true;
  }
  return false;
}

function listCategoryFolders_(rootFolder) {
  var names = {};
  DEFAULT_CATEGORIES.forEach(function (c) { names[c] = true; });

  var iter = rootFolder.getFolders();
  while (iter.hasNext()) {
    var folder = iter.next();
    if (!folder.isTrashed()) names[folder.getName()] = true;
  }
  return Object.keys(names).sort();
}

// ---------------------------------------------------------------------------
// Per-file metadata, stored as JSON in the Drive file's own description
// ---------------------------------------------------------------------------

function buildFileMeta_(viewerEmails, editorEmails, uploadedBy) {
  return JSON.stringify({
    viewers: viewerEmails.join(', '),
    editors: editorEmails.join(', '),
    uploadedBy: uploadedBy
  });
}

function parseFileMeta_(description) {
  try {
    var meta = JSON.parse(description || '{}');
    return {
      viewers: meta.viewers || '',
      editors: meta.editors || '',
      uploadedBy: meta.uploadedBy || ''
    };
  } catch (err) {
    return { viewers: '', editors: '', uploadedBy: '' };
  }
}

function fileToRecord_(file, categoryName) {
  var meta = parseFileMeta_(file.getDescription());
  var name = file.getName();
  return {
    fileId: file.getId(),
    fileName: name,
    category: categoryName,
    driveLink: file.getUrl(),
    fileType: (name.split('.').pop() || '').toLowerCase(),
    viewers: meta.viewers,
    editors: meta.editors,
    uploadDate: file.getDateCreated().toISOString(),
    uploadedBy: meta.uploadedBy,
    size: file.getSize()
  };
}

// ---------------------------------------------------------------------------
// Public API - system bootstrap
// ---------------------------------------------------------------------------

/**
 * Fast, minimal call for first paint: just identity + root folder.
 * Deliberately does NOT touch categories, so it stays quick even on a
 * cold start.
 *
 * authMode tells the client whether to show the login screen:
 *  - 'google': visitor is signed into a Google account, currentUser is
 *    their email - no login screen needed, unchanged from before.
 *  - 'external': visitor authenticated with a username/password and
 *    passed a valid session token as externalToken.
 *  - 'none': neither - client shows the login screen.
 */
function getBootstrapInfo(externalToken) {
  try {
    var rootFolder = getRootFolder_();
    var googleEmail = Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail();

    if (googleEmail) {
      return { success: true, currentUser: googleEmail, authMode: 'google', rootFolderId: rootFolder.getId() };
    }

    var session = validateSession_(rootFolder, externalToken);
    if (session) {
      return {
        success: true,
        currentUser: session.name || session.username,
        authMode: 'external',
        rootFolderId: rootFolder.getId()
      };
    }

    return { success: true, currentUser: '', authMode: 'none', rootFolderId: rootFolder.getId() };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Creates the default category folders exactly once (gated by a Script
 * Property flag) - safe to call on every load since it's a no-op after
 * the first successful run. Called fire-and-forget from the client
 * after first paint, so this being slow never blocks the UI.
 */
function ensureDefaultCategories() {
  try {
    var props = PropertiesService.getScriptProperties();
    if (!props.getProperty('CATEGORIES_READY')) {
      var rootFolder = getRootFolder_();
      DEFAULT_CATEGORIES.forEach(function (c) {
        getOrCreateCategoryFolder_(rootFolder, c);
      });
      props.setProperty('CATEGORIES_READY', 'true');
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Lists every file across every category folder, reading each file's
 * metadata straight off its own Drive description - no separate index
 * to fall out of sync or fail to load.
 */
function getAllFiles() {
  try {
    var rootFolder = getRootFolder_();
    var files = [];
    var folderIter = rootFolder.getFolders();
    while (folderIter.hasNext()) {
      var folder = folderIter.next();
      if (folder.isTrashed()) continue;
      var categoryName = folder.getName();
      var fileIter = folder.getFiles();
      while (fileIter.hasNext()) {
        var file = fileIter.next();
        if (file.isTrashed()) continue;
        files.push(fileToRecord_(file, categoryName));
      }
    }
    return { success: true, files: files };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function getCategories() {
  try {
    return { success: true, categories: listCategoryFolders_(getRootFolder_()) };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function addCategory(categoryName) {
  try {
    var rootFolder = getRootFolder_();
    getOrCreateCategoryFolder_(rootFolder, categoryName);
    return { success: true, categories: listCategoryFolders_(rootFolder) };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Upload + permissions
// ---------------------------------------------------------------------------

/**
 * payload: {
 *   fileName, mimeType, base64Data, category,
 *   viewerEmails: string[], editorEmails: string[], externalToken
 * }
 */
function uploadFile(payload) {
  try {
    if (!payload || !payload.base64Data || !payload.fileName) {
      throw new Error('Missing file data.');
    }

    var rootFolder = getRootFolder_();
    var categoryFolder = getOrCreateCategoryFolder_(rootFolder, payload.category || 'Uncategorized');

    if (fileNameExistsInFolder_(categoryFolder, payload.fileName)) {
      throw new Error(
        '"' + payload.fileName + '" already exists in ' + categoryFolder.getName() +
        '. Rename the file or delete the existing one first.'
      );
    }

    var bytes = Utilities.base64Decode(payload.base64Data);
    var blob = Utilities.newBlob(bytes, payload.mimeType || 'application/octet-stream', payload.fileName);
    var file = categoryFolder.createFile(blob);
    // Files created via DriveApp are already private to the owner by
    // default - no separate setSharing() call needed here.

    var viewerEmails = uniqueEmails_(payload.viewerEmails);
    var editorEmails = uniqueEmails_(payload.editorEmails);
    var warnings = applyPermissions_(file, viewerEmails, editorEmails);

    var uploadedBy = resolveCurrentUser_(rootFolder, payload.externalToken);
    file.setDescription(buildFileMeta_(viewerEmails, editorEmails, uploadedBy));

    return {
      success: true,
      warnings: warnings,
      file: fileToRecord_(file, categoryFolder.getName())
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function uniqueEmails_(list) {
  if (!list) return [];
  var seen = {};
  var out = [];
  list.forEach(function (raw) {
    var email = String(raw).trim().toLowerCase();
    if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !seen[email]) {
      seen[email] = true;
      out.push(email);
    }
  });
  return out;
}

function applyPermissions_(file, viewerEmails, editorEmails) {
  var warnings = [];
  editorEmails.forEach(function (email) {
    try { file.addEditor(email); } catch (e) { warnings.push('Could not add editor ' + email + ': ' + e.message); }
  });
  viewerEmails.forEach(function (email) {
    try { file.addViewer(email); } catch (e) { warnings.push('Could not add viewer ' + email + ': ' + e.message); }
  });
  return warnings;
}

function updateFilePermissions(fileId, viewerEmails, editorEmails) {
  try {
    var file = DriveApp.getFileById(fileId);

    file.getViewers().forEach(function (u) { try { file.removeViewer(u); } catch (e) {} });
    file.getEditors().forEach(function (u) {
      if (u.getEmail() !== Session.getActiveUser().getEmail()) {
        try { file.removeEditor(u); } catch (e) {}
      }
    });

    var newViewers = uniqueEmails_(viewerEmails);
    var newEditors = uniqueEmails_(editorEmails);
    var warnings = applyPermissions_(file, newViewers, newEditors);

    var existingMeta = parseFileMeta_(file.getDescription());
    file.setDescription(buildFileMeta_(newViewers, newEditors, existingMeta.uploadedBy));

    return { success: true, warnings: warnings };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function deleteFile(fileId) {
  try {
    DriveApp.getFileById(fileId).setTrashed(true);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Folder-level (category) access management
// ---------------------------------------------------------------------------

function mapUsersToEmails_(users) {
  return users.map(function (u) { return u.getEmail(); }).filter(Boolean);
}

/**
 * Returns current Drive-level sharing for every category folder, so the
 * "Manage Access" panel can show who already has folder-wide access.
 * Sharing a folder in Drive automatically grants the same access to every
 * file inside it (now and any uploaded later).
 */
function getCategoryAccessOverview() {
  try {
    var rootFolder = getRootFolder_();
    var categories = listCategoryFolders_(rootFolder);
    var result = categories.map(function (name) {
      var folder = getOrCreateCategoryFolder_(rootFolder, name);
      return {
        name: name,
        viewers: mapUsersToEmails_(folder.getViewers()).join(', '),
        editors: mapUsersToEmails_(folder.getEditors()).join(', ')
      };
    });
    return { success: true, categories: result };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Sets the given viewer/editor emails as the category folder's Drive
 * sharing list (replacing whatever was there before). When
 * applyToExistingFiles is true, the same emails are also additively
 * stamped onto every file already inside the folder (union with whatever
 * access that file already had) so each file's own metadata displays
 * accurate access - Drive itself already grants folder viewers/editors
 * access to existing and future files in the folder regardless of this
 * flag.
 */
function updateCategoryAccess(categoryName, viewerEmails, editorEmails, applyToExistingFiles) {
  try {
    var rootFolder = getRootFolder_();
    var folder = getOrCreateCategoryFolder_(rootFolder, categoryName);

    folder.getViewers().forEach(function (u) { try { folder.removeViewer(u); } catch (e) {} });
    folder.getEditors().forEach(function (u) {
      if (u.getEmail() !== Session.getActiveUser().getEmail()) {
        try { folder.removeEditor(u); } catch (e) {}
      }
    });

    var newViewers = uniqueEmails_(viewerEmails);
    var newEditors = uniqueEmails_(editorEmails);
    var warnings = applyPermissions_(folder, newViewers, newEditors);

    if (applyToExistingFiles) {
      var iter = folder.getFiles();
      while (iter.hasNext()) {
        var file = iter.next();
        warnings = warnings.concat(applyPermissions_(file, newViewers, newEditors));

        var existingMeta = parseFileMeta_(file.getDescription());
        var mergedViewers = uniqueEmails_(existingMeta.viewers.split(',').concat(newViewers));
        var mergedEditors = uniqueEmails_(existingMeta.editors.split(',').concat(newEditors));
        file.setDescription(buildFileMeta_(mergedViewers, mergedEditors, existingMeta.uploadedBy));
      }
    }

    return { success: true, warnings: warnings };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// File content retrieval (for in-browser 3D CAD preview)
// ---------------------------------------------------------------------------

function getFileContentForPreview(fileId) {
  try {
    var file = DriveApp.getFileById(fileId);
    var blob = file.getBlob();
    return {
      success: true,
      base64: Utilities.base64Encode(blob.getBytes()),
      mimeType: blob.getContentType(),
      fileName: file.getName()
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Generic single-file JSON storage helper, used for contacts, login
// accounts, and sessions below - all DriveApp only, no SpreadsheetApp.
// ---------------------------------------------------------------------------

function findNamedFile_(rootFolder, fileName) {
  var files = rootFolder.getFilesByName(fileName);
  return files.hasNext() ? files.next() : null;
}

function readJsonFile_(rootFolder, fileName, fallback) {
  var file = findNamedFile_(rootFolder, fileName);
  if (!file) return fallback;
  try {
    var data = JSON.parse(file.getBlob().getDataAsString() || 'null');
    return (data === null || data === undefined) ? fallback : data;
  } catch (err) {
    return fallback;
  }
}

function writeJsonFile_(rootFolder, fileName, data) {
  var json = JSON.stringify(data);
  var file = findNamedFile_(rootFolder, fileName);
  if (file) {
    file.setContent(json);
  } else {
    rootFolder.createFile(fileName, json, MimeType.PLAIN_TEXT);
  }
}

// ---------------------------------------------------------------------------
// Saved contacts ("doer list") - a reusable people picker for the
// Viewer/Editor access fields, so emails don't need retyping every time.
// ---------------------------------------------------------------------------

function getContacts() {
  try {
    return { success: true, contacts: readJsonFile_(getRootFolder_(), CONTACTS_FILE_NAME, []) };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/** Adds a new contact, or updates the name if the email already exists. */
function saveContact(name, email) {
  try {
    var cleanEmail = String(email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      throw new Error('Enter a valid email address.');
    }
    var cleanName = String(name || '').trim();

    var rootFolder = getRootFolder_();
    var contacts = readJsonFile_(rootFolder, CONTACTS_FILE_NAME, []);
    var existing = contacts.filter(function (c) { return c.email === cleanEmail; })[0];
    if (existing) {
      existing.name = cleanName || existing.name;
    } else {
      contacts.push({ name: cleanName, email: cleanEmail });
    }
    contacts.sort(function (a, b) { return (a.name || a.email).localeCompare(b.name || b.email); });

    writeJsonFile_(rootFolder, CONTACTS_FILE_NAME, contacts);
    return { success: true, contacts: contacts };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function deleteContact(email) {
  try {
    var cleanEmail = String(email || '').trim().toLowerCase();
    var rootFolder = getRootFolder_();
    var contacts = readJsonFile_(rootFolder, CONTACTS_FILE_NAME, []).filter(function (c) { return c.email !== cleanEmail; });
    writeJsonFile_(rootFolder, CONTACTS_FILE_NAME, contacts);
    return { success: true, contacts: contacts };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Login accounts for people without a Google account
//
// Google-signed-in visitors keep working exactly as before (their email
// via Session.getActiveUser()). This adds a second, independent path:
// a username/password checked against a salted SHA-256 hash, issuing a
// random session token the client stores in localStorage and sends back
// as `externalToken` on calls that need to know who's asking.
//
// Honest limitation: this gates what the RUDMS *client UI* shows (no
// login, no file browser) - it is not a server-side authorization check
// on every single function, since this app's functions are otherwise
// callable directly. That's an appropriate bar for keeping casual/public
// visitors out, not a defense against a determined technical attacker.
// ---------------------------------------------------------------------------

function generateSalt_() {
  return Utilities.getUuid();
}

function hashPassword_(password, salt) {
  var bytes = Utilities.computeHmacSha256Signature(String(password), salt);
  return bytes.map(function (b) { return ((b + 256) % 256).toString(16).padStart(2, '0'); }).join('');
}

function readUsers_(rootFolder) {
  return readJsonFile_(rootFolder, USERS_FILE_NAME, []);
}

function publicUserFields_(u) {
  return { username: u.username, name: u.name, createdAt: u.createdAt };
}

function listExternalUsers() {
  try {
    var users = readUsers_(getRootFolder_());
    return { success: true, users: users.map(publicUserFields_) };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function createExternalUser(username, password, name) {
  try {
    var cleanUsername = String(username || '').trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,40}$/.test(cleanUsername)) {
      throw new Error('Username must be 3-40 characters: letters, numbers, dot, underscore or dash only.');
    }
    if (!password || String(password).length < 6) {
      throw new Error('Password must be at least 6 characters.');
    }

    var rootFolder = getRootFolder_();
    var users = readUsers_(rootFolder);
    if (users.some(function (u) { return u.username === cleanUsername; })) {
      throw new Error('That username is already taken.');
    }

    var salt = generateSalt_();
    users.push({
      username: cleanUsername,
      name: String(name || '').trim() || cleanUsername,
      salt: salt,
      passwordHash: hashPassword_(password, salt),
      createdAt: new Date().toISOString()
    });
    users.sort(function (a, b) { return a.username.localeCompare(b.username); });

    writeJsonFile_(rootFolder, USERS_FILE_NAME, users);
    return { success: true, users: users.map(publicUserFields_) };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function deleteExternalUser(username) {
  try {
    var cleanUsername = String(username || '').trim().toLowerCase();
    var rootFolder = getRootFolder_();
    var users = readUsers_(rootFolder).filter(function (u) { return u.username !== cleanUsername; });
    writeJsonFile_(rootFolder, USERS_FILE_NAME, users);

    // Also kill any active sessions for this account.
    var sessions = readJsonFile_(rootFolder, SESSIONS_FILE_NAME, {});
    Object.keys(sessions).forEach(function (token) {
      if (sessions[token].username === cleanUsername) delete sessions[token];
    });
    writeJsonFile_(rootFolder, SESSIONS_FILE_NAME, sessions);

    return { success: true, users: users.map(publicUserFields_) };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function login(username, password) {
  try {
    var cleanUsername = String(username || '').trim().toLowerCase();
    var rootFolder = getRootFolder_();
    var users = readUsers_(rootFolder);
    var user = users.filter(function (u) { return u.username === cleanUsername; })[0];

    if (!user || hashPassword_(String(password || ''), user.salt) !== user.passwordHash) {
      throw new Error('Incorrect username or password.');
    }

    var sessions = readJsonFile_(rootFolder, SESSIONS_FILE_NAME, {});
    var now = Date.now();
    Object.keys(sessions).forEach(function (t) {
      if (sessions[t].expiresAt < now) delete sessions[t];
    });

    var token = Utilities.getUuid();
    sessions[token] = { username: user.username, name: user.name, expiresAt: now + SESSION_TTL_MS };
    writeJsonFile_(rootFolder, SESSIONS_FILE_NAME, sessions);

    return { success: true, token: token, username: user.username, name: user.name };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function validateSession_(rootFolder, token) {
  if (!token) return null;
  var sessions = readJsonFile_(rootFolder, SESSIONS_FILE_NAME, {});
  var session = sessions[token];
  if (!session || session.expiresAt < Date.now()) return null;
  return session;
}

function validateSession(token) {
  try {
    var session = validateSession_(getRootFolder_(), token);
    return session ? { success: true, username: session.username, name: session.name } : { success: false };
  } catch (err) {
    return { success: false };
  }
}

function logoutSession(token) {
  try {
    var rootFolder = getRootFolder_();
    var sessions = readJsonFile_(rootFolder, SESSIONS_FILE_NAME, {});
    delete sessions[token];
    writeJsonFile_(rootFolder, SESSIONS_FILE_NAME, sessions);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/** Google identity if signed in, else a valid external session's display name, else 'unknown'. */
function resolveCurrentUser_(rootFolder, externalToken) {
  var googleEmail = Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail();
  if (googleEmail) return googleEmail;
  var session = validateSession_(rootFolder, externalToken);
  return session ? (session.name || session.username) : 'unknown';
}
