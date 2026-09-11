import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync('app/components/puma-workspace-app-v3.tsx', 'utf8');
const globals = readFileSync('app/globals.css', 'utf8');

test('the iOS PWA root cannot be dragged horizontally off the viewport', () => {
  assert.match(globals, /html,\s*body\s*\{[^}]*overflow-x:\s*(?:hidden|clip)/s);
  assert.match(app, /\.pm-shell\s*\{[^}]*overflow-x:\s*clip/s);
  assert.match(app, /\.pm-content\s*\{[^}]*max-width:\s*100vw/s);
});

test('intentional horizontal chip rows contain their own iOS scrolling', () => {
  assert.match(app, /\.pm-filter-row\s*\{[^}]*overscroll-behavior-x:\s*contain/s);
  assert.match(app, /\.pm-filter-row\s*\{[^}]*-webkit-overflow-scrolling:\s*touch/s);
  assert.match(app, /\.pm-tabs\s*\{[^}]*overscroll-behavior-x:\s*contain/s);
});

test('the in-app Puma mark blends into the black interface without a square tile', () => {
  assert.match(app, /\.pm-brand-mark\s*\{[^}]*background:\s*transparent/s);
  assert.match(app, /\.pm-brand-mark img\s*\{[^}]*mix-blend-mode:\s*screen/s);
});
