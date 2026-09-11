import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ios = readFileSync('app/ios-native.css', 'utf8');

test('in-app Puma marks use the app background without blend-mode hacks', () => {
  assert.match(ios, /\.pm-brand-mark\s*\{[\s\S]*?background:\s*(?:var\(--pm-bg\)|#050607)/);
  assert.doesNotMatch(ios, /mix-blend-mode\s*:/);
});
