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
| `pwa-shell/` | A separate, optional static site that makes RUDMS installable as a real app (desktop + mobile) - see `pwa-shell/README.md`. Not deployed to Apps Script; hosted anywhere static (e.g. Netlify, free). |

## How it works

- **Root folder**: On first run, RUDMS creates (or reuses)
  `Rukman Udyog Docs Management System (RUDMS)` in the Drive of whoever
  deploys the script.
- **Categories & nested subfolders**: `RFQ`, `Purchase Orders`,
  `Purchase Bills`, `CAD Designs` are created automatically as top-level
  folders. The sidebar's **Add Category** button (and every folder row's
  own **+** on hover) creates a real Drive folder - with no depth limit,
  so a chain like `RFQ → 2024 → ClientA → Drawings` is just as valid as a
  single flat category. Which one you get depends on where you click it
  from: the top **Add Category** button creates a subfolder inside
  whichever folder is currently open in the sidebar (or a new top-level
  category if you're on "All Files"), and a folder row's own **+**
  always creates a subfolder inside that specific folder regardless of
  what's currently open - the popup tells you which before you confirm.
  Click a folder's name to browse the files directly inside it (not its
  subfolders' files - drill into those separately, same as Drive or
  Windows Explorer); click the triangle next to a folder with children to
  expand/collapse it. A file's `category` field is its full path (e.g.
  `"RFQ/2024/ClientA"`), which is also what the Upload window's folder
  dropdown and the Manage Access → By Folder tab both show/target -
  there's no separate "nested folder" concept anywhere in the code, it's
  the same category string everywhere, just allowed to contain `/`.
- **Metadata**: each file's viewers/editors/downloaders/uploaded-by is
  stored as JSON directly on that Drive file's own `description` field -
  there is no separate index file. `getAllFiles()` builds the list by
  walking every category folder's files via `DriveApp` and reading each
  one's description. (An earlier version used a Google Sheet as an index,
  but in this deployment's environment every function that touched
  `SpreadsheetApp` - even ones whose return value contained no Sheets
  objects at all - reliably failed to have its response delivered back
  through `google.script.run`, while pure-`DriveApp` functions reliably
  worked. Rather than fight that, the whole app avoids `SpreadsheetApp`
  entirely.) The web app reads the full file list once on load; all
  search/filtering after that happens instantly in the browser (no
  server round-trip per keystroke).
- **Permissions model**: RUDMS does **not** use real Google Drive sharing
  (`DriveApp.addViewer()`/`addEditor()`) for access control - every file
  stays owned by (and only directly Drive-accessible to) the deploying/
  admin Google account, regardless of who uploaded it through RUDMS or
  what role they have (see Roles below). "Viewers"/"Editors"/"Downloaders"
  on a file are RUDMS login identities (a username or the email on that
  login account), checked entirely in RUDMS's own server code
  (`canViewFileMeta`/`canEditFileMeta`/`canDownloadFileMeta` in `Code.gs`)
  against whoever's signed-in session is asking - not a Drive-level
  permission at all. You set them from a file's "Share / Access" menu (or
  in bulk for a whole folder from Manage Access → By Folder), and an
  admin can always override any of them for any specific file.
- **Duplicate prevention**: uploading a file whose name already exists in
  that same category (case-insensitive - `logo.PNG` and `logo.png` count
  as the same file, but `logo.png` and `logo.jpeg` don't) is blocked
  server-side. The Upload window itself shows this inline - right in the
  same popup, not just a toast - with a **"Delete existing file & upload
  this instead"** button that removes the old file and immediately
  retries the upload, so replacing a file is one click instead of a
  separate trip to delete it first.
- **Manage Access center**: the header's **Manage Access** button (also
  reachable via the lock icon that appears on hover over any category in
  the sidebar) opens a multi-tab panel, with tabs shown based on role:
  - **By Folder** (admin-only) — set a default viewer-restriction/editor/
    downloader list (RUDMS usernames/emails) for an entire category folder
    (or any nested subfolder, listed by its full path like
    `RFQ/2024/ClientA`) in one go, stored as the same kind of JSON on the
    folder's own Drive description. An optional "also stamp existing
    files" checkbox additionally writes those lists directly onto each
    current file's own metadata (additively, on top of whatever access it
    already had, but only for files directly in that folder, not nested
    ones) so the file list displays accurate access.
  - **By File** (admin-only) — a searchable table of every file with its
    current viewers/editors/downloaders and an Edit shortcut into the same
    per-file Share modal described above.
  - **Doer List** (everyone) — the Viewer/Editor/Downloader-field
    autocomplete contacts list; unrelated to login accounts or roles (see
    the FAQ-style note in Roles below if this is confusing coming from an
    older version of this README).
  - **Delete Requests** (editor/admin) — see "Delete requests" under Roles
    below.
  - **Login Accounts** (admin-only) — create/promote/remove login
    accounts.

  Use "By Folder" for broad, category-wide overrides (e.g. "Aayush can
  download everything in Purchase Orders"); use "By File" for one-off
  exceptions on a specific document.
- **Sign in / Sign out**: everyone - regardless of whether they have a
  Google account - signs in with a **username and password**. Google
  identity is not used as a login gate at all.
  - **Creating accounts** happens two ways:
    - **Admin-created**: from **Manage Access → Login Accounts**
      (admin-only tab; username + password, min 6 characters, and a
      **Viewer / Editor / Admin** role - see Roles below).
    - **Self-signup**: anyone with the RUDMS link can create their own
      account from the login screen's **Sign Up** tab - email, full
      name, and a password they choose. The username is always their
      email address, the role is always `viewer` (view + upload, rename
      own uploads, never `admin`/`editor` - self-signup can never create
      one of those), and the account is active immediately - no approval
      step. On success they're signed straight in, and an email with the
      new username/password goes to both the person themselves and
      everyone on the "notify on password change" list (Manage Access →
      Login Accounts) - reusing that same list rather than a second one,
      since it already means "people who want to know about credential
      events."
    - **Security tradeoff of self-signup**: anyone with the URL can get a
      `viewer` account (view + upload their own files) by creating one
      themselves - this is enforced server-side (see Roles below), so a
      self-signed-up account genuinely cannot download or touch anyone
      else's file. If even that's a concern, don't publicize the URL
      beyond people who should have it, or put it behind a network you
      control (e.g. only embedded on an internal Google Site).
    Passwords are salted and SHA-256 hashed either way, never stored in
    plain text.
  - **Forgot password**: works for every account, admin included - no
    admin needed to reset it. From the login screen's **Forgot
    password?** link: enter your username or email, RUDMS emails a
    6-digit code (expires in 10 minutes, max 5 wrong guesses before it's
    invalidated); enter that code plus a new password on the same
    screen, which resets the password and signs you straight in - no
    admin involvement, no clickable link to worry about.
    - Which email it goes to: a self-signup account's username already
      *is* an email, so that's used automatically. An admin-created
      account only has an email on file if one was entered in the
      optional **Email** field when it was created (Manage Access →
      Login Accounts) - without one, "Forgot password" has nowhere to
      send the code and tells you to ask an admin instead. Give every
      admin-created account (especially admin ones) an email when you
      create it, so this always has somewhere to go.
    - The code itself is the proof of identity in place of the old
      password `changeOwnPassword()` normally requires - `resetPasswordWithOtp()`
      checks it server-side and only then updates the password, so this
      never weakens the ordinary Change Password flow (which still
      requires the current password) for anyone who didn't go through
      this flow.
  - **Bootstrapping the very first account**: nobody can reach "Login
    Accounts" before at least one account exists, so the first one is
    created directly in the Apps Script editor. Select `setupFirstAdmin`
    in the toolbar's function dropdown and click **Run** once - it
    creates username `admin` / password `ChangeMe123` as an admin. Sign
    in with that, then immediately create your real admin account(s) (for
    the CEO/MD etc.) from the Login Accounts tab - **with their email
    filled in**, so "Forgot password" works for them later - and remove
    the bootstrap `admin` account.
    - **`setupDefaultAdmins`**: a second, one-time editor function (same
      idea as `setupFirstAdmin`, select it in the dropdown and click
      **Run**) that makes `aayush@rukmanudyog.com` and
      `jatin@rukmanudyog.com` admins directly - promoting their accounts
      if they already exist, or creating new admin accounts for them
      (temporary password `Rukman@123`, which they should change from
      the user menu after signing in) if they don't. Exists so this
      specific promotion never depends on already knowing an admin's
      password.
  - **Roles** - three tiers, enforced **server-side** on every function
    that matters (not just by hiding buttons in the UI - see "What's
    actually enforced" below), with per-file overrides an admin can set
    on top of them:
    - `admin` - full control of every file: upload, view, download,
      rename/edit, delete, manage access (By Folder/By File per-file
      overrides), manage login accounts, approve/reject delete requests.
      Files always belong to the admin/deploying Google account's Drive
      regardless of who uploaded them through RUDMS - that's just how
      this single shared Drive folder has always worked; "uploaded by" is
      purely a RUDMS-level label, not a Drive ownership change.
    - `editor` - can view every file and upload new ones. Can rename or
      delete a file directly, without anyone's approval, **only** if they
      uploaded it themselves or an admin specifically granted them that
      file (the "Can edit / rename / delete" field in Share / Access).
      Can't touch any other file at all. Can also review and
      approve/reject any viewer's delete request (see "Delete requests"
      below) - that reviewing power applies company-wide, it isn't scoped
      to only the files they personally have edit rights on.
    - `viewer` - can view every file and upload new ones. Can rename (but
      not delete) their own uploads directly. To delete their own upload,
      they send a **delete request** instead (see below) - they have no
      access at all, not even an exception, on a file they didn't upload
      and weren't admin-granted. Default role for self-signup; also the
      default when an admin creates a login without picking a different
      role.
    - No role gets to **download** a file by default - that's admin-only
      unless an admin explicitly adds someone to that specific file's (or
      folder's) "Can download" list, regardless of their role.
    - Honest limitation on "view-only": once a file is shown in the
      browser for preview, there's no way to make the bytes
      un-extractable by a technically determined person (e.g. browser
      dev tools) - showing something in a web page always means sending
      it to that page. What RUDMS actually enforces is the dedicated
      **Download** action itself (the button, and the server call behind
      it) requiring real download rights, which is the real-world bar
      that matters for ordinary staff.
    - **Delete requests** (Manage Access → Delete Requests, visible to
      editors/admins only): a viewer's only path to deleting their own
      upload. They click **Request Delete Approval** on the file's menu;
      every current editor/admin gets a best-effort email, and the
      request sits in this tab until an editor or admin clicks **Approve**
      (deletes the file immediately) or **Reject** (dismisses it) - either
      way the requester gets a best-effort email of the outcome. There's
      no in-between "temporarily allowed to delete it themselves" state -
      approving performs the deletion there and then.
    - **Who's admin, and how anyone finds out**: the Login Accounts list
      shows a role badge (VIEWER/EDITOR/ADMIN) next to each account's
      name - but that whole tab is admin-only, so a non-admin has no way
      to see it from inside the app. For them, the user menu (top-right
      avatar) shows their own role badge plus an **"Admin / contact for
      access"** line with every admin's name (and email, if one is on
      file) - visible to every signed-in account, specifically so anyone
      knows who to ask.
    - **Changing an existing account's role**: from Manage Access →
      Login Accounts, each row has a **Viewer/Editor/Admin** dropdown -
      no need to delete and recreate the account (which would also mean
      picking a new password). The last remaining admin can't be demoted
      away from admin this way (or removed via **Remove**) - RUDMS blocks
      it, since that would lock everyone out of Login Accounts with no
      way back in short of re-running `setupFirstAdmin`/`setupDefaultAdmins`
      from the Apps Script editor.
    - **Doer List vs. Login Accounts (a common mix-up)**: the **Doer
      List** tab is just a reusable contacts list (name + email) that
      autofills the Viewer/Editor/Downloader fields when you're setting
      access - it has no role or login concept at all, and being on it
      doesn't mean that person has (or needs) a RUDMS login. **Login
      Accounts** is the separate, admin-only tab where actual
      username/password accounts and their roles live
      (`RUDMS_Users.json`, distinct from the Doer List's
      `RUDMS_Contacts.json`). If someone's name is in the Doer List but
      you don't see a role for them, that's why - check Login Accounts
      instead.
  - **Sessions / staying signed in**: signing in issues a random token
    (30-day expiry) sent back as `externalToken` on calls that need to
    know who's asking. The login screen's **"Stay signed in on this
    device"** checkbox (checked by default) controls where that token is
    kept in the browser: checked stores it in `localStorage`, so closing
    the browser entirely and reopening the RUDMS link later skips the
    login screen for up to 30 days; unchecked (e.g. a shared computer)
    keeps it in `sessionStorage` instead - still no re-login needed
    while that browser tab/window stays open, but gone the moment it's
    closed. The login form is also a real `<form>` (not just a button
    click handler), which is what lets Chrome/Safari/Firefox reliably
    offer their own native "Save password?" prompt on top of this.
    **What's actually enforced**: unlike earlier versions of this app,
    role AND per-file grants (viewer/editor/admin, plus the per-file
    editors/downloaders/view-restriction lists - see Roles above) are
    checked **server-side** on upload, rename, delete, folder creation,
    manage-access, preview, the Download action, and delete requests -
    not just by hiding buttons in the client UI. A viewer account's
    `deleteFile(...)` call on someone else's upload genuinely fails on
    the server even if someone bypasses the UI (e.g. the browser
    console). That said, this is still a document-management access
    model aimed at ordinary staff, not a defense engineered against a
    determined technical attacker with access to this exact source code.
  - Same Google Drive throughout: the deploying account's Drive is where
    every category folder and file lives, same as before - login accounts
    are purely an access layer in front of it, not separate Drive
    identities.
  - **Changing your own password**: anyone signed in can change it
    themselves from the user menu (top-right avatar → **Change
    Password**) - it asks for the current password first, then the new
    one twice. No admin involvement needed for this part.
  - **Automatic admin/CEO/MD notification**: an admin sets a
    notification list of real email addresses from **Manage Access →
    Login Accounts → "Notify on password change"** (e.g. the admin's,
    CEO's and MD's own email addresses). From then on, every time
    *anyone* changes their own password, everyone on that list
    automatically gets an email with who changed it and their new
    password, sent via `MailApp` from the deploying account - no manual
    step. Leave the list empty to turn this off. The list itself is
    just another JSON file in the RUDMS root folder
    (`RUDMS_NotifyEmails.json`), same storage pattern as everything
    else here.
- **Downloads**: proxied through `getFileContentForPreview(fileId,
  callerToken, forDownload=true)` on the server rather than a direct
  `drive.google.com` link, so this works the same regardless of the
  visitor's own Drive access (there isn't any - see "Permissions model"
  above). `forDownload=true` is what makes the server check
  `canDownloadFileMeta` (admin, or that specific file's/folder's
  admin-granted "Can download" list); the same function with
  `forDownload` left out/false is the in-browser preview path, which only
  needs `canViewFileMeta` (open to everyone unless an admin restricted
  that file). The Download button itself is hidden entirely for anyone
  `canDownload` comes back false for.
- **Previews**:
  - Images (`.png`, `.jpg`/`.jpeg`, `.gif`, `.webp`, `.svg`, `.avif`,
    `.bmp`) → fetched through the server and rendered from a data URI
    (same mechanism as CAD below), **not** Drive's `/preview` iframe.
    That iframe needs the *viewing browser itself* to have Drive-level
    access to the file, which no RUDMS visitor has anymore now that login
    is username/password rather than Google identity - so it was switched
    to the server-proxied approach to keep working for everyone. All
    seven image formats decode natively in every current browser via the
    `<img>` tag - no extra library needed.
  - `.pdf` → rendered page-by-page onto `<canvas>` elements via
    [PDF.js](https://mozilla.github.io/pdf.js/) rather than a browser
    `<embed>`/native-plugin viewer. The native-viewer approach used to be
    here but isn't reliable: it depends on the browser's own PDF plugin,
    which mobile Safari/Chrome frequently don't expose for a
    data-URI-embedded PDF (this page also runs inside Apps Script's own
    sandboxed iframe on top of that). PDF.js draws the pixels itself, so
    it renders identically on desktop and phone alike.
  - **Not supported, by design**: `.heic`/`.heif` (iPhone photos) would
    need a heavy WASM decoder that would visibly lag, especially on
    phones; `.ai` (Illustrator) and `.eps` have no reliable lightweight
    renderer (Illustrator's own vector data, and full PostScript
    interpretation, are both well beyond what a single Apps Script file
    should take on); and camera RAW (`.raw`/`.cr2`/`.nef`) is a large,
    manufacturer-proprietary format that genuinely needs heavy
    processing to decode. All of these fall back to the generic "no
    inline preview, download instead" message - re-exporting to `.jpg`
    or `.png` before uploading gets full in-browser preview instead.
  - `.xls` / `.xlsx` / `.ods` → rendered as a real HTML table entirely in
    the browser via [SheetJS](https://sheetjs.com/) - no Google/Drive
    access needed at all, so this works the same for every signed-in
    visitor. Multi-sheet workbooks get a tab per sheet. `.csv` uses the
    same library, read as plain text rather than binary.
  - `.docx` → rendered as formatted HTML entirely in the browser via
    [mammoth.js](https://github.com/mwilliamson/mammoth.js) - same
    no-Drive-access story as Excel above.
  - `.txt`, `.html`/`.htm`, `.xml`, `.json` → shown as read-only source
    text (JSON pretty-printed). Deliberately rendered via `textContent`,
    never as live markup - an uploaded `.html`/`.xml` file's content is
    never executed as a page, only displayed as text, so it can't run
    script in RUDMS's own origin.
  - `.rtf` → best-effort plain-text extraction (control words/groups
    stripped client-side). Formatting like bold/italic/tables is not
    preserved - a full RTF renderer is much heavier than this system
    needs for what's usually a text document.
  - `.zip` → lists the archive's contents (file names, via
    [JSZip](https://stuk.github.io/jszip/)) rather than previewing each
    file inside - download to extract and open individual files.
  - `.mp3` → the browser's native `<audio>` player, no library needed.
  - `.mp4` / `.mov` → the browser's native `<video>` player, no library
    needed. `.mov` plays only for browser-supported codecs (typically
    H.264) - some Apple-specific codecs won't play; download still works
    regardless. Both go through the same base64 round-trip as everything
    else here, so very large video files will be slow to preview (see
    "Large files" under production hardening below).
  - Old-format `.doc`, and `.ppt`/`.pptx` → **honest limitation**: no
    solid lightweight in-browser renderer exists for these (mammoth.js
    only understands modern `.docx`, not binary `.doc`; PowerPoint has no
    good simple client-side option). The portal shows a clear "download
    to open in its native app" message instead of a broken/blank iframe.
    Re-saving a `.doc` as `.docx` before uploading gets it the in-browser
    preview too. `.psd` and `.rar` have the same story for the same
    reason - no realistic lightweight in-browser option - and fall back
    to the generic "no inline preview, download instead" message.
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

## Load speed

Three changes keep first load fast as the file count and feature set grow:

- **Preview libraries load on demand, not up front.** Three.js (+ its 3
  CAD addons), SheetJS, mammoth.js, JSZip and PDF.js together are close to
  2MB - previously all five loaded as `<script src>` tags on *every* page
  load, CAD viewer included, whether or not that visit ever opened a PDF/
  Excel/Word/zip/3D file. They're now fetched lazily (`ensureLib()` in
  `Index.html`), the first time a preview actually needs that specific
  library, in parallel with that file's own content fetch - so opening a
  PDF for the first time costs a one-time ~300KB fetch, but the app itself
  loads without any of that weight.
- **Boot calls run in parallel, not one after another.** `getFolderTree()`
  and `getAllFiles()` don't depend on each other, so the client fires both
  at once (`loadCategoriesAndFiles()`) instead of waiting for the first to
  finish before starting the second - each `google.script.run` round trip
  has its own real latency, so this removes one full wait from every load.
- **The expensive Drive walk is cached server-side.** `getAllFiles()`'s
  cost scales with how many files exist, not with who's asking, so the
  raw per-file metadata (not the per-caller capability flags, which are
  cheap to compute) is cached via `CacheService` for 5 minutes
  (`getRawFileList()` in `Code.gs`). Every write that can change a file -
  upload, delete, rename, a permission change - calls
  `invalidateFilesCache()` so the next load always sees it; the TTL is
  just a safety net, not the real freshness mechanism.

**What's still out of this app's control**: Apps Script's own cold-start
(Google spinning up your script's execution environment) and
`HtmlService`'s own response time for serving `Index.html` both have
real, unavoidable latency on `script.google.com` - typically a couple of
seconds on a first visit, faster on a warm one. Nothing in this codebase
can remove that; the changes above remove everything that *was* avoidable
on top of it.

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
   - Select `setupFirstAdmin` in the same dropdown and click **Run**
     once more - this creates the first login account (username `admin`,
     password `ChangeMe123`, role admin) so you can actually sign into
     the deployed app afterward. Sign in with it once the web app is
     live, then create your real admin account(s) and remove this
     bootstrap one from **Manage Access → Login Accounts**.

4. **Deploy as a Web App**
   - Click **Deploy → New deployment**.
   - Click the gear icon next to "Select type" → **Web app**.
   - Description: `RUDMS v1`.
   - **Execute as**: `Me (your-email@rukmanudyog.com)` — this is what lets
     the script create folders/files and manage permissions using your
     Drive, regardless of who is viewing the page.
   - **Who has access**: `Anyone` — visitors sign in with the
     username/password login built into RUDMS itself, not a Google
     account, so they don't need `Anyone with a Google account` here.
     (Drive-level Viewer/Editor sharing granted through Manage Access
     still only takes effect for emails tied to an actual Google account,
     same as always - that's a separate, optional layer on top of RUDMS's
     own login.)
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
