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
var DELETE_REQUESTS_FILE_NAME = 'RUDMS_DeleteRequests.json';
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

/**
 * viewers/editors/downloaders are RUDMS login identities (username or the
 * account's on-file email - see matchesGrantList), NOT Google Drive
 * sharing - this app does not use Drive-level ACLs at all; every access
 * check is enforced in RUDMS's own server code against these lists plus
 * the account's role (see normalizeRole/canXFileMeta below).
 *   - editors: admin-granted "can edit/rename/delete this specific file"
 *     list, on top of whoever uploaded it (who already gets that for free
 *     if their role is 'editor' or above - see canEditFileMeta).
 *   - downloaders: admin-granted "can download this specific file" list -
 *     download is otherwise admin-only, regardless of role.
 *   - viewers: OPTIONAL view restriction. Empty (the default) means every
 *     signed-in account can view/preview the file, same as always. Only
 *     when an admin actually sets this list does viewing become
 *     restricted to: the uploader, this list, and the editors/downloaders
 *     lists (all of whom can obviously already see a file they can
 *     edit/download).
 */
function buildFileMeta(viewerEmails, editorEmails, downloaderEmails, uploadedBy, uploadedByUsername) {
  return JSON.stringify({
    viewers: viewerEmails.join(', '),
    editors: editorEmails.join(', '),
    downloaders: downloaderEmails.join(', '),
    uploadedBy: uploadedBy,
    uploadedByUsername: uploadedByUsername || ''
  });
}

function parseFileMeta(description) {
  try {
    var meta = JSON.parse(description || '{}');
    return {
      viewers: meta.viewers || '',
      editors: meta.editors || '',
      downloaders: meta.downloaders || '',
      uploadedBy: meta.uploadedBy || '',
      uploadedByUsername: meta.uploadedByUsername || ''
    };
  } catch (err) {
    return { viewers: '', editors: '', downloaders: '', uploadedBy: '', uploadedByUsername: '' };
  }
}

/** True if `user` ({username, email}) appears (by username or email) in a comma-separated grant list string. */
function matchesGrantList(grantListStr, user) {
  var list = String(grantListStr || '').split(',').map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
  if (!list.length) return false;
  var uname = (user.username || '').toLowerCase();
  var uemail = (user.email || '').toLowerCase();
  return list.indexOf(uname) !== -1 || (!!uemail && list.indexOf(uemail) !== -1);
}

function isFileOwner(meta, user) {
  return !!meta.uploadedByUsername && meta.uploadedByUsername === (user.username || '').toLowerCase();
}

/** Can this account even see/preview the file? Open to everyone unless an admin set a restriction (meta.viewers non-empty). */
function canViewFileMeta(meta, user, role) {
  if (role === 'admin') return true;
  if (!meta.viewers) return true;
  return isFileOwner(meta, user) || matchesGrantList(meta.viewers, user) || matchesGrantList(meta.editors, user) || matchesGrantList(meta.downloaders, user);
}

/** Can this account edit/delete the file directly, no approval needed? Admin always; 'editor' role on their own upload or an admin-granted file; 'viewer' never (see canRequestDeleteMeta instead). */
function canEditFileMeta(meta, user, role) {
  if (role === 'admin') return true;
  if (role === 'editor') return isFileOwner(meta, user) || matchesGrantList(meta.editors, user);
  return false;
}

/** Renaming is the one action a 'viewer' gets on their own upload without approval - everything else routes through canEditFileMeta. */
function canRenameFileMeta(meta, user, role) {
  if (canEditFileMeta(meta, user, role)) return true;
  return role === 'viewer' && isFileOwner(meta, user);
}

/** Download stays admin-only by default; an admin can grant it per-file to anyone regardless of role. */
function canDownloadFileMeta(meta, user, role) {
  if (role === 'admin') return true;
  return matchesGrantList(meta.downloaders, user);
}

/** A 'viewer' can't delete directly, but can ask an editor/admin to - only for their own upload, and only when they don't already have a direct grant (which would mean deleteFile just works). */
function canRequestDeleteMeta(meta, user, role) {
  return role === 'viewer' && isFileOwner(meta, user);
}

function fileCapabilities(meta, user, role) {
  return {
    canEdit: canEditFileMeta(meta, user, role),
    canRename: canRenameFileMeta(meta, user, role),
    canDownload: canDownloadFileMeta(meta, user, role),
    canRequestDelete: canRequestDeleteMeta(meta, user, role)
  };
}

function fileToRecord(file, categoryName, user, role) {
  var meta = parseFileMeta(file.getDescription());
  var name = file.getName();
  var record = {
    fileId: file.getId(),
    fileName: name,
    category: categoryName,
    driveLink: file.getUrl(),
    fileType: (name.split('.').pop() || '').toLowerCase(),
    viewers: meta.viewers,
    editors: meta.editors,
    downloaders: meta.downloaders,
    uploadDate: file.getDateCreated().toISOString(),
    uploadedBy: meta.uploadedBy,
    uploadedByUsername: meta.uploadedByUsername,
    size: file.getSize()
  };
  if (user) {
    var caps = fileCapabilities(meta, user, role);
    record.canEdit = caps.canEdit;
    record.canRename = caps.canRename;
    record.canDownload = caps.canDownload;
    record.canRequestDelete = caps.canRequestDelete;
  }
  return record;
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
        currentUsername: session.username,
        role: user ? normalizeRole(user.role) : 'viewer',
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
 *
 * Requires a valid session (requireLogin) and filters out any file the
 * caller isn't allowed to even see (canViewFileMeta) - the normal case is
 * everyone sees everything, since per-file view restriction is opt-in by
 * an admin (see buildFileMeta's comment).
 */
var FILES_CACHE_KEY = 'RUDMS_RAW_FILES_V1';
var FILES_CACHE_TTL_SEC = 300; // 5 min safety net - every write below calls invalidateFilesCache() explicitly anyway, so this TTL rarely matters

/**
 * The expensive part of getAllFiles() - walking every category folder via
 * DriveApp and reading each file's own description - cached as plain
 * (capability-free) records for FILES_CACHE_TTL_SEC, since that walk's
 * cost scales with how many files exist, not with who's asking. Every
 * write that can change a file's existence or metadata
 * (upload/delete/rename/permission changes) calls invalidateFilesCache()
 * so the next load always sees it - the TTL is just a safety net, not the
 * real freshness mechanism. A cache write failure (e.g. the file list is
 * too big for a single 100KB CacheService entry) is harmless: it just
 * means this call, and the next one, re-walks Drive instead of hitting
 * the cache.
 */
function getRawFileList(rootFolder) {
  var cache = CacheService.getScriptCache();
  try {
    var cached = cache.get(FILES_CACHE_KEY);
    if (cached) return JSON.parse(cached);
  } catch (err) {
    // Corrupt/unreadable cache entry - fall through and rebuild.
  }

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
    if (!topFolder.isTrashed()) walkFolder(topFolder, topFolder.getName());
  }

  try {
    cache.put(FILES_CACHE_KEY, JSON.stringify(files), FILES_CACHE_TTL_SEC);
  } catch (err) {
    // Too large for one cache entry, or some other cache hiccup - fine, see comment above.
  }
  return files;
}

function invalidateFilesCache() {
  try { CacheService.getScriptCache().remove(FILES_CACHE_KEY); } catch (err) {}
}

function getAllFiles(callerToken) {
  try {
    var rootFolder = getRootFolder();
    var caller = requireUserAndRole(rootFolder, callerToken);
    var raw = getRawFileList(rootFolder);
    var files = [];

    raw.forEach(function (r) {
      if (!canViewFileMeta(r, caller, caller.role)) return;
      var caps = fileCapabilities(r, caller, caller.role);
      files.push({
        fileId: r.fileId, fileName: r.fileName, category: r.category, driveLink: r.driveLink,
        fileType: r.fileType, viewers: r.viewers, editors: r.editors, downloaders: r.downloaders,
        uploadDate: r.uploadDate, uploadedBy: r.uploadedBy, uploadedByUsername: r.uploadedByUsername,
        size: r.size, canEdit: caps.canEdit, canRename: caps.canRename,
        canDownload: caps.canDownload, canRequestDelete: caps.canRequestDelete
      });
    });

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
function createFolder(path, callerToken) {
  try {
    var rootFolder = getRootFolder();
    requireLogin(rootFolder, callerToken); // every role can create folders, same as upload
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
 *   viewerEmails: string[], editorEmails: string[], downloaderEmails: string[], externalToken
 * }
 * Any signed-in role (viewer/editor/admin) can upload - see normalizeRole.
 */
function uploadFile(payload) {
  try {
    if (!payload || !payload.base64Data || !payload.fileName) {
      throw new Error('Missing file data.');
    }

    var rootFolder = getRootFolder();
    requireLogin(rootFolder, payload.externalToken);
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
    // Files created via DriveApp are already private to the owner (the
    // deploying/admin Google account) by default - that's also exactly
    // who RUDMS treats as the file's real Drive owner regardless of which
    // RUDMS login uploaded it (see normalizeRole's comment on 'admin').

    var viewerEmails = uniqueGrantIdentities(payload.viewerEmails);
    var editorEmails = uniqueGrantIdentities(payload.editorEmails);
    var downloaderEmails = uniqueGrantIdentities(payload.downloaderEmails);

    var uploader = resolveCurrentUserFull(rootFolder, payload.externalToken);
    file.setDescription(buildFileMeta(viewerEmails, editorEmails, downloaderEmails, uploader.name, uploader.username));

    invalidateFilesCache();
    var caller = requireUserAndRole(rootFolder, payload.externalToken);
    return {
      success: true,
      file: fileToRecord(file, resolved.path, caller, caller.role)
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

/**
 * Same dedupe-and-clean idea as uniqueEmails(), but for a per-file/folder
 * grant list (viewers/editors/downloaders - see buildFileMeta's comment) -
 * those identify a RUDMS login, not necessarily an email, so this accepts
 * either a RUDMS username (same shape createExternalUser requires) or an
 * email address, and drops anything that's neither.
 */
function uniqueGrantIdentities(list) {
  if (!list) return [];
  var seen = {};
  var out = [];
  list.forEach(function (raw) {
    var identity = String(raw).trim().toLowerCase();
    var looksValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identity) || /^[a-z0-9._-]{3,40}$/.test(identity);
    if (identity && looksValid && !seen[identity]) {
      seen[identity] = true;
      out.push(identity);
    }
  });
  return out;
}

/** Admin-only: sets the per-file override lists (editors/downloaders/view-restriction) - see buildFileMeta's comment for what each means. */
function updateFilePermissions(fileId, viewerEmails, editorEmails, downloaderEmails, callerToken) {
  try {
    var rootFolder = getRootFolder();
    requireAdmin(rootFolder, callerToken);
    var file = DriveApp.getFileById(fileId);

    var newViewers = uniqueGrantIdentities(viewerEmails);
    var newEditors = uniqueGrantIdentities(editorEmails);
    var newDownloaders = uniqueGrantIdentities(downloaderEmails);

    var existingMeta = parseFileMeta(file.getDescription());
    file.setDescription(buildFileMeta(newViewers, newEditors, newDownloaders, existingMeta.uploadedBy, existingMeta.uploadedByUsername));

    invalidateFilesCache();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Admin always allowed. 'editor' allowed, no approval, only on their own
 * upload or a file an admin granted them (canEditFileMeta). 'viewer' is
 * never allowed here even on their own upload - they must go through
 * requestFileDeletion()/resolveDeleteRequest() instead.
 */
function deleteFile(fileId, callerToken) {
  try {
    var rootFolder = getRootFolder();
    var caller = requireUserAndRole(rootFolder, callerToken);
    var file = DriveApp.getFileById(fileId);
    var meta = parseFileMeta(file.getDescription());

    if (!canEditFileMeta(meta, caller, caller.role)) {
      throw new Error(caller.role === 'viewer'
        ? 'Viewers can\'t delete directly - use "Request Delete Approval" instead.'
        : 'You can only delete files you uploaded, or ones an admin specifically granted you.');
    }

    file.setTrashed(true);
    clearDeleteRequest(rootFolder, fileId);
    invalidateFilesCache();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Renaming is the one action a 'viewer' gets on their own upload without
 * approval (canRenameFileMeta) - everyone else with edit rights can
 * rename too. Blocks an exact-name clash with another file already in the
 * same folder (same rule uploadFile uses for new uploads).
 */
function renameFile(fileId, newName, callerToken) {
  try {
    var rootFolder = getRootFolder();
    var caller = requireUserAndRole(rootFolder, callerToken);
    var file = DriveApp.getFileById(fileId);
    var meta = parseFileMeta(file.getDescription());

    if (!canRenameFileMeta(meta, caller, caller.role)) {
      throw new Error('You don\'t have permission to rename this file.');
    }

    var cleanName = String(newName || '').trim();
    if (!cleanName) throw new Error('File name cannot be empty.');

    var parents = file.getParents();
    if (parents.hasNext()) {
      var parent = parents.next();
      var clash = findFileInFolderByName(parent, cleanName);
      if (clash && clash.getId() !== file.getId()) {
        throw new Error('"' + cleanName + '" already exists in this folder.');
      }
    }

    file.setName(cleanName);
    invalidateFilesCache();
    return { success: true, file: fileToRecord(file, '', caller, caller.role) };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Delete requests - a 'viewer' can't delete their own upload directly, only
// ask an editor/admin to approve it (see normalizeRole's comment on
// 'viewer'/'editor'). Stored as one JSON object keyed by fileId, so a
// second request for the same file just refreshes the first rather than
// stacking duplicates.
// ---------------------------------------------------------------------------

function clearDeleteRequest(rootFolder, fileId) {
  var requests = readJsonFile(rootFolder, DELETE_REQUESTS_FILE_NAME, {});
  if (requests[fileId]) {
    delete requests[fileId];
    writeJsonFile(rootFolder, DELETE_REQUESTS_FILE_NAME, requests);
  }
}

/** viewer-only, and only for a file they themselves uploaded - see canRequestDeleteMeta. */
function requestFileDeletion(fileId, callerToken) {
  try {
    var rootFolder = getRootFolder();
    var caller = requireUserAndRole(rootFolder, callerToken);
    var file = DriveApp.getFileById(fileId);
    var meta = parseFileMeta(file.getDescription());

    if (!canRequestDeleteMeta(meta, caller, caller.role)) {
      throw new Error('You can only request deletion of files you uploaded yourself.');
    }

    var requests = readJsonFile(rootFolder, DELETE_REQUESTS_FILE_NAME, {});
    requests[fileId] = {
      fileId: fileId,
      fileName: file.getName(),
      requestedByUsername: caller.username,
      requestedByName: resolveCurrentUserFull(rootFolder, callerToken).name,
      requestedAt: new Date().toISOString()
    };
    writeJsonFile(rootFolder, DELETE_REQUESTS_FILE_NAME, requests);

    notifyDeleteRequest(rootFolder, requests[fileId]);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/** Best-effort: emails every current editor/admin with an email on file. A notification failure must never block the request itself. */
function notifyDeleteRequest(rootFolder, request) {
  try {
    var reviewers = readUsers(rootFolder).filter(function (u) {
      var role = normalizeRole(u.role);
      return role === 'admin' || role === 'editor';
    });
    var emails = reviewers.map(function (u) { return resolveResetEmail(u); }).filter(Boolean);
    if (!emails.length) return;

    MailApp.sendEmail({
      to: emails.join(','),
      subject: 'RUDMS: delete approval requested - ' + request.fileName,
      body: request.requestedByName + ' wants to delete "' + request.fileName + '" (which they uploaded) and is asking ' +
        'for an editor/admin\'s approval.\n\n' +
        'Review it from Manage Access -> Delete Requests in RUDMS.'
    });
  } catch (err) {
    // Swallow - see comment above.
  }
}

/** editor/admin only - the review queue is a role-wide trust, not tied to any specific file's own edit grants. */
function listDeleteRequests(callerToken) {
  try {
    var rootFolder = getRootFolder();
    requireEditorOrAdmin(rootFolder, callerToken);
    var requests = readJsonFile(rootFolder, DELETE_REQUESTS_FILE_NAME, {});

    // Drop any request whose file no longer exists (already deleted/moved some other way).
    var list = [];
    var changed = false;
    Object.keys(requests).forEach(function (fileId) {
      try {
        var file = DriveApp.getFileById(fileId);
        if (file.isTrashed()) throw new Error('trashed');
        list.push(requests[fileId]);
      } catch (e) {
        delete requests[fileId];
        changed = true;
      }
    });
    if (changed) writeJsonFile(rootFolder, DELETE_REQUESTS_FILE_NAME, requests);

    list.sort(function (a, b) { return new Date(a.requestedAt) - new Date(b.requestedAt); });
    return { success: true, requests: list };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/** editor/admin only. approve=true deletes the file right away; approve=false just dismisses the request. Either way, best-effort notifies whoever asked. */
function resolveDeleteRequest(fileId, approve, callerToken) {
  try {
    var rootFolder = getRootFolder();
    requireEditorOrAdmin(rootFolder, callerToken);

    var requests = readJsonFile(rootFolder, DELETE_REQUESTS_FILE_NAME, {});
    var request = requests[fileId];
    if (!request) throw new Error('That request no longer exists.');

    if (approve) {
      DriveApp.getFileById(fileId).setTrashed(true);
      invalidateFilesCache();
    }
    delete requests[fileId];
    writeJsonFile(rootFolder, DELETE_REQUESTS_FILE_NAME, requests);

    notifyDeleteRequestResolved(rootFolder, request, approve);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/** Best-effort: lets the requester know their delete request was approved/rejected. A notification failure must never block the resolution itself. */
function notifyDeleteRequestResolved(rootFolder, request, approved) {
  try {
    var user = findUserByUsername(readUsers(rootFolder), request.requestedByUsername);
    var targetEmail = user ? resolveResetEmail(user) : null;
    if (!targetEmail) return;

    MailApp.sendEmail({
      to: targetEmail,
      subject: 'RUDMS: your delete request was ' + (approved ? 'approved' : 'rejected'),
      body: 'Your request to delete "' + request.fileName + '" was ' + (approved ? 'approved - the file has been deleted.' : 'rejected - the file is still there.')
    });
  } catch (err) {
    // Swallow - see comment above.
  }
}

// ---------------------------------------------------------------------------
// Folder-level (category) access management
// ---------------------------------------------------------------------------

/**
 * Admin-only. Returns each folder's own default grant lists (every folder
 * at any depth, identified by its full '/'-separated path), read the same
 * way a file's are - JSON in the folder's own Drive description - so the
 * "Manage Access -> By Folder" panel can show what's already set.
 */
function getCategoryAccessOverview(callerToken) {
  try {
    var rootFolder = getRootFolder();
    requireAdmin(rootFolder, callerToken);
    var paths = flattenFolderTree(listFolderTree(rootFolder, ''), []);
    var result = paths.map(function (path) {
      var folder = getOrCreateFolderByPath(rootFolder, path).folder;
      var meta = parseFileMeta(folder.getDescription());
      return { name: path, viewers: meta.viewers, editors: meta.editors, downloaders: meta.downloaders };
    });
    return { success: true, categories: result };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Admin-only. Sets the target folder's (identified by its full
 * '/'-separated path) own default grant lists, stored as JSON in the
 * folder's Drive description - same shape as a file's own meta, just
 * without uploadedBy. When applyToExistingFiles is true, the same lists
 * are also additively stamped onto every file directly inside that folder
 * (union with whatever that file already had).
 */
function updateCategoryAccess(categoryPath, viewerEmails, editorEmails, downloaderEmails, applyToExistingFiles, callerToken) {
  try {
    var rootFolder = getRootFolder();
    requireAdmin(rootFolder, callerToken);
    var folder = getOrCreateFolderByPath(rootFolder, categoryPath).folder;

    var newViewers = uniqueGrantIdentities(viewerEmails);
    var newEditors = uniqueGrantIdentities(editorEmails);
    var newDownloaders = uniqueGrantIdentities(downloaderEmails);
    folder.setDescription(buildFileMeta(newViewers, newEditors, newDownloaders, '', ''));

    if (applyToExistingFiles) {
      var iter = folder.getFiles();
      while (iter.hasNext()) {
        var file = iter.next();
        var existingMeta = parseFileMeta(file.getDescription());
        var mergedViewers = uniqueGrantIdentities(existingMeta.viewers.split(',').concat(newViewers));
        var mergedEditors = uniqueGrantIdentities(existingMeta.editors.split(',').concat(newEditors));
        var mergedDownloaders = uniqueGrantIdentities(existingMeta.downloaders.split(',').concat(newDownloaders));
        file.setDescription(buildFileMeta(mergedViewers, mergedEditors, mergedDownloaders, existingMeta.uploadedBy, existingMeta.uploadedByUsername));
      }
      invalidateFilesCache();
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// File content retrieval (for in-browser 3D CAD preview)
// ---------------------------------------------------------------------------

/**
 * forDownload=true is the dedicated "Download" action (saves the file to
 * the visitor's device) - needs canDownloadFileMeta (admin, or an
 * admin-granted per-file exception). forDownload=false/omitted is
 * in-browser preview (PDF.js canvas, image tag, etc.) - needs
 * canViewFileMeta, which is open to everyone unless an admin restricted
 * that specific file.
 *
 * Honest limitation: once the browser has rendered a preview, a
 * technically determined person could still extract the bytes from it
 * (e.g. browser dev tools) - there's no way to show a file in a web page
 * without sending it to that page. This blocks the actual Download
 * button/action for everyone without download rights, which is the
 * real-world bar that matters for ordinary staff.
 */
function getFileContentForPreview(fileId, callerToken, forDownload) {
  try {
    var rootFolder = getRootFolder();
    var caller = requireUserAndRole(rootFolder, callerToken);
    var file = DriveApp.getFileById(fileId);
    var meta = parseFileMeta(file.getDescription());

    if (forDownload) {
      if (!canDownloadFileMeta(meta, caller, caller.role)) throw new Error('You don\'t have permission to download this file.');
    } else {
      if (!canViewFileMeta(meta, caller, caller.role)) throw new Error('You don\'t have access to view this file.');
    }

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
// Roles (full detail on normalizeRole() above): 'admin' - full control,
// including Login Accounts and per-file overrides; 'editor' - view/upload
// everywhere, direct rename/delete only on their own uploads or files an
// admin granted them, plus reviewing viewers' delete requests; 'viewer' -
// view/upload everywhere, rename own uploads, but needs an editor/admin's
// approval to delete one. The very first account (when none exist yet)
// can be created without an admin session - that's the bootstrap step,
// meant to be run once from the Apps Script editor (Run ->
// setupFirstAdmin) since no one can log in yet at that point.
//
// Role AND per-file grants are enforced SERVER-SIDE on every function
// that matters (requireAdmin/requireLogin/requireEditorOrAdmin plus the
// canXFileMeta family above, called at the top of uploadFile, deleteFile,
// renameFile, createFolder, updateFilePermissions, updateCategoryAccess,
// getFileContentForPreview, requestFileDeletion, resolveDeleteRequest) -
// not just by hiding buttons in the client UI. A viewer account's
// google.script.run.deleteFile(...) call on someone else's upload
// genuinely fails server-side even if someone bypasses the UI, e.g. from
// the browser console.
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
  return { username: u.username, name: u.name, role: normalizeRole(u.role), email: u.email || '', createdAt: u.createdAt };
}

/**
 * Three-tier roles - see canEditFileMeta/canViewFileMeta/canDownloadFileMeta/
 * canRequestDeleteMeta above for exactly what each can do per file:
 *  - 'admin'  full control of every file (upload, view, download,
 *             rename/edit, delete, manage access) plus Login Accounts and
 *             per-file overrides. Files always belong to the admin/
 *             deploying Google account's Drive regardless of who
 *             uploaded them - that's just how this single shared Drive
 *             folder has always worked, uploader identity is purely a
 *             RUDMS-level label stamped in the file's own metadata.
 *  - 'editor' can view every file and upload new ones. Can rename/delete
 *             a file directly, without approval, ONLY if they uploaded it
 *             themselves or an admin specifically granted them that file.
 *             Can also approve/reject a viewer's delete request for ANY
 *             file (a senior-level trust, separate from their own
 *             per-file edit grants). No download unless admin-granted.
 *  - 'viewer' can view every file and upload new ones. Can rename (but
 *             not delete) their own uploads directly. To delete their own
 *             upload, must request approval from an editor or admin (see
 *             requestFileDeletion/resolveDeleteRequest) - they have no
 *             access at all, not even view-only exceptions, on files they
 *             didn't upload and weren't admin-granted. No download unless
 *             admin-granted.
 * Old accounts saved before this three-tier system existed have role
 * 'member' or 'uploader' on disk (from earlier role schemes) - both
 * normalized here to 'viewer' (view + upload, same as before) so nobody
 * already using the app silently loses access.
 */
function normalizeRole(role) {
  if (role === 'admin') return 'admin';
  if (role === 'editor') return 'editor';
  return 'viewer';
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
  if (!user || normalizeRole(user.role) !== 'admin') throw new Error('Only an admin can do this.');
}

/** Throws unless callerToken is a valid session (any role) - used for actions every signed-in account may do, like previewing a file. */
function requireLogin(rootFolder, callerToken) {
  var session = validateSessionInternal(rootFolder, callerToken);
  if (!session) throw new Error('You must be signed in to do this.');
  return session;
}

/** Throws unless callerToken belongs to an editor or admin account - used for the delete-request inbox (review authority is an editor-wide trust, not tied to any specific file's own edit grants). */
function requireEditorOrAdmin(rootFolder, callerToken) {
  var session = requireLogin(rootFolder, callerToken);
  var user = findUserByUsername(readUsers(rootFolder), session.username);
  var role = user ? normalizeRole(user.role) : 'viewer';
  if (role !== 'admin' && role !== 'editor') throw new Error('Only an editor or admin can do this.');
}

/** Resolves callerToken to {username, email, role} for the per-file permission checks above - throws if not signed in. */
function requireUserAndRole(rootFolder, callerToken) {
  var session = requireLogin(rootFolder, callerToken);
  var user = findUserByUsername(readUsers(rootFolder), session.username);
  var role = user ? normalizeRole(user.role) : 'viewer';
  return { username: session.username, email: (user && user.email) || '', role: role };
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
      role: isBootstrap ? 'admin' : normalizeRole(role),
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
    var cleanRole = normalizeRole(newRole);

    var users = readUsers(rootFolder);
    var user = findUserByUsername(users, cleanUsername);
    if (!user) throw new Error('Account not found.');

    if (normalizeRole(user.role) === 'admin' && cleanRole !== 'admin' && countAdmins(users) <= 1) {
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
 * always their email address, and the role is always 'viewer' (view +
 * upload, never 'admin'/'editor' - only an existing admin can promote
 * someone, from Login Accounts). Activates immediately and signs the new
 * account straight in, same as login() - there is no admin-approval step.
 *
 * SECURITY NOTE: turning on self-signup means literally anyone who has
 * this URL can get a "viewer" account (view + upload their own files, no
 * download, no edit of anything but their own uploads' name) by creating
 * one themselves - enforced server-side by role and per-file grants (see
 * the canXFileMeta family and requireAdmin/requireLogin above), so a
 * self-signed-up account genuinely cannot download or touch anyone else's
 * file. Restrict who can reach the URL itself (e.g. an internal network,
 * or just not publicizing it) if even that is a concern.
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
      role: 'viewer',
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

    return { success: true, token: token, username: cleanEmail, name: cleanName, role: 'viewer' };
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
          'They were created with the "viewer" role (view + upload, rename own uploads, no download/edit of anything else). Promote or change their role, or remove the account, from ' +
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

    return { success: true, token: token, username: user.username, name: user.name, role: normalizeRole(user.role) };
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

    return { success: true, token: sessionToken, username: user.username, name: user.name, role: normalizeRole(user.role) };
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
    return { success: true, username: session.username, name: session.name, role: user ? normalizeRole(user.role) : 'viewer' };
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

/**
 * Logged-in session's {name, username} for stamping on an uploaded file -
 * username is the stable identity canEditFileMeta/canRenameFileMeta/
 * canRequestDeleteMeta use to recognize "their own upload" later, name is
 * just for display. Falls back to Google identity (no stable username) if
 * somehow called without a valid session.
 */
function resolveCurrentUserFull(rootFolder, externalToken) {
  var session = validateSessionInternal(rootFolder, externalToken);
  if (session) return { name: session.name || session.username, username: session.username };
  var googleEmail = Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail();
  return { name: googleEmail || 'unknown', username: '' };
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

/**
 * One-time, code-level setup: makes Aayush Jain and Jatin Madan admins by
 * default, without anyone needing to already know an admin's username or
 * password. Run this once from the Apps Script editor (select
 * "setupDefaultAdmins" in the toolbar dropdown, click Run) - it runs with
 * the script owner's own permissions, bypassing the app's login entirely,
 * which is exactly why this has to be run from the editor rather than
 * through the web app itself.
 *
 * For each person: if a login account already exists for their email (or
 * for the username below), it's promoted straight to admin. Otherwise a
 * brand-new admin account is created for them with a temporary password -
 * they should sign in and change it from the user menu right away.
 *
 * Deliberately named WITHOUT a trailing underscore (see setupFirstAdmin's
 * comment above for why).
 */
function setupDefaultAdmins() {
  var rootFolder = getRootFolder();
  var people = [
    { username: 'aayush', name: 'Aayush Jain', email: 'aayush@rukmanudyog.com' },
    { username: 'jatin', name: 'Jatin Madan', email: 'jatin@rukmanudyog.com' }
  ];
  var tempPassword = 'Rukman@123';
  var users = readUsers(rootFolder);
  var results = [];

  people.forEach(function (person) {
    var existing = findUserByUsername(users, person.username) ||
      users.filter(function (u) { return (u.email || '').toLowerCase() === person.email; })[0];

    if (existing) {
      existing.role = 'admin';
      if (!existing.email) existing.email = person.email;
      results.push({ username: existing.username, action: 'promoted to admin' });
    } else {
      var salt = generateSalt();
      users.push({
        username: person.username,
        name: person.name,
        role: 'admin',
        email: person.email,
        salt: salt,
        passwordHash: hashPassword(tempPassword, salt),
        createdAt: new Date().toISOString()
      });
      results.push({ username: person.username, action: 'created as admin, temp password: ' + tempPassword });
    }
  });

  users.sort(function (a, b) { return a.username.localeCompare(b.username); });
  writeJsonFile(rootFolder, USERS_FILE_NAME, users);

  Logger.log(JSON.stringify(results));
  return { success: true, results: results };
}
