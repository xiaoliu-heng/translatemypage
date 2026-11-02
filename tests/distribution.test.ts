import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

// Exercise the shipped manifest rather than an isolated permission fixture.
test('distribution shows a top-frame logo automatically and scopes provider network access to granted hosts', () => {
  const result = spawnSync(process.execPath, ['scripts/build.mjs'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(readFileSync('dist/extension/manifest.json', 'utf8'));
  assert.deepEqual(manifest.permissions, ['activeTab', 'scripting', 'storage']);
  assert.deepEqual(manifest.host_permissions, ['https://auth.openai.com/*', 'https://api.openai.com/*']);
  assert.deepEqual(manifest.optional_host_permissions, ['http://*/*', 'https://*/*']);
  assert.deepEqual(manifest.content_scripts, [{ matches: ['http://*/*', 'https://*/*'], js: ['content.js'], css: ['content.css'], run_at: 'document_idle', all_frames: false }]);
  assert.equal(manifest.incognito, 'not_allowed');
  assert.equal(manifest.web_accessible_resources, undefined);
  assert.equal(manifest.externally_connectable, undefined);
  assert.equal(existsSync('dist/host'), false);
});
