import { useEffect, useState, type FormEvent } from "react";
import type { MemberEconomy } from "@joese/contracts";
import { centralRequest } from "../../../../shared/central-client";
import {
  economyAction,
  money,
  nyTime,
  toCents,
} from "../../../../shared/economy-client";
type Plan = {
  id: string;
  title: string;
  terms: string;
  terms_hash: string;
  kind: string;
  amount_cents: number;
  interval_days: number | null;
  merchant_name: string;
};
export function MemberBankPanel({
  onChanged,
}: {
  onChanged: () => Promise<void>;
}) {
  const [data, setData] = useState<MemberEconomy | null>(null),
    [plan, setPlan] = useState<Plan | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const planId = new URLSearchParams(window.location.search).get("plan");
  const load = async () => {
    try {
      setData(await centralRequest("member", "/economy/me"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    setPlan(null);
    if (planId)
      void centralRequest<Plan>(
        "member",
        "/economy/plans/" + encodeURIComponent(planId),
      )
        .then(setPlan)
        .catch((e) => setError((e as Error).message));
  }, [planId]);
  const action = async (name: string, input: unknown, message: string) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = (await economyAction("member", name, input)) as {
        state?: string;
      };
      setNotice(
        result.state === "past_due"
          ? "Payment was not posted. The subscription remains past due."
          : message,
      );
      if (name === "checkout.accept") setPlan(null);
      await Promise.all([load(), onChanged()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  function repay(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    try {
      void action(
        "loan.repay",
        {
          id,
          amountCents: toCents(new FormData(event.currentTarget).get("amount")),
        },
        "Loan repayment posted.",
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section className="workspace-card member-bank-panel">
      <h2>Banking activity</h2>
      <p>
        Manage bank offers, service subscriptions and employee agreements using
        this same account.
      </p>
      {error && (
        <div className="economy-alert" role="alert">
          {error}
          <button onClick={() => void load()}>Retry banking activity</button>
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      {plan && (
        <section className="economy-consent">
          <h3>
            {plan.title} · {plan.merchant_name}
          </h3>
          <strong>
            {money(plan.amount_cents)}
            {plan.kind === "subscription"
              ? ` every ${plan.interval_days} calendar days`
              : " once"}
          </strong>
          <p className="company-post-body">{plan.terms}</p>
          {plan.kind === "subscription" && (
            <p>
              Renewals use the New York time of your consent. You can cancel
              future charges here. Failed renewals need your explicit retry.
            </p>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void action(
                "checkout.accept",
                { planId: plan.id, termsHash: plan.terms_hash, consent: true },
                "Payment posted. Your service receives a durable payment receipt.",
              );
            }}
          >
            <label className="economy-checkbox">
              <input type="checkbox" required />I accept these exact terms and
              authorize this J$ payment
              {plan.kind === "subscription" ? " and recurring charges" : ""}.
            </label>
            <button disabled={busy}>
              Authorize {money(plan.amount_cents)}
            </button>
          </form>
        </section>
      )}
      {data && (
        <>
          <div className="economy-list">
            <h3>Loan offers & loans</h3>
            {!data.offers.length && <p>No bank loan offers.</p>}
            {data.offers.map((o) => (
              <div className="economy-consent" key={o.id}>
                <h4>
                  {o.terms.title} · {money(o.principal_cents)}
                </h4>
                <p>
                  {o.terms.termWeeks} weeks ·{" "}
                  {(o.terms.weeklyRatePpm / 10000).toFixed(3)}% per week ·{" "}
                  {o.terms.variable
                    ? "Variable with Joe Rate plus the accepted spread"
                    : "Fixed accepted rate"}{" "}
                  · {o.state}
                </p>
                {o.state === "offered" && (
                  <>
                    <p>
                      Offer expires {nyTime(o.expires_at)}. No cash or interest
                      begins before acceptance. Interest is simple and accrues
                      on outstanding principal; no automatic penalty or forced
                      asset sale.
                    </p>
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        void action(
                          "loan.accept",
                          { id: o.id, termsHash: o.terms_hash },
                          "Loan accepted and reserve-funded cash posted.",
                        );
                      }}
                    >
                      <label className="economy-checkbox">
                        <input type="checkbox" required />I accept this
                        principal, term and weekly interest rule.
                      </label>
                      <div className="economy-actions">
                        <button disabled={busy}>Accept loan terms</button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void action(
                              "loan.decline",
                              { id: o.id },
                              "Loan offer declined.",
                            )
                          }
                        >
                          Decline
                        </button>
                      </div>
                    </form>
                  </>
                )}
                {o.contract && (
                  <>
                    <p>
                      Outstanding principal{" "}
                      {money(o.contract.principal_outstanding_cents)} · accrued
                      interest {money(o.contract.interest_due_cents)} ·{" "}
                      {o.contract.state} · due {nyTime(o.contract.dueAt)}
                    </p>
                    {o.contract.state === "active" && (
                      <form
                        className="economy-inline-form"
                        onSubmit={(event) => repay(event, o.contract!.id)}
                      >
                        <label>
                          Repayment (J$)
                          <input
                            name="amount"
                            type="number"
                            min="0.01"
                            step="0.01"
                            required
                          />
                        </label>
                        <button disabled={busy}>Repay loan</button>
                      </form>
                    )}
                    <small>
                      Interest is updated when accrued or repaid. Payment pays
                      accrued interest first, then principal.
                    </small>
                  </>
                )}
              </div>
            ))}
          </div>
          <div className="economy-list">
            <h3>Service subscriptions</h3>
            {!data.subscriptions.length && <p>No subscriptions authorized.</p>}
            {data.subscriptions.map((s) => (
              <div className="economy-line" key={s.id}>
                <div>
                  <strong>{s.title}</strong>
                  <p>
                    {money(s.amount_cents)} · {s.state} · next charge{" "}
                    {nyTime(s.next_charge_at)}
                  </p>
                </div>
                <div className="economy-actions">
                  {s.state === "past_due" && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void action(
                          "subscription.retry",
                          { id: s.id },
                          "Subscription payment posted.",
                        )
                      }
                    >
                      Retry authorized payment
                    </button>
                  )}
                  {["active", "past_due"].includes(s.state) && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void action(
                          "subscription.cancel",
                          { id: s.id },
                          "Future subscription charges canceled.",
                        )
                      }
                    >
                      Cancel future charges
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="economy-list">
            <h3>Employee agreements</h3>
            {!data.employees.length && <p>No employee agreements.</p>}
            {data.employees.map((a) => (
              <div key={a.id} className="economy-consent">
                <h4>{a.company_name}</h4>
                <p>
                  {a.allocation_bps / 100}% of the company’s{" "}
                  {a.employee_pool_bps === null
                    ? "configured"
                    : `${a.employee_pool_bps / 100}%`}{" "}
                  employee revenue pool · {a.state}. Wages use funded,
                  closed-week operating revenue.
                </p>
                {a.state === "invited" && (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void action(
                        "employee.accept",
                        { id: a.id, termsHash: a.terms_hash },
                        "Employee agreement accepted.",
                      );
                    }}
                  >
                    <label className="economy-checkbox">
                      <input required type="checkbox" />I accept this employee
                      allocation agreement.
                    </label>
                    <button disabled={busy}>Accept agreement</button>
                  </form>
                )}
                <button
                  disabled={busy}
                  onClick={() =>
                    void action(
                      "employee.end",
                      { id: a.id },
                      "Employee agreement ended.",
                    )
                  }
                >
                  End agreement
                </button>
              </div>
            ))}
          </div>
          <div className="economy-list">
            <h3>Weekly tax statements</h3>
            {!data.taxes.length && <p>No closed-week assessments yet.</p>}
            {data.taxes.map((t) => (
              <div className="economy-line" key={t.id}>
                <span>
                  Week {t.week_key} · revision {t.revision}
                </span>
                <span>
                  {t.basis_complete
                    ? `Income ${money(t.taxable_cents)} · tax ${money(t.assessed_cents)} · paid ${money(t.paid_cents)}`
                    : "Held for cost-basis or exchange evidence review"}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
