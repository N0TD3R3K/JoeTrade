import type { Env } from "../env";
import { bank, BankError } from "./banking-client";
import { HttpError } from "./http";
export type Statement = { sql: string; params: (string | number | null)[] };
export type Plan = {
  bank: Record<string, unknown>;
  statements: Statement[];
  response: Record<string, unknown>;
};
export const s = (
  sql: string,
  ...params: (string | number | null)[]
): Statement => ({ sql, params });
export async function digest(text: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
    (x) => x.toString(16).padStart(2, "0"),
  ).join("");
}
interface Operation {
  id: string;
  state: string;
  bank_json: string;
  statements_json: string;
  response_json: string;
  request_hash: string;
  error_json: string;
  created_at: number;
}
async function finish(e: Env, op: Operation) {
  if (op.state === "complete")
    return JSON.parse(op.response_json) as Record<string, unknown>;
  if (op.state === "failed") {
    const error = JSON.parse(op.error_json);
    throw new HttpError(error.status, error.code, error.message);
  }
  if (op.state === "planning")
    throw new HttpError(
      409,
      "OPERATION_PLANNING",
      "Another operation is being prepared. Try again shortly.",
    );
  try {
    await bank(e, "/operations", JSON.parse(op.bank_json));
  } catch (error) {
    if (error instanceof BankError) {
      await fail(e, op.id, error);
      throw error;
    }
    throw new HttpError(
      503,
      "SETTLEMENT_PENDING",
      "Settlement is waiting for Joe Banking. Retry this operation with the same key.",
    );
  }
  const effects = JSON.parse(op.statements_json) as Statement[];
  try {
    await e.DB.batch([
      e.DB.prepare(
        "INSERT INTO financial_receipts(operation_id) VALUES(?)",
      ).bind(op.id),
      ...effects.map((x) => e.DB.prepare(x.sql).bind(...x.params)),
      e.DB.prepare(
        "UPDATE financial_operations SET state='complete' WHERE id=?",
      ).bind(op.id),
      e.DB.prepare("DELETE FROM financial_mutex WHERE operation_id=?").bind(
        op.id,
      ),
    ]);
  } catch {
    const done = await e.DB.prepare(
      "SELECT state FROM financial_operations WHERE id=?",
    )
      .bind(op.id)
      .first<{ state: string }>();
    if (done?.state !== "complete")
      throw new HttpError(
        503,
        "SETTLEMENT_PENDING",
        "Cash is recorded; share settlement is being recovered. Do not create a replacement operation.",
      );
  }
  return JSON.parse(op.response_json) as Record<string, unknown>;
}
async function fail(e: Env, id: string, error: HttpError) {
  await e.DB.batch([
    e.DB.prepare(
      "UPDATE financial_operations SET state='failed',error_json=? WHERE id=? AND state!='complete'",
    ).bind(
      JSON.stringify({
        status: error.status,
        code: error.code,
        message: error.message,
      }),
      id,
    ),
    e.DB.prepare("DELETE FROM financial_mutex WHERE operation_id=?").bind(id),
  ]);
}
export async function recover(e: Env) {
  const lock = await e.DB.prepare(
    "SELECT operation_id FROM financial_mutex WHERE id='market'",
  ).first<{ operation_id: string }>();
  if (!lock) return;
  const op = await e.DB.prepare("SELECT * FROM financial_operations WHERE id=?")
    .bind(lock.operation_id)
    .first<Operation>();
  if (!op) {
    const stale = await e.DB.prepare(
      "SELECT id FROM market_ticks WHERE id=? AND (status IN ('complete','failed') OR started_at < datetime('now','-10 minutes'))",
    )
      .bind(lock.operation_id)
      .first();
    if (stale) {
      await e.DB.prepare("DELETE FROM financial_mutex WHERE operation_id=?")
        .bind(lock.operation_id)
        .run();
      return;
    }
    throw new HttpError(
      423,
      "MARKET_UPDATING",
      "The market engine is updating. Try again shortly.",
    );
  }
  if (
    op.state === "planning" &&
    op.created_at >= Math.floor(Date.now() / 1000) - 300
  )
    return;
  if (
    op.state === "planning" &&
    op.created_at < Math.floor(Date.now() / 1000) - 300
  ) {
    await fail(
      e,
      op.id,
      new HttpError(
        409,
        "INTERRUPTED",
        "Preparation was interrupted before cash moved. Start a new operation.",
      ),
    );
    return;
  }
  await finish(e, op);
}
export async function execute(
  e: Env,
  actor: string,
  key: string,
  input: unknown,
  planner: (id: string) => Promise<Plan>,
) {
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(key))
    throw new HttpError(
      400,
      "IDEMPOTENCY_REQUIRED",
      "A stable Idempotency-Key is required.",
    );
  const id = `exchange_${await digest(`${actor}:${key}`)}`,
    hash = await digest(JSON.stringify(input));
  const previous = await e.DB.prepare(
    "SELECT * FROM financial_operations WHERE id=?",
  )
    .bind(id)
    .first<Operation>();
  if (previous) {
    if (previous.request_hash !== hash)
      throw new HttpError(
        409,
        "IDEMPOTENCY_CONFLICT",
        "This key was used for different terms.",
      );
    if (previous.state === "failed" && actor === "matcher") {
      // A definitive rejection never committed bank cash. Allow the same immutable
      // fill reference to be retried after the member's availability is restored.
      await e.DB.prepare(
        "DELETE FROM financial_operations WHERE id=? AND state='failed' AND NOT EXISTS(SELECT 1 FROM financial_receipts WHERE operation_id=?)",
      )
        .bind(id, id)
        .run();
    } else return finish(e, previous);
  }

  await recover(e);
  try {
    await e.DB.batch([
      e.DB.prepare(
        "INSERT INTO financial_operations(id,actor_id,request_hash,state) VALUES(?,?,?,'planning')",
      ).bind(id, actor, hash),
      e.DB.prepare(
        "INSERT INTO financial_mutex(id,operation_id) VALUES('market',?)",
      ).bind(id),
    ]);
  } catch {
    throw new HttpError(
      409,
      "MARKET_BUSY",
      "Another market operation is completing. Please retry.",
    );
  }
  let plan: Plan;
  try {
    plan = await planner(id);
  } catch (error) {
    const problem =
      error instanceof HttpError
        ? error
        : new HttpError(
            409,
            "INVALID_OPERATION",
            "This operation cannot be prepared.",
          );
    await fail(e, id, problem);
    throw problem;
  }
  const saved = await e.DB.prepare(
    "UPDATE financial_operations SET state='pending',bank_json=?,statements_json=?,response_json=? WHERE id=? AND state='planning'",
  )
    .bind(
      JSON.stringify({ id, ...plan.bank }),
      JSON.stringify(plan.statements),
      JSON.stringify(plan.response),
      id,
    )
    .run();
  if (saved.meta.changes !== 1)
    throw new HttpError(
      409,
      "INTERRUPTED",
      "Preparation expired before cash moved.",
    );
  return finish(
    e,
    (await e.DB.prepare("SELECT * FROM financial_operations WHERE id=?")
      .bind(id)
      .first<Operation>())!,
  );
}
export async function releaseJobs(e: Env, limit = 5) {
  const jobs = await e.DB.prepare(
    "SELECT * FROM bank_release_jobs WHERE complete=0 LIMIT ?",
  )
    .bind(Math.min(5, Math.max(1, Math.floor(limit))))
    .all<{ id: string; customer_id: string; hold_id: string }>();
  for (const job of jobs.results) {
    await bank(e, "/operations", {
      id: job.id,
      action: "release",
      customer_id: job.customer_id,
      hold_id: job.hold_id,
    });
    await e.DB.prepare("UPDATE bank_release_jobs SET complete=1 WHERE id=?")
      .bind(job.id)
      .run();
  }
}
