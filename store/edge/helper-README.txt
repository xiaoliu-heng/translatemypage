TranslateMyPage local helper for Microsoft Edge — 0.1.1

The free, MIT-licensed helper connects the TranslateMyPage Edge extension to your authorized ChatGPT account. It handles official sign-in, operating-system credential storage, translation requests and a local cache. The AI model runs at OpenAI, not on your computer.

Requirements
• macOS: Node.js 22.16+ and Xcode Command Line Tools.
• Linux: Node.js 22.16+, secret-tool, a desktop Secret Service and xdg-open.
• Windows, ChromeOS and mobile browsers are not supported in this release.

Install
1. Install TranslateMyPage from its Microsoft Edge Add-ons listing.
2. Copy the 32-character extension ID from that listing's URL or the extension details in Edge. The Edge store ID can differ from the Chrome or development ID.
3. Extract this ZIP to a normal local folder. Open Terminal in that folder and run:

   node scripts/install-host.mjs --browser=edge --extension-id=YOUR_32_CHARACTER_EDGE_EXTENSION_ID

   To inspect the plan without changing files:
   node scripts/install-host.mjs --dry-run --browser=edge --extension-id=YOUR_32_CHARACTER_EDGE_EXTENSION_ID

4. Open the Edge extension, click Reconnect, then Continue with ChatGPT. Complete sign-in and plan-usage consent on the official webpage using your own eligible account.

Edge starts the helper through Native Messaging as needed. There is no separate desktop window or background HTTP server. The installer copies the runtime into TranslateMyPage/runtime/edge in your user application-data directory and records an absolute Node.js path. Reinstall if you remove or change that Node.js installation. Chrome and Edge use separate runtime configurations; installing one does not replace the other's permitted extension ID.

Unregister the Edge helper
   node scripts/install-host.mjs --browser=edge --uninstall

This removes the Edge native registration and preserves local account metadata, credentials and cached translations. Sign out in the extension first. See privacy-policy.html for full deletion instructions.

The ZIP contains no pre-authorized accounts. Translation requests count toward your own authorized ChatGPT plan's available limits. TranslateMyPage adds no separate subscription fee.

Source and MIT license: https://github.com/xiaoliu-heng/translatemypage
Downloads: https://github.com/xiaoliu-heng/translatemypage/releases
Support and privacy contact: xiaoliublog@gmail.com
