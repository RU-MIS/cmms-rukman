/**
 * RUKMAN UDYOG - In-Process Inspection Report - Injection Moulding (F/QA/3B)
 * Google Apps Script Web App bound to a Google Sheet.
 *
 * Sheet layout mirrors the paper form: one row per Check Point, one pair of
 * columns (value + QA Inspector Sign) per time slot.
 */

var FORM_TITLE = 'In-Process Inspection - Injection Moulding';
var SHEET_NAME = 'Injection Moulding Log';
var CHECKING_FREQ = 'Every Two Hours';
var REPORT_EMAIL = 'qms1@rukmanudyog.com';

// Time slots, in order, for one shift. Both shifts use the same 6 slots.
var SLOTS = ['9 to 11', '11 to 1', '1 to 3', '3 to 5', '5 to 7', '7 to 9'];
var SHIFTS = ['Day/A-Shift', 'Night/B-Shift'];

// Checkpoints exactly as on the paper form F/QA/3B.
// type: 'select' -> OK/NG dropdown, 'number' -> numeric input.
// required:false -> optional field (e.g. Dim, only if applicable).
var CHECKPOINTS = [
  { key: 'appearance', label: 'Appearance', spec: 'Should be as per sample', mode: 'Visual', type: 'select' },
  { key: 'shortMoulding', label: 'Short Moulding', spec: 'Not Required', mode: 'Visual', type: 'select' },
  { key: 'silverStreaks', label: 'Silver Streaks', spec: 'Not Required', mode: 'Visual', type: 'select' },
  { key: 'shrinkage', label: 'Shrinkage', spec: 'Should be as per sample', mode: 'Visual', type: 'select' },
  { key: 'flash', label: 'Flash', spec: 'Not Required', mode: 'Visual', type: 'select' },
  { key: 'deepCut', label: 'Deep Cut', spec: 'Not Required', mode: 'Visual', type: 'select' },
  { key: 'weldline', label: 'Weldline', spec: 'Should be as per sample', mode: 'Visual', type: 'select' },
  { key: 'blackWhiteSpots', label: 'Black / White Spots', spec: 'Not Required', mode: 'Visual', type: 'select' },
  { key: 'burnMark', label: 'Burn Mark', spec: 'Not Required', mode: 'Visual', type: 'select' },
  { key: 'flowMark', label: 'Flow Mark', spec: 'Not Required', mode: 'Visual', type: 'select' },
  { key: 'airBubble', label: 'Air Bubble', spec: 'Not Required', mode: 'Visual', type: 'select' },
  { key: 'waviness', label: 'Waviness', spec: 'Not Required', mode: 'Visual', type: 'select' },
  { key: 'warpage', label: 'Warpage', spec: 'As per sample', mode: 'Visual', type: 'select' },
  { key: 'twisting', label: 'Twisting', spec: 'Part should not crack', mode: 'Manually', type: 'select' },
  { key: 'crack', label: 'Crack', spec: 'Not Required', mode: 'Visual', type: 'select' },
  { key: 'colourVariation', label: 'Colour Variation', spec: 'Not Required', mode: 'Visual', type: 'select' },
  { key: 'partWeight', label: 'Part Weight', spec: 'As per PDS', mode: 'Weighing M/C', type: 'number' },
  { key: 'dim', label: 'Dim. (If Required)', spec: 'As Required', mode: 'As Required', type: 'number', required: false }
];

var FIXED_HEADERS = ['Timestamp', 'Date', 'M/C No.', 'Part Name', 'Check Points', 'Specification', 'Checking Freq.', 'Checking Mode'];
var TAIL_HEADERS = ['Remarks', 'Status', 'Last Submitted'];

function doGet() {
  var template = HtmlService.createTemplateFromFile('index');
  return template.evaluate()
    .setTitle(FORM_TITLE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function getFormConfig() {
  return { title: FORM_TITLE, checkpoints: CHECKPOINTS, slots: SLOTS, shifts: SHIFTS };
}

function allSlotsInOrder_() {
  var list = [];
  SHIFTS.forEach(function (shift) {
    SLOTS.forEach(function (slot) {
      list.push({ shift: shift, slot: slot });
    });
  });
  return list;
}

function slotValueCol_(slotIndex) {
  return FIXED_HEADERS.length + slotIndex * 2 + 1;
}
function slotSignCol_(slotIndex) {
  return slotValueCol_(slotIndex) + 1;
}
function remarksCol_() {
  return FIXED_HEADERS.length + allSlotsInOrder_().length * 2 + 1;
}
function statusCol_() {
  return remarksCol_() + 1;
}
function lastSubmittedCol_() {
  return remarksCol_() + 2;
}
function totalCols_() {
  return lastSubmittedCol_();
}

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    buildHeaders_(sheet);
  }
  return sheet;
}

function buildHeaders_(sheet) {
  var all = allSlotsInOrder_();
  var totalCols = totalCols_();
  var row1 = new Array(totalCols).fill('');
  var row2 = FIXED_HEADERS.slice();

  all.forEach(function (s, i) {
    var vCol = slotValueCol_(i);
    row1[vCol - 1] = s.shift.indexOf('Day') === 0 ? 'DAY' : 'NIGHT';
    row2.push(s.slot);
    row2.push('QA Inspector Sign');
  });
  row2 = row2.concat(TAIL_HEADERS);

  sheet.getRange(1, 1, 1, totalCols).setValues([row1]);
  sheet.getRange(2, 1, 1, totalCols).setValues([row2]);

  all.forEach(function (s, i) {
    var vCol = slotValueCol_(i);
    sheet.getRange(1, vCol, 1, 2).merge().setHorizontalAlignment('center');
  });
  sheet.getRange(1, 1, 2, totalCols).setFontWeight('bold');
  sheet.setFrozenRows(2);
  sheet.setFrozenColumns(4);
}

/**
 * Sheets silently converts a date-looking string (e.g. "2026-09-18") into a
 * real Date value when it's written to a cell, so reading it back gives a
 * Date object, not the original string. Normalize both sides to the same
 * "yyyy-MM-dd" text before comparing, otherwise two sessions on the same
 * day never match.
 */
function normalizeDate_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(value).trim();
}

/** Rows already created for this Date + M/C No + Part Name, keyed by Check Point label. */
function findSessionRows_(sheet, dateStr, machineNo, partName) {
  var lastRow = sheet.getLastRow();
  var map = {};
  if (lastRow < 3) { return map; }
  var data = sheet.getRange(3, 1, lastRow - 2, 5).getValues();
  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    if (normalizeDate_(row[1]) === normalizeDate_(dateStr) &&
        String(row[2]).trim() === String(machineNo).trim() &&
        String(row[3]).trim() === String(partName).trim()) {
      map[row[4]] = i + 3; // 1-based sheet row
    }
  }
  return map;
}

function createSessionRows_(sheet, dateStr, machineNo, partName, timestamp) {
  var startRow = sheet.getLastRow() + 1;
  var blanks = new Array(allSlotsInOrder_().length * 2 + TAIL_HEADERS.length).fill('');
  var rows = CHECKPOINTS.map(function (cp) {
    return [timestamp, dateStr, machineNo, partName, cp.label, cp.spec, CHECKING_FREQ, cp.mode].concat(blanks);
  });
  sheet.getRange(startRow, 1, rows.length, totalCols_()).setValues(rows);

  var map = {};
  CHECKPOINTS.forEach(function (cp, i) { map[cp.label] = startRow + i; });
  return map;
}

/**
 * Returns the next unfilled {shift, slot} for the given Date + Machine No + Part Name,
 * or null if every slot for that day has already been filled, or if this
 * session's Status is already "Report Generated" (finalized - no further
 * entries allowed even if slots remain).
 */
function getNextSlot(dateStr, machineNo, partName) {
  var sheet = getSheet_();
  var map = findSessionRows_(sheet, dateStr, machineNo, partName);
  var all = allSlotsInOrder_();
  if (Object.keys(map).length === 0) {
    return all[0];
  }
  var anyRow = map[CHECKPOINTS[0].label];
  var rowValues = sheet.getRange(anyRow, 1, 1, totalCols_()).getValues()[0];
  if (rowValues[statusCol_() - 1] === 'Report Generated') {
    return null;
  }
  for (var i = 0; i < all.length; i++) {
    if (!rowValues[slotValueCol_(i) - 1]) {
      return all[i];
    }
  }
  return null;
}

/**
 * Builds a standalone spreadsheet containing just this session's header rows
 * and Check Point rows, exports it to PDF, emails it to REPORT_EMAIL, then
 * deletes the temporary file.
 */
function emailFinalReport_(sheet, map, dateStr, machineNo, partName) {
  var totalCols = totalCols_();
  var headerRows = sheet.getRange(1, 1, 2, totalCols).getValues();
  var rowNums = CHECKPOINTS.map(function (cp) { return map[cp.label]; }).filter(function (r) { return !!r; });
  var minRow = Math.min.apply(null, rowNums);
  var maxRow = Math.max.apply(null, rowNums);
  var dataRows = sheet.getRange(minRow, 1, maxRow - minRow + 1, totalCols).getValues();

  var reportName = FORM_TITLE + ' - ' + partName + ' - ' + machineNo + ' - ' + dateStr;
  var tempSs = SpreadsheetApp.create(reportName);
  try {
    var tempSheet = tempSs.getSheets()[0];
    tempSheet.getRange(1, 1, 2, totalCols).setValues(headerRows);
    tempSheet.getRange(3, 1, dataRows.length, totalCols).setValues(dataRows);
    allSlotsInOrder_().forEach(function (s, i) {
      tempSheet.getRange(1, slotValueCol_(i), 1, 2).merge().setHorizontalAlignment('center');
    });
    tempSheet.getRange(1, 1, 2, totalCols).setFontWeight('bold');
    tempSheet.setFrozenRows(2);
    tempSheet.autoResizeColumns(1, totalCols);
    SpreadsheetApp.flush();

    var url = 'https://docs.google.com/spreadsheets/d/' + tempSs.getId() + '/export' +
      '?format=pdf&gid=' + tempSheet.getSheetId() +
      '&size=A3&portrait=false&fitw=true&gridlines=true' +
      '&printtitle=false&sheetnames=false&pagenum=UNDEFINED';
    var response = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }
    });
    var pdfBlob = response.getBlob().setName(reportName + '.pdf');

    MailApp.sendEmail({
      to: REPORT_EMAIL,
      subject: reportName,
      body: 'Attached: ' + FORM_TITLE + ' report.\n\n' +
        'Date: ' + dateStr + '\nM/C No.: ' + machineNo + '\nPart Name: ' + partName,
      attachments: [pdfBlob]
    });
  } finally {
    DriveApp.getFileById(tempSs.getId()).setTrashed(true);
  }
}

/**
 * Saves one time-slot's readings into the existing Check Point rows for this
 * Date + M/C No + Part Name (creating those rows first if this is the first
 * slot of the day). finalize=true writes Status "Report Generated", emails a
 * PDF of the report to REPORT_EMAIL, and otherwise writes "Submitted".
 * Re-validates the slot is still the correct next one.
 */
function submitInspection(payload, finalize) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (!payload.date || !payload.machineNo || !payload.partName) {
      throw new Error('Date, Machine No and Part Name are required.');
    }
    var sheet = getSheet_();
    var next = getNextSlot(payload.date, payload.machineNo, payload.partName);
    if (!next || next.shift !== payload.shift || next.slot !== payload.slot) {
      throw new Error('This time slot is not the next one due, or this report has already been finalized (Report Generated). Please refresh and try again.');
    }

    var now = new Date();
    var map = findSessionRows_(sheet, payload.date, payload.machineNo, payload.partName);
    if (Object.keys(map).length === 0) {
      map = createSessionRows_(sheet, payload.date, payload.machineNo, payload.partName, now);
    }

    var slotIndex = -1;
    allSlotsInOrder_().forEach(function (s, i) {
      if (s.shift === payload.shift && s.slot === payload.slot) { slotIndex = i; }
    });
    var vCol = slotValueCol_(slotIndex);
    var sCol = slotSignCol_(slotIndex);
    var rCol = remarksCol_();
    var stCol = statusCol_();
    var lsCol = lastSubmittedCol_();
    var statusValue = finalize ? 'Report Generated' : 'Submitted';

    CHECKPOINTS.forEach(function (cp) {
      var row = map[cp.label];
      if (!row) { return; }
      var val = (payload.values && payload.values[cp.key]) || '';
      sheet.getRange(row, vCol).setValue(val);
      sheet.getRange(row, sCol).setValue(payload.inspectorSign || '');
      if (payload.remarks) {
        sheet.getRange(row, rCol).setValue(payload.remarks);
      }
      sheet.getRange(row, stCol).setValue(statusValue);
      sheet.getRange(row, lsCol).setValue(now);
    });

    var emailSent = false;
    var emailError = '';
    if (finalize) {
      try {
        emailFinalReport_(sheet, map, payload.date, payload.machineNo, payload.partName);
        emailSent = true;
      } catch (e) {
        emailError = e.message;
      }
    }

    return {
      ok: true,
      nextSlot: getNextSlot(payload.date, payload.machineNo, payload.partName),
      emailSent: emailSent,
      emailError: emailError
    };
  } finally {
    lock.releaseLock();
  }
}
