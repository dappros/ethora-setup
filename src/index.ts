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
        label: "Cloud (app.ethora.com)",
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

  const hasAccount = await p.select({
    message: "Do you have an Ethora Cloud account?",
    options: [
      { value: "login", label: "Yes, I have an account" },
      { value: "register", label: "No, create one for me" },
    ],
  });
  if (p.isCancel(hasAccount)) return handleCancel();

  let email: string;

  if (hasAccount === "register") {
    const regFields = await p.group({
      email: () =>
        p.text({ message: "Email:", validate: validateEmail }),
      firstName: () => p.text({ message: "First name:" }),
      lastName: () => p.text({ message: "Last name:" }),
    });
    if (p.isCancel(regFields)) return handleCancel();

    const spinner = p.spinner();
    spinner.start("Creating account...");
    try {
      await api.register(
        regFields.email,
        regFields.firstName,
        regFields.lastName
      );
      spinner.stop("Account created!");
      p.log.info(
        `Check ${pc.cyan(regFields.email)} for a verification email, then set your password.`
      );

      await p.text({
        message: "Press Enter once you've verified your email and set a password...",
        defaultValue: "",
      });
      email = regFields.email;
    } catch (err: any) {
      const msg =
        err?.response?.data?.error || err?.response?.data?.message || err.message;
      spinner.stop("Registration failed");
      p.log.error(`Registration error: ${msg}`);
      return;
    }
  } else {
    const emailResult = await p.text({
      message: "Email:",
      validate: validateEmail,
    });
    if (p.isCancel(emailResult)) return handleCancel();
    email = emailResult;
  }

  // Login
  const password = await p.password({ message: "Password:" });
  if (p.isCancel(password)) return handleCancel();

  const spinner = p.spinner();
  spinner.start("Logging in...");
  let loginResult;
  try {
    loginResult = await api.login(email, password);
    spinner.stop(`Logged in as ${pc.green(loginResult.user.firstName + " " + loginResult.user.lastName)}`);
  } catch (err: any) {
    spinner.stop("Login failed");
    const msg = err?.response?.data?.error || err?.response?.data?.message || err.message;
    p.log.error(`Login error: ${msg}`);
    return;
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
        ...apps.map((a: any) => ({
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
      appInfo = apps.find((a: any) => a._id === appChoice);
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
  const fields = await p.group({
    apiUrl: () =>
      p.text({
        message: "API endpoint URL:",
        placeholder: "https://api.myserver.com/v1",
      }),
    xmppWebSocket: () =>
      p.text({
        message: "XMPP WebSocket URL:",
        placeholder: "wss://xmpp.myserver.com:5443/ws",
      }),
    xmppHost: () =>
      p.text({
        message: "XMPP host:",
        placeholder: "xmpp.myserver.com",
      }),
    xmppConference: () =>
      p.text({
        message: "XMPP conference domain:",
        placeholder: "conference.xmpp.myserver.com",
      }),
    appId: () => p.text({ message: "App ID:" }),
    appToken: () => p.text({ message: "App Token (JWT):" }),
    email: () => p.text({ message: "Your email (for reference):" }),
    profileName: () =>
      p.text({
        message: "Profile name:",
        placeholder: "self-hosted-prod",
      }),
  });
  if (p.isCancel(fields)) return handleCancel();

  const endpoints: ServerEndpoints = {
    apiUrl: fields.apiUrl,
    xmppWebSocket: fields.xmppWebSocket,
    xmppHost: fields.xmppHost,
    xmppConference: fields.xmppConference,
  };

  const profile: Profile = {
    name: fields.profileName,
    type: "self-hosted",
    endpoints,
    appId: fields.appId,
    appToken: fields.appToken,
    displayName: fields.profileName,
    email: fields.email,
  };

  addProfile(profile);
  p.log.success(`Profile ${pc.green(fields.profileName)} saved!`);

  await askGenerateConfig(profile);
}

async function createNewApp(api: EthoraAPI) {
  const appName = await p.text({
    message: "App display name:",
    placeholder: "My Chat App",
  });
  if (p.isCancel(appName)) return handleCancel();

  const spinner = p.spinner();
  spinner.start("Creating app...");
  try {
    const app = await api.createApp(appName);
    spinner.stop(`App ${pc.green(app.displayName)} created!`);
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
