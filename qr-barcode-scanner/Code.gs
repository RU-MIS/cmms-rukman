/**
 * QR & Barcode Scanner — Google Apps Script backend.
 * Deploy via Deploy > New deployment > Web app. See README.md for the
 * full step-by-step setup and deployment guide.
 */

const SHEET_NAME = 'Scans';

// Leave empty to use the spreadsheet this script is bound to (recommended:
// create the script via Extensions > Apps Script from inside the target
// Sheet). Only set this if running as a standalone script instead.
const SPREADSHEET_ID = '';

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('QR & Barcode Scanner')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no');
}

function getSpreadsheet_() {
  return SPREADSHEET_ID
    ? SpreadsheetApp.openById(SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
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
