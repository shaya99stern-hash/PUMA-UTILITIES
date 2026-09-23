import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const brand = readFileSync('app/puma-brand.css', 'utf8');
const ios = readFileSync('app/ios-native.css', 'utf8');
const layout = readFileSync('app/layout.tsx', 'utf8');
const manifest = readFileSync('app/manifest.ts', 'utf8');

test('in-app Puma marks use the transparent uploaded brand artwork', () => {
  assert.match(brand, /--puma-brand-logo:\s*url\("data:image\/png;base64,/);
  assert.match(brand, /background-image:\s*var\(--puma-brand-logo\)/);
  assert.match(ios, /\.pm-brand-mark\s*\{[\s\S]*?background-image:\s*var\(--puma-brand-logo\)\s*!important/);
  assert.match(ios, /\.pm-brand-mark svg\s*\{[\s\S]*?display:\s*none\s*!important/);
  assert.doesNotMatch(brand, /apple-touch-icon/);
});

test('Home Screen metadata uses dedicated PNG Puma app icons', () => {
  assert.match(layout, /HOME_ICON_180 = '\/puma-app-icon-180\.png\?v=20260923-2'/);
  assert.match(layout, /HOME_ICON_192 = '\/puma-app-icon-192\.png\?v=20260923-2'/);
  assert.match(layout, /HOME_ICON_512 = '\/puma-app-icon-512\.png\?v=20260923-2'/);
  assert.match(layout, /apple:\s*\[\{ url: HOME_ICON_180, sizes: '180x180', type: 'image\/png' \}\]/);
  assert.match(manifest, /src:\s*'\/puma-app-icon-192\.png\?v=20260923-2'/);
  assert.match(manifest, /src:\s*'\/puma-app-icon-512\.png\?v=20260923-2'/);
  assert.equal(existsSync('public/puma-app-icon-180.png'), true);
  assert.equal(existsSync('public/puma-app-icon-192.png'), true);
  assert.equal(existsSync('public/puma-app-icon-512.png'), true);
  assert.doesNotMatch(layout, /puma-home-icon\.jpeg/);
  assert.doesNotMatch(manifest, /puma-home-icon\.jpeg/);
});
