#!/usr/bin/env node

import * as p from "@clack/prompts";
import pc from "picocolors";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir, platform as osPlatform } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { EthoraAPI, SERVER_PRESETS, type ServerPreset, type ServerEndpoints, type AppInfo } from "./api.js";
import {
  addProfile,
  loadProfiles,
  saveProfiles,
  setActiveProfile,
  getActiveProfile,
  deleteProfile,
  getSdkPath,
  setSdkPath,
  getAutoUpdate,
  setAutoUpdate,
  type Profile,
  type TestUser,
} from "./profiles.js";
import {
  generateConfig,
  showConfigPreview,
  isSdkProject,
  isReactNativeChatComponent,
  type SdkTarget,
} from "./config-generators.js";

/** Check all known SDK paths at startup and offer to update any that are behind. */
async function checkAllSdkUpdates(): Promise<void> {
  if (!getAutoUpdate()) return;

  const store = loadProfiles();
  const paths = store.sdkPaths;
  if (!paths || Object.keys(paths).length === 0) return;

  const SDK_LABELS: Record<string, string> = {
    android: "ethora-sdk-android",
    swift: "ethora-sdk-swift",
    reactjs: "ethora-chat-component",
    reactnative: "ethora-chat-component-rn",
    wordpress: "ethora-wp-plugin",
  };

  // Collect update status for all known paths in parallel
  const checks: { target: string; name: string; dir: string; behind: number; remoteBranch: string }[] = [];

  for (const [target, dir] of Object.entries(paths)) {
    if (!existsSync(join(dir, ".git"))) continue;
    const name = SDK_LABELS[target] || target;
    try {
      execSync(`git -C ${JSON.stringify(dir)} fetch origin`, {
        stdio: "pipe",
        timeout: 10000,
      });
      const local = execSync(`git -C ${JSON.stringify(dir)} rev-parse HEAD`, {
        encoding: "utf-8",
      }).trim();

      let remoteBranch = "origin/main";
      try {
        execSync(`git -C ${JSON.stringify(dir)} rev-parse origin/main`, { stdio: "pipe" });
      } catch {
        remoteBranch = "origin/master";
      }

      const remote = execSync(
        `git -C ${JSON.stringify(dir)} rev-parse ${remoteBranch}`,
        { encoding: "utf-8" },
      ).trim();

      if (local !== remote) {
        const behind = parseInt(
          execSync(
            `git -C ${JSON.stringify(dir)} rev-list --count HEAD..${remoteBranch}`,
            { encoding: "utf-8" },
          ).trim(),
          10,
        );
        checks.push({ target, name, dir, behind, remoteBranch });
      }
    } catch {
      // offline or broken repo — skip silently
    }
  }

  if (checks.length === 0) return;

  p.log.message("");
  p.log.message(pc.bold("SDK updates available:"));
  for (const c of checks) {
    p.log.message(
      `  ${pc.yellow(c.name)} — ${pc.bold(String(c.behind))} commit(s) behind  ${pc.dim(c.dir)}`
    );
  }
  p.log.message("");

  const update = await p.select({
    message: checks.length === 1
      ? `Update ${checks[0].name}?`
      : `Update all ${checks.length} SDKs?`,
    options: [
      { value: "yes", label: "Yes, update now" },
      { value: "skip", label: "Skip for now" },
      { value: "never", label: "Don't check for updates automatically", hint: "you can re-enable in ~/.ethora/profiles.json" },
    ],
  });
  if (p.isCancel(update)) return;

  if (update === "never") {
    setAutoUpdate(false);
    p.log.info(pc.dim("Auto-update checks disabled. Set \"autoUpdate\": true in ~/.ethora/profiles.json to re-enable."));
    return;
  }
  if (update === "skip") return;

  for (const c of checks) {
    const spinner = p.spinner();
    spinner.start(`Updating ${c.name}...`);
    try {
      // Reset to remote HEAD — handles local modifications, deleted files,
      // and diverged history (e.g. after force-push)
      execSync(`git -C ${JSON.stringify(c.dir)} reset --hard ${c.remoteBranch}`, { stdio: "pipe" });
      spinner.stop(`${pc.green(c.name)} updated`);
    } catch {
      spinner.stop(`${pc.yellow(c.name)}: update failed — pull manually`);
    }
  }
  p.log.message("");
}

async function main() {
  p.intro(pc.bgCyan(pc.black(" Ethora SDK Setup ")));

  // Check known SDK installations for updates
  await checkAllSdkUpdates();

  const store = loadProfiles();
  const profileNames = Object.keys(store.profiles);

  let action: string;

  if (profileNames.length === 0) {
    p.log.info("No profiles found. Let's create one.");
    action = "new";
  } else {
    const active = store.activeProfile
      ? ` (active: ${pc.green(store.activeProfile)})`
      : "";
    const result = await p.select({
      message: `You have ${profileNames.length} profile(s)${active}. What would you like to do?`,
      options: [
        { value: "new", label: "Create a new profile" },
        { value: "switch", label: "Switch active profile" },
        { value: "generate", label: "Generate config files for current profile" },
        { value: "list", label: "List all profiles" },
        { value: "delete", label: "Delete a profile" },
      ],
    });
    if (p.isCancel(result)) return handleCancel();
    action = result;
  }

  switch (action) {
    case "new":
      await createProfile();
      break;
    case "switch":
      await switchProfile(profileNames, store.activeProfile);
      break;
    case "generate":
      await generateForProfile();
      break;
    case "list":
      listProfiles();
      break;
    case "delete":
      await removeProfile(profileNames);
      break;
  }

  p.outro(pc.green("Done!"));
}

async function createProfile() {
  const serverChoice = await p.select({
    message: "Server:",
    options: [
      ...SERVER_PRESETS.map((preset, i) => ({
        value: String(i),
        label: preset.label,
        hint: preset.hint,
      })),
      {
        value: "self-hosted",
        label: "Self-hosted",
        hint: "enter your own server endpoints",
      },
    ],
  });
  if (p.isCancel(serverChoice)) return handleCancel();

  if (serverChoice === "self-hosted") {
    await createSelfHostedProfile();
  } else {
    const preset = SERVER_PRESETS[Number(serverChoice)];
    await createCloudProfile(preset);
  }
}

async function createCloudProfile(preset: ServerPreset) {
  const endpoints = preset.endpoints;
  const api = new EthoraAPI(endpoints.apiUrl);

  // Step 0: Bootstrap — get the base app token from the server
  const spinner = p.spinner();
  spinner.start(`Connecting to ${preset.label}...`);
  try {
    await api.getBaseAppConfig(preset.baseDomain);
    spinner.stop(`Connected to ${preset.label}`);
  } catch (err: any) {
    spinner.stop("Connection failed");
    const msg = err?.response?.data?.error || err?.message || "Unknown error";
    p.log.error(`Could not connect to server: ${msg}`);
    p.log.info(`API: ${endpoints.apiUrl}`);
    p.log.info(`Base domain: ${preset.baseDomain}`);
    return;
  }

  const hasAccount = await p.select({
    message: "Do you have an account?",
    options: [
      { value: "login", label: "Yes, log me in" },
      { value: "register", label: "No, create a new account" },
    ],
  });
  if (p.isCancel(hasAccount)) return handleCancel();

  let email: string;

  if (hasAccount === "register") {
    // v2 signup: password set immediately, no email confirmation
    const regFields = await p.group({
      email: () =>
        p.text({ message: "Email:", validate: validateEmail }),
      firstName: () => p.text({ message: "First name:" }),
      lastName: () => p.text({ message: "Last name:" }),
      password: () =>
        p.password({
          message: "Password:",
          validate: (v) =>
            v.length < 6 ? "Password must be at least 6 characters" : undefined,
        }),
    });
    if (p.isCancel(regFields)) return handleCancel();

    spinner.start("Creating account...");
    try {
      await api.register(
        regFields.email,
        regFields.firstName,
        regFields.lastName,
        regFields.password
      );
      spinner.stop("Account created!");
    } catch (err: any) {
      const msg =
        err?.response?.data?.error || err?.response?.data?.message || err.message;
      spinner.stop("Registration failed");
      p.log.error(`Registration error: ${msg}`);
      return;
    }

    // Login immediately after registration
    spinner.start("Logging in...");
    try {
      const loginResult = await api.login(regFields.email, regFields.password);
      spinner.stop(
        `Logged in as ${pc.green(loginResult.user.firstName + " " + loginResult.user.lastName)}`
      );
    } catch (err: any) {
      spinner.stop("Login failed");
      const msg = err?.response?.data?.error || err?.response?.data?.message || err.message;
      p.log.error(`Login error: ${msg}`);
      return;
    }

    email = regFields.email;
  } else {
    // Existing account — just login
    const loginFields = await p.group({
      email: () => p.text({ message: "Email:", validate: validateEmail }),
      password: () => p.password({ message: "Password:" }),
    });
    if (p.isCancel(loginFields)) return handleCancel();

    spinner.start("Logging in...");
    try {
      const loginResult = await api.login(loginFields.email, loginFields.password);
      spinner.stop(
        `Logged in as ${pc.green(loginResult.user.firstName + " " + loginResult.user.lastName)}`
      );
    } catch (err: any) {
      spinner.stop("Login failed");
      const msg = err?.response?.data?.error || err?.response?.data?.message || err.message;
      p.log.error(`Login error: ${msg}`);
      return;
    }

    email = loginFields.email;
  }

  // List existing apps or create new
  spinner.start("Loading your apps...");
  let apps: AppInfo[] = [];
  try {
    apps = await api.listApps();
    spinner.stop(`Found ${apps.length} app(s)`);
  } catch {
    spinner.stop("Could not list apps");
  }

  let appInfo;
  if (apps.length > 0) {
    const appChoice = await p.select({
      message: "Choose an app or create a new one:",
      options: [
        ...apps.map((a) => ({
          value: a._id,
          label: `${a.displayName} (${a.domainName || a._id})`,
        })),
        { value: "__new__", label: "Create a new app" },
      ],
    });
    if (p.isCancel(appChoice)) return handleCancel();

    if (appChoice === "__new__") {
      appInfo = await createNewApp(api);
    } else {
      appInfo = apps.find((a) => a._id === appChoice);
    }
  } else {
    p.log.info("No apps yet. Let's create one.");
    appInfo = await createNewApp(api);
  }

  if (!appInfo) return;

  // Build profile
  const profileName = await p.text({
    message: "Profile name (saves your config locally so you can switch between environments):",
    defaultValue: `${appInfo.domainName || appInfo.displayName.toLowerCase().replace(/\s+/g, "-")}`,
    placeholder: "myapp",
  });
  if (p.isCancel(profileName)) return handleCancel();

  const webAppUrl =
    appInfo.domainName && preset.webDomain
      ? `https://${appInfo.domainName}.${preset.webDomain}`
      : undefined;

  const profile: Profile = {
    name: profileName,
    type: "cloud",
    endpoints,
    appId: appInfo._id,
    appToken: appInfo.appToken || "",
    appSecret: appInfo.appSecret || "",
    displayName: appInfo.displayName,
    domainName: appInfo.domainName,
    email,
    webAppUrl,
  };

  addProfile(profile);
  p.log.success(`Profile ${pc.green(profileName)} saved!`);

  if (webAppUrl) {
    p.log.info(`Web app: ${pc.cyan(webAppUrl)}`);
  }

  // Offer to create test users
  await askCreateTestUsers(api, profile);

  // Ask about config generation
  await askGenerateConfig(profile);
}

/**
 * Derive the conventional XMPP host from an API base URL by swapping the
 * leading `api.` subdomain for `xmpp.`. Returns "" when the input doesn't
 * follow the `api.<rest>` convention, so callers fall back to no default
 * instead of suggesting a host the user didn't ask for.
 */
function deriveXmppHostFromApiUrl(apiUrl: string): string {
  try {
    const host = new URL(apiUrl).hostname;
    if (host.startsWith("api.")) return "xmpp." + host.slice("api.".length);
  } catch {
    // fall through
  }
  return "";
}

async function createSelfHostedProfile() {
  p.log.info("Enter your self-hosted server endpoints.");

  const serverFields = await p.group({
    apiUrl: () =>
      p.text({
        message: "API base URL:",
        placeholder: "https://api.myserver.com",
      }),
    xmppHost: ({ results }) => {
      const derived = deriveXmppHostFromApiUrl(results.apiUrl ?? "");
      return p.text({
        message: "XMPP host:",
        placeholder: derived || "xmpp.myserver.com",
        defaultValue: derived || undefined,
      });
    },
  });
  if (p.isCancel(serverFields)) return handleCancel();

  // Derive XMPP endpoints from host (user can override)
  // Cast: the dependent p.group callback widens this field's inferred type
  // to `unknown`. isCancel() above already narrows the group result.
  const xmppHost = serverFields.xmppHost as string;
  const derivedEndpoints = {
    xmppWebSocket: `wss://${xmppHost}/ws`,
    xmppBosh: `https://${xmppHost}/bosh`,
    xmppConference: `conference.${xmppHost}`,
  };

  p.log.info(pc.dim(`Derived XMPP endpoints (press Enter to accept):`));
  p.log.info(pc.dim(`  WS:         ${derivedEndpoints.xmppWebSocket}`));
  p.log.info(pc.dim(`  BOSH:       ${derivedEndpoints.xmppBosh}`));
  p.log.info(pc.dim(`  Conference: ${derivedEndpoints.xmppConference}`));

  const overrideXmpp = await p.confirm({
    message: "Accept derived XMPP endpoints?",
    initialValue: true,
  });
  if (p.isCancel(overrideXmpp)) return handleCancel();

  let finalXmppWs = derivedEndpoints.xmppWebSocket;
  let finalXmppBosh = derivedEndpoints.xmppBosh;
  let finalXmppConference = derivedEndpoints.xmppConference;

  if (!overrideXmpp) {
    const xmppOverrides = await p.group({
      ws: () =>
        p.text({
          message: "XMPP WebSocket URL:",
          defaultValue: derivedEndpoints.xmppWebSocket,
        }),
      bosh: () =>
        p.text({
          message: "XMPP BOSH URL:",
          defaultValue: derivedEndpoints.xmppBosh,
        }),
      conference: () =>
        p.text({
          message: "XMPP conference domain:",
          defaultValue: derivedEndpoints.xmppConference,
        }),
    });
    if (p.isCancel(xmppOverrides)) return handleCancel();
    finalXmppWs = xmppOverrides.ws;
    finalXmppBosh = xmppOverrides.bosh;
    finalXmppConference = xmppOverrides.conference;
  }

  const endpoints: ServerEndpoints = {
    apiUrl: serverFields.apiUrl,
    xmppWebSocket: finalXmppWs,
    xmppBosh: finalXmppBosh,
    xmppHost: xmppHost,
    xmppConference: finalXmppConference,
  };

  // Bootstrap — get base app token
  const api = new EthoraAPI(endpoints.apiUrl);
  const baseDomain = await p.text({
    message: "Base app domain name on this server:",
    placeholder: "app",
    defaultValue: "app",
  });
  if (p.isCancel(baseDomain)) return handleCancel();

  const spinner = p.spinner();
  spinner.start("Connecting to server...");
  try {
    await api.getBaseAppConfig(baseDomain);
    spinner.stop("Connected!");
  } catch (err: any) {
    spinner.stop("Connection failed");
    const msg = err?.response?.data?.error || err?.message || "Unknown error";
    p.log.error(`Could not get base app config: ${msg}`);

    // Fallback: let user provide the app token directly
    p.log.info("You can enter credentials manually instead.");
    const manualFields = await p.group({
      appId: () => p.text({ message: "App ID:" }),
      appToken: () => p.text({ message: "App Token (JWT):" }),
      appSecret: () => p.text({ message: "App Secret:" }),
      email: () => p.text({ message: "Your email (for reference):" }),
      profileName: () =>
        p.text({ message: "Profile name:", placeholder: "self-hosted-prod" }),
    });
    if (p.isCancel(manualFields)) return handleCancel();

    const profile: Profile = {
      name: manualFields.profileName,
      type: "self-hosted",
      endpoints,
      appId: manualFields.appId,
      appToken: manualFields.appToken,
      appSecret: manualFields.appSecret,
      displayName: manualFields.profileName,
      email: manualFields.email,
    };

    addProfile(profile);
    p.log.success(`Profile ${pc.green(manualFields.profileName)} saved!`);
    await askGenerateConfig(profile);
    return;
  }

  // Same register/login/create-app flow as cloud
  const hasAccount = await p.select({
    message: "Do you have an account on this server?",
    options: [
      { value: "login", label: "Yes, log me in" },
      { value: "register", label: "No, create a new account" },
    ],
  });
  if (p.isCancel(hasAccount)) return handleCancel();

  let email: string;

  if (hasAccount === "register") {
    const regFields = await p.group({
      email: () => p.text({ message: "Email:", validate: validateEmail }),
      firstName: () => p.text({ message: "First name:" }),
      lastName: () => p.text({ message: "Last name:" }),
      password: () =>
        p.password({
          message: "Password:",
          validate: (v) =>
            v.length < 6 ? "Password must be at least 6 characters" : undefined,
        }),
    });
    if (p.isCancel(regFields)) return handleCancel();

    spinner.start("Creating account...");
    try {
      await api.register(
        regFields.email,
        regFields.firstName,
        regFields.lastName,
        regFields.password
      );
      spinner.stop("Account created!");
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.response?.data?.message || err.message;
      spinner.stop("Registration failed");
      p.log.error(`Error: ${msg}`);
      return;
    }

    spinner.start("Logging in...");
    try {
      const loginResult = await api.login(regFields.email, regFields.password);
      spinner.stop(`Logged in as ${pc.green(loginResult.user.firstName + " " + loginResult.user.lastName)}`);
    } catch (err: any) {
      spinner.stop("Login failed");
      const msg = err?.response?.data?.error || err?.response?.data?.message || err.message;
      p.log.error(`Error: ${msg}`);
      return;
    }
    email = regFields.email;
  } else {
    const loginFields = await p.group({
      email: () => p.text({ message: "Email:", validate: validateEmail }),
      password: () => p.password({ message: "Password:" }),
    });
    if (p.isCancel(loginFields)) return handleCancel();

    spinner.start("Logging in...");
    try {
      const loginResult = await api.login(loginFields.email, loginFields.password);
      spinner.stop(`Logged in as ${pc.green(loginResult.user.firstName + " " + loginResult.user.lastName)}`);
    } catch (err: any) {
      spinner.stop("Login failed");
      const msg = err?.response?.data?.error || err?.response?.data?.message || err.message;
      p.log.error(`Error: ${msg}`);
      return;
    }
    email = loginFields.email;
  }

  // List apps or create new
  spinner.start("Loading your apps...");
  let apps: AppInfo[] = [];
  try {
    apps = await api.listApps();
    spinner.stop(`Found ${apps.length} app(s)`);
  } catch {
    spinner.stop("Could not list apps");
  }

  let appInfo;
  if (apps.length > 0) {
    const appChoice = await p.select({
      message: "Choose an app or create a new one:",
      options: [
        ...apps.map((a) => ({
          value: a._id,
          label: `${a.displayName} (${a.domainName || a._id})`,
        })),
        { value: "__new__", label: "Create a new app" },
      ],
    });
    if (p.isCancel(appChoice)) return handleCancel();

    if (appChoice === "__new__") {
      appInfo = await createNewApp(api);
    } else {
      appInfo = apps.find((a) => a._id === appChoice);
    }
  } else {
    p.log.info("No apps yet. Let's create one.");
    appInfo = await createNewApp(api);
  }

  if (!appInfo) return;

  const profileName = await p.text({
    message: "Profile name:",
    defaultValue: `self-hosted-${appInfo.domainName || appInfo.displayName.toLowerCase().replace(/\s+/g, "-")}`,
    placeholder: "self-hosted-myapp",
  });
  if (p.isCancel(profileName)) return handleCancel();

  const profile: Profile = {
    name: profileName,
    type: "self-hosted",
    endpoints,
    appId: appInfo._id,
    appToken: appInfo.appToken || "",
    appSecret: appInfo.appSecret || "",
    displayName: appInfo.displayName,
    domainName: appInfo.domainName,
    email,
  };

  addProfile(profile);
  p.log.success(`Profile ${pc.green(profileName)} saved!`);

  // Offer to create test users
  await askCreateTestUsers(api, profile);

  await askGenerateConfig(profile);
}

async function createNewApp(api: EthoraAPI) {
  const appFields = await p.group({
    displayName: () =>
      p.text({ message: "App display name:", placeholder: "My Chat App" }),
    domainName: () =>
      p.text({
        message: "App domain name (lowercase, no spaces):",
        placeholder: "mychatapp",
        validate: (v) => {
          if (!/^[a-z0-9-]+$/.test(v))
            return "Only lowercase letters, numbers, and hyphens";
          return undefined;
        },
      }),
  });
  if (p.isCancel(appFields)) return null;

  const spinner = p.spinner();
  spinner.start("Creating app...");
  try {
    const app = await api.createApp(appFields.displayName, appFields.domainName);
    spinner.stop(`App ${pc.green(app.displayName)} created!`);
    p.log.info(`App ID: ${pc.cyan(app._id)}`);
    p.log.info(`Domain: ${pc.cyan(app.domainName)}`);
    return app;
  } catch (err: any) {
    const msg = err?.response?.data?.error || err?.response?.data?.message || err.message;
    spinner.stop("App creation failed");
    p.log.error(`Error: ${msg}`);
    return null;
  }
}

function defaultTestUsers(profile: Profile): TestUser[] {
  // Extract top-level domain from API URL, e.g. api.messenger-dev.asterotoken.com → asterotoken.com
  let domain = "ethora.com";
  try {
    const host = new URL(profile.endpoints.apiUrl).hostname;
    const parts = host.split(".");
    if (parts.length >= 2) {
      domain = parts.slice(-2).join(".");
    }
  } catch { /* fall back to ethora.com */ }
  return [
    { username: "alice", email: `alice@${domain}`, password: "TestPass123" },
    { username: "bob", email: `bob@${domain}`, password: "TestPass123" },
  ];
}

async function askCreateTestUsers(
  api: EthoraAPI,
  profile: Profile
): Promise<void> {
  const wantTestUsers = await p.confirm({
    message: "Create test users (e.g. Alice & Bob) for testing the chat?",
    initialValue: true,
  });
  if (p.isCancel(wantTestUsers) || !wantTestUsers) return;

  const defaults = defaultTestUsers(profile);

  // Show defaults and let developer adjust
  p.log.info(pc.dim("Default test users:"));
  for (const u of defaults) {
    p.log.info(pc.dim(`  ${u.username}: ${u.email} / ${u.password}`));
  }

  const customise = await p.confirm({
    message: "Use these defaults?",
    initialValue: true,
  });
  if (p.isCancel(customise)) return;

  let testUsers: TestUser[];

  if (!customise) {
    // Let developer edit usernames and password
    const fields = await p.group({
      user1Name: () =>
        p.text({
          message: "Test user 1 — username:",
          defaultValue: "alice",
        }),
      user1Email: () =>
        p.text({
          message: "Test user 1 — email (required by API):",
          defaultValue: defaults[0].email,
          validate: validateEmail,
        }),
      user2Name: () =>
        p.text({
          message: "Test user 2 — username:",
          defaultValue: "bob",
        }),
      user2Email: () =>
        p.text({
          message: "Test user 2 — email (required by API):",
          defaultValue: defaults[1].email,
          validate: validateEmail,
        }),
      password: () =>
        p.text({
          message: "Password (shared by test users):",
          defaultValue: "TestPass123",
        }),
    });
    if (p.isCancel(fields)) return;

    testUsers = [
      { username: fields.user1Name, email: fields.user1Email, password: fields.password },
      { username: fields.user2Name, email: fields.user2Email, password: fields.password },
    ];
  } else {
    testUsers = [...defaults];
  }

  // Register test users via API
  const spinner = p.spinner();
  const created: TestUser[] = [];

  for (const user of testUsers) {
    spinner.start(`Creating test user ${pc.cyan(user.username)}...`);
    try {
      await api.registerUnderApp(
        profile.appToken,
        user.email,
        user.username,
        "Test User",
        user.password
      );
      spinner.stop(`Created ${pc.green(user.username)} (${user.email})`);
    } catch (err: any) {
      const msg =
        err?.response?.data?.error ||
        err?.response?.data?.message ||
        err.message;
      spinner.stop(`${user.username}: ${pc.yellow(msg)}`);
      // Fall through — user may already exist from a previous run; we can
      // still fetch a JWT for them via loginUnderApp below.
    }

    // Fetch an app-scoped JWT so sample apps can drop straight into a
    // signed-in session (ETHORA_USER_JWT). Login works for pre-existing
    // users too, which handles re-runs cleanly.
    try {
      const loginResp = await api.loginUnderApp(
        profile.appToken,
        user.email,
        user.password
      );
      user.jwt = loginResp.token;
    } catch {
      // Leave jwt empty — sample will fall back to email/password login.
    }

    created.push(user);
  }

  // Save test users in profile
  profile.testUsers = created;
  const store = loadProfiles();
  store.profiles[profile.name] = profile;
  saveProfiles(store);
  p.log.success(`Test users saved to profile ${pc.green(profile.name)}`);
}

/**
 * Check if a local SDK clone is behind its remote and offer to update.
 */
async function checkSdkUpdate(dir: string, name: string): Promise<void> {
  if (!existsSync(join(dir, ".git"))) return;

  const spinner = p.spinner();
  spinner.start("Checking for SDK updates...");
  try {
    execSync(`git -C ${JSON.stringify(dir)} fetch origin`, {
      stdio: "pipe",
      timeout: 15000,
    });

    const local = execSync(`git -C ${JSON.stringify(dir)} rev-parse HEAD`, {
      encoding: "utf-8",
    }).trim();

    // Detect default branch (main or master)
    let remoteBranch = "origin/main";
    try {
      execSync(`git -C ${JSON.stringify(dir)} rev-parse origin/main`, {
        stdio: "pipe",
      });
    } catch {
      remoteBranch = "origin/master";
    }

    const remote = execSync(
      `git -C ${JSON.stringify(dir)} rev-parse ${remoteBranch}`,
      { encoding: "utf-8" }
    ).trim();

    if (local === remote) {
      spinner.stop(`${pc.green(name)} is up to date`);
      return;
    }

    const behind = execSync(
      `git -C ${JSON.stringify(dir)} rev-list --count HEAD..${remoteBranch}`,
      { encoding: "utf-8" }
    ).trim();

    spinner.stop(
      `${pc.yellow(name)} is ${pc.bold(behind)} commit(s) behind remote`
    );

    const update = await p.confirm({
      message: `Update ${name} to latest version?`,
      initialValue: true,
    });
    if (p.isCancel(update) || !update) return;

    const pullSpinner = p.spinner();
    pullSpinner.start("Updating...");
    try {
      // Reset to remote HEAD — handles local modifications, deleted files,
      // and diverged history (e.g. after force-push)
      execSync(`git -C ${JSON.stringify(dir)} reset --hard ${remoteBranch}`, {
        stdio: "pipe",
      });
      pullSpinner.stop(`${pc.green(name)} updated to latest`);
    } catch {
      pullSpinner.stop("Update failed");
      p.log.warn(
        "Run " + pc.cyan(`git -C ${dir} pull`) + " manually."
      );
    }
  } catch {
    spinner.stop(pc.dim("Could not check for updates (offline?)"));
  }
}

const SDK_REPOS: Record<SdkTarget, { repo: string; name: string; branch?: string }> = {
  // TEMPORARY: pin to the PR branch that wires the sample's Setup-tab
  // defaults to BuildConfig (https://github.com/dappros/ethora-sample-android/pull/1).
  // Without this branch, the .env keys we write here (ETHORA_APP_TOKEN /
  // USER_EMAIL / USER_PASSWORD) are read but ignored — the sample's
  // PlaygroundSessionState still hardcodes BASE app ID + dev-team email/
  // password defaults. Drop the `branch` field once PR #1 lands on main.
  android: {
    repo: "https://github.com/dappros/ethora-sample-android.git",
    name: "ethora-sample-android",
    branch: "tf/setup-integration-and-ux-fixes",
  },
  swift: { repo: "https://github.com/dappros/ethora-sample-swift.git", name: "ethora-sample-swift" },
  reactjs: { repo: "https://github.com/dappros/ethora-chat-component.git", name: "ethora-chat-component" },
  reactnative: { repo: "https://github.com/dappros/ethora-chat-component-rn.git", name: "ethora-chat-component-rn" },
  wordpress: { repo: "https://github.com/dappros/ethora-wp-plugin.git", name: "ethora-wp-plugin" },
};

/** URL for the Swift SDK package, needed as a sibling clone next to the sample. */
const SWIFT_SDK_REPO_URL = "https://github.com/dappros/ethora-sdk-swift.git";
const SWIFT_SDK_SIBLING_NAME = "ethora-sdk-swift";

/**
 * Resolve the user's Android SDK location, checking ANDROID_HOME /
 * ANDROID_SDK_ROOT env vars first, then falling back to the per-OS
 * default install path. Returns null when nothing is found.
 */
function resolveAndroidHome(): string | null {
  const fromEnv = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;

  const home = homedir();
  const candidates: string[] = [];
  switch (osPlatform()) {
    case "darwin":
      candidates.push(join(home, "Library", "Android", "sdk"));
      break;
    case "linux":
      candidates.push(join(home, "Android", "Sdk"));
      break;
    case "win32": {
      const localAppData = process.env.LOCALAPPDATA;
      if (localAppData) candidates.push(join(localAppData, "Android", "Sdk"));
      break;
    }
  }
  return candidates.find((c) => existsSync(c)) ?? null;
}

/**
 * Read the `compileSdk` value from a cloned ethora-sample-android's
 * `gradle/libs.versions.toml`. Returns null if the file isn't present
 * or the value can't be parsed.
 */
function readCompileSdkFromSample(sampleDir: string): string | null {
  const tomlPath = join(sampleDir, "gradle", "libs.versions.toml");
  if (!existsSync(tomlPath)) return null;
  try {
    const toml = readFileSync(tomlPath, "utf-8");
    const m = toml.match(/^\s*compileSdk\s*=\s*"?(\d+)"?/m);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/**
 * Detect a known cause of opaque first-build failures: the sample's
 * `compileSdk` API level isn't installed in the user's Android SDK.
 * Without it, AGP fails sync with
 *   "Could not isolate parameters of artifact transform
 *    D8BackportedMethodsGenerator … no value available"
 * which is hard to read as "missing platform SDK" — surface a clear
 * warning before the developer hits Sync in Android Studio.
 *
 * Best-effort and non-fatal: missing tooling just skips the check.
 */
function checkAndroidPlatformSdkInstalled(sampleDir: string): void {
  const required = readCompileSdkFromSample(sampleDir);
  if (!required) return;

  const androidHome = resolveAndroidHome();

  if (!androidHome) {
    p.log.warn(
      `Android SDK location not found. Set ${pc.cyan("ANDROID_HOME")} or install Android Studio.`
    );
    p.log.message(
      `  The sample compiles against ${pc.cyan(`platforms;android-${required}`)}; without an Android SDK present`
    );
    p.log.message(
      `  Gradle sync will fail with an opaque ${pc.dim('"D8BackportedMethodsGenerator … no value available"')} error.`
    );
    return;
  }

  const platformDir = join(androidHome, "platforms", `android-${required}`);
  if (existsSync(platformDir)) return; // happy path

  // Show the developer which platforms ARE installed, so the gap is obvious
  let installedNote = "";
  let minorRevisionPresent: string | null = null;
  try {
    const platformsDir = join(androidHome, "platforms");
    if (existsSync(platformsDir)) {
      const installed = readdirSync(platformsDir)
        .filter((n) => n.startsWith("android-"))
        .map((n) => n.replace(/^android-/, ""))
        .sort((a, b) => {
          // Numeric versions (incl. minor revisions like "37.0") sorted
          // highest-first; non-numeric (preview names like
          // "CinnamonBun") fall to the end alphabetically.
          const na = Number(a);
          const nb = Number(b);
          if (Number.isNaN(na) && Number.isNaN(nb)) return a.localeCompare(b);
          if (Number.isNaN(na)) return 1;
          if (Number.isNaN(nb)) return -1;
          return nb - na;
        });
      if (installed.length) {
        installedNote = ` (installed: ${installed.slice(0, 5).join(", ")}${installed.length > 5 ? "…" : ""})`;
      }
      // The exact case Taras hit: cmdline-tools installed
      // `android-${required}.0` (a minor revision) but Gradle's
      // `compileSdk = ${required}` resolves to plain `android-${required}`.
      // Surface this hint explicitly so the developer knows they don't
      // need a fresh install — just the matching base entry.
      minorRevisionPresent =
        installed.find((v) => v.startsWith(`${required}.`)) ?? null;
    }
  } catch {
    /* ignore */
  }

  p.log.warn(
    `Android Platform SDK ${pc.bold(required)} is not installed${installedNote}.`
  );
  p.log.message(
    `  The cloned sample's ${pc.cyan("gradle/libs.versions.toml")} pins ${pc.cyan(`compileSdk = "${required}"`)}.`
  );
  p.log.message(
    `  Without ${pc.cyan(`platforms;android-${required}`)} installed, Android Studio's Gradle sync will fail with`
  );
  p.log.message(
    `  the opaque error: ${pc.dim('"Could not isolate parameters of artifact transform D8BackportedMethodsGenerator"')}.`
  );

  if (minorRevisionPresent) {
    p.log.message("");
    p.log.message(
      `  ${pc.yellow("Note:")} you have ${pc.cyan(`android-${minorRevisionPresent}`)} installed, but Gradle's`
    );
    p.log.message(
      `  ${pc.cyan(`compileSdk = ${required}`)} maps to ${pc.cyan(`android-${required}`)} (the base entry, no minor suffix).`
    );
    p.log.message(
      `  In SDK Manager, tick ${pc.bold("Show Package Details")} to see the base ${pc.cyan(`Android API ${required}`)} entry`
    );
    p.log.message(`  separately from minor revisions.`);
  }

  p.log.message("");
  p.log.message(pc.bold("  Install before opening in Android Studio:"));
  p.log.message(
    `    Android Studio → Tools → SDK Manager → SDK Platforms → tick ${pc.cyan(`API ${required}`)} → Apply`
  );
  p.log.message(`  Or via command line:`);
  p.log.message(
    `    ${pc.cyan(`sdkmanager "platforms;android-${required}"`)}`
  );
}

/**
 * When cloning `ethora-sample-swift`, the sample's `project.yml` references
 * the EthoraSDK Swift package at `path: ../..` — a path that made sense
 * while SDKPlayground lived inside `ethora-sdk-swift/Examples/`, but no
 * longer resolves to a `Package.swift` now that the sample is a standalone
 * repo. Cloning `ethora-sdk-swift` as a sibling (and patching `project.yml`
 * to `../ethora-sdk-swift`, handled in config-generators.ts) gives the
 * developer a working XcodeGen-ready layout.
 */
async function ensureSwiftSdkSibling(sampleDir: string): Promise<boolean> {
  const { dirname, resolve, isAbsolute } = await import("node:path");
  const absSample = isAbsolute(sampleDir) ? sampleDir : resolve(sampleDir);
  const siblingDir = join(dirname(absSample), SWIFT_SDK_SIBLING_NAME);

  if (existsSync(join(siblingDir, "Package.swift"))) {
    p.log.info(`Found existing ${pc.cyan(SWIFT_SDK_SIBLING_NAME)} next to the sample.`);
    return true;
  }

  const spinner = p.spinner();
  spinner.start(`Cloning ${SWIFT_SDK_SIBLING_NAME} alongside the sample...`);
  try {
    execSync(`git clone ${SWIFT_SDK_REPO_URL} ${JSON.stringify(siblingDir)}`, { stdio: "pipe" });
    spinner.stop(`${pc.green(SWIFT_SDK_SIBLING_NAME)} cloned at ${pc.cyan(siblingDir)}`);
    return true;
  } catch (err: any) {
    spinner.stop(`Could not clone ${SWIFT_SDK_SIBLING_NAME}`);
    p.log.warn(
      `Clone of ${SWIFT_SDK_SIBLING_NAME} failed: ${err?.message || "unknown"}.\n` +
      `You'll need to clone it manually as a sibling of ${pc.cyan(absSample)} and update project.yml's EthoraSDK path.`
    );
    return false;
  }
}

async function askGenerateConfig(profile: Profile) {
  const generate = await p.confirm({
    message: "Generate SDK config files now?",
  });
  if (p.isCancel(generate) || !generate) return;

  const target = await p.select({
    message: "Which SDK?",
    options: [
      { value: "android", label: "Android (Kotlin/Compose)", hint: "github.com/dappros/ethora-sdk-android" },
      { value: "swift", label: "iOS (Swift)", hint: "github.com/dappros/ethora-sdk-swift" },
      { value: "reactjs", label: "React.js (Web)", hint: "github.com/dappros/ethora-chat-component" },
      { value: "reactnative", label: "React Native", hint: "github.com/dappros/ethora-chat-component-rn" },
      { value: "wordpress", label: "WordPress", hint: "github.com/dappros/ethora-wp-plugin" },
    ],
  });
  if (p.isCancel(target)) return;

  const sdkTarget = target as SdkTarget;
  const sdkInfo = SDK_REPOS[sdkTarget];

  // Preview config
  const preview = showConfigPreview(profile, sdkTarget);
  p.log.message(pc.dim("Config preview:"));
  p.log.message(pc.dim(preview));

  // Help user get the SDK and choose output directory
  const lastPath = getSdkPath(sdkTarget);
  const outputOptions = [
    {
      value: "clone",
      label: `Clone ${sdkInfo.name} and write config into it`,
      hint: "recommended if you don't have the SDK yet",
    },
    ...(lastPath
      ? [{
          value: "last",
          label: `Previous path: ${lastPath}`,
          hint: "used last time for this SDK",
        }]
      : []),
    {
      value: "cwd",
      label: "Current directory (.)",
      hint: process.cwd(),
    },
    {
      value: "custom",
      label: "Specify a path",
      hint: "e.g. path to your existing SDK checkout",
    },
  ];
  const outputChoice = await p.select({
    message: "Where should we write the config files?",
    options: outputOptions,
  });
  if (p.isCancel(outputChoice)) return;

  let outputDir: string;

  if (outputChoice === "clone") {
    const cloneDir = await p.text({
      message: "Clone into directory:",
      defaultValue: sdkInfo.name,
      placeholder: sdkInfo.name,
    });
    if (p.isCancel(cloneDir)) return;

    // Check if dir already has the right SDK project
    if (isSdkProject(cloneDir, sdkTarget)) {
      p.log.info(`Directory ${pc.cyan(cloneDir)} already contains ${sdkInfo.name}, writing config into it.`);
    } else {
      // Remove leftover .git dir if present (empty repo / cleared directory)
      if (existsSync(join(cloneDir, ".git"))) {
        p.log.info(`Directory ${pc.cyan(cloneDir)} has .git but no project files — re-cloning.`);
        execSync(`rm -rf ${JSON.stringify(cloneDir)}`, { stdio: "pipe" });
      }
      const spinner = p.spinner();
      spinner.start(`Cloning ${sdkInfo.name}...`);
      try {
        const branchFlag = sdkInfo.branch ? ` -b ${sdkInfo.branch}` : "";
        execSync(`git clone${branchFlag} ${sdkInfo.repo} ${cloneDir}`, { stdio: "pipe" });
        spinner.stop(`Cloned ${pc.green(sdkInfo.name)} into ${pc.cyan(cloneDir)}`);
      } catch (err: any) {
        spinner.stop("Clone failed");
        p.log.error(`Git clone error: ${err.message}`);
        p.log.info("You can clone manually and re-run with 'Generate config files'.");
        return;
      }
    }

    outputDir = cloneDir;

    // Swift sample needs ethora-sdk-swift as a sibling (its project.yml
    // references the EthoraSDK package via a relative `../..` path that
    // doesn't resolve in the standalone sample repo).
    if (sdkTarget === "swift") {
      await ensureSwiftSdkSibling(cloneDir);
    }
  } else if (outputChoice === "last") {
    outputDir = lastPath!;
  } else if (outputChoice === "cwd") {
    outputDir = ".";
  } else {
    const customPath = await p.text({
      message: "Output path (absolute or relative):",
      placeholder: lastPath || `/path/to/${sdkInfo.name}`,
    });
    if (p.isCancel(customPath)) return;
    outputDir = customPath;
  }

  // If the SDK already exists, check if it's up to date
  if (outputChoice !== "clone" && isSdkProject(outputDir, sdkTarget) && getAutoUpdate()) {
    await checkSdkUpdate(outputDir, sdkInfo.name);
  }

  // If the target dir doesn't look like the right SDK project, offer to clone into it
  if (outputChoice !== "clone" && !isSdkProject(outputDir, sdkTarget)) {
    const shouldClone = await p.confirm({
      message: `No ${sdkInfo.name} found at ${pc.cyan(outputDir)}. Clone it there?`,
      initialValue: true,
    });
    if (p.isCancel(shouldClone)) return;

    if (shouldClone) {
      // Remove leftover .git / hidden files if present (empty dir)
      if (existsSync(join(outputDir, ".git")) && !isSdkProject(outputDir, sdkTarget)) {
        execSync(`rm -rf ${JSON.stringify(outputDir)}`, { stdio: "pipe" });
      }
      const spinner = p.spinner();
      spinner.start(`Cloning ${sdkInfo.name}...`);
      try {
        const branchFlag = sdkInfo.branch ? ` -b ${sdkInfo.branch}` : "";
        execSync(`git clone${branchFlag} ${sdkInfo.repo} ${outputDir}`, { stdio: "pipe" });
        spinner.stop(`Cloned ${pc.green(sdkInfo.name)} into ${pc.cyan(outputDir)}`);
      } catch (err: any) {
        spinner.stop("Clone failed");
        p.log.error(`Git clone error: ${err.message}`);
        return;
      }

      if (sdkTarget === "swift") {
        await ensureSwiftSdkSibling(outputDir);
      }
    }
  }

  try {
    const written = generateConfig(profile, sdkTarget, outputDir);
    for (const f of written) {
      p.log.success(`Written: ${pc.cyan(f)}`);
    }

    // Remember this path for next time
    setSdkPath(sdkTarget, resolvePath(outputDir));

    // Pre-flight check for Android: warn loudly if the platform-SDK the
    // sample compiles against isn't installed locally. Catches the
    // opaque "D8BackportedMethodsGenerator … no value available" sync
    // failure before the developer hits it in Android Studio.
    if (sdkTarget === "android") {
      checkAndroidPlatformSdkInstalled(resolvePath(outputDir));
    }

    // Post-setup summary
    p.log.message("");
    p.log.message(pc.bgGreen(pc.black(` Your app "${profile.displayName}" is ready! `)));
    p.log.message("");

    if (profile.testUsers && profile.testUsers.length > 0) {
      p.log.message(pc.bold("Test accounts:"));
      for (const u of profile.testUsers) {
        p.log.message(`  ${pc.cyan(u.username)}: ${u.email} / ${u.password}`);
      }
      p.log.message("");
    }

    p.log.message(pc.bold("Next steps:"));
    if (sdkTarget === "android") {
      p.log.message(`  1. Open ${pc.cyan(outputDir)} in Android Studio`);
      p.log.message(`  2. Run on emulator (API 26+)`);
      if (profile.testUsers && profile.testUsers.length > 0) {
        p.log.message(`  3. Log in with ${pc.cyan(profile.testUsers[0].email)} (pre-filled)`);
        if (profile.testUsers.length > 1) {
          p.log.message(`  4. Run a second emulator and log in as ${pc.cyan(profile.testUsers[1].email)} to test chat`);
        }
      } else {
        p.log.message(`  3. Create an account in the app to log in`);
      }
    } else if (sdkTarget === "swift") {
      // ethora-sample-swift is the default Swift target. The SDK-only path
      // (EthoraConfig.swift standalone) lands in a SPM package root with no
      // runnable target — handled in the `else` branch.
      const isSampleClone = existsSync(join(outputDir, "SDKPlayground.xcodeproj"))
                         || existsSync(join(outputDir, "SDKPlayground"));
      if (isSampleClone) {
        p.log.message(`  1. cd ${pc.cyan(outputDir)}`);
        p.log.message(`  2. Run ${pc.cyan("./generate_xcodeproj.sh")} (needs xcodegen — ${pc.dim("brew install xcodegen")})`);
        p.log.message(`  3. Run ${pc.cyan("open SDKPlayground.xcodeproj")} and launch the SDKPlayground scheme on a simulator`);
        if (profile.testUsers && profile.testUsers.length > 0) {
          p.log.message(`  4. On the Setup tab, form is pre-filled with ${pc.cyan(profile.testUsers[0].email)} — tap Connect`);
        } else {
          p.log.message(`  4. On the Setup tab, fill in email / password (or paste a user JWT) — tap Connect`);
        }
      } else {
        p.log.message(`  1. Copy ${pc.cyan("EthoraConfig.swift")} into your Xcode project`);
        p.log.message(`  2. Reference its constants from your SDK integration code`);
      }
    } else if (sdkTarget === "reactjs") {
      // ethora-chat-component is a Vite project; the dev script is `npm
      // run dev`, not `npm start` (no `start` lifecycle script exists).
      p.log.message(`  1. cd ${pc.cyan(outputDir)} && npm install`);
      p.log.message(`  2. npm run dev   ${pc.dim("# starts the Vite dev server")}`);
    } else if (sdkTarget === "reactnative") {
      const isChatComponentRn = isReactNativeChatComponent(outputDir);
      p.log.message(`  1. cd ${pc.cyan(outputDir)} && npm install`);
      if (isChatComponentRn) {
        p.log.message(`  2. ${pc.cyan("npm run ios")} ${pc.dim("# or  npm run android")}`);
        if (profile.testUsers && profile.testUsers.length > 0) {
          p.log.message(`  3. On the Setup tab, form is pre-filled with ${pc.cyan(profile.testUsers[0].email)} — tap Test then Save`);
        } else {
          p.log.message(`  3. On the Setup tab, paste a user JWT (endpoints + app token are pre-filled) — tap Test then Save`);
        }
      } else {
        p.log.message(`  2. ${pc.cyan("npm start")} ${pc.dim("# starts the Metro bundler")}`);
        p.log.message(`  3. ${pc.cyan("npx react-native run-ios")} or ${pc.cyan("npx react-native run-android")}`);
      }
    }
    p.log.message("");
  } catch (err: any) {
    p.log.error(`Failed to write config: ${err.message}`);
  }
}

async function generateForProfile() {
  const profile = getActiveProfile();
  if (!profile) {
    p.log.error("No active profile. Create one first.");
    return;
  }
  p.log.info(
    `Active profile: ${pc.green(profile.name)} (${profile.type}, app: ${profile.displayName})`
  );
  await askGenerateConfig(profile);
}

async function switchProfile(names: string[], active: string | null) {
  if (names.length === 0) {
    p.log.error("No profiles. Create one first.");
    return;
  }

  const choice = await p.select({
    message: "Switch to:",
    options: names.map((n) => ({
      value: n,
      label: n === active ? `${n} ${pc.green("(active)")}` : n,
    })),
  });
  if (p.isCancel(choice)) return handleCancel();

  setActiveProfile(choice);
  p.log.success(`Active profile: ${pc.green(choice)}`);
}

function listProfiles() {
  const store = loadProfiles();
  const names = Object.keys(store.profiles);
  if (names.length === 0) {
    p.log.info("No profiles.");
    return;
  }

  for (const name of names) {
    const prof = store.profiles[name];
    const marker = name === store.activeProfile ? pc.green(" *") : "";
    p.log.info(
      `${pc.bold(name)}${marker} — ${prof.type} | ${prof.displayName} | ${prof.email}`
    );
  }
}

async function removeProfile(names: string[]) {
  if (names.length === 0) {
    p.log.info("No profiles to delete.");
    return;
  }

  const choice = await p.select({
    message: "Delete which profile?",
    options: names.map((n) => ({ value: n, label: n })),
  });
  if (p.isCancel(choice)) return handleCancel();

  const confirm = await p.confirm({
    message: `Delete profile "${choice}"? This cannot be undone.`,
  });
  if (p.isCancel(confirm) || !confirm) return;

  deleteProfile(choice);
  p.log.success(`Deleted profile ${choice}`);
}

function validateEmail(value: string): string | undefined {
  if (!value.includes("@")) return "Please enter a valid email";
  return undefined;
}

function handleCancel(): never {
  p.cancel("Setup cancelled.");
  process.exit(0);
}

main().catch((err) => {
  p.log.error(err.message);
  process.exit(1);
});
