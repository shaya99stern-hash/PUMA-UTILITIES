import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ios = readFileSync('app/ios-native.css', 'utf8');
const layout = readFileSync('app/layout.tsx', 'utf8');

test('the iOS PWA root cannot be dragged horizontally off the viewport', () => {
  assert.match(ios, /html,\s*body\s*\{[\s\S]*?overflow-x:\s*hidden/);
  assert.match(ios, /\.pm-shell\s*\{[\s\S]*?overflow-x:\s*clip/);
  assert.match(ios, /\.pm-content[\s\S]*?max-width:\s*100vw/);
  assert.match(layout, /import '\.\/ios-native\.css';/);
});

test('intentional horizontal chip rows contain their own iOS scrolling', () => {
  assert.match(ios, /\.pm-filter-row,[\s\S]*?\.pm-tabs\s*\{[\s\S]*?overscroll-behavior-x:\s*contain/);
  assert.match(ios, /\.pm-filter-row,[\s\S]*?\.pm-tabs\s*\{[\s\S]*?-webkit-overflow-scrolling:\s*touch/);
});

test('the in-app Puma mark blends into the black interface without a square tile', () => {
  assert.match(ios, /\.pm-brand-mark\s*\{[\s\S]*?background:\s*transparent/);
  assert.match(ios, /\.pm-brand-mark img\s*\{[\s\S]*?mix-blend-mode:\s*screen/);
});

test('the legacy global bulk outreach pill is no longer mounted', () => {
  assert.doesNotMatch(layout, /ClientBulkOutreach/);
});
