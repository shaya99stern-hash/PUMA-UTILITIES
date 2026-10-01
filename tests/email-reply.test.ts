import assert from 'node:assert/strict';
import test from 'node:test';
import { detectBounce, isAutoReply, matchReply, normalizeSubject, parseMessageIds, threadKeyFor } from '../lib/email/reply';
import { followUpHeaders } from '../lib/email/threading';

test('subject normalization strips reply/forward prefixes', () => {
  assert.equal(normalizeSubject('RE: Re: FW: Water  savings '), 'water savings');
  assert.equal(normalizeSubject('Aw: Hello'), 'hello');
  assert.equal(normalizeSubject(null), '');
});

test('message id parsing', () => {
  assert.deepEqual(parseMessageIds('<A@x.com> <b@y.com>\n <a@x.com>'), ['<A@x.com>', '<b@y.com>']);
  assert.deepEqual(parseMessageIds(null), []);
});

test('thread key uses the root of References, then In-Reply-To, then own id, then subject', () => {
  const root = threadKeyFor({ messageId: '<m1@x>' });
  assert.equal(threadKeyFor({ messageId: '<m2@x>', inReplyTo: '<m1@x>', references: ['<m1@x>'] }), root);
  assert.equal(threadKeyFor({ messageId: '<m3@x>', inReplyTo: '<m2@x>', references: ['<M1@x>', '<m2@x>'] }), root);
  assert.equal(threadKeyFor({ messageId: '<m2@x>', inReplyTo: '<m1@x>' }), root);
  const a = threadKeyFor({ subject: 'Re: Hello', counterparty: 'A@b.com' });
  assert.equal(a, threadKeyFor({ subject: 'hello', counterparty: 'a@b.com' }));
  assert.notEqual(a, threadKeyFor({ subject: 'hello', counterparty: 'c@d.com' }));
});

test('follow-ups reference the whole chain and reply to the last message', () => {
  const h = followUpHeaders(['<a@x>', '<b@x>']);
  assert.equal(h.inReplyTo, '<b@x>');
  assert.deepEqual(h.references, ['<a@x>', '<b@x>']);
  assert.deepEqual(followUpHeaders([]), { inReplyTo: null, references: [] });
});

const candidates = [
  { recipientId: 'r1', email: 'jane@acme.com', status: 'active', messageIds: ['<sent1@puma>'] },
  { recipientId: 'r2', email: 'bob@other.com', status: 'active', messageIds: ['<sent2@puma>'] },
  { recipientId: 'r3', email: 'new@fresh.com', status: 'queued', messageIds: [] },
];

test('reply matching: by In-Reply-To, by References, then by sender address', () => {
  const byHeader = matchReply({ fromEmail: 'assistant@acme.com', inReplyTo: '<SENT1@puma>', references: [] }, candidates);
  assert.equal(byHeader?.candidate.recipientId, 'r1');
  assert.equal(byHeader?.by, 'header');
  const byRefs = matchReply({ fromEmail: 'x@y.com', inReplyTo: '<zzz@y>', references: ['<root@y>', '<sent2@puma>'] }, candidates);
  assert.equal(byRefs?.candidate.recipientId, 'r2');
  const byFrom = matchReply({ fromEmail: 'Jane@Acme.com', inReplyTo: null, references: [] }, candidates);
  assert.equal(byFrom?.candidate.recipientId, 'r1');
  assert.equal(byFrom?.by, 'from');
  // someone we have not emailed yet is not a reply
  assert.equal(matchReply({ fromEmail: 'new@fresh.com', inReplyTo: null, references: [] }, candidates), null);
  assert.equal(matchReply({ fromEmail: 'stranger@z.com', inReplyTo: '<unknown@z>', references: [] }, candidates), null);
});

test('auto replies are recognized', () => {
  assert.equal(isAutoReply({ autoSubmitted: 'auto-replied' }), true);
  assert.equal(isAutoReply({ autoSubmitted: 'no' }), false);
  assert.equal(isAutoReply({ subject: 'Automatic reply: Water savings' }), true);
  assert.equal(isAutoReply({ subject: 'Re: Out of office' }), true);
  assert.equal(isAutoReply({ subject: 'Re: Water savings' }), false);
});

const dsn = `This is the mail system at host mx.example.com.

I'm sorry to have to inform you that your message could not be delivered to one or more recipients.

Final-Recipient: rfc822; ghost@acme.com
Action: failed
Status: 5.1.1
Diagnostic-Code: smtp; 550 5.1.1 <ghost@acme.com>: Recipient address rejected: User unknown

Message-ID: <sent1@puma.test>
`;

test('bounce detection: permanent failure from a mail daemon', () => {
  const b = detectBounce({ fromEmail: 'MAILER-DAEMON@mx.example.com', subject: 'Undelivered Mail Returned to Sender', text: dsn, ownEmails: ['me@puma.test'] });
  assert.equal(b.isBounce, true);
  assert.equal(b.permanent, true);
  assert.equal(b.recipientEmail, 'ghost@acme.com');
  assert.deepEqual(b.originalMessageIds, ['<sent1@puma.test>']);
  assert.ok(b.reason?.includes('User unknown'));
});

test('bounce detection: temporary failures do not suppress; normal mail is not a bounce', () => {
  const soft = detectBounce({
    fromEmail: 'postmaster@mx.example.com',
    subject: 'Delivery Status Notification (Delay)',
    text: 'Delivery to the following recipient has been delayed: slow@acme.com. Status: 4.2.2 mailbox full, will try again later',
  });
  assert.equal(soft.isBounce, true);
  assert.equal(soft.permanent, false);
  assert.equal(soft.recipientEmail, 'slow@acme.com');
  const human = detectBounce({ fromEmail: 'jane@acme.com', subject: 'Re: Water savings', text: 'Sounds interesting, call me.' });
  assert.equal(human.isBounce, false);
  const gmail = detectBounce({
    fromEmail: 'mailer-daemon@googlemail.com',
    fromName: 'Mail Delivery Subsystem',
    subject: 'Delivery Status Notification (Failure)',
    text: "Your message wasn't delivered to nobody@acme.com because the address couldn't be found, or is unable to receive mail. 550 5.1.1 user unknown",
    ownEmails: ['me@puma.test'],
  });
  assert.equal(gmail.isBounce, true);
  assert.equal(gmail.permanent, true);
  assert.equal(gmail.recipientEmail, 'nobody@acme.com');
});
