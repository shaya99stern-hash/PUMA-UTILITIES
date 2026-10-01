import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Puma Utilities',
    short_name: 'Puma',
    description: 'CRM, lead intelligence and outreach for multifamily water savings.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#0B0B0C',
    theme_color: '#0B0B0C',
    orientation: 'portrait',
    categories: ['business', 'productivity'],
    icons: [
      { src: '/pwa-icon-192?v=20260930', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/pwa-icon-512?v=20260930', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/pwa-icon-512?v=20260930', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Find Leads', short_name: 'Leads', url: '/leads', icons: [{ src: '/pwa-icon-192?v=20260930', sizes: '192x192' }] },
      { name: 'Companies', short_name: 'Companies', url: '/companies', icons: [{ src: '/pwa-icon-192?v=20260930', sizes: '192x192' }] },
      { name: 'Inbox', short_name: 'Inbox', url: '/inbox', icons: [{ src: '/pwa-icon-192?v=20260930', sizes: '192x192' }] },
    ],
  };
}
