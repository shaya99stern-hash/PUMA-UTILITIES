import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import { randomBytes } from 'node:crypto';

// Set up test encryption key before importing crypto module
const testKey = randomBytes(32).toString('base64');
process.env.PUMA_ENCRYPTION_KEY = testKey;

import { encryptSecret, decryptSecret, sha256, safeEqual } from '@/lib/server/crypto';

test('encryptSecret and decryptSecret roundtrip', () => {
  const plaintext = 'my-secret-password-123';
  const encrypted = encryptSecret(plaintext);
  const decrypted = decryptSecret(encrypted);
  assert.strictEqual(decrypted, plaintext);
});

test('encryptSecret produces different ciphertext for same plaintext', () => {
  const plaintext = 'test-secret';
  const encrypted1 = encryptSecret(plaintext);
  const encrypted2 = encryptSecret(plaintext);
  assert.notStrictEqual(encrypted1, encrypted2);
  assert.strictEqual(decryptSecret(encrypted1), plaintext);
  assert.strictEqual(decryptSecret(encrypted2), plaintext);
});

test('encryptSecret format is v1.<iv>.<tag>.<ciphertext>', () => {
  const encrypted = encryptSecret('test');
  const parts = encrypted.split('.');
  assert.strictEqual(parts.length, 4);
  assert.strictEqual(parts[0], 'v1');
  assert.ok(parts[1]); // iv
  assert.ok(parts[2]); // tag
  assert.ok(parts[3]); // ciphertext
});

test('decryptSecret throws on invalid format', () => {
  assert.throws(() => decryptSecret('invalid-format'), /Unrecognized secret format/);
  assert.throws(() => decryptSecret('v1.only.two'), /Unrecognized secret format/);
  assert.throws(() => decryptSecret('v2.iv.tag.ciphertext'), /Unrecognized secret format/);
});

test('decryptSecret throws on tampered ciphertext', () => {
  const plaintext = 'secret';
  const encrypted = encryptSecret(plaintext);
  const parts = encrypted.split('.');

  // Tamper with the ciphertext
  const tampered = [parts[0], parts[1], parts[2], 'AAAA'].join('.');

  assert.throws(() => decryptSecret(tampered), /Unsupported state or unable to authenticate data/);
});

test('decryptSecret throws on tampered tag', () => {
  const plaintext = 'secret';
  const encrypted = encryptSecret(plaintext);
  const parts = encrypted.split('.');

  // Tamper with the authentication tag
  const tampered = [parts[0], parts[1], 'AAAA', parts[3]].join('.');

  assert.throws(() => decryptSecret(tampered));
});

test('decryptSecret with wrong key throws', () => {
  const plaintext = 'secret';
  const encrypted = encryptSecret(plaintext);

  // Change the encryption key
  const wrongKey = randomBytes(32).toString('base64');
  process.env.PUMA_ENCRYPTION_KEY = wrongKey;

  assert.throws(() => decryptSecret(encrypted));

  // Restore original key for next tests
  process.env.PUMA_ENCRYPTION_KEY = testKey;
});

test('sha256 produces consistent hash', () => {
  const value = 'test-value';
  const hash1 = sha256(value);
  const hash2 = sha256(value);
  assert.strictEqual(hash1, hash2);
  assert.strictEqual(hash1.length, 64); // SHA256 in hex is 64 chars
});

test('sha256 produces different hashes for different values', () => {
  const hash1 = sha256('value1');
  const hash2 = sha256('value2');
  assert.notStrictEqual(hash1, hash2);
});

test('safeEqual compares strings in constant time', () => {
  const a = 'secret-string';
  const b = 'secret-string';
  const c = 'different-string';

  assert.ok(safeEqual(a, b));
  assert.ok(!safeEqual(a, c));
});

test('safeEqual handles different length strings', () => {
  assert.ok(!safeEqual('short', 'much-longer-string'));
  assert.ok(!safeEqual('', 'nonempty'));
});
