import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const brand = readFileSync('app/puma-brand.css', 'utf8');
const ios = readFileSync('app/ios-native.css', 'utf8');
const layout = readFileSync('app/layout.tsx', 'utf8');
const manifest = readFileSync('app/manifest.ts', 'utf8');
const iconResponse = readFileSync('app/components/puma-icon-response.tsx', 'utf8');
const applePngRoute = readFileSync('app/apple-touch-icon.png/route.ts', 'utf8');

test('in-app Puma marks use the transparent uploaded brand artwork', () => {
  assert.match(brand, /--puma-brand-logo:\s*url\("data:image\/png;base64,/);
  assert.match(brand, /background-image:\s*var\(--puma-brand-logo\)/);
  assert.match(ios, /\.pm-brand-mark\s*\{[\s\S]*?background-image:\s*var\(--puma-brand-logo\)\s*!important/);
  assert.match(ios, /\.pm-brand-mark svg\s*\{[\s\S]*?display:\s*none\s*!important/);
  assert.doesNotMatch(brand, /apple-touch-icon/);
});

test('iOS install metadata uses the stable embedded 180px PNG while PWA sizes remain generated', () => {
  assert.match(layout, /APPLE_ICON = '\/apple-touch-icon\.png\?v=20260923-3'/);
  assert.match(layout, /PWA_ICON_192 = '\/pwa-icon-192\?v=20260923-2'/);
  assert.match(layout, /PWA_ICON_512 = '\/pwa-icon-512\?v=20260923-2'/);
  assert.match(layout, /apple:\s*\[\{ url: APPLE_ICON, sizes: '180x180', type: 'image\/png' \}\]/);
  assert.match(manifest, /src:\s*'\/pwa-icon-192\?v=20260923-2'/);
  assert.match(manifest, /src:\s*'\/pwa-icon-512\?v=20260923-2'/);
  assert.match(applePngRoute, /Buffer\.from\(\[chunk0, chunkA, chunk1, chunk2, chunk3, chunkZ\]\.join\(''\), 'base64'\)/);
  assert.match(applePngRoute, /'Content-Type': 'image\/png'/);
  assert.match(iconResponse, /new URL\('\/puma-home-icon\.jpeg',\s*_request\.url\)/);
  assert.match(iconResponse, /<img/);
  assert.match(iconResponse, /ImageResponse/);
  assert.doesNotMatch(layout, /puma-home-icon\.jpeg/);
  assert.doesNotMatch(manifest, /puma-home-icon\.jpeg/);
});
