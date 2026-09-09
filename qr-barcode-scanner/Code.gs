/**
 * QR & Barcode Scanner — Google Apps Script backend.
 * Deploy via Deploy > New deployment > Web app. See README.md for the
 * full step-by-step setup and deployment guide.
 */

const SPREADSHEET_ID = '18c39NeNfjPv5PF6xhLzYLGZ4RK2upkjapqlDa_wRwcY';

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('QR & Barcode Scanner')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no');
}

function getFirstSheet_() {
  return SpreadsheetApp.openById(SPREADSHEET_ID).getSheets()[0];
}

/**
 * Called from Index.html via google.script.run. Appends
 * [new Date(), value] as a new row to the first worksheet.
 */
function saveScan(value) {
  try {
    if (!value || typeof value !== 'string' || !value.trim()) {
      return { success: false, error: 'Scanned value is empty' };
    }

    const scannedValue = value.trim();
    const sheet = getFirstSheet_();
    const row = sheet.getLastRow() + 1;

    sheet.getRange(row, 1).setValue(new Date());

    // Force column B to plain-text format before writing, so numeric-looking
    // codes (leading zeros, long EAN/UPC digit strings) are stored exactly
    // as scanned instead of Sheets auto-converting them to a Number.
    const valueCell = sheet.getRange(row, 2);
    valueCell.setNumberFormat('@');
    valueCell.setValue(scannedValue);

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}
