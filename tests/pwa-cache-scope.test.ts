import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

test('service worker only retires Puma-namespaced stale caches', () => {
  const source = readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8');
  assert.match(source, /const CACHE_PREFIX = 'puma-utilities-';/);
  assert.match(source, /shell-v6/);
  assert.match(source, /key\.startsWith\(CACHE_PREFIX\) && key !== VERSION/);
  assert.match(source, /apple-touch-icon/);
  assert.match(source, /pwa-icon-192/);
  assert.match(source, /pwa-icon-512/);
  assert.doesNotMatch(source, /puma-home-icon\.jpeg/);
  assert.doesNotMatch(source, /keys\.map\(\(key\) => caches\.delete\(key\)\)/);
  assert.doesNotMatch(source, /CLEAR_CACHES/);
});

test('installed app checks deployment versions and exposes an update action', () => {
  const manager = readFileSync(resolve(process.cwd(), 'app/components/pwa-update-manager.tsx'), 'utf8');
  const layout = readFileSync(resolve(process.cwd(), 'app/layout.tsx'), 'utf8');
  const versionRoute = readFileSync(resolve(process.cwd(), 'app/api/version/route.ts'), 'utf8');

  assert.match(manager, /checkForUpdate/);
  assert.match(manager, /\/api\/version\?ts=/);
  assert.match(manager, /Update app/);
  assert.match(manager, /CLEAR_STALE_PUMA_CACHES/);
  assert.match(manager, /window\.location\.reload\(\)/);
  assert.match(layout, /<PwaUpdateManager \/>/);
  assert.match(versionRoute, /VERCEL_GIT_COMMIT_SHA/);
  assert.match(versionRoute, /Cache-Control': 'no-store, max-age=0'/);
});
