import { build } from 'esbuild';
import { readFile, writeFile, mkdir, copyFile, cp, rm } from 'node:fs/promises';
import { generateKeyPairSync, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
let key;
try { key = JSON.parse(await readFile(join(root, 'extension-public-key.json'), 'utf8')).key; }
catch {
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  key = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  // Only the public key is retained; it fixes the unpacked extension id across builds.
  await writeFile(join(root, 'extension-public-key.json'), JSON.stringify({ key }, null, 2) + '\n');
}
const extensionId = [...createHash('sha256').update(Buffer.from(key, 'base64')).digest().subarray(0, 16)]
  .map(b => String.fromCharCode(97 + (b >> 4)) + String.fromCharCode(97 + (b & 15))).join('');
const extension = join(root, 'dist/extension');
await rm(extension, { recursive: true, force: true });
await mkdir(extension, { recursive: true });
await rm(join(root, 'dist/host'), { recursive: true, force: true });
await Promise.all([
  build({ entryPoints: ['src/extension/background.ts', 'src/extension/ui.ts'], outdir: extension, bundle: true, platform: 'browser', target: 'chrome120', format: 'esm', sourcemap: true, absWorkingDir: root }),
  build({ entryPoints: ['src/extension/content.ts'], outfile: join(extension, 'content.js'), bundle: true, platform: 'browser', target: 'chrome120', format: 'iife', sourcemap: true, absWorkingDir: root }),
]);
const icons = Object.fromEntries([16, 32, 48, 128].map(size => [size, `icons/icon-${size}.png`]));
const manifest = { manifest_version: 3, name: '__MSG_extensionName__', version, key, minimum_chrome_version: '120', default_locale: 'zh_CN', icons,
  homepage_url: 'https://github.com/xiaoliu-heng/translatemypage',
  description: '__MSG_extensionDescription__', permissions: ['activeTab', 'scripting', 'storage'],
  host_permissions: ['https://auth.openai.com/*', 'https://api.openai.com/*'],
  content_security_policy: { extension_pages: "script-src 'self'; object-src 'none'; connect-src https://auth.openai.com https://api.openai.com" },
  incognito: 'not_allowed', background: { service_worker: 'background.js', type: 'module' }, action: { default_title: 'TranslateMyPage', default_popup: 'popup.html', default_icon: icons }, options_page: 'options.html' };
await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest, null, 2));
for (const file of ['popup.html', 'ui.css', 'content.css']) await copyFile(join(root, 'src/extension', file), join(extension, file));
await cp(join(root, 'src/extension/_locales'), join(extension, '_locales'), { recursive: true });
await cp(join(root, 'assets/icons'), join(extension, 'icons'), { recursive: true });
await copyFile(join(root, 'store/privacy-policy.html'), join(extension, 'privacy.html'));
const html = await readFile(join(extension, 'popup.html'), 'utf8');
await writeFile(join(extension, 'options.html'), html.replace('data-mode="popup"', 'data-mode="options"'));
await writeFile(join(extension, 'session.html'), html.replace('data-mode="popup"', 'data-mode="session"'));
console.log(`Built extension: ${extension}\nExtension ID: ${extensionId}`);
