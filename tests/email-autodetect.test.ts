import assert from 'node:assert/strict';
import test from 'node:test';
import { baseDomain, parseAutoconfig, presetForMxHost } from '../lib/email/autodetect';

test('MX hosts map to known mail providers', () => {
  assert.equal(presetForMxHost('aspmx.l.google.com'), 'gmail');
  assert.equal(presetForMxHost('acme-com.mail.protection.outlook.com'), 'outlook');
  assert.equal(presetForMxHost('mx.zoho.com'), 'zoho');
  assert.equal(presetForMxHost('mailstore1.secureserver.net'), 'godaddy');
  assert.equal(presetForMxHost('in1-smtp.messagingengine.com'), 'fastmail');
  assert.equal(presetForMxHost('mx.example.net'), null);
});

test('baseDomain trims MX hosts to their provider domain', () => {
  assert.equal(baseDomain('aspmx.l.google.com'), 'google.com');
  assert.equal(baseDomain('mx1.mail.example.co.uk'), 'example.co.uk');
  assert.equal(baseDomain('example.com'), 'example.com');
});

test('Thunderbird autoconfig XML yields secure SMTP and IMAP endpoints', () => {
  const xml = `<clientConfig><emailProvider id="example.com">
    <incomingServer type="imap"><hostname>imap.%EMAILDOMAIN%</hostname><port>993</port><socketType>SSL</socketType></incomingServer>
    <outgoingServer type="smtp"><hostname>smtp.example.com</hostname><port>25</port><socketType>plain</socketType></outgoingServer>
    <outgoingServer type="smtp"><hostname>smtp.example.com</hostname><port>587</port><socketType>STARTTLS</socketType></outgoingServer>
  </emailProvider></clientConfig>`;
  const parsed = parseAutoconfig(xml, 'me@example.com');
  assert.deepEqual(parsed.imap, { host: 'imap.example.com', port: 993, secure: true });
  assert.deepEqual(parsed.smtp, { host: 'smtp.example.com', port: 587, secure: false });
});
