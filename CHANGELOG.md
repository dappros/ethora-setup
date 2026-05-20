# Changelog

All notable changes to this package are documented here. For cross-SDK release notes, see [ethora/RELEASE-NOTES.md](https://github.com/dappros/ethora/blob/main/RELEASE-NOTES.md).

---

## [26.5.1]

- **New:** React Native target now actually configures the [`ethora-chat-component-rn`](https://github.com/dappros/ethora-chat-component-rn) testbed. Previously the RN path wrote a `.env.ethora` file that nothing in the testbed read; the developer still had to type endpoints + app token + email + password into the in-app Setup tab before they could connect. `patchReactNativeTestbed()` now rewrites the `DEFAULT_CREDS` object literal in `AppLoginChatsRn.tsx` so first launch lands with everything pre-filled: `baseUrl`, `xmppHost`, `xmppDevServer`, `conference`, `appToken`, and (when a test user was created) `mode: 'email'` + email + password. Hit Test then Save and the Chat tab takes over.
- **New:** `isReactNativeChatComponent()` detection helper. Distinguishes the chat-component-rn testbed (matches `package.json` + `app.json` + `AppLoginChatsRn.tsx`) from a generic React Native project (only the first two). Generic RN projects still receive the `.env.ethora` writer as before so developers can wire it into their own config loader.
- **Improved:** Post-clone hints for the RN target now show `npm run ios` / `npm run android` (Expo-driven, matches the actual scripts in the chat-component-rn `package.json`) instead of the generic `npx react-native run-ios` command, and mention which credentials are pre-filled.
- **New:** Auto-runs `npm install` in the freshly-cloned SDK directory for JS-based targets (`reactjs`, `reactnative`) when `node_modules/` is absent. Eliminates the "skipped `npm install`, hit `expo: command not found`" trap that bit several first-time users. Skipped when `node_modules/` already exists (regenerating into an existing checkout, or repeat run). On failure, the last few lines of stderr are surfaced and the post-clone hints fall back to telling the user to run `npm install` manually.

## [26.5.0]

- **First npm release** — `@ethora/setup` is now published to npm; `npx @ethora/setup` works without a local clone.
- Set the package version to clean semver `26.5.0` (was `26.05` — an invalid 2-part version npm would silently normalise).
- Add a `prepublishOnly: npm run build` script so the published tarball always ships a fresh `dist/` (it's gitignored, so it must be built at publish time).
- README: fix the ecosystem-table link to the renamed `ethora-mcp-server` repo.

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
