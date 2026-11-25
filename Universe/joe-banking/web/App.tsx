import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  Activity as ActivityIcon,
  Bell,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Clock3,
  Coins,
  ExternalLink,
  Landmark,
  LockKeyhole,
  LogOut,
  Menu,
  MoreHorizontal,
  Send,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  api,
  date,
  money,
  parseCents,
  type Activity,
  type AuthState,
  type Recipient,
  type Summary,
  type Wire,
} from "./api";

type Page =
  | "Account Balance"
  | "Transaction"
  | "Interest Rate"
  | "Deposits"
  | "Loans"
  | "Inbox";
const navigation: Array<{ title: Page; icon: LucideIcon }> = [
  { title: "Account Balance", icon: Wallet },
  { title: "Transaction", icon: Send },
  { title: "Interest Rate", icon: TrendingUp },
  { title: "Deposits", icon: Coins },
  { title: "Loans", icon: Landmark },
];
const labels: Record<Wire["status"], string> = {
  pending_receiver: "Awaiting receiver",
  accepted: "Received",
  declined: "Declined",
  cancelled_by_sender: "Cancelled",
};

export default function App() {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [balance, setBalance] = useState<Summary | null>(null);
  const [history, setHistory] = useState<Activity[]>([]);
  const [wireList, setWireList] = useState<Wire[]>([]);
  const [page, setPage] = useState<Page>("Account Balance");
  const [menu, setMenu] = useState(false);
  const [profile, setProfile] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const actionKeys = useRef(new Map<string, string>());

  const load = useCallback(async () => {
    const session = await api<AuthState>("/auth/session");
    setAuth(session);
    if (session.customer) {
      const [nextBalance, nextHistory, nextWires] = await Promise.all([
        api<Summary>("/me/summary"),
        api<Activity[]>("/me/activity"),
        api<Wire[]>("/wires"),
      ]);
      setBalance(nextBalance);
      setHistory(nextHistory);
      setWireList(nextWires);
    } else {
      setBalance(null);
      setHistory([]);
      setWireList([]);
    }
  }, []);

  useEffect(() => {
    void load()
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [load]);

  async function demo(id: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api("/dev/session", { body: { customer_id: id } });
      // Discard the previous member's views before loading another identity.
      setBalance(null);
      setHistory([]);
      setWireList([]);
      setProfile(false);
      setPage("Account Balance");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api("/auth/logout", { csrf: auth?.csrf_token });
      setAuth(null);
      setBalance(null);
      setHistory([]);
      setWireList([]);
      setProfile(false);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function resolve(wire: Wire, action: "accept" | "decline" | "cancel") {
    const key = `${wire.id}:${action}`;
    if (!actionKeys.current.has(key))
      actionKeys.current.set(key, crypto.randomUUID());
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api(`/wires/${wire.id}/${action}`, {
        csrf: auth?.csrf_token,
        key: actionKeys.current.get(key),
      });
      setNotice(
        action === "accept"
          ? `${money(wire.amount_cents)} received. Your balance is updated.`
          : action === "decline"
            ? "Wire declined. The sender's funds have been released."
            : "Wire cancelled. Your funds are available again.",
      );
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function navigate(next: Page) {
    setPage(next);
    setMenu(false);
    setError("");
    setNotice("");
  }
  const member = auth?.customer;
  const inbox = wireList.filter(
    (wire) =>
      wire.receiver_customer_id === member?.id &&
      wire.status === "pending_receiver",
  );
  const banners = (
    <>
      {error && (
        <div className="message error" role="alert">
          {error}
          <button aria-label="Dismiss error" onClick={() => setError("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {notice && (
        <div className="message success" role="status">
          <CheckCircle2 size={18} />
          {notice}
          <button
            aria-label="Dismiss notification"
            onClick={() => setNotice("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </>
  );

  if (loading)
    return (
      <div className="loading" role="status">
        <Brand />
        <p>Opening Joe Banking…</p>
      </div>
    );
  if (!member)
    return (
      <div className="welcome">
        <header>
          <Brand />
          <span className="eyebrow">PART OF THE JOE UNIVERSE</span>
        </header>
        <main className="welcome-main">
          <div className="welcome-story">
            <span className="tag">
              <Sparkles size={14} /> YOUR UNIVERSE. YOUR JOELLARS.
            </span>
            <h1>
              A home for
              <br />
              your next idea.
            </h1>
            <p>
              Keep your Joellars together. Send a little Joe.
              <br />
              Build something bigger in the Joe Universe.
            </p>
            <div className="welcome-feature">
              <ShieldCheck />
              <span>
                One identity.
                <br />
                <strong>Connected through JoeAuth.</strong>
              </span>
            </div>
            <div className="orbit" aria-hidden="true">
              <div className="orbit-ring" />
              <div className="orbit-center">J$</div>
              <span className="orbit-dot" />
            </div>
          </div>
          <section className="signin-card">
            <div className="icon-tile">
              <Landmark size={26} />
            </div>
            <h2>Welcome to Joe Banking</h2>
            <p>Your account, at home in the Joe Universe.</p>
            {banners}
            {auth?.joeauth_configured ? (
              <a className="button primary wide" href="/v1/auth/login">
                <LockKeyhole size={17} /> Continue with JoeAuth
              </a>
            ) : (
              <>
                <button className="button primary wide" disabled>
                  <LockKeyhole size={17} /> Continue with JoeAuth
                </button>
                <p className="small muted">
                  JoeAuth sign-in will be available once this environment is
                  connected.
                </p>
              </>
            )}
            {auth?.local_demo && (
              <div className="demo-login">
                <span className="eyebrow">LOCAL DEMONSTRATION</span>
                <p>Try the working transfer flow with two fictional members.</p>
                <button
                  className="button secondary wide"
                  disabled={busy}
                  onClick={() => void demo("demo-alice")}
                >
                  Open Alice's account
                </button>
                <button
                  className="button secondary wide"
                  disabled={busy}
                  onClick={() => void demo("demo-bob")}
                >
                  Open Bob's account
                </button>
                <p className="small muted">
                  Synthetic data stored only in your local database.
                </p>
              </div>
            )}
            <div className="simulation">
              <CircleHelp size={16} />
              <span>J$ is fictional. No real money is held or exchanged.</span>
            </div>
          </section>
        </main>
        <footer>
          Joe Banking · A JoeTrade project{" "}
          <span>Made for the Joe Universe</span>
        </footer>
      </div>
    );

  return (
    <div className="app-shell">
      {menu && (
        <button
          className="drawer-scrim"
          aria-label="Close navigation"
          onClick={() => setMenu(false)}
        />
      )}
      <aside className={`sidebar ${menu ? "open" : ""}`}>
        <Brand />
        <div className="workspace-label">PERSONAL BANKING</div>
        <nav aria-label="Banking pages">
          {navigation.map(({ title, icon: Icon }) => (
            <button
              key={title}
              className={page === title ? "nav-item active" : "nav-item"}
              aria-current={page === title ? "page" : undefined}
              onClick={() => navigate(title)}
            >
              <Icon size={19} />
              {title}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="universe-card">
            <div className="mini-mark">J</div>
            <p>
              A whole universe.
              <br />
              <strong>One Joe identity.</strong>
            </p>
            <ShieldCheck size={16} />
          </div>
          <p className="simulation-copy">
            An economy of imagination.
            <br />
            J$ has no real-world value.
          </p>
          <span className="sidebar-foot">JOETRADE / JOE BANKING</span>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              aria-expanded={menu}
              onClick={() => setMenu(!menu)}
            >
              <Menu size={21} />
            </button>
            <button
              className="universe-back"
              disabled
              title="The Joe Universe homepage is not online yet."
            >
              <span className="universe-symbol">✦</span> Back to Universe{" "}
              <ExternalLink size={13} />
            </button>
          </div>
          <div className="topbar-right">
            <button
              className={`inbox-button ${page === "Inbox" ? "selected" : ""}`}
              onClick={() => navigate("Inbox")}
            >
              <Bell size={18} />
              <span>Inbox</span>
              {inbox.length > 0 && (
                <span className="count">{inbox.length}</span>
              )}
            </button>
            <div className="profile">
              <button
                className="profile-button"
                aria-label={`Account details for ${member.display_name}`}
                aria-expanded={profile}
                aria-controls="profile-menu"
                onClick={() => setProfile(!profile)}
              >
                <span className="avatar">
                  {member.display_name.slice(0, 1)}
                </span>
                <span className="profile-name">
                  {member.display_name}
                  <small>Personal account</small>
                </span>
                <ChevronDown size={14} />
              </button>
              {profile && (
                <div className="profile-menu" id="profile-menu">
                  <strong>{member.display_name}</strong>
                  <span>{member.email}</span>
                  {auth?.local_demo && (
                    <>
                      <p className="eyebrow">SWITCH LOCAL MEMBER</p>
                      <button
                        disabled={busy}
                        onClick={() => void demo("demo-alice")}
                      >
                        Alice Joe
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => void demo("demo-bob")}
                      >
                        Bob Joe
                      </button>
                    </>
                  )}
                  <button disabled={busy} onClick={() => void signOut()}>
                    <LogOut size={15} /> Sign out of Banking
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="content" id="main-content">
          {auth?.local_demo && (
            <div className="demo-strip">
              <span>LOCAL DEMO</span> You're exploring a fictional account.
              Changes stay in the local database.
            </div>
          )}
          {banners}
          {!balance ? (
            <div className="empty-state">
              <Clock3 />
              <h2>Loading your account</h2>
              <p>Your account information will appear here.</p>
              <button
                className="button secondary"
                onClick={() =>
                  void load().catch((e: Error) => setError(e.message))
                }
              >
                Try again
              </button>
            </div>
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">
                    JOE BANKING /{" "}
                    {page === "Account Balance"
                      ? "OVERVIEW"
                      : page.toUpperCase()}
                  </p>
                  <h1>
                    {page === "Account Balance"
                      ? `Good to see you, ${member.display_name.split(" ")[0]}.`
                      : page}
                  </h1>
                  <p>
                    {page === "Account Balance"
                      ? "A clear view of your corner of the Joe Universe."
                      : page === "Transaction"
                        ? "A little Joe, sent with intention."
                        : page === "Inbox"
                          ? "Your next move starts here."
                          : page === "Interest Rate"
                            ? "Understand what makes your Joellars grow."
                            : page === "Deposits"
                              ? "A place for the Joellars you're setting aside."
                              : "Room for your next chapter."}
                  </p>
                </div>
                {page === "Account Balance" && (
                  <button
                    className="button primary"
                    onClick={() => navigate("Transaction")}
                  >
                    <Send size={16} /> Send J$
                  </button>
                )}
              </div>
              {member.status === "frozen" && (
                <div className="message error" role="status">
                  Your account is frozen. Balances remain visible; transactions
                  are unavailable.
                </div>
              )}
              {page === "Account Balance" && (
                <>
                  <div className="balance-grid">
                    <section className="available-card">
                      <div className="card-top">
                        <span className="label">AVAILABLE BALANCE</span>
                        <Wallet size={20} />
                      </div>
                      <div className="balance-number">
                        {money(balance.available_cents)}
                      </div>
                      <p>Ready to send. Ready for what's next.</p>
                      <div className="balance-card-footer">
                        <span className="account-chip">
                          <span /> J$ TRANSACTION ACCOUNT
                        </span>
                        <span>Joellars</span>
                      </div>
                    </section>
                    <section className="metric-card">
                      <span className="metric-icon">
                        <LockKeyhole size={19} />
                      </span>
                      <p>Held balance</p>
                      <strong>{money(balance.held_cents)}</strong>
                      <span className="muted small">
                        Reserved, still yours.
                      </span>
                      <div className="metric-detail">
                        Pending wires{" "}
                        <b>
                          {money(
                            balance.holds.find(
                              (h) => h.purpose === "member_wire",
                            )?.amount_cents ?? 0,
                          )}
                        </b>
                      </div>
                    </section>
                    <section className="metric-card">
                      <span className="metric-icon teal">
                        <Coins size={20} />
                      </span>
                      <p>Flexible savings</p>
                      <strong>{money(balance.flexible_deposit_cents)}</strong>
                      <span className="muted small">
                        Separate from spendable J$.
                      </span>
                      <button
                        className="text-button"
                        onClick={() => navigate("Deposits")}
                      >
                        Explore deposit plans
                      </button>
                    </section>
                  </div>
                  <div className="overview-grid">
                    <section className="panel activity-panel">
                      <div className="section-heading">
                        <div>
                          <h2>Recent activity</h2>
                          <p>The story behind your balance.</p>
                        </div>
                        <span className="quiet-icon">
                          <ActivityIcon size={19} />
                        </span>
                      </div>
                      <ActivityTable entries={history} />
                    </section>
                    <div className="right-stack">
                      <section className="panel inbox-summary">
                        <div className="section-heading">
                          <h2>Your inbox</h2>
                          <Bell size={18} />
                        </div>
                        <div className="inbox-number">
                          {inbox.length.toString().padStart(2, "0")}
                        </div>
                        <p>
                          {inbox.length
                            ? "Incoming wires are waiting for your decision."
                            : "All caught up. New wires will appear here."}
                        </p>
                        <button
                          className="button secondary wide"
                          onClick={() => navigate("Inbox")}
                        >
                          Open inbox
                        </button>
                      </section>
                      <section className="connection-card">
                        <div className="connection-icon">
                          <TrendingUp size={22} />
                        </div>
                        <div>
                          <span className="eyebrow">ACROSS YOUR UNIVERSE</span>
                          <h3>JOE Stock Exchange</h3>
                          <p>
                            Portfolio connection is coming next. Investments
                            stay separate from available J$.
                          </p>
                          <span className="status-pill">Not connected</span>
                        </div>
                      </section>
                    </div>
                  </div>
                  <section className="principle">
                    <ShieldCheck size={22} />
                    <div>
                      <strong>Your balance has a history.</strong>
                      <p>
                        Every completed wire is recorded in a balanced ledger.
                        Pending wires only reserve your funds.
                      </p>
                    </div>
                  </section>
                </>
              )}
              {page === "Transaction" && (
                <div className="transaction-grid">
                  <SendForm
                    key={member.id}
                    csrf={auth?.csrf_token ?? null}
                    available={balance.available_cents}
                    frozen={member.status !== "active"}
                    onSent={async () => {
                      setNotice(
                        "Wire sent. Your J$ is held until the receiver decides.",
                      );
                      await load();
                    }}
                  />
                  <section className="panel">
                    <div className="section-heading">
                      <div>
                        <h2>Wire activity</h2>
                        <p>Pending and completed transfers.</p>
                      </div>
                      <MoreHorizontal size={20} />
                    </div>
                    <WireList
                      wires={wireList}
                      customerId={member.id}
                      busy={busy || member.status !== "active"}
                      resolve={resolve}
                    />
                  </section>
                </div>
              )}
              {page === "Inbox" && (
                <section className="panel">
                  <div className="section-heading">
                    <div>
                      <h2>
                        Waiting for you{" "}
                        <span className="count light">{inbox.length}</span>
                      </h2>
                      <p>
                        Receive a wire to add it to your balance, or decline to
                        return the held funds.
                      </p>
                    </div>
                    <Bell size={21} />
                  </div>
                  <WireList
                    wires={inbox}
                    customerId={member.id}
                    busy={busy || member.status !== "active"}
                    resolve={resolve}
                  />
                </section>
              )}
              {page === "Interest Rate" && (
                <>
                  <section className="rate-hero panel">
                    <div>
                      <span className="eyebrow">VARIABLE JOE RATE</span>
                      <h2>Good things take a little planning.</h2>
                      <p>
                        The initial Joe Rate is awaiting confirmation. No
                        interest is being accrued by this first release.
                      </p>
                      <span className="status-pill">Rate not set</span>
                    </div>
                    <div className="rate-range">
                      <TrendingUp size={26} />
                      <strong>
                        0.300–2.000<span>% per week</span>
                      </strong>
                      <span>Approved variable-rate range</span>
                    </div>
                  </section>
                  <div className="info-grid">
                    <InfoCard icon={Clock3} title="A considered pace">
                      At most two adjustments per New York calendar week. Each
                      change must be between 0.005 and 0.200 percentage points.
                    </InfoCard>
                    <InfoCard icon={LockKeyhole} title="Fixed means fixed">
                      Fixed-term deposits keep the weekly rate in their accepted
                      contract, even when the variable Joe Rate changes.
                    </InfoCard>
                    <InfoCard icon={ActivityIcon} title="A visible history">
                      Future changes will show their effective time,
                      explanation, and an audit record. Rates will never change
                      retroactively.
                    </InfoCard>
                  </div>
                </>
              )}
              {page === "Deposits" && (
                <>
                  <div className="info-banner">
                    <CircleHelp size={20} />
                    <div>
                      <strong>Preview the deposit plans</strong>
                      <p>
                        Funding and interest posting are not available yet. Your
                        current J$ will stay in your transaction account.
                      </p>
                    </div>
                  </div>
                  <div className="deposit-grid">
                    {[
                      { weeks: 2, rate: "1.000", name: "Short Joe Deposit" },
                      { weeks: 4, rate: "1.500", name: "Standard Joe Deposit" },
                      { weeks: 8, rate: "2.250", name: "Long Joe Deposit" },
                    ].map((plan) => (
                      <section className="panel deposit-card" key={plan.weeks}>
                        <div className="metric-icon teal">
                          <Coins size={21} />
                        </div>
                        <span className="eyebrow">{plan.weeks}-WEEK TERM</span>
                        <h2>{plan.name}</h2>
                        <strong className="deposit-rate">
                          {plan.rate}%<small>fixed per week</small>
                        </strong>
                        <p>
                          Planned fixed-rate savings, with funds held until
                          maturity. Final withdrawal terms are being confirmed.
                        </p>
                        <button className="button secondary wide" disabled>
                          Not available yet
                        </button>
                      </section>
                    ))}
                  </div>
                  <InfoCard
                    icon={Wallet}
                    title="Flexible savings is also planned"
                  >
                    Flexible deposits will move existing J$ into a separate
                    savings account. Deposits never bring real money into the
                    Joe Universe.
                  </InfoCard>
                </>
              )}
              {page === "Loans" && (
                <section className="panel coming-soon">
                  <div className="icon-tile">
                    <Landmark size={28} />
                  </div>
                  <span className="eyebrow">A FUTURE CHAPTER</span>
                  <h2>Thoughtful lending starts with clear terms.</h2>
                  <p>
                    Loan products, eligibility, repayment schedules, and rates
                    are still being defined. Applications and disbursements are
                    not available in this release.
                  </p>
                  <div className="loan-principles">
                    <span>
                      <Check size={16} /> Terms before acceptance
                    </span>
                    <span>
                      <Check size={16} /> A permanent transaction history
                    </span>
                    <span>
                      <Check size={16} /> Fictional J$, always
                    </span>
                  </div>
                </section>
              )}
            </>
          )}
          <footer className="content-footer">
            <span>
              JOE BANKING <b>·</b> PART OF JOETRADE
            </span>
            <span>Fictional currency. Real imagination.</span>
          </footer>
        </main>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">
        J<span />
      </span>
      <div>
        Joe Banking<small>THE JOE UNIVERSE</small>
      </div>
    </div>
  );
}
function InfoCard({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="panel info-card">
      <Icon size={22} />
      <h3>{title}</h3>
      <p>{children}</p>
    </section>
  );
}
function ActivityTable({ entries }: { entries: Activity[] }) {
  return entries.length ? (
    <div className="activity-list">
      {entries.map((item) => (
        <div className="activity-row" key={item.id}>
          <div
            className={`activity-icon ${item.amount_cents > 0 ? "credit" : ""}`}
          >
            {item.transaction_type === "wire" ? (
              <Send size={17} />
            ) : (
              <Wallet size={17} />
            )}
          </div>
          <div className="activity-label">
            <strong>{item.description}</strong>
            <span>{date(item.created_at)} ET</span>
          </div>
          <div className="activity-amount">
            <strong className={item.amount_cents > 0 ? "positive" : ""}>
              {item.amount_cents > 0 ? "+" : "−"}
              {money(Math.abs(item.amount_cents))}
            </strong>
            <span>Completed</span>
          </div>
        </div>
      ))}
    </div>
  ) : (
    <div className="empty-state">
      <ActivityIcon />
      <h3>A fresh page.</h3>
      <p>
        Your completed transactions will appear here.
        <br />
        Pending wires reserve funds without posting a debit.
      </p>
    </div>
  );
}
function WireList({
  wires,
  customerId,
  busy,
  resolve,
}: {
  wires: Wire[];
  customerId: string;
  busy: boolean;
  resolve: (
    wire: Wire,
    action: "accept" | "decline" | "cancel",
  ) => Promise<void>;
}) {
  if (!wires.length)
    return (
      <div className="empty-state">
        <CheckCircle2 />
        <h3>Everything is in its place.</h3>
        <p>No wires to show right now.</p>
      </div>
    );
  return (
    <div className="wire-list">
      {wires.map((wire) => {
        const incoming = wire.receiver_customer_id === customerId;
        return (
          <article className="wire-item" key={wire.id}>
            <div className="wire-heading">
              <div>
                <span className="eyebrow">{incoming ? "FROM" : "TO"}</span>
                <h3>{incoming ? wire.sender_name : wire.receiver_name}</h3>
              </div>
              <strong>{money(wire.amount_cents)}</strong>
            </div>
            {wire.memo && <p className="wire-memo">{wire.memo}</p>}
            <div className="wire-meta">
              <span
                className={`status-pill ${wire.status === "accepted" ? "received" : ""}`}
              >
                {labels[wire.status]}
              </span>
              <time>{date(wire.created_at)} ET</time>
            </div>
            {wire.status === "pending_receiver" && (
              <div className="wire-actions">
                {incoming ? (
                  <>
                    <button
                      disabled={busy}
                      className="button primary"
                      onClick={() => void resolve(wire, "accept")}
                    >
                      <Check size={16} /> Receive
                    </button>
                    <button
                      disabled={busy}
                      className="button secondary"
                      onClick={() => void resolve(wire, "decline")}
                    >
                      Decline
                    </button>
                  </>
                ) : (
                  <button
                    disabled={busy}
                    className="text-button"
                    onClick={() => void resolve(wire, "cancel")}
                  >
                    Cancel wire
                  </button>
                )}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

function SendForm({
  csrf,
  available,
  frozen,
  onSent,
}: {
  csrf: string | null;
  available: number;
  frozen: boolean;
  onSent: () => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [recipient, setRecipient] = useState<Recipient | null>(null);
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const operation = useRef<{ signature: string; key: string } | null>(null);
  const cents = parseCents(amount);
  async function find(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      setRecipient(
        await api<Recipient>(
          `/recipients?query=${encodeURIComponent(query.trim())}`,
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function prepare(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!recipient || !cents || cents > available) {
      setError(
        "Choose a recipient and enter an amount covered by your available balance.",
      );
      return;
    }
    setReview(true);
  }
  async function send() {
    if (!recipient || !cents) return;
    const body = {
      receiver_id: recipient.id,
      amount_cents: cents,
      memo: memo.trim(),
    };
    const signature = JSON.stringify(body);
    if (operation.current?.signature !== signature)
      operation.current = { signature, key: crypto.randomUUID() };
    setBusy(true);
    setError("");
    try {
      await api("/wires", { body, csrf, key: operation.current.key });
      setSent(true);
      setReview(false);
      setQuery("");
      setRecipient(null);
      setAmount("");
      setMemo("");
      operation.current = null;
      await onSent();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (sent)
    return (
      <section className="panel send-panel sent-state">
        <div className="icon-tile">
          <CheckCircle2 size={30} />
        </div>
        <h2>A little Joe, on its way.</h2>
        <p>
          The receiver can now accept or decline. Your J$ stays held until they
          decide.
        </p>
        <button className="button primary" onClick={() => setSent(false)}>
          Send another wire
        </button>
      </section>
    );
  return (
    <section className="panel send-panel">
      <div className="section-heading">
        <div>
          <h2>{review ? "One last look" : "Send J$"}</h2>
          <p>
            {review
              ? "Confirm the details before your wire is sent."
              : "A member-to-member wire. No fees."}
          </p>
        </div>
        <Send size={19} />
      </div>
      {error && (
        <div className="message error" role="alert">
          {error}
        </div>
      )}
      {review && recipient ? (
        <div className="review">
          <span className="eyebrow">YOU'RE SENDING</span>
          <strong className="review-amount">{money(cents!)}</strong>
          <p>
            to <b>{recipient.display_name}</b>
            <br />
            <span className="muted small">{recipient.masked_email}</span>
          </p>
          {memo && <blockquote>{memo}</blockquote>}
          <div className="info-banner">
            <LockKeyhole size={18} />
            <p>
              This amount will be held until the receiver accepts or declines.
              You can cancel while it is pending.
            </p>
          </div>
          <button
            className="button primary wide"
            disabled={busy || frozen}
            onClick={() => void send()}
          >
            {busy ? "Sending…" : "Confirm and send"}
          </button>
          <button
            className="button secondary wide"
            disabled={busy}
            onClick={() => setReview(false)}
          >
            Edit details
          </button>
        </div>
      ) : (
        <>
          <form
            onSubmit={(event) => void find(event)}
            className="recipient-form"
          >
            <label htmlFor="recipient">Recipient</label>
            <p className="field-help">
              Enter their exact username or verified email.
            </p>
            <div className="input-with-button">
              <input
                id="recipient"
                value={query}
                required
                maxLength={254}
                autoComplete="off"
                placeholder="e.g. bob"
                disabled={busy || frozen}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setRecipient(null);
                }}
              />
              <button
                className="button secondary"
                disabled={busy || frozen || !query.trim()}
              >
                {busy ? "Finding…" : "Find"}
              </button>
            </div>
          </form>
          {recipient && (
            <div className="recipient-confirmed">
              <span className="avatar">{recipient.display_name[0]}</span>
              <div>
                <strong>{recipient.display_name}</strong>
                <small>{recipient.masked_email}</small>
              </div>
              <CheckCircle2 size={18} />
            </div>
          )}
          <form onSubmit={prepare} className="amount-form">
            <label htmlFor="amount">Amount</label>
            <div className="amount-input">
              <span>J$</span>
              <input
                id="amount"
                placeholder="0.00"
                inputMode="decimal"
                value={amount}
                disabled={busy || frozen}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
            </div>
            <p className="field-help">
              Available <strong>{money(available)}</strong>
            </p>
            <label htmlFor="memo">
              Memo <span className="muted">(optional)</span>
            </label>
            <textarea
              id="memo"
              maxLength={240}
              rows={3}
              placeholder="A note for your fellow Joe…"
              value={memo}
              disabled={busy || frozen}
              onChange={(e) => setMemo(e.target.value)}
            />
            <button
              className="button primary wide"
              disabled={
                !recipient || !cents || cents > available || busy || frozen
              }
            >
              Review wire
            </button>
          </form>
          <div className="simulation">
            <ShieldCheck size={17} />
            <span>
              The receiver decides when to receive. Funds never move without
              their acceptance.
            </span>
          </div>
        </>
      )}
    </section>
  );
}
