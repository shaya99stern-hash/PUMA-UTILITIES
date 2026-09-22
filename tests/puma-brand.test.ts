import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ios = readFileSync('app/ios-native.css', 'utf8');
const shell = readFileSync('app/components/puma-workspace-app-v4.tsx', 'utf8');

test('in-app Puma mark is transparent vector artwork without blend-mode or image-tile hacks', () => {
  assert.match(ios, /\.pm-brand-mark\s*\{[\s\S]*?background:\s*transparent\s*!important/);
  assert.doesNotMatch(ios, /mix-blend-mode\s*:/);
  const block = shell.match(/function BrandMark[\s\S]*?\n\}/)?.[0] ?? '';
  assert.match(block, /<svg/);
  assert.doesNotMatch(block, /<img\b/);
  assert.doesNotMatch(block, /apple-touch-icon/);
});
