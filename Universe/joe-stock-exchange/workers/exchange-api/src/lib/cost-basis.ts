import type { Env } from "../env";
import { s, type Statement } from "./financial-operations";
import { HttpError } from "./http";
interface Lot {
  id: string;
  remaining_units: number;
  remaining_basis_cents: number | null;
  state: string;
}
const units = (qty: number) => {
  const value = Math.round(qty * 100);
  if (
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    Math.abs(value - qty * 100) > 0.001
  )
    throw new HttpError(
      409,
      "INVALID_BASIS_QUANTITY",
      "The share quantity cannot be represented exactly.",
    );
  return value;
};
export function acquisition(
  user: string,
  asset: string,
  kind: string,
  qty: number,
  basis: number,
  reference: string,
  at = Math.floor(Date.now() / 1000),
): Statement {
  return s(
    "INSERT INTO trade_cost_lots(id,user_id,asset_id,holding_kind,source_reference,acquired_at,quantity_units,remaining_units,total_basis_cents,remaining_basis_cents,state) VALUES(?,?,?,?,?,?,?,?,?,?,'verified')",
    `lot:${reference}`,
    user,
    asset,
    kind,
    reference,
    at,
    units(qty),
    units(qty),
    basis,
    basis,
  );
}
/** Preserve pre-migration quantities as unknown; only complete journal evidence may verify them. */
export async function legacyLots(
  e: Env,
  user: string,
  asset: string,
  kind: string,
): Promise<{ lots: Lot[]; effects: Statement[] }> {
  const lots = (
    await e.DB.prepare(
      "SELECT * FROM trade_cost_lots WHERE user_id=? AND asset_id=? AND holding_kind=? AND remaining_units>0 ORDER BY acquired_at,id",
    )
      .bind(user, asset, kind)
      .all<Lot>()
  ).results;
  const holding = await e.DB.prepare(
    "SELECT quantity FROM holdings WHERE user_id=? AND asset_id=? AND holding_kind=?",
  )
    .bind(user, asset, kind)
    .first<{ quantity: number }>();
  const missing =
      Math.round((holding?.quantity ?? 0) * 100) -
      lots.reduce((n, l) => n + l.remaining_units, 0),
    effects: Statement[] = [];
  if (missing < 0)
    throw new HttpError(
      409,
      "BASIS_RECONCILIATION",
      "Cost-lot quantities exceed this holding. A reviewed reconciliation is required.",
    );
  if (missing > 0) {
    const id = `legacy:${user}:${asset}:${kind}`,
      founder =
        kind === "shareholding"
          ? await e.DB.prepare(
              "SELECT p.contribution_cents,p.shares,p.developer_user_id FROM listing_proposals p WHERE p.launched_asset_id=? AND p.status='launched'",
            )
              .bind(asset)
              .first<{
                contribution_cents: number;
                shares: number;
                developer_user_id: string;
              }>()
          : null;
    const transfers = await e.DB.prepare(
      "SELECT COUNT(*) AS n FROM share_offers WHERE asset_id=? AND status='accepted' AND (seller_id=? OR buyer_id=?)",
    )
      .bind(asset, user, user)
      .first<{ n: number }>();
    const verified = Boolean(
        founder &&
        founder.developer_user_id === user &&
        founder.shares * 100 === missing &&
        lots.length === 0 &&
        transfers?.n === 0,
      ),
      basis = verified ? founder!.contribution_cents : null;
    effects.push(
      s(
        "INSERT INTO trade_cost_lots(id,user_id,asset_id,holding_kind,source_reference,acquired_at,quantity_units,remaining_units,total_basis_cents,remaining_basis_cents,state) VALUES(?,?,?,?,?,0,?,?,?,?,?)",
        id,
        user,
        asset,
        kind,
        id,
        missing,
        missing,
        basis,
        basis,
        verified ? "verified" : "unresolved",
      ),
    );
    lots.unshift({
      id,
      remaining_units: missing,
      remaining_basis_cents: basis,
      state: verified ? "verified" : "unresolved",
    });
  }
  return { lots, effects };
}
export async function saleBasis(
  e: Env,
  user: string,
  bankCustomer: string,
  asset: string,
  kind: string,
  qty: number,
  netProceeds: number,
  reference: string,
  bankOperationId: string,
): Promise<Statement[]> {
  const legacy = await legacyLots(e, user, asset, kind),
    effects = legacy.effects,
    quantity = units(qty),
    at = Math.floor(Date.now() / 1000);
  let remaining = quantity,
    proceedsLeft = netProceeds,
    totalBasis = 0,
    complete = true;
  const evidence: unknown[] = [];
  for (const lot of legacy.lots) {
    if (remaining === 0) break;
    const used = Math.min(remaining, lot.remaining_units),
      proceeds =
        used === remaining
          ? proceedsLeft
          : Number((BigInt(netProceeds) * BigInt(used)) / BigInt(quantity));
    let basis: number | null = null;
    if (lot.state === "verified") {
      basis =
        used === lot.remaining_units
          ? lot.remaining_basis_cents!
          : Number(
              (BigInt(lot.remaining_basis_cents!) * BigInt(used)) /
                BigInt(lot.remaining_units),
            );
      totalBasis += basis;
      effects.push(
        s(
          "INSERT INTO trade_basis_disposals(id,lot_id,sale_reference,quantity_units,allocated_basis_cents,net_proceeds_cents,realized_gain_cents) VALUES(?,?,?,?,?,?,?)",
          `${reference}:${lot.id}`,
          lot.id,
          reference,
          used,
          basis,
          proceeds,
          proceeds - basis,
        ),
      );
    } else complete = false;
    effects.push(
      s(
        "UPDATE trade_cost_lots SET remaining_units=remaining_units-?,remaining_basis_cents=CASE WHEN remaining_basis_cents IS NULL THEN NULL ELSE remaining_basis_cents-? END WHERE id=?",
        used,
        basis ?? 0,
        lot.id,
      ),
    );
    evidence.push({
      lotId: lot.id,
      units: used,
      basisCents: basis,
      proceedsCents: proceeds,
    });
    remaining -= used;
    proceedsLeft -= proceeds;
  }
  if (remaining !== 0)
    throw new HttpError(
      409,
      "BASIS_RECONCILIATION",
      "The sale quantity has no matching holding evidence.",
    );
  const category =
    kind === "crypto"
      ? "realized_crypto_gain"
      : kind === "shareholding"
        ? "realized_frozen_share_gain"
        : "realized_stock_gain";
  effects.push(
    s(
      "INSERT INTO trade_income_outbox(id,customer_id,sale_reference,category,occurred_at,gain_cents,basis_complete,evidence_json) VALUES(?,?,?,?,?,?,?,?)",
      `gain:${reference}`,
      bankCustomer,
      reference,
      category,
      at,
      complete ? netProceeds - totalBasis : null,
      complete ? 1 : 0,
      JSON.stringify({
        bankOperationId,
        assetId: asset,
        kind,
        quantityUnits: quantity,
        netProceedsCents: netProceeds,
        lots: evidence,
      }),
    ),
  );
  return effects;
}
