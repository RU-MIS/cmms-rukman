import type { NextConfig } from 'next';

// Static export: the app is a client-side SPA talking to Supabase directly
// (RLS + RPCs enforce all security). Deployable on any static host
// (Cloudflare Pages, Netlify, S3, nginx …).
const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
};

export default nextConfig;
