import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '@fontsource-variable/inter';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/shell.css';
import './styles/pages.css';
import PwaUpdateManager from './components/pwa-update-manager';
import { AppShell } from './ui/app-shell';
import { ToastProvider } from './ui/toast';

const APPLE_ICON = '/apple-touch-icon.png?v=20260930';
const PWA_ICON_192 = '/pwa-icon-192?v=20260930';
const PWA_ICON_512 = '/pwa-icon-512?v=20260930';

export const metadata: Metadata = {
  applicationName: 'Puma Utilities',
  title: {
    default: 'Puma Utilities',
    template: '%s · Puma Utilities',
  },
  description: 'CRM, lead intelligence and outreach for multifamily water savings.',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'Puma',
    statusBarStyle: 'black-translucent',
  },
  formatDetection: { telephone: false },
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
  themeColor: '#0B0B0C',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body>
        <ToastProvider>
          <AppShell>{children}</AppShell>
        </ToastProvider>
        <PwaUpdateManager />
      </body>
    </html>
  );
}
