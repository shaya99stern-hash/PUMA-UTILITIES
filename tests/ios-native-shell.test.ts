import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ios = readFileSync('app/ios-native.css', 'utf8');
const shell = readFileSync('app/puma-app-shell.css', 'utf8');
const layout = readFileSync('app/layout.tsx', 'utf8');

test('the iOS PWA root is viewport-locked and AppShell owns vertical scrolling and safe areas', () => {
  assert.match(ios, /html,\s*body\s*\{[\s\S]*?height:\s*100%/);
  assert.match(ios, /body\s*\{[\s\S]*?overflow:\s*hidden/);
  assert.match(shell, /\.pu-shell\s*\{[\s\S]*?min-height:\s*100dvh/);
  assert.match(shell, /\.pu-shell\s*\{[\s\S]*?safe-area-inset-top/);
  assert.match(shell, /\.pu-content\s*\{[\s\S]*?overflow-y:\s*auto/);
  assert.match(shell, /\.pu-content\s*\{[\s\S]*?safe-area-inset-bottom/);
  assert.match(layout, /import '\.\/ios-native\.css';/);
  assert.match(layout, /import '\.\/puma-app-shell\.css';/);
});

test('intentional horizontal chip rows contain their own iOS scrolling', () => {
  assert.match(ios, /\.pm-filter-row,[\s\S]*?\.pm-tabs\s*\{[\s\S]*?overflow-x:\s*auto/);
  assert.match(ios, /\.pm-filter-row,[\s\S]*?\.pm-tabs\s*\{[\s\S]*?overscroll-behavior-x:\s*contain/);
  assert.match(ios, /\.pm-filter-row,[\s\S]*?\.pm-tabs\s*\{[\s\S]*?-webkit-overflow-scrolling:\s*touch/);
});

test('the legacy global bulk outreach pill is no longer mounted', () => {
  assert.doesNotMatch(layout, /ClientBulkOutreach/);
});
