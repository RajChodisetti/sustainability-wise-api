import type { NextConfig } from 'next';

const apiTarget = (
  process.env.INTERNAL_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'https://api.sustainabilitywise.com.au'
).replace(/\/$/, '');

const nextConfig: NextConfig = {
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
