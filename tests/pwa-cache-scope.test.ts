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
