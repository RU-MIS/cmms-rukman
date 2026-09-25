/**
 * RUKMAN UDYOG - In-Process Inspection Report - Blow Moulding (F/QA/3A)
 * Google Apps Script Web App bound to a Google Sheet.
 *
 * Sheet layout mirrors the paper form: one row per Check Point, one pair of
 * columns (value + QA Inspector Sign) per time slot.
 */

var FORM_TITLE = 'In-Process Inspection - Blow Moulding';
var DOC_CODE = 'F/QA/3A';
var REPORT_TITLE = 'IN-PROCESS INSPECTION REPORT-BLOW MOULDING';
var REV_INFO = 'REV.:00/10.09.2025';
var SHEET_NAME = 'Blow Moulding Log';
var CHECKING_FREQ = 'Every Two Hours';
var REPORT_EMAIL = 'qms1@rukmanudyog.com';
var HEADER_ROWS = 4; // 2 title rows (RUKMAN UDYOG + form name) + 2 column-header rows

// Time slots, in order, for one shift. Both shifts use the same 6 slots.
var SLOTS = ['9 to 11', '11 to 1', '1 to 3', '3 to 5', '5 to 7', '7 to 9'];
var SHIFTS = ['Day/A-Shift', 'Night/B-Shift'];

// Checkpoints exactly as on the paper form F/QA/3A.
// type: 'select' -> OK/NG dropdown, 'number' -> numeric input.
var CHECKPOINTS = [
  { key: 'appearance', label: 'Appearance', spec: 'Should be as per sample', mode: 'Visual', type: 'select' },
  { key: 'weight', label: 'Weight', spec: 'As per Part IS 1/3', mode: 'Visual', type: 'text' },
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

  // Row 1-2: title band, like the paper form's "RUKMAN UDYOG" / form name bar.
  sheet.getRange(1, 1, 1, totalCols).merge()
    .setValue('RUKMAN UDYOG')
    .setFontWeight('bold').setFontSize(14).setHorizontalAlignment('center')
    .setBackground('#111111').setFontColor('#ffffff');
  sheet.getRange(2, 1, 1, totalCols).merge()
    .setValue(FORM_TITLE.toUpperCase() + '  (' + DOC_CODE + ')')
    .setFontWeight('bold').setHorizontalAlignment('center')
    .setBackground('#111111').setFontColor('#ffffff');

  // Row 3-4: DAY/NIGHT group labels + actual column headers.
  var row1 = new Array(totalCols).fill('');
  var row2 = FIXED_HEADERS.slice();
  all.forEach(function (s, i) {
    var vCol = slotValueCol_(i);
    row1[vCol - 1] = s.shift.indexOf('Day') === 0 ? 'DAY' : 'NIGHT';
    row2.push(s.slot);
    row2.push('QA Inspector Sign');
  });
  row2 = row2.concat(TAIL_HEADERS);

  sheet.getRange(3, 1, 1, totalCols).setValues([row1]);
  sheet.getRange(4, 1, 1, totalCols).setValues([row2]);

  all.forEach(function (s, i) {
    var vCol = slotValueCol_(i);
    sheet.getRange(3, vCol, 1, 2).merge().setHorizontalAlignment('center');
  });
  sheet.getRange(3, 1, 2, totalCols).setFontWeight('bold');
  sheet.setFrozenRows(HEADER_ROWS);
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
  if (lastRow <= HEADER_ROWS) { return map; }
  var firstDataRow = HEADER_ROWS + 1;
  var data = sheet.getRange(firstDataRow, 1, lastRow - HEADER_ROWS, 5).getValues();
  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    if (normalizeDate_(row[1]) === normalizeDate_(dateStr) &&
        String(row[2]).trim() === String(machineNo).trim() &&
        String(row[3]).trim() === String(partName).trim()) {
      map[row[4]] = i + firstDataRow; // 1-based sheet row
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
 * Renders this session's header rows + Check Point rows as an HTML table
 * (styled like the paper form) for use as the finalize email's body.
 */
function buildReportHtml_(sheet, minRow, maxRow) {
  var totalCols = totalCols_();
  var groupRow = sheet.getRange(3, 1, 1, totalCols).getValues()[0];
  var headerRow = sheet.getRange(4, 1, 1, totalCols).getValues()[0];
  var bodyRows = sheet.getRange(minRow, 1, maxRow - minRow + 1, totalCols).getValues();
  var tz = Session.getScriptTimeZone();

  function cellText(val) {
    if (val === '' || val === null || val === undefined) { return '&nbsp;'; }
    if (Object.prototype.toString.call(val) === '[object Date]') {
      return Utilities.formatDate(val, tz, 'dd-MMM-yyyy HH:mm');
    }
    return String(val);
  }

  var html = '<div style="font-family:Arial,sans-serif;">';
  html += '<div style="background:#111;color:#fff;text-align:center;padding:8px;font-weight:bold;font-size:16px;">RUKMAN UDYOG</div>';
  html += '<div style="background:#111;color:#fff;text-align:center;padding:6px;font-weight:bold;">' +
    FORM_TITLE.toUpperCase() + '&nbsp;&nbsp;(' + DOC_CODE + ')</div>';
  html += '<table style="border-collapse:collapse;font-size:11px;margin-top:10px;" border="1" cellpadding="4" cellspacing="0">';

  html += '<tr>';
  for (var c = 0; c < FIXED_HEADERS.length; c++) { html += '<td></td>'; }
  var i = FIXED_HEADERS.length;
  while (i < FIXED_HEADERS.length + allSlotsInOrder_().length * 2) {
    html += '<td colspan="2" style="text-align:center;font-weight:bold;background:#eee;">' + cellText(groupRow[i]) + '</td>';
    i += 2;
  }
  html += '<td></td><td></td><td></td></tr>';

  html += '<tr>';
  headerRow.forEach(function (h) {
    html += '<td style="font-weight:bold;background:#f5f5f5;white-space:nowrap;">' + cellText(h) + '</td>';
  });
  html += '</tr>';

  bodyRows.forEach(function (row) {
    html += '<tr>';
    row.forEach(function (val) { html += '<td>' + cellText(val) + '</td>'; });
    html += '</tr>';
  });

  html += '</table></div>';
  return html;
}

/**
 * Builds a standalone spreadsheet laid out exactly like the paper form's
 * printed layout: logo/title band with doc code + rev info in the corner,
 * a Date / M-C No. / Part Name info row, a "Time" super-header over merged
 * Day/A-Shift & Night/B-Shift bands, one column per time slot (no separate
 * sign sub-column), a single Remarks footer row, a single QA Inspector Sign
 * footer row (one signer per time-slot column), and the two NOTE lines -
 * then exports it as a PDF.
 *
 * The temp spreadsheet is intentionally NOT deleted afterwards: Apps
 * Script's DriveApp always demands the full (Google "restricted") Drive
 * scope to delete a file, even one the script itself just created, and
 * that scope keeps getting blocked outright for this account. Leaving a
 * small named "<report name>" sheet behind in Drive is harmless - delete
 * them manually from Drive occasionally if they build up.
 */
function buildReportPdfBlob_(sheet, minRow, maxRow, reportName, dateStr, machineNo, partName) {
  var totalCols = totalCols_();
  var bodyRows = sheet.getRange(minRow, 1, maxRow - minRow + 1, totalCols).getValues();

  var TEMP_FIXED = ['S. NO.', 'CHECK POINTS', 'SPECIFICATIONS', 'CHECKING FREQUENCY', 'CHECKING MODE'];
  var lastFixedCol = TEMP_FIXED.length;
  var slots = allSlotsInOrder_();
  // dataGridCols is the ONLY width the whole sheet uses - no extra columns
  // anywhere. Every column gets an explicit pixel width below (instead of
  // autoResizeColumns, which was inflating some columns and cramping
  // others), so nothing balloons or drifts out of alignment.
  var dataGridCols = lastFixedCol + slots.length;
  var tempTotalCols = dataGridCols;

  function tempSlotCol(i) { return lastFixedCol + i + 1; }

  var tempSs = SpreadsheetApp.create(reportName);
  var ts = tempSs.getSheets()[0];

  // The doc-code/rev-info box borrows the grid's own last 2 columns (the
  // last 2 time-slot columns) for just these 2 header rows - a genuine
  // 2-column x 2-row merged box, split by a divider line between the two
  // rows, exactly like the paper form's top-right corner box.
  var docBoxStartCol = dataGridCols - 1;
  // The main title band runs from column 2 (column 1 is reserved for the
  // logo, rows 1-2) up to just before the doc-code box.
  var titleStartCol = 2;
  var titleWidth = docBoxStartCol - titleStartCol;

  // Row 1-2, column 1: RUKMAN UDYOG logo, merged across both rows.
  ts.getRange(1, 1, 2, 1).merge();
  var logoBlob = Utilities.newBlob(Utilities.base64Decode(LOGO_BASE64_PNG), 'image/png', 'ru-logo.png');
  var logoImage = ts.insertImage(logoBlob, 1, 1);
  logoImage.setWidth(48).setHeight(38);

  // Row 1: RUKMAN UDYOG title / doc code box (top half).
  ts.getRange(1, titleStartCol, 1, titleWidth).merge()
    .setValue('RUKMAN UDYOG')
    .setFontWeight('bold').setFontSize(16).setHorizontalAlignment('center');
  ts.getRange(1, docBoxStartCol, 1, 2).merge()
    .setValue(DOC_CODE).setFontWeight('bold').setFontSize(9).setHorizontalAlignment('center');

  // Row 2: black title band / doc code box (bottom half - rev info).
  ts.getRange(2, titleStartCol, 1, titleWidth).merge()
    .setValue(REPORT_TITLE)
    .setFontWeight('bold').setFontSize(12).setHorizontalAlignment('center')
    .setBackground('#111111').setFontColor('#ffffff');
  ts.getRange(2, docBoxStartCol, 1, 2).merge()
    .setValue(REV_INFO).setFontWeight('bold').setFontSize(8).setHorizontalAlignment('center');

  // Row 3: Date / M-C No. / Part Name info boxes.
  ts.getRange(3, 1, 1, 3).merge().setValue('Date :- ' + dateStr).setFontWeight('bold');
  ts.getRange(3, 4, 1, 2).merge().setValue('M/C No. :- ' + machineNo).setFontWeight('bold');
  ts.getRange(3, tempSlotCol(0), 1, tempTotalCols - tempSlotCol(0) + 1).merge()
    .setValue('Part Name :- ' + partName).setFontWeight('bold');

  // Row 4: "Time" super-header - spans only the real slot columns, not the
  // dedicated corner column.
  ts.getRange(4, tempSlotCol(0), 1, slots.length).merge()
    .setValue('Time').setFontWeight('bold').setHorizontalAlignment('center').setBackground('#e8e8e8');

  // Row 5: Day/A-Shift, Night/B-Shift bands - also only the real slot columns.
  ts.getRange(5, tempSlotCol(0), 1, SLOTS.length).merge()
    .setValue('Day/A-Shift').setFontWeight('bold').setHorizontalAlignment('center').setBackground('#eef4ff');
  ts.getRange(5, tempSlotCol(SLOTS.length), 1, SLOTS.length).merge()
    .setValue('Night/B-Shift').setFontWeight('bold').setHorizontalAlignment('center').setBackground('#eef4ff');

  // Row 6: column headers - only the real grid columns. Fixed/narrow
  // columns (Checking Frequency/Mode) wrap their header text onto 2 lines
  // on purpose, same as the narrow boxes on the paper form.
  var headerRow = TEMP_FIXED.slice();
  slots.forEach(function (s) { headerRow.push(s.slot); });
  ts.getRange(6, 1, 1, dataGridCols).setValues([headerRow])
    .setFontWeight('bold').setBackground('#f5f5f5').setHorizontalAlignment('center')
    .setVerticalAlignment('middle').setWrap(true);

  // Data rows: S.No., Check Point, Specification, Freq., Mode, then just the
  // slot VALUES (OK/Not OK/number) - no separate sign column per slot.
  var dataStartRow = 7;
  var dataRows = bodyRows.map(function (row, idx) {
    var out = [idx + 1, row[4], row[5], row[6], row[7]];
    for (var i = 0; i < slots.length; i++) {
      out.push(row[FIXED_HEADERS.length + i * 2] || '');
    }
    return out;
  });
  ts.getRange(dataStartRow, 1, dataRows.length, dataGridCols).setValues(dataRows).setHorizontalAlignment('center').setWrap(true);
  ts.getRange(dataStartRow, 2, dataRows.length, 2).setHorizontalAlignment('left');

  // Checking Frequency / Checking Mode are the same for every row in this
  // session, so merge them into one tall cell like the paper form does.
  ts.getRange(dataStartRow, 4, dataRows.length, 1).merge().setVerticalAlignment('middle').setHorizontalAlignment('center');
  ts.getRange(dataStartRow, 5, dataRows.length, 1).merge().setVerticalAlignment('middle').setHorizontalAlignment('center');

  // Remarks footer row.
  var remarksRow = dataStartRow + dataRows.length;
  var remarksValue = bodyRows[0][remarksCol_() - 1] || '';
  ts.getRange(remarksRow, 1, 1, lastFixedCol).merge().setValue('REMARKS:-').setFontWeight('bold');
  ts.getRange(remarksRow, tempSlotCol(0), 1, tempTotalCols - tempSlotCol(0) + 1).merge().setValue(remarksValue);

  // QA Inspector Sign footer row - one signer per time-slot column, read
  // from the first Check Point row (the signer is the same for every
  // checkpoint within a single slot submission). Corner column stays blank.
  var signRow = remarksRow + 1;
  ts.getRange(signRow, 1, 1, lastFixedCol).merge().setValue('QA INSPECTOR SIGN.').setFontWeight('bold');
  for (var i = 0; i < slots.length; i++) {
    var signVal = bodyRows[0][slotSignCol_(i) - 1] || '';
    ts.getRange(signRow, tempSlotCol(i)).setValue(signVal).setHorizontalAlignment('center');
  }

  // NOTE lines - span the full width.
  var note1Row = signRow + 1;
  ts.getRange(note1Row, 1, 1, tempTotalCols).merge()
    .setValue('NOTE: Retain one inspected ok. sample dully signed by QC Incharge')
    .setFontSize(9).setHorizontalAlignment('left');
  ts.getRange(note1Row + 1, 1, 1, tempTotalCols).merge()
    .setValue('Retain one sample dully signed by Prod. & QA incharge (if deviation required)')
    .setFontSize(9).setHorizontalAlignment('left');

  var lastRow = note1Row + 1;
  ts.getRange(1, 1, lastRow, tempTotalCols).setBorder(true, true, true, true, true, true);

  // Explicit column widths for every column - fixed values instead of
  // autoResizeColumns, which was making the S.No./first slot columns
  // balloon unpredictably. Checking Frequency/Mode are deliberately narrow
  // (their header wraps to 2 lines, like the paper form's narrow boxes).
  ts.setColumnWidth(1, 55);   // S. NO. (also holds the logo)
  ts.setColumnWidth(2, 130);  // CHECK POINTS
  ts.setColumnWidth(3, 160);  // SPECIFICATIONS
  ts.setColumnWidth(4, 65);   // CHECKING FREQUENCY
  ts.setColumnWidth(5, 60);   // CHECKING MODE
  for (var sc = 0; sc < slots.length; sc++) {
    ts.setColumnWidth(tempSlotCol(sc), 62); // one time-slot column - all equal
  }

  ts.setFrozenRows(6);
  SpreadsheetApp.flush();

  var url = 'https://docs.google.com/spreadsheets/d/' + tempSs.getId() + '/export' +
    '?format=pdf&gid=' + ts.getSheetId() +
    '&size=A3&portrait=false&fitw=true&fith=true&gridlines=true' +
    '&printtitle=false&sheetnames=false&pagenum=UNDEFINED';
  var response = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }
  });
  return response.getBlob().setName(reportName + '.pdf');
}

/**
 * Emails this session's report to REPORT_EMAIL. Tries to attach a real PDF
 * laid out like the paper form; if that fails for any reason, falls back to
 * an HTML table in the email body so a report always goes out either way.
 */
function emailFinalReport_(sheet, map, dateStr, machineNo, partName) {
  var rowNums = CHECKPOINTS.map(function (cp) { return map[cp.label]; }).filter(function (r) { return !!r; });
  var minRow = Math.min.apply(null, rowNums);
  var maxRow = Math.max.apply(null, rowNums);
  var reportName = FORM_TITLE + ' - ' + partName + ' - ' + machineNo + ' - ' + dateStr;

  try {
    var pdfBlob = buildReportPdfBlob_(sheet, minRow, maxRow, reportName, dateStr, machineNo, partName);
    MailApp.sendEmail({
      to: REPORT_EMAIL,
      subject: reportName,
      body: 'Attached: ' + FORM_TITLE + ' report.\n\n' +
        'Date: ' + dateStr + '\nM/C No.: ' + machineNo + '\nPart Name: ' + partName,
      attachments: [pdfBlob]
    });
  } catch (e) {
    var html = buildReportHtml_(sheet, minRow, maxRow);
    MailApp.sendEmail({
      to: REPORT_EMAIL,
      subject: reportName,
      htmlBody: html
    });
  }
}

/**
 * Saves one time-slot's readings into the existing Check Point rows for this
 * Date + M/C No + Part Name (creating those rows first if this is the first
 * slot of the day). finalize=true writes Status "Report Generated" and
 * emails the report to REPORT_EMAIL, and otherwise writes "Submitted".
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

/**
 * TEMPORARY - run this once from the Apps Script editor (function dropdown
 * at the top > select forceAuthAllScopes > Run) to force a single consent
 * screen covering every scope this project needs, then redeploy. Safe to
 * delete afterwards; it isn't called from anywhere else.
 */
function forceAuthAllScopes() {
  SpreadsheetApp.getActiveSpreadsheet();
  MailApp.getRemainingDailyQuota();
  UrlFetchApp.fetch('https://www.google.com', { muteHttpExceptions: true });
}
