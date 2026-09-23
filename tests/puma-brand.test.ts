import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ios = readFileSync('app/ios-native.css', 'utf8');
const brand = readFileSync('app/puma-brand.css', 'utf8');
const layout = readFileSync('app/layout.tsx', 'utf8');
const manifest = readFileSync('app/manifest.ts', 'utf8');

test('in-app Puma branding uses the dedicated transparent logo instead of the Home Screen icon', () => {
  assert.match(ios, /\.pm-brand-mark::before[\s\S]*?puma-logo/);
  assert.match(ios, /\.pm-brand-mark svg[\s\S]*?display:\s*none\s*!important/);
  assert.match(brand, /puma-logo/);
  assert.doesNotMatch(ios, /apple-touch-icon|puma-home-icon/);
  assert.doesNotMatch(brand, /apple-touch-icon|puma-home-icon/);
  assert.doesNotMatch(ios, /mix-blend-mode\s*:/);
});

test('install metadata uses the exact dedicated Puma Home Screen artwork', () => {
  assert.match(layout, /puma-home-icon\.jpeg\?v=20260923-1/);
  assert.match(manifest, /puma-home-icon\.jpeg\?v=20260923-1/);
  assert.match(manifest, /sizes:\s*'1254x1254'/);
  assert.match(manifest, /type:\s*'image\/jpeg'/);
});
