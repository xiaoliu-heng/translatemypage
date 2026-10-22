import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('store ID is validated before registration and is shared by the native allowlist and host config', () => {
  const id = 'abcdefghijklmnopabcdefghijklmnop';
  const run = (...args: string[]) => spawnSync(process.execPath, ['scripts/install-host.mjs', '--dry-run', ...args], { encoding: 'utf8' });
  const valid = run(`--extension-id=${id}`);
  assert.equal(valid.status, 0, valid.stderr);
  const plan = JSON.parse(valid.stdout);
  assert.equal(plan.config.extensionId, id);
  assert.deepEqual(plan.allowed_origins, [`chrome-extension://${id}/`]);
  for (const value of ['short', 'q'.repeat(32), '../another-app', `${id}/`]) {
    const invalid = run(`--extension-id=${value}`);
    assert.notEqual(invalid.status, 0); assert.match(invalid.stderr, /32位/);
  }
});
