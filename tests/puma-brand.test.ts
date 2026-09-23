import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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

test('Home Screen metadata uses the dedicated uploaded Puma app icon', () => {
  assert.match(layout, /HOME_ICON = '\/puma-home-icon\.jpeg\?v=20260923-1'/);
  assert.match(layout, /apple:\s*\[\{ url: HOME_ICON/);
  assert.match(manifest, /src:\s*'\/puma-home-icon\.jpeg\?v=20260923-1'/);
  assert.match(manifest, /sizes:\s*'1254x1254'/);
});
