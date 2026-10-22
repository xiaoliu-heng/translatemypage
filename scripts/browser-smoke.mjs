import { chromium } from '@playwright/test';
import { readFile, mkdir, mkdtemp, rm, copyFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const { extensionId } = JSON.parse(await readFile(join(root, 'dist/host/config.json'), 'utf8'));
const profile = await mkdtemp(join(tmpdir(), 'translatemypage-browser-'));
const registration = join(homedir(), process.platform === 'darwin' ? 'Library/Application Support/Google/ChromeForTesting' : '.config/google-chrome-for-testing', 'NativeMessagingHosts/com.translatemypage.host.json');
await mkdir(join(profile, 'NativeMessagingHosts'), { recursive: true });
await copyFile(registration, join(profile, 'NativeMessagingHosts/com.translatemypage.host.json'));
let context; let installationId;
try {
  context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${join(root, 'dist/extension')}`, `--load-extension=${join(root, 'dist/extension')}`] });
  const errors = [];
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.getByText('本地助手已连接', { exact: true }).waitFor({ timeout: 15_000 });
  await page.locator('#targetLanguage').selectOption('ja');
  await page.reload();
  await page.getByText('本地助手已连接', { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('#targetLanguage').value === 'ja');
  assert.equal(await page.locator('#translate').isDisabled(), true);
  await page.locator('#glossary').fill('agent = 智能体\nexample.com | token = 令牌');
  await page.locator('#saveAdvanced').click();
  await page.getByText('术语与站点规则已保存。', { exact: true }).waitFor();
  await page.reload(); await page.getByText('本地助手已连接', { exact: true }).waitFor();
  assert.match(await page.locator('#glossary').inputValue(), /example.com \| token = 令牌/);
  await mkdir(join(root, 'test-results'), { recursive: true });
  await page.screenshot({ path: join(root, 'test-results/options.png'), fullPage: true });
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.getByText('本地助手已连接', { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('#targetLanguage').value === 'ja');
  assert.equal(await page.locator('#translate').isDisabled(), true);
  assert.equal(await page.locator('#feedback').textContent(), '');
  await page.setViewportSize({ width: 380, height: 760 });
  await page.screenshot({ path: join(root, 'test-results/popup.png'), fullPage: true });
  installationId = await page.evaluate(async () => (await chrome.storage.local.get('installationId')).installationId);
  assert.deepEqual(errors, []);
  console.log('Browser smoke passed: real Native Messaging hello, settings persistence, account gating, popup/options render.');
} finally {
  await context?.close();
  await new Promise(r => setTimeout(r, 100));
  await rm(profile, { recursive: true, force: true });
  if (installationId) {
    const ns = createHash('sha256').update(JSON.stringify([`chrome-extension://${extensionId}/`, installationId])).digest('hex');
    const data = process.platform === 'darwin' ? join(homedir(), 'Library/Application Support/TranslateMyPage') : join(process.env.XDG_DATA_HOME || join(homedir(), '.local/share'), 'translatemypage');
    await rm(join(data, ns), { recursive: true, force: true });
  }
}
