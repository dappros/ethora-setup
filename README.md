# @ethora/setup

Interactive CLI to set up Ethora SDK projects. Register an account, create apps, obtain credentials, and generate config files — all without leaving the terminal.

**Part of the [Ethora SDK ecosystem](https://github.com/dappros/ethora#ecosystem)** — see all SDKs, tools, and sample apps. Follow cross-SDK updates in the [Release Notes](https://github.com/dappros/ethora/blob/main/RELEASE-NOTES.md).

## Ethora Ecosystem

| Repository | Description |
|-----------|-------------|
| [ethora](https://github.com/dappros/ethora) | SDK monorepo — all SDKs, tools, and samples |
| [ethora-chat-component](https://github.com/dappros/ethora-chat-component) | React.js chat SDK |
| [ethora-chat-component-rn](https://github.com/dappros/ethora-chat-component-rn) | React Native chat SDK |
| [ethora-sdk-android](https://github.com/dappros/ethora-sdk-android) | Native Android SDK (Kotlin) |
| [ethora-sdk-swift](https://github.com/dappros/ethora-sdk-swift) | Native iOS SDK (Swift) |
| [ethora-wp-plugin](https://github.com/dappros/ethora-wp-plugin) | WordPress plugin |
| **ethora-setup** | **This repo** — CLI setup tool |
| [ethora-mcp-server](https://github.com/dappros/ethora-mcp-server) | MCP server for AI/IDE integration (npm: `@ethora/mcp-server`) |

## Quick Start

```bash
npx @ethora/setup
```

Or install globally:

```bash
npm install -g @ethora/setup
ethora-setup
```

## What It Does

1. **Creates an Ethora Cloud account** (or uses your existing one)
2. **Creates an app** and obtains API credentials automatically
3. **Generates config files** for your target SDK (Android, iOS, React, React Native, WordPress)
4. **Manages profiles** so you can switch between Cloud and self-hosted servers

## Usage

### First-time setup (Cloud)

```
$ npx @ethora/setup

◇ Server type: Cloud (app.chat.ethora.com)
◇ Do you have an account? No, create one for me
◇ Email: developer@company.com
◇ First name: Jane
◇ Last name: Developer
◆ Check developer@company.com for a verification email...
◇ Password: ********
✔ Logged in as Jane Developer
◇ App name: My Chat App
✔ App created! ID: 64abc123...
◇ Web app: https://mychatapp.chat.ethora.com
◇ Profile saved: cloud-mychatapp
◇ Generate SDK config files now? Yes
◇ Which SDK? Android (Kotlin/Compose)
✔ Written: ethora.properties (Gradle)
✔ Written: EthoraConfig.kt (Kotlin)
```

### Self-hosted server

```
$ npx @ethora/setup

◇ Server type: Self-hosted
◇ API endpoint: https://api.myserver.com/v1
◇ XMPP WebSocket: wss://xmpp.myserver.com:5443/ws
◇ XMPP host: xmpp.myserver.com
◇ XMPP conference: conference.xmpp.myserver.com
◇ App ID: 64abc123...
◇ App Token: JWT eyJ...
✔ Profile saved: self-hosted-prod
```

### Switch profiles

```
$ npx @ethora/setup
◇ Switch active profile
◇ Switch to: self-hosted-prod
✔ Active profile: self-hosted-prod
```

### Regenerate config files

```
$ npx @ethora/setup
◇ Generate config files for current profile
◇ Which SDK? React.js (Web)
✔ Written: .env.ethora
```

## Config Files Generated

| SDK | Files |
|-----|-------|
| Android | `ethora.properties`, `EthoraConfig.kt` |
| iOS (Swift) | `EthoraConfig.swift` |
| React.js | `.env.ethora` |
| React Native | `.env.ethora` |
| WordPress | `ethora-config.php` |

## Profiles

Profiles are stored in `~/.ethora/profiles.json`. Each profile contains:
- Server endpoints (API, XMPP)
- App ID and token
- Server type (cloud or self-hosted)

You can have multiple profiles and switch between them.

## Development

```bash
git clone https://github.com/dappros/ethora-setup.git
cd ethora-setup
npm install
npm run dev    # Run with tsx (no build needed)
npm run build  # Compile TypeScript
```

## License

MIT
