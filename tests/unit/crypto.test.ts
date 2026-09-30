import { test } from 'node:test';
import assert from 'node:assert';
import { randomBytes } from 'node:crypto';

// Helper to load crypto functions dynamically
async function loadCrypto() {
  const testKey = randomBytes(32).toString('base64');
  process.env.PUMA_ENCRYPTION_KEY = testKey;
  try {
    return await import('@/lib/server/crypto');
  } catch (err) {
    console.error('Failed to load crypto module:', err);
    throw err;
  }
}

test('encryptSecret and decryptSecret roundtrip', async () => {
  const crypto = await loadCrypto();
  const plaintext = 'my-secret-password-123';
  const encrypted = crypto.encryptSecret(plaintext);
  const decrypted = crypto.decryptSecret(encrypted);
  assert.strictEqual(decrypted, plaintext);
});

test('encryptSecret produces different ciphertext for same plaintext', async () => {
  const crypto = await loadCrypto();
  const plaintext = 'test-secret';
  const encrypted1 = crypto.encryptSecret(plaintext);
  const encrypted2 = crypto.encryptSecret(plaintext);
  assert.notStrictEqual(encrypted1, encrypted2);
  assert.strictEqual(crypto.decryptSecret(encrypted1), plaintext);
  assert.strictEqual(crypto.decryptSecret(encrypted2), plaintext);
});

test('encryptSecret format is v1.<iv>.<tag>.<ciphertext>', async () => {
  const crypto = await loadCrypto();
  const encrypted = crypto.encryptSecret('test');
  const parts = encrypted.split('.');
  assert.strictEqual(parts.length, 4);
  assert.strictEqual(parts[0], 'v1');
  assert.ok(parts[1]); // iv
  assert.ok(parts[2]); // tag
  assert.ok(parts[3]); // ciphertext
});

test('decryptSecret throws on invalid format', async () => {
  const crypto = await loadCrypto();
  assert.throws(() => crypto.decryptSecret('invalid-format'), /Unrecognized secret format/);
  assert.throws(() => crypto.decryptSecret('v1.only.two'), /Unrecognized secret format/);
  assert.throws(() => crypto.decryptSecret('v2.iv.tag.ciphertext'), /Unrecognized secret format/);
});

test('decryptSecret throws on tampered ciphertext', async () => {
  const crypto = await loadCrypto();
  const plaintext = 'secret';
  const encrypted = crypto.encryptSecret(plaintext);
  const parts = encrypted.split('.');

  // Tamper with the ciphertext
  const tampered = [parts[0], parts[1], parts[2], 'AAAA'].join('.');

  assert.throws(() => crypto.decryptSecret(tampered), /Unsupported state or unable to authenticate data/);
});

test('decryptSecret throws on tampered tag', async () => {
  const crypto = await loadCrypto();
  const plaintext = 'secret';
  const encrypted = crypto.encryptSecret(plaintext);
  const parts = encrypted.split('.');

  // Tamper with the authentication tag
  const tampered = [parts[0], parts[1], 'AAAA', parts[3]].join('.');

  assert.throws(() => crypto.decryptSecret(tampered));
});

test('decryptSecret with wrong key throws', async () => {
  const crypto1 = await loadCrypto();
  const plaintext = 'secret';
  const encrypted = crypto1.encryptSecret(plaintext);

  // Load with a different key
  const wrongKey = randomBytes(32).toString('base64');
  process.env.PUMA_ENCRYPTION_KEY = wrongKey;

  const crypto2 = await import('@/lib/server/crypto');

  assert.throws(() => crypto2.decryptSecret(encrypted));
});

test('sha256 produces consistent hash', async () => {
  const crypto = await loadCrypto();
  const value = 'test-value';
  const hash1 = crypto.sha256(value);
  const hash2 = crypto.sha256(value);
  assert.strictEqual(hash1, hash2);
  assert.strictEqual(hash1.length, 64); // SHA256 in hex is 64 chars
});

test('sha256 produces different hashes for different values', async () => {
  const crypto = await loadCrypto();
  const hash1 = crypto.sha256('value1');
  const hash2 = crypto.sha256('value2');
  assert.notStrictEqual(hash1, hash2);
});

test('safeEqual compares strings in constant time', async () => {
  const crypto = await loadCrypto();
  const a = 'secret-string';
  const b = 'secret-string';
  const c = 'different-string';

  assert.ok(crypto.safeEqual(a, b));
  assert.ok(!crypto.safeEqual(a, c));
});

test('safeEqual handles different length strings', async () => {
  const crypto = await loadCrypto();
  assert.ok(!crypto.safeEqual('short', 'much-longer-string'));
  assert.ok(!crypto.safeEqual('', 'nonempty'));
});
