import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

test('service worker only retires Puma-namespaced stale caches', () => {
  const source = readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8');
  assert.match(source, /const CACHE_PREFIX = 'puma-utilities-';/);
  assert.match(source, /key\.startsWith\(CACHE_PREFIX\) && key !== VERSION/);
  assert.doesNotMatch(source, /keys\.map\(\(key\) => caches\.delete\(key\)\)/);
  assert.doesNotMatch(source, /CLEAR_CACHES/);
});

test('installed Puma app can discover and apply every new Vercel deployment without reinstalling', () => {
  const serviceWorker = readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8');
  const updater = readFileSync(resolve(process.cwd(), 'app/components/pwa-update-manager.tsx'), 'utf8');
  const layout = readFileSync(resolve(process.cwd(), 'app/layout.tsx'), 'utf8');
  const versionRoute = readFileSync(resolve(process.cwd(), 'app/api/version/route.ts'), 'utf8');

  assert.match(serviceWorker, /type === 'SKIP_WAITING'/);
  assert.doesNotMatch(serviceWorker, /\.then\(\(\) => self\.skipWaiting\(\)\)/);
  assert.match(layout, /VERCEL_DEPLOYMENT_ID/);
  assert.match(layout, /currentDeploymentId=\{DEPLOYMENT_ID\}/);
  assert.match(versionRoute, /VERCEL_DEPLOYMENT_ID/);
  assert.match(versionRoute, /Cache-Control[\s\S]*no-store/);
  assert.match(updater, /fetch\('\/api\/version', \{ cache: 'no-store' \}\)/);
  assert.match(updater, /registration\.update\(\)/);
  assert.match(updater, /deploymentChanged/);
  assert.match(updater, /controllerchange/);
  assert.match(updater, /SKIP_WAITING/);
  assert.match(updater, /window\.location\.reload\(\)/);
  assert.match(updater, /Update app/);
});
