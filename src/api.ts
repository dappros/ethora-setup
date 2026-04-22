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
  /** Domain suffix for web app URLs, e.g. "chat.ethora.com" → myapp.chat.ethora.com */
  webDomain: string | null;
}

// Cloud QA — pre-production environment for release validation
export const CLOUD_QA: ServerPreset = {
  label: "Cloud QA (chat-qa.ethora.com)",
  hint: "chat-qa.ethora.com — pre-production QA, useful for testing release candidates",
  endpoints: {
    apiUrl: "https://api.chat-qa.ethora.com/v1",
    xmppWebSocket: "wss://xmpp.chat-qa.ethora.com:5443/ws",
    xmppBosh: "https://xmpp.chat-qa.ethora.com:5443/bosh",
    xmppHost: "xmpp.chat-qa.ethora.com",
    xmppConference: "conference.xmpp.chat-qa.ethora.com",
  },
  baseDomain: "ethora-qa",
  webDomain: "chat-qa.ethora.com",
};

// Cloud Production — chat.ethora.com (canonical Ethora Cloud)
export const CLOUD_PROD: ServerPreset = {
  label: "Cloud Production (chat.ethora.com)",
  hint: "api.chat.ethora.com — canonical production endpoint, recommended default",
  endpoints: {
    apiUrl: "https://api.chat.ethora.com/v1",
    xmppWebSocket: "wss://xmpp.chat.ethora.com:5443/ws",
    xmppBosh: "https://xmpp.chat.ethora.com:5443/bosh",
    xmppHost: "xmpp.chat.ethora.com",
    xmppConference: "conference.xmpp.chat.ethora.com",
  },
  baseDomain: "ethora",
  webDomain: "chat.ethora.com",
};

export const SERVER_PRESETS: ServerPreset[] = [CLOUD_PROD, CLOUD_QA];

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
   * Register a user under a specific app (using the app's own JWT).
   * Used for creating test users like Alice and Bob.
   */
  async registerUnderApp(
    appToken: string,
    email: string,
    firstName: string,
    lastName: string,
    password: string
  ): Promise<void> {
    await this.client.post(
      "/v2/users/sign-up-with-email",
      { email, firstName, lastName, password },
      { headers: { Authorization: appToken } }
    );
  }

  /**
   * Login a user under a specific app (using the app's own JWT).
   * Mirrors registerUnderApp — logging in against the app's scope returns
   * a JWT signed for that app, suitable for ETHORA_USER_JWT in sample apps.
   */
  async loginUnderApp(
    appToken: string,
    email: string,
    password: string
  ): Promise<LoginResult> {
    const resp = await this.client.post(
      "/v2/users/login-with-email",
      { email, password },
      { headers: { Authorization: appToken } }
    );
    return resp.data;
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
