import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { buildEmailOtpOptions } from '../lib/auth-login';

test('email sign-in always returns through the Puma auth callback while preserving OTP signup', () => {
  assert.deepEqual(
    buildEmailOtpOptions('https://puma-utilities.vercel.app/auth/callback'),
    {
      shouldCreateUser: true,
      emailRedirectTo: 'https://puma-utilities.vercel.app/auth/callback',
    },
  );
});

test('login supports both a six-digit code and the secure sign-in-link fallback', () => {
  const login = readFileSync(new URL('../app/login/page.tsx', import.meta.url), 'utf8');
  assert.match(login, /buildEmailOtpOptions/);
  assert.match(login, /window\.location\.origin/);
  assert.match(login, /verifyOtp/);
  assert.match(login, /six-digit|6-digit/i);
  assert.match(login, /sign-in link/i);
});

test('auth callback exchanges the PKCE code into a server cookie session', () => {
  const callback = readFileSync(new URL('../app/auth/callback/route.ts', import.meta.url), 'utf8');
  assert.match(callback, /exchangeCodeForSession/);
  assert.match(callback, /createServerSupabase/);
  assert.match(callback, /NextResponse\.redirect/);
});
