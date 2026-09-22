# RUDMS - Rukman Udyog Docs Management System

A Zoho WorkDrive-style document management portal that runs entirely on
Google Apps Script + Google Drive, designed to be embedded inside a
Google Sites page via `<iframe>`.

## Files

| File               | Purpose                                                             |
|--------------------|----------------------------------------------------------------------|
| `Code.gs`          | Backend: Drive folder setup, per-file metadata, upload, permissions, search API |
| `Index.html`       | Full Tailwind CSS UI, instant client-side search, upload/share/preview modals, Three.js CAD viewer |
| `appsscript.json`  | Web app manifest (execute as owner, accessible to anyone) |
| `assets/rukman-udyog-logo.png` | Source copy of the company logo (for reference/reuse only - the app itself embeds it as a base64 data URI directly inside `Index.html`, since Apps Script web apps can't serve separate static files) |

## How it works

- **Root folder**: On first run, RUDMS creates (or reuses)
  `Rukman Udyog Docs Management System (RUDMS)` in the Drive of whoever
  deploys the script.
- **Categories**: `RFQ`, `Purchase Orders`, `Purchase Bills`, `CAD Designs`
  are created automatically as sub-folders. Users can add more categories
  from the sidebar — each becomes a real Drive folder.
- **Metadata**: each file's viewers/editors/uploaded-by is stored as JSON
  directly on that Drive file's own `description` field - there is no
  separate index file. `getAllFiles()` builds the list by walking every
  category folder's files via `DriveApp` and reading each one's
  description. (An earlier version used a Google Sheet as an index, but
  in this deployment's environment every function that touched
  `SpreadsheetApp` - even ones whose return value contained no Sheets
  objects at all - reliably failed to have its response delivered back
  through `google.script.run`, while pure-`DriveApp` functions reliably
  worked. Rather than fight that, the whole app avoids `SpreadsheetApp`
  entirely.) The web app reads the full file list once on load; all
  search/filtering after that happens instantly in the browser (no
  server round-trip per keystroke).
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
    writes those emails directly onto each current file's own metadata
    (additively, on top of whatever access it already had) so the file
    list displays accurate access.
  - **By File** — a searchable table of every file with its current
    viewers/editors and an Edit shortcut into the same per-file Share
    modal described above.

  Use "By Folder" for broad, category-wide access (e.g. "everyone in
  Purchasing can view Purchase Orders"); use "By File" for one-off
  exceptions on a specific document.
- **Sign in / Sign out**: two independent paths.
  - **Google sign-in** — unchanged: gated by the visitor's Google account
    *before* the page even loads ("Who has access: Anyone" in the
    deployment step). The user menu (click your name, top-right) offers
    **Switch Account** (Google's account chooser) and **Sign Out**
    (`accounts.google.com/Logout`).
  - **Login accounts** — for people without a Google account. Create
    accounts from **Manage Access → Login Accounts** (username + password,
    min 6 characters; passwords are salted and SHA-256 hashed, never
    stored in plain text). A visitor with no Google session sees a login
    screen instead of the file browser; signing in issues a random
    session token (30-day expiry) stored in the browser's `localStorage`
    and sent back as `externalToken` on calls that need to know who's
    asking (currently just `uploadFile`, for the "Uploaded By" field).
    **Honest limitation**: this gates the RUDMS *client UI* - no login, no
    file browser - it is not a server-side authorization check on every
    function, since every function here is otherwise directly callable.
    That's an appropriate bar for keeping casual/public visitors out, not
    a defense against a determined technical attacker. If you need that
    level of hardening, every function would need to validate the token
    itself, which is a larger change.
- **Downloads**: proxied through `getFileContentForPreview()` on the
  server rather than a direct `drive.google.com` link, so both
  Google-signed-in and login-account visitors can download a file without
  needing Drive-level access to it themselves.
- **Previews**:
  - Images, PDFs, Word/Excel/PowerPoint → shown via Drive's built-in
    `/preview` iframe. **This still requires the viewing browser to have
    Drive-level access to that specific file** - it works for
    Google-signed-in visitors with the right Drive permissions, but a
    login-account (non-Google) visitor will see Drive's "you need access"
    message here even though they're signed into RUDMS. They can still
    use the (now server-proxied) Download button instead. Making preview
    itself Drive-independent for login accounts - fetching the blob
    server-side and rendering images/PDFs directly, as `getFileContentForPreview`
    already does for CAD files - is a reasonable follow-up if that
    matters for your use case.
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
   - Select the `ensureDefaultCategories` function in the toolbar dropdown
     and click **Run** once. Approve the Google OAuth consent screen (this
     grants the script permission to manage Drive files/folders on your
     behalf). This also pre-creates the RUDMS root folder and default
     category folders so the first real visitor doesn't pay that cost.

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
- **Per-file description as DB**: fine for hundreds to a few thousand
  files - `getAllFiles()` walks every category folder's files on each
  load. If you expect many more, consider a proper database (e.g.
  Firestore) behind the same `getAllFiles()`/`uploadFile()` function
  signatures - the frontend doesn't need to change.
- **Auditing**: `uploadedBy` is already tracked in each file's metadata;
  extend `buildFileMeta_`/`parseFileMeta_` if you need a fuller audit
  trail (e.g. a `modifiedBy`/`modifiedDate` field).
