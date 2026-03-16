#!/usr/bin/env node

import * as p from "@clack/prompts";
import pc from "picocolors";
import { EthoraAPI, CLOUD_ENDPOINTS, type ServerEndpoints, type AppInfo } from "./api.js";
import {
  addProfile,
  loadProfiles,
  setActiveProfile,
  getActiveProfile,
  deleteProfile,
  type Profile,
} from "./profiles.js";
import {
  generateConfig,
  showConfigPreview,
  type SdkTarget,
} from "./config-generators.js";

async function main() {
  p.intro(pc.bgCyan(pc.black(" Ethora SDK Setup ")));

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
  const serverType = await p.select({
    message: "Server type:",
    options: [
      {
        value: "cloud",
        label: "Cloud (Ethora hosted)",
        hint: "free account, fastest setup",
      },
      {
        value: "self-hosted",
        label: "Self-hosted",
        hint: "your own server endpoints",
      },
    ],
  });
  if (p.isCancel(serverType)) return handleCancel();

  if (serverType === "cloud") {
    await createCloudProfile();
  } else {
    await createSelfHostedProfile();
  }
}

async function createCloudProfile() {
  const endpoints = CLOUD_ENDPOINTS;
  const api = new EthoraAPI(endpoints.apiUrl);

  // Step 0: Bootstrap — get the base app token from the server
  const spinner = p.spinner();
  spinner.start("Connecting to server...");
  try {
    await api.getBaseAppConfig("ethora");
    spinner.stop("Connected to Ethora Cloud");
  } catch (err: any) {
    spinner.stop("Connection failed");
    const msg = err?.response?.data?.error || err?.message || "Unknown error";
    p.log.error(`Could not connect to server: ${msg}`);
    p.log.info(`API: ${endpoints.apiUrl}`);
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
    message: "Profile name:",
    defaultValue: `cloud-${appInfo.domainName || appInfo.displayName.toLowerCase().replace(/\s+/g, "-")}`,
    placeholder: "cloud-myapp",
  });
  if (p.isCancel(profileName)) return handleCancel();

  const webAppUrl = appInfo.domainName
    ? `https://${appInfo.domainName}.ethora.com`
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

  // Ask about config generation
  await askGenerateConfig(profile);
}

async function createSelfHostedProfile() {
  p.log.info("Enter your self-hosted server endpoints.");

  const serverFields = await p.group({
    apiUrl: () =>
      p.text({
        message: "API base URL:",
        placeholder: "https://api.myserver.com",
      }),
    xmppHost: () =>
      p.text({
        message: "XMPP host:",
        placeholder: "xmpp.myserver.com",
      }),
  });
  if (p.isCancel(serverFields)) return handleCancel();

  // Derive XMPP endpoints from host (user can override)
  const xmppHost = serverFields.xmppHost;
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
    placeholder: "ethora",
    defaultValue: "ethora",
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

async function askGenerateConfig(profile: Profile) {
  const generate = await p.confirm({
    message: "Generate SDK config files now?",
  });
  if (p.isCancel(generate) || !generate) return;

  const target = await p.select({
    message: "Which SDK?",
    options: [
      { value: "android", label: "Android (Kotlin/Compose)" },
      { value: "swift", label: "iOS (Swift)" },
      { value: "reactjs", label: "React.js (Web)" },
      { value: "reactnative", label: "React Native" },
      { value: "wordpress", label: "WordPress" },
    ],
  });
  if (p.isCancel(target)) return;

  // Preview
  const preview = showConfigPreview(profile, target as SdkTarget);
  p.log.message(pc.dim("Preview:"));
  p.log.message(pc.dim(preview));

  const outputDir = await p.text({
    message: "Output directory:",
    defaultValue: ".",
    placeholder: ".",
  });
  if (p.isCancel(outputDir)) return;

  try {
    const written = generateConfig(
      profile,
      target as SdkTarget,
      outputDir
    );
    for (const f of written) {
      p.log.success(`Written: ${pc.cyan(f)}`);
    }
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
