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
        src: '/apple-touch-icon.png?v=20260910-3',
        sizes: '180x180',
        type: 'image/png',
        purpose: 'any',
      },
    ],
  };
}
