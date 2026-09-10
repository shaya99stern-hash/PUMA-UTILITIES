import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Keep Turbopack scoped to this repository when another workspace lockfile
  // exists higher in the Windows user profile.
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
