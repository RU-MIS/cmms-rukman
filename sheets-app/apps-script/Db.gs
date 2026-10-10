/**
 * Data access for the private, container-bound spreadsheet.
 *
 * - Columns are addressed by header name (row 1), never by position.
 * - All data cells are formatted as plain text (set by setupDatabase), so Sheets
 *   does not turn ISO timestamps or ids into dates / numbers.
 * - Lookups use TextFinder on one column instead of reading whole sheets.
 * - Every write runs inside withLock_() (LockService script lock): Google Sheets
 *   has no transactions, the lock serialises writers of this script.
 */

function ss_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('This script must be bound to the database spreadsheet (Extensions → Apps Script)');
  return ss;
}

function sheet_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('Sheet "' + name + '" is missing — run setupDatabase()');
  return sh;
}

function headers_(sh) {
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); });
}

/** Cell values come back as text; normalise the odd Date / boolean a user may have typed by hand. */
function readCell_(v) {
  if (v instanceof Date) return v.toISOString();
  if (v === true) return 'TRUE';
  if (v === false) return 'FALSE';
  return v === null || v === undefined ? '' : String(v);
}

function rowToObject_(headers, values, rowNumber) {
  var o = { _row: rowNumber };
  for (var i = 0; i < headers.length; i++) if (headers[i]) o[headers[i]] = readCell_(values[i]);
  return o;
}

/** Find the first row whose column `column` equals `value` exactly. Returns the record or null. */
function findBy_(name, column, value) {
  if (value === '' || value === null || value === undefined) return null;
  var sh = sheet_(name);
  var last = sh.getLastRow();
  if (last < 2) return null;
  var headers = headers_(sh);
  var col = headers.indexOf(column) + 1;
  if (col < 1) throw new Error('Column "' + column + '" missing in ' + name);
  var hit = sh.getRange(2, col, last - 1, 1).createTextFinder(String(value)).matchEntireCell(true).matchCase(true).findNext();
  if (!hit) return null;
  var r = hit.getRow();
  return rowToObject_(headers, sh.getRange(r, 1, 1, headers.length).getValues()[0], r);
}

/** All records of a sheet (only for small sheets: Users, Settings). */
function readAll_(name) {
  var sh = sheet_(name);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var headers = headers_(sh);
  return sh.getRange(2, 1, last - 1, headers.length).getValues().map(function (row, i) { return rowToObject_(headers, row, i + 2); });
}

/** The last `count` records (newest last), e.g. for the audit log. */
function readLast_(name, count, skip) {
  var sh = sheet_(name);
  var last = sh.getLastRow() - (skip || 0);
  if (last < 2) return [];
  var first = Math.max(2, last - count + 1);
  var headers = headers_(sh);
  return sh.getRange(first, 1, last - first + 1, headers.length).getValues().map(function (row, i) { return rowToObject_(headers, row, first + i); });
}

function countRows_(name) { return Math.max(0, sheet_(name).getLastRow() - 1); }

function appendRecord_(name, record) {
  var sh = sheet_(name);
  var headers = headers_(sh);
  var row = headers.map(function (h) {
    var v = record[h];
    if (v === undefined || v === null) return '';
    if (v === true) return 'TRUE';
    if (v === false) return 'FALSE';
    return cellValue_(String(v));
  });
  return withLock_(function () {
    var r = sh.getLastRow() + 1;
    if (r > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 500);
    var range = sh.getRange(r, 1, 1, headers.length);
    range.setNumberFormat('@');            // plain text before writing: ids / hashes are never parsed as numbers or dates
    range.setValues([row]);
    return r;
  });
}

/** Update some columns of one record, identified by row number AND id (guards against a row having moved). */
function updateRecord_(name, rowNumber, idColumn, idValue, patch) {
  var sh = sheet_(name);
  var headers = headers_(sh);
  var range = sh.getRange(rowNumber, 1, 1, headers.length);
  var values = range.getValues()[0];
  var idIndex = headers.indexOf(idColumn);
  if (readCell_(values[idIndex]) !== String(idValue)) throw appError_('CONFLICT', 'The record changed meanwhile — reload and try again');
  Object.keys(patch).forEach(function (k) {
    var i = headers.indexOf(k);
    if (i < 0) throw new Error('Column "' + k + '" missing in ' + name);
    var v = patch[k];
    values[i] = v === true ? 'TRUE' : v === false ? 'FALSE' : v === null || v === undefined ? '' : cellValue_(String(v));
  });
  range.setValues([values]);
}

var LOCK_DEPTH_ = 0;   // per execution: each web request is a fresh execution

/** Runs fn while holding the script lock. Re-entrant: nested calls reuse the outer lock. */
function withLock_(fn) {
  if (LOCK_DEPTH_ > 0) {
    LOCK_DEPTH_++;
    try { return fn(); } finally { LOCK_DEPTH_--; }
  }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LIMITS.lockWaitMs)) throw appError_('BUSY', 'The system is busy — please try again in a moment');
  LOCK_DEPTH_ = 1;
  try {
    return fn();
  } finally {
    LOCK_DEPTH_ = 0;
    SpreadsheetApp.flush();
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------- settings

function getSetting_(key) {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('settings');
  var settings = cached ? JSON.parse(cached) : null;
  if (!settings) {
    settings = {};
    readAll_('Settings').forEach(function (r) { settings[r.key] = r.value; });
    cache.put('settings', JSON.stringify(settings), 300);
  }
  if (settings[key] !== undefined && settings[key] !== '') return settings[key];
  return DEFAULT_SETTINGS[key] ? DEFAULT_SETTINGS[key][0] : '';
}

function getNumberSetting_(key, min, max) {
  var n = Number(getSetting_(key));
  var fallback = Number(DEFAULT_SETTINGS[key][0]);
  if (!isFinite(n)) n = fallback;
  return Math.max(min, Math.min(max, n));
}
