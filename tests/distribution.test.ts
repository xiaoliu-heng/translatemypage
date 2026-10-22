import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync } from 'node:fs';

// Exercise the shipped manifest and bundles, rather than an isolated manifest fixture.
test('distribution runs entirely in the extension with narrowly scoped OpenAI network access', () => {
  const result = spawnSync(process.execPath, ['scripts/build.mjs'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(readFileSync('dist/extension/manifest.json', 'utf8'));
  assert.deepEqual(manifest.permissions, ['activeTab', 'scripting', 'storage']);
  assert.deepEqual(manifest.host_permissions, ['https://auth.openai.com/*', 'https://api.openai.com/*']);
  assert.equal(manifest.incognito, 'not_allowed');
  assert.equal(manifest.web_accessible_resources, undefined);
  assert.equal(manifest.externally_connectable, undefined);
  assert.equal(existsSync('dist/host'), false);
  for (const file of ['session.html', 'options.html', 'popup.html']) {
    const html = readFileSync(`dist/extension/${file}`, 'utf8');
    assert.match(html, /id="callbackUrl" type="password"/);
    assert.doesNotMatch(html, /install-host|installHelp|本地助手/);
  }
  for (const file of readdirSync('dist/extension').filter(file => file.endsWith('.js'))) {
    const bundle = readFileSync(`dist/extension/${file}`, 'utf8');
    assert.doesNotMatch(bundle, /connectNative\(|sendNativeMessage\(|from ["']node:|require\(["']node:/);
  }
});
