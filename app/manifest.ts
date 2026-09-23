import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Puma Utilities',
    short_name: 'Puma',
    description: 'Nationwide multifamily water prospecting, CRM, installation tracking, and client-authorized monitoring.',
    start_url: '/',
    display: 'standalone',
    background_color: '#050607',
    theme_color: '#050607',
    orientation: 'portrait-primary',
    icons: [
      {
        src: '/pwa-icon-192?v=20260923-2',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/pwa-icon-512?v=20260923-2',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
    ],
    shortcuts: [
      { name: 'Find Leads', short_name: 'Find Leads', url: '/engine' },
      { name: 'Intelligence', short_name: 'Intelligence', url: '/intelligence' },
    ],
  };
}
