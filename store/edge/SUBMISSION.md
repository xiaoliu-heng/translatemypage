# TranslateMyPage 0.2.1 · Edge submission draft

Free and open source (MIT). Publisher: xiaoliu-heng. Support: xiaoliublog@gmail.com.

This version removes the local helper. Only an extension ZIP is required; no store-ID-specific native registration is needed. Source and privacy updates must be published before submission.

Build with `npm run package:edge`. Packages are under `release/0.2.1/edge/`. Use the extension ZIP for store upload; keep the source, notices and checksums public.

Before submission:

1. Verify manual callback login, real token exchange, persistent API-key translation, custom Responses endpoints and their separate billing paths.
2. Test explicit connection switching, key/base-URL restoration after session/browser restart, local key deletion, per-host permission denial, origin-specific content consent, no billing fallback and no replay of unknown results. Verify default logo start/stop and same-language suppression on mixed-language pages.
3. Capture current-version screenshots. The existing `store/screenshots` images document the old architecture and must not be submitted for 0.2.1.
4. Verify the public privacy/source URLs and developer account access.
5. Copy the bilingual listing, privacy disclosures and reviewer instructions; confirm free distribution, then submit.

This draft has not been uploaded or submitted. Existing v0.1.x release assets are historical and remain unchanged.
