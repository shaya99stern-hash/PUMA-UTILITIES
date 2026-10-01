import {
  Building2,
  CheckSquare,
  Columns3,
  Gauge,
  Home,
  Inbox,
  Receipt,
  Send,
  Settings,
  Sparkles,
  Users,
  Warehouse,
  type LucideIcon,
} from 'lucide-react';

export type NavItem = { href: string; label: string; icon: LucideIcon; /** Extra path prefixes that mark this item active. */ match?: string[] };
export type NavGroup = { label?: string; items: NavItem[] };

export const NAV_GROUPS: NavGroup[] = [
  { items: [{ href: '/', label: 'Home', icon: Home }] },
  {
    label: 'CRM',
    items: [
      { href: '/companies', label: 'Companies', icon: Building2, match: ['/clients'] },
      { href: '/contacts', label: 'Contacts', icon: Users },
      { href: '/properties', label: 'Properties', icon: Warehouse },
      { href: '/pipeline', label: 'Pipeline', icon: Columns3 },
      { href: '/tasks', label: 'Tasks', icon: CheckSquare },
    ],
  },
  {
    label: 'Growth',
    items: [
      { href: '/leads', label: 'Find Leads', icon: Sparkles, match: ['/engine', '/intelligence'] },
      { href: '/inbox', label: 'Inbox', icon: Inbox },
      { href: '/campaigns', label: 'Campaigns', icon: Send },
    ],
  },
  {
    label: 'Operations',
    items: [
      { href: '/monitor', label: 'Monitor', icon: Gauge },
      { href: '/accounts-payable', label: 'Accounts Payable', icon: Receipt },
    ],
  },
];

export const SETTINGS_ITEM: NavItem = { href: '/settings', label: 'Settings', icon: Settings };

export const ALL_NAV: NavItem[] = [...NAV_GROUPS.flatMap((g) => g.items), SETTINGS_ITEM];

/** iPhone tab bar (the rest lives under "More"). */
export const TAB_HREFS = ['/', '/companies', '/leads', '/inbox'];

export function isActive(item: NavItem, pathname: string) {
  const prefixes = [item.href, ...(item.match ?? [])];
  return prefixes.some((p) => (p === '/' ? pathname === '/' : pathname === p || pathname.startsWith(`${p}/`)));
}

export function sectionTitle(pathname: string): string {
  const hit = ALL_NAV.find((item) => item.href !== '/' && isActive(item, pathname));
  if (hit) return hit.label;
  return pathname === '/' ? 'Home' : 'Puma Utilities';
}
