/**
 * RUKMAN UDYOG - In-Process Inspection Report - Blow Moulding (F/QA/3A)
 * Google Apps Script Web App bound to a Google Sheet.
 *
 * Sheet layout mirrors the paper form: one row per Check Point, one pair of
 * columns (value + QA Inspector Sign) per time slot.
 */

var FORM_TITLE = 'In-Process Inspection - Blow Moulding';
var SHEET_NAME = 'Blow Moulding Log';
var CHECKING_FREQ = 'Every Two Hours';

// Time slots, in order, for one shift. Both shifts use the same 6 slots.
var SLOTS = ['9 to 11', '11 to 1', '1 to 3', '3 to 5', '5 to 7', '7 to 9'];
var SHIFTS = ['Day/A-Shift', 'Night/B-Shift'];

// Checkpoints exactly as on the paper form F/QA/3A.
// type: 'select' -> OK/NG dropdown, 'number' -> numeric input.
var CHECKPOINTS = [
  { key: 'appearance', label: 'Appearance', spec: 'Should be as per sample', mode: 'Visual', type: 'select' },
  { key: 'weight', label: 'Weight', spec: 'As per Part IS 1/3', mode: 'Visual', type: 'number' },
  { key: 'airProblem', label: 'Air Problem', spec: 'Not Required', mode: 'Visual', type: 'select' },
  { key: 'lowWeight', label: 'Low Weight', spec: 'Not Required', mode: 'Visual', type: 'select' },
  { key: 'highWeight', label: 'High Weight', spec: 'Not Required', mode: 'Visual', type: 'select' },
  { key: 'tubeShort', label: 'Tube Short', spec: 'Not Required', mode: 'Visual', type: 'select' },
  { key: 'moisture', label: 'Moisture', spec: 'Not Required', mode: 'Visual', type: 'select' },
  { key: 'electricityProblem', label: 'Electricity Problem', spec: 'Not Required', mode: 'Visual', type: 'select' },
  { key: 'dustParticle', label: 'Dust Particle', spec: 'Not Required', mode: 'Visual', type: 'select' },
  { key: 'withoutNut', label: 'Without Nut', spec: 'Not Required', mode: 'Visual', type: 'select' },
  { key: 'warpage', label: 'Warpage', spec: 'Not Required, Checked On Fixture', mode: 'Visual', type: 'select' }
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

/** Rows already created for this Date + M/C No + Part Name, keyed by Check Point label. */
function findSessionRows_(sheet, dateStr, machineNo, partName) {
  var lastRow = sheet.getLastRow();
  var map = {};
  if (lastRow < 3) { return map; }
  var data = sheet.getRange(3, 1, lastRow - 2, 5).getValues();
  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    if (String(row[1]) === String(dateStr) &&
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
 * or null if every slot for that day has already been filled.
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
  for (var i = 0; i < all.length; i++) {
    if (!rowValues[slotValueCol_(i) - 1]) {
      return all[i];
    }
  }
  return null;
}

/**
 * Saves one time-slot's readings into the existing Check Point rows for this
 * Date + M/C No + Part Name (creating those rows first if this is the first
 * slot of the day). finalize=true writes Status "Report Generated",
 * otherwise "Submitted". Re-validates the slot is still the correct next one.
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
      throw new Error('This time slot is not the next one due. Please refresh and try again.');
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

    return { ok: true, nextSlot: getNextSlot(payload.date, payload.machineNo, payload.partName) };
  } finally {
    lock.releaseLock();
  }
}
