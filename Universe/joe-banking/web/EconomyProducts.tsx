import { stockAccountUrl } from "../../shared/economy/links";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { MemberEconomy } from "../../shared/economy/runtime";
import { api, date, money, parseCents } from "./api";
export function BankRate() {
  const [rate, setRate] = useState<number | null>(null),
    [history, setHistory] = useState<
      { version: number; rate_ppm: number; effective_at: number }[]
    >([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    void Promise.all([
      api<{ weekly_rate_ppm: number | null }>("/rates/current"),
      api<typeof history>("/rates/history"),
    ])
      .then(([r, h]) => {
        setRate(r.weekly_rate_ppm);
        setHistory(h);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);
  return (
    <section className="panel banking-products">
      <span className="eyebrow">WEEKLY JOE RATE</span>
      <h2>
        {loading
          ? "Loading weekly Joe Rate…"
          : error
            ? "Weekly Joe Rate unavailable"
            : rate === null
              ? "Initial rate awaits policy approval"
              : `${(rate / 10000).toFixed(3)}% per week`}
      </h2>
      <p>
        Rate changes affect prospective variable interest. Accepted fixed loan
        terms keep their rate. At most two adjustments take effect each New York
        week.
      </p>
      {error && <p role="alert">{error}</p>}
      <div>
        {history.map((r) => (
          <div className="product-line" key={r.version}>
            <strong>{(r.rate_ppm / 10000).toFixed(3)}%</strong>
            <span>
              {date(r.effective_at)} · version {r.version}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
export function BankProducts({
  csrf,
  onChanged,
  memberId,
}: {
  memberId: string;
  csrf: string | null;
  onChanged: () => Promise<void>;
}) {
  const [data, setData] = useState<MemberEconomy | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    keys = useRef(new Map<string, string>());
  const load = async () => {
    setData(await api<MemberEconomy>("/economy/me"));
  };
  useEffect(() => {
    void load().catch((e) => setError((e as Error).message));
  }, []);
  const run = async (action: string, input: unknown) => {
    setBusy(true);
    setError("");
    setNotice("");
    const signature = JSON.stringify({ action, input });
    if (!keys.current.has(signature))
      keys.current.set(signature, crypto.randomUUID());
    try {
      await api("/economy/commands", {
        body: { action, input },
        csrf,
        key: keys.current.get(signature),
      });
      keys.current.delete(signature);
      setNotice("Banking operation recorded.");
      await Promise.all([load(), onChanged()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  function repay(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    const amount = parseCents(
      String(new FormData(event.currentTarget).get("amount")),
    );
    if (amount) void run("loan.repay", { id, amountCents: amount });
    else setError("Enter a positive J$ amount with up to two decimal places.");
  }
  return (
    <section className="panel banking-products">
      <h2>Bank offers & service payments</h2>
      <p>
        All money is fictional J$. A bank loan requires your consent before cash
        is disbursed.
      </p>
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!data ? (
        <p>Loading banking products…</p>
      ) : (
        <>
          {!data.offers.length && <p>You have no bank loan offers yet.</p>}
          {data.offers.map((o) => (
            <article key={o.id} className="bank-product">
              <h3>
                {o.terms.title} · {money(o.principal_cents)}
              </h3>
              <p>
                {o.terms.termWeeks} weeks ·{" "}
                {(o.terms.weeklyRatePpm / 10000).toFixed(3)}% per week ·{" "}
                {o.terms.variable
                  ? "Variable Joe Rate plus accepted spread"
                  : "Fixed rate"}{" "}
                · {o.state}
              </p>
              {o.state === "offered" && (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run("loan.accept", {
                      id: o.id,
                      termsHash: o.terms_hash,
                    });
                  }}
                >
                  <p>
                    Offer expires {date(o.expires_at)}. Interest is simple on
                    outstanding principal. Payments settle interest first, then
                    principal. There are no automatic penalties or forced asset
                    sales.
                  </p>
                  <label className="product-consent">
                    <input type="checkbox" required />I accept the displayed
                    principal, term and weekly interest rule.
                  </label>
                  <div className="product-actions">
                    <button className="button primary" disabled={busy}>
                      Accept loan
                    </button>
                    <button
                      className="button secondary"
                      type="button"
                      disabled={busy}
                      onClick={() => void run("loan.decline", { id: o.id })}
                    >
                      Decline
                    </button>
                  </div>
                </form>
              )}
              {o.contract && (
                <>
                  <p>
                    Principal {money(o.contract.principal_outstanding_cents)} ·
                    accrued interest {money(o.contract.interest_due_cents)} ·{" "}
                    {o.contract.state} · due {date(o.contract.dueAt)}
                  </p>
                  {o.contract.state === "active" && (
                    <form
                      className="product-repayment"
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
                      <button className="button primary" disabled={busy}>
                        Repay loan
                      </button>
                    </form>
                  )}
                </>
              )}
            </article>
          ))}
          <h3>Service subscriptions</h3>
          {data.subscriptions.length === 0 && (
            <p>No recurring payments authorized.</p>
          )}
          {data.subscriptions.map((s) => (
            <div className="product-line" key={s.id}>
              <div>
                <strong>{s.title}</strong>
                <p>
                  {money(s.amount_cents)} · {s.state}
                  {s.next_charge_at
                    ? ` · next charge ${date(s.next_charge_at)}`
                    : ""}
                </p>
              </div>
              <div className="product-actions">
                {s.state === "past_due" && (
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => void run("subscription.retry", { id: s.id })}
                  >
                    Retry payment
                  </button>
                )}
                {["active", "past_due"].includes(s.state) && (
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() =>
                      void run("subscription.cancel", { id: s.id })
                    }
                  >
                    Cancel future charges
                  </button>
                )}
              </div>
            </div>
          ))}
          <p>
            Company checkout, employee agreements and weekly tax statements are
            also available in{" "}
            <a
              href={stockAccountUrl(
                window.location.hostname,
                memberId === "demo-bob" ? "bob" : "alice",
              )}
            >
              JoeSE Account Overview
            </a>
            .
          </p>
        </>
      )}
    </section>
  );
}
