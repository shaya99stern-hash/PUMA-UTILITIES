import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Puma supports optional email identity without making sign-in mandatory', () => {
  const login = read('app/login/page.tsx');
  const form = read('app/components/puma-login-form.tsx');
  const claim = read('app/api/account/claim/route.ts');
  const signIn = read('app/api/account/sign-in/route.ts');
  const profile = read('app/components/puma-profile-settings.tsx');

  assert.match(login, /Email/i);
  assert.match(form, /Email/i);
  assert.match(form, /Password/i);
  assert.match(signIn, /signInWithPassword/);
  assert.match(claim, /updateUser/);
  assert.match(claim, /email/);
  assert.match(claim, /password/);
  assert.match(profile, /Use Puma on another device|Account email/i);
});

test('communications storage is workspace isolated and supports mailbox, scheduled outreach, alerts, and push', () => {
  const migration = read('supabase/migrations/202609260014_communications_and_alerts.sql');
  for (const table of ['mailboxes', 'outbound_messages', 'notification_preferences', 'push_subscriptions', 'notifications']) {
    assert.match(migration, new RegExp(`create table(?: if not exists)? public\\.${table}\\b`, 'i'));
  }
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /vault\.create_secret/i);
  assert.match(migration, /lease_outbound_messages/i);
  assert.match(migration, /cron\.schedule/i);
  assert.match(migration, /research_runs/i);
  assert.match(migration, /follow_up/i);
});

test('communications worker uses the connected company mailbox, Vault-backed secret RPC, and web push without another SaaS', () => {
  const worker = read('supabase/functions/puma-communications/index.ts');
  assert.match(worker, /nodemailer/);
  assert.match(worker, /web-push/);
  assert.match(worker, /smtp/i);
  assert.match(worker, /sendMail/);
  assert.match(worker, /sendNotification/);
  assert.match(worker, /verify_communications_worker_token/);
  assert.match(worker, /lease_outbound_messages/);
  assert.match(worker, /get_mailbox_secret/);
});

test('communications settings expose company mailbox, scheduled email, email alerts, and phone alerts', () => {
  const hub = read('app/components/puma-settings-hub.tsx');
  const page = read('app/settings/communications/page.tsx');
  const panel = read('app/components/puma-communications-settings.tsx');
  assert.match(hub, /settings\/communications/);
  assert.match(page, /PumaCommunicationsSettings/);
  assert.match(panel, /Company email/i);
  assert.match(panel, /Test mailbox/i);
  assert.match(panel, /Schedule email/i);
  assert.match(panel, /Phone alerts/i);
  assert.match(panel, /Email alerts/i);
});

test('PWA update control confirms both successful updates and already-current builds', () => {
  const updater = read('app/components/pwa-update-manager.tsx');
  assert.match(updater, /Update app/i);
  assert.match(updater, /Updated successfully/i);
  assert.match(updater, /already up to date/i);
  assert.match(updater, /sessionStorage/);
  assert.match(updater, /updated/);
  assert.match(updater, /current/);
});
