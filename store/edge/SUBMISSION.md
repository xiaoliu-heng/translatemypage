# Microsoft Edge Add-ons 提交材料

定位：**AI 网页翻译 · 沉浸式双语阅读**。翻译可使用自己已授权的 ChatGPT 订阅额度。

- 开发者：xiaoliu-heng；支持与隐私邮箱：xiaoliublog@gmail.com。
- 价格：免费；完整源码与本地助手采用 MIT 许可证。
- 上传 ZIP：`release/0.1.1/edge/TranslateMyPage-0.1.1-edge.zip`。
- 中英文文案：本目录 `listing.zh-CN.txt` 与 `listing.en.txt`，填写“详细介绍”正文，不复制内部字段标题。
- 审核说明：本目录 `reviewer-instructions.txt`。
- 权限与数据披露：`store/privacy-disclosure.json`。
- 图标：`store/edge/assets/logo-300.png`（300×300）。
- 可选宣传图：`store/assets/promo-small-440x280.png`、`promo-marquee-1400x560.png`。
- 截图：`store/screenshots/` 下的 1280×800 网页功能演示；来源记录见 `provenance.json`。仅代表网页演示，不将 Chrome 测试宣称为 Edge 测试。
- 源码、MIT 与安装：https://github.com/xiaoliu-heng/translatemypage 。
- 隐私政策：https://github.com/xiaoliu-heng/translatemypage/blob/main/PRIVACY.md 。
- 助手与源码下载：https://github.com/xiaoliu-heng/translatemypage/releases 。

## 兼容范围

当前需要单独安装本地助手，仅支持 macOS 和具备桌面 Secret Service 的 Linux；不支持 Windows、ChromeOS 或移动端。Node.js 22.16+、macOS Xcode Command Line Tools / Linux secret-tool 与 xdg-open 的要求需在商店介绍中保留。扩展内安装指引会在 Edge 中生成带 `--browser=edge` 的命令。

## 提交步骤

1. 登录 Microsoft Partner Center 的 Microsoft Edge 开发者计划。个人 Microsoft 账号为持有人；注册不收费。账号类型、国家/地区及个人联系资料应使用持有人确认的真实信息。新开发者协议由持有人在最终接受时确认。
2. 在 Edge 扩展工作区新建扩展并上传 Edge ZIP。文件根目录为 manifest.json，已去除开发公钥、update_url 与 source map。
3. 记录商店分配的实际 32 位 Edge ID。用 `node scripts/package-store.mjs --browser=edge --extension-id=实际ID` 重打助手，或在安装时明确传入该 ID。不要复用 Chrome 商店 ID。
4. 设置免费公开分发与支持市场。分类采用后台提供的翻译 / 生产力类别；完整填写中英文介绍与图标。
5. 填写单一用途、四项权限理由、数据使用、无远程可执行代码声明、公开隐私政策、支持邮箱和审核步骤。仅将模型输出作为数据处理。
6. 在 Edge 中加载并实测，核对 Edge 助手连接、官方登录、网页双语与划词翻译。提交前核实实际测试结果，不能以构建成功代替运行验证。
7. 按后台验证提示补齐字段，提交认证；只有后台显示已提交 / 审核中后才更新状态。商店公开前不宣称已经上架。

目前尚未创建商店条目或提交。最新事实记录在本目录 `publication-status.json`；自动生成的包状态是 `prepared_not_submitted`。

## 官方参考

- https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/create-dev-account
- https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension
- https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/port-chrome-extension
- https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/native-messaging
