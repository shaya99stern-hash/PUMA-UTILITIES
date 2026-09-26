import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

test('device bootstrap ignores pre-fix leak history but keeps bounded new-device quotas', () => {
  const sql = readFileSync(new URL('../supabase/migrations/202609260018_bootstrap_rate_window_reset.sql', import.meta.url), 'utf8');
  assert.match(sql, /private\.puma_bootstrap_rate_window/i);
  assert.match(sql, /window_started_at/i);
  assert.match(sql, /greatest\(now\(\) - interval '24 hours', v_window_start\)/i);
  assert.match(sql, /v_global_count\s*>=\s*500/i);
  assert.match(sql, /v_ip_count\s*>=\s*50/i);
  assert.match(sql, /pg_advisory_xact_lock/i);
  assert.match(sql, /revoke all on function public\.reserve_puma_device_bootstrap/i);
  assert.match(sql, /grant execute on function public\.reserve_puma_device_bootstrap.*service_role/i);
});
