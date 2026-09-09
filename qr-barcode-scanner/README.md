# QR & Barcode Scanner → Google Sheets

A minimal mobile web app that scans QR codes and barcodes with your phone's
camera and automatically saves the decoded value into a Google Sheet.

```
Static HTML page (static-site/index.html)
    ↓
Mobile Camera
    ↓
QR / Barcode Scanner (html5-qrcode, loaded via CDN)
    ↓
Decoded Value
    ↓
fetch() → Google Apps Script Web App (Code.gs, JSON API)
    ↓
Google Sheet (first worksheet/tab)
```

## Why two pieces, not one?

The first version of this project served the scanner page directly from
Google Apps Script (`HtmlService`). That doesn't work: Google applies a
Permissions-Policy to every page served from Apps Script's own domain
(`script.googleusercontent.com`) that blocks camera access outright — no
permission prompt ever appears, on any device or browser, no matter what
the page's own JavaScript does. This is a platform-level restriction,
confirmed by testing camera access on an unrelated site in the same
browser (works fine) versus the Apps Script URL (never prompts) — it is
not fixable from `Code.gs` or `Index.html`.

So the app is split in two:

- **`Code.gs`** — a Google Apps Script Web App that does nothing but
  receive a scanned value and append it to the Sheet. No UI, no camera
  code, so it never touches the restriction above. Still 100% free, still
  no database, no login, no Node.js/Express — just Apps Script.
- **`static-site/index.html`** — the entire scanner UI (camera preview,
  Start/Stop buttons, `html5-qrcode` scanning) as one plain static HTML
  file, hosted anywhere that serves plain files over HTTPS (Netlify Drop,
  GitHub Pages, Cloudflare Pages, ...). Plain static hosting isn't
  Apps Script's domain, so the camera restriction doesn't apply and
  `getUserMedia` works normally. It calls the deployed Apps Script URL
  with `fetch()` to save each scan — still no server code to write or run
  yourself, just static file hosting.

Both pieces are wired to one spreadsheet: `Code.gs` has `SPREADSHEET_ID`
hardcoded to `18c39NeNfjPv5PF6xhLzYLGZ4RK2upkjapqlDa_wRwcY`, and always
writes to its **first worksheet/tab** — it never creates or touches any
other sheet.

## 1. Prepare the Google Sheet

1. Open the spreadsheet at
   `https://docs.google.com/spreadsheets/d/18c39NeNfjPv5PF6xhLzYLGZ4RK2upkjapqlDa_wRwcY/edit`.
2. Make sure its **first tab** has the header row: `Timestamp` in A1,
   `Scanned Value` in B1.

## 2. Deploy the Apps Script API

1. From the sheet in step 1: **Extensions → Apps Script**.
2. Delete the default boilerplate, paste in this repo's **`Code.gs`**
   (that's the only file this project needs — no HTML file this time).
3. Save (**Ctrl/Cmd+S**), name the project if prompted.
4. **Deploy → New deployment** → gear icon → **Web app**.
5. Set **Execute as: Me**, **Who has access: Anyone** → **Deploy**.
6. Authorize when prompted (you'll see an "unverified app" warning since
   it's your own script — **Advanced → Go to [project name] (unsafe) →
   Allow**).
7. Copy the **Web app URL** (`https://script.google.com/macros/s/AKfycb.../exec`).
   You'll paste this into the static page next.

**Note on access**: "Execute as: Me" + "Anyone" means anyone who has this
URL can add rows to your sheet without signing in — intentional (no
login), but keep the URL reasonably private if that matters to you.

## 3. Wire up the static page

1. Open `static-site/index.html` in a text editor.
2. Find this line near the top of the `<script>` block:
   ```js
   const APPS_SCRIPT_URL = 'PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE';
   ```
3. Replace the placeholder with the exact Web app URL you copied in step 2.7.
4. Save the file.

## 4. Host the static page

**Easiest — Netlify Drop (no account needed):**

1. Go to https://app.netlify.com/drop
2. Drag `static-site/index.html` onto the page.
3. Netlify gives you an instant `https://random-name.netlify.app` URL —
   that's your scanner app.

(To keep the URL stable across future edits, create a free Netlify
account and re-drop the updated file to the same site, or connect a
GitHub repo instead — see Netlify's own docs for that.)

**Alternative — GitHub Pages:** if this repository is public (or you have
a plan that supports Pages on private repos), enable Pages under
**Settings → Pages**, set the source to this branch and the
`qr-barcode-scanner/static-site` folder, and GitHub gives you a
`https://<user>.github.io/...` URL instead.

Either way, you need an **HTTPS** URL — camera access requires it.

## 5. Use it on your phone

1. Open your static page's URL (from step 4) on your phone's browser.
2. Tap **Start Scanner** and allow camera access when prompted.
3. Point the camera at a QR code or barcode. On a successful scan:
   - The decoded value appears under "Last scanned".
   - It's sent via `fetch()` to your Apps Script URL, which appends it to
     the first worksheet as a new row: `[Timestamp, Scanned Value]`.
   - You'll see "Saved successfully", then scanning automatically resumes
     for the next code.
4. Tap **Stop Scanner** to turn off the camera when you're done.

Scanning the exact same code again within a few seconds is ignored, so a
single scan can't accidentally get saved twice.

## Updating after making changes

- **Changed `Code.gs`**: editing it in the script editor does **not**
  update the live API URL — you must publish a new version:
  **Deploy → Manage deployments → pencil/edit icon → Version: New
  version → Deploy**. The URL stays the same, so `static-site/index.html`
  doesn't need to change.
- **Changed `static-site/index.html`**: re-drop the file on
  https://app.netlify.com/drop (or push to whatever host you chose).

## Troubleshooting

- **Camera permission prompt never appears, on any device** — make sure
  you're opening the **static page's URL** (Netlify/GitHub Pages), not
  the Apps Script `.../exec` URL directly. The Apps Script URL is an API
  endpoint now; it has no UI and will never show a camera prompt (that's
  the whole reason for this split — see "Why two pieces, not one?" above).
- **"Camera permission denied..."** — you (or a previous visit) denied
  camera access for the static page's origin. Use the site/lock icon next
  to the address bar → Permissions/Site settings → allow Camera, then
  reload.
- **"No camera found on this device."** — no camera detected at all.
- **"Camera is already in use by another app or browser tab."** — close
  whatever else has the camera open and try again.
- **"Failed to save" after a scan** — open your Apps Script project →
  **Executions** (left sidebar) to see the actual error from `doPost`.
  Common causes: `APPS_SCRIPT_URL` in `static-site/index.html` wasn't
  updated with the real deployed URL, `SPREADSHEET_ID` is wrong, or the
  Apps Script deployment hasn't been authorized yet.
- **CORS error in the browser console** — double-check `APPS_SCRIPT_URL`
  is the `.../exec` URL (not `.../dev`), and that you redeployed after
  any `Code.gs` change (old deployment versions can behave differently).
