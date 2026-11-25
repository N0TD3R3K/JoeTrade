export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ENVIRONMENT: string;
  ALLOW_LOCAL_DEMO?: string;
  APP_ORIGIN: string;
  JOEAUTH_ISSUER: string;
  JOEAUTH_CLIENT_ID?: string;
  JOEAUTH_APP_ID?: string;
  JOEAUTH_CLIENT_SECRET?: string;
  JOEAUTH_WEBHOOK_SECRET?: string;
  SESSION_SECRET?: string;
}

export interface Customer {
  id: string;
  joe_auth_user_id: string | null;
  display_name: string;
  email: string;
  username: string;
  role: "member" | "operator" | "administrator";
  status: "active" | "frozen" | "suspended" | "closed";
}

export interface Session {
  id: string;
  customer: Customer;
  csrfToken: string;
  accessToken: string | null;
  kind: "demo" | "joeauth";
}
