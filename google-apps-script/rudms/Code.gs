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
 */
function getBootstrapInfo() {
  try {
    var rootFolder = getRootFolder_();
    return {
      success: true,
      currentUser: Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail(),
      rootFolderId: rootFolder.getId()
    };
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
 *   viewerEmails: string[], editorEmails: string[]
 * }
 */
function uploadFile(payload) {
  try {
    if (!payload || !payload.base64Data || !payload.fileName) {
      throw new Error('Missing file data.');
    }

    var rootFolder = getRootFolder_();
    var categoryFolder = getOrCreateCategoryFolder_(rootFolder, payload.category || 'Uncategorized');

    var bytes = Utilities.base64Decode(payload.base64Data);
    var blob = Utilities.newBlob(bytes, payload.mimeType || 'application/octet-stream', payload.fileName);
    var file = categoryFolder.createFile(blob);
    // Files created via DriveApp are already private to the owner by
    // default - no separate setSharing() call needed here.

    var viewerEmails = uniqueEmails_(payload.viewerEmails);
    var editorEmails = uniqueEmails_(payload.editorEmails);
    var warnings = applyPermissions_(file, viewerEmails, editorEmails);

    var uploadedBy = Session.getActiveUser().getEmail() || 'unknown';
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
