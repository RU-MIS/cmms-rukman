# RUDMS PWA shell

A tiny, separate static site (4 files + icons) that wraps the real RUDMS
app - running entirely on Google Apps Script, unchanged - in an
installable page. RUDMS itself can't reliably be installed as a PWA
directly from `script.google.com`, because Apps Script serves every page
inside its own sandboxed iframe, which is known to break service worker
registration. This shell sidesteps that: it's a normal static site (so
its own service worker registers fine), and it just iframes your RUDMS
URL full-screen. All the real logic, data and backend stay on Apps
Script - this is only a wrapper that makes "Install App" / "Add to Home
Screen" behave like a real app, on desktop and mobile alike.

## 1. Fill in your RUDMS URL

Open `index.html`, find this line near the bottom (inside the
`<script>` block):

```js
var RUDMS_URL = 'PASTE_YOUR_RUDMS_EXEC_URL_HERE';
```

Replace the placeholder with your deployed RUDMS web app URL - from the
Apps Script editor: **Deploy → Manage deployments**, copy the URL
ending in `/exec`. Save the file.

(This is deliberately left blank rather than guessed - paste your own
current URL here, since only you know it's up to date.)

## 2. Deploy it - Netlify Drop (free, ~2 minutes, no account needed to try it)

1. Go to **[app.netlify.com/drop](https://app.netlify.com/drop)**.
2. Drag the whole `pwa-shell` folder (this folder - `index.html`,
   `manifest.json`, `service-worker.js`, and the `icons` folder) onto the
   page.
3. Netlify gives you a live URL immediately, like
   `https://random-name-123.netlify.app`.
4. Open that URL on your phone or desktop Chrome/Edge - you should see
   RUDMS load inside the shell, and the browser should offer **"Install
   app"** (desktop Chrome/Edge: an icon in the address bar; Android
   Chrome: an "Add to Home screen" / install banner; iOS Safari: use the
   Share button → **Add to Home Screen**, since iOS doesn't show an
   automatic install prompt for any site).
5. To keep it permanently (not just a drop-session link) or set a custom
   name, create a free Netlify account and claim the site from the same
   page - no changes to any of these files are needed.

A custom domain (e.g. `rudms.rukmanudyog.com`) can be pointed at this
Netlify site later if you want one - that's a separate, optional step
done from Netlify's domain settings plus a DNS change with whoever
manages the `rukmanudyog.com` domain.

## 3. Re-deploying after a change

If you ever edit these files (e.g. a new RUDMS URL after a fresh
deployment - though re-deploying RUDMS itself via "New version" keeps
the same URL, so this normally isn't needed), just drag the folder onto
[app.netlify.com/drop](https://app.netlify.com/drop) again, or use
Netlify's "deploys" tab if you claimed the site.

## What's in here

| File | Purpose |
|---|---|
| `index.html` | The shell page - a full-screen iframe pointing at your RUDMS URL, a loading screen, and the service worker registration |
| `manifest.json` | PWA manifest - name, icons, `display: standalone` (no browser address bar once installed) |
| `service-worker.js` | Makes the shell installable; never touches RUDMS's own content, which always loads live |
| `icons/` | App icons generated from the Rukman Udyog logo, in the sizes each platform expects |

## Limitations (same as any iframe-wrapper app)

- **Offline**: only this shell's own loading screen can show offline -
  RUDMS itself still needs an internet connection, same as always
  (it's a live Apps Script + Google Drive backend).
- **Two origins**: the installed app's address bar (when visible) will
  show your Netlify domain, not `script.google.com` - that's expected,
  since the shell is what's installed; RUDMS loads inside it exactly as
  it does when embedded in Google Sites today.
