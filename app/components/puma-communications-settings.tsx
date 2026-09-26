'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';

type Mailbox = {
  id: string;
  from_name: string | null;
  from_email: string;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  smtp_username: string;
  verified_at: string | null;
};

type Preferences = {
  push_enabled?: boolean;
  email_enabled?: boolean;
  alert_email?: string | null;
  research_complete?: boolean;
  follow_up_due?: boolean;
  email_delivery?: boolean;
};

type Outbound = {
  id: string;
  recipient_email: string;
  subject: string;
  scheduled_for: string;
  status: string;
  sent_at?: string | null;
  last_error?: string | null;
};

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}

function localDateTimeValue(date = new Date(Date.now() + 5 * 60 * 1000)) {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return shifted.toISOString().slice(0, 16);
}

export default function PumaCommunicationsSettings() {
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [messages, setMessages] = useState<Outbound[]>([]);
  const [prefs, setPrefs] = useState<Preferences>({ research_complete: true, follow_up_due: true, email_delivery: true });
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  const [mailbox, setMailbox] = useState({
    mailboxId: '', fromName: '', fromEmail: '', smtpHost: '', smtpPort: '465', smtpSecure: true, smtpUsername: '', password: '',
  });
  const [outreach, setOutreach] = useState({ recipientName: '', recipientEmail: '', subject: '', bodyText: '', scheduledFor: localDateTimeValue() });
  const [alertEmail, setAlertEmail] = useState('');

  const primaryMailbox = mailboxes[0] ?? null;
  const phoneSupported = useMemo(() => typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window, []);

  const refresh = async () => {
    const [mailboxResponse, preferenceResponse, messageResponse] = await Promise.all([
      fetch('/api/communications/mailbox', { cache: 'no-store' }),
      fetch('/api/communications/preferences', { cache: 'no-store' }),
      fetch('/api/communications/send', { cache: 'no-store' }),
    ]);
    const mailboxBody = await mailboxResponse.json();
    const preferenceBody = await preferenceResponse.json();
    const messageBody = await messageResponse.json();

    if (mailboxResponse.ok && Array.isArray(mailboxBody.mailboxes)) {
      setMailboxes(mailboxBody.mailboxes);
      const first = mailboxBody.mailboxes[0] as Mailbox | undefined;
      if (first) {
        setMailbox((current) => ({
          ...current,
          mailboxId: first.id,
          fromName: first.from_name ?? '',
          fromEmail: first.from_email,
          smtpHost: first.smtp_host,
          smtpPort: String(first.smtp_port),
          smtpSecure: first.smtp_secure,
          smtpUsername: first.smtp_username,
          password: '',
        }));
      }
    }
    if (preferenceResponse.ok && preferenceBody.preferences) {
      setPrefs(preferenceBody.preferences);
      setAlertEmail(preferenceBody.preferences.alert_email ?? '');
    }
    if (messageResponse.ok && Array.isArray(messageBody.messages)) setMessages(messageBody.messages);
  };

  useEffect(() => { void refresh().catch(() => setStatus('Communications settings are temporarily unavailable.')); }, []);

  const saveMailbox = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setStatus('Testing company email…');
    try {
      const response = await fetch('/api/communications/mailbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...mailbox, smtpPort: Number(mailbox.smtpPort), label: 'Company email' }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || 'Mailbox verification failed.');
      setStatus('Company email verified and saved securely.');
      setMailbox((current) => ({ ...current, password: '' }));
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Mailbox verification failed.');
    } finally {
      setBusy(false);
    }
  };

  const scheduleEmail = async (event: FormEvent) => {
    event.preventDefault();
    if (!primaryMailbox) { setStatus('Connect and verify a company email first.'); return; }
    setBusy(true);
    setStatus('Scheduling email…');
    try {
      const response = await fetch('/api/communications/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...outreach, mailboxId: primaryMailbox.id, scheduledFor: new Date(outreach.scheduledFor).toISOString() }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || 'Unable to schedule email.');
      setStatus('Email scheduled. Puma will send it automatically.');
      setOutreach((current) => ({ ...current, recipientName: '', recipientEmail: '', subject: '', bodyText: '', scheduledFor: localDateTimeValue() }));
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to schedule email.');
    } finally {
      setBusy(false);
    }
  };

  const savePreferences = async (next: Preferences) => {
    const merged = { ...prefs, ...next };
    setPrefs(merged);
    setStatus('Saving alerts…');
    const response = await fetch('/api/communications/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pushEnabled: merged.push_enabled === true,
        emailEnabled: merged.email_enabled === true,
        alertEmail,
        researchComplete: merged.research_complete !== false,
        followUpDue: merged.follow_up_due !== false,
        emailDelivery: merged.email_delivery !== false,
      }),
    });
    const body = await response.json();
    if (!response.ok || !body.ok) throw new Error(body.error || 'Unable to save alerts.');
    setPrefs(body.preferences);
    setStatus('Alert preferences saved.');
  };

  const enablePhoneAlerts = async () => {
    if (!phoneSupported) { setStatus('Phone alerts require an installed PWA/browser that supports Web Push.'); return; }
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('Notification permission was not granted.');
      const keyResponse = await fetch('/api/communications/push', { cache: 'no-store' });
      const keyBody = await keyResponse.json();
      if (!keyResponse.ok || !keyBody.publicKey) throw new Error(keyBody.error || 'Unable to initialize phone alerts.');
      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(keyBody.publicKey) });
      }
      const saveResponse = await fetch('/api/communications/push', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(subscription.toJSON()),
      });
      const saveBody = await saveResponse.json();
      if (!saveResponse.ok || !saveBody.ok) throw new Error(saveBody.error || 'Unable to save phone alerts.');
      await savePreferences({ push_enabled: true });
      setStatus('Phone alerts enabled on this device.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to enable phone alerts.');
    }
  };

  const disablePhoneAlerts = async () => {
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await fetch('/api/communications/push', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: subscription.endpoint }) });
        await subscription.unsubscribe();
      }
      await savePreferences({ push_enabled: false });
      setStatus('Phone alerts disabled on this device.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to disable phone alerts.');
    }
  };

  return (
    <div className="pm-comms">
      <section className="pm-card">
        <div className="pm-head"><div><h2>Company email</h2><p>Connect the mailbox Puma should send from. Credentials are stored encrypted in Supabase Vault, not on your phone.</p></div><span>{primaryMailbox?.verified_at ? 'Connected' : 'Not connected'}</span></div>
        <form className="pm-grid" onSubmit={saveMailbox}>
          <label><span>From name</span><input value={mailbox.fromName} onChange={(e) => setMailbox({ ...mailbox, fromName: e.target.value })} placeholder="Your name or company" /></label>
          <label><span>From email</span><input type="email" required value={mailbox.fromEmail} onChange={(e) => setMailbox({ ...mailbox, fromEmail: e.target.value })} placeholder="you@company.com" /></label>
          <label><span>SMTP host</span><input required value={mailbox.smtpHost} onChange={(e) => setMailbox({ ...mailbox, smtpHost: e.target.value })} placeholder="smtp.yourprovider.com" /></label>
          <label><span>SMTP port</span><input inputMode="numeric" required value={mailbox.smtpPort} onChange={(e) => setMailbox({ ...mailbox, smtpPort: e.target.value })} /></label>
          <label><span>SMTP username</span><input required value={mailbox.smtpUsername} onChange={(e) => setMailbox({ ...mailbox, smtpUsername: e.target.value })} placeholder="you@company.com" /></label>
          <label><span>Mailbox password / app password</span><input type="password" required value={mailbox.password} onChange={(e) => setMailbox({ ...mailbox, password: e.target.value })} autoComplete="new-password" /></label>
          <label className="pm-check"><input type="checkbox" checked={mailbox.smtpSecure} onChange={(e) => setMailbox({ ...mailbox, smtpSecure: e.target.checked })} /><span>Use direct TLS/SSL (commonly port 465)</span></label>
          <button type="submit" disabled={busy}>{busy ? 'Testing…' : 'Test mailbox & save'}</button>
        </form>
        <small>Google Workspace commonly uses smtp.gmail.com with an app password. Microsoft 365 commonly uses smtp.office365.com on port 587 with STARTTLS (leave direct TLS off).</small>
      </section>

      <section className="pm-card">
        <div className="pm-head"><div><h2>Scheduled outreach</h2><p>Queue an email now or for a future time. Puma sends it automatically from your connected company mailbox.</p></div></div>
        <form className="pm-grid" onSubmit={scheduleEmail}>
          <label><span>Recipient name</span><input value={outreach.recipientName} onChange={(e) => setOutreach({ ...outreach, recipientName: e.target.value })} /></label>
          <label><span>Recipient email</span><input type="email" required value={outreach.recipientEmail} onChange={(e) => setOutreach({ ...outreach, recipientEmail: e.target.value })} /></label>
          <label className="pm-wide"><span>Subject</span><input required value={outreach.subject} onChange={(e) => setOutreach({ ...outreach, subject: e.target.value })} /></label>
          <label className="pm-wide"><span>Message</span><textarea required rows={7} value={outreach.bodyText} onChange={(e) => setOutreach({ ...outreach, bodyText: e.target.value })} /></label>
          <label><span>Send at</span><input type="datetime-local" required value={outreach.scheduledFor} onChange={(e) => setOutreach({ ...outreach, scheduledFor: e.target.value })} /></label>
          <button type="submit" disabled={busy || !primaryMailbox}>Schedule email</button>
        </form>
        {messages.length > 0 && <div className="pm-outbox">{messages.slice(0, 8).map((message) => <div key={message.id}><span><strong>{message.subject}</strong><small>{message.recipient_email}</small></span><em>{message.status}</em></div>)}</div>}
      </section>

      <section className="pm-card">
        <div className="pm-head"><div><h2>Alerts</h2><p>Get notified when research finishes, follow-ups are due, or scheduled emails are delivered.</p></div></div>
        <div className="pm-alert-row"><span><strong>Phone alerts</strong><small>Web Push to this installed Puma app/device.</small></span><button type="button" onClick={() => void (prefs.push_enabled ? disablePhoneAlerts() : enablePhoneAlerts())}>{prefs.push_enabled ? 'Disable' : 'Enable'}</button></div>
        <div className="pm-alert-row"><span><strong>Email alerts</strong><small>Send alerts to whoever uses this Puma workspace.</small></span><input type="checkbox" checked={prefs.email_enabled === true} onChange={(e) => void savePreferences({ email_enabled: e.target.checked }).catch((error) => setStatus(error.message))} /></div>
        <label><span>Alert email</span><input type="email" value={alertEmail} onChange={(e) => setAlertEmail(e.target.value)} onBlur={() => prefs.email_enabled && void savePreferences({}).catch((error) => setStatus(error.message))} placeholder="alerts@company.com" /></label>
        <div className="pm-kinds">
          <label><input type="checkbox" checked={prefs.research_complete !== false} onChange={(e) => void savePreferences({ research_complete: e.target.checked }).catch((error) => setStatus(error.message))} /> Research complete</label>
          <label><input type="checkbox" checked={prefs.follow_up_due !== false} onChange={(e) => void savePreferences({ follow_up_due: e.target.checked }).catch((error) => setStatus(error.message))} /> Follow-ups due</label>
          <label><input type="checkbox" checked={prefs.email_delivery !== false} onChange={(e) => void savePreferences({ email_delivery: e.target.checked }).catch((error) => setStatus(error.message))} /> Email delivery</label>
        </div>
      </section>

      {status && <div className="pm-status" role="status" aria-live="polite">{status}</div>}

      <style jsx>{`
        .pm-comms{display:grid;gap:14px}.pm-card{border:1px solid rgba(255,255,255,.09);background:#0d0f10;border-radius:18px;padding:18px;display:grid;gap:16px}.pm-head{display:flex;justify-content:space-between;gap:14px;align-items:flex-start}.pm-head h2{margin:0 0 5px;font-size:17px}.pm-head p,.pm-card small{margin:0;color:#7f858a;font-size:12px;line-height:1.45}.pm-head>span{font-size:11px;color:#ff762c}.pm-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.pm-grid label,label{display:grid;gap:6px;color:#a9adb1;font-size:11px}.pm-grid input,.pm-grid textarea,.pm-card>label input{width:100%;box-sizing:border-box;border:1px solid rgba(255,255,255,.10);border-radius:11px;background:#08090a;color:#f3f3f1;padding:11px 12px;font:inherit}.pm-wide{grid-column:1/-1}.pm-check{display:flex!important;align-items:center;gap:8px}.pm-check input{width:auto!important}.pm-grid button,.pm-alert-row button{border:1px solid rgba(255,118,44,.35);background:rgba(255,118,44,.11);color:#ff762c;border-radius:11px;min-height:42px;padding:0 14px;font:inherit;font-weight:650}.pm-grid button:disabled{opacity:.45}.pm-alert-row{display:flex;align-items:center;justify-content:space-between;gap:15px;padding:12px 0;border-top:1px solid rgba(255,255,255,.06)}.pm-alert-row span{display:grid;gap:3px}.pm-alert-row small{font-size:11px}.pm-kinds{display:flex;flex-wrap:wrap;gap:12px;color:#a9adb1;font-size:12px}.pm-outbox{display:grid;gap:0;border-top:1px solid rgba(255,255,255,.06)}.pm-outbox>div{display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.06)}.pm-outbox span{display:grid;gap:3px}.pm-outbox strong{font-size:12px}.pm-outbox em{font-size:10px;color:#90959a;font-style:normal;text-transform:uppercase}.pm-status{position:sticky;bottom:90px;background:#17191b;border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:11px 13px;font-size:12px;color:#ddd;box-shadow:0 12px 30px rgba(0,0,0,.3)}@media(max-width:700px){.pm-grid{grid-template-columns:1fr}.pm-wide{grid-column:auto}.pm-card{padding:15px}}
      `}</style>
    </div>
  );
}
