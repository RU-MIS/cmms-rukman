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
var NOTIFY_EMAILS_FILE_NAME = 'RUDMS_NotifyEmails.json';
var OTP_FILE_NAME = 'RUDMS_PasswordResetOtps.json';
var SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
var OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
var MAX_OTP_ATTEMPTS = 5; // a 6-digit code is only ~1M possibilities - cap guesses before it's invalidated

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

function getRootFolder() {
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

function getOrCreateSingleFolder(parentFolder, name) {
  var iter = parentFolder.getFoldersByName(name);
  while (iter.hasNext()) {
    var folder = iter.next();
    if (!folder.isTrashed()) return folder;
  }
  return parentFolder.createFolder(name);
}

/**
 * Walks (creating as needed) a '/'-separated chain of folders starting at
 * rootFolder - e.g. "RFQ/2024/ClientA" becomes RFQ -> 2024 -> ClientA,
 * creating whichever levels don't exist yet. This is how nested
 * subfolders work throughout RUDMS; there is no limit on chain depth.
 * Returns {folder, path}, where path is rebuilt from each level's actual
 * (trimmed) name - so it's always the canonical form even if the input
 * had stray whitespace around a segment.
 */
function getOrCreateFolderByPath(rootFolder, path) {
  var segments = String(path || '').split('/').map(function (s) { return s.trim(); }).filter(Boolean);
  if (!segments.length) throw new Error('Folder name cannot be empty.');

  var folder = rootFolder;
  var cleanPath = '';
  segments.forEach(function (name) {
    folder = getOrCreateSingleFolder(folder, name);
    cleanPath = cleanPath ? cleanPath + '/' + name : name;
  });
  return { folder: folder, path: cleanPath };
}

/**
 * Case-insensitive exact-name match within a single folder - "logo.png"
 * and "LOGO.PNG" count as duplicates, but "logo.png" and "logo.jpeg"
 * don't (different extension = different file). Returns the matching
 * Drive file (so callers can offer to delete it), or null.
 */
function findFileInFolderByName(folder, fileName) {
  var target = String(fileName).toLowerCase();
  var files = folder.getFiles();
  while (files.hasNext()) {
    var file = files.next();
    if (!file.isTrashed() && file.getName().toLowerCase() === target) return file;
  }
  return null;
}

/**
 * Builds the full nested folder tree under rootFolder (any depth) as
 * [{name, path, children: [...]}], sorted alphabetically at every level.
 * `path` is the '/'-separated chain from the top, e.g. "RFQ/2024/ClientA" -
 * the same format uploadFile()/getAllFiles() use for a file's `category`.
 */
function listFolderTree(parentFolder, parentPath) {
  var subfolders = [];
  var iter = parentFolder.getFolders();
  while (iter.hasNext()) {
    var folder = iter.next();
    if (!folder.isTrashed()) subfolders.push(folder);
  }
  subfolders.sort(function (a, b) { return a.getName().localeCompare(b.getName()); });

  return subfolders.map(function (folder) {
    var name = folder.getName();
    var path = parentPath ? parentPath + '/' + name : name;
    return { name: name, path: path, children: listFolderTree(folder, path) };
  });
}

/** Flattens a folder tree (as returned by listFolderTree) into a plain array of paths, depth-first. */
function flattenFolderTree(nodes, out) {
  nodes.forEach(function (node) {
    out.push(node.path);
    flattenFolderTree(node.children, out);
  });
  return out;
}

// ---------------------------------------------------------------------------
// Per-file metadata, stored as JSON in the Drive file's own description
// ---------------------------------------------------------------------------

function buildFileMeta(viewerEmails, editorEmails, uploadedBy) {
  return JSON.stringify({
    viewers: viewerEmails.join(', '),
    editors: editorEmails.join(', '),
    uploadedBy: uploadedBy
  });
}

function parseFileMeta(description) {
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

function fileToRecord(file, categoryName) {
  var meta = parseFileMeta(file.getDescription());
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
 * Everyone signs in with a username/password (see the Login accounts
 * section below) - Google identity is never used as a login gate here,
 * even for visitors signed into a Google account in that browser.
 *
 * authMode tells the client whether to show the login screen:
 *  - 'loggedin': externalToken is a valid, current session.
 *  - 'none': it isn't - client shows the login screen.
 */
function getBootstrapInfo(externalToken) {
  try {
    var rootFolder = getRootFolder();
    var session = validateSessionInternal(rootFolder, externalToken);

    if (session) {
      var user = findUserByUsername(readUsers(rootFolder), session.username);
      return {
        success: true,
        currentUser: session.name || session.username,
        role: user ? (user.role || 'member') : 'member',
        authMode: 'loggedin',
        rootFolderId: rootFolder.getId()
      };
    }

    return { success: true, currentUser: '', role: '', authMode: 'none', rootFolderId: rootFolder.getId() };
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
      var rootFolder = getRootFolder();
      DEFAULT_CATEGORIES.forEach(function (c) {
        getOrCreateFolderByPath(rootFolder, c);
      });
      props.setProperty('CATEGORIES_READY', 'true');
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Lists every file across every folder at any depth, reading each file's
 * metadata straight off its own Drive description - no separate index to
 * fall out of sync or fail to load. Each file's `category` is the full
 * '/'-separated folder path it lives in (e.g. "RFQ/2024/ClientA").
 *
 * Deliberately only recurses INTO the top-level category folders, never
 * rootFolder's own getFiles() - RUDMS's internal JSON files (contacts,
 * login accounts, sessions, notify list) live directly in rootFolder
 * itself, and must never show up as if they were a user's document.
 */
function getAllFiles() {
  try {
    var rootFolder = getRootFolder();
    var files = [];

    function walkFolder(folder, path) {
      var fileIter = folder.getFiles();
      while (fileIter.hasNext()) {
        var file = fileIter.next();
        if (!file.isTrashed()) files.push(fileToRecord(file, path));
      }
      var folderIter = folder.getFolders();
      while (folderIter.hasNext()) {
        var sub = folderIter.next();
        if (sub.isTrashed()) continue;
        walkFolder(sub, path + '/' + sub.getName());
      }
    }

    var topIter = rootFolder.getFolders();
    while (topIter.hasNext()) {
      var topFolder = topIter.next();
      if (topFolder.isTrashed()) continue;
      walkFolder(topFolder, topFolder.getName());
    }

    return { success: true, files: files };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function getFolderTree() {
  try {
    var rootFolder = getRootFolder();
    return { success: true, tree: listFolderTree(rootFolder, '') };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Creates a folder at the given '/'-separated path, creating any missing
 * parent levels along the way - e.g. createFolder("RFQ/2024/ClientA")
 * works even if "2024" doesn't exist under "RFQ" yet. Used both for a
 * brand-new top-level category and for a subfolder nested inside
 * whichever folder is currently open in the sidebar.
 */
function createFolder(path) {
  try {
    var rootFolder = getRootFolder();
    getOrCreateFolderByPath(rootFolder, path);
    return { success: true, tree: listFolderTree(rootFolder, '') };
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

    var rootFolder = getRootFolder();
    var resolved = getOrCreateFolderByPath(rootFolder, payload.category || 'Uncategorized');
    var categoryFolder = resolved.folder;

    var existingFile = findFileInFolderByName(categoryFolder, payload.fileName);
    if (existingFile) {
      return {
        success: false,
        duplicate: true,
        existingFileId: existingFile.getId(),
        error: '"' + payload.fileName + '" already exists in ' + resolved.path + '.'
      };
    }

    var bytes = Utilities.base64Decode(payload.base64Data);
    var blob = Utilities.newBlob(bytes, payload.mimeType || 'application/octet-stream', payload.fileName);
    var file = categoryFolder.createFile(blob);
    // Files created via DriveApp are already private to the owner by
    // default - no separate setSharing() call needed here.

    var viewerEmails = uniqueEmails(payload.viewerEmails);
    var editorEmails = uniqueEmails(payload.editorEmails);
    var warnings = applyPermissions(file, viewerEmails, editorEmails);

    var uploadedBy = resolveCurrentUser(rootFolder, payload.externalToken);
    file.setDescription(buildFileMeta(viewerEmails, editorEmails, uploadedBy));

    return {
      success: true,
      warnings: warnings,
      file: fileToRecord(file, resolved.path)
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function uniqueEmails(list) {
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

function applyPermissions(file, viewerEmails, editorEmails) {
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

    var newViewers = uniqueEmails(viewerEmails);
    var newEditors = uniqueEmails(editorEmails);
    var warnings = applyPermissions(file, newViewers, newEditors);

    var existingMeta = parseFileMeta(file.getDescription());
    file.setDescription(buildFileMeta(newViewers, newEditors, existingMeta.uploadedBy));

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

function mapUsersToEmails(users) {
  return users.map(function (u) { return u.getEmail(); }).filter(Boolean);
}

/**
 * Returns current Drive-level sharing for every folder at any depth (each
 * identified by its full '/'-separated path), so the "Manage Access"
 * panel can show who already has folder-wide access. Sharing a folder in
 * Drive automatically grants the same access to every file inside it -
 * and, since Drive permissions are inherited, every folder nested under
 * it too - now and anything uploaded/created later.
 */
function getCategoryAccessOverview() {
  try {
    var rootFolder = getRootFolder();
    var paths = flattenFolderTree(listFolderTree(rootFolder, ''), []);
    var result = paths.map(function (path) {
      var folder = getOrCreateFolderByPath(rootFolder, path).folder;
      return {
        name: path,
        viewers: mapUsersToEmails(folder.getViewers()).join(', '),
        editors: mapUsersToEmails(folder.getEditors()).join(', ')
      };
    });
    return { success: true, categories: result };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Sets the given viewer/editor emails as the target folder's (identified
 * by its full '/'-separated path) Drive sharing list (replacing whatever
 * was there before). When applyToExistingFiles is true, the same emails
 * are also additively stamped onto every file directly inside that
 * folder (union with whatever access that file already had) so each
 * file's own metadata displays accurate access - Drive itself already
 * grants folder viewers/editors access to existing and future files (and
 * nested subfolders) regardless of this flag.
 */
function updateCategoryAccess(categoryPath, viewerEmails, editorEmails, applyToExistingFiles) {
  try {
    var rootFolder = getRootFolder();
    var folder = getOrCreateFolderByPath(rootFolder, categoryPath).folder;

    folder.getViewers().forEach(function (u) { try { folder.removeViewer(u); } catch (e) {} });
    folder.getEditors().forEach(function (u) {
      if (u.getEmail() !== Session.getActiveUser().getEmail()) {
        try { folder.removeEditor(u); } catch (e) {}
      }
    });

    var newViewers = uniqueEmails(viewerEmails);
    var newEditors = uniqueEmails(editorEmails);
    var warnings = applyPermissions(folder, newViewers, newEditors);

    if (applyToExistingFiles) {
      var iter = folder.getFiles();
      while (iter.hasNext()) {
        var file = iter.next();
        warnings = warnings.concat(applyPermissions(file, newViewers, newEditors));

        var existingMeta = parseFileMeta(file.getDescription());
        var mergedViewers = uniqueEmails(existingMeta.viewers.split(',').concat(newViewers));
        var mergedEditors = uniqueEmails(existingMeta.editors.split(',').concat(newEditors));
        file.setDescription(buildFileMeta(mergedViewers, mergedEditors, existingMeta.uploadedBy));
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

function findNamedFile(rootFolder, fileName) {
  var files = rootFolder.getFilesByName(fileName);
  return files.hasNext() ? files.next() : null;
}

function readJsonFile(rootFolder, fileName, fallback) {
  var file = findNamedFile(rootFolder, fileName);
  if (!file) return fallback;
  try {
    var data = JSON.parse(file.getBlob().getDataAsString() || 'null');
    return (data === null || data === undefined) ? fallback : data;
  } catch (err) {
    return fallback;
  }
}

function writeJsonFile(rootFolder, fileName, data) {
  var json = JSON.stringify(data);
  var file = findNamedFile(rootFolder, fileName);
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
    return { success: true, contacts: readJsonFile(getRootFolder(), CONTACTS_FILE_NAME, []) };
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

    var rootFolder = getRootFolder();
    var contacts = readJsonFile(rootFolder, CONTACTS_FILE_NAME, []);
    var existing = contacts.filter(function (c) { return c.email === cleanEmail; })[0];
    if (existing) {
      existing.name = cleanName || existing.name;
    } else {
      contacts.push({ name: cleanName, email: cleanEmail });
    }
    contacts.sort(function (a, b) { return (a.name || a.email).localeCompare(b.name || b.email); });

    writeJsonFile(rootFolder, CONTACTS_FILE_NAME, contacts);
    return { success: true, contacts: contacts };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function deleteContact(email) {
  try {
    var cleanEmail = String(email || '').trim().toLowerCase();
    var rootFolder = getRootFolder();
    var contacts = readJsonFile(rootFolder, CONTACTS_FILE_NAME, []).filter(function (c) { return c.email !== cleanEmail; });
    writeJsonFile(rootFolder, CONTACTS_FILE_NAME, contacts);
    return { success: true, contacts: contacts };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Login accounts - EVERYONE signs in with a username/password created by
// an admin, regardless of whether they have a Google account. Google
// identity is not used as a login gate at all (only as a last-resort
// fallback for "uploaded by" if somehow neither applies). Passwords are
// salted + SHA-256 hashed, never stored in plain text. A successful login
// issues a random session token the client stores in localStorage and
// sends back as `externalToken` on calls that need to know who's asking.
//
// Roles: 'admin' can create/list/remove login accounts (the "Login
// Accounts" tab); 'member' cannot. The very first account (when none
// exist yet) can be created without an admin session - that's the
// bootstrap step, meant to be run once from the Apps Script editor
// (Run -> setupFirstAdmin) since no one can log in yet at that point.
//
// Honest limitation: this gates what the RUDMS *client UI* shows (no
// login, no file browser) - it is not a server-side authorization check
// on every single function, since most of this app's other functions
// are otherwise callable directly once someone has a token. That's an
// appropriate bar for controlling who gets in and who can manage
// accounts, not a defense against a determined technical attacker.
// ---------------------------------------------------------------------------

function generateSalt() {
  return Utilities.getUuid();
}

function hashPassword(password, salt) {
  var bytes = Utilities.computeHmacSha256Signature(String(password), salt);
  return bytes.map(function (b) { return ((b + 256) % 256).toString(16).padStart(2, '0'); }).join('');
}

function readUsers(rootFolder) {
  return readJsonFile(rootFolder, USERS_FILE_NAME, []);
}

function publicUserFields(u) {
  return { username: u.username, name: u.name, role: u.role || 'member', email: u.email || '', createdAt: u.createdAt };
}

function findUserByUsername(users, username) {
  var clean = String(username || '').trim().toLowerCase();
  return users.filter(function (u) { return u.username === clean; })[0] || null;
}

/** Throws unless callerToken belongs to a valid, currently-admin session. */
function requireAdmin(rootFolder, callerToken) {
  var session = validateSessionInternal(rootFolder, callerToken);
  if (!session) throw new Error('You must be signed in to do this.');
  var user = findUserByUsername(readUsers(rootFolder), session.username);
  if (!user || user.role !== 'admin') throw new Error('Only an admin can manage login accounts.');
}

/** Admin-only once any account exists; the very first account bootstraps freely. */
function listExternalUsers(callerToken) {
  try {
    var rootFolder = getRootFolder();
    var users = readUsers(rootFolder);
    if (users.length > 0) requireAdmin(rootFolder, callerToken);
    return { success: true, users: users.map(publicUserFields) };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * email is optional and only matters for "Forgot password" - see
 * resolveResetEmail() below. It isn't needed when the username itself is
 * already an email address (e.g. every self-signup account), only for
 * admin-created accounts whose username isn't one (like the bootstrap
 * "admin" account).
 */
function createExternalUser(username, password, name, role, callerToken, email) {
  try {
    var cleanUsername = String(username || '').trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,40}$/.test(cleanUsername)) {
      throw new Error('Username must be 3-40 characters: letters, numbers, dot, underscore or dash only.');
    }
    if (!password || String(password).length < 6) {
      throw new Error('Password must be at least 6 characters.');
    }
    var cleanEmail = String(email || '').trim().toLowerCase();
    if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      throw new Error('That email address looks invalid.');
    }

    var rootFolder = getRootFolder();
    var users = readUsers(rootFolder);

    // Bootstrap: the first-ever account needs no admin session (there is
    // no one to be admin yet) and is always created as admin. Every
    // account after that requires an existing admin's token.
    var isBootstrap = users.length === 0;
    if (!isBootstrap) requireAdmin(rootFolder, callerToken);

    if (findUserByUsername(users, cleanUsername)) {
      throw new Error('That username is already taken.');
    }

    var salt = generateSalt();
    users.push({
      username: cleanUsername,
      name: String(name || '').trim() || cleanUsername,
      role: isBootstrap ? 'admin' : (role === 'admin' ? 'admin' : 'member'),
      email: cleanEmail,
      salt: salt,
      passwordHash: hashPassword(password, salt),
      createdAt: new Date().toISOString()
    });
    users.sort(function (a, b) { return a.username.localeCompare(b.username); });

    writeJsonFile(rootFolder, USERS_FILE_NAME, users);
    return { success: true, users: users.map(publicUserFields) };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function countAdmins(users) {
  return users.filter(function (u) { return u.role === 'admin'; }).length;
}

function deleteExternalUser(username, callerToken) {
  try {
    var rootFolder = getRootFolder();
    requireAdmin(rootFolder, callerToken);

    var cleanUsername = String(username || '').trim().toLowerCase();
    var users = readUsers(rootFolder);
    var target = findUserByUsername(users, cleanUsername);
    if (target && target.role === 'admin' && countAdmins(users) <= 1) {
      throw new Error('Cannot remove the last admin - make someone else admin first.');
    }

    users = users.filter(function (u) { return u.username !== cleanUsername; });
    writeJsonFile(rootFolder, USERS_FILE_NAME, users);

    // Also kill any active sessions for this account.
    var sessions = readJsonFile(rootFolder, SESSIONS_FILE_NAME, {});
    Object.keys(sessions).forEach(function (token) {
      if (sessions[token].username === cleanUsername) delete sessions[token];
    });
    writeJsonFile(rootFolder, SESSIONS_FILE_NAME, sessions);

    return { success: true, users: users.map(publicUserFields) };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/** Promotes/demotes an existing account - admin-only, and can never demote the last remaining admin (that would lock everyone out of Login Accounts). */
function updateUserRole(username, newRole, callerToken) {
  try {
    var rootFolder = getRootFolder();
    requireAdmin(rootFolder, callerToken);

    var cleanUsername = String(username || '').trim().toLowerCase();
    var cleanRole = newRole === 'admin' ? 'admin' : 'member';

    var users = readUsers(rootFolder);
    var user = findUserByUsername(users, cleanUsername);
    if (!user) throw new Error('Account not found.');

    if (user.role === 'admin' && cleanRole !== 'admin' && countAdmins(users) <= 1) {
      throw new Error('Cannot remove the last admin - make someone else admin first.');
    }

    user.role = cleanRole;
    writeJsonFile(rootFolder, USERS_FILE_NAME, users);
    return { success: true, users: users.map(publicUserFields) };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Lets ANY signed-in account (member or admin) see who the admin(s) are
 * and how to reach them - the Login Accounts tab itself stays
 * admin-only, but a regular member has no other way to find out who to
 * ask for access/help, so this is deliberately not admin-gated.
 */
function getAdminContacts(callerToken) {
  try {
    var rootFolder = getRootFolder();
    var session = validateSessionInternal(rootFolder, callerToken);
    if (!session) throw new Error('You must be signed in to do this.');

    var admins = readUsers(rootFolder).filter(function (u) { return u.role === 'admin'; });
    return {
      success: true,
      admins: admins.map(function (u) { return { name: u.name || u.username, email: resolveResetEmail(u) || '' }; })
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Self-service signup - no admin session required. Anyone who has the
 * RUDMS link can create their own account this way; the username is
 * always their email address, and the role is always 'member' (never
 * 'admin' - only an existing admin can promote someone, from Login
 * Accounts). Activates immediately and signs the new account straight
 * in, same as login() - there is no admin-approval step.
 *
 * SECURITY NOTE: RUDMS does not check per-file Drive access against the
 * logged-in identity anywhere in the app (see the "Honest limitation"
 * note on the login system above) - every signed-in account, member or
 * admin, can browse and download every file through the app regardless
 * of its own Drive-level sharing. Turning on self-signup therefore means
 * literally anyone who has this URL can get that same access by creating
 * an account themselves. That tradeoff was a deliberate choice (see
 * README), not an oversight - restrict who can reach the URL itself
 * (e.g. an internal network, or just not publicizing it) if that's a
 * concern.
 */
function signup(email, password, name) {
  try {
    var cleanEmail = String(email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      throw new Error('Enter a valid email address.');
    }
    if (!password || String(password).length < 6) {
      throw new Error('Password must be at least 6 characters.');
    }
    var cleanName = String(name || '').trim() || cleanEmail;

    var rootFolder = getRootFolder();
    var users = readUsers(rootFolder);

    if (findUserByUsername(users, cleanEmail)) {
      throw new Error('An account with that email already exists. Try signing in instead.');
    }

    var salt = generateSalt();
    users.push({
      username: cleanEmail,
      name: cleanName,
      role: 'member',
      salt: salt,
      passwordHash: hashPassword(password, salt),
      createdAt: new Date().toISOString()
    });
    users.sort(function (a, b) { return a.username.localeCompare(b.username); });
    writeJsonFile(rootFolder, USERS_FILE_NAME, users);

    notifySignup(rootFolder, cleanEmail, cleanName, password);

    var sessions = readJsonFile(rootFolder, SESSIONS_FILE_NAME, {});
    var now = Date.now();
    Object.keys(sessions).forEach(function (t) { if (sessions[t].expiresAt < now) delete sessions[t]; });
    var token = Utilities.getUuid();
    sessions[token] = { username: cleanEmail, name: cleanName, expiresAt: now + SESSION_TTL_MS };
    writeJsonFile(rootFolder, SESSIONS_FILE_NAME, sessions);

    return { success: true, token: token, username: cleanEmail, name: cleanName, role: 'member' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Best-effort: emails the new account's credentials to the person who
 * just signed up, and separately notifies everyone on the "notify on
 * password change" list (Manage Access -> Login Accounts) that a new
 * account was created - reusing that same admin-managed list rather than
 * a second one, since it already represents "who wants to know about
 * credential events". A notification failure must never block signup.
 */
function notifySignup(rootFolder, username, name, password) {
  try {
    var when = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

    MailApp.sendEmail({
      to: username,
      subject: 'RUDMS: your account has been created',
      body: 'Hi ' + name + ',\n\n' +
        'Your RUDMS account was created on ' + when + '.\n\n' +
        'Username: ' + username + '\n' +
        'Password: ' + password + '\n\n' +
        'Sign in at the RUDMS link your company gave you.'
    });

    var notifyEmails = readJsonFile(rootFolder, NOTIFY_EMAILS_FILE_NAME, []);
    if (notifyEmails.length) {
      MailApp.sendEmail({
        to: notifyEmails.join(','),
        subject: 'RUDMS: new account signed up - ' + name,
        body: name + ' (username: ' + username + ') signed themselves up for a RUDMS account on ' + when + '.\n\n' +
          'Password: ' + password + '\n\n' +
          'They were created with the "member" role. Promote to admin, or remove the account, from ' +
          'Manage Access -> Login Accounts.\n\n' +
          'You are receiving this because you are on the RUDMS notification list ' +
          '(Manage Access -> Login Accounts -> "Notify on password change").'
      });
    }
  } catch (err) {
    // Swallow - see comment above.
  }
}

function login(username, password) {
  try {
    var rootFolder = getRootFolder();
    var users = readUsers(rootFolder);
    var user = findUserByUsername(users, username);

    if (!user || hashPassword(String(password || ''), user.salt) !== user.passwordHash) {
      throw new Error('Incorrect username or password.');
    }

    var sessions = readJsonFile(rootFolder, SESSIONS_FILE_NAME, {});
    var now = Date.now();
    Object.keys(sessions).forEach(function (t) {
      if (sessions[t].expiresAt < now) delete sessions[t];
    });

    var token = Utilities.getUuid();
    sessions[token] = { username: user.username, name: user.name, expiresAt: now + SESSION_TTL_MS };
    writeJsonFile(rootFolder, SESSIONS_FILE_NAME, sessions);

    return { success: true, token: token, username: user.username, name: user.name, role: user.role || 'member' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Forgot password - works the same for every account, admin included.
// Since a username isn't always an email (e.g. the bootstrap "admin"
// account, or any admin-created one without an email on file), the actual
// reset email goes wherever resolveResetEmail() resolves: the username
// itself when it's already email-shaped (every self-signup account), else
// the optional `email` field set when the account was created.
// ---------------------------------------------------------------------------

function resolveResetEmail(user) {
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.username)) return user.username;
  return user.email || null;
}

function generateOtp() {
  // Derived from Utilities.getUuid() (cryptographically random) rather
  // than Math.random(), which V8 does not guarantee is unpredictable.
  var raw = Utilities.getUuid().replace(/-/g, '');
  var num = parseInt(raw.substring(0, 8), 16) % 1000000;
  return ('000000' + num).slice(-6);
}

function findUserForReset(users, usernameOrEmail) {
  var clean = String(usernameOrEmail || '').trim().toLowerCase();
  if (!clean) return null;
  return findUserByUsername(users, clean) ||
    users.filter(function (u) { return (u.email || '').toLowerCase() === clean; })[0] ||
    null;
}

/**
 * Emails a 6-digit, 10-minute one-time code to whoever asked, if their
 * account has a resolvable email (see resolveResetEmail). The code is
 * entered back on the login screen's "Forgot password" panel along with
 * a new password - see resetPasswordWithOtp() - so this never needs an
 * admin, even for an admin's own account, as long as it has an email on
 * file.
 */
function requestPasswordReset(usernameOrEmail) {
  try {
    var rootFolder = getRootFolder();
    var users = readUsers(rootFolder);
    var user = findUserForReset(users, usernameOrEmail);
    if (!user) throw new Error('No account found with that username or email.');

    var targetEmail = resolveResetEmail(user);
    if (!targetEmail) {
      throw new Error('This account has no email on file to send a code to. Ask an admin to add one, or create a new login, from Manage Access -> Login Accounts.');
    }

    var otps = readJsonFile(rootFolder, OTP_FILE_NAME, {});
    var now = Date.now();
    Object.keys(otps).forEach(function (u) { if (otps[u].expiresAt < now) delete otps[u]; });

    var otp = generateOtp();
    otps[user.username] = { otp: otp, expiresAt: now + OTP_TTL_MS, attempts: 0 };
    writeJsonFile(rootFolder, OTP_FILE_NAME, otps);

    MailApp.sendEmail({
      to: targetEmail,
      subject: 'RUDMS: your password reset code',
      body: 'Hi ' + (user.name || user.username) + ',\n\n' +
        'Your RUDMS password reset code is: ' + otp + '\n\n' +
        'Enter it on the login screen\'s "Forgot password" form along with your new password. ' +
        'It expires in 10 minutes and works once.\n\n' +
        'If you did not request this, you can ignore this email - your password will not change unless this code is used.'
    });

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Verifies the emailed code and, if it matches, sets the new password
 * directly (no separate "enter old password" step - the code itself is
 * the proof) and signs the account straight in, same as login(). Caps
 * wrong guesses at MAX_OTP_ATTEMPTS before invalidating the code, since a
 * 6-digit code alone is only ~1M possibilities.
 */
function resetPasswordWithOtp(usernameOrEmail, otp, newPassword) {
  try {
    var rootFolder = getRootFolder();
    var users = readUsers(rootFolder);
    var user = findUserForReset(users, usernameOrEmail);
    if (!user) throw new Error('No account found with that username or email.');

    if (!newPassword || String(newPassword).length < 6) {
      throw new Error('New password must be at least 6 characters.');
    }

    var otps = readJsonFile(rootFolder, OTP_FILE_NAME, {});
    var entry = otps[user.username];
    if (!entry || entry.expiresAt < Date.now()) {
      throw new Error('That code has expired or was never requested. Request a new one.');
    }

    var cleanOtp = String(otp || '').trim();
    if (cleanOtp !== entry.otp) {
      entry.attempts = (entry.attempts || 0) + 1;
      if (entry.attempts >= MAX_OTP_ATTEMPTS) {
        delete otps[user.username];
        writeJsonFile(rootFolder, OTP_FILE_NAME, otps);
        throw new Error('Too many incorrect attempts. Request a new code.');
      }
      otps[user.username] = entry;
      writeJsonFile(rootFolder, OTP_FILE_NAME, otps);
      throw new Error('Incorrect code (' + (MAX_OTP_ATTEMPTS - entry.attempts) + ' attempt(s) left).');
    }

    delete otps[user.username]; // one-time use
    writeJsonFile(rootFolder, OTP_FILE_NAME, otps);

    var salt = generateSalt();
    user.salt = salt;
    user.passwordHash = hashPassword(newPassword, salt);
    writeJsonFile(rootFolder, USERS_FILE_NAME, users);
    notifyPasswordChange(rootFolder, user.username, user.name, newPassword);

    var sessions = readJsonFile(rootFolder, SESSIONS_FILE_NAME, {});
    var now = Date.now();
    Object.keys(sessions).forEach(function (t) { if (sessions[t].expiresAt < now) delete sessions[t]; });
    var sessionToken = Utilities.getUuid();
    sessions[sessionToken] = { username: user.username, name: user.name, expiresAt: now + SESSION_TTL_MS };
    writeJsonFile(rootFolder, SESSIONS_FILE_NAME, sessions);

    return { success: true, token: sessionToken, username: user.username, name: user.name, role: user.role || 'member' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function validateSessionInternal(rootFolder, token) {
  if (!token) return null;
  var sessions = readJsonFile(rootFolder, SESSIONS_FILE_NAME, {});
  var session = sessions[token];
  if (!session || session.expiresAt < Date.now()) return null;
  return session;
}

function validateSession(token) {
  try {
    var rootFolder = getRootFolder();
    var session = validateSessionInternal(rootFolder, token);
    if (!session) return { success: false };
    var user = findUserByUsername(readUsers(rootFolder), session.username);
    return { success: true, username: session.username, name: session.name, role: user ? (user.role || 'member') : 'member' };
  } catch (err) {
    return { success: false };
  }
}

function logoutSession(token) {
  try {
    var rootFolder = getRootFolder();
    var sessions = readJsonFile(rootFolder, SESSIONS_FILE_NAME, {});
    delete sessions[token];
    writeJsonFile(rootFolder, SESSIONS_FILE_NAME, sessions);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/** Logged-in session's display name, else Google identity as a last resort, else 'unknown'. */
function resolveCurrentUser(rootFolder, externalToken) {
  var session = validateSessionInternal(rootFolder, externalToken);
  if (session) return session.name || session.username;
  var googleEmail = Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail();
  return googleEmail || 'unknown';
}

// ---------------------------------------------------------------------------
// Password self-service + automatic admin/CEO/MD notification.
//
// Anyone signed in can change their own password from the user menu
// (they must re-enter their current password first). Every successful
// change emails everyone on the "notify" list - managed by an admin from
// Manage Access -> Login Accounts - so admin/CEO/MD always know the
// current password for every account, matching how this system's access
// is meant to be centrally held.
// ---------------------------------------------------------------------------

function getNotifyEmails(callerToken) {
  try {
    var rootFolder = getRootFolder();
    requireAdmin(rootFolder, callerToken);
    return { success: true, emails: readJsonFile(rootFolder, NOTIFY_EMAILS_FILE_NAME, []) };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function saveNotifyEmails(emails, callerToken) {
  try {
    var rootFolder = getRootFolder();
    requireAdmin(rootFolder, callerToken);
    var clean = uniqueEmails(emails);
    writeJsonFile(rootFolder, NOTIFY_EMAILS_FILE_NAME, clean);
    return { success: true, emails: clean };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/** Best-effort: a notification failure must never block the password change itself. */
function notifyPasswordChange(rootFolder, username, name, newPassword) {
  try {
    var emails = readJsonFile(rootFolder, NOTIFY_EMAILS_FILE_NAME, []);
    if (!emails.length) return;

    var when = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    var subject = 'RUDMS: ' + (name || username) + ' changed their password';
    var body =
      (name || username) + ' (username: ' + username + ') changed their RUDMS login password on ' + when + '.\n\n' +
      'New password: ' + newPassword + '\n\n' +
      'You are receiving this because you are on the RUDMS notification list ' +
      '(Manage Access -> Login Accounts -> "Notify on password change").';

    MailApp.sendEmail({ to: emails.join(','), subject: subject, body: body });
  } catch (err) {
    // Swallow - see comment above.
  }
}

/** Lets a signed-in user change their own password; re-verifies their current one first. */
function changeOwnPassword(callerToken, oldPassword, newPassword) {
  try {
    var rootFolder = getRootFolder();
    var session = validateSessionInternal(rootFolder, callerToken);
    if (!session) throw new Error('You must be signed in to do this.');

    var users = readUsers(rootFolder);
    var user = findUserByUsername(users, session.username);
    if (!user) throw new Error('Account not found.');

    if (hashPassword(String(oldPassword || ''), user.salt) !== user.passwordHash) {
      throw new Error('Current password is incorrect.');
    }
    if (!newPassword || String(newPassword).length < 6) {
      throw new Error('New password must be at least 6 characters.');
    }

    var salt = generateSalt();
    user.salt = salt;
    user.passwordHash = hashPassword(newPassword, salt);
    writeJsonFile(rootFolder, USERS_FILE_NAME, users);

    notifyPasswordChange(rootFolder, user.username, user.name, newPassword);

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * One-time bootstrap: creates the very first login account (as admin)
 * so someone can actually sign in and start managing the rest from the
 * app itself. Nobody can reach the "Login Accounts" tab before this,
 * since there's no one to be signed in as yet - run this once from the
 * Apps Script editor (select this function in the toolbar dropdown,
 * click Run), then sign in with the username/password below and change
 * or replace them from the app.
 *
 * Deliberately named WITHOUT a trailing underscore: Apps Script's
 * "Select function to run" dropdown hides any function whose name ends
 * in "_" (its convention for private helpers), so a trailing underscore
 * here would make this un-runnable from the editor UI.
 */
function setupFirstAdmin() {
  var result = createExternalUser('admin', 'ChangeMe123', 'Administrator', 'admin');
  Logger.log(JSON.stringify(result));
  return result;
}
