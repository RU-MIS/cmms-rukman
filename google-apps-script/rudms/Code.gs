/**
 * Rukman Udyog Docs Management System (RUDMS)
 * Backend: Drive folder/sheet setup, upload, permissions, indexing, search.
 */

var ROOT_FOLDER_NAME = 'Rukman Udyog Docs Management System (RUDMS)';
var INDEX_FILE_NAME = 'RUDMS_Index';
var DEFAULT_CATEGORIES = ['RFQ', 'Purchase Orders', 'Purchase Bills', 'CAD Designs'];
var SHEET_HEADERS = [
  'File ID', 'File Name', 'Category', 'Drive Link', 'File Type',
  'Allowed Viewers', 'Allowed Editors', 'Upload Date', 'Uploaded By', 'Size (bytes)'
];

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
    if (!folder.isTrashed() && folder.getName() !== INDEX_FILE_NAME) {
      names[folder.getName()] = true;
    }
  }
  return Object.keys(names).sort();
}

// ---------------------------------------------------------------------------
// Metadata index (Google Sheet acting as lightweight DB)
// ---------------------------------------------------------------------------

/**
 * Deliberately does NOT cache the index sheet's ID in PropertiesService.
 * A cached ID that outlives the file (someone deletes/trashes the sheet
 * by hand) leaves SpreadsheetApp.openById() pointing at a dead reference
 * that doesn't cleanly throw - it can come back as a broken object that
 * fails to serialize back to the client instead of raising a catchable
 * error. Resolving by name inside the folder every time costs one extra
 * Drive lookup but is self-healing: if the sheet is ever deleted, the
 * next call just recreates it, exactly like category folders already do.
 */
function getIndexSheet_() {
  var rootFolder = getRootFolder_();
  var files = rootFolder.getFilesByName(INDEX_FILE_NAME);
  var ss;

  if (files.hasNext()) {
    ss = SpreadsheetApp.open(files.next());
  } else {
    ss = SpreadsheetApp.create(INDEX_FILE_NAME);
    var file = DriveApp.getFileById(ss.getId());
    rootFolder.addFile(file);
    DriveApp.getRootFolder().removeFile(file);
    var sheet = ss.getSheets()[0];
    sheet.getRange(1, 1, 1, SHEET_HEADERS.length).setValues([SHEET_HEADERS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  return ss.getSheets()[0];
}

function appendIndexRow_(row) {
  var sheet = getIndexSheet_();
  sheet.appendRow(row);
}

function findRowByFileId_(sheet, fileId) {
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === fileId) return i + 1; // 1-indexed sheet row
  }
  return -1;
}

function readAllRows_(sheet) {
  sheet = sheet || getIndexSheet_();
  var data = sheet.getDataRange().getValues();
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    if (!r[0]) continue;
    rows.push({
      fileId: r[0],
      fileName: r[1],
      category: r[2],
      driveLink: r[3],
      fileType: r[4],
      viewers: r[5],
      editors: r[6],
      uploadDate: r[7],
      uploadedBy: r[8],
      size: r[9]
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Public API - system bootstrap
// ---------------------------------------------------------------------------

/**
 * Fast, minimal call for first paint: just identity + root folder.
 * Deliberately does NOT touch categories or the index sheet, so it stays
 * quick even on a cold start.
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
 * the first successful run.
 */
function ensureDefaultCategories() {
  try {
    var props = PropertiesService.getScriptProperties();
    if (props.getProperty('CATEGORIES_READY')) {
      return { success: true };
    }
    var rootFolder = getRootFolder_();
    DEFAULT_CATEGORIES.forEach(function (c) {
      getOrCreateCategoryFolder_(rootFolder, c);
    });
    props.setProperty('CATEGORIES_READY', 'true');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function getAllFiles() {
  try {
    return { success: true, files: readAllRows_() };
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

    var uploadDate = new Date();
    var uploadedBy = Session.getActiveUser().getEmail() || 'unknown';
    var extension = (payload.fileName.split('.').pop() || '').toLowerCase();

    appendIndexRow_([
      file.getId(),
      payload.fileName,
      categoryFolder.getName(),
      file.getUrl(),
      extension,
      viewerEmails.join(', '),
      editorEmails.join(', '),
      uploadDate,
      uploadedBy,
      file.getSize()
    ]);

    return {
      success: true,
      warnings: warnings,
      file: {
        fileId: file.getId(),
        fileName: payload.fileName,
        category: categoryFolder.getName(),
        driveLink: file.getUrl(),
        fileType: extension,
        viewers: viewerEmails.join(', '),
        editors: editorEmails.join(', '),
        uploadDate: uploadDate,
        uploadedBy: uploadedBy,
        size: file.getSize()
      }
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

    var sheet = getIndexSheet_();
    var rowIndex = findRowByFileId_(sheet, fileId);
    if (rowIndex > 0) {
      sheet.getRange(rowIndex, 6).setValue(newViewers.join(', '));
      sheet.getRange(rowIndex, 7).setValue(newEditors.join(', '));
    }

    return { success: true, warnings: warnings };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function deleteFile(fileId) {
  try {
    var file = DriveApp.getFileById(fileId);
    file.setTrashed(true);

    var sheet = getIndexSheet_();
    var rowIndex = findRowByFileId_(sheet, fileId);
    if (rowIndex > 0) sheet.deleteRow(rowIndex);

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
 * access that file already had) and the index Sheet is refreshed to match,
 * purely so the file list in the UI displays accurate access - Drive
 * itself already grants folder viewers/editors access to existing and
 * future files in the folder regardless of this flag.
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
      var sheet = getIndexSheet_();
      var iter = folder.getFiles();
      while (iter.hasNext()) {
        var file = iter.next();
        warnings = warnings.concat(applyPermissions_(file, newViewers, newEditors));

        var rowIndex = findRowByFileId_(sheet, file.getId());
        if (rowIndex > 0) {
          var existingViewers = String(sheet.getRange(rowIndex, 6).getValue() || '').split(',');
          var existingEditors = String(sheet.getRange(rowIndex, 7).getValue() || '').split(',');
          sheet.getRange(rowIndex, 6).setValue(uniqueEmails_(existingViewers.concat(newViewers)).join(', '));
          sheet.getRange(rowIndex, 7).setValue(uniqueEmails_(existingEditors.concat(newEditors)).join(', '));
        }
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
