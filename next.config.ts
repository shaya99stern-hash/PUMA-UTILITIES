import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Keep Turbopack scoped to this repository when another workspace lockfile
  // exists higher in the Windows user profile.
  turbopack: {
    root: process.cwd(),
  },
  serverExternalPackages: ['imapflow', 'mailparser', 'nodemailer'],
  async redirects() {
    return [
      {
        source: '/clients',
        destination: '/companies',
        permanent: false,
      },
      {
        source: '/clients/:companyId',
        destination: '/companies/:companyId',
        permanent: false,
      },
      {
        source: '/clients/:companyId/buildings',
        destination: '/companies/:companyId',
        permanent: false,
      },
      {
        source: '/clients/:companyId/buildings/:propertyId',
        destination: '/properties/:propertyId',
        permanent: false,
      },
      {
        source: '/clients/follow-ups',
        destination: '/tasks',
        permanent: false,
      },
      {
        source: '/engine',
        destination: '/leads',
        permanent: false,
      },
      {
        source: '/intelligence',
        destination: '/leads',
        permanent: false,
      },
      {
        source: '/export',
        destination: '/settings/import-export',
        permanent: false,
      },
      {
        source: '/settings/communications',
        destination: '/settings/email',
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
