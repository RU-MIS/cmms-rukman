// =====================================================================
//  Rukman Portal (Google Apps Script): sign-in is done by Google.
//  Each person sees only the sheets, forms and apps listed for their email.
//  Files in this project: Code.gs (this file) and Index.html.
// =====================================================================

// ====== SETTINGS ======
const SHEET_ID     = '1C5VYni5bUTOPCVbTprnzU4jDJ3V7qf66rlgFF5zY7V8';
const ACCESS_SHEET = 'Portal_Access';   // EMAIL | TITLE | TYPE | URL | DEPARTMENT
const USERS_SHEET  = 'Users';           // EMAIL | NAME   (other columns are ignored)
const PORTAL_TITLE = 'Rukman Portal';
const DEFAULT_DEPARTMENT = 'General';   // used when the DEPARTMENT column is empty
const CACHE_SECONDS = 60;               // sheet data is cached this long (speed); edits show up within this time
// ======================

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle(PORTAL_TITLE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/** Called by the page. Returns the signed-in person's name and links. */
function getMyLinks() {
  const me = (Session.getActiveUser().getEmail() || '').toLowerCase().trim();
  if (!me) {
    return { error: 'We could not detect your email. Please sign in to your Google account and open the portal link again.' };
  }

  const users = rows_('users', USERS_SHEET);
  const match = users.slice(1).find(function (r) { return String(r[0]).toLowerCase().trim() === me; });
  const name  = match ? String(match[1] || '').trim() : '';

  const items = rows_('items', ACCESS_SHEET).slice(1)
    .filter(function (r) { return String(r[0]).toLowerCase().trim() === me && r[3]; })
    .map(function (r) {
      return {
        title: String(r[1]),
        type:  String(r[2]).toLowerCase().trim(),
        url:   String(r[3]).trim(),                       // opens exactly as saved in Portal_Access
        dept:  String(r[4] || '').trim() || DEFAULT_DEPARTMENT
      };
    });

  return { user: { name: name, email: me }, items: items };
}

/** Sheet rows, from the script cache when possible (opening a spreadsheet is slow). */
function rows_(key, sheetName) {
  const cache = CacheService.getScriptCache();
  const hit = cache.get(key);
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  const sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName(sheetName);
  const rows = sh ? sh.getDataRange().getValues() : [];
  try { const txt = JSON.stringify(rows); if (txt.length < 90000) cache.put(key, txt, CACHE_SECONDS); } catch (e) {}
  return rows;
}
