import { DEFAULT_SETTINGS, Model, Settings, Status } from '../shared/protocol';
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const mode = document.body.dataset.mode;
let session: import('./session').SessionRuntime | undefined;
let status: Status | undefined, settings: Settings = DEFAULT_SETTINGS;
let models: Model[] = [], modelsAccount = '', loadingModels = false;
let pendingAction = '';
const identityLabels = { signed_out: '未登录', authorizing: '授权中', signed_in: '已登录', reauth_required: '需要重新授权' };
const planLabels = { not_granted: '未授予套餐权限', authorized_unverified: '已授权 · 待首次翻译验证', last_request_succeeded: '最近调用成功', limited: '套餐调用受限', ineligible: '账号暂不符合条件', temporarily_unavailable: '套餐暂时不可用' };
async function rpc(type: string, data: any = {}): Promise<any> {
  const response = await chrome.runtime.sendMessage({ type, ...data });
  if (response?.error) { if (response.connection) renderConnection(response.connection); throw new Error(response.error.message); }
  if (response?.result?.error) throw new Error(response.result.error.message);
  return response?.result;
}
function feedback(text: string): void { $('feedback').textContent = text; }
function click(id: string, action: () => Promise<any> | void): void {
  $(id).onclick = async () => {
    const button = $<HTMLButtonElement>(id); button.disabled = true; feedback('');
    try { await action(); } catch (e) { feedback(e instanceof Error ? e.message : '操作失败。'); }
    finally { button.disabled = false; renderStatus(); }
  };
}
function renderConnection(connection: string): void {
  $('connection').textContent = connection === 'ready' ? '翻译会话已连接' : '请打开翻译会话登录';
  $('connectionDot').classList.toggle('ready', connection === 'ready');
  $('sessionHint').hidden = mode === 'session';
}
function fillSelect(id: string, values: { value: string; label: string }[], selected?: string): void {
  const select = $<HTMLSelectElement>(id); select.replaceChildren();
  for (const item of values) { const o = document.createElement('option'); o.value = item.value; o.textContent = item.label; select.append(o); }
  select.value = selected || '';
}
function renderStatus(): void {
  const active = status?.accounts.find(a => a.key === status?.activeKey);
  if (active?.identity !== 'signed_in') { modelsAccount = ''; fillSelect('model', [{ value: '', label: '登录后读取可用模型' }]); }
  fillSelect('accounts', status?.accounts.length ? status.accounts.map(a => ({ value: a.key, label: `${a.name || a.email || 'ChatGPT'} · ${a.clientId.slice(-6)}` })) : [{ value: '', label: '尚未登录' }], status?.activeKey);
  $('identity').textContent = active ? identityLabels[active.identity] : '未登录';
  $('plan').textContent = active ? planLabels[active.plan] : '未授予套餐权限';
  $('signIn').textContent = status?.authorizing ? '正在浏览器中授权…' : 'Continue with ChatGPT';
  $<HTMLButtonElement>('signIn').disabled = !!status?.authorizing || !!status?.signingOut || mode === 'session' && !session;
  $('cancelAuth').hidden = !status?.authorizing; $('logout').hidden = !active || active.identity === 'signed_out';
  $('addAccount').hidden = !!status?.authorizing || mode !== 'session';
  $('addAccount').textContent = '添加其他账号';
  $<HTMLButtonElement>('addAccount').disabled = !!status?.signingOut || mode === 'session' && !session;
  $<HTMLButtonElement>('logout').disabled = !!status?.signingOut;
  $('logout').textContent = status?.signingOut ? '正在退出…' : '退出';
  $<HTMLSelectElement>('accounts').disabled = !!status?.signingOut;
  $('callbackStep').hidden = mode !== 'session' || !status?.authorization;
  $<HTMLButtonElement>('completeAuth').disabled = !session || !!status?.authorization?.exchanging;
  $('completeAuth').textContent = status?.authorization?.exchanging ? '正在验证登录…' : '验证并完成登录';
  if (!status?.authorization) $<HTMLInputElement>('callbackUrl').value = '';
  $('notice').hidden = !status?.notice; $('notice').textContent = status?.notice || '';
  $<HTMLButtonElement>('translate').disabled = !active || active.identity !== 'signed_in' || active.plan === 'not_granted';
  if (active?.identity === 'signed_in' && active.plan !== 'not_granted' && !settings.acknowledgedPlan && !$<HTMLDialogElement>('planDialog').open) $<HTMLDialogElement>('planDialog').showModal();
  if (active?.identity === 'signed_in' && active.plan !== 'not_granted' && active.key !== modelsAccount) void refreshModels().catch(e => feedback(e.message));
}
function renderSettings(): void {
  $<HTMLSelectElement>('targetLanguage').value = settings.targetLanguage;
  $<HTMLSelectElement>('sourceLanguage').value = settings.sourceLanguage;
  $<HTMLTextAreaElement>('glossary').value = settings.glossary.map(t => `${t.hostname ? `${t.hostname} | ` : ''}${t.source} = ${t.target}`).join('\n');
  $<HTMLInputElement>('excludedSelectors').value = settings.excludedSelectors;
}
async function refreshModels(): Promise<void> {
  if (loadingModels) return; loadingModels = true;
  const account = status?.activeKey;
  try {
    const received = await rpc('ui.models'); if (status?.activeKey !== account) return;
    models = received; modelsAccount = account || '';
    fillSelect('model', models.length ? models.map(m => ({ value: m.slug, label: m.displayName })) : [{ value: '', label: '当前账号没有可用模型' }], settings.models[modelsAccount] || models[0]?.slug);
    settings = (await rpc('ui.state')).settings;
  } finally { loadingModels = false; }
}
async function load(): Promise<void> {
  const result = await rpc('ui.state'); status = result.status; settings = result.settings;
  renderConnection(result.connection); renderSettings(); renderStatus();
}
async function save(patch: Partial<Settings>): Promise<void> { settings = await rpc('ui.settings', { settings: patch }); }
async function pageAction(action: string): Promise<void> {
  if (!settings.acknowledgedSharing && action !== 'stop') { pendingAction = action; $<HTMLDialogElement>('sharingDialog').showModal(); return; }
  await rpc('ui.page', { action }); feedback(action === 'stop' ? '已恢复原文，小球休息中。' : '已开始，网页小球会显示翻译状态；选中文字可直接翻译。');
}
click('openSession', () => rpc('ui.openSession'));
click('signIn', () => {
  if (mode !== 'session') return rpc('ui.openSession');
  const a = status?.accounts.find(a => a.key === status?.activeKey);
  return rpc('ui.auth', { accountKey: status?.activeKey, reconsent: a?.identity === 'signed_in' && a.plan === 'not_granted' });
});
click('addAccount', () => rpc('ui.auth', { newAccount: true }));
click('completeAuth', async () => {
  const input = $<HTMLInputElement>('callbackUrl'); const raw = input.value; input.value = '';
  if (!session) throw new Error('请先打开翻译会话。');
  await session.complete(raw); feedback('登录验证完成，可以切回网页开始翻译。');
});
$<HTMLInputElement>('callbackUrl').addEventListener('keydown', event => { if (event.key === 'Enter') $<HTMLButtonElement>('completeAuth').click(); });
click('cancelAuth', () => rpc('ui.cancelAuth'));
click('logout', () => rpc('ui.logout', { accountKey: status?.activeKey }));
click('refreshModels', refreshModels);
click('translate', () => pageAction('start'));
click('selection', () => pageAction('selection'));
click('restore', () => pageAction('stop'));
click('resume', async () => {
  if (!settings.acknowledgedSharing) { await pageAction('retry'); return; }
  await rpc('ui.resume');
});
click('openOptions', () => chrome.runtime.openOptionsPage());
click('confirmSharing', async () => { await save({ acknowledgedSharing: true }); $<HTMLDialogElement>('sharingDialog').close(); await pageAction(pendingAction); });
click('cancelSharing', () => $<HTMLDialogElement>('sharingDialog').close());
click('confirmPlan', async () => { await save({ acknowledgedPlan: true }); $<HTMLDialogElement>('planDialog').close(); });
click('clearCache', async () => { await rpc('ui.clearCache'); feedback('已清空本地译文缓存。'); });
click('saveAdvanced', async () => {
  const glossary = $<HTMLTextAreaElement>('glossary').value.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
    const eq = line.indexOf('='); if (eq < 1) throw new Error('术语格式：原文 = 译文。');
    const left = line.slice(0, eq).trim(), target = line.slice(eq + 1).trim();
    const pipe = left.indexOf('|');
    return { source: (pipe >= 0 ? left.slice(pipe + 1) : left).trim(), target, ...(pipe >= 0 ? { hostname: left.slice(0, pipe).trim().toLowerCase() } : {}) };
  });
  const excludedSelectors = $<HTMLInputElement>('excludedSelectors').value.trim();
  if (excludedSelectors) { try { document.querySelector(excludedSelectors); } catch { throw new Error('CSS 选择器格式无效。'); } }
  await save({ glossary, glossaryVersion: settings.glossaryVersion + 1, excludedSelectors }); feedback('术语与站点规则已保存。');
});
for (const id of ['targetLanguage', 'sourceLanguage']) $(id).onchange = () => void save({ [id]: $<HTMLSelectElement>(id).value }).catch(e => feedback(e.message));
$('model').onchange = () => { if (status?.activeKey) void save({ models: { ...settings.models, [status.activeKey]: $<HTMLSelectElement>('model').value } }).catch(e => feedback(e.message)); };
$('accounts').onchange = () => void rpc('ui.selectAccount', { accountKey: $<HTMLSelectElement>('accounts').value }).catch(e => feedback(e.message));
chrome.runtime.onMessage.addListener(m => { if (m.type === 'state.changed') { status = m.status; renderConnection(m.connection); renderStatus(); } return false; });
if (mode === 'options' || mode === 'session') {
  $('advanced').hidden = false; $('openOptions').hidden = true;
  for (const id of ['translate', 'selection', 'restore', 'resume']) $(id).hidden = true;
}
if (mode === 'session') {
  $('sessionIntro').hidden = false;
  $<HTMLButtonElement>('signIn').disabled = true;
  $('openSession').hidden = true;
  document.title = 'TranslateMyPage · 翻译会话（请保持打开）';
  void import('./session').then(m => m.startSession()).then(runtime => { session = runtime; return load(); }).catch(e => {
    feedback(e.message); $('openSession').hidden = false;
    for (const id of ['signIn', 'addAccount', 'completeAuth']) $<HTMLButtonElement>(id).disabled = true;
  });
} else void load().catch(e => feedback(e.message));
