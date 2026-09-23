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

const HOME_ICON = '/puma-home-icon.jpeg?v=20260923-1';
const DEPLOYMENT_ID = process.env.VERCEL_DEPLOYMENT_ID ?? process.env.VERCEL_GIT_COMMIT_SHA ?? 'development';

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
    icon: [{ url: HOME_ICON, sizes: '1254x1254', type: 'image/jpeg' }],
    apple: [{ url: HOME_ICON, sizes: '1254x1254', type: 'image/jpeg' }],
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
        <PwaUpdateManager currentDeploymentId={DEPLOYMENT_ID} />
      </body>
    </html>
  );
}
