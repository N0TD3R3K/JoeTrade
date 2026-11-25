import type { Env } from "../env";
import { HttpError } from "./http";
export class BankError extends HttpError {}
const tokens = new Map<string, { token: string; expires: number }>();
export const connected = (e: Env) => e.BANKING_MODE === "connected";
export async function bank<T>(
  e: Env,
  path: string,
  body?: unknown,
): Promise<T> {
  if (!e.BANKING_API_URL)
    throw new HttpError(
      503,
      "BANK_UNAVAILABLE",
      "Joe Banking is not configured. Trading is paused.",
    );
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (
    e.ENVIRONMENT === "local" &&
    e.LOCAL_DEMO === "true" &&
    ["localhost", "127.0.0.1"].includes(new URL(e.BANKING_API_URL).hostname) &&
    e.LOCAL_SERVICE_SECRET
  ) {
    headers["x-local-service-secret"] = e.LOCAL_SERVICE_SECRET;
  } else {
    const id = e.JOEAUTH_SERVICE_CLIENT_ID,
      secret = e.JOEAUTH_SERVICE_CLIENT_SECRET,
      issuer = e.JOEAUTH_ISSUER;
    if (!id || !secret || !issuer || !e.BANKING_API_URL.startsWith("https://"))
      throw new HttpError(
        503,
        "BANK_UNAVAILABLE",
        "Settlement service identity is not configured.",
      );
    let t = tokens.get(id);
    if (!t || t.expires < Date.now() + 30000) {
      const response = await fetch(`${issuer}/api/oauth/token`, {
        method: "POST",
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: id,
          client_secret: secret,
          scope: "app:service",
        }),
        redirect: "manual",
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok)
        throw new HttpError(
          503,
          "BANK_UNAVAILABLE",
          "Settlement service authentication is unavailable.",
        );
      const data = (await response.json()) as {
        access_token: string;
        expires_in: number;
      };
      t = {
        token: data.access_token,
        expires: Date.now() + Math.min(data.expires_in, 3600) * 1000,
      };
      tokens.set(id, t);
    }
    headers.authorization = `Bearer ${t.token}`;
  }
  let response: Response;
  try {
    response = await fetch(`${e.BANKING_API_URL}/internal/joese${path}`, {
      method: body ? "POST" : "GET",
      headers,
      body: body ? JSON.stringify(body) : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
    });
  } catch (error) {
    throw new HttpError(
      503,
      "BANK_UNAVAILABLE",
      "Joe Banking is unavailable. Your operation can be safely retried.",
    );
  }
  let data: { data: T; error?: { code: string; message: string } };
  try {
    data = await response.json();
  } catch {
    throw new HttpError(
      503,
      "BANK_UNAVAILABLE",
      "Joe Banking returned an unexpected response. Keep the same operation key when retrying.",
    );
  }
  if (!response.ok) {
    if (response.status < 500)
      throw new BankError(
        response.status,
        data.error?.code ?? "BANK_REJECTED",
        data.error?.message ?? "Banking declined this operation.",
      );
    throw new HttpError(
      503,
      "BANK_UNAVAILABLE",
      "Joe Banking is unavailable. Your operation can be safely retried.",
    );
  }
  return data.data;
}
export async function bankBalance(e: Env, customerId: string) {
  return bank<{
    available_cents: number;
    posted_cents: number;
    held_cents: number;
    subject: string | null;
  }>(e, `/members/${encodeURIComponent(customerId)}/summary`);
}
