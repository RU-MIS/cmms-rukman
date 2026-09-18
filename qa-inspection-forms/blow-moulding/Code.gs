/**
 * RUKMAN UDYOG - In-Process Inspection Report - Blow Moulding (F/QA/3A)
 * Google Apps Script Web App bound to a Google Sheet.
 *
 * Setup: see ../README.md
 */

var FORM_TITLE = 'In-Process Inspection - Blow Moulding';
var SHEET_NAME = 'Blow Moulding Log';

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

function getHeaders_() {
  var headers = ['Timestamp', 'Date', 'Machine No', 'Part Name', 'Shift', 'Time Slot'];
  CHECKPOINTS.forEach(function (cp) { headers.push(cp.label); });
  headers.push('Remarks', 'QA Inspector Sign', 'Status');
  return headers;
}

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(getHeaders_());
    sheet.setFrozenRows(1);
  }
  return sheet;
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

/**
 * Returns the next unfilled {shift, slot} for the given Date + Machine No + Part Name,
 * or null if every slot for that day has already been filled.
 */
function getNextSlot(dateStr, machineNo, partName) {
  var sheet = getSheet_();
  var data = sheet.getDataRange().getValues();
  var filled = {};
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (String(row[1]) === String(dateStr) &&
        String(row[2]).trim() === String(machineNo).trim() &&
        String(row[3]).trim() === String(partName).trim()) {
      filled[row[4] + '|' + row[5]] = true;
    }
  }
  var all = allSlotsInOrder_();
  for (var j = 0; j < all.length; j++) {
    var s = all[j];
    if (!filled[s.shift + '|' + s.slot]) {
      return s;
    }
  }
  return null;
}

/**
 * Saves one time-slot's readings. finalize=true writes Status "Report Generated",
 * otherwise "Submitted". Re-validates the slot is still the correct next one
 * (guards against two people submitting the same slot at once).
 */
function submitInspection(payload, finalize) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (!payload.date || !payload.machineNo || !payload.partName) {
      throw new Error('Date, Machine No and Part Name are required.');
    }
    var next = getNextSlot(payload.date, payload.machineNo, payload.partName);
    if (!next || next.shift !== payload.shift || next.slot !== payload.slot) {
      throw new Error('This time slot is not the next one due. Please refresh and try again.');
    }

    var row = [new Date(), payload.date, payload.machineNo, payload.partName, payload.shift, payload.slot];
    CHECKPOINTS.forEach(function (cp) {
      row.push((payload.values && payload.values[cp.key]) || '');
    });
    row.push(payload.remarks || '');
    row.push(payload.inspectorSign || '');
    row.push(finalize ? 'Report Generated' : 'Submitted');

    var sheet = getSheet_();
    sheet.appendRow(row);

    return { ok: true, nextSlot: getNextSlot(payload.date, payload.machineNo, payload.partName) };
  } finally {
    lock.releaseLock();
  }
}
