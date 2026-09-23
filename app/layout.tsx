import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import PwaUpdateManager from './components/pwa-update-manager';
import './globals.css';
import './puma-brand.css';
import './client-workflow.css';
import './puma-redesign.css';
import './bulk-outreach.css';
import './ios-native.css';
import './puma-responsive-v6.css';
import './puma-minimal-settings.css';
import './puma-polish-v12.css';
import './puma-app-shell.css';

const APPLE_ICON = '/apple-touch-icon?v=20260923-2';
const PWA_ICON_192 = '/pwa-icon-192?v=20260923-2';
const PWA_ICON_512 = '/pwa-icon-512?v=20260923-2';

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
      { url: PWA_ICON_192, sizes: '192x192', type: 'image/png' },
      { url: PWA_ICON_512, sizes: '512x512', type: 'image/png' },
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
      <body>
        {children}
        <PwaUpdateManager />
      </body>
    </html>
  );
}
