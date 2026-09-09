import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Listen on the LAN too, so a phone on the same Wi-Fi can open this
    // dev server directly (needed to test the camera on a real device).
    host: true,
  },
});
