# Rukman Portal

Login ID + password portal with email OTP (first-time / forgot password), department view,
and installable as an app (PWA) on desktop and mobile.

| File | Goes where |
|---|---|
| `Code.gs` | Google Apps Script (backend API) |
| `index.html`, `sw.js`, `manifest.webmanifest`, `*.png` | Static hosting, e.g. Netlify Drop |

## 1. Google Sheet (one file, three tabs)

**Portal_Access**: `EMAIL | TITLE | TYPE | URL | DEPARTMENT`

**Users**: `EMAIL | NAME | LOGIN ID | SALT (auto) | HASH (auto) | STATUS`
- Fill only EMAIL, NAME and (optionally) LOGIN ID. Leave SALT and HASH empty; the script fills them.
- STATUS = `disabled` blocks a user. To force a new password, clear that user's SALT and HASH cells.

**Sessions**: created automatically.

Do **not** share this spreadsheet with users. Only the owner needs access.

## 2. Backend (Apps Script)
1. Paste `Code.gs` into the Apps Script project, set `SHEET_ID`.
2. Run `setup` once from the editor and approve the permissions (Sheets + send email).
3. Deploy > New deployment > Web app: **Execute as: Me**, **Who has access: Anyone**.
4. Copy the Web app URL (ends with `/exec`).
5. After any change to `Code.gs`: Deploy > Manage deployments > Edit > New version.

## 3. Front end
1. In `index.html` set `API_URL` to the Web app URL.
2. Upload this folder to https://app.netlify.com/drop (or any static host with HTTPS).
3. Open the site URL. Chrome/Edge show an **Install** option; on iPhone use Share > Add to Home Screen.

Users sign in with email or LOGIN ID. First time: "First time or forgot password?" > code by email > choose password.

Remember me (one checkbox, ticked by default): keeps the user signed in for 30 days, renewed every time the app is
opened (hard limit 90 days). The login ID is remembered, so after expiry only the password is needed. The password itself
is never stored by the portal; the browser may also offer to save it, and then signs in again automatically.
Not ticked: a 12-hour session that is never renewed.

## Limits to know
- OTP emails use `MailApp`: about 100/day on a normal Gmail account, 1,500/day on Workspace.
- The portal login only controls the list of links. Opening a Sheet or Form is still decided by
  Google Drive sharing, so share each file with the user's Google account as Viewer.
