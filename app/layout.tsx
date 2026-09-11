import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import './puma-brand.css';
import './client-workflow.css';
import './puma-redesign.css';
import './bulk-outreach.css';
import './ios-native.css';

const APP_ICON = '/apple-touch-icon.png?v=20260910-3';

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
    icon: [{ url: APP_ICON, sizes: '180x180', type: 'image/png' }],
    apple: [{ url: APP_ICON, sizes: '180x180', type: 'image/png' }],
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
