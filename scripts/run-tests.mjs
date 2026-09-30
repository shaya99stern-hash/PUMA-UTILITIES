#!/usr/bin/env node

import { exec } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

// Glob patterns to match
const patterns = [
  'tests/unit/*.test.ts',
  'tests/engine-*.test.ts',
  'tests/email-*.test.ts',
  'tests/crm-*.test.ts',
];

function globFiles(pattern) {
  const baseDir = repoRoot;
  const parts = pattern.split('/');
  let dir = baseDir;
  let filePattern = null;

  // Navigate to the directory part
  for (let i = 0; i < parts.length - 1; i++) {
    dir = path.join(dir, parts[i]);
  }

  // The last part is the file pattern
  filePattern = parts[parts.length - 1];

  if (!fs.existsSync(dir)) {
    return [];
  }

  const files = fs.readdirSync(dir);
  const regex = globToRegex(filePattern);

  return files
    .filter(f => regex.test(f) && fs.statSync(path.join(dir, f)).isFile())
    .map(f => path.join(dir, f))
    .sort();
}

function globToRegex(glob) {
  // First, convert glob wildcards to placeholders
  const withPlaceholders = glob.replace(/\*/g, '\x00STAR\x00');
  // Escape regex special chars
  const escaped = withPlaceholders.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  // Convert placeholders to regex wildcards
  const withWildcards = escaped.replace(/\x00STAR\x00/g, '.*');
  return new RegExp(`^${withWildcards}$`);
}

async function main() {
  let allFiles = [];
  for (const pattern of patterns) {
    allFiles = allFiles.concat(globFiles(pattern));
  }

  // Remove duplicates while preserving order
  allFiles = [...new Set(allFiles)];

  if (allFiles.length === 0) {
    console.log('No test files found.');
    process.exit(0);
  }

  console.log(`Running tests: ${allFiles.join(' ')}`);

  const registerPath = path.resolve(repoRoot, 'tests/shims/register.mjs');
  const cmd = `node --import tsx --import ${registerPath} --test ${allFiles.join(' ')}`;

  try {
    const { stdout, stderr } = await execAsync(cmd, {
      cwd: repoRoot,
      stdio: 'inherit',
    });
    process.exit(0);
  } catch (error) {
    process.exit(error.code || 1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
