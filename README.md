# TranslateMyPage

**AI 网页翻译 · 沉浸式双语阅读。**

翻译网页和选中文字，保留原文对照、字体、链接和段落格式。可使用自己已授权的 **ChatGPT 订阅额度**，或使用 **OpenAI / 自定义 Responses API 兼容服务商的 API key**；API 按服务商用量单独计费，不包含在 ChatGPT 订阅中。免费开源，采用 [MIT 许可证](LICENSE)。维护者：xiaoliu-heng；支持邮箱：xiaoliublog@gmail.com。

> 当前源码为 **0.2.1 免助手开发版**，尚未上架 Chrome / Edge 商店。ChatGPT 手动回调与 API key 接入均已在隔离 Chromium 中使用合成凭据和响应验证；真实账号授权与付费调用仍需实机验证。已有 v0.1.x Releases 属于旧架构，需要助手；不要混用旧安装包。

## 功能

- **沉浸式双语**：原文与译文在同一页对照，支持标题、段落、列表与表格，可恢复原文。
- **沿用原文格式**：保留字体、字号、颜色、行距、对齐、缩进、链接、强调、行内代码、上下标和手动换行。
- **默认页面 logo**：普通 HTTP/HTTPS 网页加载后显示“译”logo，默认不翻译；点击开启，再点关闭并恢复原文。支持选区对话框、拖动、位置记忆、Alt+T、Escape、手动重试和减少动态效果。
- **ChatGPT 或自定义 API**：支持官方授权与 Responses 兼容 API 基础地址；API key 本地持久保存，连接、模型选择与译文缓存按地址和密钥隔离，不自动切换计费方式。
- **跳过同语言内容**：逐段在本机识别实际显示语言，与目标一致时不请求译文；选区同样处理。模型或缓存返回与原文相同的内容也不重复显示。识别不确定时保守翻译，不用整页语言猜测所有段落。
- **仅安装扩展**：登录、刷新、翻译队列和流式请求都在扩展内完成。没有本地助手、Node.js 运行依赖或开发者翻译中转服务器。
- **本地译文缓存**：按账号隔离，最多 2,000 条，可随时清空。没有广告和分析 SDK。

## 安装开发版

构建源码需要 Node.js 22.16+；使用已经构建的扩展不需要 Node.js。

```sh
git clone https://github.com/xiaoliu-heng/translatemypage.git
cd translatemypage
npm ci
npm run build
```

1. 在桌面 Chrome / Edge 的扩展管理页启用开发者模式，加载 `dist/extension`。
2. 点击工具栏扩展按钮，点击“打开会话”。使用 ChatGPT 套餐时按下面步骤登录；使用 API key 时见下一节。
3. 在会话页点击 **Continue with ChatGPT**，在新打开的 OpenAI 官方页面登录并授权。
4. 授权完成后，地址会跳转到 `http://127.0.0.1:1455/auth/callback?…`。因为没有本地监听服务，浏览器显示无法连接是预期现象。复制地址栏的**完整回调链接**，回到翻译会话页，粘贴并点击“验证并完成登录”。链接含一次性授权码，只粘贴到扩展，不要发送到聊天或提交给开发者。
5. 选择可用模型与目标语言，确认套餐说明。保留会话标签页，切回普通网页，点击页面右下角的“译”logo 开启翻译；首次使用当前提供商来源时先确认内容发送。也可使用工具栏扩展按钮。

登录请求与令牌兑换使用完全相同的回调地址。每次登录都有独立 state、nonce 和 PKCE verifier；回调只消费一次，5 分钟后失效。只接受本次 `127.0.0.1:1455/auth/callback` 地址，拒绝其他端口、路径、账号注册和重复参数。

### 使用 API key 与自定义服务商

1. 在 [OpenAI API 平台](https://platform.openai.com/api-keys) 或自己的 Responses 兼容服务商创建密钥，确认有可用额度。
2. 在翻译会话页点击 **设置 API key 与服务商**。API 基础地址默认为 `https://api.openai.com/v1`；自定义时填写完整地址及服务商要求的版本路径，例如 `https://provider.example/v1`。扩展在其后追加 `/models` 和 `/responses`，不是 Chat Completions 接口。
3. 为该地址明确输入密钥，点击“保存密钥与地址”；按浏览器提示允许该服务商主机访问。每个新地址都要重新输入密钥，不会把旧连接的密钥转发给新地址。保存后自动读取模型目录，此时会向所选服务商发送密钥；保存完成不代表密钥或模型可用。
4. 从目录中**主动选择支持 Responses API 的文本模型**，再选择目标语言。目录可能含嵌入、音频等不兼容模型，扩展不会自动代选。
5. 切回普通网页，点击默认 logo 开启翻译，并确认实际收件来源。请求使用 `Authorization: Bearer <API key>`；翻译为 `POST <基础地址>/responses`，设置 `stream: true`、`store: false`。没有开发者托管的翻译中转。

API key、规范化基础地址和最近明确选中的 API 连接保存在扩展自己的 IndexedDB（`translatemypage-credentials`）中，**未加密、不同步**；关闭、刷新会话或重启浏览器后仍保留。输入框提交后立即清空；原始密钥不进入后台 / 网页消息、`chrome.storage.local` 或日志。能访问浏览器配置目录的人或软件可能读取密钥，请只在可信设备保存。HTTP 地址可用于本机服务，但密钥和内容将以未加密的明文传输，正式服务应使用 HTTPS。

模型设置与缓存按“地址 + 密钥”的单向摘要隔离。选择 ChatGPT 后不会在重开会话或授权失败时自动切回 API 计费。API 模式点击页面 logo 可按需重开会话并恢复已保存连接；运行中的请求仍需要会话页。

“删除已保存的密钥”会停止该连接并删除其本地保存记录，**不会撤销服务商平台上的密钥**。需在相应平台撤销密钥、检查余额、配额与账单；OpenAI API 的 [用量](https://platform.openai.com/usage) 与 ChatGPT 订阅分开。

### 粘贴后认证失败

0.2.1 起会显示具体错误码，区分回调校验、授权码兑换、签名密钥读取、身份验证和本地存储失败。排查时只提供错误文字及方括号内的错误码，不要提供回调地址、授权码或令牌。

已修复粘贴回调时误报 `auth_exchange_network` 的一个根因：原生 `Window.fetch` 被作为普通对象的方法调用，会在发出请求前抛出 `Illegal invocation`。令牌兑换、刷新、撤销、模型目录与翻译请求均改为独立函数调用；回调地址、state、nonce 和 PKCE 校验保持不变。

- `auth_exchange_network` / `auth_exchange_timeout`：未获得授权接口响应，检查网络和扩展的 OpenAI 网站访问权限。
- `reauth_required`：授权码或会话已失效，重新开始授权，不能重复使用旧回调。
- `identity_keys_network` / `identity_keys_timeout` / `identity_keys_http`：无法取得身份签名密钥或请求被拒绝，检查网络、网站访问权限和拦截情况。
- `identity_nonce_mismatch` / `identity_audience_mismatch`：身份凭据与本次登录或客户端注册不匹配，重新开始授权；不要关闭身份校验来绕过问题。
- `identity_expired`：检查系统时间后重新授权。
- `auth_registration_failed` / `auth_account_failed`：检查扩展的本地存储是否可写。

更新扩展后请关闭旧会话页，再打开新会话并重新授权，不要复用旧回调。本次修复已在隔离 Chromium 中使用原生 `fetch` 和合成签名凭据验证粘贴回调、身份校验、令牌刷新、模型读取与退出撤销；这不等同于真实账号授权和套餐调用验证。若仍失败，只提供错误文字和错误码。

### 为什么要保留会话标签页

ChatGPT 的访问令牌、刷新令牌、身份令牌和待处理 PKCE 信息**只存在扩展会话页内存里**，不写入浏览器存储；API key 按上节说明持久保存。会话页直接请求所选服务商；后台 service worker 只路由公开状态和网页翻译消息，不接收原始 API key。

翻译运行时请保留会话标签页。关闭会话会中断任务，结果未知的模型请求不自动重放；ChatGPT 需要重新授权，API 连接可从本地恢复。扩展禁止自动丢弃会话页，不使用隐藏网页或本地守护进程。

ChatGPT 的“退出”尝试撤销最新刷新令牌后清除内存凭据；直接关页不能保证远端撤销，可在 [ChatGPT 设置](https://chatgpt.com/settings/usage) 管理应用权限。关闭 API 会话不删除已保存密钥，删除本地密钥也不撤销平台密钥。

### 与官方流程的关系

OpenAI 的[注册与登录文档](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)指定 `http://127.0.0.1:<端口>/auth/callback`，并描述启动本地监听器。本项目保留该回调形式，由用户手动把返回地址交给扩展，不启动监听器。这是本项目的适配方案，不能视为 OpenAI 已明确支持的纯扩展接入方式；真实端到端兼容性仍待验证。

官方文档要求 [OAuth 令牌不要放入浏览器存储](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions#credential-security)。ChatGPT 不提供跨重启的持久登录，只保存非秘密注册与绑定信息；用户自行输入的 API key 则按明确提示保存在本地。授权页面不授予读取 ChatGPT 历史对话的能力。

## 数据与权限

首次向当前提供商来源翻译前说明并征得同意：待译正文、选中文字、页面标题和命中的术语直接发送给所选服务商。来源包括协议、主机和端口，更换来源需重新确认。完整网页地址仅在本机用于站点规则和页面生命周期，不加入模型提示。表单、密码框、可编辑区、代码块默认排除；无痕窗口不支持。

- HTTP/HTTPS 主文档的常驻内容脚本：默认显示 logo；未开启时不扫描正文或发送翻译请求。这需要普通网页的全站内容脚本访问权限。
- `activeTab`、`scripting`：支持工具栏对当前页的操作与打包代码注入。
- `storage`：本机偏好、logo 位置和非秘密注册信息；API 凭据与译文缓存使用扩展自己的独立 IndexedDB。
- 固定网络权限 `auth.openai.com`、`api.openai.com` 用于官方授权和 API；自定义 API 按主机申请可选网络权限。Chrome 的主机权限不区分端口，内容发送确认仍按完整来源区分。

不使用 `nativeMessaging`、`identity` 或浏览历史 API，不下载远程可执行代码。扩展没有 `web_accessible_resources`，网页不能读取会话凭据。

[隐私政策](PRIVACY.md) · [HTML 隐私政策](store/privacy-policy.html)

## 从 0.1.x 升级

新版本不再调用旧助手，也不导入旧凭据。更新扩展后重新登录即可。旧助手的 Native Messaging 注册和 `TranslateMyPage/runtime/` 目录可移除；个人资料目录、旧译文与系统钥匙串 / Secret Service 凭据需另行清理，不会因更新扩展自动删除。建议在升级前退出旧版账号，并在 ChatGPT 设置中断开不再使用的旧授权。

## 开发与打包

```sh
npm run check          # 类型检查、离线测试、构建
npm run package:store  # Chrome 扩展、源码、上架材料及校验和
npm run package:edge   # Edge 扩展、源码、上架材料及校验和
```

输出位于 `release/0.2.1/` 和 `release/0.2.1/edge/`。不再生成 helper ZIP。发布包使用明确的文件允许列表，不包含个人账号、凭据、缓存、录制资料或浏览器配置。商店扩展包移除开发公钥和 source map，包含 MIT 及第三方许可证。`extension-public-key.json` 仅为固定开发版 ID 的公钥，不含私钥。

```text
src/extension/          网页提取、格式还原、小球、后台、会话页与设置
src/core/auth.ts        ChatGPT 回调、持久 API 连接与令牌刷新
src/core/provider.ts    模型目录、Responses SSE、格式校验
src/core/scheduler.ts   队列、合并、取消与账号隔离缓存
src/core/storage.ts     注册、API 连接与缓存接口
src/shared/            协议与格式标记
store/                  商店介绍、隐私披露与审核步骤
tests/                  离线自动测试
```

提交商店前还需用真实账号与个人 API key 验证授权、实际翻译、计费、关闭会话、重新连接及 Chrome / Edge 行为。隔离浏览器的合成响应验证不代表真实付费调用成功；构建或打包成功不表示上架成功。旧版公开归档保持不变。

## 当前范围

桌面 Chromium 120+ 的普通 HTTP/HTTPS 主文档；不同操作系统的实机验证待完成。复杂 Shadow DOM、跨域 iframe、PDF、EPUB、字幕和 OCR 待后续适配。界面主要为简体中文，AI 翻译可能有误，请结合原文判断。

TranslateMyPage 独立开发，与 OpenAI、ChatGPT 或 Immersive Translate 无隶属关系。

[官方套餐接入](https://developers.openai.com/siwc/token-sharing-open-source) · [模型与推理](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference) · [OpenAI Responses API](https://developers.openai.com/api/reference/resources/responses)
