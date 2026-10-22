# Chrome 商店提交材料

定位：**AI 网页翻译 · 沉浸式双语阅读**。订阅额度是翻译的一项优势，表述为“翻译可使用自己已授权的 ChatGPT 订阅额度”。

- 开发者：xiaoliu-heng
- 支持邮箱：xiaoliublog@gmail.com
- 定价：免费；源码 MIT
- 商店标题与简介：`src/extension/_locales/zh_CN/messages.json`
- 完整文案：`store/listing.zh-CN.txt`、`store/listing.en.txt`
- 上传包：`release/0.1.0/TranslateMyPage-0.1.0-chrome.zip`
- 项目与源码：https://github.com/xiaoliu-heng/translatemypage（主分支提供完整源码，v0.1.0 Releases 另有版本源码包）
- 隐私政策：https://github.com/xiaoliu-heng/translatemypage/blob/main/PRIVACY.md（已公开）
- 助手分发：https://github.com/xiaoliu-heng/translatemypage/releases/tag/v0.1.0 。完整源码 source ZIP、helper ZIP、商店上传包、材料和校验和均已公开。v0.1.0 标签早于主分支源码补传，请下载明确命名的 source ZIP；该旧标签自动生成的 Source code 存档只有当时的说明文件。
- 单一用途、权限理由、数据类型、远程代码声明：`store/privacy-disclosure.json`
- 审核说明：`store/reviewer-instructions.txt`
- 128×128 图标：`assets/icons/icon-128.png`
- 必需的 440×280 宣传图：`store/assets/promo-small-440x280.png`
- 可选 1400×560 宣传图：`store/assets/promo-marquee-1400x560.png`
- 1280×800 截图：`store/screenshots/01-ai-bilingual.png`、`02-selected-text.png`

截图是已录制的本机网页演示实录，使用生产翻译代码和真实助手结果，并明确标注“网页演示”。只裁切、等比缩放和添加说明，没有合成译文或伪造浏览器界面。源图信息见 `store/screenshots/provenance.json`。

## 提交顺序

1. 打开 Chrome Web Store Developer Dashboard，确认是发布账号。若首次注册，账号持有人需确认开发者协议并支付注册费；不代替持有人承诺新协议。
2. 新增条目，上传 chrome ZIP。文件根目录为 manifest.json，无开发公钥、source map、Host、用户数据或凭据。
3. 记录商店分配的 32 位扩展 ID。使用该 ID 重新生成或安装配套助手；主机的 `allowed_origins` 与运行时配置必须一致。
4. 确认公开源码、隐私政策与助手下载链接能从未登录浏览器访问。
5. 填写介绍、开发者联系、图片、单一用途、四项权限理由和隐私披露。明确支持 macOS / Linux，依赖单独安装的本地助手与符合条件的 ChatGPT 授权。
6. 填写审核测试说明，不提供个人 ChatGPT 账号、Cookie、令牌或绕过登录的测试入口。
7. 检查后台验证项并提交审核。审核通过或商店公开 URL 出现前，始终标记“未上架”，不宣传已发布。

## 当前边界

截至 2026-10-22，项目仓库已经创建，公开介绍已按“AI 网页翻译 · 沉浸式双语阅读”保存；完整源码、构建配置、测试、MIT 文件与隐私政策已提交到公开主分支。完整源码包与助手另在 v0.1.0 Releases 分发，四个 ZIP 均已通过未登录的 HTTPS 下载与 SHA256 校验。

再次检查后，Chrome 的浏览器自动化接口仍拒绝开发者后台导航。GitHub CLI 已登录并通过 HTTPS 推送验证，凭据由系统钥匙串保存；源码可直接使用 Git 获取。尚未上传商店条目、取得商店 ID 或提交审核。

`store/publication-status.json` 记录公开状态与阻碍；`release-status.json` 保持 `prepared_not_submitted`。源码、MIT 文件、隐私政策和助手已公开。剩余商店流程需要在可访问的开发者后台按上述顺序完成，并更新这两个状态文件。不要把准备好的本地材料视为已经公开或通过审核。

## 官方依据

- https://developer.chrome.com/docs/webstore/publish
- https://developer.chrome.com/docs/webstore/prepare
- https://developer.chrome.com/docs/webstore/images
- https://developer.chrome.com/docs/webstore/cws-dashboard-privacy
- https://developers.openai.com/siwc/token-sharing-open-source
