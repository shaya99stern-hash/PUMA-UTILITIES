/** Provider presets and onboarding copy. Safe to import from client components. */
import type { Endpoint } from './types';

export type PresetKey = 'gmail' | 'outlook' | 'icloud' | 'yahoo' | 'zoho' | 'godaddy' | 'fastmail' | 'custom';

export type Preset = {
  key: PresetKey;
  label: string;
  smtp: Endpoint;
  imap: Endpoint;
  /** True when the provider requires an app-specific password instead of the normal login password. */
  appPassword: boolean;
  appPasswordUrl?: string;
  steps: string[];
  note?: string;
};

export const PRESETS: Record<PresetKey, Preset> = {
  gmail: {
    key: 'gmail',
    label: 'Gmail / Google Workspace',
    smtp: { host: 'smtp.gmail.com', port: 465, secure: true },
    imap: { host: 'imap.gmail.com', port: 993, secure: true },
    appPassword: true,
    appPasswordUrl: 'https://myaccount.google.com/apppasswords',
    steps: [
      'Turn on 2-Step Verification for your Google account (required for app passwords).',
      'Open myaccount.google.com/apppasswords and create an app password named "Puma".',
      'Copy the 16-character password Google shows and paste it below (spaces are fine).',
      'Google Workspace admins: IMAP must be enabled for your domain in the Admin console.',
    ],
    note: 'Your normal Gmail password will not work. Use an app password.',
  },
  outlook: {
    key: 'outlook',
    label: 'Outlook / Microsoft 365',
    smtp: { host: 'smtp.office365.com', port: 587, secure: false },
    imap: { host: 'outlook.office365.com', port: 993, secure: true },
    appPassword: true,
    appPasswordUrl: 'https://account.live.com/proofs/AppPassword',
    steps: [
      'Personal Outlook.com: turn on two-step verification, then create an app password at account.live.com/proofs/AppPassword.',
      'Microsoft 365 work accounts: your admin must allow SMTP AUTH and IMAP for your mailbox. If they will not, use "Sign in with Microsoft" instead.',
      'Use your full email address as the username.',
    ],
    note: 'Many Microsoft 365 tenants block password sign-in. Sign in with Microsoft is the most reliable option.',
  },
  icloud: {
    key: 'icloud',
    label: 'iCloud Mail',
    smtp: { host: 'smtp.mail.me.com', port: 587, secure: false },
    imap: { host: 'imap.mail.me.com', port: 993, secure: true },
    appPassword: true,
    appPasswordUrl: 'https://account.apple.com/account/manage/section/security',
    steps: [
      'Sign in at account.apple.com, open Sign-In and Security, then App-Specific Passwords.',
      'Generate a password named "Puma" and paste it below.',
      'Use your full iCloud address (for example name@icloud.com) as the username.',
    ],
  },
  yahoo: {
    key: 'yahoo',
    label: 'Yahoo Mail',
    smtp: { host: 'smtp.mail.yahoo.com', port: 465, secure: true },
    imap: { host: 'imap.mail.yahoo.com', port: 993, secure: true },
    appPassword: true,
    appPasswordUrl: 'https://login.yahoo.com/account/security/app-passwords',
    steps: [
      'Open login.yahoo.com/account/security and turn on two-step verification.',
      'Choose Generate app password, name it "Puma", and paste it below.',
    ],
  },
  zoho: {
    key: 'zoho',
    label: 'Zoho Mail',
    smtp: { host: 'smtp.zoho.com', port: 465, secure: true },
    imap: { host: 'imap.zoho.com', port: 993, secure: true },
    appPassword: true,
    appPasswordUrl: 'https://accounts.zoho.com/home#security/app_password',
    steps: [
      'Enable IMAP in Zoho Mail settings, then create an application-specific password in Zoho Accounts > Security.',
      'Outside the US use smtp.zoho.eu / imap.zoho.eu (choose Other below).',
    ],
  },
  godaddy: {
    key: 'godaddy',
    label: 'GoDaddy Workspace',
    smtp: { host: 'smtpout.secureserver.net', port: 465, secure: true },
    imap: { host: 'imap.secureserver.net', port: 993, secure: true },
    appPassword: false,
    steps: ['Use your full email address and your normal mailbox password.', 'Microsoft 365 through GoDaddy: choose Outlook / Microsoft 365 instead.'],
  },
  fastmail: {
    key: 'fastmail',
    label: 'Fastmail',
    smtp: { host: 'smtp.fastmail.com', port: 465, secure: true },
    imap: { host: 'imap.fastmail.com', port: 993, secure: true },
    appPassword: true,
    appPasswordUrl: 'https://app.fastmail.com/settings/security/devicekeys',
    steps: ['In Fastmail open Settings > Privacy & Security > Integrations > New app password, pick "Mail (IMAP/POP/SMTP)".'],
  },
  custom: {
    key: 'custom',
    label: 'Other (IMAP / SMTP)',
    smtp: { host: '', port: 587, secure: false },
    imap: { host: '', port: 993, secure: true },
    appPassword: false,
    steps: ['Enter the SMTP and IMAP details from your email host. Port 465 uses SSL; port 587 uses STARTTLS.'],
  },
};

export const PRESET_LIST = Object.values(PRESETS);

/** Best-effort preset from an email address (used to pre-select when someone types their address). */
export function guessPreset(email: string): PresetKey {
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  if (/^(gmail|googlemail)\.com$/.test(domain)) return 'gmail';
  if (/^(outlook|hotmail|live|msn)\.com$/.test(domain)) return 'outlook';
  if (/^(icloud|me|mac)\.com$/.test(domain)) return 'icloud';
  if (/^yahoo\.|^ymail\.com$/.test(domain)) return 'yahoo';
  if (/^zoho(mail)?\.(com|eu)$/.test(domain)) return 'zoho';
  if (/^fastmail\./.test(domain)) return 'fastmail';
  return 'custom';
}
