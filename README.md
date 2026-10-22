# TranslateMyPage

**AI 网页翻译 · 沉浸式双语阅读。**

TranslateMyPage 翻译网页和选中文字，保留原文对照与网页排版。翻译请求可使用自己已授权的 **ChatGPT 订阅额度**，无需另填 OpenAI API 密钥。

免费开源，采用 [MIT 许可证](LICENSE)。维护者：xiaoliu-heng；支持邮箱：xiaoliublog@gmail.com。

> Chrome 商店版本尚未提交审核。完整源码位于当前仓库；[Releases](https://github.com/xiaoliu-heng/translatemypage/releases) 同时提供按版本打包的源码与配套助手。扩展需要另外安装本地助手；支持 macOS 和具备 Secret Service 的 Linux，Windows / ChromeOS 暂不支持。

## 主要功能

- **AI 双语翻译**：原文与译文在同一网页对照，支持标题、段落、列表与表格，可恢复原文。
- **保留排版**：沿用原文的字体、字号、颜色、行距、对齐与缩进，并保留链接、加粗、斜体、行内代码、上下标和手动换行。
- **划词即译**：在已激活的页面选择正文，小球跑到选区旁等待，结果返回后展开游戏风格对话框。支持 Alt+T、Escape、关闭和手动重试。
- **可拖动小球**：闭眼表示关闭，呼吸灯表示处理中，灯泡常亮表示就绪。位置可保存，唤醒、入睡、移动和对话框均有过渡，尊重系统减少动态效果设置。
- **订阅额度共用**：官方 Sign in with ChatGPT 登录与授权，读取当前账号实际可用的模型。请求会使用该账号授权的套餐额度；可用模型、资格及限制以 OpenAI 和工作区设置为准。
- **本地助手与缓存**：凭据放在系统钥匙串 / Secret Service；翻译直接请求 OpenAI，译文按账号缓存在本机，无开发者中转服务、广告或分析 SDK。

## 安装开发版

通过 HTTPS 克隆仓库：

```sh
git clone https://github.com/xiaoliu-heng/translatemypage.git
cd translatemypage
```

也可以从 [Releases](https://github.com/xiaoliu-heng/translatemypage/releases) 下载 `TranslateMyPage-0.1.0-source.zip` 并解压。在源码目录运行以下命令。

需要 Node.js 22.16+。macOS 还需 Xcode Command Line Tools；Linux 还需 `secret-tool`、桌面 Secret Service 和 `xdg-open`。

```sh
npm ci
npm run build
npm run install:host
```

1. 在 Chrome 扩展管理页启用开发者模式，加载 `dist/extension`。
2. 打开扩展，点击 **Continue with ChatGPT**，在官方网页登录并授权使用套餐额度。
3. 确认套餐用量说明，选择可用模型和目标语言。
4. 在普通网页点击翻译，确认内容发送说明后开始双语阅读。当前页激活后可直接划词翻译。

Edge 使用 `npm run install:host -- --browser=edge`。安装目标还支持 `chromium`、`testing`。助手安装器会记录当前 Node 的绝对路径，移动或删除 Node 版本后请重新安装。

## 安装商店版的配套助手

从 [Releases](https://github.com/xiaoliu-heng/translatemypage/releases) 下载 helper ZIP，解压后在该目录运行：

```sh
node scripts/install-host.mjs --extension-id=商店条目的32位扩展ID
```

扩展 ID 可从商店网址末尾或扩展详情页复制。安装器会把同一 ID 写入 Native Messaging 的允许来源和 Host 自身的来源校验配置；不能把开发版 ID 直接用于商店版。

检查安装计划而不写入文件：

```sh
node scripts/install-host.mjs --dry-run --extension-id=商店条目的32位扩展ID
```

在扩展内退出账号后，可注销助手：

```sh
node scripts/install-host.mjs --uninstall
```

注销只移除浏览器注册，保留本地资料。完整数据清除方式见 [隐私政策](PRIVACY.md)。

## 数据与权限

第一次翻译前，会说明把待译正文、页面标题和命中的术语发送给 OpenAI，并征得同意。当前页地址只在本地用于站点术语、页面生命周期与临时权限检查，不作为完整地址加入模型提示。授权不会授予读取 ChatGPT 历史对话的能力。

扩展只请求 `activeTab`、`scripting`、`storage` 和 `nativeMessaging`；不请求浏览历史或全站常驻权限，不支持无痕窗口。表单、密码框、可编辑输入区与代码块默认排除。

[隐私政策](PRIVACY.md) · [供商店托管的 HTML 隐私政策](store/privacy-policy.html)

## 本地 Host

Host 是浏览器按需启动的独立 Node.js 后台进程，没有单独桌面窗口。连接、账号、模型与重试入口在扩展界面。

```text
网页小球 / 划词
  → 扩展后台 background.ts
  → NativeBridge / chrome.runtime.connectNative
  → launch-host → src/host/index.ts
  → AuthManager / Scheduler / ChatGPTPlanProvider
  → 操作系统凭据库、本机缓存、OpenAI Responses SSE
```

构建产物是 `dist/host/host.cjs`。macOS 运行目录为 `~/Library/Application Support/TranslateMyPage/runtime/`；Linux 为用户数据目录下的 `TranslateMyPage/runtime/`。账号与缓存分别由 `src/host/storage.ts` 中的 `dataRoot()` 管理。浏览器第一次连接时拉起 Host，扩展空闲 60 秒且无任务/登录时断开；Host 在输入流关闭后退出，无需额外启动 HTTP 服务。

## 开发与发布

```sh
npm run check          # 类型检查、离线测试、构建
npm run package:store  # 商店 ZIP、助手 ZIP、源码 ZIP、上架材料与校验和
# 获得商店 ID 后可重打助手包：
node scripts/package-store.mjs --extension-id=商店条目的32位扩展ID
```

`release/0.1.0/` 为生成的发布目录，`release-status.json` 明确标注是否仍待提交；构建成功不表示已通过商店审核。安装包采用允许列表，不包含本地账号、凭据、缓存、录制日志或浏览器资料。商店包不包含开发公钥与 source map。

`extension-public-key.json` 只含开发公钥，用于固定开发版 ID。商店 ID 由商店分配，配套助手以实际 ID 注册。

```text
src/extension/          网页提取、排版、小球、后台与扩展界面
src/host/index.ts        Host 入口、Native Messaging 分帧和 RPC
src/host/auth.ts         官方授权、会话与多账号
src/host/provider.ts     模型目录、Responses SSE 与结果校验
src/host/scheduler.ts    队列、缓存、请求合并和取消
src/host/storage.ts      本机存储、进程锁与系统凭据库
native/keychain.swift   macOS 钥匙串桥接
store/                  商店文案、图片、隐私披露、审核和安装说明
docs/                   可托管的项目与隐私页面
tests/                  离线自动测试
```

## 当前范围

普通 HTTP/HTTPS 主文档。复杂 Shadow DOM、跨域 iframe、PDF、EPUB、字幕、OCR 属于后续适配范围。界面主要为简体中文。AI 翻译可能有误，请结合原文判断。

TranslateMyPage 独立开发，与 OpenAI、ChatGPT 或 Immersive Translate 无隶属关系。

## 官方接口依据

[ChatGPT 套餐接入](https://developers.openai.com/siwc/token-sharing-open-source) · [授权](https://developers.openai.com/siwc/token-sharing-open-source/sign-in) · [模型与推理](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference) · [预览约束](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations) · [Chrome Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)
