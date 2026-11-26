import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Env } from "../env";
import { ApiError, json, readBody, sha256 } from "../http";
import { all, fail, one, q, str } from "./core";
const keysets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
/** Merchant apps can pull only their own durable payment results. They cannot debit. */
export async function handleMerchant(
  r: Request,
  e: Env,
): Promise<Response | null> {
  const u = new URL(r.url);
  if (!u.pathname.startsWith("/internal/services/")) return null;
  if (r.headers.has("origin"))
    throw new ApiError(
      403,
      "SERVICE_ONLY",
      "Use an authenticated service connection.",
    );
  if (!e.ECONOMY_DELIVERY_SECRET || e.ECONOMY_DELIVERY_SECRET.length < 32)
    throw new ApiError(
      503,
      "DELIVERY_NOT_CONFIGURED",
      "Signed service delivery is not configured.",
    );
  let appId: string;
  try {
    let keys = keysets.get(e.JOEAUTH_ISSUER);
    if (!keys) {
      keys = createRemoteJWKSet(
        new URL(`${e.JOEAUTH_ISSUER}/.well-known/jwks.json`),
      );
      keysets.set(e.JOEAUTH_ISSUER, keys);
    }
    const { payload: p, protectedHeader: h } = await jwtVerify(
      (r.headers.get("authorization") ?? "").replace(/^Bearer /, ""),
      keys,
      {
        issuer: e.JOEAUTH_ISSUER,
        audience: e.JOEAUTH_ISSUER,
        algorithms: ["EdDSA"],
        requiredClaims: ["sub", "iat", "exp", "jti"],
      },
    );
    if (
      !h.kid ||
      p.aud !== e.JOEAUTH_ISSUER ||
      p.token_type !== "app" ||
      p.sub !== p.client_id ||
      typeof p.app_id !== "string" ||
      Number(p.iat) > Date.now() / 1000 + 5
    )
      throw new Error();
    appId = p.app_id;
  } catch {
    throw new ApiError(
      401,
      "INVALID_SERVICE",
      "The JoeAuth service identity could not be verified.",
    );
  }
  const service = await one(
    e,
    "SELECT * FROM company_services WHERE joe_auth_app_id=? AND state='active'",
    appId,
  );
  if (!service)
    fail(
      "This app is not approved for company billing.",
      "SERVICE_NOT_APPROVED",
      403,
    );
  const master = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(e.ECONOMY_DELIVERY_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const derived = await crypto.subtle.sign(
    "HMAC",
    master,
    new TextEncoder().encode(
      `joetrade-service:${service!.id}:${service!.joe_auth_app_id}`,
    ),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    derived,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  if (r.method === "GET" && u.pathname === "/internal/services/entitlements") {
    const rows = await all(
      e,
      "SELECT o.rowid AS sequence,o.* FROM economy_outbox o WHERE json_extract(o.payload_json,'$.serviceId')=? AND NOT EXISTS(SELECT 1 FROM service_delivery_receipts d WHERE d.service_id=? AND d.event_id=o.event_id) ORDER BY o.rowid LIMIT 20",
      service!.id,
      service!.id,
    );
    const receipts = [];
    for (const row of rows) {
      const payload = JSON.parse(row.payload_json),
        customer = await one(
          e,
          "SELECT joe_auth_user_id FROM bank_customers WHERE id=?",
          payload.customerId,
        ),
        envelope = {
          eventId: row.event_id,
          sequence: row.sequence,
          kind: row.kind,
          sourceOperationId: row.source_operation_id,
          payload: {
            ...payload,
            customerId: undefined,
            subject: customer?.joe_auth_user_id ?? null,
          },
          createdAt: row.created_at,
        };
      const body = JSON.stringify(envelope),
        signature = Array.from(
          new Uint8Array(
            await crypto.subtle.sign(
              "HMAC",
              key,
              new TextEncoder().encode(body),
            ),
          ),
          (x) => x.toString(16).padStart(2, "0"),
        ).join("");
      receipts.push({
        body,
        signature,
        algorithm: "HMAC-SHA256",
        receiptHash: row.payload_hash,
      });
    }
    return json(receipts);
  }
  if (r.method === "POST" && u.pathname === "/internal/services/ack") {
    const b = await readBody(r),
      event = await one(
        e,
        "SELECT * FROM economy_outbox WHERE event_id=? AND json_extract(payload_json,'$.serviceId')=?",
        str(b.eventId),
        service!.id,
      );
    if (!event || b.receiptHash !== event.payload_hash)
      fail("This receipt does not belong to this service.");
    await q(
      e,
      "INSERT INTO service_delivery_receipts(service_id,event_id,payload_hash,acknowledged_at) VALUES(?,?,?,unixepoch()) ON CONFLICT DO NOTHING",
      service!.id,
      event.event_id,
      event.payload_hash,
    ).run();
    return json({ acknowledged: true });
  }
  fail("Unknown service route.", "NOT_FOUND", 404);
}
