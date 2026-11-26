import { useEffect, useState, type FormEvent } from "react";
import type {
  BankingPolicy,
  CompanyPostView,
  EconomyStatus,
} from "@joese/contracts";
import { centralRequest } from "../../../../shared/central-client";
import {
  economyAction,
  money,
  nyTime,
  percentagePpm,
  toCents,
} from "../../../../shared/economy-client";
import { EconomyDialog } from "../../../../shared/EconomyDialog";
import "./bank-economy.css";
type Status = EconomyStatus & {
  services: {
    id: string;
    display_name: string;
    joe_auth_app_id: string;
    state: string;
    company_name: string;
  }[];
  basisHolds: {
    customer_id: string;
    week_key: string;
    source_reference: string;
    member_name: string;
  }[];
};
export function BankEconomyDesk() {
  const [status, setStatus] = useState<Status | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [rateOpen, setRateOpen] = useState(false),
    [products, setProducts] = useState<number[]>([]),
    [posts, setPosts] = useState<CompanyPostView[]>([]),
    [costLots, setCostLots] = useState<
      {
        id: string;
        quantity_units: number;
        remaining_units: number;
        username: string;
        ticker: string;
      }[]
    >([]);
  const load = async () => {
    const results = await Promise.allSettled([
      centralRequest<Status>("console", "/console/economy"),
      centralRequest<CompanyPostView[]>("console", "/console/posts"),
      centralRequest<typeof costLots>("console", "/console/economy/cost-lots"),
    ]);
    if (results[0].status === "fulfilled") {
      setStatus(results[0].value);
      setError("");
    } else setError((results[0].reason as Error).message);
    if (results[1].status === "fulfilled") setPosts(results[1].value);
    if (results[2].status === "fulfilled") setCostLots(results[2].value);
  };
  useEffect(() => {
    void load();
  }, []);
  const perform = async (run: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = (await run()) as { state?: string; reason?: string };
      setNotice(
        result?.state === "pending"
          ? (result.reason ?? "Operation is scheduled or pending.")
          : message,
      );
      await load();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const run = (
    action: string,
    input: unknown,
    message = "Operation recorded.",
  ) => perform(() => economyAction("console", action, input), message);
  function submit(action: string, map: (data: FormData) => unknown) {
    return (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      try {
        void run(action, map(new FormData(event.currentTarget)));
      } catch (e) {
        setError((e as Error).message);
      }
    };
  }
  function policyDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const d = new FormData(event.currentTarget),
        initialRatePpm = percentagePpm(d.get("initialRate")),
        loans = products.map((i) => ({
          id: String(d.get(`id${i}`)),
          title: String(d.get(`title${i}`)),
          minimumCents: toCents(d.get(`min${i}`)),
          maximumCents: toCents(d.get(`max${i}`)),
          termWeeks: Number(d.get(`term${i}`)),
          weeklyRatePpm: percentagePpm(d.get(`rate${i}`)),
          variable: d.get(`variable${i}`) === "variable",
          spreadPpm: percentagePpm(d.get(`spread${i}`)),
        }));
      const rules: BankingPolicy = {
        designVersion: "economy-v2",
        initialRatePpm,
        lendingBudgetCents: toCents(d.get("lending")),
        redistributionBudgetCents: toCents(d.get("redistribution")),
        openingGrantsEnabled: d.get("grants") === "on",
        loans,
      };
      void run(
        "policy.draft",
        { rules },
        "Policy draft saved. Review it below before approving.",
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const snapshot = status?.snapshot;
  return (
    <div className="bank-economy-desk">
      <header className="bank-section-header">
        <div>
          <span className="eyebrow">JOE BANK</span>
          <h1>Economy & circulation</h1>
          <p>Reserve, weekly rates, approved lending and member income.</p>
        </div>
        <button disabled={busy} onClick={() => void load()}>
          Refresh reports
        </button>
      </header>
      {error && (
        <div className="bank-alert" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="bank-notice" role="status">
          {notice}
        </div>
      )}
      {!status ? (
        <section className="bank-panel">
          <h2>Banking connection required</h2>
          <p>
            Sign in with a linked banking operator role. Retry when the service
            is available.
          </p>
          <button onClick={() => void load()}>Retry</button>
        </section>
      ) : (
        <>
          <div className="bank-metrics">
            <Metric
              label="Bank reserve"
              value={money(status.reserveCents)}
              detail={
                status.reserveCondition === "uninitialized"
                  ? "Not initialized"
                  : `${status.reserveCondition} · warning below J$90,000`
              }
            />
            <Metric
              label="Weekly Joe Rate"
              value={
                status.ratePpm === null
                  ? "Not approved"
                  : `${(status.ratePpm / 10000).toFixed(3)}%`
              }
              detail={`Rate version ${status.rateVersion}`}
            />
            <Metric
              label="Banking policy"
              value={
                status.policy
                  ? `Version ${status.policy.version}`
                  : "Needs approval"
              }
              detail={
                status.policy
                  ? "Approved configuration"
                  : "Cash features stay gated"
              }
            />
            <Metric
              label="Pending deliveries"
              value={String(status.outboxPending)}
              detail="Durable events waiting for exchange receipt"
            />
          </div>
          <section className="bank-panel">
            <div className="bank-section-header">
              <div>
                <h2>Daily New York noon snapshot</h2>
                <p>
                  {snapshot
                    ? `${snapshot.dateKey} · ${snapshot.state} · captured ${nyTime(snapshot.capturedAt)}`
                    : "No noon snapshot captured yet."}
                </p>
              </div>
              <div className="bank-actions">
                <button
                  disabled={busy || !status.policy}
                  onClick={() =>
                    void perform(
                      () =>
                        centralRequest("console", "/console/economy/snapshot", {
                          method: "POST",
                          body: JSON.stringify({ revise: false }),
                        }),
                      "Daily snapshot captured.",
                    )
                  }
                >
                  Capture due snapshot
                </button>
                {snapshot && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void perform(
                        () =>
                          centralRequest(
                            "console",
                            "/console/economy/snapshot",
                            {
                              method: "POST",
                              body: JSON.stringify({ revise: true }),
                            },
                          ),
                        "Audited snapshot revision captured.",
                      )
                    }
                  >
                    Reconcile snapshot
                  </button>
                )}
              </div>
            </div>
            {snapshot && (
              <div className="bank-metrics">
                {[
                  ["Market posted money", "marketPostedMoneyCents"],
                  ["Member posted cash", "memberPostedCents"],
                  ["Disposable cash", "memberAvailableCents"],
                  ["Cash held within posted cash", "memberHeldCents"],
                  ["Member market assets", "totalMemberAssetsCents"],
                  ["Average member assets", "averageAssetsCents"],
                  ["Average total portfolio", "averagePortfolioCents"],
                  ["Company operating cash", "companyOperatingCents"],
                  ["Locked company capital", "lockedCapitalCents"],
                  ["Week tax received", "weeklyTaxReceivedCents"],
                  ["Week tax refunds", "weeklyTaxRefundedCents"],
                  ["Week service refunds", "weeklyServiceRefundedCents"],
                  ["Week redistribution", "weeklyRedistributedCents"],
                  ["Week new opening grants", "weeklyOpeningGrantsCents"],
                  [
                    "Week deposit interest paid",
                    "weeklyDepositInterestPaidCents",
                  ],
                  ["Week employee payments", "weeklyWagesCents"],
                  [
                    "Week bank interest received",
                    "weeklyLoanInterestReceivedCents",
                  ],
                ].map(([label, key]) => (
                  <Metric
                    key={key}
                    label={label}
                    value={money(snapshot.metrics[key] as number | null)}
                  />
                ))}
                <Metric
                  label="Average assets vs J$10,000"
                  value={
                    typeof snapshot.metrics.averageAssetsVs10kPercent ===
                    "number"
                      ? `${snapshot.metrics.averageAssetsVs10kPercent.toFixed(2)}%`
                      : "Unavailable"
                  }
                />
              </div>
            )}
            <p className="bank-note">
              Holds are part of posted cash. Company cash, locked capital and
              market-valued shares are separate measures. Provisional snapshots
              show unavailable values where a shared cutoff was not verified.
            </p>
          </section>
          <div className="bank-grid">
            <section className="bank-panel">
              <h2>Interest rate operations</h2>
              <p>
                Change 0.005–0.200 percentage points, in 0.005 steps. Two
                effective operations per New York week. Future operations
                reserve slots and can be canceled.
              </p>
              <button
                disabled={busy || !status.policy || status.ratePpm === null}
                onClick={() => setRateOpen(true)}
              >
                Adjust weekly interest rate
              </button>
              <div className="bank-recommendation">
                <h3>
                  Operator recommendation:{" "}
                  {status.recommendation.action.replace("_", " ")}
                </h3>
                <p>{status.recommendation.explanation}</p>
                <details>
                  <summary>Forecast assumptions</summary>
                  <ul>
                    {status.recommendation.assumptions.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                </details>
              </div>
              <div className="bank-history">
                {status.rateOperations.map((o) => (
                  <div className="bank-line" key={o.id}>
                    <div>
                      <strong>
                        {(o.previous_rate_ppm / 10000).toFixed(3)}% to{" "}
                        {(o.next_rate_ppm / 10000).toFixed(3)}%
                      </strong>
                      <p>
                        {o.state} ·{" "}
                        {nyTime(
                          o.actual_effective_at ?? o.requested_effective_at,
                        )}
                      </p>
                      <p>{o.explanation}</p>
                    </div>
                    {o.state === "pending" && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          void run(
                            "rate.cancel",
                            { id: o.id },
                            "Scheduled rate operation canceled.",
                          )
                        }
                      >
                        Cancel scheduled operation
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button
                disabled={busy}
                onClick={() =>
                  void perform(
                    () =>
                      centralRequest("console", "/console/economy/sync", {
                        method: "POST",
                        body: "{}",
                      }),
                    "Income and bank events synchronized.",
                  )
                }
              >
                Retry event delivery
              </button>
            </section>
            <section className="bank-panel">
              <h2>Create a bank loan offer</h2>
              {!status.policy?.rules.loans.length ? (
                <p>
                  Add reviewed loan products to an approved policy to enable
                  offers.
                </p>
              ) : (
                <form
                  className="bank-form"
                  onSubmit={submit("loan.offer", (d) => ({
                    customerId: d.get("customer"),
                    productId: d.get("product"),
                    principalCents: toCents(d.get("principal")),
                    expiresAt:
                      Math.floor(Date.now() / 1000) +
                      Number(d.get("expires")) * 86400,
                  }))}
                >
                  <MemberSelect status={status} />
                  <label>
                    Approved product
                    <select name="product">
                      {status.policy.rules.loans.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.title} · {(p.weeklyRatePpm / 10000).toFixed(3)}%
                          weekly
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Principal (J$)
                    <input
                      name="principal"
                      type="number"
                      min="0.01"
                      step="0.01"
                      required
                    />
                  </label>
                  <label>
                    Offer valid for days
                    <input
                      name="expires"
                      type="number"
                      min="1"
                      max="30"
                      required
                      defaultValue="7"
                    />
                  </label>
                  <p>
                    The member must accept the exact offer before reserve funds
                    move or interest begins.
                  </p>
                  <button disabled={busy}>
                    Create offer for member acceptance
                  </button>
                </form>
              )}
              <div>
                {status.loans.map((o) => (
                  <div key={o.id} className="bank-line">
                    <div>
                      <strong>
                        {status.members.find((m) => m.id === o.customer_id)
                          ?.name ?? o.customer_id}{" "}
                        · {money(o.principal_cents)}
                      </strong>
                      <p>
                        {o.terms.title} · {o.state} · expires{" "}
                        {nyTime(o.expires_at)}
                      </p>
                      {o.contract && (
                        <p>
                          Principal{" "}
                          {money(o.contract.principal_outstanding_cents)} ·
                          interest {money(o.contract.interest_due_cents)}
                        </p>
                      )}
                    </div>
                    {o.state === "offered" && (
                      <button
                        disabled={busy}
                        onClick={() => void run("loan.withdraw", { id: o.id })}
                      >
                        Withdraw offer
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </section>
          </div>
          <section className="bank-panel">
            <h2>Weekly tax & redistribution</h2>
            <p>
              The selected bracket applies to the whole week’s taxable income.
              J$1,600 gives J$32. Realized gains use exact costs and fees;
              unknown evidence holds an assessment for review.
            </p>
            <form
              className="bank-inline-form"
              onSubmit={submit("tax.assess", (d) => ({
                customerId: d.get("customer"),
                week: d.get("week"),
              }))}
            >
              <MemberSelect status={status} />
              <label>
                Closed week, Monday
                <input name="week" type="date" required />
              </label>
              <button disabled={busy || !status.policy}>
                Assess closed week
              </button>
            </form>
            <div className="bank-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Member / week</th>
                    <th>Income</th>
                    <th>Tax / paid</th>
                    <th>Settlement</th>
                  </tr>
                </thead>
                <tbody>
                  {status.assessments.map((t) => (
                    <tr key={t.id}>
                      <td>
                        {status.members.find((m) => m.id === t.customer_id)
                          ?.name ?? t.customer_id}
                        <br />
                        {t.week_key} · revision {t.revision}
                      </td>
                      <td>{money(t.taxable_cents)}</td>
                      <td>
                        {t.basis_complete
                          ? `${money(t.assessed_cents)} / ${money(t.paid_cents)}`
                          : "Held for evidence"}
                      </td>
                      <td>
                        <div className="bank-actions">
                          <button
                            disabled={busy || !t.basis_complete}
                            onClick={() =>
                              void run(
                                "tax.collect",
                                { id: t.id },
                                "Available-funds tax collection recorded.",
                              )
                            }
                          >
                            Collect available cash
                          </button>
                          <button
                            disabled={
                              busy ||
                              !t.basis_complete ||
                              t.paid_cents <= t.assessed_cents
                            }
                            onClick={() =>
                              void run(
                                "tax.refund",
                                { id: t.id },
                                "Tax correction refunded.",
                              )
                            }
                          >
                            Refund excess
                          </button>
                        </div>
                        <details>
                          <summary>Correct this assessment</summary>
                          <form
                            className="bank-form"
                            onSubmit={submit("tax.assess", (d) => ({
                              customerId: t.customer_id,
                              week: t.week_key,
                              supersedesId: t.id,
                              evidence: d.get("evidence"),
                            }))}
                          >
                            <label>
                              Correction evidence
                              <input
                                name="evidence"
                                required
                                maxLength={2000}
                              />
                            </label>
                            <button disabled={busy}>
                              Create attributed revision
                            </button>
                          </form>
                        </details>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <form
              className="bank-inline-form"
              onSubmit={submit("redistribution.run", (d) => ({
                week: d.get("week"),
                amountCents: toCents(d.get("amount")),
              }))}
            >
              <label>
                Closed redistribution week
                <input name="week" type="date" required />
              </label>
              <label>
                Funded budget (J$)
                <input
                  name="amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                />
              </label>
              <button
                disabled={
                  busy || !status.policy?.rules.redistributionBudgetCents
                }
              >
                Distribute approved funded amount equally
              </button>
            </form>
            <p className="bank-note">
              Only received taxes and loan interest fund redistribution.
              Reviewed eligible members, the approved budget and reserve
              headroom above J$90,000 are checked again when posting.
            </p>
          </section>
          <section className="bank-panel">
            <h2>Company service approvals</h2>
            <p>
              Verify each JoeAuth app belongs to the named company before
              activating its billing plans.
            </p>
            {status.services.length === 0 ? (
              <p>No service applications.</p>
            ) : (
              status.services.map((s) => (
                <div className="bank-line" key={s.id}>
                  <div>
                    <strong>
                      {s.company_name} · {s.display_name}
                    </strong>
                    <p>
                      {s.joe_auth_app_id} · {s.state}
                    </p>
                  </div>
                  <button
                    disabled={busy || !status.policy}
                    onClick={() =>
                      void run(
                        s.state === "active"
                          ? "service.suspend"
                          : "service.approve",
                        { id: s.id },
                      )
                    }
                  >
                    {s.state === "active"
                      ? "Suspend billing service"
                      : "Approve service"}
                  </button>
                </div>
              ))
            )}
          </section>
          <section className="bank-panel">
            <h2>Company post moderation</h2>
            {posts.length === 0 ? (
              <p>No company posts.</p>
            ) : (
              posts.map((p) => (
                <div className="bank-line" key={p.id}>
                  <div>
                    <strong>
                      {p.ticker} · {p.title ?? "Deleted post"}
                    </strong>
                    <p>
                      {p.author_name} · {p.state}
                    </p>
                    <p className="bank-post-body">{p.body}</p>
                  </div>
                  {p.canRemove && (
                    <form
                      className="bank-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const d = new FormData(event.currentTarget);
                        void perform(
                          () =>
                            centralRequest(
                              "console",
                              `/console/posts/${p.id}/${d.get("action")}`,
                              {
                                method: "POST",
                                body: JSON.stringify({
                                  version: p.version,
                                  reason: d.get("reason"),
                                }),
                              },
                            ),
                          "Post moderation recorded.",
                        );
                      }}
                    >
                      <label>
                        Action
                        <select name="action">
                          <option value="withdraw">Withdraw</option>
                          <option value="delete">Delete title and body</option>
                        </select>
                      </label>
                      <label>
                        Moderation reason
                        <input name="reason" required maxLength={500} />
                      </label>
                      <button disabled={busy}>Apply moderation</button>
                    </form>
                  )}
                </div>
              ))
            )}
          </section>
          <section className="bank-panel">
            <h2>Bank policy configuration</h2>
            <p>
              A draft never moves funds. Review its terms, then approve the
              exact version. Existing accepted loan and payment terms stay
              unchanged.
            </p>
            <details>
              <summary>Create a policy version</summary>
              <form className="bank-form" onSubmit={policyDraft}>
                <div className="bank-grid">
                  <label>
                    Initial weekly Joe Rate (%)
                    <input
                      name="initialRate"
                      type="number"
                      min="0.3"
                      max="2"
                      step="0.005"
                      required
                    />
                  </label>
                  <label>
                    Total lending budget (J$)
                    <input
                      name="lending"
                      type="number"
                      min="0"
                      step="0.01"
                      required
                      defaultValue="0"
                    />
                  </label>
                  <label>
                    Maximum weekly redistribution (J$)
                    <input
                      name="redistribution"
                      type="number"
                      min="0"
                      step="0.01"
                      required
                      defaultValue="0"
                    />
                  </label>
                  <label className="bank-checkbox">
                    <input name="grants" type="checkbox" />
                    Enable reviewed once-only opening grants
                  </label>
                </div>
                <h3>Reviewed loan catalog</h3>
                <p>Leave the catalog empty to keep lending unavailable.</p>
                {products.map((i) => (
                  <fieldset key={i}>
                    <legend>Loan product {i + 1}</legend>
                    <div className="bank-grid">
                      <label>
                        Product reference
                        <input name={`id${i}`} required maxLength={60} />
                      </label>
                      <label>
                        Product name
                        <input name={`title${i}`} required maxLength={120} />
                      </label>
                      <label>
                        Minimum principal (J$)
                        <input
                          name={`min${i}`}
                          type="number"
                          min="0.01"
                          step="0.01"
                          required
                        />
                      </label>
                      <label>
                        Maximum principal (J$)
                        <input
                          name={`max${i}`}
                          type="number"
                          min="0.01"
                          step="0.01"
                          required
                        />
                      </label>
                      <label>
                        Term in weeks
                        <input
                          name={`term${i}`}
                          type="number"
                          min="1"
                          max="52"
                          required
                        />
                      </label>
                      <label>
                        Rate rule
                        <select name={`variable${i}`}>
                          <option value="fixed">Fixed</option>
                          <option value="variable">Joe Rate plus spread</option>
                        </select>
                      </label>
                      <label>
                        Weekly rate (%)
                        <input
                          name={`rate${i}`}
                          type="number"
                          min="0"
                          max="10"
                          step="0.001"
                          required
                        />
                      </label>
                      <label>
                        Variable spread, or 0 for fixed (%)
                        <input
                          name={`spread${i}`}
                          type="number"
                          min="0"
                          max="10"
                          step="0.001"
                          required
                          defaultValue="0"
                        />
                      </label>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setProducts(products.filter((p) => p !== i))
                      }
                    >
                      Remove draft product
                    </button>
                  </fieldset>
                ))}
                <div className="bank-actions">
                  <button
                    type="button"
                    onClick={() =>
                      setProducts([...products, (products.at(-1) ?? -1) + 1])
                    }
                  >
                    Add loan product
                  </button>
                  <button disabled={busy}>Save policy draft</button>
                </div>
              </form>
            </details>
            {status.policies.map((p) => (
              <details key={p.id}>
                <summary>
                  Policy version {p.version} · {p.state}
                  {status.policy?.id === p.id ? " · current" : ""}
                </summary>
                <p>
                  Opening weekly rate{" "}
                  {(p.rules.initialRatePpm / 10000).toFixed(3)}% · lending
                  budget {money(p.rules.lendingBudgetCents)} · redistribution
                  limit {money(p.rules.redistributionBudgetCents)} · opening
                  grants{" "}
                  {p.rules.openingGrantsEnabled
                    ? "enabled after eligibility review"
                    : "disabled"}
                </p>
                <ul>
                  {p.rules.loans.map((l) => (
                    <li key={l.id}>
                      {l.title}: {money(l.minimumCents)}–{money(l.maximumCents)}
                      , {l.termWeeks} weeks,{" "}
                      {(l.weeklyRatePpm / 10000).toFixed(3)}% weekly{" "}
                      {l.variable
                        ? `variable, ${(l.spreadPpm / 10000).toFixed(3)}% spread`
                        : "fixed"}
                    </li>
                  ))}
                </ul>
                {p.state === "draft" && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(
                        "policy.approve",
                        { id: p.id },
                        "Reviewed policy version approved.",
                      )
                    }
                  >
                    Approve this policy version
                  </button>
                )}
              </details>
            ))}
            {status.reserveCents === null && (
              <button
                disabled={busy || !status.policy}
                onClick={() =>
                  void run(
                    "reserve.initialize",
                    {},
                    "The J$100,000 opening bank reserve was posted once.",
                  )
                }
              >
                Initialize approved J$100,000 bank reserve
              </button>
            )}
            <details>
              <summary>Member eligibility & opening grant review</summary>
              <form
                className="bank-form"
                onSubmit={submit("member.eligibility", (d) => ({
                  customerId: d.get("customer"),
                  subject: d.get("subject"),
                  evidence: d.get("evidence"),
                }))}
              >
                <MemberSelect status={status} />
                <label>
                  Linked verified JoeAuth subject
                  <input name="subject" required maxLength={180} />
                </label>
                <label>
                  Identity and grant history review evidence
                  <input name="evidence" required maxLength={500} />
                </label>
                <button disabled={busy}>Approve member eligibility</button>
              </form>
              <form
                className="bank-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  const d = new FormData(event.currentTarget);
                  void run(
                    d.get("mode") === "reconcile"
                      ? "grant.reconcile"
                      : "grant.issue",
                    {
                      customerId: d.get("customer"),
                      ...(d.get("ledger") ? { ledgerId: d.get("ledger") } : {}),
                    },
                  );
                }}
              >
                <MemberSelect status={status} />
                <label>
                  Opening balance action
                  <select name="mode">
                    <option value="reconcile">
                      Record existing opening journal
                    </option>
                    <option value="issue">
                      Issue to a reviewed empty new account
                    </option>
                  </select>
                </label>
                <label>
                  Existing journal reference for reconciliation
                  <input name="ledger" />
                </label>
                <button disabled={busy}>
                  Record once-only opening balance
                </button>
              </form>
            </details>
            <details>
              <summary>Review remaining legacy cost lots</summary>
              <p>
                Verify exact journal evidence rather than the displayed average
                price. This fixes future sale costs; historical sales need the
                separate income correction below.
              </p>
              {costLots.length === 0 ? (
                <p>No unresolved remaining cost lots.</p>
              ) : (
                costLots.map((lot) => (
                  <form
                    className="bank-form"
                    key={lot.id}
                    onSubmit={(event) => {
                      event.preventDefault();
                      try {
                        const d = new FormData(event.currentTarget);
                        void perform(
                          () =>
                            centralRequest(
                              "console",
                              `/console/economy/cost-lots/${encodeURIComponent(lot.id)}/verify`,
                              {
                                method: "POST",
                                body: JSON.stringify({
                                  expectedRemainingUnits: lot.remaining_units,
                                  originalBasisCents: toCents(
                                    d.get("original"),
                                  ),
                                  remainingBasisCents: toCents(
                                    d.get("remaining"),
                                  ),
                                  evidence: d.get("evidence"),
                                }),
                              },
                            ),
                          "Reviewed remaining cost basis recorded.",
                        );
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    <strong>
                      {lot.username} · {lot.ticker} ·{" "}
                      {lot.remaining_units / 100} remaining units
                    </strong>
                    <label>
                      Original exact acquisition cost (J$)
                      <input
                        name="original"
                        type="number"
                        min="0"
                        step="0.01"
                        required
                      />
                    </label>
                    <label>
                      Exact cost of remaining holdings (J$)
                      <input
                        name="remaining"
                        type="number"
                        min="0"
                        step="0.01"
                        required
                      />
                    </label>
                    <label>
                      Journal / cost evidence
                      <textarea name="evidence" required maxLength={2000} />
                    </label>
                    <button disabled={busy}>
                      Verify this remaining cost lot
                    </button>
                  </form>
                ))
              )}
            </details>
            <details>
              <summary>Resolve unknown trading cost evidence</summary>
              <div>
                {status.basisHolds?.map((hold) => (
                  <p key={hold.source_reference}>
                    {hold.member_name} · {hold.week_key} ·{" "}
                    {hold.source_reference}
                  </p>
                ))}
              </div>
              <form
                className="bank-form"
                onSubmit={submit("income.resolve", (d) => ({
                  customerId: d.get("customer"),
                  reference: d.get("reference"),
                  week: d.get("week"),
                  occurredAt: Math.floor(
                    Date.parse(String(d.get("occurred"))) / 1000,
                  ),
                  category: d.get("category"),
                  gainCents: Math.round(Number(d.get("gain")) * 100),
                  evidence: d.get("evidence"),
                }))}
              >
                <MemberSelect status={status} />
                <label>
                  Sale reference
                  <input name="reference" required />
                </label>
                <label>
                  Original week, Monday
                  <input name="week" type="date" required />
                </label>
                <label>
                  Original sale instant, UTC
                  <input
                    name="occurred"
                    placeholder="2026-11-23T17:00:00Z"
                    required
                  />
                </label>
                <label>
                  Gain category
                  <select name="category">
                    <option value="realized_stock_gain">Stock gain</option>
                    <option value="realized_crypto_gain">Crypto gain</option>
                    <option value="realized_frozen_share_gain">
                      Frozen-share gain
                    </option>
                  </select>
                </label>
                <label>
                  Reviewed net realized gain (J$)
                  <input name="gain" type="number" step="0.01" required />
                </label>
                <label>
                  Reviewed journal and cost evidence
                  <textarea name="evidence" required maxLength={2000} />
                </label>
                <button disabled={busy}>
                  Record attributed cost correction
                </button>
              </form>
            </details>
          </section>
          {rateOpen && (
            <EconomyDialog
              title="Adjust weekly Joe Rate"
              onClose={() => setRateOpen(false)}
            >
              <p>
                Current weekly rate {(status.ratePpm! / 10000).toFixed(3)}%.
                Pending operations are applied in scheduled order.
              </p>
              <form
                className="bank-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  try {
                    const d = new FormData(event.currentTarget);
                    void run(
                      "rate.schedule",
                      {
                        policyVersion: status.policy!.version,
                        effectiveLocal: d.get("date"),
                        deltaPpm: percentagePpm(d.get("change")),
                        reasonCategory: d.get("reason"),
                        explanation: d.get("explanation"),
                        internalNote: d.get("note"),
                      },
                      "Rate operation recorded; an applied operation publishes one linked bulletin.",
                    ).then((ok) => {
                      if (ok) setRateOpen(false);
                    });
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                <label>
                  Operation date & time, New York
                  <input name="date" type="datetime-local" required />
                </label>
                <label>
                  Signed change in percentage points
                  <input
                    name="change"
                    type="number"
                    min="-0.2"
                    max="0.2"
                    step="0.005"
                    required
                    placeholder="-0.005"
                  />
                </label>
                <label>
                  Reason
                  <select name="reason">
                    <option value="normal_fluctuation">
                      Normal fluctuation
                    </option>
                    <option value="news_event">News event</option>
                  </select>
                </label>
                <label>
                  Public explanation
                  <textarea
                    name="explanation"
                    required
                    maxLength={2000}
                    rows={3}
                  />
                </label>
                <label>
                  Internal note
                  <textarea name="note" maxLength={2000} />
                </label>
                {error && (
                  <p className="bank-alert" role="alert">
                    {error}
                  </p>
                )}
                <p>
                  A cut adds a bullish model signal; an increase adds a bearish
                  signal. The market engine keeps its price caps. Future events
                  publish only when applied.
                </p>
                <button disabled={busy}>
                  {busy ? "Recording…" : "Record rate operation"}
                </button>
              </form>
            </EconomyDialog>
          )}
        </>
      )}
    </div>
  );
}
function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="bank-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  );
}
function MemberSelect({ status }: { status: EconomyStatus }) {
  return (
    <label>
      Member
      <select name="customer" required>
        <option value="">Choose a member</option>
        {status.members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
    </label>
  );
}
