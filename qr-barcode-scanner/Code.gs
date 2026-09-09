/**
 * QR & Barcode Scanner — Google Apps Script backend.
 * Deploy via Deploy > New deployment > Web app. See README.md for the
 * full step-by-step setup and deployment guide.
 */

const SHEET_NAME = 'Scans';
const SPREADSHEET_ID = '18c39NeNfjPv5PF6xhLzYLGZ4RK2upkjapqlDa_wRwcE';

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('QR & Barcode Scanner')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no');
}

function getSpreadsheet_() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function getSheet_() {
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(['Timestamp', 'Scanned Value']);
  }
  return sheet;
}

/**
 * Called from Index.html via google.script.run. Appends a
 * [Timestamp, Scanned Value] row to the "Scans" sheet.
 */
function saveScan(value) {
  try {
    if (!value || typeof value !== 'string' || !value.trim()) {
      return { success: false, error: 'Scanned value is empty' };
    }

    const sheet = getSheet_();
    const timestamp = Utilities.formatDate(
      new Date(),
      Session.getScriptTimeZone(),
      'yyyy-MM-dd HH:mm:ss'
    );
    sheet.appendRow([timestamp, value.trim()]);

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}
