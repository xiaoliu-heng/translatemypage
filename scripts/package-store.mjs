import { readFile, writeFile, mkdir, cp, rm, readdir, stat } from 'node:fs/promises';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const arg = name => process.argv.find(v => v.startsWith(`--${name}=`))?.slice(name.length + 3);
const browser = arg('browser') || 'chrome';
if (!['chrome', 'edge'].includes(browser)) throw new Error('Supported store targets: chrome, edge.');
const publication = JSON.parse(await readFile(join(root, browser === 'edge' ? 'store/edge/publication-status.json' : 'store/publication-status.json'), 'utf8'));
const extensionId = arg('extension-id');
if (extensionId && !/^[a-p]{32}$/.test(extensionId)) throw new Error('Invalid store extension ID.');
const out = join(root, 'release', version, ...(browser === 'edge' ? ['edge'] : []));
const stage = join(root, `dist/release-stage${browser === 'edge' ? '-edge' : ''}`);
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

const extension = join(stage, browser); await mkdir(extension);
// Deliberate allowlist: never package the workspace, native credentials, recordings or browser profiles.
for (const name of ['background.js', 'content.js', 'ui.js', 'popup.html', 'options.html', 'session.html', 'ui.css', 'content.css', 'privacy.html', 'icons', '_locales']) {
  await copy(join(root, 'dist/extension', name), join(extension, name));
}
const manifest = JSON.parse(await readFile(join(root, 'dist/extension/manifest.json'), 'utf8'));
delete manifest.key; // The store owns the distributed extension identity; keep the development key local.
delete manifest.update_url;
await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
for (const name of ['background.js', 'content.js', 'ui.js']) await stripMap(join(extension, name));

const notices = [];
for (const name of ['jose']) {
  const dir = join(root, 'node_modules', name), meta = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
  const license = (await readdir(dir)).find(f => /^licen[cs]e(?:\.(?:md|txt))?$/i.test(f));
  if (!license) throw new Error(`Missing dependency license: ${name}`);
  notices.push(`${name} ${meta.version}\n${await readFile(join(dir, license), 'utf8')}`);
}
await writeFile(join(extension, 'THIRD-PARTY-NOTICES.txt'), notices.join('\n\n'));
await copy(join(root, 'LICENSE'), join(extension, 'LICENSE'));

const source = join(stage, 'source'); await mkdir(source);
for (const name of ['src', 'tests', 'assets', 'store', 'docs', 'package.json', 'package-lock.json', 'tsconfig.json', 'extension-public-key.json', 'README.md', 'PRIVACY.md', 'LICENSE', '.gitignore']) {
  await copy(join(root, name), join(source, name));
}
for (const name of ['build.mjs', 'package-store.mjs', 'store-assets.py']) await copy(join(root, 'scripts', name), join(source, 'scripts', name));
const materials = join(stage, 'store-materials');
if (browser === 'edge') {
  await copy(join(root, 'store/edge'), materials);
  for (const name of ['assets', 'privacy-disclosure.json', 'privacy-policy.html']) await copy(join(root, 'store', name), join(materials, name));
} else await copy(join(root, 'store'), materials);
await rm(join(materials, 'screenshots'), { recursive: true, force: true });
await writeFile(join(materials, 'SCREENSHOTS-PENDING.txt'), 'Capture current-version installed-extension screenshots before store submission. Historical v0.1.x screenshots are excluded.\n');
for (const dir of [extension, source, materials]) {
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
for (const [name, dir] of [[browser, extension], ['source', source], [browser === 'edge' ? 'edge-store-materials' : 'store-materials', materials]]) archives.push(await zip(name, dir));
const state = { version, browser, publisher: 'xiaoliu-heng', supportEmail: 'xiaoliublog@gmail.com', extensionId: extensionId || null,
  status: 'prepared_not_submitted', publication, archives,
  pending: [
    ...(!publication.sourcePublished ? ['Publish audited source code and MIT license to the public repository'] : []),
    ...(!publication.privacyPolicyPublished ? ['Publish privacy policy and verify its public URL'] : []),
    ...(!publication.releaseAssetsPublished ? ['Publish the extension and source release assets'] : []),
    `${browser === 'edge' ? 'Microsoft Edge Add-ons' : 'Chrome Web Store'} developer account access and submission`,
    'Manual callback login and real translation must be tested in the installed extension before store submission'
  ] };
await writeFile(join(out, 'release-status.json'), JSON.stringify(state, null, 2) + '\n');
await writeFile(join(out, 'SHA256SUMS.txt'), archives.map(a => `${a.sha256}  ${a.file.split('/').at(-1)}`).join('\n') + '\n');
console.log(JSON.stringify(state, null, 2));
