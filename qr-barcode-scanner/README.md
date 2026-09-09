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

## Files

- **`Code.gs`** — server-side script. `doGet()` serves the web app;
  `saveScan(value)` validates and appends a row to the `Scans` sheet via
  `SpreadsheetApp`.
- **`Index.html`** — the entire frontend: camera preview, Start/Stop
  buttons, latest scanned value, and a success/error message. Scanning
  uses [html5-qrcode](https://github.com/mebjas/html5-qrcode) (loaded from
  a CDN `<script>` tag — nothing to install) and calls the server function
  via `google.script.run`.

These two files are the actual source of truth — deployment is done by
copy-pasting their content into the Apps Script editor (steps below), not
by running any build step.

## 1. Create the Google Sheet

1. Create a new Google Sheet (or open an existing one you want to use).
2. That's it for this step — `Code.gs` creates a `Scans` tab with the
   header row (`Timestamp | Scanned Value`) automatically the first time
   it runs, if it doesn't already exist.

## 2. Create the Apps Script project (bound to that Sheet)

1. In the Sheet, go to **Extensions → Apps Script**. This opens a script
   project that's automatically "bound" to this spreadsheet — meaning
   `Code.gs` can use `SpreadsheetApp.getActiveSpreadsheet()` with no
   configuration needed.
2. Delete the default boilerplate content in the file named `Code.gs`
   (or `myFunction() {...}`), and paste in the contents of this repo's
   **`Code.gs`**.
3. Add the HTML file: click the **+** next to "Files" → **HTML** →
   name it exactly **`Index`** (Apps Script adds the `.html` extension
   automatically). Paste in the contents of this repo's **`Index.html`**.
4. Save the project (**Ctrl/Cmd+S**), and give it a name if prompted
   (e.g. "QR Barcode Scanner").

> If you'd rather run this as a **standalone** script not bound to a
> specific sheet, create it from https://script.google.com instead, then
> set `SPREADSHEET_ID` near the top of `Code.gs` to the target sheet's ID
> (the long string in its URL: `.../spreadsheets/d/`**`THIS_PART`**`/edit`).

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

- **"Camera access denied or unavailable"** — check your phone browser's
  site permissions for camera access, and make sure you opened the
  `.../exec` URL (not the script editor URL).
- **Nothing happens after scanning / "Failed to save"** — open
  **Executions** in the left sidebar of the Apps Script editor to see the
  actual error from `saveScan`. The most common cause is `SPREADSHEET_ID`
  being set incorrectly, or the script not having been authorized yet.
- **Old behavior after editing the code** — you're still on an old
  deployment version; see "Updating the app after making changes" above.
