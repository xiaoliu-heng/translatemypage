# TranslateMyPage

**AI 网页翻译 · 沉浸式双语阅读。**

翻译网页和选中文字，保留原文对照、字体、链接和段落格式。可使用自己已授权的 **ChatGPT 订阅额度**，无需另填 OpenAI API 密钥。免费开源，采用 [MIT 许可证](LICENSE)。维护者：xiaoliu-heng；支持邮箱：xiaoliublog@gmail.com。

> 当前源码为 **0.2.0 免助手开发版**，尚未上架 Chrome / Edge 商店。手动回调登录已实现并通过离线测试，仍需在已安装扩展中完成真实授权、令牌兑换和翻译验证。已有 v0.1.x Releases 属于旧架构，需要助手；不要混用旧安装包。

## 功能

- **沉浸式双语**：原文与译文在同一页对照，支持标题、段落、列表与表格，可恢复原文。
- **沿用原文格式**：保留字体、字号、颜色、行距、对齐、缩进、链接、强调、行内代码、上下标和手动换行。
- **划词翻译与浮球**：选中文字，小球移动到选区旁等待，然后展开游戏风格对话框。睡觉、呼吸灯和灯泡常亮分别表示关闭、处理中和就绪。支持拖动、位置记忆、Alt+T、Escape、手动重试和减少动态效果。
- **账号实际可用的模型**：通过 OpenAI 官方页面授权使用套餐，读取当前账号的模型目录；资格、模型和额度由 OpenAI 及工作区设置决定。
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
2. 点击工具栏扩展按钮，点击 **Continue with ChatGPT**，打开翻译会话标签页。
3. 在会话页再次点击 **Continue with ChatGPT**，在新打开的 OpenAI 官方页面登录并授权。
4. 授权完成后，地址会跳转到 `http://127.0.0.1:1455/auth/callback?…`。因为没有本地监听服务，浏览器显示无法连接是预期现象。复制地址栏的**完整回调链接**，回到翻译会话页，粘贴并点击“验证并完成登录”。链接含一次性授权码，只粘贴到扩展，不要发送到聊天或提交给开发者。
5. 选择可用模型与目标语言，确认套餐说明。保留会话标签页，切回普通网页，从工具栏扩展按钮开启翻译；首次会说明发送给 OpenAI 的内容。

登录请求与令牌兑换使用完全相同的回调地址。每次登录都有独立 state、nonce 和 PKCE verifier；回调只消费一次，5 分钟后失效。只接受本次 `127.0.0.1:1455/auth/callback` 地址，拒绝其他端口、路径、账号注册和重复参数。

### 为什么要保留会话标签页

访问令牌、刷新令牌、身份令牌和待处理的 PKCE 信息**只存在扩展会话页的内存里**，不写入 `chrome.storage`、localStorage、sessionStorage 或 IndexedDB。会话页直接请求 OpenAI；后台 service worker 负责网页消息路由。

请保持会话标签页打开，可以切换到其他标签页。关闭、刷新该页、重启浏览器或更新扩展会结束本次登录，需要重新授权。扩展会防止自动丢弃该标签页；不会使用隐藏网页或本地守护进程保活。后台连接中断时取消任务，不自动重放结果未知的模型请求。

“退出”会尝试撤销最新的刷新令牌，然后清除内存凭据。直接关闭标签页会丢弃本地凭据，但不能保证撤销远端授权；可在 [ChatGPT 设置](https://chatgpt.com/settings/usage) 中管理应用权限。

### 与官方流程的关系

OpenAI 的[注册与登录文档](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)指定 `http://127.0.0.1:<端口>/auth/callback`，并描述启动本地监听器。本项目保留该回调形式，由用户手动把返回地址交给扩展，不启动监听器。这是本项目的适配方案，不能视为 OpenAI 已明确支持的纯扩展接入方式；真实端到端兼容性仍待验证。

官方文档同时要求[令牌不要放入浏览器存储](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions#credential-security)。本版不提供跨浏览器重启的持久登录，只保存非秘密的随机 Host 标识、已签发客户端 ID、账号绑定摘要、设置和译文缓存。授权页面不会授予读取 ChatGPT 历史对话的能力。

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

输出位于 `release/0.2.0/` 和 `release/0.2.0/edge/`。不再生成 helper ZIP。发布包使用明确的文件允许列表，不包含个人账号、凭据、缓存、录制资料或浏览器配置。商店扩展包移除开发公钥和 source map，包含 MIT 及第三方许可证。`extension-public-key.json` 仅为固定开发版 ID 的公钥，不含私钥。

```text
src/extension/          网页提取、格式还原、小球、后台、会话页与设置
src/core/auth.ts        手动回调、PKCE、签名校验、内存会话与刷新
src/core/provider.ts    模型目录、Responses SSE、格式校验
src/core/scheduler.ts   队列、合并、取消与账号隔离缓存
src/core/storage.ts     注册信息与缓存接口（不接收令牌）
src/shared/            协议与格式标记
store/                  商店介绍、隐私披露与审核步骤
tests/                  离线自动测试
```

提交商店前还需在实际扩展中验证登录、一次真实翻译、关闭会话、重新授权及 Chrome / Edge 行为。构建或打包成功不表示上架成功。旧版公开归档保持不变。

## 当前范围

桌面 Chromium 120+ 的普通 HTTP/HTTPS 主文档；不同操作系统的实机验证待完成。复杂 Shadow DOM、跨域 iframe、PDF、EPUB、字幕和 OCR 待后续适配。界面主要为简体中文，AI 翻译可能有误，请结合原文判断。

TranslateMyPage 独立开发，与 OpenAI、ChatGPT 或 Immersive Translate 无隶属关系。

[官方套餐接入](https://developers.openai.com/siwc/token-sharing-open-source) · [模型与推理](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
