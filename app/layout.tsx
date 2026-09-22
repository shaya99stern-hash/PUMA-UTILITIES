import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import './puma-brand.css';
import './client-workflow.css';
import './puma-redesign.css';
import './bulk-outreach.css';
import './ios-native.css';
import './puma-responsive-v6.css';

const APPLE_ICON = '/apple-touch-icon?v=20260922-1';

export const metadata: Metadata = {
  applicationName: 'Puma Utilities',
  title: 'Puma Utilities — Water Intelligence',
  description: 'Nationwide multifamily water prospecting, client workflow, installation tracking, and client-authorized monitoring.',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'Puma Utilities',
    statusBarStyle: 'black-translucent',
  },
  icons: {
    icon: [
      { url: '/pwa-icon-192?v=20260922-1', sizes: '192x192', type: 'image/png' },
      { url: '/pwa-icon-512?v=20260922-1', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: APPLE_ICON, sizes: '180x180', type: 'image/png' }],
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
