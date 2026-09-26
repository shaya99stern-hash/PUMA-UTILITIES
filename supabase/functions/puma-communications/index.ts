import { createClient } from 'npm:@supabase/supabase-js@2.109.0';
import nodemailer from 'npm:nodemailer@^9';
import webpush from 'npm:web-push@^3.6.7';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const publishableKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' } });
}

function bearer(request: Request) {
  const value = request.headers.get('authorization') ?? '';
  return value.toLowerCase().startsWith('bearer ') ? value.slice(7).trim() : '';
}

async function authenticatedUser(request: Request) {
  const token = bearer(request);
  if (!token) return null;
  const result = await admin.auth.getUser(token);
  return result.data.user ?? null;
}

async function ownsWorkspace(userId: string, workspaceId: string) {
  const result = await admin.from('workspaces').select('id').eq('id', workspaceId).eq('owner_user_id', userId).maybeSingle();
  return Boolean(result.data?.id);
}

async function mailboxSecret(mailboxId: string) {
  const result = await admin.rpc('get_mailbox_secret', { p_mailbox_id: mailboxId });
  if (result.error || typeof result.data !== 'string' || !result.data) throw new Error('Mailbox credential is unavailable.');
  return result.data;
}

async function mailboxTransport(mailbox: any, password?: string) {
  const credential = password || await mailboxSecret(mailbox.id);
  return nodemailer.createTransport({
    host: mailbox.smtp_host,
    port: Number(mailbox.smtp_port),
    secure: Boolean(mailbox.smtp_secure),
    auth: { user: mailbox.smtp_username, pass: credential },
    connectionTimeout: 12000,
    greetingTimeout: 12000,
    socketTimeout: 20000,
  });
}

async function ensurePushSigning() {
  const existing = await admin.rpc('get_push_signing_material');
  const row = Array.isArray(existing.data) ? existing.data[0] : existing.data;
  if (!existing.error && row?.public_material && row?.secret_material) {
    return { publicKey: row.public_material as string, privateKey: row.secret_material as string };
  }

  const generated = webpush.generateVAPIDKeys();
  const saved = await admin.rpc('save_push_signing_material', {
    p_public_material: generated.publicKey,
    p_secret_material: generated.privateKey,
  });
  if (saved.error) throw new Error(`Unable to initialize phone alerts: ${saved.error.message}`);
  return { publicKey: generated.publicKey, privateKey: generated.privateKey };
}

async function saveMailbox(request: Request, body: any) {
  const user = await authenticatedUser(request);
  if (!user) return json({ ok: false, error: 'Unauthorized.' }, 401);
  const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : '';
  if (!workspaceId || !(await ownsWorkspace(user.id, workspaceId))) return json({ ok: false, error: 'Workspace not found.' }, 404);

  const fromEmail = String(body.fromEmail ?? '').trim();
  const smtpHost = String(body.smtpHost ?? '').trim();
  const smtpUsername = String(body.smtpUsername ?? '').trim();
  const password = String(body.password ?? '');
  const smtpPort = Number(body.smtpPort ?? 465);
  if (!fromEmail || !smtpHost || !smtpUsername || !password || !Number.isInteger(smtpPort)) {
    return json({ ok: false, error: 'Complete all company email fields.' }, 400);
  }

  const draft = {
    id: typeof body.mailboxId === 'string' && body.mailboxId ? body.mailboxId : crypto.randomUUID(),
    workspace_id: workspaceId,
    label: String(body.label ?? 'Company email').trim() || 'Company email',
    from_name: String(body.fromName ?? '').trim() || null,
    from_email: fromEmail,
    smtp_host: smtpHost,
    smtp_port: smtpPort,
    smtp_secure: body.smtpSecure !== false,
    smtp_username: smtpUsername,
    is_default: true,
    updated_at: new Date().toISOString(),
  };

  try {
    const transport = await mailboxTransport(draft, password);
    await transport.verify();
  } catch (error) {
    return json({ ok: false, error: `Mailbox test failed: ${error instanceof Error ? error.message : String(error)}` }, 400);
  }

  const upserted = await admin.from('mailboxes').upsert(draft, { onConflict: 'id' }).select('id,from_email,from_name,smtp_host,smtp_port,smtp_secure,smtp_username,verified_at').single();
  if (upserted.error || !upserted.data) return json({ ok: false, error: upserted.error?.message ?? 'Unable to save mailbox.' }, 500);

  const secret = await admin.rpc('save_mailbox_secret', { p_mailbox_id: upserted.data.id, p_password: password });
  if (secret.error) return json({ ok: false, error: secret.error.message }, 500);

  const verifiedAt = new Date().toISOString();
  await admin.from('mailboxes').update({ verified_at: verifiedAt, updated_at: verifiedAt }).eq('id', upserted.data.id);
  return json({ ok: true, mailbox: { ...upserted.data, verified_at: verifiedAt } });
}

async function processOutbound(workerName: string) {
  const leased = await admin.rpc('lease_outbound_messages', { worker_name: workerName, max_messages: 10 });
  if (leased.error) throw new Error(leased.error.message);
  const messages = Array.isArray(leased.data) ? leased.data : [];
  let sent = 0;

  for (const message of messages) {
    try {
      await admin.from('outbound_messages').update({ status: 'sending', updated_at: new Date().toISOString() }).eq('id', message.id);
      const mailboxResult = await admin.from('mailboxes').select('*').eq('id', message.mailbox_id).single();
      if (mailboxResult.error || !mailboxResult.data) throw new Error('Connected company email was not found.');
      const transport = await mailboxTransport(mailboxResult.data);
      await transport.sendMail({
        from: mailboxResult.data.from_name ? `${mailboxResult.data.from_name} <${mailboxResult.data.from_email}>` : mailboxResult.data.from_email,
        to: message.recipient_name ? `${message.recipient_name} <${message.recipient_email}>` : message.recipient_email,
        subject: message.subject,
        text: message.body_text,
        html: message.body_html || undefined,
      });
      const now = new Date().toISOString();
      await admin.from('outbound_messages').update({ status: 'sent', sent_at: now, lease_owner: null, lease_expires_at: null, last_error: null, updated_at: now }).eq('id', message.id);
      await admin.from('notifications').upsert({
        workspace_id: message.workspace_id,
        kind: 'email_delivery',
        title: 'Email sent',
        body: `Puma sent “${message.subject}” to ${message.recipient_email}.`,
        href: '/clients',
        dedupe_key: `email-sent:${message.id}`,
      }, { onConflict: 'workspace_id,dedupe_key' });
      sent += 1;
    } catch (error) {
      const finalAttempt = Number(message.attempt_count ?? 0) >= Number(message.max_attempts ?? 3);
      const errorText = error instanceof Error ? error.message : String(error);
      const nextTime = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      await admin.from('outbound_messages').update({
        status: finalAttempt ? 'failed' : 'queued',
        scheduled_for: finalAttempt ? message.scheduled_for : nextTime,
        lease_owner: null,
        lease_expires_at: null,
        last_error: errorText.slice(0, 1000),
        updated_at: new Date().toISOString(),
      }).eq('id', message.id);
      if (finalAttempt) {
        await admin.from('notifications').upsert({
          workspace_id: message.workspace_id,
          kind: 'email_delivery',
          title: 'Email could not be sent',
          body: `Puma could not send “${message.subject}” to ${message.recipient_email}.`,
          href: '/settings/communications',
          dedupe_key: `email-failed:${message.id}`,
        }, { onConflict: 'workspace_id,dedupe_key' });
      }
    }
  }
  return sent;
}

async function processNotifications() {
  const pending = await admin.from('notifications').select('*').or('push_status.eq.pending,email_status.eq.pending').order('created_at', { ascending: true }).limit(25);
  if (pending.error) throw new Error(pending.error.message);
  let delivered = 0;
  let pushKeys: { publicKey: string; privateKey: string } | null = null;

  for (const notice of pending.data ?? []) {
    const prefsResult = await admin.from('notification_preferences').select('*').eq('workspace_id', notice.workspace_id).maybeSingle();
    const prefs = prefsResult.data;
    const kindEnabled = notice.kind === 'research_complete' ? prefs?.research_complete !== false
      : notice.kind === 'follow_up_due' ? prefs?.follow_up_due !== false
        : prefs?.email_delivery !== false;

    let pushStatus = notice.push_status;
    let emailStatus = notice.email_status;
    let pushError: string | null = null;
    let emailError: string | null = null;

    if (pushStatus === 'pending') {
      if (!prefs?.push_enabled || !kindEnabled) {
        pushStatus = 'disabled';
      } else {
        try {
          pushKeys ||= await ensurePushSigning();
          webpush.setVapidDetails('mailto:alerts@puma-utilities.app', pushKeys.publicKey, pushKeys.privateKey);
          const subscriptions = await admin.from('push_subscriptions').select('*').eq('workspace_id', notice.workspace_id);
          if (!subscriptions.data?.length) {
            pushStatus = 'disabled';
          } else {
            await Promise.all(subscriptions.data.map(async (sub: any) => {
              try {
                await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify({ title: notice.title, body: notice.body, href: notice.href || '/' }));
                await admin.from('push_subscriptions').update({ last_used_at: new Date().toISOString() }).eq('id', sub.id);
              } catch (error: any) {
                if (error?.statusCode === 404 || error?.statusCode === 410) await admin.from('push_subscriptions').delete().eq('id', sub.id);
                else throw error;
              }
            }));
            pushStatus = 'sent';
          }
        } catch (error) {
          pushStatus = 'failed';
          pushError = error instanceof Error ? error.message : String(error);
        }
      }
    }

    if (emailStatus === 'pending') {
      if (!prefs?.email_enabled || !prefs?.alert_email || !kindEnabled) {
        emailStatus = 'disabled';
      } else {
        try {
          const mailboxResult = await admin.from('mailboxes').select('*').eq('workspace_id', notice.workspace_id).eq('is_default', true).not('verified_at', 'is', null).limit(1).maybeSingle();
          if (!mailboxResult.data) {
            emailStatus = 'disabled';
          } else {
            const transport = await mailboxTransport(mailboxResult.data);
            await transport.sendMail({
              from: mailboxResult.data.from_name ? `${mailboxResult.data.from_name} <${mailboxResult.data.from_email}>` : mailboxResult.data.from_email,
              to: prefs.alert_email,
              subject: `[Puma] ${notice.title}`,
              text: `${notice.body}\n\nOpen Puma: ${notice.href || '/'}`,
            });
            emailStatus = 'sent';
          }
        } catch (error) {
          emailStatus = 'failed';
          emailError = error instanceof Error ? error.message : String(error);
        }
      }
    }

    await admin.from('notifications').update({ push_status: pushStatus, email_status: emailStatus, push_error: pushError, email_error: emailError }).eq('id', notice.id);
    if (pushStatus === 'sent' || emailStatus === 'sent') delivered += 1;
  }
  return delivered;
}

async function workerTick(request: Request) {
  const token = bearer(request);
  const verified = await admin.rpc('verify_communications_worker_token', { candidate_token: token });
  if (verified.error || verified.data !== true) return json({ ok: false, error: 'Unauthorized.' }, 401);

  await admin.rpc('enqueue_due_follow_up_notifications', { max_rows: 50 });
  const workerName = `communications:${crypto.randomUUID()}`;
  const sent = await processOutbound(workerName);
  const alerts = await processNotifications();
  return json({ ok: true, sent, alerts });
}

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405);
  let body: any = {};
  try { body = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON.' }, 400); }

  if (body.action === 'worker_tick') return workerTick(request);
  if (body.action === 'save_mailbox') return saveMailbox(request, body);

  if (body.action === 'push_key') {
    const user = await authenticatedUser(request);
    if (!user) return json({ ok: false, error: 'Unauthorized.' }, 401);
    const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : '';
    if (!workspaceId || !(await ownsWorkspace(user.id, workspaceId))) return json({ ok: false, error: 'Workspace not found.' }, 404);
    const keys = await ensurePushSigning();
    return json({ ok: true, publicKey: keys.publicKey });
  }

  return json({ ok: false, error: 'Unknown action.' }, 400);
});
