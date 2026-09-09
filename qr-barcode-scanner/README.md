# QR & Barcode Scanner → Google Sheets

A minimal mobile web app: open it on your phone, allow the camera, scan a
QR code or barcode, and the decoded value is automatically appended as a
new row in a Google Sheet. No typing, no login, no extra screens.

```
Open app → Allow camera → Scan QR/Barcode → Saved to Google Sheets → "Saved successfully" → ready for next scan
```

## Tech stack

- **Frontend**: React + Vite, camera scanning via [`@zxing/browser`](https://github.com/zxing-js/browser) (supports QR codes and common 1D barcodes: EAN-13/8, UPC-A/E, Code 128, Code 39, ITF, Codabar)
- **Backend**: Node.js + Express
- **Storage**: Google Sheets, via the Google Sheets API and a service account (credentials stay on the backend only — the browser never sees them)

## Project layout

```
qr-barcode-scanner/
├── backend/     # Express API — POST /api/scan → appends a row to Google Sheets
└── frontend/    # React + Vite app — camera preview + scanner
```

## 1. Set up the Google Sheet + service account

1. Create (or open) a Google Sheet. Add a header row: `Timestamp | Scanned Value`.
2. Copy the **spreadsheet ID** from its URL:
   `https://docs.google.com/spreadsheets/d/`**`THIS_PART`**`/edit`
3. In [Google Cloud Console](https://console.cloud.google.com/):
   - Create a project (or use an existing one).
   - Enable the **Google Sheets API** (APIs & Services → Library).
   - Go to **APIs & Services → Credentials → Create Credentials → Service account**.
   - Give it any name, finish creation (no extra roles needed).
   - Open the new service account → **Keys** tab → **Add Key → Create new key → JSON**. This downloads a JSON file.
4. From the downloaded JSON, you need two fields:
   - `client_email` → this is your `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `private_key` → this is your `GOOGLE_PRIVATE_KEY`
5. **Share the Google Sheet** with the service account's email address (the `client_email` value) and give it **Editor** access — otherwise it can't write rows.

## 2. Backend setup

```bash
cd backend
cp .env.example .env
```

Edit `backend/.env`:

- `GOOGLE_SHEET_ID` — from step 1.2 above
- `GOOGLE_SHEET_NAME` — the tab name (default `Sheet1`)
- `GOOGLE_SERVICE_ACCOUNT_EMAIL` — the `client_email` from the JSON key
- `GOOGLE_PRIVATE_KEY` — the `private_key` from the JSON key, wrapped in quotes exactly as it appears (it contains literal `\n` sequences — leave them as-is)
- `CORS_ORIGIN` — the URL the frontend will be served from (default `http://localhost:5173` for local dev)

Install and run:

```bash
npm install
npm run dev
```

The API starts on `http://localhost:4000` (`GET /health` for a quick check).

## 3. Frontend setup

```bash
cd frontend
cp .env.example .env
```

Edit `frontend/.env` if your backend isn't on `http://localhost:4000`.

Install and run:

```bash
npm install
npm run dev
```

Vite prints a local URL and a **Network** URL (`http://<your-computer-ip>:5173`).

## 4. Testing on a phone

Browsers only allow camera access (`getUserMedia`) on a **secure context**:
`localhost` or `https://`. Two ways to test on a real phone:

- **Same Wi-Fi**: open the **Network** URL Vite printed (e.g. `http://192.168.1.23:5173`) on your phone. This works on some Android browsers without HTTPS, but iOS Safari generally requires HTTPS for camera access — use the tunnel option below if it's blocked.
- **HTTPS tunnel** (works everywhere): run `npx localtunnel --port 5173` or `ngrok http 5173` and open the printed `https://` URL on your phone. Update `frontend/.env`'s `VITE_API_URL` and the backend's `CORS_ORIGIN` to match if you also tunnel the backend, or tunnel just the frontend and point `VITE_API_URL` at a publicly reachable backend.

On first load, the browser will ask for camera permission — allow it. The
app automatically prefers the rear ("environment") camera.

## How it works

1. The frontend continuously decodes frames from the live camera preview using ZXing.
2. On a successful decode, it shows the value, sends `POST /api/scan { value }` to the backend, and pauses accepting new scans.
3. The backend appends a `[Timestamp, Scanned Value]` row to the configured Google Sheet via the Sheets API, using the service account credentials from its environment variables.
4. The frontend shows "Saved successfully" (or an error message if the save failed), then automatically resumes scanning after a short delay. Rescanning the exact same code within a few seconds is ignored, to avoid double-saving one scan.

## Building for production

```bash
cd frontend && npm run build   # outputs static files to frontend/dist/
```

Serve `frontend/dist/` from any static host (must be HTTPS for camera access
in production) and deploy `backend/` as a normal Node/Express process,
setting the same environment variables from `backend/.env.example`. Point
the frontend's `VITE_API_URL` (set at build time) at the deployed backend's
URL, and set the backend's `CORS_ORIGIN` to the deployed frontend's URL.

## Troubleshooting

- **"Camera access denied or unavailable"** — check the browser's site
  permissions, and make sure you're on `localhost` or `https://`.
- **"Failed to save — try again"** — check the backend logs; usually a
  wrong `GOOGLE_SHEET_ID`, a private key that wasn't copied correctly, or
  the sheet not being shared with the service account's email.
- **CORS errors in the browser console** — make sure `CORS_ORIGIN` in
  `backend/.env` exactly matches the URL the frontend is served from.
