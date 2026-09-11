import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ios = readFileSync('app/ios-native.css', 'utf8');
const layout = readFileSync('app/layout.tsx', 'utf8');

test('the iOS PWA root is viewport-locked and app content owns vertical scrolling', () => {
  assert.match(ios, /html,\s*body\s*\{[\s\S]*?height:\s*100%/);
  assert.match(ios, /body\s*\{[\s\S]*?overflow:\s*hidden/);
  assert.match(ios, /\.pm-shell\s*\{[\s\S]*?height:\s*100dvh/);
  assert.match(ios, /\.pm-content\s*\{[\s\S]*?overflow-y:\s*auto/);
  assert.match(ios, /\.pm-content\s*\{[\s\S]*?overscroll-behavior-y:\s*none/);
  assert.match(layout, /import '\.\/ios-native\.css';/);
});

test('intentional horizontal chip rows contain their own iOS scrolling', () => {
  assert.match(ios, /\.pm-filter-row,[\s\S]*?\.pm-tabs\s*\{[\s\S]*?overflow-x:\s*auto/);
  assert.match(ios, /\.pm-filter-row,[\s\S]*?\.pm-tabs\s*\{[\s\S]*?overscroll-behavior-x:\s*contain/);
  assert.match(ios, /\.pm-filter-row,[\s\S]*?\.pm-tabs\s*\{[\s\S]*?-webkit-overflow-scrolling:\s*touch/);
});

test('the legacy global bulk outreach pill is no longer mounted', () => {
  assert.doesNotMatch(layout, /ClientBulkOutreach/);
});
