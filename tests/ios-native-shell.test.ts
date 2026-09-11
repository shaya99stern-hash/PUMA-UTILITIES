import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ios = readFileSync('app/ios-native.css', 'utf8');
const layout = readFileSync('app/layout.tsx', 'utf8');

test('the iOS PWA root cannot be dragged horizontally off the viewport', () => {
  assert.match(ios, /html,\s*body\s*\{[^}]*overflow-x:\s*hidden/s);
  assert.match(ios, /\.pm-shell\s*\{[^}]*overflow-x:\s*clip/s);
  assert.match(ios, /\.pm-content[^}]*max-width:\s*100vw/s);
  assert.match(layout, /import '\.\/ios-native\.css';/);
});

test('intentional horizontal chip rows contain their own iOS scrolling', () => {
  assert.match(ios, /\.pm-filter-row,[\s\S]*?\.pm-tabs\s*\{[^}]*overscroll-behavior-x:\s*contain/s);
  assert.match(ios, /\.pm-filter-row,[\s\S]*?\.pm-tabs\s*\{[^}]*-webkit-overflow-scrolling:\s*touch/s);
});

test('the in-app Puma mark blends into the black interface without a square tile', () => {
  assert.match(ios, /\.pm-brand-mark\s*\{[^}]*background:\s*transparent/s);
  assert.match(ios, /\.pm-brand-mark img\s*\{[^}]*mix-blend-mode:\s*screen/s);
});

test('the legacy global bulk outreach pill is no longer mounted', () => {
  assert.doesNotMatch(layout, /ClientBulkOutreach/);
});
