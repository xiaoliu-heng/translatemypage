# TranslateMyPage

**AI 网页翻译 · 沉浸式双语阅读。**

TranslateMyPage 是一款 AI 网页翻译工具，支持原文译文对照、保留网页排版和划词翻译。翻译请求可使用自己已授权的 ChatGPT 订阅额度，无需另外填写 OpenAI API 密钥。

## 主要功能

- AI 双语翻译：原文留在原位，译文贴近上下文，支持段落、标题、列表和表格。
- 保留排版：沿用原文的字体、字号、颜色和行距，保留链接、强调与行内代码。
- 划词即译：选中文字后，小球跑到选区旁等待，结果返回后打开游戏风格对话框。
- 可拖动小球：闭眼表示关闭，呼吸灯表示正在翻译；支持唤醒、入睡、跑动和对话框动画。
- 订阅额度共用：通过官方 Sign in with ChatGPT 授权，翻译使用账号已授权的套餐额度，实际模型、资格和额度以账号及工作区设置为准。

## 发布进度

免费开源（MIT）首版准备中。Chrome 商店**尚未提交审核、尚未上架**。完整源码、配套助手和上架材料已在本地准备好，目前仍待上传。

## 使用条件

扩展需要另外安装 Native Messaging 本地助手。首版支持 macOS，以及具备 Secret Service 的 Linux；需要 Node.js 22.16+。macOS 另需 Xcode Command Line Tools，Linux 另需 secret-tool 与 xdg-open。Windows 和 ChromeOS 暂不支持。

首次翻译前会征得同意，把待译文字、页面标题与命中的术语直接发送给 OpenAI。凭据保存在操作系统凭据库，译文缓存在本机。

维护者：xiaoliu-heng

支持及隐私联系：xiaoliublog@gmail.com

TranslateMyPage 独立开发，与 OpenAI、ChatGPT 或 Immersive Translate 没有隶属关系。
