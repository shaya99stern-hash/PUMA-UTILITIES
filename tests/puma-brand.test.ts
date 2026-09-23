import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const brand = readFileSync('app/puma-brand.css', 'utf8');
const ios = readFileSync('app/ios-native.css', 'utf8');
const layout = readFileSync('app/layout.tsx', 'utf8');
const manifest = readFileSync('app/manifest.ts', 'utf8');
const iconResponse = readFileSync('app/components/puma-icon-response.tsx', 'utf8');

test('in-app Puma marks use the transparent uploaded brand artwork', () => {
  assert.match(brand, /--puma-brand-logo:\s*url\("data:image\/png;base64,/);
  assert.match(brand, /background-image:\s*var\(--puma-brand-logo\)/);
  assert.match(ios, /\.pm-brand-mark\s*\{[\s\S]*?background-image:\s*var\(--puma-brand-logo\)\s*!important/);
  assert.match(ios, /\.pm-brand-mark svg\s*\{[\s\S]*?display:\s*none\s*!important/);
  assert.doesNotMatch(brand, /apple-touch-icon/);
});

test('Home Screen PNG endpoints resize the stable uploaded Puma file without base64 decoding', () => {
  assert.match(layout, /APPLE_ICON = '\/apple-touch-icon\?v=20260923-2'/);
  assert.match(layout, /PWA_ICON_192 = '\/pwa-icon-192\?v=20260923-2'/);
  assert.match(layout, /PWA_ICON_512 = '\/pwa-icon-512\?v=20260923-2'/);
  assert.match(layout, /apple:\s*\[\{ url: APPLE_ICON, sizes: '180x180', type: 'image\/png' \}\]/);
  assert.match(manifest, /src:\s*'\/pwa-icon-192\?v=20260923-2'/);
  assert.match(manifest, /src:\s*'\/pwa-icon-512\?v=20260923-2'/);
  assert.match(iconResponse, /new URL\('\/puma-home-icon\.jpeg',\s*_request\.url\)/);
  assert.match(iconResponse, /<img/);
  assert.match(iconResponse, /ImageResponse/);
  assert.doesNotMatch(iconResponse, /data:image\/jpeg;base64,/);
  assert.doesNotMatch(iconResponse, /\batob\s*\(/);
  assert.doesNotMatch(iconResponse, /<svg/);
  assert.doesNotMatch(layout, /puma-home-icon\.jpeg/);
  assert.doesNotMatch(manifest, /puma-home-icon\.jpeg/);
});
