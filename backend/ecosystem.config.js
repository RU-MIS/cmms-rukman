// PM2 process definition for the backend API in production.
//
// Usage on the server (after `npm install && npm run build`):
//   pm2 start ecosystem.config.js
//   pm2 save
//   pm2 startup   # follow the one-time printed instructions so PM2 survives a reboot
//
// To apply a new deploy (after pulling code + npm run build + npm run prisma:deploy):
//   pm2 restart erp-api
//
// This does not set any environment variables itself — it runs
// `dist/src/server.js`, which loads `backend/.env` the same way `npm run
// dev`/`npm start` do (via dotenv inside src/config/env.ts). Set your real
// production values in `backend/.env` on the server, never in this file.
module.exports = {
  apps: [
    {
      name: 'erp-api',
      script: 'dist/src/server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '400M',
      env: {
        NODE_ENV: 'production',
      },
      // Logs go to PM2's default location (~/.pm2/logs/erp-api-*.log) —
      // view with `pm2 logs erp-api`. Override out_file/error_file here only
      // if you need a specific path; a literal "~" is not reliably expanded
      // by PM2 depending on how it's launched.
      time: true,
    },
  ],
};
