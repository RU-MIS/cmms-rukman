# RUDMS - Rukman Udyog Docs Management System

A Zoho WorkDrive-style document management portal that runs entirely on
Google Apps Script + Google Drive + Google Sheets, designed to be embedded
inside a Google Sites page via `<iframe>`.

## Files

| File               | Purpose                                                             |
|--------------------|----------------------------------------------------------------------|
| `Code.gs`          | Backend: Drive folder setup, Sheet-based metadata index, upload, permissions, search API |
| `Index.html`       | Full Tailwind CSS UI, instant client-side search, upload/share/preview modals, Three.js CAD viewer |
| `appsscript.json`  | Web app manifest (execute as owner, accessible to anyone) |

## How it works

- **Root folder**: On first run, RUDMS creates (or reuses)
  `Rukman Udyog Docs Management System (RUDMS)` in the Drive of whoever
  deploys the script.
- **Categories**: `RFQ`, `Purchase Orders`, `Purchase Bills`, `CAD Designs`
  are created automatically as sub-folders. Users can add more categories
  from the sidebar — each becomes a real Drive folder.
- **Metadata index**: A Google Sheet named `RUDMS_Index` is created inside
  the root folder and used as a lightweight database (File ID, Name,
  Category, Drive Link, Type, Viewers, Editors, Upload Date, Uploaded By,
  Size). The web app reads this sheet once on load; all search/filtering
  after that happens instantly in the browser (no server round-trip per
  keystroke).
- **Permissions**: On upload, the file is set to private, then
  `DriveApp.addViewer()` / `addEditor()` is called for each email you list.
  You can change access later from a file's "Share / Access" menu, which
  fully re-syncs viewers/editors.
- **Manage Access center**: the header's **Manage Access** button (also
  reachable via the lock icon that appears on hover over any category in
  the sidebar) opens a two-tab panel:
  - **By Folder** — set Drive-level viewer/editor emails on an entire
    category folder in one go. Google Drive automatically extends that
    same access to every file inside the folder, including files uploaded
    later. An optional "also stamp existing files" checkbox additionally
    writes those emails directly onto each current file (additively, on
    top of whatever access it already had) and refreshes the index Sheet
    so the file list displays accurate access.
  - **By File** — a searchable table of every file with its current
    viewers/editors and an Edit shortcut into the same per-file Share
    modal described above.

  Use "By Folder" for broad, category-wide access (e.g. "everyone in
  Purchasing can view Purchase Orders"); use "By File" for one-off
  exceptions on a specific document.
- **Previews**:
  - Images, PDFs, Word/Excel/PowerPoint → shown via Drive's built-in
    `/preview` iframe (requires the viewing user to have access, exactly
    as granted above).
  - `.stl` and `.obj` → rendered live in an interactive WebGL viewer
    (Three.js + `STLLoader`/`OBJLoader` + `OrbitControls`) — rotate with
    drag, zoom with scroll, no download needed.
  - `.dwg`, `.dxf`, `.step`/`.stp` → **honest limitation**: these are
    proprietary/complex CAD formats with no reliable client-side WebGL
    parser. The portal shows a clear "download to view in your CAD
    application" message instead of pretending to render them. If you
    need in-browser 2D/3D preview for these specifically, the practical
    options are (a) a paid conversion API that outputs glTF/STL server-side,
    or (b) Autodesk Forge Viewer (separate paid service) — both are outside
    the scope of a single Apps Script file.

## Deployment (step by step)

1. **Create the Apps Script project**
   - Go to [script.google.com](https://script.google.com) → **New project**.
   - Rename the project to `RUDMS`.

2. **Add the files**
   - Delete the default empty `Code.gs` content and paste in this repo's
     `Code.gs`.
   - Click **+ → HTML** file, name it exactly `Index` (Apps Script adds the
     `.html` extension itself), and paste in this repo's `Index.html`.
   - Click the gear icon → **Project Settings** → **Show "appsscript.json"
     manifest file in editor**, then open it and replace its contents with
     this repo's `appsscript.json` (or set the equivalent values under
     **Deploy → Deployment configuration** later — see step 4).

   (If you use [`clasp`](https://github.com/google/clasp) instead of the
   web editor: `clasp create --type webapp --title RUDMS`, copy these three
   files into the resulting folder, then `clasp push`.)

3. **Save and run once to authorize**
   - Save the project (Ctrl/Cmd+S).
   - Select the `initializeSystem` function in the toolbar dropdown and
     click **Run** once. Approve the Google OAuth consent screen (this
     grants the script permission to manage Drive files/folders and Sheets
     on your behalf). This also pre-creates the RUDMS folder and index
     sheet so the first real visitor doesn't pay that cost.

4. **Deploy as a Web App**
   - Click **Deploy → New deployment**.
   - Click the gear icon next to "Select type" → **Web app**.
   - Description: `RUDMS v1`.
   - **Execute as**: `Me (your-email@rukmanudyog.com)` — this is what lets
     the script create folders/files and manage permissions using your
     Drive, regardless of who is viewing the page.
   - **Who has access**: `Anyone` (recommended: `Anyone with a Google
     account` rather than fully anonymous — since the app grants
     Viewer/Editor access by email and reads `Session.getActiveUser()`,
     visitors need to be signed in to a Google account for permissions and
     attribution to work correctly).
   - Click **Deploy**, then **Authorize access** again if prompted.
   - Copy the generated **Web app URL** (`https://script.google.com/macros/s/XXXXXXXX/exec`).

5. **Re-deploying after future edits**
   - Apps Script does not auto-update a live deployment when you edit code.
   - Use **Deploy → Manage deployments → (pencil icon) → New version →
     Deploy** to push code changes to the same URL.

## Embedding in Google Sites

1. Open your Google Site in edit mode.
2. Insert → **Embed** → **Embed code**.
3. Paste:
   ```html
   <iframe
     src="https://script.google.com/macros/s/XXXXXXXX/exec"
     style="width:100%; height:900px; border:0;"
     allow="clipboard-write">
   </iframe>
   ```
   (Replace the URL with your deployed Web App URL.)
4. Click **Insert**, then resize the embed block to fill the page.
5. Publish the site.

`Index.html` already calls
`.setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)` in
`doGet()`, which is what allows Google Sites (or any page) to load it
inside an `<iframe>` — without it, browsers block the embed.

## Notes / production hardening ideas

- **Sharing Drive quota**: files live in the deploying account's Drive, so
  that account's storage quota applies to all uploads.
- **Large files**: `google.script.run` payloads are base64-encoded in
  memory on both ends; very large CAD files (100MB+) may be slow to
  upload/preview. Consider a lower practical limit (e.g. 25–50MB) for a
  snappy UI.
- **Sheet as DB**: fine for hundreds to a few thousand files. If you expect
  many more, consider swapping `readAllRows_()`/`appendIndexRow_()` for a
  proper database (e.g. Firestore) behind the same function signatures —
  the frontend doesn't need to change.
- **Auditing**: `Uploaded By` is already tracked; add a similar `Modified
  By`/`Modified Date` column if you need a fuller audit trail.
