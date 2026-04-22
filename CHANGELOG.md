# Changelog

All notable changes to this package are documented here. For cross-SDK release notes, see [ethora/RELEASE-NOTES.md](https://github.com/dappros/ethora/blob/main/RELEASE-NOTES.md).

---

## [26.04.22]

- **Fixed:** Setup bailed with `404` on "Connecting to Cloud QA/Production…" before any registration could happen. Two bugs stacked:
  - `EthoraAPI` constructor used `apiUrl` (which ends with `/v1`) as axios `baseURL`, then methods prepended `/v1/...` or `/v2/...` — axios joined them into `…/v1/v1/…` or `…/v1/v2/…`. Fixed by stripping the `/v[12]` suffix in the constructor.
  - `CLOUD_QA.baseDomain` / `CLOUD_PROD.baseDomain` were stale (`"ethora-qa"` / `"ethora"` — legacy `messenger-dev.asterotoken.com` / `api.ethoradev.com` values that survived the Apr 17 preset switch). The canonical base app on both chat.ethora.com clusters has `domainName: "app"` (app id `646cc8dc96d4a4dc8f7b2f2d`, `isBaseApp=true`). Both presets now use `"app"` via a shared `BASE_APP_DOMAIN` constant.
- **New:** iOS onboarding now targets [`ethora-sample-swift`](https://github.com/dappros/ethora-sample-swift) (`SDKPlayground`) instead of `ethora-sdk-swift`. When the Swift target is chosen and the sample is cloned, setup also clones `ethora-sdk-swift` as a sibling directory (its `project.yml` references the EthoraSDK package via `path: ../..`, which no longer resolves after the 26.04.22 sample extraction).
- **New:** `patchSwiftSample()` rewrites nine `@Published var … = "…"` defaults in `SDKPlayground/PlaygroundSession.swift` (baseURL, appId, appToken, XMPP endpoints, plus first test user's email / password / JWT) so the Setup tab opens pre-filled. Also patches `project.yml`'s `path: ../..` → `path: ../ethora-sdk-swift` whenever a sibling SDK clone is present.
- **New:** `isSwiftSample()` / `isSwiftSdk()` detection helpers — the Swift `isSdkProject()` branch now matches both the sample (`project.yml` + `SDKPlayground/PlaygroundSession.swift`) and the SDK (`Package.swift`). The standalone `EthoraConfig.swift` generator is retained as the fallback for SDK-only clones.
- **Fixed:** `patchSampleApp()` now writes `.env` at the sample repo root (consumed by `app/build.gradle.kts` via `loadEnvFile()`) instead of regex-patching `buildConfigField` literals. The 26.04.21 sample refresh switched those literals from plain strings to Kotlin string templates (`"\"${envOrDefault(...)}\""`) — the previous `"[^"]*"` regex stopped at the first embedded quote and would corrupt the file.
- **New:** `ETHORA_USER_JWT` auto-populated with the first test user's JWT. After each test user is registered, setup now calls `loginUnderApp()` on the app's token to capture a user JWT and stores it in the profile (`TestUser.jwt`). Sample apps can drop straight into a signed-in session; if no test user is created or login fails, the field is omitted and the sample falls back to email/password.
- **API:** New `EthoraAPI.loginUnderApp(appToken, email, password)` method — mirrors `registerUnderApp`, returns an app-scoped `LoginResult`.
- **Refactored:** Removed dead `MAINACTIVITY_PATH` block from `patchAppConfig()`. The path (`chat-app/.../MainActivity.kt` inside the SDK repo) was emptied when the sample was extracted to [`ethora-sample-android`](https://github.com/dappros/ethora-sample-android) on 26.04.21; the block was a guarded no-op. `patchAppConfig()` now only patches `AppConfig.kt`, which is the only file remaining in that code path.
- **Note:** `ETHORA_ROOM_JID` is intentionally not auto-populated — single-room mode is opt-in and a freshly-created app has no rooms to pin to. Developers add it manually to `.env` when they want that flow.

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
