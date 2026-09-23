export type PumaPrimaryRouteId = 'home' | 'clients' | 'engine' | 'monitor';
export type PumaShellRouteId = PumaPrimaryRouteId | 'settings' | 'accounts-payable';

export const PRIMARY_NAV = [
  { id: 'home', href: '/', label: 'Home' },
  { id: 'clients', href: '/clients', label: 'Companies' },
  { id: 'engine', href: '/engine', label: 'Find Leads' },
  { id: 'monitor', href: '/monitor', label: 'Monitor' },
] as const;

export const SETTINGS_ROUTE = { id: 'settings', href: '/settings', label: 'Settings' } as const;
