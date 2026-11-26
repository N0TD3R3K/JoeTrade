import { useEffect, useState, type FormEvent } from "react";
import type { CompanyPostView, CompanyView } from "@joese/contracts";
import { centralRequest } from "../../../../shared/central-client";
import {
  economyAction,
  money,
  toCents,
} from "../../../../shared/economy-client";
function useCompanies() {
  const [companies, setCompanies] = useState<CompanyView[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const load = async () => {
    setLoading(true);
    try {
      setCompanies(await centralRequest("member", "/companies"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  return { companies, error, loading, load };
}
export function CompanyPosts() {
  const {
      companies,
      error: companyError,
      loading: companyLoading,
      load: loadCompanies,
    } = useCompanies(),
    [posts, setPosts] = useState<CompanyPostView[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false),
    [notice, setNotice] = useState("");
  const load = async () => {
    try {
      setPosts(await centralRequest("member", "/posts"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoaded(true);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const perform = async (run: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError("");
    try {
      await run();
      setNotice(message);
      await Promise.all([load(), loadCompanies()]);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget,
      data = new FormData(form);
    void perform(
      () =>
        centralRequest("member", "/posts", {
          method: "POST",
          body: JSON.stringify({
            companyId: data.get("companyId"),
            title: data.get("title"),
            body: data.get("body"),
          }),
        }),
      "Your company update is published.",
    ).then((ok) => {
      if (ok) form.reset();
    });
  };
  const eligible = companies.filter((c) => c.canPublish);
  return (
    <section className="workspace-page">
      <div className="workspace-heading">
        <span className="workspace-eyebrow">COMPANY UPDATES</span>
        <h1>Posts</h1>
        <p>
          Progress and information from company developers and shareholders.
        </p>
      </div>
      {(error || companyError) && (
        <div role="alert" className="economy-alert">
          {error || companyError}
          <button onClick={() => void Promise.all([load(), loadCompanies()])}>
            Retry
          </button>
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      <section className="workspace-card">
        <h2>Publish an update</h2>
        {companyLoading ? (
          <p>Checking your company publishing permissions…</p>
        ) : eligible.length ? (
          <form className="economy-form" onSubmit={submit}>
            <label>
              Company
              <select name="companyId" required>
                {eligible.map((c) => (
                  <option value={c.id} key={c.id}>
                    {c.ticker} · {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Title
              <input name="title" required maxLength={180} />
            </label>
            <label>
              Update
              <textarea name="body" required maxLength={10000} rows={5} />
            </label>
            <p>
              Publishing requires current company shares or the developer role.
              You can withdraw or delete your own posts later.
            </p>
            <button disabled={busy}>
              {busy ? "Publishing…" : "Publish update"}
            </button>
          </form>
        ) : (
          <p>
            Owning settled shares or developing a company gives you permission
            to publish updates about that company.
          </p>
        )}
      </section>
      {!loaded ? (
        <p>Loading posts…</p>
      ) : posts.length === 0 ? (
        <div className="workspace-state">
          <h2>No company updates yet</h2>
          <p>Published posts will appear here for all members.</p>
        </div>
      ) : (
        <div className="member-news-list">
          {posts.map((post) => (
            <article className="workspace-card company-post" key={post.id}>
              <div className="member-news-meta">
                <span>
                  {post.ticker} · {post.author_name}
                </span>
                <time>{new Date(post.created_at * 1000).toLocaleString()}</time>
                <span>{post.state}</span>
              </div>
              <h2>{post.title ?? "Deleted post"}</h2>
              {post.body && <p className="company-post-body">{post.body}</p>}
              {post.canRemove && (
                <div className="economy-actions">
                  {post.state === "published" && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void perform(
                          () =>
                            centralRequest(
                              "member",
                              `/posts/${post.id}/withdraw`,
                              {
                                method: "POST",
                                body: JSON.stringify({ version: post.version }),
                              },
                            ),
                          "The post has been withdrawn.",
                        )
                      }
                    >
                      Withdraw
                    </button>
                  )}
                  <button
                    disabled={busy}
                    onClick={() =>
                      void perform(
                        () =>
                          centralRequest("member", `/posts/${post.id}/delete`, {
                            method: "POST",
                            body: JSON.stringify({ version: post.version }),
                          }),
                        "The post title and body have been deleted.",
                      )
                    }
                  >
                    Delete post
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
export function MyCompany() {
  const { companies, error, loading, load } = useCompanies(),
    [selected, setSelected] = useState(""),
    [busy, setBusy] = useState(false),
    [actionError, setActionError] = useState(""),
    [notice, setNotice] = useState("");
  const company = companies.find((c) => c.id === selected) ?? companies[0];
  const perform = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setActionError("");
    setNotice("");
    try {
      const result = (await action()) as { state?: string; reason?: string };
      setNotice(
        result?.state === "pending"
          ? (result.reason ?? "The operation remains pending.")
          : message,
      );
      await load();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  function formAction(action: string, map: (data: FormData) => unknown) {
    return (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      try {
        const input = map(new FormData(event.currentTarget));
        void perform(
          () => economyAction("member", action, input),
          "Company settings saved.",
        );
      } catch (e) {
        setActionError((e as Error).message);
      }
    };
  }
  if (loading && !companies.length)
    return (
      <section className="workspace-page">
        <h1>My Company</h1>
        <p>Loading company reports…</p>
      </section>
    );
  return (
    <section className="workspace-page">
      <div className="workspace-heading">
        <span className="workspace-eyebrow">OWNERSHIP & REVENUE</span>
        <h1>My Company</h1>
        <p>Company cash and revenue are separate from your personal balance.</p>
      </div>
      {(error || actionError) && (
        <div className="economy-alert" role="alert">
          {error || actionError}
          <button onClick={() => void load()}>Retry</button>
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      {!company ? (
        <div className="workspace-state">
          <h2>No company interests yet</h2>
          <p>
            Your developed companies and settled stock or frozen shares will
            appear here.
          </p>
          <a href="/market">Browse stock listings</a>
        </div>
      ) : (
        <>
          <label className="economy-company-select">
            Your company
            <select
              value={company.id}
              onChange={(e) => setSelected(e.target.value)}
            >
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.ticker} · {c.name}
                </option>
              ))}
            </select>
          </label>
          <div className="economy-metrics">
            <Metric
              label="Market capitalization"
              value={money(company.marketCapCents)}
            />
            <Metric
              label="Stock change this week"
              value={
                company.weeklyChangePercent === null
                  ? "No earlier weekly close"
                  : `${company.weeklyChangePercent.toFixed(2)}%`
              }
            />
            <Metric
              label="Weekly net revenue"
              value={money(company.bank?.weeklyRevenueCents)}
            />
            <Metric
              label="Lifetime gross revenue"
              value={money(company.bank?.totalRevenueCents)}
            />
            <Metric label="Refunds" value={money(company.bank?.refundsCents)} />
            <Metric
              label="Employee payments"
              value={money(company.bank?.wagesCents)}
            />
            <Metric
              label="Operating cash"
              value={money(company.bank?.operatingCents)}
            />
            <Metric
              label="Locked founding capital"
              value={money(company.bank?.lockedCapitalCents)}
            />
          </div>
          <section className="workspace-card">
            <h2>Shareholders</h2>
            <p>
              All ordinary and frozen shares count toward ownership. Market
              capitalization includes outstanding issuer inventory, when
              present.
            </p>
            <div className="economy-table-wrap">
              <table className="economy-table">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Shares</th>
                    <th>Ownership</th>
                  </tr>
                </thead>
                <tbody>
                  {company.shareholders.map((s) => (
                    <tr key={s.name}>
                      <td>{s.name}</td>
                      <td>{s.quantity.toLocaleString()}</td>
                      <td>{s.percent.toFixed(2)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          {!company.bank && (
            <section className="workspace-card">
              <h2>Company banking</h2>
              <p>
                {company.bankError ??
                  "This company has no operating account yet."}
              </p>
              {company.canManage && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void perform(
                      () =>
                        centralRequest("member", "/companies/register", {
                          method: "POST",
                          body: JSON.stringify({ companyId: company.id }),
                        }),
                      "Company banking is ready. No funds were created or moved.",
                    )
                  }
                >
                  Initialize company banking
                </button>
              )}
            </section>
          )}
          {company.bank && (
            <p className="economy-note">
              Banking report captured{" "}
              {new Date(company.bank.asOf * 1000).toLocaleString()}. Retained
              revenue {money(company.bank.retainedRevenueCents)}. Book cash and
              locked capital are reported separately from share market value.
            </p>
          )}
          {company.bank?.manager && (
            <div className="company-manager-grid">
              <section className="workspace-card">
                <h2>Services & plans</h2>
                <p>
                  Register the service’s JoeAuth app. A banking operator must
                  approve it before plans can accept J$.
                </p>
                <form
                  className="economy-form"
                  onSubmit={formAction("service.request", (d) => ({
                    companyId: company.id,
                    appId: d.get("appId"),
                    name: d.get("name"),
                  }))}
                >
                  <label>
                    Service name
                    <input name="name" maxLength={120} required />
                  </label>
                  <label>
                    JoeAuth app ID
                    <input name="appId" required maxLength={180} />
                  </label>
                  <button disabled={busy}>Request service approval</button>
                </form>
                <ul>
                  {company.bank.services?.map((s) => (
                    <li key={s.id}>
                      {s.display_name} · {s.state}
                    </li>
                  ))}
                </ul>
                {!!company.bank.services?.some((s) => s.state === "active") && (
                  <details>
                    <summary>Create a billing plan</summary>
                    <form
                      className="economy-form"
                      onSubmit={formAction("plan.create", (d) => ({
                        serviceId: d.get("serviceId"),
                        title: d.get("title"),
                        terms: d.get("terms"),
                        amountCents: toCents(d.get("amount")),
                        kind: d.get("kind"),
                        intervalDays:
                          d.get("kind") === "subscription"
                            ? Number(d.get("interval"))
                            : null,
                      }))}
                    >
                      <label>
                        Approved service
                        <select name="serviceId">
                          {company.bank.services
                            .filter((s) => s.state === "active")
                            .map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.display_name}
                              </option>
                            ))}
                        </select>
                      </label>
                      <label>
                        Plan name
                        <input name="title" required maxLength={120} />
                      </label>
                      <label>
                        Price (J$)
                        <input
                          name="amount"
                          type="number"
                          min="0.01"
                          step="0.01"
                          required
                        />
                      </label>
                      <label>
                        Payment type
                        <select name="kind">
                          <option value="purchase">One-time purchase</option>
                          <option value="subscription">Subscription</option>
                        </select>
                      </label>
                      <label>
                        Subscription interval in calendar days
                        <input
                          name="interval"
                          type="number"
                          min="1"
                          max="366"
                        />
                      </label>
                      <label>
                        Member payment terms
                        <textarea
                          name="terms"
                          rows={3}
                          required
                          maxLength={3000}
                        />
                      </label>
                      <button disabled={busy}>Create immutable plan</button>
                    </form>
                  </details>
                )}
                {company.bank.plans?.map((p) => (
                  <div className="economy-line" key={p.id}>
                    <span>
                      {p.title} · {money(p.amount_cents)} · {p.kind}
                    </span>
                    <a href={`/account?plan=${encodeURIComponent(p.id)}`}>
                      Member checkout
                    </a>
                  </div>
                ))}
              </section>
              <section className="workspace-card">
                <h2>Employees & revenue allocation</h2>
                <p>
                  Employee revenue pool:{" "}
                  {company.bank.employeePoolBps === null
                    ? "Not configured"
                    : `${company.bank.employeePoolBps / 100}%`}
                  . Accepted employee weights must total 100% before payroll.
                </p>
                <form
                  className="economy-form"
                  onSubmit={formAction("company.pool", (d) => ({
                    companyId: company.id,
                    poolBps: Math.round(Number(d.get("pool")) * 100),
                  }))}
                >
                  <label>
                    Revenue pool for employees (%)
                    <input
                      name="pool"
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      required
                    />
                  </label>
                  <button disabled={busy}>Set revenue pool</button>
                </form>
                <form
                  className="economy-form"
                  onSubmit={formAction("employee.invite", (d) => ({
                    companyId: company.id,
                    employeeId: d.get("employee"),
                    allocationBps: Math.round(Number(d.get("weight")) * 100),
                  }))}
                >
                  <label>
                    Employee username or banking member ID
                    <input name="employee" required />
                  </label>
                  <label>
                    Share of employee pool (%)
                    <input
                      name="weight"
                      type="number"
                      min="0.01"
                      max="100"
                      step="0.01"
                      required
                    />
                  </label>
                  <button disabled={busy}>Invite employee</button>
                </form>
                <div>
                  {company.bank.employees?.map((a) => (
                    <div key={a.id} className="economy-line">
                      <span>
                        {a.display_name} · {a.allocation_bps / 100}% · {a.state}
                      </span>
                      {a.state !== "ended" && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            void perform(
                              () =>
                                economyAction("member", "employee.end", {
                                  id: a.id,
                                }),
                              "Employee agreement ended.",
                            )
                          }
                        >
                          End agreement
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <form
                  className="economy-form"
                  onSubmit={formAction("payroll.run", (d) => ({
                    companyId: company.id,
                    week: d.get("week"),
                  }))}
                >
                  <label>
                    Closed revenue week (Monday)
                    <input name="week" type="date" required />
                  </label>
                  <button disabled={busy}>Pay funded weekly allocation</button>
                </form>
                <details>
                  <summary>Company payment receipts</summary>
                  {company.bank.payments?.map((payment) => (
                    <div className="economy-line" key={payment.id}>
                      <span>
                        {payment.customer_name} · {money(payment.amount_cents)}{" "}
                        · {payment.kind} · {payment.state}
                        <br />
                        <small>{payment.id}</small>
                      </span>
                      {payment.kind !== "refund" &&
                        payment.state === "posted" && (
                          <button
                            disabled={busy}
                            onClick={() =>
                              void perform(
                                () =>
                                  economyAction("member", "payment.refund", {
                                    id: payment.id,
                                  }),
                                "Refund request recorded. Check the payment status for completion.",
                              )
                            }
                          >
                            Full refund
                          </button>
                        )}
                    </div>
                  ))}
                </details>
                <details>
                  <summary>Refund a service payment</summary>
                  <form
                    className="economy-form"
                    onSubmit={formAction("payment.refund", (d) => ({
                      id: d.get("payment"),
                    }))}
                  >
                    <label>
                      Payment reference
                      <input name="payment" required />
                    </label>
                    <p>
                      A full refund uses available company cash. An underfunded
                      refund remains pending.
                    </p>
                    <button disabled={busy}>Issue or retry full refund</button>
                  </form>
                </details>
              </section>
            </div>
          )}
        </>
      )}
    </section>
  );
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="workspace-card economy-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
