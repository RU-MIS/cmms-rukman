/**
 * QR & Barcode Scanner — Google Apps Script backend (JSON API only).
 *
 * This project no longer serves the scanner UI itself. Google applies a
 * Permissions-Policy to pages served from Apps Script's own domain
 * (script.googleusercontent.com) that blocks camera access outright —
 * this is a platform-level restriction, not something fixable from
 * Code.gs/Index.html. The scanner UI instead runs as a plain static HTML
 * page hosted elsewhere (e.g. Netlify Drop or GitHub Pages — see
 * static-site/index.html and README.md), which calls this deployment's
 * Web App URL as a JSON API to save each scan.
 *
 * Deploy via Deploy > New deployment > Web app. See README.md for the
 * full step-by-step setup and deployment guide.
 */

const SPREADSHEET_ID = '18c39NeNfjPv5PF6xhLzYLGZ4RK2upkjapqlDa_wRwcY';

function doGet() {
  return jsonResponse_({ ok: true, message: 'QR & Barcode Scanner API is running.' });
}

function doPost(e) {
  try {
    const body = JSON.parse((e.postData && e.postData.contents) || '{}');
    return jsonResponse_(saveScan_(body.value, body.scannedBy));
  } catch (err) {
    return jsonResponse_({ success: false, error: err.message });
  }
}

function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getFirstSheet_() {
  return SpreadsheetApp.openById(SPREADSHEET_ID).getSheets()[0];
}

/**
 * Appends [new Date(), value, scannedBy] as a new row to the first worksheet.
 */
function saveScan_(value, scannedBy) {
  if (!value || typeof value !== 'string' || !value.trim()) {
    return { success: false, error: 'Scanned value is empty' };
  }

  const scannedValue = value.trim();
  const scannedByValue = (typeof scannedBy === 'string' && scannedBy.trim())
    ? scannedBy.trim()
    : 'Unknown';

  const sheet = getFirstSheet_();
  const row = sheet.getLastRow() + 1;

  sheet.getRange(row, 1).setValue(new Date());

  // Force column B to plain-text format before writing, so numeric-looking
  // codes (leading zeros, long EAN/UPC digit strings) are stored exactly
  // as scanned instead of Sheets auto-converting them to a Number.
  const valueCell = sheet.getRange(row, 2);
  valueCell.setNumberFormat('@');
  valueCell.setValue(scannedValue);

  sheet.getRange(row, 3).setValue(scannedByValue);

  return { success: true };
}
