TranslateMyPage local helper — 0.1.0

This helper is required for the TranslateMyPage Chrome extension. It handles official ChatGPT authorization, operating-system credential storage, translation requests and the local cache.

Requirements
• macOS: Node.js 22.16+ and Xcode Command Line Tools.
• Linux: Node.js 22.16+, secret-tool, a desktop Secret Service and xdg-open.
• Windows and ChromeOS are not supported in this initial release.

Install
1. Install the extension from its Chrome Web Store page.
2. Copy its 32-character extension ID from the end of the store URL or the extension's details page.
3. Extract this ZIP to a normal local folder. Open Terminal in that folder and run:

   node scripts/install-host.mjs --extension-id=YOUR_32_CHARACTER_EXTENSION_ID

   Review the destination and permitted ID before installation, if desired:
   node scripts/install-host.mjs --dry-run --extension-id=YOUR_32_CHARACTER_EXTENSION_ID

4. Open the Chrome extension and click Reconnect, then Continue with ChatGPT. Complete sign-in and plan-usage consent on the official webpage.

This does not install a background HTTP server. Chrome starts the helper through Native Messaging when needed. The installer copies the runtime into your own application-data folder and records an absolute Node.js path. Reinstall the helper if you remove or change that Node.js installation.

For Edge, add --browser=edge. Other installer targets: chrome, chromium, testing.

Unregister the helper
   node scripts/install-host.mjs --uninstall

This removes the browser registration and preserves local account metadata, credentials and cached translations. Sign out in the extension first to revoke/remove credentials. See privacy-policy.html for full deletion instructions.

The helper ZIP contains no pre-authorized accounts. Use your own eligible ChatGPT account and authorized plan. Model usage counts toward that plan's available limits.

MIT License — xiaoliu-heng
Support: xiaoliublog@gmail.com
