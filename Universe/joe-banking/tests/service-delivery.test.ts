import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { TestD1 } from "./database";
import worker from "../src/index";
import { sha256 } from "../src/http";
import type { Env } from "../src/env";
describe("Approved service payment-result delivery", () => {
  let db: TestD1, e: Env;
  beforeEach(() => {
    db = new TestD1();
    e = {
      ...db.env(),
      JOEAUTH_ISSUER: `https://merchant-issuer-${crypto.randomUUID()}.example.test`,
      ECONOMY_DELIVERY_SECRET:
        "a-synthetic-delivery-key-longer-than-32-characters",
    };
    db.db.exec(
      "INSERT INTO economy_companies(id,exchange_asset_id,state) VALUES('merchant-company','asset','active');INSERT INTO company_services(id,company_id,joe_auth_app_id,state,callback_destination_id) VALUES('service','merchant-company','merchant-app','active','authenticated-pull'),('other-service','merchant-company','other-app','active','authenticated-pull');UPDATE bank_customers SET joe_auth_user_id='joe-auth-bob' WHERE id='demo-bob'",
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    db.db.close();
  });
  async function identity(
    app = "merchant-app",
    overrides: Record<string, unknown> = {},
  ) {
    const key = await generateKeyPair("EdDSA"),
      jwk = { ...(await exportJWK(key.publicKey)), kid: "key", alg: "EdDSA" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ keys: [jwk] })),
    );
    return new SignJWT({
      token_type: "app",
      client_id: "merchant-client",
      app_id: app,
      ...overrides,
    })
      .setProtectedHeader({ alg: "EdDSA", kid: "key" })
      .setSubject("merchant-client")
      .setIssuer(e.JOEAUTH_ISSUER)
      .setAudience(e.JOEAUTH_ISSUER)
      .setJti(crypto.randomUUID())
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(key.privateKey);
  }
  async function event(id: string, service: string) {
    const payload = JSON.stringify({
      serviceId: service,
      customerId: "demo-bob",
      operationId: id,
      amountCents: 10000,
    });
    db.db
      .prepare(
        "INSERT INTO economy_outbox(event_id,source_operation_id,kind,payload_json,payload_hash,created_at) VALUES(?,?,'payment.posted',?,?,1)",
      )
      .run(id, id, payload, await sha256(payload));
  }
  const request = (
    token: string,
    path = "/internal/services/entitlements",
    body?: unknown,
    origin?: string,
  ) =>
    worker.fetch(
      new Request("https://bank.example.test" + path, {
        method: body ? "POST" : "GET",
        headers: {
          authorization: `Bearer ${token}`,
          ...(origin ? { origin } : {}),
          "content-type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
      e,
    );
  it("binds service identity to approved app and rejects browser origins or a forged token", async () => {
    const token = await identity("unapproved-app");
    expect((await request(token)).status).toBe(403);
    expect(
      (await request(token, undefined, undefined, "https://untrusted.test"))
        .status,
    ).toBe(403);
    expect((await request("forged-token")).status).toBe(401);
    expect(
      db.db.prepare("SELECT COUNT(*) AS n FROM ledger_transactions").get()!.n,
    ).toBe(2);
  });
  it("returns only its own results with verifiable signatures and stable identity, then acknowledges idempotently", async () => {
    const token = await identity();
    await event("own-event", "service");
    await event("other-event", "other-service");
    const response = await request(token);
    expect(response.status).toBe(200);
    const result = (await response.json()) as { data: any[] };
    expect(result.data).toHaveLength(1);
    const receipt = result.data[0],
      envelope = JSON.parse(receipt.body);
    expect(envelope.payload.subject).toBe("joe-auth-bob");
    expect(envelope.payload.customerId).toBeUndefined();
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
      new TextEncoder().encode("joetrade-service:service:merchant-app"),
    );
    const key = await crypto.subtle.importKey(
      "raw",
      derived,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = Array.from(
      new Uint8Array(
        await crypto.subtle.sign(
          "HMAC",
          key,
          new TextEncoder().encode(receipt.body),
        ),
      ),
      (v) => v.toString(16).padStart(2, "0"),
    ).join("");
    expect(receipt.signature).toBe(signature);
    expect(
      (
        await request(token, "/internal/services/ack", {
          eventId: "other-event",
          receiptHash: receipt.receiptHash,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(token, "/internal/services/ack", {
          eventId: "own-event",
          receiptHash: receipt.receiptHash,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(token, "/internal/services/ack", {
          eventId: "own-event",
          receiptHash: receipt.receiptHash,
        })
      ).status,
    ).toBe(200);
    expect(
      ((await (await request(token)).json()) as { data: any[] }).data,
    ).toHaveLength(0);
  });
});
