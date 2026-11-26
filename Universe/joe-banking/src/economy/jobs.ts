import type { Env } from "../env";
import { ApiError } from "../http";
import { all, one, q, type Row } from "./core";
/** Rotate past deferred items so one frozen member cannot monopolize a queue. */
export async function dueItems(
  e: Env,
  queue: string,
  query: string,
  params: (string | number | null)[] = [],
  limit = 5,
) {
  const cursor = await one(
    e,
    "SELECT last_item FROM economy_job_cursors WHERE queue=?",
    queue,
  );
  return all(
    e,
    `SELECT * FROM (${query}) due ORDER BY CASE WHEN item_id>? THEN 0 ELSE 1 END,item_id LIMIT ?`,
    ...params,
    cursor?.last_item ?? "",
    limit,
  );
}
export async function attemptJob(
  e: Env,
  queue: string,
  item: Row,
  now: number,
  run: () => Promise<unknown>,
) {
  let outcome = "complete",
    code: string | null = null;
  try {
    await run();
  } catch (error) {
    if (!(error instanceof ApiError) || error.status >= 500) throw error;
    outcome = "deferred";
    code = error.code;
  }
  await e.DB.batch([
    q(
      e,
      "INSERT INTO economy_job_cursors(queue,last_item,updated_at) VALUES(?,?,?) ON CONFLICT(queue) DO UPDATE SET last_item=excluded.last_item,updated_at=excluded.updated_at",
      queue,
      String(item.item_id),
      now,
    ),
    q(
      e,
      "INSERT INTO economy_job_attempts(queue,item_id,attempted_at,outcome,error_code) VALUES(?,?,?,?,?) ON CONFLICT(queue,item_id) DO UPDATE SET attempted_at=excluded.attempted_at,outcome=excluded.outcome,error_code=excluded.error_code",
      queue,
      String(item.item_id),
      now,
      outcome,
      code,
    ),
  ]);
}
