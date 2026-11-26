import type { Env } from "../env";
import { bank } from "./banking-client";
import { digest, execute, s, type Statement } from "./financial-operations";
import { HttpError } from "./http";
type Event = {
  event_id: string;
  source_operation_id: string;
  kind: string;
  payload_json: string;
  payload_hash: string;
  created_at: number;
};
/** Receipts and projections commit together; lost acknowledgments safely replay. */
export async function receiveEconomyEvent(e: Env, event: Event) {
  if ((await digest(event.payload_json)) !== event.payload_hash)
    throw new HttpError(
      409,
      "RECEIPT_HASH_CONFLICT",
      "The bank event failed its integrity check.",
    );
  const old = await e.DB.prepare(
    "SELECT payload_hash FROM bank_economy_receipts WHERE event_id=?",
  )
    .bind(event.event_id)
    .first<{ payload_hash: string }>();
  if (old) {
    if (old.payload_hash !== event.payload_hash)
      throw new HttpError(
        409,
        "RECEIPT_HASH_CONFLICT",
        "This receipt has different content.",
      );
    return;
  }
  await execute(
    e,
    "bank-economy-event",
    await digest(event.event_id),
    { eventId: event.event_id, hash: event.payload_hash },
    async () => {
      const effects: Statement[] = [
        s(
          "INSERT INTO bank_economy_receipts(event_id,payload_hash,received_at,source_operation_id,kind) VALUES(?,?,unixepoch(),?,?)",
          event.event_id,
          event.payload_hash,
          event.source_operation_id,
          event.kind,
        ),
      ];
      if (event.kind === "rate.applied") {
        const p = JSON.parse(event.payload_json),
          valid =
            Number.isSafeInteger(p.effectiveAt) &&
            p.effectiveAt > 0 &&
            p.operationId === event.source_operation_id &&
            Number.isSafeInteger(p.deltaPpm) &&
            p.deltaPpm !== 0 &&
            Math.abs(p.deltaPpm) <= 2000 &&
            p.deltaPpm % 50 === 0 &&
            p.nextRatePpm === p.previousRatePpm + p.deltaPpm &&
            p.nextRatePpm >= 3000 &&
            p.nextRatePpm <= 20000 &&
            p.direction === (p.deltaPpm < 0 ? "bullish" : "bearish") &&
            typeof p.explanation === "string" &&
            p.explanation.length <= 2000;
        if (!valid)
          throw new HttpError(
            409,
            "INVALID_BANK_EVENT",
            "The rate event does not match an applied monetary-policy operation.",
          );
        const stocks = (
          await e.DB.prepare(
            "SELECT ticker FROM assets WHERE active=1 AND asset_type='stock' AND unixepoch(created_at)<=? ORDER BY ticker",
          )
            .bind(p.effectiveAt)
            .all<{ ticker: string }>()
        ).results;
        const id = `news:${p.operationId}`,
          effective = new Date(p.effectiveAt * 1000).toISOString(),
          published = new Date(
            Math.max(Date.now(), p.effectiveAt * 1000),
          ).toISOString();
        effects.push(
          s(
            "INSERT INTO news_events(id,headline,article,category,direction,severity,affected_tickers_json,duration_ticks,status,published_at) VALUES(?,?,?,'monetary_policy',?,'mild',?,1,'published',?)",
            id,
            `Joe Bank ${p.deltaPpm < 0 ? "cuts" : "raises"} the weekly Joe Rate to ${(p.nextRatePpm / 10000).toFixed(3)}%`,
            `${p.explanation}\nEffective ${effective}. Weekly rate ${(p.previousRatePpm / 10000).toFixed(3)}% to ${(p.nextRatePpm / 10000).toFixed(3)}%. This bulletin adds a mild ${p.direction} signal for one eligible stock-market tick; returns are not guaranteed. Operation ${p.operationId}.`,
            p.direction,
            JSON.stringify(stocks.map((a) => a.ticker)),
            published,
          ),
          s(
            "INSERT INTO rate_market_event_links(bank_operation_id,receipt_id,news_event_id,actual_effective_at) VALUES(?,?,?,?)",
            p.operationId,
            event.event_id,
            id,
            p.effectiveAt,
          ),
        );
      }
      return {
        bank: { action: "noop" },
        statements: effects,
        response: { eventId: event.event_id, state: "received" },
      };
    },
  );
}

export async function syncIncome(e: Env) {
  const pending = await e.DB.prepare(
    "SELECT id FROM trade_income_outbox WHERE delivered_at IS NULL ORDER BY occurred_at,id LIMIT 1",
  ).first<{ id: string }>();
  const bucket = Math.floor(Date.now() / 300000),
    key = `income_sync_${await digest(String(bucket) + ":" + (pending?.id ?? "empty"))}`;
  await execute(
    e,
    "economy-delivery",
    key,
    { bucket, first: pending?.id ?? null },
    async () => {
      const rows = (
        await e.DB.prepare(
          "SELECT * FROM trade_income_outbox WHERE delivered_at IS NULL ORDER BY occurred_at,id LIMIT 10",
        ).all<Record<string, any>>()
      ).results;
      const events = [];
      for (const row of rows) {
        const proof = JSON.parse(row.evidence_json);
        events.push({
          customerId: row.customer_id,
          reference: row.sale_reference,
          category: row.category,
          occurredAt: row.occurred_at,
          gainCents: row.gain_cents,
          basisComplete: row.basis_complete === 1,
          evidence: {
            bankOperationId: proof.bankOperationId ?? null,
            netProceedsCents: proof.netProceedsCents ?? null,
            assetId: proof.assetId ?? null,
            proofReference: row.id,
            basisProofHash: await digest(row.evidence_json),
          },
        });
      }
      const remaining = await e.DB.prepare(
        "SELECT COUNT(*) AS n FROM trade_income_outbox WHERE delivered_at IS NULL",
      ).first<{ n: number }>();
      const through =
        Math.floor((Math.floor(Date.now() / 1000) - 1) / 300) * 300;
      const complete = remaining!.n <= rows.length;
      return {
        bank: {
          action: "income_batch",
          input: {
            events,
            ...(complete
              ? {
                  completeThrough: through,
                  reference: `exchange_income_${through}`,
                }
              : {}),
          },
        },
        statements: rows.map((row) =>
          s(
            "UPDATE trade_income_outbox SET delivered_at=COALESCE(delivered_at,unixepoch()) WHERE id=?",
            row.id,
          ),
        ),
        response: { delivered: rows.length },
      };
    },
  );
}
export async function syncEconomy(e: Env, batchLimit = 1) {
  for (let batch = 0; batch < Math.min(5, Math.max(1, batchLimit)); batch++) {
    await syncIncome(e);
    const pending = await e.DB.prepare(
      "SELECT COUNT(*) AS n FROM trade_income_outbox WHERE delivered_at IS NULL",
    ).first<{ n: number }>();
    if (!pending?.n) break;
  }
  const events = await bank<Event[]>(e, "/economy/outbox");
  for (const event of events) {
    await receiveEconomyEvent(e, event);
    await bank(e, "/economy/ack", {
      eventId: event.event_id,
      hash: event.payload_hash,
    });
  }
  const pending = await e.DB.prepare(
    "SELECT COUNT(*) AS n FROM trade_income_outbox WHERE delivered_at IS NULL",
  ).first<{ n: number }>();
  return {
    status: pending?.n ? "pending" : "synchronized",
    pendingIncome: pending?.n ?? 0,
  };
}
