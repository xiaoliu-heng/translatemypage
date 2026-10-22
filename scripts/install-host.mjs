import { readFile, mkdir, copyFile, writeFile, chmod, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const name = 'com.translatemypage.host';
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 16)) throw new Error('需要 Node.js 22.16 或更新版本。');
const args = process.argv.slice(2); const browser = args.find(a => a.startsWith('--browser='))?.split('=')[1] || 'chrome';
const browsers = process.platform === 'darwin' ? {
  chrome: 'Library/Application Support/Google/Chrome', edge: 'Library/Application Support/Microsoft Edge',
  chromium: 'Library/Application Support/Chromium', testing: 'Library/Application Support/Google/ChromeForTesting',
} : { chrome: '.config/google-chrome', edge: '.config/microsoft-edge', chromium: '.config/chromium', testing: '.config/google-chrome-for-testing' };
if (!['darwin', 'linux'].includes(process.platform) || !browsers[browser]) throw new Error('支持 macOS / Linux；--browser=chrome|edge|chromium|testing');
const registration = join(homedir(), browsers[browser], 'NativeMessagingHosts', `${name}.json`);
if (args.includes('--uninstall')) {
  await rm(registration, { force: true }); console.log(`已注销助手：${registration}\n账号、钥匙串凭据和缓存保留；如需退出账号，请先在扩展中退出。`); process.exit(0);
}
const hostDist = join(root, 'dist/host');
const config = JSON.parse(await readFile(join(hostDist, 'config.json'), 'utf8'));
const extensionId = args.find(a => a.startsWith('--extension-id='))?.slice('--extension-id='.length) || config.extensionId;
if (!/^[a-p]{32}$/.test(extensionId || '')) throw new Error('请提供 Chrome 商店条目的扩展 ID：--extension-id=32位小写ID。可以从商店网址末尾或扩展详情页复制。');
const runtime = join(process.platform === 'darwin' ? join(homedir(), 'Library/Application Support') : process.env.XDG_DATA_HOME || join(homedir(), '.local/share'), 'TranslateMyPage', 'runtime');
if (args.includes('--dry-run')) {
  console.log(JSON.stringify({ browser, registration, runtime, config: { extensionId }, allowed_origins: [`chrome-extension://${extensionId}/`] }, null, 2));
  process.exit(0);
}
await mkdir(runtime, { recursive: true, mode: 0o700 });
if (process.platform === 'darwin') {
  console.log('正在编译 macOS 钥匙串辅助程序…');
  const result = spawnSync('/usr/bin/swiftc', [join(root, 'native/keychain.swift'), '-o', join(hostDist, 'keychain')], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error('编译失败；请先安装 Xcode Command Line Tools（xcode-select --install）。');
  await copyFile(join(hostDist, 'keychain'), join(runtime, 'keychain')); await chmod(join(runtime, 'keychain'), 0o700);
} else if (spawnSync('which', ['secret-tool'], { stdio: 'ignore' }).status !== 0) {
  throw new Error('请先安装 libsecret-tools，并确保桌面 Secret Service 可用。');
}
await copyFile(join(hostDist, 'host.cjs'), join(runtime, 'host.cjs'));
// The same validated ID must reach both the browser registration and the host origin check.
await writeFile(join(runtime, 'config.json'), JSON.stringify({ extensionId }, null, 2) + '\n');
const quote = s => `'${s.replaceAll("'", "'\\''")}'`;
const launcher = join(runtime, 'launch-host');
await writeFile(launcher, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(join(runtime, 'host.cjs'))} "$@"\n`, { mode: 0o700 });
await chmod(launcher, 0o700);
await mkdir(dirname(registration), { recursive: true });
await writeFile(registration, JSON.stringify({ name, description: 'TranslateMyPage local assistant', path: launcher, type: 'stdio', allowed_origins: [`chrome-extension://${extensionId}/`] }, null, 2));
console.log(`已注册 ${browser} 助手。\n扩展 ID：${extensionId}\n加载扩展目录：${join(root, 'dist/extension')}\n现在可打开扩展，点击 Continue with ChatGPT。`);
