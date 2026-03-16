import axios, { type AxiosInstance } from "axios";

export interface ServerEndpoints {
  apiUrl: string;
  xmppWebSocket: string;
  xmppBosh: string;
  xmppHost: string;
  xmppConference: string;
}

export interface ServerPreset {
  label: string;
  hint: string;
  endpoints: ServerEndpoints;
  baseDomain: string;
  /** Domain suffix for web app URLs, e.g. "ethora.com" → myapp.ethora.com */
  webDomain: string | null;
}

// Cloud QA — latest monoserver version, recommended for development
export const CLOUD_QA: ServerPreset = {
  label: "Cloud QA (latest)",
  hint: "api.messenger-dev.asterotoken.com — latest server version",
  endpoints: {
    apiUrl: "https://api.messenger-dev.asterotoken.com",
    xmppWebSocket: "wss://xmpp.messenger-dev.asterotoken.com/ws",
    xmppBosh: "https://xmpp.messenger-dev.asterotoken.com/bosh",
    xmppHost: "xmpp.messenger-dev.asterotoken.com",
    xmppConference: "conference.xmpp.messenger-dev.asterotoken.com",
  },
  baseDomain: "messenger-dev",
  webDomain: "messenger-dev.asterotoken.com",
};

// Cloud Production — ethora.com (legacy version, will be upgraded)
export const CLOUD_PROD: ServerPreset = {
  label: "Cloud Production (ethora.com)",
  hint: "api.ethoradev.com — stable, legacy version",
  endpoints: {
    apiUrl: "https://api.ethoradev.com/v1",
    xmppWebSocket: "wss://xmpp.ethoradev.com:5443/ws",
    xmppBosh: "https://xmpp.ethoradev.com:5443/bosh",
    xmppHost: "xmpp.ethoradev.com",
    xmppConference: "conference.xmpp.ethoradev.com",
  },
  baseDomain: "ethora",
  webDomain: "ethora.com",
};

export const SERVER_PRESETS: ServerPreset[] = [CLOUD_QA, CLOUD_PROD];

export interface AppInfo {
  _id: string;
  displayName: string;
  domainName: string;
  appToken: string;
  appSecret: string;
}

export interface LoginResult {
  token: string;
  refreshToken: string;
  wsToken?: string;
  user: {
    _id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
}

export interface BaseAppConfig {
  _id: string;
  displayName: string;
  domainName: string;
  appToken: string;
}

export class EthoraAPI {
  private client: AxiosInstance;
  private baseUrl: string;
  private appJwt: string | null = null;
  private userToken: string | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
    this.client = axios.create({ baseURL: baseUrl });
  }

  /**
   * Step 0: Bootstrap — resolve the base app token from the server.
   * Uses GET /v1/apps/get-config?domainName=<name>
   * The base app has isAllowedNewAppCreate=true, so users created
   * under it can create their own apps.
   */
  async getBaseAppConfig(domainName: string): Promise<BaseAppConfig> {
    const resp = await this.client.get("/v1/apps/get-config", {
      params: { domainName },
    });
    const app = resp.data.result || resp.data;
    this.appJwt = app.appToken;
    return app;
  }

  /** Set the base app JWT directly (e.g. if already known). */
  setAppJwt(jwt: string): void {
    this.appJwt = jwt;
  }

  /**
   * Step 1: Register a new user (v2 — modern flow, password set immediately).
   * No email confirmation / temp-password step required.
   */
  async register(
    email: string,
    firstName: string,
    lastName: string,
    password: string
  ): Promise<void> {
    await this.client.post(
      "/v2/users/sign-up-with-email",
      { email, firstName, lastName, password },
      { headers: { Authorization: this.appJwt } }
    );
  }

  /**
   * Step 2: Login (v2).
   */
  async login(email: string, password: string): Promise<LoginResult> {
    const resp = await this.client.post(
      "/v2/users/login-with-email",
      { email, password },
      { headers: { Authorization: this.appJwt } }
    );
    this.userToken = resp.data.token;
    return resp.data;
  }

  /**
   * Step 3: List apps owned by the logged-in user.
   */
  async listApps(): Promise<AppInfo[]> {
    const resp = await this.client.get("/v1/apps/", {
      headers: { Authorization: this.userToken },
    });
    return resp.data.apps || resp.data;
  }

  /**
   * Step 3 (alt): Create a new app.
   * Returns the full app object including appToken and appSecret.
   */
  async createApp(
    displayName: string,
    domainName: string
  ): Promise<AppInfo> {
    const resp = await this.client.post(
      "/v1/apps/",
      {
        displayName,
        domainName,
        usersCanFree: true,
        defaultAccessProfileOpen: true,
        defaultAccessAssetsOpen: true,
      },
      { headers: { Authorization: this.userToken } }
    );
    return resp.data.app || resp.data;
  }
}
