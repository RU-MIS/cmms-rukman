# Rukman Portal (Apps Script only)

Two files, one Apps Script project. No Netlify, no separate hosting.

- `Code.gs`: backend + serves the page
- `Index.html`: the portal (login ID/password, email OTP, Remember me, departments)

## Setup
1. Google Sheet with tabs: **Portal_Access** (`EMAIL | TITLE | TYPE | URL | DEPARTMENT`) and **Users**
   (`EMAIL | NAME | LOGIN ID | SALT (auto) | HASH (auto) | STATUS`). Do not share the spreadsheet with users.
2. Apps Script project: paste `Code.gs`, add an HTML file named exactly `Index` and paste `Index.html`.
3. Set `SHEET_ID` in `Code.gs`. Run `setup` once and approve the permissions.
4. Deploy > Manage deployments > Edit > **Execute as: Me**, **Who has access: Anyone** > New version > Deploy.
5. Share the Web app URL (`.../exec`).
6. First time a user signs in: "First time or forgot password?" > code by email > choose a password.

After every change: Deploy > Manage deployments > Edit > New version > Deploy.

## Notes
- "Remember me" keeps the session in the browser's storage (30 days, renewed on use, 90 days maximum).
- This version cannot be installed as a PWA (Google's page does not allow a manifest). Users can still use the
  browser's "Install page as app" / "Add to Home screen" to get a shortcut.
