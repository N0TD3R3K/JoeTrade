import { calendar, seconds } from "../../../../../shared/economy/runtime";
import type { Env } from "../env";
import { bank } from "./banking-client";
import { digest, execute } from "./financial-operations";
type Snapshot = {
  dateKey: string;
  state: string;
  metrics: Record<string, unknown>;
  capturedAt: number;
} | null;
export async function captureEconomySnapshot(
  e: Env,
  actor: string,
  key: string,
  revise = false,
) {
  await execute(
    e,
    actor,
    key,
    { kind: "economy_snapshot", revise },
    async () => {
      const component = await bank<{ checkpoint: string }>(
        e,
        "/economy/component",
      );
      const assets = await e.DB.prepare(
        "SELECT COALESCE(SUM(CAST(ROUND(h.quantity*a.current_price_cents) AS INTEGER)),0) AS amount FROM holdings h JOIN assets a ON a.id=h.asset_id JOIN users u ON u.id=h.user_id WHERE u.role='member' AND u.status='active'",
      ).first<{ amount: number }>();
      const members = (
        await e.DB.prepare(
          "SELECT bank_customer_id FROM users WHERE role='member' AND status='active' AND bank_customer_id IS NOT NULL",
        ).all<{ bank_customer_id: string }>()
      ).results
        .map((m) => m.bank_customer_id)
        .sort();
      const market = {
        assetsCents: assets!.amount,
        asOf: seconds(),
        locked: true,
        memberCheckpoint: await digest(JSON.stringify(members)),
        checkpoint: await digest(JSON.stringify({ assets, members })),
      };
      return {
        bank: {
          action: "economy_snapshot",
          actor_id: actor,
          revise,
          input: { bankCheckpoint: component.checkpoint, exchange: market },
        },
        statements: [],
        response: { state: "captured" },
      };
    },
  );
  return bank<Snapshot>(e, "/economy/snapshot");
}
export async function captureDueEconomySnapshot(e: Env) {
  const now = seconds(),
    today = calendar(now);
  if (today.hour < 12) return;
  const snapshot = await bank<Snapshot>(e, "/economy/snapshot");
  if (snapshot?.dateKey === today.dateKey && snapshot.state === "reconciled")
    return;
  const component = await bank<{ checkpoint: string }>(e, "/economy/component");
  const market = await e.DB.prepare(
    "SELECT COALESCE(SUM(CAST(ROUND(h.quantity*a.current_price_cents) AS INTEGER)),0) AS amount FROM holdings h JOIN assets a ON a.id=h.asset_id JOIN users u ON u.id=h.user_id WHERE u.role='member' AND u.status='active'",
  ).first();
  const key = `noon_${await digest(today.dateKey + ":" + component.checkpoint + ":" + JSON.stringify(market))}`;
  return captureEconomySnapshot(
    e,
    "economy-service",
    key,
    snapshot?.dateKey === today.dateKey,
  );
}
