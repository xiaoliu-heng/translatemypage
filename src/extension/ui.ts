import { Account, AppError, DEFAULT_SETTINGS, Model, Settings, Status } from '../shared/protocol';
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const mode = document.body.dataset.mode;
let session: import('./session').SessionRuntime | undefined;
let status: Status | undefined, settings: Settings = DEFAULT_SETTINGS;
let models: Model[] = [], modelsAccount = '', loadingModelsAccount = '', modelsRequest = 0;
let pendingAction = '', apiKeyPending = false;
let settingsRevision = 0, savingSettings = 0;
const pendingModels = new Map<string, string>();
const identityLabels = { signed_out: '未登录', authorizing: '授权中', signed_in: '已登录', reauth_required: '需要重新授权' };
const planLabels = { not_granted: '未授予套餐权限', authorized_unverified: '已授权 · 待首次翻译验证', last_request_succeeded: '最近调用成功', limited: '套餐调用受限', ineligible: '账号暂不符合条件', temporarily_unavailable: '套餐暂时不可用' };
const apiIdentityLabels = { signed_out: '未设置', authorizing: '正在设置', signed_in: '已设置', reauth_required: '请重新设置 API key' };
const apiPlanLabels = { not_granted: '需要设置 API key', authorized_unverified: '尚未验证 · 按 API 用量计费', last_request_succeeded: '最近调用成功 · API 计费', limited: 'API 配额或速率受限', ineligible: 'API 暂不可用', temporarily_unavailable: 'API 暂时不可用' };
async function rpc(type: string, data: any = {}): Promise<any> {
  const response = await chrome.runtime.sendMessage({ type, ...data });
  if (response?.error) { if (response.connection) renderConnection(response.connection); throw new AppError(response.error.code, response.error.message); }
  if (response?.result?.error) throw new AppError(response.result.error.code, response.result.error.message);
  return response?.result;
}
function feedback(text: string): void { $('feedback').textContent = text; }
function click(id: string, action: () => Promise<any> | void): void {
  $(id).onclick = async () => {
    const button = $<HTMLButtonElement>(id); button.disabled = true; feedback('');
    try { await action(); } catch (e) { feedback(e instanceof AppError ? `${e.message} [${e.code}]` : e instanceof Error ? e.message : '操作失败。'); }
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
function renderModels(active: Account): void {
  const api = active.authType === 'api_key';
  const values = models.map(m => ({ value: m.slug, label: m.displayName }));
  if (api) values.unshift({ value: '', label: models.length ? '请选择 Responses 兼容的文本模型' : '未读取到模型，请检查 API key 或刷新' });
  else if (!values.length) values.push({ value: '', label: '当前账号没有可用模型' });
  fillSelect('model', values, pendingModels.get(active.key) ?? (settings.models[active.key] || (api ? '' : models[0]?.slug)));
}
function showApiKeyForm(show: boolean): void {
  $<HTMLInputElement>('apiKey').value = '';
  $('apiKeyForm').hidden = !show;
  $('useApiKey').setAttribute('aria-expanded', String(show));
  if (show) $<HTMLInputElement>('apiKey').focus();
}
function renderStatus(): void {
  const active = status?.accounts.find(a => a.key === status?.activeKey);
  const api = active?.authType === 'api_key';
  if (active?.identity !== 'signed_in' || active.key !== modelsAccount) {
    fillSelect('model', [{ value: '', label: active?.identity === 'signed_in' ? '正在读取可用模型…' : '连接后读取可用模型' }]);
    if (active?.identity !== 'signed_in') modelsAccount = '';
  } else renderModels(active);
  fillSelect('accounts', status?.accounts.length ? status.accounts.map(a => ({
    value: a.key, label: a.authType === 'api_key' ? `OpenAI API key · ${a.key.slice(-8)}` : `${a.name || a.email || 'ChatGPT'} · ${a.clientId.slice(-6)}`,
  })) : [{ value: '', label: '尚未连接' }], status?.activeKey);
  $('identity').textContent = active ? (api ? apiIdentityLabels : identityLabels)[active.identity] : '未登录';
  $('plan').textContent = active ? (api ? apiPlanLabels : planLabels)[active.plan] : '未授予套餐权限';
  $('signIn').textContent = status?.authorizing ? '正在浏览器中授权…' : 'Continue with ChatGPT';
  $<HTMLButtonElement>('signIn').disabled = !!status?.authorizing || !!status?.signingOut || apiKeyPending || mode === 'session' && !session;
  $('cancelAuth').hidden = !status?.authorizing; $('logout').hidden = !active || active.identity === 'signed_out';
  $('addAccount').hidden = !!status?.authorizing || mode !== 'session';
  $('addAccount').textContent = '添加其他账号';
  $<HTMLButtonElement>('addAccount').disabled = !!status?.signingOut || apiKeyPending || mode === 'session' && !session;
  $<HTMLButtonElement>('logout').disabled = !!status?.signingOut || apiKeyPending;
  $('logout').textContent = status?.signingOut ? (api ? '正在断开…' : '正在退出…') : api ? '断开（仅本会话）' : '退出';
  $<HTMLSelectElement>('accounts').disabled = !!status?.signingOut || apiKeyPending;
  $('callbackStep').hidden = mode !== 'session' || !status?.authorization;
  $<HTMLButtonElement>('completeAuth').disabled = !session || !!status?.authorization?.exchanging;
  $('completeAuth').textContent = status?.authorization?.exchanging ? '正在验证登录…' : '验证并完成登录';
  if (!status?.authorization) $<HTMLInputElement>('callbackUrl').value = '';
  $<HTMLButtonElement>('useApiKey').disabled = apiKeyPending || !!status?.authorizing || !!status?.signingOut || mode === 'session' && !session;
  $<HTMLButtonElement>('connectApiKey').disabled = mode !== 'session' || !session || apiKeyPending;
  $<HTMLButtonElement>('dismissApiKey').disabled = apiKeyPending;
  $<HTMLInputElement>('apiKey').disabled = apiKeyPending;
  $('connectApiKey').textContent = apiKeyPending ? '正在设置…' : '设置 API key';
  if (mode !== 'session') showApiKeyForm(false);
  $('notice').hidden = !status?.notice; $('notice').textContent = status?.notice || '';
  const usable = active?.identity === 'signed_in' && (api ? !!settings.models[active.key] : active.plan !== 'not_granted');
  for (const id of ['translate', 'selection', 'resume']) $<HTMLButtonElement>(id).disabled = !usable;
  $('modelHint').hidden = !api;
  $('billingMethod').textContent = api ? 'OpenAI API 单独计费' : '使用你的 ChatGPT 套餐';
  $<HTMLAnchorElement>('manageUsage').href = api ? 'https://platform.openai.com/usage' : 'https://chatgpt.com/settings/usage';
  $('sharingBilling').textContent = api
    ? '待翻译的段落、页面标题和命中的术语将发送给 OpenAI，使用当前 API key 按用量单独计费，不包含在 ChatGPT 订阅中。'
    : '待翻译的段落、页面标题和命中的术语将发送给 OpenAI，使用你授权的 ChatGPT 套餐。';
  const planDialog = $<HTMLDialogElement>('planDialog');
  if (api && planDialog.open) planDialog.close();
  if (active?.authType === 'chatgpt' && active.identity === 'signed_in' && active.plan !== 'not_granted' && !settings.acknowledgedPlan && !planDialog.open) planDialog.showModal();
  if (active?.identity === 'signed_in' && (api || active.plan !== 'not_granted') && active.key !== modelsAccount && active.key !== loadingModelsAccount) void refreshModels().catch(e => feedback(e.message));
}
function renderSettings(): void {
  $<HTMLSelectElement>('targetLanguage').value = settings.targetLanguage;
  $<HTMLSelectElement>('sourceLanguage').value = settings.sourceLanguage;
  $<HTMLTextAreaElement>('glossary').value = settings.glossary.map(t => `${t.hostname ? `${t.hostname} | ` : ''}${t.source} = ${t.target}`).join('\n');
  $<HTMLInputElement>('excludedSelectors').value = settings.excludedSelectors;
}
async function refreshModels(): Promise<void> {
  const active = status?.accounts.find(a => a.key === status?.activeKey);
  if (!active || active.identity !== 'signed_in') return;
  const request = ++modelsRequest, epoch = status?.accountEpoch, revision = settingsRevision, wasSaving = savingSettings > 0;
  loadingModelsAccount = active.key;
  try {
    const received: Model[] = await rpc('ui.models');
    if (request !== modelsRequest || status?.activeKey !== active.key || status?.accountEpoch !== epoch) return;
    const state = await rpc('ui.state');
    if (request !== modelsRequest || status?.activeKey !== active.key || status?.accountEpoch !== epoch) return;
    if (!wasSaving && !savingSettings && revision === settingsRevision) settings = state.settings;
    models = received; modelsAccount = active.key;
    renderStatus();
  } finally {
    if (request === modelsRequest) {
      loadingModelsAccount = '';
      if (status?.activeKey !== active.key || status?.accountEpoch !== epoch) renderStatus();
    }
  }
}
async function load(): Promise<void> {
  const revision = settingsRevision, wasSaving = savingSettings > 0;
  const result = await rpc('ui.state'); status = result.status;
  if (!wasSaving && !savingSettings && revision === settingsRevision) settings = result.settings;
  renderConnection(result.connection); renderSettings(); renderStatus();
}
async function save(patch: Partial<Settings>): Promise<void> {
  const revision = ++settingsRevision; savingSettings++;
  try {
    const received: Settings = await rpc('ui.settings', { settings: patch });
    if (revision === settingsRevision) settings = received;
  } finally { savingSettings--; }
}
async function pageAction(action: string): Promise<void> {
  if (!settings.acknowledgedSharing && action !== 'stop') { pendingAction = action; $<HTMLDialogElement>('sharingDialog').showModal(); return; }
  await rpc('ui.page', { action }); feedback(action === 'stop' ? '已恢复原文，小球休息中。' : '已开始，网页小球会显示翻译状态；选中文字可直接翻译。');
}
click('openSession', () => rpc('ui.openSession'));
click('signIn', () => {
  if (mode !== 'session') return rpc('ui.openSession');
  const a = status?.accounts.find(a => a.key === status?.activeKey);
  return rpc('ui.auth', { accountKey: a?.authType === 'chatgpt' ? a.key : undefined, reconsent: a?.authType === 'chatgpt' && a.identity === 'signed_in' && a.plan === 'not_granted' });
});
click('addAccount', () => rpc('ui.auth', { newAccount: true }));
click('completeAuth', async () => {
  const input = $<HTMLInputElement>('callbackUrl'); const raw = input.value; input.value = '';
  if (!session) throw new Error('请先打开翻译会话。');
  await session.complete(raw); feedback('登录验证完成，可以切回网页开始翻译。');
});
$<HTMLInputElement>('callbackUrl').addEventListener('keydown', event => { if (event.key === 'Enter') $<HTMLButtonElement>('completeAuth').click(); });
click('useApiKey', () => {
  if (mode !== 'session') return rpc('ui.openSession');
  showApiKeyForm($('apiKeyForm').hidden);
});
click('dismissApiKey', () => { showApiKeyForm(false); $('useApiKey').focus(); });
click('connectApiKey', async () => {
  const input = $<HTMLInputElement>('apiKey'); const raw = input.value; input.value = '';
  if (mode !== 'session' || !session || apiKeyPending) return;
  apiKeyPending = true; renderStatus();
  try {
    await session.useApiKey(raw);
    showApiKeyForm(false);
    await load();
  } catch {
    feedback('无法设置 API key。请检查密钥后重试；密钥不会显示或保存。');
  } finally { apiKeyPending = false; }
});
$<HTMLInputElement>('apiKey').addEventListener('keydown', event => {
  if (event.key === 'Enter') { event.preventDefault(); $<HTMLButtonElement>('connectApiKey').click(); }
  if (event.key === 'Escape' && !apiKeyPending) { event.preventDefault(); showApiKeyForm(false); $('useApiKey').focus(); }
});
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
$('model').onchange = () => {
  const accountKey = status?.activeKey, model = $<HTMLSelectElement>('model').value;
  if (!accountKey) return;
  pendingModels.set(accountKey, model);
  void save({ models: { ...settings.models, ...Object.fromEntries(pendingModels) } }).catch(e => feedback(e.message)).finally(() => {
    if (pendingModels.get(accountKey) === model) pendingModels.delete(accountKey);
    renderStatus();
  });
};
$('accounts').onchange = () => {
  showApiKeyForm(false);
  void rpc('ui.selectAccount', { accountKey: $<HTMLSelectElement>('accounts').value }).then(load).catch(e => feedback(e.message));
};
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
    for (const id of ['signIn', 'addAccount', 'completeAuth', 'useApiKey', 'connectApiKey']) $<HTMLButtonElement>(id).disabled = true;
  });
} else void load().catch(e => feedback(e.message));
