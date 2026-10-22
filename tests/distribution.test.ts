import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('explicit store ID dry-run works without a build and shares the validated ID with the native allowlist', t => {
  const root = mkdtempSync(join(tmpdir(), 'translatemypage-distribution-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'scripts'));
  copyFileSync(new URL('../scripts/install-host.mjs', import.meta.url), join(root, 'scripts/install-host.mjs'));
  const id = 'abcdefghijklmnopabcdefghijklmnop';
  const run = (...args: string[]) => spawnSync(process.execPath, ['scripts/install-host.mjs', '--dry-run', ...args], { cwd: root, encoding: 'utf8' });
  const valid = run(`--extension-id=${id}`);
  assert.equal(valid.status, 0, valid.stderr);
  const plan = JSON.parse(valid.stdout);
  assert.equal(plan.config.extensionId, id);
  assert.deepEqual(plan.allowed_origins, [`chrome-extension://${id}/`]);
  for (const value of ['', 'short', 'q'.repeat(32), '../another-app', `${id}/`]) {
    const invalid = run(`--extension-id=${value}`);
    assert.notEqual(invalid.status, 0); assert.match(invalid.stderr, /32位/);
  }
});

test('Chrome and Edge keep separate native registrations and runtime origin configurations', () => {
  const plan = (browser: string, extensionId: string) => {
    const result = spawnSync(process.execPath, ['scripts/install-host.mjs', '--dry-run', `--browser=${browser}`, `--extension-id=${extensionId}`], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const chrome = plan('chrome', 'a'.repeat(32));
  const edge = plan('edge', 'b'.repeat(32));
  assert.notEqual(chrome.registration, edge.registration);
  assert.notEqual(chrome.runtime, edge.runtime);
  assert.equal(edge.runtime, join(chrome.runtime, '..', 'edge'));
  assert.match(edge.registration, process.platform === 'darwin' ? /Microsoft Edge\/NativeMessagingHosts\// : /microsoft-edge\/NativeMessagingHosts\//);
  assert.deepEqual(chrome.allowed_origins, [`chrome-extension://${'a'.repeat(32)}/`]);
  assert.deepEqual(edge.allowed_origins, [`chrome-extension://${'b'.repeat(32)}/`]);
  assert.equal(edge.config.extensionId, 'b'.repeat(32));
});
