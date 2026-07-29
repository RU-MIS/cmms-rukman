/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  trailingSlash: true,
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'https://cmms-rukman.onrender.com',
    NEXT_PUBLIC_APP_NAME: 'CMMS Pro',
    NEXT_PUBLIC_COMPANY: 'Rukman Udyog',
  },
  images: {
    unoptimized: true,
  },
};

module.exports = nextConfig;
