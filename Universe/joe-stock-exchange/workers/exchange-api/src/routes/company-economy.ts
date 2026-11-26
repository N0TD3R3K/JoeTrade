import { captureEconomySnapshot } from "../lib/economy-snapshot";
import type { CompanyView, CompanyPostView } from "@joese/contracts";
import {
  calendar,
  seconds,
  weekBounds,
} from "../../../../../shared/economy/runtime";
import type { Env } from "../env";
import { requireOperator, requireUser, type SessionUser } from "../lib/auth";
import { bank } from "../lib/banking-client";
import { digest, execute, s } from "../lib/financial-operations";
import { HttpError, json, readJson } from "../lib/http";
import { syncEconomy } from "../lib/economy-delivery";
type Row = Record<string, any>;
const rows = async (e: Env, sql: string, ...p: (string | number | null)[]) =>
  (
    await e.DB.prepare(sql)
      .bind(...p)
      .all<Row>()
  ).results;
const row = async (e: Env, sql: string, ...p: (string | number | null)[]) =>
  e.DB.prepare(sql)
    .bind(...p)
    .first<Row>();
function text(v: unknown, name: string, max = 180): string {
  if (typeof v !== "string" || !v.trim() || v.length > max)
    throw new HttpError(400, "INVALID_FIELD", `Provide a valid ${name}.`);
  return v.trim();
}
export function bankActor(user: SessionUser, e: Env): string {
  if (user.bankCustomerId) return user.bankCustomerId;
  if (
    e.ENVIRONMENT === "local" &&
    e.LOCAL_DEMO === "true" &&
    user.id === "demo-market-operator" &&
    user.role !== "member"
  )
    return user.id;
  throw new HttpError(
    403,
    "BANK_ROLE_REQUIRED",
    "A linked banking role is required for this operation.",
  );
}
async function eligibility(e: Env, user: SessionUser, id: string) {
  const a = await row(
    e,
    "SELECT * FROM assets WHERE id=? AND asset_type='stock'",
    id,
  );
  if (!a)
    throw new HttpError(
      404,
      "COMPANY_UNAVAILABLE",
      "This company is unavailable.",
    );
  const holder = await row(
      e,
      "SELECT 1 FROM holdings WHERE user_id=? AND asset_id=? AND holding_kind IN ('stock','shareholding') AND quantity>0",
      user.id,
      id,
    ),
    manager =
      a.developer_user_id === user.id ||
      Boolean(
        await row(
          e,
          "SELECT 1 FROM company_product_roles WHERE asset_id=? AND user_id=? AND role='manager' AND revoked_at IS NULL",
          id,
          user.id,
        ),
      );
  return {
    asset: a,
    publish:
      a.active === 1 &&
      user.role === "member" &&
      (a.developer_user_id === user.id || Boolean(holder)),
    view: a.developer_user_id === user.id || Boolean(holder) || manager,
    manager,
  };
}
export async function companies(
  e: Env,
  user: SessionUser,
): Promise<CompanyView[]> {
  const assets = await rows(
    e,
    "SELECT DISTINCT a.* FROM assets a LEFT JOIN holdings h ON h.asset_id=a.id AND h.user_id=? AND h.quantity>0 AND h.holding_kind IN ('stock','shareholding') LEFT JOIN company_product_roles r ON r.asset_id=a.id AND r.user_id=? AND r.role='manager' AND r.revoked_at IS NULL WHERE a.asset_type='stock' AND (a.developer_user_id=? OR h.id IS NOT NULL OR r.user_id IS NOT NULL) ORDER BY a.ticker",
    user.id,
    user.id,
    user.id,
  );
  const result: CompanyView[] = [];
  for (const a of assets) {
    const access = await eligibility(e, user, a.id),
      holdings = await rows(
        e,
        "SELECT u.username AS name,SUM(h.quantity) AS quantity FROM holdings h JOIN users u ON u.id=h.user_id WHERE h.asset_id=? AND h.holding_kind IN ('stock','shareholding') AND h.quantity>0 AND u.role='member' GROUP BY u.id ORDER BY quantity DESC,u.username",
        a.id,
      ),
      allShares = (await row(
        e,
        "SELECT COALESCE(SUM(quantity),0) AS quantity FROM holdings WHERE asset_id=? AND holding_kind IN ('stock','shareholding')",
        a.id,
      ))!.quantity,
      [start] = weekBounds(calendar().weekKey),
      base = await row(
        e,
        "SELECT price_cents FROM price_points WHERE asset_id=? AND unixepoch(recorded_at)<? ORDER BY unixepoch(recorded_at) DESC LIMIT 1",
        a.id,
        start,
      );
    const report: CompanyView = {
      id: a.id,
      ticker: a.ticker,
      name: a.name,
      canPublish: access.publish,
      canManage: access.manager,
      shareholders: holdings.map((h) => ({
        name: h.name,
        quantity: h.quantity,
        percent: allShares > 0 ? (h.quantity / allShares) * 100 : 0,
      })),
      marketCapCents: Math.round(allShares * a.current_price_cents),
      weeklyChangePercent:
        base && base.price_cents > 0
          ? (a.current_price_cents / base.price_cents - 1) * 100
          : null,
      bank: null,
    };
    try {
      report.bank = await bank(
        e,
        `/economy/companies/${encodeURIComponent(a.id)}?actor=${encodeURIComponent(bankActor(user, e))}`,
      );
    } catch (error) {
      report.bankError =
        error instanceof Error
          ? error.message
          : "Company banking is unavailable.";
    }
    result.push(report);
  }
  return result;
}
export async function posts(
  e: Env,
  user: SessionUser,
  console = false,
): Promise<CompanyPostView[]> {
  const list = await rows(
    e,
    `SELECT p.*,u.username AS author_name,a.ticker FROM company_posts p JOIN users u ON u.id=p.author_id JOIN assets a ON a.id=p.asset_id WHERE ${console ? "1=1" : "p.state='published' OR p.author_id=?"} ORDER BY p.created_at DESC,p.id LIMIT 100`,
    ...(console ? [] : [user.id]),
  );
  return list.map((p) => ({
    ...p,
    canRemove: p.state !== "deleted" && (console || p.author_id === user.id),
  })) as CompanyPostView[];
}
async function postCommand(
  e: Env,
  user: SessionUser,
  key: string,
  path: string,
  b: Row,
) {
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(key))
    throw new HttpError(
      400,
      "IDEMPOTENCY_REQUIRED",
      "A stable operation reference is required.",
    );
  const id = `post_${await digest(user.id + ":" + key)}`,
    hash = await digest(JSON.stringify({ path, b })),
    old = await row(e, "SELECT * FROM company_commands WHERE id=?", id);
  if (old) {
    if (old.request_hash !== hash)
      throw new HttpError(
        409,
        "IDEMPOTENCY_CONFLICT",
        "This reference was used with different content.",
      );
    return JSON.parse(old.response_json);
  }
  const now = seconds(),
    statements: D1PreparedStatement[] = [];
  let result: Row;
  if (path === "/v1/posts") {
    const company = text(b.companyId, "company"),
      access = await eligibility(e, user, company);
    if (!access.publish)
      throw new HttpError(
        403,
        "COMPANY_OWNERSHIP_REQUIRED",
        "Publishing requires a developer link or settled shares in this company.",
      );
    statements.push(
      e.DB.prepare(
        "INSERT INTO company_posts(id,asset_id,author_id,title,body,state,created_at,updated_at) VALUES(?,?,?,?,?,'published',?,?)",
      ).bind(
        id,
        company,
        user.id,
        text(b.title, "post title"),
        text(b.body, "post body", 10000),
        now,
        now,
      ),
      e.DB.prepare(
        "INSERT INTO company_post_events(id,post_id,actor_id,action,occurred_at,resulting_version) VALUES(?,?,?,'publish',?,1)",
      ).bind(`${id}:published`, id, user.id, now),
    );
    result = { id, state: "published", version: 1 };
  } else {
    const match = /\/posts\/([^/]+)\/(withdraw|delete)$/.exec(path);
    if (!match) throw new HttpError(404, "NOT_FOUND", "Unknown post action.");
    const post = await row(
      e,
      "SELECT * FROM company_posts WHERE id=?",
      match[1],
    );
    if (!post || post.state === "deleted")
      throw new HttpError(
        409,
        "POST_UNAVAILABLE",
        "The post was already removed.",
      );
    const privileged =
      user.role === "operator" ||
      user.role === "administrator" ||
      Boolean(
        await row(
          e,
          "SELECT 1 FROM company_product_roles WHERE asset_id=? AND user_id=? AND role='moderator' AND revoked_at IS NULL",
          post.asset_id,
          user.id,
        ),
      );
    if (post.author_id !== user.id && !privileged)
      throw new HttpError(
        403,
        "FORBIDDEN",
        "Only the author or an authorized moderator can remove this post.",
      );
    if (b.version !== post.version)
      throw new HttpError(
        409,
        "POST_VERSION_CONFLICT",
        "This post changed. Refresh before removing it.",
      );
    const state = match[2] === "delete" ? "deleted" : "withdrawn",
      reason = privileged
        ? text(b.reason ?? "Operator moderation", "moderation reason", 500)
        : "Author request";
    statements.push(
      e.DB.prepare(
        "UPDATE company_posts SET state=?,title=CASE WHEN ?='deleted' THEN NULL ELSE title END,body=CASE WHEN ?='deleted' THEN NULL ELSE body END,version=version+1,updated_at=? WHERE id=? AND version=?",
      ).bind(state, state, state, now, post.id, post.version),
      e.DB.prepare(
        "INSERT INTO company_post_events(id,post_id,actor_id,action,reason,occurred_at,resulting_version) VALUES(?,?,?,?,?,?,?)",
      ).bind(id, post.id, user.id, match[2], reason, now, post.version + 1),
    );
    result = { id: post.id, state, version: post.version + 1 };
  }
  try {
    await e.DB.batch([
      e.DB.prepare(
        "INSERT INTO company_commands(id,actor_id,request_hash,response_json,created_at) VALUES(?,?,?,?,?)",
      ).bind(id, user.id, hash, JSON.stringify(result), now),
      ...statements,
    ]);
  } catch (error) {
    const replay = await row(
      e,
      "SELECT * FROM company_commands WHERE id=?",
      id,
    );
    if (replay && replay.request_hash === hash)
      return JSON.parse(replay.response_json);
    throw new HttpError(
      409,
      "POST_CONFLICT",
      "The company or post changed. Refresh and try again.",
    );
  }
  return result;
}
const memberActions = new Set([
  "checkout.accept",
  "subscription.cancel",
  "subscription.retry",
  "loan.accept",
  "loan.decline",
  "loan.repay",
  "employee.accept",
  "employee.end",
  "service.request",
  "plan.create",
  "company.pool",
  "employee.invite",
  "payroll.run",
  "payment.refund",
]);
const operatorActions = new Set([
  "policy.draft",
  "policy.approve",
  "reserve.initialize",
  "member.eligibility",
  "grant.reconcile",
  "grant.issue",
  "service.approve",
  "service.suspend",
  "rate.schedule",
  "rate.cancel",
  "loan.offer",
  "loan.withdraw",
  "tax.assess",
  "tax.collect",
  "tax.refund",
  "income.resolve",
  "redistribution.run",
]);
export async function handleCompanyEconomy(
  r: Request,
  u: URL,
  e: Env,
): Promise<Response | null> {
  if (e.BANKING_MODE !== "connected") return null;
  const isConsole =
    u.pathname.startsWith("/v1/console/economy") ||
    u.pathname.startsWith("/v1/console/posts");
  if (
    !isConsole &&
    !u.pathname.startsWith("/v1/economy") &&
    !u.pathname.startsWith("/v1/companies") &&
    !u.pathname.startsWith("/v1/posts")
  )
    return null;
  const user = isConsole
    ? await requireOperator(r, e)
    : await requireUser(r, e);
  if (!isConsole && user.role !== "member")
    throw new HttpError(403, "MEMBER_REQUIRED", "Use a member account.");
  if (r.method === "GET") {
    if (u.pathname === "/v1/console/economy/cost-lots")
      return json(
        await rows(
          e,
          "SELECT l.id,l.quantity_units,l.remaining_units,u.username,a.ticker FROM trade_cost_lots l JOIN users u ON u.id=l.user_id JOIN assets a ON a.id=l.asset_id WHERE l.state='unresolved' AND l.remaining_units>0 ORDER BY u.username,a.ticker LIMIT 100",
        ),
      );
    if (u.pathname === "/v1/companies") return json(await companies(e, user));
    if (u.pathname === "/v1/posts" || u.pathname === "/v1/console/posts")
      return json(await posts(e, user, isConsole));
    if (u.pathname === "/v1/economy/me")
      return json(
        await bank(
          e,
          `/economy/members/${encodeURIComponent(bankActor(user, e))}`,
        ),
      );
    if (u.pathname.startsWith("/v1/economy/plans/"))
      return json(
        await bank(
          e,
          "/economy/plans/" +
            encodeURIComponent(u.pathname.slice("/v1/economy/plans/".length)),
        ),
      );
    if (u.pathname === "/v1/console/economy")
      return json(
        await bank(
          e,
          `/economy/status?actor=${encodeURIComponent(bankActor(user, e))}`,
        ),
      );
  }
  if (r.method === "POST") {
    if (Number(r.headers.get("content-length")) > 24000)
      throw new HttpError(413, "BODY_TOO_LARGE", "The operation is too large.");
    const raw = await r.text();
    if (new TextEncoder().encode(raw).length > 24000)
      throw new HttpError(413, "BODY_TOO_LARGE", "The operation is too large.");
    if (!r.headers.get("content-type")?.includes("application/json"))
      throw new HttpError(415, "JSON_REQUIRED", "Use JSON for this operation.");
    let b: Row;
    try {
      b = JSON.parse(raw);
      if (!b || typeof b !== "object" || Array.isArray(b)) throw new Error();
    } catch {
      throw new HttpError(400, "INVALID_JSON", "Provide an operation object.");
    }
    const key = r.headers.get("idempotency-key") ?? "";
    const basis = /^\/v1\/console\/economy\/cost-lots\/([^/]+)\/verify$/.exec(
      u.pathname,
    );
    if (basis)
      return json(
        await execute(e, user.id, key, { route: u.pathname, b }, async (id) => {
          const lot = await row(
            e,
            "SELECT * FROM trade_cost_lots WHERE id=? AND state='unresolved'",
            decodeURIComponent(basis[1]),
          );
          if (!lot || lot.remaining_units !== b.expectedRemainingUnits)
            throw new HttpError(
              409,
              "BASIS_CHANGED",
              "Refresh the remaining quantity before reviewing its basis.",
            );
          const original = Number(b.originalBasisCents),
            remaining = Number(b.remainingBasisCents);
          if (
            !Number.isSafeInteger(original) ||
            !Number.isSafeInteger(remaining) ||
            remaining < 0 ||
            original < remaining ||
            original > 1e12
          )
            throw new HttpError(
              400,
              "INVALID_BASIS",
              "Provide exact nonnegative original and remaining basis in cents.",
            );
          const evidence = text(b.evidence, "journal/cost evidence", 2000);
          return {
            bank: { action: "noop" },
            statements: [
              s(
                "UPDATE trade_cost_lots SET state='verified',total_basis_cents=?,remaining_basis_cents=? WHERE id=?",
                original,
                remaining,
                lot.id,
              ),
              s(
                "INSERT INTO trade_basis_reviews(id,lot_id,actor_id,reviewed_at,evidence_reference,original_basis_cents,remaining_basis_cents) VALUES(?,?,?,?,?,?,?)",
                id,
                lot.id,
                user.id,
                seconds(),
                evidence,
                original,
                remaining,
              ),
            ],
            response: { id: lot.id, state: "verified" },
          };
        }),
      );
    if (
      u.pathname === "/v1/posts" ||
      /\/(?:console\/)?posts\/[^/]+\/(withdraw|delete)$/.test(u.pathname)
    )
      return json(await postCommand(e, user, key, u.pathname, b));
    if (u.pathname === "/v1/companies/register") {
      const access = await eligibility(e, user, text(b.companyId, "company"));
      if (!access.manager || access.asset.developer_user_id !== user.id)
        throw new HttpError(
          403,
          "MANAGER_REQUIRED",
          "Only the registered developer can initialize company banking.",
        );
      const launch = await row(
        e,
        "SELECT f.id FROM financial_operations f JOIN listing_proposals p ON p.launched_asset_id=? WHERE f.state='complete' AND json_extract(f.bank_json,'$.action')='capital' AND json_extract(f.response_json,'$.id')=p.launched_asset_id",
        access.asset.id,
      );
      return json(
        await bank(e, "/economy/commands", {
          actorId: bankActor(user, e),
          key,
          action: "company.register",
          input: {
            assetId: access.asset.id,
            ownerId: bankActor(user, e),
            name: access.asset.name,
            ...(launch ? { capitalLedgerId: launch.id } : {}),
          },
        }),
      );
    }
    if (u.pathname === "/v1/console/economy/sync") {
      return json(await syncEconomy(e, 5));
    }
    if (u.pathname === "/v1/console/economy/snapshot") {
      await syncEconomy(e);
      return json(
        await captureEconomySnapshot(
          e,
          bankActor(user, e),
          key,
          b.revise === true,
        ),
      );
    }
    if (
      u.pathname === "/v1/economy/commands" ||
      u.pathname === "/v1/console/economy/commands"
    ) {
      const action = text(b.action, "command"),
        allowed = isConsole ? operatorActions : memberActions;
      if (!allowed.has(action))
        throw new HttpError(
          403,
          "COMMAND_NOT_ALLOWED",
          "This action is unavailable for this account.",
        );
      if (!b.input || typeof b.input !== "object" || Array.isArray(b.input))
        throw new HttpError(400, "INVALID_INPUT", "Provide an operation body.");
      return json(
        await bank(e, "/economy/commands", {
          actorId: bankActor(user, e),
          key,
          action,
          input: b.input,
        }),
      );
    }
  }
  throw new HttpError(
    404,
    "NOT_FOUND",
    "This company or economy route is unavailable.",
  );
}
