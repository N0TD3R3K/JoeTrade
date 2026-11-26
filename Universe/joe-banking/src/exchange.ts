import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Env, Customer } from "./env";
import {
  ApiError,
  amountField,
  json,
  readBody,
  sha256,
  textField,
} from "./http";
import { createWire, recipient, resolveWire, summary, wires } from "./banking";
import { demoEnabled } from "./auth";
import { handleEconomyService } from "./economy/routes";
const keys = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
async function authorize(r: Request, e: Env) {
  if (r.headers.has("origin"))
    throw new ApiError(403, "SERVICE_ONLY", "A server identity is required.");
  const secret = r.headers.get("x-local-service-secret");
  if (
    demoEnabled(r, e) &&
    e.JOESE_LOCAL_SERVICE_SECRET &&
    e.JOESE_LOCAL_SERVICE_SECRET.length >= 32 &&
    secret &&
    (await sha256(secret)) === (await sha256(e.JOESE_LOCAL_SERVICE_SECRET))
  )
    return;
  if (!e.JOESE_CLIENT_ID || !e.JOESE_APP_ID)
    throw new ApiError(
      503,
      "SERVICE_NOT_CONFIGURED",
      "Exchange settlement is not configured.",
    );
  try {
    let k = keys.get(e.JOEAUTH_ISSUER);
    if (!k) {
      k = createRemoteJWKSet(
        new URL(`${e.JOEAUTH_ISSUER}/.well-known/jwks.json`),
      );
      keys.set(e.JOEAUTH_ISSUER, k);
    }
    const { payload: p, protectedHeader: h } = await jwtVerify(
      (r.headers.get("authorization") ?? "").replace(/^Bearer /, ""),
      k,
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
      Number(p.iat) > Math.floor(Date.now() / 1000) + 5 ||
      p.token_type !== "app" ||
      p.client_id !== e.JOESE_CLIENT_ID ||
      p.app_id !== e.JOESE_APP_ID ||
      p.sub !== e.JOESE_CLIENT_ID
    )
      throw new Error();
  } catch {
    throw new ApiError(
      401,
      "INVALID_SERVICE",
      "Exchange service identity could not be verified.",
    );
  }
}
async function customer(e: Env, id: string) {
  const c = await e.DB.prepare(
    "SELECT * FROM bank_customers WHERE id=? AND role='member' AND status IN ('active','frozen')",
  )
    .bind(id)
    .first<Customer>();
  if (!c)
    throw new ApiError(
      409,
      "MEMBER_UNAVAILABLE",
      "The linked banking member is unavailable.",
    );
  return c;
}
export async function handleExchange(
  r: Request,
  e: Env,
): Promise<Response | null> {
  const u = new URL(r.url);
  if (!u.pathname.startsWith("/internal/joese/")) return null;
  await authorize(r, e);
  if (u.pathname.startsWith("/internal/joese/economy/"))
    return handleEconomyService(r, e);
  const m =
    /^\/internal\/joese\/members\/([^/]+)\/(summary|inbox|recipient)$/.exec(
      u.pathname,
    );
  if (m && r.method === "GET") {
    const c = await customer(e, m[1]);
    if (m[2] === "summary")
      return json({
        ...(await summary(e, c)),
        customer_id: c.id,
        subject: c.joe_auth_user_id,
      });
    if (m[2] === "inbox") return json(await wires(e, c.id, true));
    return json(
      await recipient(
        e,
        textField(u.searchParams.get("query"), "recipient", 254),
        c.id,
      ),
    );
  }
  if (u.pathname === "/internal/joese/wires" && r.method === "POST") {
    const b = await readBody(r),
      c = await customer(e, textField(b.customer_id, "customer", 100));
    if (c.status !== "active")
      throw new ApiError(
        403,
        "ACCOUNT_FROZEN",
        "The linked banking account is frozen.",
      );
    const key = textField(b.key, "key", 128);
    if (b.action === "create") {
      const receiver = await recipient(
        e,
        textField(b.recipient, "recipient", 254),
        c.id,
      );
      const result = await createWire(
        e,
        c.id,
        key,
        receiver.id,
        amountField(b.amount_cents),
        textField(b.memo ?? "", "memo", 240, false),
      );
      return json(result.data, result.status);
    }
    if (!["accept", "decline", "cancel"].includes(String(b.action)))
      throw new ApiError(400, "INVALID_ACTION", "Invalid wire action.");
    const result = await resolveWire(
      e,
      c.id,
      key,
      textField(b.id, "wire", 100),
      b.action as "accept" | "decline" | "cancel",
    );
    return json(result.data, result.status);
  }
  if (u.pathname !== "/internal/joese/operations" || r.method !== "POST")
    throw new ApiError(404, "NOT_FOUND", "Unknown settlement route.");
  const b = await readBody(r),
    id = textField(b.id, "operation", 128),
    hash = await sha256(JSON.stringify(b));
  const saved = async () => {
    const row = await e.DB.prepare(
      "SELECT request_hash,response_json FROM exchange_operations WHERE id=?",
    )
      .bind(id)
      .first<{ request_hash: string; response_json: string }>();
    if (!row) return null;
    if (row.request_hash !== hash)
      throw new ApiError(
        409,
        "IDEMPOTENCY_CONFLICT",
        "Settlement reference was already used with different terms.",
      );
    return JSON.parse(row.response_json);
  };
  const old = await saved();
  if (old) return json(old);
  const result = { id, status: "committed" };
  const sql = [
    e.DB.prepare(
      "INSERT INTO exchange_operations(id,request_hash,response_json) VALUES(?,?,?)",
    ).bind(id, hash, JSON.stringify(result)),
  ];
  const action = String(b.action);
  if (action === "reserve") {
    const c = await customer(e, textField(b.customer_id, "customer", 100)),
      amount = amountField(b.amount_cents);
    const a = await e.DB.prepare(
      "SELECT id FROM bank_accounts WHERE customer_id=? AND account_kind='transaction'",
    )
      .bind(c.id)
      .first<{ id: string }>();
    if (!a)
      throw new ApiError(
        409,
        "MEMBER_UNAVAILABLE",
        "Banking account is not ready.",
      );
    sql.push(
      e.DB.prepare(
        "INSERT INTO exchange_holds(id,customer_id,account_id,amount_cents,remaining_cents,status) VALUES(?,?,?,?,?,'active')",
      ).bind(textField(b.hold_id, "hold", 128), c.id, a.id, amount, amount),
    );
  } else if (action === "release") {
    const h = await e.DB.prepare(
      "SELECT customer_id,status FROM exchange_holds WHERE id=?",
    )
      .bind(textField(b.hold_id, "hold", 128))
      .first<{ customer_id: string; status: string }>();
    if (!h || h.customer_id !== b.customer_id)
      throw new ApiError(
        409,
        "HOLD_CONFLICT",
        "Order reservation is unavailable.",
      );
    if (h.status === "active")
      sql.push(
        e.DB.prepare(
          "UPDATE exchange_holds SET remaining_cents=0,status='released' WHERE id=?",
        ).bind(b.hold_id),
      );
  } else if (["payment", "capital", "settle"].includes(action)) {
    const payer = await customer(e, textField(b.customer_id, "customer", 100)),
      debit = amountField(b.amount_cents);
    if (
      !Array.isArray(b.credits) ||
      b.credits.length < 1 ||
      b.credits.length > 8
    )
      throw new ApiError(
        400,
        "INVALID_CREDITS",
        "Settlement credits are required.",
      );
    const account = await e.DB.prepare(
      "SELECT id FROM bank_accounts WHERE customer_id=? AND account_kind='transaction'",
    )
      .bind(payer.id)
      .first<{ id: string }>();
    if (!account)
      throw new ApiError(
        409,
        "MEMBER_UNAVAILABLE",
        "Banking account is not ready.",
      );
    const lines = [{ account: account.id, amount: -debit }];
    let sum = 0;
    for (const raw of b.credits) {
      if (!raw || typeof raw !== "object")
        throw new ApiError(
          400,
          "INVALID_CREDITS",
          "Invalid settlement credit.",
        );
      const item = raw as { customer_id?: unknown; amount_cents?: unknown },
        amount = amountField(item.amount_cents);
      let target: string;
      if (item.customer_id === null)
        target = action === "capital" ? "joese-capital" : "joese-clearing";
      else {
        const c = await customer(
          e,
          textField(item.customer_id, "credit member", 100),
        );
        if (c.id === payer.id)
          throw new ApiError(
            400,
            "SELF_SETTLEMENT",
            "Buyer and seller must differ.",
          );
        const a = await e.DB.prepare(
          "SELECT id FROM bank_accounts WHERE customer_id=? AND account_kind='transaction'",
        )
          .bind(c.id)
          .first<{ id: string }>();
        if (!a)
          throw new ApiError(
            409,
            "MEMBER_UNAVAILABLE",
            "Banking account is not ready.",
          );
        target = a.id;
      }
      lines.push({ account: target, amount });
      sum += amount;
    }
    if (sum !== debit || !Number.isSafeInteger(sum))
      throw new ApiError(
        400,
        "UNBALANCED_SETTLEMENT",
        "Settlement must balance.",
      );
    if (
      action === "capital" &&
      lines.some((l, i) => i > 0 && l.account !== "joese-capital")
    )
      throw new ApiError(
        400,
        "INVALID_CAPITAL",
        "Capital stays in company clearing.",
      );
    if (action === "settle") {
      const h = await e.DB.prepare(
        "SELECT remaining_cents FROM exchange_holds WHERE id=? AND customer_id=? AND status='active'",
      )
        .bind(textField(b.hold_id, "hold", 128), payer.id)
        .first<{ remaining_cents: number }>();
      if (!h || h.remaining_cents < debit)
        throw new ApiError(
          409,
          "HOLD_CONFLICT",
          "Reservation does not cover this fill.",
        );
      sql.push(
        e.DB.prepare(
          "UPDATE exchange_holds SET remaining_cents=remaining_cents-?,status=CASE WHEN remaining_cents=? THEN 'settled' ELSE 'active' END WHERE id=?",
        ).bind(debit, debit, b.hold_id),
      );
    }
    sql.push(
      e.DB.prepare(
        "INSERT INTO ledger_transactions(id,transaction_type,business_reference,description,actor_id) VALUES(?,?,?,?,?)",
      ).bind(
        id,
        action === "capital"
          ? "exchange_capital"
          : action === "settle"
            ? "exchange_settlement"
            : "exchange_payment",
        `joese:${id}`,
        action === "capital"
          ? "Company founding capital — frozen shares"
          : "JOESE member-to-member settlement",
        payer.id,
      ),
    );
    lines.forEach((l, i) =>
      sql.push(
        e.DB.prepare(
          "INSERT INTO ledger_lines(id,transaction_id,account_id,amount_cents) VALUES(?,?,?,?)",
        ).bind(`${id}:${i}`, id, l.account, l.amount),
      ),
    );
    sql.push(
      e.DB.prepare(
        "UPDATE ledger_transactions SET state='posted' WHERE id=?",
      ).bind(id),
    );
  } else if (action !== "noop")
    throw new ApiError(400, "INVALID_ACTION", "Invalid settlement operation.");
  sql.push(
    e.DB.prepare(
      "INSERT INTO audit_log(id,actor_id,action,target_id,details_json) VALUES(?,?,?,?,?)",
    ).bind(
      `exchange:${id}`,
      String(b.customer_id ?? "joese-service"),
      `joese.${action}`,
      id,
      JSON.stringify({ reference: id }),
    ),
  );
  try {
    await e.DB.batch(sql);
  } catch (error) {
    const concurrent = await saved();
    if (concurrent) return json(concurrent);
    const msg = String(error);
    if (msg.includes("INSUFFICIENT_FUNDS"))
      throw new ApiError(
        409,
        "INSUFFICIENT_FUNDS",
        "Banking available balance is too low.",
      );
    if (msg.includes("MEMBER_UNAVAILABLE"))
      throw new ApiError(
        409,
        "MEMBER_UNAVAILABLE",
        "A banking member is frozen or unavailable.",
      );
    if (msg.includes("HOLD_CONFLICT"))
      throw new ApiError(
        409,
        "HOLD_CONFLICT",
        "Reservation changed before settlement.",
      );
    throw error;
  }
  return json(result);
}
