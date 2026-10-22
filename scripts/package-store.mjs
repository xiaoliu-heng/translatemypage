import { readFile, writeFile, mkdir, cp, rm, readdir, stat } from 'node:fs/promises';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const publication = JSON.parse(await readFile(join(root, 'store/publication-status.json'), 'utf8'));
const arg = name => process.argv.find(v => v.startsWith(`--${name}=`))?.slice(name.length + 3);
const extensionId = arg('extension-id');
if (extensionId && !/^[a-p]{32}$/.test(extensionId)) throw new Error('Invalid Chrome Web Store extension ID.');
const out = join(root, 'release', version), stage = join(root, 'dist/release-stage');
await rm(stage, { recursive: true, force: true }); await mkdir(stage, { recursive: true }); await mkdir(out, { recursive: true });
async function copy(from, to) { await mkdir(dirname(to), { recursive: true }); await cp(from, to, { recursive: true }); }
async function files(dir) {
  const found = [];
  for (const name of (await readdir(dir)).sort()) {
    const path = join(dir, name);
    if ((await stat(path)).isDirectory()) found.push(...await files(path)); else found.push(path);
  }
  return found;
}
async function stripMap(path) { await writeFile(path, (await readFile(path, 'utf8')).replace(/^\/\/# sourceMappingURL=.*\r?\n?/gm, '')); }
async function zip(name, dir) {
  const path = join(out, `TranslateMyPage-${version}-${name}.zip`);
  // Remove only this script's generated archive so repeat packaging cannot retain old entries.
  await rm(path, { force: true });
  const result = spawnSync('zip', ['-X', '-q', '-r', path, '.'], { cwd: dir, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`ZIP failed: ${result.stderr || 'install a zip CLI'}`);
  return { file: relative(root, path), bytes: (await stat(path)).size, sha256: createHash('sha256').update(await readFile(path)).digest('hex') };
}

const extension = join(stage, 'chrome'); await mkdir(extension);
// Deliberate allowlist: never package the workspace, native credentials, recordings or browser profiles.
for (const name of ['background.js', 'content.js', 'ui.js', 'popup.html', 'options.html', 'ui.css', 'content.css', 'privacy.html', 'icons', '_locales']) {
  await copy(join(root, 'dist/extension', name), join(extension, name));
}
const manifest = JSON.parse(await readFile(join(root, 'dist/extension/manifest.json'), 'utf8'));
delete manifest.key; // The store owns the distributed extension identity; keep the development key local.
await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
for (const name of ['background.js', 'content.js', 'ui.js']) await stripMap(join(extension, name));

const notices = [];
for (const name of ['jose', 'proper-lockfile', 'graceful-fs', 'retry', 'signal-exit']) {
  const dir = join(root, 'node_modules', name), meta = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
  const license = (await readdir(dir)).find(f => /^licen[cs]e(?:\.(?:md|txt))?$/i.test(f));
  if (!license) throw new Error(`Missing dependency license: ${name}`);
  notices.push(`${name} ${meta.version}\n${await readFile(join(dir, license), 'utf8')}`);
}
const helper = join(stage, 'helper'); await mkdir(helper);
await copy(join(root, 'dist/host/host.cjs'), join(helper, 'dist/host/host.cjs')); await stripMap(join(helper, 'dist/host/host.cjs'));
await writeFile(join(helper, 'dist/host/config.json'), JSON.stringify({ extensionId: extensionId || null }, null, 2) + '\n');
for (const name of ['scripts/install-host.mjs', 'native/keychain.swift', 'LICENSE']) await copy(join(root, name), join(helper, name));
await copy(join(root, 'store/helper-README.txt'), join(helper, 'README.txt'));
await copy(join(root, 'store/privacy-policy.html'), join(helper, 'privacy-policy.html'));
await writeFile(join(helper, 'THIRD-PARTY-NOTICES.txt'), notices.join('\n\n----------------------------------------\n\n'));

const source = join(stage, 'source'); await mkdir(source);
for (const name of ['src', 'native', 'tests', 'assets', 'store', 'docs', 'package.json', 'package-lock.json', 'tsconfig.json', 'extension-public-key.json', 'README.md', 'PRIVACY.md', 'LICENSE', '.gitignore']) {
  await copy(join(root, name), join(source, name));
}
for (const name of ['build.mjs', 'install-host.mjs', 'package-store.mjs', 'store-assets.py', 'browser-smoke.mjs']) await copy(join(root, 'scripts', name), join(source, 'scripts', name));
const materials = join(stage, 'store-materials'); await copy(join(root, 'store'), materials);
for (const dir of [extension, helper, source, materials]) {
  for (const path of await files(dir)) {
    const rel = relative(dir, path);
    if (/(^|\/)(?:\.local|\.git|node_modules|test-results|\.test-profile)(?:\/|$)|(?:\.log|\.map|\.pem|\.key)$/.test(rel)) throw new Error(`Unexpected private/generated entry: ${rel}`);
    if (!/\.(png|jpg|jpeg|gif|webp)$/i.test(rel)) {
      const data = await readFile(path, 'utf8');
      if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|sk-(?:proj-)?[A-Za-z0-9_-]{40,}/.test(data)) throw new Error(`Possible credential in ${rel}`);
    }
  }
}
const archives = [];
for (const [name, dir] of [['chrome', extension], ['helper', helper], ['source', source], ['store-materials', materials]]) archives.push(await zip(name, dir));
const state = { version, publisher: 'xiaoliu-heng', supportEmail: 'xiaoliublog@gmail.com', extensionId: extensionId || null,
  status: 'prepared_not_submitted', publication, archives,
  pending: [
    ...(!publication.sourcePublished ? ['Publish audited source code and MIT license to the public repository'] : []),
    ...(!publication.privacyPolicyPublished ? ['Publish privacy policy and verify its public URL'] : []),
    ...(!publication.releaseAssetsPublished ? ['Publish the local helper and source release assets'] : []),
    'Chrome Web Store developer account access and submission',
    ...(!extensionId ? ['Store-assigned extension ID; install helper with --extension-id or regenerate this archive after ID assignment'] : [])
  ] };
await writeFile(join(out, 'release-status.json'), JSON.stringify(state, null, 2) + '\n');
await writeFile(join(out, 'SHA256SUMS.txt'), archives.map(a => `${a.sha256}  ${a.file.split('/').at(-1)}`).join('\n') + '\n');
console.log(JSON.stringify(state, null, 2));
