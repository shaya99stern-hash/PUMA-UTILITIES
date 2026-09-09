import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Puma Utilities',
    short_name: 'Puma',
    description: 'Multifamily water intelligence and prospecting engine.',
    start_url: '/',
    display: 'standalone',
    background_color: '#050607',
    theme_color: '#050607',
    orientation: 'portrait-primary',
  };
}
