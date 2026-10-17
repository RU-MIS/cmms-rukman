# Rukman Portal (Google sign-in version)

No passwords, no OTP. Google signs the person in; the portal shows only the links listed for their email.
Two files, one Apps Script project: `Code.gs` and `Index.html`.

## Sheet
- **Portal_Access**: `EMAIL | TITLE | TYPE | URL | DEPARTMENT` (TYPE: sheet, form or app)
- **Users**: `EMAIL | NAME` (extra columns are ignored). Do not share this spreadsheet with users.

## Deploy
1. Paste `Code.gs`; add an HTML file named exactly `Index` and paste `Index.html`.
2. Deploy > Manage deployments > Edit > Version: **New version**, then:
   - Workspace users (same domain): **Execute as: Me**, **Who has access: Anyone within your domain**.
   - Gmail users: **Execute as: User accessing the web app**, **Who has access: Anyone with Google account**
     (and the spreadsheet must then be shared with them as Viewer).
3. Share the Web app URL (`.../exec`).

Sheet edits show in the portal within `CACHE_SECONDS` (60 s).
Opening a Sheet or Form is still decided by Google Drive sharing, so share each file with the person as Viewer.
