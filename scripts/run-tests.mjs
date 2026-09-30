#!/usr/bin/env node
// Runs every current test file with tsx and a `server-only` shim.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const patterns = [
  ['tests/unit', /\.test\.ts$/],
  ['tests', /^(engine|email|crm)-.*\.test\.ts$/],
];

// v1 tests that assert the retired UI's source text; kept on disk for reference only.
const LEGACY = new Set(['crm-functionality.test.ts']);

const files = patterns.flatMap(([dir, re]) => {
  const abs = path.join(root, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs).filter((f) => re.test(f) && !LEGACY.has(f)).sort().map((f) => path.join(dir, f));
});

if (files.length === 0) {
  console.log('No test files found.');
  process.exit(0);
}

const result = spawnSync(
  process.execPath,
  // `react-server` makes `import 'server-only'` resolve to its empty build.
  ['--conditions=react-server', '--import', 'tsx', '--test', ...files],
  { cwd: root, stdio: 'inherit' },
);
process.exit(result.status ?? 1);
