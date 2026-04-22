# Changelog

All notable changes to this package are documented here. For cross-SDK release notes, see [ethora/RELEASE-NOTES.md](https://github.com/dappros/ethora/blob/main/RELEASE-NOTES.md).

---

## [26.04.22]

- **Fixed:** `patchSampleApp()` no longer tries to patch `ETHORA_APP_TOKEN` — that `buildConfigField` was removed from [`ethora-sample-android`](https://github.com/dappros/ethora-sample-android) in the 26.04.21 refresh (the sample uses JWT login + optional single-room mode now). Previously the regex silently no-op'd.

## [26.04.17] — v26.04

- **Improved:** Server presets switched to canonical `chat.ethora.com` defaults — Cloud Production (`api.chat.ethora.com` / `xmpp.chat.ethora.com`) and Cloud QA (`chat-qa.ethora.com`). Replaces legacy `ethoradev.com` / `messenger-dev.asterotoken.com` clusters ([`5c83f05`](https://github.com/dappros/ethora-setup/commit/5c83f05))
- **Fixed:** `MainActivity.kt` patcher generalised to accept any `https://...` / `wss://...` / `xmpp.*` / `conference.*` host — previously hard-coded `ethoradev.com` regexes silently no-op'd after upstream Android templates moved to `chat.ethora.com` ([`35d47ef`](https://github.com/dappros/ethora-setup/commit/35d47ef))
- **Docs:** README updated to reflect new `chat.ethora.com` examples and corrected `ethora-mcp-cli` link ([`5c83f05`](https://github.com/dappros/ethora-setup/commit/5c83f05))
- **Milestone:** Version bumped to `26.04` ([`ce0e8cc`](https://github.com/dappros/ethora-setup/commit/ce0e8cc))

## [26.03.26]

- **New:** React.js SDK support — when setup detects a React.js SDK clone (has `config.ts`), it patches the file directly with API URL, XMPP host, and domain instead of writing a separate `.env.ethora` ([`a912550`](https://github.com/dappros/ethora-setup/commit/a912550))

## [26.03.18]

- **New:** `npx @ethora/setup` — full onboarding flow: account registration, app creation, credential generation ([`2c7c89a`](https://github.com/dappros/ethora-setup/commit/2c7c89a))
- **New:** Server presets — Cloud QA (latest) and Cloud Production (ethora.com) ([`97731f3`](https://github.com/dappros/ethora-setup/commit/97731f3))
- **New:** SDK clone + auto-config — setup can clone the target SDK repo and write config directly into it ([`f86a6d1`](https://github.com/dappros/ethora-setup/commit/f86a6d1))
- **New:** Android SDK patching — automatically patches `AppConfig.kt` and `MainActivity.kt` with your credentials ([`f2ca5fe`](https://github.com/dappros/ethora-setup/commit/f2ca5fe))
- **API:** Switched to v2 signup/login routes (password set directly, no email confirmation step) ([`963bc59`](https://github.com/dappros/ethora-setup/commit/963bc59))
