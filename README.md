# TranslateMyPage

**AI 网页翻译 · 沉浸式双语阅读。**

翻译网页和选中文字，保留原文对照、字体、链接和段落格式。可使用自己已授权的 **ChatGPT 订阅额度**，或使用个人 **OpenAI API key** 通过 Responses API 翻译；API 按用量单独计费，不包含在 ChatGPT 订阅中。免费开源，采用 [MIT 许可证](LICENSE)。维护者：xiaoliu-heng；支持邮箱：xiaoliublog@gmail.com。

> 当前源码为 **0.2.1 免助手开发版**，尚未上架 Chrome / Edge 商店。ChatGPT 手动回调与 API key 接入均已在隔离 Chromium 中使用合成凭据和响应验证；真实账号授权与付费调用仍需实机验证。已有 v0.1.x Releases 属于旧架构，需要助手；不要混用旧安装包。

## 功能

- **沉浸式双语**：原文与译文在同一页对照，支持标题、段落、列表与表格，可恢复原文。
- **沿用原文格式**：保留字体、字号、颜色、行距、对齐、缩进、链接、强调、行内代码、上下标和手动换行。
- **划词翻译与浮球**：选中文字，小球移动到选区旁等待，然后展开游戏风格对话框。睡觉、呼吸灯和灯泡常亮分别表示关闭、处理中和就绪。支持拖动、位置记忆、Alt+T、Escape、手动重试和减少动态效果。
- **两种 OpenAI 接入**：ChatGPT 官方授权或个人 API key，连接、模型选择与译文缓存相互隔离；不会在失败时自动切换计费方式。
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
5. 选择可用模型与目标语言，确认套餐说明。保留会话标签页，切回普通网页，从工具栏扩展按钮开启翻译；首次会说明发送给 OpenAI 的内容。

登录请求与令牌兑换使用完全相同的回调地址。每次登录都有独立 state、nonce 和 PKCE verifier；回调只消费一次，5 分钟后失效。只接受本次 `127.0.0.1:1455/auth/callback` 地址，拒绝其他端口、路径、账号注册和重复参数。

### 使用 OpenAI API key

1. 在 [OpenAI API 平台](https://platform.openai.com/api-keys) 创建自己的密钥，并确认项目有可用的 API 额度。
2. 在翻译会话页点击 **使用 OpenAI API key**，粘贴密钥并点击“设置 API key”。无需 ChatGPT 登录或粘贴 callback URL。设置只表示本地配置完成，读取模型或翻译时才会实际请求 OpenAI。
3. 从目录中**主动选择支持 Responses API 的文本模型**，再选择目标语言。API 目录可能包含嵌入、音频等不兼容模型，扩展不会自动代选；ChatGPT 连接仍按原流程选择模型。
4. 保持会话页打开，切回普通网页，从工具栏扩展按钮开启翻译。请求使用 `Authorization: Bearer <API key>`，模型目录为 `GET https://api.openai.com/v1/models`，翻译为 `POST https://api.openai.com/v1/responses`，设置 `stream: true`、`store: false`；不使用 Chat Completions 或开发者中转。

API key 只保留在会话页内存，提交后立即清空输入框，不通过后台消息传递，不写入浏览器存储或日志。模型设置与缓存仅用单向连接摘要隔离。关闭、刷新会话页或重启浏览器后，需要重新输入密钥；重新输入同一密钥可沿用该连接的模型设置和译文缓存。

“断开（仅本会话）”仅清除本地凭据，**不会撤销 OpenAI 平台上的密钥**；撤销请在 API 平台操作。无效密钥需重新设置；API 余额、配额和限流问题在 [API 用量](https://platform.openai.com/usage) 与计费设置中处理，与 ChatGPT 订阅分开。

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

访问令牌、刷新令牌、身份令牌、API key 和待处理的 PKCE 信息**只存在扩展会话页的内存里**，不写入 `chrome.storage`、localStorage、sessionStorage 或 IndexedDB。会话页直接请求 OpenAI；后台 service worker 只负责公开状态和网页翻译消息路由，不接收 API key。

请保持会话标签页打开，可以切换到其他标签页。关闭、刷新该页、重启浏览器或更新扩展会结束本次连接，需要重新授权或重新输入 API key。扩展会防止自动丢弃该标签页；不会使用隐藏网页或本地守护进程保活。后台连接中断时取消任务，不自动重放结果未知的模型请求。

ChatGPT 连接的“退出”会尝试撤销最新的刷新令牌，然后清除内存凭据。直接关闭标签页会丢弃本地凭据，但不能保证撤销远端授权；可在 [ChatGPT 设置](https://chatgpt.com/settings/usage) 中管理应用权限。API key 连接只在本地断开，平台密钥仍有效。

### 与官方流程的关系

OpenAI 的[注册与登录文档](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)指定 `http://127.0.0.1:<端口>/auth/callback`，并描述启动本地监听器。本项目保留该回调形式，由用户手动把返回地址交给扩展，不启动监听器。这是本项目的适配方案，不能视为 OpenAI 已明确支持的纯扩展接入方式；真实端到端兼容性仍待验证。

官方文档同时要求[令牌不要放入浏览器存储](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions#credential-security)。本版不提供跨浏览器重启的持久登录，只保存非秘密的随机 Host 标识、已签发客户端 ID、账号绑定摘要、连接摘要、设置和译文缓存。授权页面不会授予读取 ChatGPT 历史对话的能力。

## 数据与权限

首次翻译前说明并征得同意：待译正文、选中文字、页面标题和命中的术语将直接发送给 OpenAI。完整网页地址只在本机用于站点规则和页面生命周期，不加入模型提示。表单、密码框、可编辑区、代码块默认排除；无痕窗口不支持。

- `activeTab`、`scripting`：在用户激活的当前普通网页注入打包代码。
- `storage`：本机偏好、小球位置和非秘密注册信息；译文缓存使用扩展自己的 IndexedDB。
- 网络权限仅限 `https://auth.openai.com/*` 和 `https://api.openai.com/*`，用于授权、签名校验、刷新、退出、模型目录与翻译。

无需 `nativeMessaging`、`identity`、浏览历史或全站常驻访问权限。扩展没有 `web_accessible_resources`，网页不能读取会话页或凭据。

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
src/core/auth.ts        ChatGPT 回调、API key、内存凭据与令牌刷新
src/core/provider.ts    模型目录、Responses SSE、格式校验
src/core/scheduler.ts   队列、合并、取消与账号隔离缓存
src/core/storage.ts     注册信息与缓存接口（不接收令牌）
src/shared/            协议与格式标记
store/                  商店介绍、隐私披露与审核步骤
tests/                  离线自动测试
```

提交商店前还需用真实账号与个人 API key 验证授权、实际翻译、计费、关闭会话、重新连接及 Chrome / Edge 行为。隔离浏览器的合成响应验证不代表真实付费调用成功；构建或打包成功不表示上架成功。旧版公开归档保持不变。

## 当前范围

桌面 Chromium 120+ 的普通 HTTP/HTTPS 主文档；不同操作系统的实机验证待完成。复杂 Shadow DOM、跨域 iframe、PDF、EPUB、字幕和 OCR 待后续适配。界面主要为简体中文，AI 翻译可能有误，请结合原文判断。

TranslateMyPage 独立开发，与 OpenAI、ChatGPT 或 Immersive Translate 无隶属关系。

[官方套餐接入](https://developers.openai.com/siwc/token-sharing-open-source) · [模型与推理](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference) · [OpenAI Responses API](https://developers.openai.com/api/reference/resources/responses)
