import { useEffect, useState } from "react";
import { Plus, X, ShieldCheck, CheckCircle2 } from "lucide-react";
import { centralRequest } from "./central-client";
type Proposal = {
  id: string;
  ticker: string;
  name: string;
  founder_name: string;
  developer_user_id: string;
  contribution_cents: number;
  shares: number;
  status: string;
};
const money = (c: number) =>
  `J$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
function cents(v: string) {
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(v)) return 0;
  const [a, b = ""] = v.split(".");
  return Number(BigInt(a) * 100n + BigInt(b.padEnd(2, "0")));
}
export function ListingLaunch({
  surface,
  onClose,
  onChanged,
  members = [],
}: {
  surface: "member" | "console";
  onClose: () => void;
  onChanged: () => Promise<void>;
  members?: Record<string, unknown>[];
}) {
  const [proposals, setProposals] = useState<Proposal[]>([]),
    [ticker, setTicker] = useState(""),
    [name, setName] = useState(""),
    [description, setDescription] = useState(""),
    [project, setProject] = useState(""),
    [capital, setCapital] = useState("5000.00"),
    [shares, setShares] = useState("1000"),
    [founder, setFounder] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  const path =
    surface === "console" ? "/console/listing-proposals" : "/listings";
  const load = async () =>
    setProposals(await centralRequest<Proposal[]>(surface, path));
  useEffect(() => {
    void load().catch((e) => setError((e as Error).message));
  }, []);
  async function action(run: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await run();
      setSuccess(message);
      await load();
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className="listing-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <section
        className="listing-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="listing-title"
      >
        <header>
          <div>
            <span className="eyebrow">COMPANY LAUNCH</span>
            <h2 id="listing-title">Add a listing</h2>
          </div>
          <button
            aria-label="Close listing launch"
            disabled={busy}
            onClick={onClose}
          >
            <X size={22} />
          </button>
        </header>
        <p className="listing-intro">
          Turn at least J$5,000 of a founder's available banking balance into
          frozen company shares. The bank never buys those shares back. Another
          member must willingly buy a specific number of shares before the
          seller receives J$.
        </p>
        {error && (
          <div className="listing-error" role="alert">
            {error}
          </div>
        )}
        {success && (
          <div className="listing-success" role="status">
            <CheckCircle2 size={18} />
            {success}
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void action(
              () =>
                centralRequest(surface, path, {
                  method: "POST",
                  body: JSON.stringify({
                    ticker,
                    name,
                    description,
                    projectUrl: project,
                    contributionCents: cents(capital),
                    shares: Number(shares),
                    ...(surface === "console"
                      ? { developerUserId: founder }
                      : {}),
                  }),
                }),
              surface === "console"
                ? "Proposal prepared. The founder must confirm funding in their exchange account."
                : "Proposal submitted for operator review. No J$ has moved.",
            );
          }}
        >
          <div className="listing-fields">
            <label>
              Stock ticker
              <input
                aria-label="Stock ticker"
                value={ticker}
                onChange={(e) => setTicker(e.target.value.toUpperCase())}
                pattern="[A-Z]{3}"
                maxLength={3}
                required
                placeholder="ABC"
              />
            </label>
            <label>
              Company name
              <input
                aria-label="Company name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                minLength={2}
                maxLength={100}
                required
              />
            </label>
            <label className="span-two">
              Project URL
              <input
                type="url"
                pattern="https://.*"
                value={project}
                onChange={(e) => setProject(e.target.value)}
                required
                placeholder="https://github.com/your/project"
              />
            </label>
            <label className="span-two">
              Company description
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                minLength={10}
                maxLength={2000}
                rows={3}
                required
              />
            </label>
            {surface === "console" && (
              <label className="span-two">
                Developer / main shareholder
                <select
                  aria-label="Developer / main shareholder"
                  value={founder}
                  required
                  onChange={(e) => setFounder(e.target.value)}
                >
                  <option value="">Select a linked member</option>
                  {members
                    .filter((m) => m.role === "member" && m.status === "active")
                    .map((m) => (
                      <option value={String(m.id)} key={String(m.id)}>
                        {String(m.username)} · {String(m.email)}
                      </option>
                    ))}
                </select>
              </label>
            )}
            <label>
              Founding contribution (J$)
              <input
                inputMode="decimal"
                value={capital}
                onChange={(e) => setCapital(e.target.value)}
                required
              />
            </label>
            <label>
              Founding shares
              <input
                type="number"
                min="1"
                max="1000000"
                step="1"
                value={shares}
                onChange={(e) => setShares(e.target.value)}
                required
              />
            </label>
          </div>
          <div className="listing-disclosure">
            <ShieldCheck size={20} />
            <span>
              All founding shares stay frozen. Proposing or approving a listing
              never debits a member. The founder confirms the exact contribution
              separately.
            </span>
          </div>
          <button
            className="listing-primary"
            disabled={busy || cents(capital) < 500000}
          >
            <Plus size={17} />
            {busy
              ? "Working…"
              : surface === "console"
                ? "Prepare listing for founder"
                : "Submit for review"}
          </button>
        </form>
        <section className="listing-queue">
          <h3>
            {surface === "console" ? "Launch queue" : "Your listing requests"}
          </h3>
          {!proposals.length && <p>No listing requests yet.</p>}
          {proposals.map((p) => (
            <article key={p.id}>
              <div>
                <strong>
                  {p.ticker} · {p.name}
                </strong>
                <p>
                  {p.founder_name} · {money(p.contribution_cents)} ·{" "}
                  {p.shares.toLocaleString()} frozen shares
                </p>
                <span className="listing-status">
                  {p.status.replaceAll("_", " ")}
                </span>
              </div>
              {surface === "console" && p.status === "awaiting_review" && (
                <button
                  className="listing-primary"
                  disabled={busy}
                  onClick={() =>
                    void action(
                      () =>
                        centralRequest(
                          surface,
                          `/console/listing-proposals/${p.id}/approve`,
                          { method: "POST", body: "{}" },
                        ),
                      "Approved. The founder can now confirm their contribution.",
                    )
                  }
                >
                  Approve proposal
                </button>
              )}
              {surface === "member" && p.status === "awaiting_founder" && (
                <div className="funding-confirmation">
                  <label>
                    <input
                      type="checkbox"
                      required
                      aria-label={`Confirm contribution for ${p.ticker}`}
                      checked={Boolean(accepted[p.id])}
                      onChange={(e) =>
                        setAccepted({ ...accepted, [p.id]: e.target.checked })
                      }
                    />{" "}
                    I agree to convert {money(p.contribution_cents)} into{" "}
                    {p.shares.toLocaleString()} frozen shares.
                  </label>
                  <button
                    className="listing-primary"
                    disabled={busy || !accepted[p.id]}
                    onClick={() =>
                      void action(
                        () =>
                          centralRequest(
                            surface,
                            `/listing-proposals/${p.id}/launch`,
                            { method: "POST", body: "{}" },
                          ),
                        "Company launched. Capital is recorded in Joe Banking and the shares are now frozen.",
                      )
                    }
                  >
                    Fund & launch {p.ticker}
                  </button>
                </div>
              )}
            </article>
          ))}
        </section>
      </section>
    </div>
  );
}
