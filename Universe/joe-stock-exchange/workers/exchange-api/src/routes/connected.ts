import { acquisition, legacyLots, saleBasis } from "../lib/cost-basis";
import {
  feeForGross,
  grossForTrade,
  isStockQuantityValid,
  isCryptoQuantityValid,
  marketTradingStatus,
  quoteForPrice,
  reserveForBuy,
} from "@joese/market-rules";
import type { Env } from "../env";
import { requireUser, requireOperator, type SessionUser } from "../lib/auth";
import { bank, bankBalance } from "../lib/banking-client";
import {
  execute,
  recover,
  releaseJobs,
  s,
  type Plan,
  type Statement,
  digest,
} from "../lib/financial-operations";
import { HttpError, json, readJson } from "../lib/http";
import type { CompanyDetails } from "@joese/contracts";
import { validatedCompanyDetails } from "./operations";
import { mapAsset } from "./market";
type Row = Record<string, unknown>;
const uid = () => crypto.randomUUID();
const number = (v: unknown, max = 1e12) => {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v <= 0 || v > max)
    throw new HttpError(
      400,
      "INVALID_AMOUNT",
      "Use positive whole cents or whole shares within the displayed limits.",
    );
  return v;
};
const text = (v: unknown, min: number, max: number) => {
  if (typeof v !== "string" || v.trim().length < min || v.length > max)
    throw new HttpError(
      400,
      "INVALID_FIELD",
      "Check the required listing and transaction fields.",
    );
  return v.trim();
};
function key(r: Request) {
  const key = r.headers.get("idempotency-key") ?? "";
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(key))
    throw new HttpError(
      400,
      "IDEMPOTENCY_REQUIRED",
      "Provide a stable Idempotency-Key.",
    );
  return key;
}
function member(u: SessionUser) {
  if (u.role !== "member" || !u.bankCustomerId)
    throw new HttpError(
      403,
      "MEMBER_REQUIRED",
      "An active, linked member account is required.",
    );
}
function audit(
  actor: string,
  action: string,
  target: string,
  details: unknown,
): Statement {
  return s(
    "INSERT INTO audit_log(id,actor_user_id,action,target_type,target_id,after_json) VALUES(?,?,?,?,?,?)",
    uid(),
    actor,
    action,
    "exchange",
    target,
    JSON.stringify(details),
  );
}
function windowOpen(e: Env) {
  if (
    e.ENFORCE_TRADING_SCHEDULE !== "false" &&
    marketTradingStatus(new Date()) !== "open"
  )
    throw new HttpError(
      423,
      "MARKET_CLOSED",
      "Trading follows the New York market schedule and update locks.",
    );
}
async function account(e: Env, id: string) {
  const row = await e.DB.prepare(
    "SELECT id,bank_customer_id FROM users WHERE id=? AND role='member' AND status='active'",
  )
    .bind(id)
    .first<{ id: string; bank_customer_id: string }>();
  if (!row?.bank_customer_id)
    throw new HttpError(
      409,
      "MEMBER_UNAVAILABLE",
      "This linked member is unavailable.",
    );
  return row;
}
const holdingKind = (type: unknown) => (type === "crypto" ? "crypto" : "stock");
function holdingCredit(
  user: string,
  asset: string,
  kind: string,
  quantity: number,
  cost: number,
  frozen = false,
): Statement {
  return s(
    `INSERT INTO holdings(id,user_id,asset_id,holding_kind,quantity,frozen_quantity,average_cost_cents) VALUES(?,?,?,?,?,?,?)
 ON CONFLICT(user_id,asset_id,holding_kind) DO UPDATE SET average_cost_cents=CAST(ROUND((holdings.quantity*holdings.average_cost_cents+excluded.quantity*excluded.average_cost_cents)/(holdings.quantity+excluded.quantity)) AS INTEGER),quantity=holdings.quantity+excluded.quantity,frozen_quantity=holdings.frozen_quantity+excluded.frozen_quantity,updated_at=CURRENT_TIMESTAMP`,
    uid(),
    user,
    asset,
    kind,
    quantity,
    frozen ? quantity : 0,
    cost,
  );
}
async function matchPair(e: Env, asset: string) {
  return e.DB.prepare(
    `SELECT b.id AS bid,b.user_id AS buyer,b.remaining_quantity AS bq,b.limit_price_cents AS bp,b.reserved_cash_cents AS reserve,
 s.id AS sid,s.user_id AS seller,s.remaining_quantity AS sq,s.limit_price_cents AS sp,a.asset_type FROM orders b JOIN orders s ON s.asset_id=b.asset_id JOIN assets a ON a.id=b.asset_id
 WHERE b.asset_id=? AND a.active=1 AND b.side='buy' AND s.side='sell' AND b.status IN ('open','partially_filled') AND s.status IN ('open','partially_filled') AND b.remaining_quantity>0 AND s.remaining_quantity>0 AND b.limit_price_cents>=s.limit_price_cents AND b.user_id!=s.user_id
 ORDER BY b.limit_price_cents DESC,b.created_at,b.id,s.limit_price_cents,s.created_at,s.id LIMIT 1`,
  )
    .bind(asset)
    .first<Row>();
}
export async function matchConnected(e: Env, asset: string, maxFills = 2) {
  let trades = 0;
  for (let pass = 0; pass < maxFills; pass++) {
    const found = await matchPair(e, asset);
    if (!found) break;
    const stamp = JSON.stringify([found.bid, found.sid, found.bq, found.sq]),
      trade = `trade_${await digest(stamp)}`;
    await execute(e, "matcher", trade, { trade }, async (bankOperation) => {
      windowOpen(e);
      const m = await matchPair(e, asset);
      if (!m || JSON.stringify([m.bid, m.sid, m.bq, m.sq]) !== stamp)
        throw new HttpError(
          409,
          "MATCH_CHANGED",
          "The matching queue changed. Retry the order refresh.",
        );
      const buyer = await account(e, String(m.buyer));
      const issuance = m.seller === "usr-joese-issuer";
      const seller = issuance ? null : await account(e, String(m.seller));
      const qty = Math.round(Math.min(Number(m.bq), Number(m.sq)) * 100) / 100,
        bgross = grossForTrade(Number(m.bp), qty),
        sgross = grossForTrade(Number(m.sp), qty);
      const bleft = Math.round((Number(m.bq) - qty) * 100) / 100,
        sleft = Math.round((Number(m.sq) - qty) * 100) / 100,
        remainingReserve = bleft > 0 ? reserveForBuy(Number(m.bp), bleft) : 0;
      const buyerFee = Math.min(
          feeForGross(bgross),
          Math.max(0, Number(m.reserve) - remainingReserve - bgross),
        ),
        debit = bgross + buyerFee,
        proceeds = sgross - feeForGross(sgross),
        clearing = debit - (issuance ? 0 : proceeds);
      const effects = [
        s(
          "UPDATE orders SET remaining_quantity=?,reserved_cash_cents=reserved_cash_cents-?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
          bleft,
          debit,
          bleft === 0 ? "filled" : "partially_filled",
          String(m.bid),
        ),
        s(
          "UPDATE orders SET remaining_quantity=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
          sleft,
          sleft === 0 ? "filled" : "partially_filled",
          String(m.sid),
        ),
        s(
          "UPDATE holdings SET quantity=quantity-?,reserved_quantity=reserved_quantity-? WHERE user_id=? AND asset_id=? AND holding_kind=?",
          qty,
          qty,
          String(m.seller),
          asset,
          holdingKind(m.asset_type),
        ),
        holdingCredit(
          buyer.id,
          asset,
          holdingKind(m.asset_type),
          qty,
          Number(m.bp),
        ),
        s(
          "INSERT INTO trades(id,asset_id,buyer_id,seller_id,buy_order_id,sell_order_id,quantity,price_cents,buyer_fee_cents,seller_fee_cents,buyer_price_cents,seller_price_cents,spread_cents) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
          trade,
          asset,
          buyer.id,
          String(m.seller),
          String(m.bid),
          String(m.sid),
          qty,
          Math.round((Number(m.bp) + Number(m.sp)) / 2),
          buyerFee,
          feeForGross(sgross),
          Number(m.bp),
          Number(m.sp),
          bgross - sgross,
        ),
        audit(buyer.id, "trade.settle", trade, {
          quantity: qty,
          debit,
          proceeds,
          bankOperation,
        }),
      ];
      effects.push(
        ...(await legacyLots(e, buyer.id, asset, holdingKind(m.asset_type)))
          .effects,
        acquisition(
          buyer.id,
          asset,
          holdingKind(m.asset_type),
          qty,
          debit,
          `${trade}:buyer`,
        ),
      );
      if (seller)
        effects.push(
          ...(await saleBasis(
            e,
            seller.id,
            String(seller.bank_customer_id),
            asset,
            holdingKind(m.asset_type),
            qty,
            proceeds,
            trade,
            bankOperation,
          )),
        );
      if (!bleft) {
        effects.push(
          s(
            "INSERT INTO bank_release_jobs(id,customer_id,hold_id) VALUES(?,?,?)",
            `${trade}:release`,
            buyer.bank_customer_id,
            String(m.bid),
          ),
          s(
            "UPDATE orders SET reserved_cash_cents=0 WHERE id=?",
            String(m.bid),
          ),
        );
      }
      return {
        bank: {
          action: "settle",
          customer_id: buyer.bank_customer_id,
          hold_id: m.bid,
          amount_cents: debit,
          credits: [
            ...(seller && proceeds > 0
              ? [
                  {
                    customer_id: seller.bank_customer_id,
                    amount_cents: proceeds,
                  },
                ]
              : []),
            ...(clearing > 0
              ? [{ customer_id: null, amount_cents: clearing }]
              : []),
          ],
        },
        statements: effects,
        response: { trade, status: "filled" },
      };
    });
    trades++;
    await releaseJobs(e, 1);
  }
  return trades;
}

export async function handleConnected(
  r: Request,
  u: URL,
  e: Env,
): Promise<Response | null> {
  if (e.BANKING_MODE !== "connected") return null;
  if (u.pathname.startsWith("/v1/auth/"))
    throw new HttpError(
      410,
      "JOEAUTH_REQUIRED",
      "Use JoeAuth to sign in. Passwords and identity are managed centrally.",
    );
  if (
    u.pathname === "/v1/internal/bootstrap-admin" ||
    u.pathname === "/v1/console/invitations" ||
    /\/console\/members\/[^/]+\/(resend-verification|pending-registration|financial-status)$/.test(
      u.pathname,
    )
  ) {
    await requireOperator(r, e);
    throw new HttpError(
      410,
      "CENTRAL_ACCOUNTS_REQUIRED",
      "Identity and eligibility are managed through JoeAuth; banking classifications belong to Joe Banking.",
    );
  }
  const edit = /^\/v1\/console\/assets\/([A-Z0-9]+)$/i.exec(u.pathname);
  if (edit && r.method === "PATCH") {
    const user = await requireOperator(r, e);
    const b = await readJson<{
      name?: string;
      description?: string;
      companyDetails?: CompanyDetails;
      active?: boolean;
    }>(r);
    return json(
      await execute(
        e,
        user.id,
        key(r),
        { route: u.pathname, ...b },
        async () => {
          const a = await e.DB.prepare("SELECT * FROM assets WHERE ticker=?")
            .bind(edit[1].toUpperCase())
            .first<Row>();
          if (!a)
            throw new HttpError(
              404,
              "ASSET_NOT_FOUND",
              "That listing was not found.",
            );
          if (b.active !== undefined && b.active !== Boolean(a.active))
            throw new HttpError(
              409,
              "MARKET_MANAGES_STATUS",
              "Listing status is managed by the market lifecycle. This form edits company details.",
            );
          const name =
            b.name === undefined ? String(a.name) : text(b.name, 2, 100);
          const description =
            b.description === undefined
              ? String(a.description)
              : text(b.description, 10, 2000);
          const details = b.companyDetails
            ? JSON.stringify(validatedCompanyDetails(b.companyDetails))
            : String(a.company_details_json);
          const after = {
            ...a,
            name,
            description,
            company_details_json: details,
          };
          return {
            bank: { action: "noop" },
            statements: [
              s(
                "UPDATE assets SET name=?,description=?,company_details_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
                name,
                description,
                details,
                String(a.id),
              ),
              audit(user.id, "asset.update", String(a.id), {
                before: a,
                after,
              }),
            ],
            response: mapAsset(after) as unknown as Record<string, unknown>,
          };
        },
      ),
    );
  }
  if (
    u.pathname.startsWith("/v1/joe-bank") ||
    u.pathname.startsWith("/v1/console/loans")
  ) {
    await requireUser(r, e);
    if (r.method === "GET" && u.pathname === "/v1/console/loans")
      return json([]);
    if (r.method === "GET")
      return json({
        financialStatus: "normal",
        canApply: false,
        maxLoanCents: 0,
        defaultAnnualRateBps: 0,
        loans: [],
        disclosure:
          "Joe Banking owns balances and lending. New loan products are not available yet.",
      });
    throw new HttpError(
      409,
      "BANKING_OWNS_LENDING",
      "Manage banking products in Joe Banking. Exchange-local lending is disabled.",
    );
  }
  if (
    u.pathname === "/v1/listings" ||
    u.pathname === "/v1/console/listing-proposals" ||
    (u.pathname === "/v1/console/assets" && r.method === "POST")
  ) {
    const isConsole = u.pathname.startsWith("/v1/console/"),
      user = isConsole ? await requireOperator(r, e) : await requireUser(r, e);
    if (!isConsole) member(user);
    if (r.method === "GET") {
      const rows = await e.DB.prepare(
        `SELECT p.*,u.username AS founder_name FROM listing_proposals p JOIN users u ON u.id=p.developer_user_id ${isConsole ? "" : "WHERE p.developer_user_id=?"} ORDER BY p.created_at DESC`,
      )
        .bind(...(isConsole ? [] : [user.id]))
        .all();
      return json(rows.results);
    }
    if (r.method === "POST") {
      const b = await readJson<Record<string, unknown>>(r),
        ticker = text(b.ticker, 3, 3).toUpperCase();
      if (!/^[A-Z]{3}$/.test(ticker))
        throw new HttpError(
          400,
          "INVALID_TICKER",
          "Stock tickers must contain three letters.",
        );
      const founder = isConsole
          ? await account(e, text(b.developerUserId, 1, 128))
          : await account(e, user.id),
        contribution = number(b.contributionCents),
        shares = number(b.shares, 1000000),
        name = text(b.name, 2, 100),
        description = text(b.description, 10, 2000),
        project = text(b.projectUrl, 8, 500);
      if (contribution < 500000)
        throw new HttpError(
          400,
          "FOUNDING_MINIMUM",
          "A listing needs at least J$5,000 of founding capital.",
        );
      try {
        if (new URL(project).protocol !== "https:") throw new Error();
      } catch {
        throw new HttpError(
          400,
          "INVALID_PROJECT",
          "Use an HTTPS project URL.",
        );
      }
      const result = await execute(
        e,
        user.id,
        key(r),
        { route: "listing-proposal", ...b },
        async (id) => {
          if (
            await e.DB.prepare(
              "SELECT id FROM assets WHERE ticker=? UNION ALL SELECT id FROM listing_proposals WHERE ticker=?",
            )
              .bind(ticker, ticker)
              .first()
          )
            throw new HttpError(
              409,
              "TICKER_TAKEN",
              "This ticker is already listed.",
            );
          return {
            bank: { action: "noop" },
            statements: [
              s(
                "INSERT INTO listing_proposals(id,ticker,name,description,project_url,developer_user_id,contribution_cents,shares,status,created_by) VALUES(?,?,?,?,?,?,?,?,?,?)",
                id,
                ticker,
                name,
                description,
                project,
                founder.id,
                contribution,
                shares,
                isConsole ? "awaiting_founder" : "awaiting_review",
                user.id,
              ),
              audit(user.id, "listing.propose", id, {
                ticker,
                founder: founder.id,
                contribution,
              }),
            ],
            response: {
              id,
              ticker,
              status: isConsole ? "awaiting_founder" : "awaiting_review",
            },
          };
        },
      );
      return json(result, 201);
    }
  }
  const approve =
    /^\/v1\/console\/listing-proposals\/([^/]+)\/(approve|decline)$/.exec(
      u.pathname,
    );
  if (approve && r.method === "POST") {
    const user = await requireOperator(r, e);
    return json(
      await execute(e, user.id, key(r), { route: u.pathname }, async () => {
        const p = await e.DB.prepare(
          "SELECT * FROM listing_proposals WHERE id=? AND status IN ('awaiting_review','awaiting_founder')",
        )
          .bind(approve[1])
          .first<Row>();
        if (!p)
          throw new HttpError(
            409,
            "PROPOSAL_UNAVAILABLE",
            "This proposal is no longer pending.",
          );
        return {
          bank: { action: "noop" },
          statements: [
            s(
              "UPDATE listing_proposals SET status=? WHERE id=?",
              approve[2] === "approve" ? "awaiting_founder" : "declined",
              approve[1],
            ),
            audit(user.id, `listing.${approve[2]}`, approve[1], {}),
          ],
          response: {
            status: approve[2] === "approve" ? "awaiting_founder" : "declined",
          },
        };
      }),
    );
  }
  const launch = /^\/v1\/listing-proposals\/([^/]+)\/launch$/.exec(u.pathname);
  if (launch && r.method === "POST") {
    const user = await requireUser(r, e);
    member(user);
    return json(
      await execute(e, user.id, key(r), { route: u.pathname }, async (id) => {
        const p = await e.DB.prepare(
          "SELECT * FROM listing_proposals WHERE id=? AND developer_user_id=? AND status='awaiting_founder'",
        )
          .bind(launch[1], user.id)
          .first<Row>();
        if (!p)
          throw new HttpError(
            409,
            "PROPOSAL_UNAVAILABLE",
            "An approved proposal belonging to you is required.",
          );
        const price = Math.max(
            1,
            Math.round(Number(p.contribution_cents) / Number(p.shares)),
          ),
          asset = `asset_${p.id}`;
        return {
          bank: {
            action: "capital",
            customer_id: user.bankCustomerId,
            amount_cents: p.contribution_cents,
            credits: [
              { customer_id: null, amount_cents: p.contribution_cents },
            ],
          },
          statements: [
            s(
              `INSERT INTO assets(id,ticker,name,asset_type,description,company_details_json,developer_user_id,current_price_cents,open_price_cents,high_price_cents,low_price_cents,close_price_cents,previous_close_cents,ordinary_drift,volatility,hourly_cap,daily_cap) VALUES(?,?,?,'stock',?,?,?,?,?,?,?,?,?,0.001,0.02,0.12,0.35)`,
              asset,
              String(p.ticker),
              String(p.name),
              String(p.description),
              JSON.stringify({
                overview: p.description,
                developer: user.username,
                projectUrl: p.project_url,
              }),
              user.id,
              price,
              price,
              price,
              price,
              price,
              price,
            ),
            acquisition(
              user.id,
              asset,
              "shareholding",
              Number(p.shares),
              Number(p.contribution_cents),
              `${id}:founder`,
            ),
            holdingCredit(
              user.id,
              asset,
              "shareholding",
              Number(p.shares),
              price,
              true,
            ),
            s(
              "INSERT INTO price_points(id,asset_id,price_cents,recorded_at) VALUES(?,?,?,CURRENT_TIMESTAMP)",
              uid(),
              asset,
              price,
            ),
            s(
              "UPDATE listing_proposals SET status='launched',launched_asset_id=? WHERE id=?",
              asset,
              String(p.id),
            ),
            audit(user.id, "listing.launch", asset, {
              capital: p.contribution_cents,
              shares: p.shares,
              bankOperation: id,
            }),
          ],
          response: { id: asset, ticker: p.ticker, status: "launched" },
        };
      }),
    );
  }
  if (u.pathname === "/v1/orders" && r.method === "POST") {
    const user = await requireUser(r, e);
    member(user);
    windowOpen(e);
    const b = await readJson<Record<string, unknown>>(r);
    const ticker = text(b.ticker, 1, 8).toUpperCase(),
      side = b.side;
    const quantity = Number(b.quantity);
    if (!["buy", "sell"].includes(String(side)))
      throw new HttpError(400, "INVALID_SIDE", "Choose buy or sell.");
    const result = await execute(
      e,
      user.id,
      key(r),
      { route: "order", ...b },
      async (id) => {
        windowOpen(e);
        const a = await e.DB.prepare(
          "SELECT * FROM assets WHERE ticker=? AND active=1",
        )
          .bind(ticker)
          .first<Row>();
        if (!a)
          throw new HttpError(
            404,
            "ASSET_NOT_FOUND",
            "Listing is unavailable.",
          );
        if (
          quantity > 1000000 ||
          !(a.asset_type === "stock"
            ? isStockQuantityValid(quantity)
            : isCryptoQuantityValid(quantity))
        )
          throw new HttpError(
            400,
            "INVALID_QUANTITY",
            "Use whole stock shares or two decimal crypto units.",
          );
        const quote = quoteForPrice(Number(a.current_price_cents)),
          price =
            b.limitPriceCents === undefined
              ? side === "buy"
                ? quote.askCents
                : quote.bidCents
              : number(b.limitPriceCents);
        const reserve = side === "buy" ? reserveForBuy(price, quantity) : 0;
        if (reserve > 1e12)
          throw new HttpError(
            400,
            "ORDER_TOO_LARGE",
            "Order value is too large.",
          );
        const effects: Statement[] = [];
        if (side === "sell") {
          const h = await e.DB.prepare(
            "SELECT * FROM holdings WHERE user_id=? AND asset_id=? AND holding_kind=?",
          )
            .bind(user.id, String(a.id), holdingKind(a.asset_type))
            .first<Row>();
          if (
            !h ||
            Number(h.quantity) -
              Number(h.frozen_quantity) -
              Number(h.reserved_quantity) <
              quantity
          )
            throw new HttpError(
              409,
              "INSUFFICIENT_HOLDING",
              "Not enough freely tradable shares. Frozen founder shares require a private offer to a member.",
            );
          effects.push(
            s(
              "UPDATE holdings SET reserved_quantity=reserved_quantity+? WHERE id=?",
              quantity,
              String(h.id),
            ),
          );
        }
        effects.push(
          s(
            "INSERT INTO orders(id,user_id,asset_id,side,quantity,remaining_quantity,limit_price_cents,reserved_cash_cents) VALUES(?,?,?,?,?,?,?,?)",
            id,
            user.id,
            String(a.id),
            String(side),
            quantity,
            quantity,
            price,
            reserve,
          ),
          audit(user.id, "order.create", id, { ticker, side, quantity }),
        );
        return {
          bank:
            side === "buy"
              ? {
                  action: "reserve",
                  customer_id: user.bankCustomerId,
                  hold_id: id,
                  amount_cents: reserve,
                }
              : { action: "noop" },
          statements: effects,
          response: { id, assetId: a.id, status: "open", ticker },
        };
      },
    );
    let matchedTrades = 0;
    try {
      matchedTrades = await matchConnected(e, String(result.assetId));
    } catch (error) {
      return json(
        {
          ...result,
          status: "settlement_pending",
          matchedTrades,
          message:
            error instanceof HttpError
              ? error.message
              : "Matching is deferred; the order remains recorded.",
        },
        201,
      );
    }
    const order = await e.DB.prepare(
      "SELECT status,remaining_quantity FROM orders WHERE id=?",
    )
      .bind(result.id)
      .first<Row>();
    return json({ ...result, ...order, matchedTrades }, 201);
  }
  const cancel = /^\/v1\/orders\/([^/]+)\/cancel$/.exec(u.pathname);
  if (cancel && r.method === "POST") {
    const user = await requireUser(r, e);
    member(user);
    return json(
      await execute(e, user.id, key(r), { route: u.pathname }, async () => {
        const o = await e.DB.prepare(
          "SELECT o.*,a.asset_type FROM orders o JOIN assets a ON a.id=o.asset_id WHERE o.id=? AND o.user_id=? AND o.status IN ('open','partially_filled')",
        )
          .bind(cancel[1], user.id)
          .first<Row>();
        if (!o)
          throw new HttpError(
            409,
            "ORDER_UNAVAILABLE",
            "This order is no longer open.",
          );
        return {
          bank:
            o.side === "buy"
              ? {
                  action: "release",
                  customer_id: user.bankCustomerId,
                  hold_id: o.id,
                }
              : { action: "noop" },
          statements: [
            ...(o.side === "sell"
              ? [
                  s(
                    "UPDATE holdings SET reserved_quantity=reserved_quantity-? WHERE user_id=? AND asset_id=? AND holding_kind=?",
                    Number(o.remaining_quantity),
                    user.id,
                    String(o.asset_id),
                    holdingKind(o.asset_type),
                  ),
                ]
              : []),
            s(
              "UPDATE orders SET status='cancelled',remaining_quantity=0,reserved_cash_cents=0 WHERE id=?",
              String(o.id),
            ),
            audit(user.id, "order.cancel", String(o.id), {}),
          ],
          response: { id: o.id, status: "cancelled" },
        };
      }),
    );
  }
  if (u.pathname === "/v1/share-offers" && r.method === "POST") {
    const user = await requireUser(r, e);
    member(user);
    const b = await readJson<Record<string, unknown>>(r),
      buyerKey = text(b.buyer, 1, 254).toLowerCase(),
      qty = number(b.quantity, 1000000),
      price = number(b.askingPriceCents),
      ticker = text(b.ticker, 3, 3).toUpperCase();
    return json(
      await execute(
        e,
        user.id,
        key(r),
        { route: "offer", ...b },
        async (id) => {
          const buyer = await e.DB.prepare(
            "SELECT id,bank_customer_id FROM users WHERE (lower(username)=? OR lower(email)=?) AND role='member' AND status='active'",
          )
            .bind(buyerKey, buyerKey)
            .first<Row>();
          if (!buyer?.bank_customer_id || buyer.id === user.id)
            throw new HttpError(
              404,
              "BUYER_UNAVAILABLE",
              "Choose another eligible member.",
            );
          const h = await e.DB.prepare(
            "SELECT h.*,a.active FROM holdings h JOIN assets a ON a.id=h.asset_id WHERE h.user_id=? AND a.ticker=? AND h.holding_kind='shareholding'",
          )
            .bind(user.id, ticker)
            .first<Row>();
          if (!h || !h.active || Number(h.frozen_quantity) < qty)
            throw new HttpError(
              409,
              "INSUFFICIENT_FROZEN_ASSETS",
              "Not enough unreserved frozen shares.",
            );
          return {
            bank: { action: "noop" },
            statements: [
              s(
                "UPDATE holdings SET frozen_quantity=frozen_quantity-?,reserved_quantity=reserved_quantity+? WHERE id=?",
                qty,
                qty,
                String(h.id),
              ),
              s(
                "INSERT INTO share_offers(id,seller_id,buyer_id,asset_id,quantity,asking_price_cents) VALUES(?,?,?,?,?,?)",
                id,
                user.id,
                String(buyer.id),
                String(h.asset_id),
                qty,
                price,
              ),
              audit(user.id, "share_offer.create", id, {
                buyer: buyer.id,
                qty,
                price,
              }),
            ],
            response: { id, status: "pending" },
          };
        },
      ),
      201,
    );
  }
  const offer = /^\/v1\/share-offers\/([^/]+)\/(accept|decline|cancel)$/.exec(
    u.pathname,
  );
  if (offer && r.method === "POST") {
    const user = await requireUser(r, e);
    member(user);
    return json(
      await execute(
        e,
        user.id,
        key(r),
        { route: u.pathname },
        async (bankOperation) => {
          const o = await e.DB.prepare(
            "SELECT o.*,a.active FROM share_offers o JOIN assets a ON a.id=o.asset_id WHERE o.id=? AND o.status='pending'",
          )
            .bind(offer[1])
            .first<Row>();
          if (
            !o ||
            (offer[2] === "cancel" ? o.seller_id : o.buyer_id) !== user.id
          )
            throw new HttpError(
              404,
              "OFFER_UNAVAILABLE",
              "This pending offer is unavailable.",
            );
          const qty = Number(o.quantity),
            gross = Number(o.asking_price_cents),
            fee = feeForGross(gross),
            accepted = offer[2] === "accept";
          if (accepted && !o.active)
            throw new HttpError(
              409,
              "LISTING_INACTIVE",
              "Delisted shares cannot be purchased.",
            );
          const seller = await account(e, String(o.seller_id));
          const effects: Statement[] = accepted
            ? [
                s(
                  "UPDATE holdings SET quantity=quantity-?,reserved_quantity=reserved_quantity-? WHERE user_id=? AND asset_id=? AND holding_kind='shareholding'",
                  qty,
                  qty,
                  seller.id,
                  String(o.asset_id),
                ),
                holdingCredit(
                  user.id,
                  String(o.asset_id),
                  "shareholding",
                  qty,
                  Math.round(gross / qty),
                  true,
                ),
              ]
            : [
                s(
                  "UPDATE holdings SET frozen_quantity=frozen_quantity+?,reserved_quantity=reserved_quantity-? WHERE user_id=? AND asset_id=? AND holding_kind='shareholding'",
                  qty,
                  qty,
                  seller.id,
                  String(o.asset_id),
                ),
              ];
          if (accepted)
            effects.push(
              ...(
                await legacyLots(e, user.id, String(o.asset_id), "shareholding")
              ).effects,
              acquisition(
                user.id,
                String(o.asset_id),
                "shareholding",
                qty,
                gross + fee,
                `offer:${o.id}:buyer`,
              ),
              ...(await saleBasis(
                e,
                seller.id,
                String(seller.bank_customer_id),
                String(o.asset_id),
                "shareholding",
                qty,
                gross - fee,
                `offer:${o.id}`,
                bankOperation,
              )),
            );
          effects.push(
            s(
              "UPDATE share_offers SET status=?,resolved_at=CURRENT_TIMESTAMP WHERE id=?",
              accepted
                ? "accepted"
                : offer[2] === "decline"
                  ? "declined"
                  : "cancelled",
              String(o.id),
            ),
            audit(user.id, `share_offer.${offer[2]}`, String(o.id), {
              quantity: qty,
              gross,
            }),
          );
          return {
            bank: accepted
              ? {
                  action: "payment",
                  customer_id: user.bankCustomerId,
                  amount_cents: gross + fee,
                  credits: [
                    {
                      customer_id: seller.bank_customer_id,
                      amount_cents: gross - fee,
                    },
                    ...(fee > 0
                      ? [{ customer_id: null, amount_cents: fee * 2 }]
                      : []),
                  ],
                }
              : { action: "noop" },
            statements: effects,
            response: {
              id: o.id,
              status: accepted
                ? "accepted"
                : offer[2] === "decline"
                  ? "declined"
                  : "cancelled",
            },
          };
        },
      ),
    );
  }
  if (u.pathname === "/v1/transfers" && r.method === "POST") {
    const user = await requireUser(r, e);
    member(user);
    const b = await readJson<Record<string, unknown>>(r);
    return json(
      await bank(e, "/wires", {
        action: "create",
        customer_id: user.bankCustomerId,
        key: `wire_${await digest(`${user.id}:${key(r)}`)}`,
        recipient: b.receiver,
        amount_cents: number(b.amountCents),
        memo: String(b.message ?? "").slice(0, 240),
      }),
      201,
    );
  }
  const wire = /^\/v1\/transfers\/([^/]+)\/(accept|decline|cancel)$/.exec(
    u.pathname,
  );
  if (wire && r.method === "POST") {
    const user = await requireUser(r, e);
    member(user);
    return json(
      await bank(e, "/wires", {
        action: wire[2],
        id: wire[1],
        customer_id: user.bankCustomerId,
        key: `wire_${await digest(`${user.id}:${key(r)}`)}`,
      }),
    );
  }
  if (u.pathname === "/v1/console/financial-operations" && r.method === "GET") {
    await requireOperator(r, e);
    await recover(e);
    return json(
      (
        await e.DB.prepare(
          "SELECT id,actor_id,state,created_at,error_json FROM financial_operations ORDER BY created_at DESC LIMIT 100",
        ).all()
      ).results,
    );
  }
  return null;
}
