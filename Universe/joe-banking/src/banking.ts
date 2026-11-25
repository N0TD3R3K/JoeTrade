import type { Customer, Env } from "./env";
import { ApiError, sha256 } from "./http";

export async function summary(env: Env, customer: Customer) {
  const rows = await env.DB.prepare(
    "SELECT account_kind, posted_cents, held_cents, available_cents FROM account_balances WHERE customer_id = ?",
  )
    .bind(customer.id)
    .all<{
      account_kind: string;
      posted_cents: number;
      held_cents: number;
      available_cents: number;
    }>();
  const transaction = rows.results.find(
    (row) => row.account_kind === "transaction",
  );
  if (!transaction)
    throw new ApiError(
      409,
      "ACCOUNT_NOT_READY",
      "Your banking account has not been provisioned.",
    );
  const holds = await env.DB.prepare(
    `SELECT purpose, SUM(h.amount_cents) AS amount_cents FROM fund_holds h
    JOIN bank_accounts a ON a.id = h.account_id WHERE a.customer_id = ? AND h.status = 'active' GROUP BY purpose`,
  )
    .bind(customer.id)
    .all<{ purpose: string; amount_cents: number }>();
  const inbox = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM member_wires WHERE receiver_customer_id = ? AND status = 'pending_receiver'",
  )
    .bind(customer.id)
    .first<{ count: number }>();
  return {
    currency: "J$",
    posted_cents: transaction.posted_cents,
    available_cents: transaction.available_cents,
    held_cents: transaction.held_cents,
    holds: holds.results,
    flexible_deposit_cents:
      rows.results.find((row) => row.account_kind === "flexible_deposit")
        ?.posted_cents ?? 0,
    inbox_count: inbox?.count ?? 0,
    features: { wires: true, deposits: false, loans: false, joese: false },
  };
}

export async function activity(env: Env, customerId: string) {
  const rows = await env.DB.prepare(
    `SELECT t.id, t.transaction_type, t.description, t.created_at, SUM(l.amount_cents) AS amount_cents
    FROM ledger_lines l JOIN ledger_transactions t ON t.id = l.transaction_id JOIN bank_accounts a ON a.id = l.account_id
    WHERE a.customer_id = ? AND t.state = 'posted' GROUP BY t.id ORDER BY t.created_at DESC, t.id DESC LIMIT 100`,
  )
    .bind(customerId)
    .all();
  return rows.results;
}

export async function wires(env: Env, customerId: string, inboxOnly = false) {
  const rows = await env.DB.prepare(
    `SELECT w.id, w.sender_customer_id, w.receiver_customer_id, w.amount_cents, w.memo,
    w.status, w.created_at, w.resolved_at, s.display_name AS sender_name, r.display_name AS receiver_name
    FROM member_wires w JOIN bank_customers s ON s.id = w.sender_customer_id JOIN bank_customers r ON r.id = w.receiver_customer_id
    WHERE ${inboxOnly ? "w.receiver_customer_id = ? AND w.status = 'pending_receiver'" : "(w.sender_customer_id = ? OR w.receiver_customer_id = ?)"}
    ORDER BY w.created_at DESC, w.id DESC LIMIT 100`,
  )
    .bind(...(inboxOnly ? [customerId] : [customerId, customerId]))
    .all();
  return rows.results;
}

export async function recipient(env: Env, query: string, senderId: string) {
  const row = await env.DB.prepare(
    `SELECT id, display_name, email FROM bank_customers
    WHERE (username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE) AND role = 'member' AND status = 'active' AND id != ?`,
  )
    .bind(query, query, senderId)
    .first<{ id: string; display_name: string; email: string }>();
  if (!row)
    throw new ApiError(
      404,
      "RECIPIENT_UNAVAILABLE",
      "This recipient is unavailable for a wire.",
    );
  const [local, domain] = row.email.split("@");
  return {
    id: row.id,
    display_name: row.display_name,
    masked_email: `${local.slice(0, 1)}***@${domain}`,
  };
}

type SavedResponse = {
  request_hash: string;
  response_json: string;
  response_status: number;
};
type Operation = { data: Record<string, unknown>; status: number };

async function replay(
  env: Env,
  actorId: string,
  key: string,
  hash: string,
): Promise<Operation | null> {
  const saved = await env.DB.prepare(
    "SELECT request_hash, response_json, response_status FROM idempotency_records WHERE actor_id = ? AND key = ?",
  )
    .bind(actorId, key)
    .first<SavedResponse>();
  if (!saved) return null;
  if (saved.request_hash !== hash)
    throw new ApiError(
      409,
      "IDEMPOTENCY_CONFLICT",
      "This key was already used for a different operation.",
    );
  return {
    data: JSON.parse(saved.response_json) as Record<string, unknown>,
    status: saved.response_status,
  };
}

async function commit(
  env: Env,
  actorId: string,
  key: string,
  hash: string,
  result: Operation,
  statements: D1PreparedStatement[],
) {
  const existing = await replay(env, actorId, key, hash);
  if (existing) return existing;
  try {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO idempotency_records (actor_id, key, request_hash, resource_id, response_json, response_status) VALUES (?, ?, ?, ?, ?, ?)",
      ).bind(
        actorId,
        key,
        hash,
        result.data.id,
        JSON.stringify(result.data),
        result.status,
      ),
      ...statements,
    ]);
  } catch (error) {
    // A competing request may have committed the same key after the first read.
    const concurrent = await replay(env, actorId, key, hash);
    if (concurrent) return concurrent;
    const message = String(error);
    if (message.includes("INSUFFICIENT_FUNDS"))
      throw new ApiError(
        409,
        "INSUFFICIENT_FUNDS",
        "Your available balance does not cover this wire.",
      );
    if (message.includes("WIRE_CONFLICT") || message.includes("HOLD_CONFLICT"))
      throw new ApiError(
        409,
        "WIRE_CONFLICT",
        "This wire has already been resolved. Refresh its status.",
      );
    if (message.includes("WIRE_NOT_ALLOWED"))
      throw new ApiError(
        409,
        "WIRE_UNAVAILABLE",
        "This wire cannot be completed in its current state.",
      );
    throw error;
  }
  return result;
}

export async function createWire(
  env: Env,
  actorId: string,
  key: string,
  receiverId: string,
  cents: number,
  memo: string,
) {
  if (receiverId === actorId)
    throw new ApiError(
      400,
      "SELF_TRANSFER",
      "Choose another member as the recipient.",
    );
  const hash = await sha256(
    JSON.stringify(["create-wire", receiverId, cents, memo]),
  );
  const existing = await replay(env, actorId, key, hash);
  if (existing) return existing;
  const id = crypto.randomUUID();
  const holdId = crypto.randomUUID();
  return commit(
    env,
    actorId,
    key,
    hash,
    {
      status: 201,
      data: { id, amount_cents: cents, status: "pending_receiver" },
    },
    [
      env.DB.prepare(
        `INSERT INTO fund_holds (id, account_id, purpose, external_reference, amount_cents)
      VALUES (?, (SELECT id FROM bank_accounts WHERE customer_id = ? AND account_kind = 'transaction'), 'member_wire', ?, ?)`,
      ).bind(holdId, actorId, id, cents),
      env.DB.prepare(
        "INSERT INTO member_wires (id, sender_customer_id, receiver_customer_id, amount_cents, memo, hold_id) VALUES (?, ?, ?, ?, ?, ?)",
      ).bind(id, actorId, receiverId, cents, memo, holdId),
    ],
  );
}

export async function resolveWire(
  env: Env,
  actorId: string,
  key: string,
  id: string,
  action: "accept" | "decline" | "cancel",
) {
  const hash = await sha256(JSON.stringify(["resolve-wire", id, action]));
  const existing = await replay(env, actorId, key, hash);
  if (existing) return existing;
  const wire = await env.DB.prepare(
    "SELECT sender_customer_id, receiver_customer_id FROM member_wires WHERE id = ? AND (sender_customer_id = ? OR receiver_customer_id = ?)",
  )
    .bind(id, actorId, actorId)
    .first<{ sender_customer_id: string; receiver_customer_id: string }>();
  if (
    !wire ||
    (action === "cancel"
      ? wire.sender_customer_id
      : wire.receiver_customer_id) !== actorId
  ) {
    throw new ApiError(404, "WIRE_NOT_FOUND", "This wire is unavailable.");
  }
  const status = {
    accept: "accepted",
    decline: "declined",
    cancel: "cancelled_by_sender",
  }[action];
  return commit(
    env,
    actorId,
    key,
    hash,
    { status: 200, data: { id, status } },
    [
      env.DB.prepare(
        "UPDATE member_wires SET status = ?, resolved_by = ?, resolved_at = unixepoch() WHERE id = ?",
      ).bind(status, actorId, id),
    ],
  );
}

export async function reconciliation(env: Env) {
  const ledger = await env.DB.prepare(
    `SELECT COUNT(*) AS unbalanced_transactions FROM (
    SELECT t.id FROM ledger_transactions t LEFT JOIN ledger_lines l ON l.transaction_id = t.id
    WHERE t.state = 'posted' GROUP BY t.id HAVING COUNT(l.id) < 2 OR SUM(l.amount_cents) != 0)`,
  ).first<{ unbalanced_transactions: number }>();
  const projections = await env.DB.prepare(
    `SELECT a.id FROM bank_accounts a LEFT JOIN (
    SELECT l.account_id, SUM(l.amount_cents) AS total FROM ledger_lines l JOIN ledger_transactions t ON t.id = l.transaction_id
    WHERE t.state = 'posted' GROUP BY l.account_id
  ) l ON l.account_id = a.id WHERE a.posted_cents != COALESCE(l.total, 0)`,
  ).all();
  const holds = await env.DB.prepare(
    "SELECT id FROM account_balances WHERE customer_id IS NOT NULL AND available_cents < 0",
  ).all();
  return {
    unbalanced_transactions: ledger?.unbalanced_transactions ?? 0,
    projection_mismatches: projections.results.length,
    negative_available_accounts: holds.results.length,
  };
}

export async function rateLimit(
  env: Env,
  subject: string,
  action: string,
  maximum: number,
) {
  const hash = await sha256(subject);
  const window = Math.floor(Date.now() / 60_000);
  const result = await env.DB.prepare(
    `INSERT INTO rate_limits(subject_hash, action, window_start, count) VALUES (?, ?, ?, 1)
    ON CONFLICT(subject_hash, action, window_start) DO UPDATE SET count = count + 1 RETURNING count`,
  )
    .bind(hash, action, window)
    .first<{ count: number }>();
  if ((result?.count ?? maximum + 1) > maximum)
    throw new ApiError(
      429,
      "RATE_LIMITED",
      "Please wait a minute before trying again.",
    );
}
