import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  applicationName: 'Puma Utilities',
  title: 'Puma Utilities — Water Intelligence',
  description: 'Multifamily water intelligence, prospecting and portfolio monitoring for NJ, NY and PA.',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'Puma Utilities',
    statusBarStyle: 'black-translucent',
  },
  icons: {
    icon: [{ url: '/puma-home-icon.jpeg', sizes: '1254x1254', type: 'image/jpeg' }],
    apple: [{ url: '/puma-home-icon.jpeg', sizes: '1254x1254', type: 'image/jpeg' }],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#050607',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
