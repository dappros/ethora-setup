import axios, { type AxiosInstance } from "axios";

const CLOUD_API_URL = "https://api.ethoradev.com/v1";
const CLOUD_APP_JWT =
  "JWT eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJkYXRhIjp7ImlzVXNlckRhdGFFbmNyeXB0ZWQiOmZhbHNlLCJwYXJlbnRBcHBJZCI6bnVsbCwiaXNBbGxvd2VkTmV3QXBwQ3JlYXRlIjp0cnVlLCJpc0Jhc2VBcHAiOnRydWUsIl9pZCI6IjY0NmNjOGRjOTZkNGE0ZGM4ZjdiMmYyZCIsImRpc3BsYXlOYW1lIjoiRXRob3JhIiwiZG9tYWluTmFtZSI6ImV0aG9yYSIsImNyZWF0b3JJZCI6IjY0NmNjOGQzOTZkNGE0ZGM4ZjdiMmYyNSIsInVzZXJzQ2FuRnJlZSI6dHJ1ZSwiZGVmYXVsdEFjY2Vzc0Fzc2V0c09wZW4iOnRydWUsImRlZmF1bHRBY2Nlc3NQcm9maWxlT3BlbiI6dHJ1ZSwiYnVuZGxlSWQiOiJjb20uZXRob3JhIiwicHJpbWFyeUNvbG9yIjoiIzAwM0U5QyIsInNlY29uZGFyeUNvbG9yIjoiIzI3NzVFQSIsImNvaW5TeW1ib2wiOiJFVE8iLCJjb2luTmFtZSI6IkV0aG9yYSBDb2luIiwiUkVBQ1RfQVBQX0ZJUkVCQVNFX0FQSV9LRVkiOiJBSXphU3lEUWRrdnZ4S0t4NC1XcmpMUW9ZZjA4R0ZBUmdpX3FPNGciLCJSRUFDVF9BUFBfRklSRUJBU0VfQVVUSF9ET01BSU4iOiJldGhvcmEtNjY4ZTkuZmlyZWJhc2VhcHAuY29tIiwiUkVBQ1RfQVBQX0ZJUkVCQVNFX1BST0pFQ1RfSUQiOiJldGhvcmEtNjY4ZTkiLCJSRUFDVF9BUFBfRklSRUJBU0VfU1RPUkFHRV9CVUNLRVQiOiJldGhvcmEtNjY4ZTkuYXBwc3BvdC5jb20iLCJSRUFDVF9BUFBfRklSRUJBU0VfTUVTU0FHSU5HX1NFTkRFUl9JRCI6Ijk3MjkzMzQ3MDA1NCIsIlJFQUNUX0FQUF9GSVJFQkFTRV9BUFBfSUQiOiIxOjk3MjkzMzQ3MDA1NDp3ZWI6ZDQ2ODJlNzZlZjAyZmQ5YjljZGFhNyIsIlJFQUNUX0FQUF9GSVJFQkFTRV9NRUFTVVJNRU5UX0lEIjoiRy1XSE03WFJaNEM4IiwiUkVBQ1RfQVBQX1NUUklQRV9QVUJMSVNIQUJMRV9LRVkiOiIiLCJSRUFDVF9BUFBfU1RSSVBFX1NFQ1JFVF9LRVkiOiIiLCJjcmVhdGVkQXQiOiIyMDIzLTA1LTIzVDE0OjA4OjI4LjEzNloiLCJ1cGRhdGVkQXQiOiIyMDIzLTA1LTIzVDE0OjA4OjI4LjEzNloiLCJfX3YiOjB9LCJpYXQiOjE2ODQ4NTA5MjV9.-IqNVMsf8GyS9Z-_yuNW7hpSmejajjAy-W0J8TadRIM";

export interface ServerEndpoints {
  apiUrl: string;
  xmppWebSocket: string;
  xmppHost: string;
  xmppConference: string;
}

export const CLOUD_ENDPOINTS: ServerEndpoints = {
  apiUrl: CLOUD_API_URL,
  xmppWebSocket: "wss://xmpp.ethoradev.com:5443/ws",
  xmppHost: "xmpp.ethoradev.com",
  xmppConference: "conference.xmpp.ethoradev.com",
};

export interface AppInfo {
  _id: string;
  displayName: string;
  domainName: string;
  appToken: string;
}

export interface LoginResult {
  token: string;
  refreshToken: string;
  user: {
    _id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
}

export class EthoraAPI {
  private client: AxiosInstance;
  private appJwt: string;
  private userToken: string | null = null;

  constructor(apiUrl: string, appJwt?: string) {
    this.appJwt = appJwt || CLOUD_APP_JWT;
    this.client = axios.create({ baseURL: apiUrl });
  }

  async register(
    email: string,
    firstName: string,
    lastName: string
  ): Promise<void> {
    await this.client.post(
      "/users/sign-up-with-email/",
      { email, firstName, lastName },
      { headers: { Authorization: this.appJwt } }
    );
  }

  async login(email: string, password: string): Promise<LoginResult> {
    const resp = await this.client.post(
      "/users/login-with-email",
      { email, password },
      { headers: { Authorization: this.appJwt } }
    );
    this.userToken = resp.data.token;
    return resp.data;
  }

  async listApps(): Promise<AppInfo[]> {
    const resp = await this.client.get("/apps/", {
      headers: { Authorization: this.userToken },
    });
    return resp.data.apps || resp.data;
  }

  async createApp(displayName: string): Promise<AppInfo> {
    const resp = await this.client.post(
      "/apps/",
      { displayName },
      { headers: { Authorization: this.userToken } }
    );
    return resp.data.app || resp.data;
  }
}
