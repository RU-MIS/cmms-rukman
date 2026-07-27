/** @type {import('next').NextConfig} */
const withPWA = require('next-pwa')({
  dest:            'public',
  register:        true,
  skipWaiting:     true,
  disable:         process.env.NODE_ENV === 'development',
  sw:              '/sw.js',
  fallbacks: {
    document: '/offline.html',
  },
  cacheOnFrontEndNav: true,
  reloadOnOnline:     true,
  runtimeCaching: [
    {
      // Cache API responses for 5 minutes
      urlPattern: /^https?:\/\/.*\/api\/v1\/dashboard.*/i,
      handler:    'NetworkFirst',
      options: {
        cacheName: 'api-dashboard-cache',
        expiration: { maxEntries: 10, maxAgeSeconds: 300 },
      },
    },
    {
      // Cache images from Google Drive
      urlPattern: /^https:\/\/drive\.google\.com\/.*/i,
      handler:    'CacheFirst',
      options: {
        cacheName: 'gdrive-images',
        expiration: { maxEntries: 100, maxAgeSeconds: 86400 },
      },
    },
  ],
});

const nextConfig = {
  reactStrictMode: true,
  output: 'standalone', // For Docker deployment
  env: {
    NEXT_PUBLIC_API_URL:    process.env.NEXT_PUBLIC_API_URL    || 'http://localhost:4000',
    NEXT_PUBLIC_APP_NAME:   'CMMS Pro',
    NEXT_PUBLIC_COMPANY:    'Rukman Udyog',
    NEXT_PUBLIC_VERSION:    '1.0.0',
  },
  // Security headers
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options',        value: 'DENY' },
          { key: 'X-Content-Type-Options',  value: 'nosniff' },
          { key: 'Referrer-Policy',         value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

module.exports = withPWA(nextConfig);
