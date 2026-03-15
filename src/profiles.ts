import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ServerEndpoints } from "./api.js";

const CONFIG_DIR = join(homedir(), ".ethora");
const PROFILES_FILE = join(CONFIG_DIR, "profiles.json");

export interface Profile {
  name: string;
  type: "cloud" | "self-hosted";
  endpoints: ServerEndpoints;
  appId: string;
  appToken: string;
  displayName: string;
  domainName?: string;
  email: string;
  webAppUrl?: string;
}

export interface ProfileStore {
  activeProfile: string | null;
  profiles: Record<string, Profile>;
}

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function loadProfiles(): ProfileStore {
  ensureConfigDir();
  if (!existsSync(PROFILES_FILE)) {
    return { activeProfile: null, profiles: {} };
  }
  const data = readFileSync(PROFILES_FILE, "utf-8");
  return JSON.parse(data);
}

export function saveProfiles(store: ProfileStore): void {
  ensureConfigDir();
  writeFileSync(PROFILES_FILE, JSON.stringify(store, null, 2) + "\n");
}

export function addProfile(profile: Profile): void {
  const store = loadProfiles();
  store.profiles[profile.name] = profile;
  if (!store.activeProfile) {
    store.activeProfile = profile.name;
  }
  saveProfiles(store);
}

export function setActiveProfile(name: string): void {
  const store = loadProfiles();
  if (!store.profiles[name]) {
    throw new Error(`Profile "${name}" not found`);
  }
  store.activeProfile = name;
  saveProfiles(store);
}

export function getActiveProfile(): Profile | null {
  const store = loadProfiles();
  if (!store.activeProfile) return null;
  return store.profiles[store.activeProfile] || null;
}

export function listProfileNames(): string[] {
  const store = loadProfiles();
  return Object.keys(store.profiles);
}

export function deleteProfile(name: string): void {
  const store = loadProfiles();
  delete store.profiles[name];
  if (store.activeProfile === name) {
    const remaining = Object.keys(store.profiles);
    store.activeProfile = remaining.length > 0 ? remaining[0] : null;
  }
  saveProfiles(store);
}
