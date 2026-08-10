import type { NextConfig } from 'next';

const apiTarget = (
  process.env.INTERNAL_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'https://api.sustainabilitywise.com.au'
).replace(/\/$/, '');

const nextConfig: NextConfig = {
  // Browser may open 127.0.0.1 while the dev server cookie/HMR host is localhost.
  // Without this, Next blocks /_next assets and React never hydrates → stuck spinner.
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  turbopack: {
    root: __dirname,
  },
  async rewrites() {
    return [
      { source: '/v1/:path*', destination: `${apiTarget}/v1/:path*` },
      { source: '/health', destination: `${apiTarget}/health` },
    ];
  },
};

export default nextConfig;
