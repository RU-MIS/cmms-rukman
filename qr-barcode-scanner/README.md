# QR & Barcode Scanner → Google Sheets (Google Apps Script)

A minimal mobile web app that scans QR codes and barcodes with your phone's
camera and automatically saves the decoded value into a Google Sheet. It
runs **entirely inside Google Apps Script** — no Node.js, no npm install, no
terminal, no separate server, no database, no login.

```
Google Sheet
    ↓
Google Apps Script (Code.gs)
    ↓
HTML + CSS + JavaScript Web App (Index.html)
    ↓
Mobile Camera
    ↓
QR / Barcode Scanner (html5-qrcode, loaded via CDN)
    ↓
Decoded Value
    ↓
Google Apps Script (saveScan)
    ↓
Google Sheet ("Scans" tab)
```

This project is wired to one specific spreadsheet: `Code.gs` has
`SPREADSHEET_ID` hardcoded to
`18c39NeNfjPv5PF6xhLzYLGZ4RK2upkjapqlDa_wRwcE`, and always writes to its
`Scans` tab.

## Files

- **`Code.gs`** — server-side script. `doGet()` serves the web app;
  `saveScan(value)` validates and appends a row to the `Scans` sheet (of
  the spreadsheet identified by `SPREADSHEET_ID`) via `SpreadsheetApp`.
- **`Index.html`** — the entire frontend: camera preview, Start/Stop
  buttons, latest scanned value, and a success/error message. Scanning
  uses [html5-qrcode](https://github.com/mebjas/html5-qrcode) (loaded from
  a CDN `<script>` tag — nothing to install) and calls the server function
  via `google.script.run`.

These two files are the actual source of truth — deployment is done by
copy-pasting their content into the Apps Script editor (steps below), not
by running any build step.

## 1. Prepare the Google Sheet

1. Open the spreadsheet at
   `https://docs.google.com/spreadsheets/d/18c39NeNfjPv5PF6xhLzYLGZ4RK2upkjapqlDa_wRwcE/edit`.
2. That's it for this step — `Code.gs` creates a `Scans` tab with the
   header row (`Timestamp` in A1, `Scanned Value` in B1) automatically
   the first time it runs, if that tab doesn't already exist.

## 2. Create the Apps Script project

Since `Code.gs` already targets the spreadsheet above by ID, you can
create the script either bound to that sheet or as a standalone project —
both work identically.

**Bound to the sheet (simplest):**

1. In the Sheet from step 1, go to **Extensions → Apps Script**.
2. Delete the default boilerplate content in the file named `Code.gs`
   (or `myFunction() {...}`), and paste in the contents of this repo's
   **`Code.gs`**.
3. Add the HTML file: click the **+** next to "Files" → **HTML** →
   name it exactly **`Index`** (Apps Script adds the `.html` extension
   automatically). Paste in the contents of this repo's **`Index.html`**.
4. Save the project (**Ctrl/Cmd+S**), and give it a name if prompted
   (e.g. "QR Barcode Scanner").

**Standalone (alternative):** create the project from
https://script.google.com instead, then follow the same steps 2–4 above.

## 3. Deploy as a web app

1. In the Apps Script editor, click **Deploy → New deployment**.
2. Click the gear icon next to "Select type" and choose **Web app**.
3. Fill in:
   - **Description**: anything, e.g. "v1"
   - **Execute as**: **Me**
   - **Who has access**: **Anyone** (so it opens directly on a phone with
     no Google sign-in — this app deliberately has no login)
4. Click **Deploy**. The first time, Google will ask you to **authorize**
   the script's access to Google Sheets — click through the consent
   screen (you'll see an "unverified app" warning since this is your own
   personal script; click **Advanced → Go to [project name] (unsafe)** to
   proceed — this is expected for scripts you write yourself).
5. Copy the **Web app URL** it gives you (looks like
   `https://script.google.com/macros/s/AKfycb.../exec`). This is the URL
   you open on your phone.

**Note on access**: since "Execute as: Me" + "Anyone" means anyone with
this URL can add rows to your sheet without signing in — that's
intentional, matching the "no login" requirement, but keep the URL
private if that matters to you.

## 4. Use it on your phone

1. Open the Web app URL on your phone's browser.
2. Tap **Start Scanner** and allow camera access when prompted.
3. Point the camera at a QR code or barcode. On a successful scan:
   - The decoded value appears under "Last scanned".
   - It's automatically sent to `saveScan()` and appended to the `Scans`
     tab as a new row: `[Timestamp, Scanned Value]`.
   - You'll see "Saved successfully", then scanning automatically resumes
     for the next code.
4. Tap **Stop Scanner** to turn off the camera when you're done.

Scanning the exact same code again within a few seconds is ignored, so a
single scan can't accidentally get saved twice.

## Updating the app after making changes

Editing `Code.gs` or `Index.html` in the script editor does **not**
automatically update the live URL — you must publish a new version:

**Deploy → Manage deployments → (pencil/edit icon on your deployment) →
Version: New version → Deploy**

## Troubleshooting

Tapping **Start Scanner** now requests camera access directly via
`navigator.mediaDevices.getUserMedia`, so the browser's permission prompt
should always appear. If it doesn't, or scanning still fails, the status
message tells you the specific reason:

- **"Camera permission denied..."** — you (or a previous visit) denied
  camera access for this page. Use the site/lock icon next to the address
  bar → Permissions/Site settings → allow Camera, then reload.
- **"No camera found on this device."** — the browser found no camera at
  all (e.g. testing on a desktop with no webcam).
- **"Camera is already in use by another app or browser tab."** — close
  whatever else has the camera open (another tab, a video call app) and
  try again.
- **"Camera blocked for security reasons..."** / **"Camera API not
  available in this browser context..."** — you're not on the real
  deployed web app URL. Make sure you opened the `.../exec` link directly
  (it must be `https://`), not a preview link inside the Apps Script
  editor, and not this page embedded inside another site's iframe.
- **"Permission granted, but the scanner could not start..."** — camera
  access was granted, so this is a `html5-qrcode` startup error unrelated
  to permissions; the message includes the underlying error detail.
- **Nothing happens after scanning / "Failed to save"** — open
  **Executions** in the left sidebar of the Apps Script editor to see the
  actual error from `saveScan`. The most common cause is `SPREADSHEET_ID`
  being set incorrectly, or the script not having been authorized yet.
- **Old behavior after editing the code** — you're still on an old
  deployment version; see "Updating the app after making changes" above.
