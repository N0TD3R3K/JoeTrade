import { feeForGross } from "@joese/market-rules";
import type {
  Holding,
  JoeBankSnapshot,
  MarketComment,
  MarketSnapshot,
  PortfolioSnapshot,
  UserPreferences,
} from "@joese/contracts";
import { formatJoellars, formatQuantity } from "@joese/ui";
import {
  BookOpen,
  ChevronLeft,
  Clock3,
  Inbox,
  Landmark,
  Menu,
  RefreshCw,
  Settings,
  ShieldCheck,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  applyForJoeBankLoan,
  createOrder,
  createShareOffer,
  createTransfer,
  decideJoeBankOffer,
  demoMode,
  loadJoeBank,
  loadMarket,
  loadPortfolio,
  postComment,
  repayJoeBankLoan,
  resolveShareOffer,
  resolveTransfer,
  updateSettings,
  verifyEmail,
} from "./api";
import { AuthScreen } from "./features/auth/AuthScreen";
import { AssetRail } from "./features/market/AssetRail";
import { MarketWorkspace } from "./features/market/MarketWorkspace";
import { PortfolioRail } from "./features/portfolio/PortfolioRail";
import { SettingsPage } from "./features/settings/SettingsPage";

import { ListingLaunch } from "../../shared/ListingLaunch";
import { CentralSignIn } from "../../shared/CentralSignIn";
import {
  centralMode,
  localTesting,
  switchTestMember,
} from "../../shared/central-client";

type Modal =
  "transaction" | "inbox" | "share-offer" | "joe-bank" | "listing" | null;

export function App() {
  const [mobilePanel, setMobilePanel] = useState<
    "listings" | "portfolio" | null
  >(null);
  const [testMode, setTestMode] = useState(false);
  const [market, setMarket] = useState<MarketSnapshot | null>(null);
  const [portfolio, setPortfolio] = useState<PortfolioSnapshot | null>(null);
  const [selectedTicker, setSelectedTicker] = useState("JAI");
  const [rightOpen, setRightOpen] = useState(true);
  const [page, setPage] = useState<"exchange" | "settings">(
    window.location.pathname.endsWith("/settings") ? "settings" : "exchange",
  );
  const [modal, setModal] = useState<Modal>(null);
  const [selectedHolding, setSelectedHolding] = useState<Holding | null>(null);
  const [loading, setLoading] = useState(true);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [marketResult, portfolioResult] = await Promise.all([
        loadMarket(),
        loadPortfolio(),
      ]);
      setMarket(marketResult);
      setPortfolio(portfolioResult);
      setTestMode(localTesting);
    } catch (error) {
      setPortfolio(null);
      setAuthMessage(
        error instanceof Error ? error.message : "Sign in to continue.",
      );
      if (!market) {
        try {
          setMarket(await loadMarket());
        } catch {
          setMarket(null);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [market]);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token");
    if (window.location.pathname === "/verify" && token && !demoMode) {
      void (async () => {
        try {
          await verifyEmail(token);
          window.history.replaceState({}, "", "/");
          setAuthMessage("School email verified. You can now sign in.");
        } catch (error) {
          setAuthMessage(
            error instanceof Error ? error.message : "Verification failed",
          );
        }
        setPortfolio(null);
        try {
          setMarket(await loadMarket());
        } catch {
          setMarket(null);
        }
        setLoading(false);
      })();
    } else {
      void refresh();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedAsset = useMemo(
    () =>
      market?.assets.find((asset) => asset.ticker === selectedTicker) ??
      market?.assets[0],
    [market, selectedTicker],
  );

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2600);
  };

  if (loading && !portfolio)
    return (
      <div className="loading-screen">
        <div className="brand-gem large">J</div>
        <span>Opening the exchange…</span>
      </div>
    );
  if (!portfolio && centralMode)
    return <CentralSignIn surface="member" message={authMessage} />;
  if (!portfolio)
    return (
      <AuthScreen onAuthenticated={refresh} initialMessage={authMessage} />
    );
  if (page === "settings") {
    return (
      <SettingsPage
        portfolio={portfolio}
        onBack={() => {
          setPage("exchange");
          window.history.pushState({}, "", "/");
        }}
        onSave={async (username, preferences) => {
          await updateSettings(username, preferences);
          setPortfolio((current) =>
            current
              ? {
                  ...current,
                  summary: { ...current.summary, username, preferences },
                }
              : current,
          );
        }}
      />
    );
  }
  if (!market || !selectedAsset)
    return (
      <div className="loading-screen">
        <span>Market data is unavailable.</span>
      </div>
    );

  const handleComment = async (body: string) => {
    await postComment(selectedAsset.ticker, body);
    const comment: MarketComment = {
      id: crypto.randomUUID(),
      assetTicker: selectedAsset.ticker,
      authorName: portfolio.summary.username,
      body,
      createdAt: new Date().toISOString(),
      status: "visible",
    };
    setMarket((current) =>
      current
        ? { ...current, comments: [comment, ...current.comments] }
        : current,
    );
  };

  return (
    <div
      className={`exchange-app ${rightOpen ? "" : "portfolio-collapsed"} ${mobilePanel ? `mobile-${mobilePanel}` : ""}`}
      style={
        {
          "--growth": portfolio.summary.preferences.growthColor,
          "--fall": portfolio.summary.preferences.fallColor,
        } as React.CSSProperties
      }
    >
      <header className="exchange-header">
        <button
          className="mobile-menu icon-button"
          aria-label="Open listings"
          onClick={() =>
            setMobilePanel(mobilePanel === "listings" ? null : "listings")
          }
        >
          <Menu size={19} />
        </button>
        <div className="brand-lockup">
          <span className="brand-gem">J</span>
          <div>
            <strong>JOESE</strong>
            <small>JOE Stock Exchange</small>
          </div>
        </div>
        <div className="market-clock">
          <span className={`status-dot ${market.marketStatus}`}></span>
          <strong>
            {market.marketStatus === "open"
              ? "Market open"
              : market.marketStatus}
          </strong>
          <span>
            <Clock3 size={14} /> Next tick{" "}
            {new Date(market.nextTickAt).toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
            })}
          </span>
        </div>
        <div className="header-actions">
          {testMode && (
            <select
              className="test-account-select"
              aria-label="Test member"
              value={portfolio.summary.id === "demo-bob" ? "bob" : "alice"}
              onChange={async (e) => {
                await switchTestMember(e.target.value as "alice" | "bob");
                await refresh();
              }}
            >
              <option value="alice">Alice · local test</option>
              <option value="bob">Bob · local test</option>
            </select>
          )}
          <a
            className="header-guide"
            href="/guide"
            aria-label="JoeSE member guide"
            title="Member guide"
          >
            <BookOpen size={18} />
            <span>Guide</span>
          </a>
          <button aria-label="Open inbox" onClick={() => setModal("inbox")}>
            <Inbox size={18} />
          </button>
          <button
            aria-label="Open settings"
            onClick={() => {
              setPage("settings");
              window.history.pushState({}, "", "/settings");
            }}
          >
            <Settings size={18} />
          </button>
          <button
            className="user-chip"
            aria-label="Open portfolio"
            onClick={() => {
              setRightOpen(true);
              setMobilePanel(mobilePanel === "portfolio" ? null : "portfolio");
            }}
          >
            {portfolio.summary.username.slice(0, 2).toUpperCase()}
          </button>
        </div>
      </header>
      {mobilePanel && (
        <button
          className="exchange-panel-scrim"
          aria-label="Close side panel"
          onClick={() => setMobilePanel(null)}
        />
      )}
      <div className="exchange-grid">
        <AssetRail
          assets={market.assets}
          selectedTicker={selectedAsset.ticker}
          onSelect={(ticker) => {
            setSelectedTicker(ticker);
            setMobilePanel(null);
          }}
          onAddListing={() => {
            setModal("listing");
            setMobilePanel(null);
          }}
        />
        <MarketWorkspace
          asset={selectedAsset}
          points={market.priceHistory[selectedAsset.ticker] ?? []}
          news={market.news}
          comments={market.comments}
          preferences={portfolio.summary.preferences}
          marketStatus={market.marketStatus}
          onComment={handleComment}
          onOrder={async (side, quantity) => {
            const order = await createOrder({
              ticker: selectedAsset.ticker,
              side,
              quantity,
            });
            await refresh();
            const message =
              order.status === "filled"
                ? `Order filled for ${formatQuantity(quantity)} ${selectedAsset.ticker}`
                : `${side === "buy" ? "Buy" : "Sell"} order opened for ${formatQuantity(quantity)} ${selectedAsset.ticker}`;
            notify(message);
            return message;
          }}
        />
        {rightOpen ? (
          <PortfolioRail
            portfolio={portfolio}
            onCollapse={() => {
              setRightOpen(false);
              setMobilePanel(null);
            }}
            onTransaction={() => setModal("transaction")}
            onInbox={() => setModal("inbox")}
            onSettings={() => {
              setPage("settings");
              window.history.pushState({}, "", "/settings");
            }}
            onJoeBank={() => setModal("joe-bank")}
            onSellShares={(holding) => {
              setSelectedHolding(holding);
              setModal("share-offer");
            }}
          />
        ) : (
          <button
            className="portfolio-reveal"
            onClick={() => setRightOpen(true)}
            title="Show portfolio"
          >
            <ChevronLeft size={18} />
            <span>Portfolio</span>
          </button>
        )}
      </div>
      {modal === "listing" && (
        <ListingLaunch
          surface="member"
          onClose={() => setModal(null)}
          onChanged={refresh}
        />
      )}
      {modal === "transaction" && (
        <TransactionModal
          available={portfolio.summary.disposableBalanceCents}
          onClose={() => setModal(null)}
          onSubmit={async (receiver, amountCents, message) => {
            await createTransfer(receiver, amountCents, message);
            await refresh();
            setModal(null);
            notify("Transaction sent to the receiver's inbox");
          }}
        />
      )}
      {modal === "inbox" && (
        <InboxModal
          portfolio={portfolio}
          onClose={() => setModal(null)}
          onTransfer={async (id, action) => {
            await resolveTransfer(id, action);
            await refresh();
            setModal(null);
            notify(`Transfer ${action === "accept" ? "received" : "declined"}`);
          }}
          onOffer={async (id, action) => {
            await resolveShareOffer(id, action);
            await refresh();
            setModal(null);
            notify(
              `Share offer ${action === "accept" ? "accepted" : "declined"}`,
            );
          }}
        />
      )}
      {modal === "share-offer" && selectedHolding && (
        <ShareOfferModal
          holding={selectedHolding}
          onClose={() => setModal(null)}
          onSubmit={async (buyer, quantity, askingPriceCents) => {
            await createShareOffer({
              buyer,
              ticker: selectedHolding.ticker,
              quantity,
              askingPriceCents,
            });
            await refresh();
            setModal(null);
            notify(`Frozen ${selectedHolding.ticker} offer sent to ${buyer}`);
          }}
        />
      )}
      {modal === "joe-bank" && (
        <JoeBankModal
          availableCents={portfolio.summary.disposableBalanceCents}
          onClose={() => setModal(null)}
          onPortfolioChange={refresh}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function ModalShell({
  title,
  eyebrow,
  onClose,
  children,
}: {
  title: string;
  eyebrow: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <div>
            <span className="eyebrow">{eyebrow}</span>
            <h2>{title}</h2>
          </div>
          <button aria-label={`Close ${title}`} onClick={onClose}>
            <X size={19} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

function TransactionModal({
  available,
  onClose,
  onSubmit,
}: {
  available: number;
  onClose: () => void;
  onSubmit: (
    receiver: string,
    amount: number,
    message: string,
  ) => Promise<void>;
}) {
  const [receiver, setReceiver] = useState("");
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const cents = parseAmount(amount);
  return (
    <ModalShell
      title="Send a transaction"
      eyebrow="RECEIVER APPROVAL REQUIRED"
      onClose={onClose}
    >
      <p className="modal-intro">
        The J$ is reserved now. It reaches the other account only after the
        receiver chooses Receive in their inbox.
      </p>
      <label className="form-field">
        <span>Receiver username or school email</span>
        <input
          value={receiver}
          onChange={(event) => setReceiver(event.target.value)}
          placeholder="joecoder"
        />
      </label>
      <label className="form-field">
        <span>Amount</span>
        <div className="money-input">
          <b>J$</b>
          <input
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            placeholder="0.00"
          />
        </div>
        <small>Disposable: {formatJoellars(available)}</small>
      </label>
      <label className="form-field">
        <span>Message</span>
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          maxLength={240}
          placeholder="What is this for?"
        />
      </label>
      {formError && (
        <div className="listing-error" role="alert">
          {formError}
        </div>
      )}
      <button
        className="modal-submit"
        disabled={busy || !receiver || cents <= 0 || cents > available}
        onClick={async () => {
          setBusy(true);
          setFormError("");
          try {
            await onSubmit(receiver, cents, message);
          } catch (error) {
            setFormError((error as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Sending…" : "Send to inbox"}
      </button>
    </ModalShell>
  );
}

function ShareOfferModal({
  holding,
  onClose,
  onSubmit,
}: {
  holding: Holding;
  onClose: () => void;
  onSubmit: (buyer: string, quantity: number, price: number) => Promise<void>;
}) {
  const [buyer, setBuyer] = useState("");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  return (
    <ModalShell
      title={`Offer ${holding.ticker} shareholding`}
      eyebrow="SELLER-INITIATED ONLY"
      onClose={onClose}
    >
      <p className="modal-intro">
        Choose the buyer directly. Buyers cannot submit requests for your frozen
        assets. A 0.25% fee applies on each side. Your net proceeds will be{" "}
        {formatJoellars(
          Math.max(0, parseAmount(price) - feeForGross(parseAmount(price))),
        )}
        ; the buyer pays{" "}
        {formatJoellars(parseAmount(price) + feeForGross(parseAmount(price)))}.
      </p>
      <div className="offer-summary">
        <span>Available frozen shares</span>
        <strong>{formatQuantity(holding.frozenQuantity)}</strong>
      </div>
      <label className="form-field">
        <span>Buyer username or school email</span>
        <input
          value={buyer}
          onChange={(event) => setBuyer(event.target.value)}
        />
      </label>
      <div className="form-split">
        <label className="form-field">
          <span>Shares</span>
          <input
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            inputMode="decimal"
          />
        </label>
        <label className="form-field">
          <span>Total asking price</span>
          <div className="money-input">
            <b>J$</b>
            <input
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              inputMode="decimal"
            />
          </div>
        </label>
      </div>
      {formError && (
        <div className="listing-error" role="alert">
          {formError}
        </div>
      )}
      <button
        className="modal-submit"
        disabled={
          busy ||
          !buyer ||
          !Number.isInteger(Number(quantity)) ||
          Number(quantity) <= 0 ||
          Number(quantity) > holding.frozenQuantity ||
          parseAmount(price) <= 0
        }
        onClick={async () => {
          setBusy(true);
          setFormError("");
          try {
            await onSubmit(buyer, Number(quantity), parseAmount(price));
          } catch (error) {
            setFormError((error as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Sending…" : "Send private offer"}
      </button>
    </ModalShell>
  );
}

function InboxModal({
  portfolio,
  onClose,
  onTransfer,
  onOffer,
}: {
  portfolio: PortfolioSnapshot;
  onClose: () => void;
  onTransfer: (id: string, action: "accept" | "decline") => Promise<void>;
  onOffer: (id: string, action: "accept" | "decline") => Promise<void>;
}) {
  const { transfers, shareOffers } = portfolio.inbox;
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const decide = async (run: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await run();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <ModalShell
      title="Inbox"
      eyebrow="PENDING FOR YOUR DECISION"
      onClose={onClose}
    >
      {error && (
        <div className="listing-error" role="alert">
          {error}
        </div>
      )}
      <div className="inbox-list">
        {transfers.map((item) => (
          <article className="inbox-item" key={item.id}>
            <div className="inbox-icon">J$</div>
            <div>
              <strong>
                {item.senderName} sent {formatJoellars(item.amountCents)}
              </strong>
              <p>{item.message || "No message"}</p>
              <span>Funds arrive only if you receive them.</span>
            </div>
            <div className="inbox-decisions">
              <button
                disabled={busy}
                onClick={() =>
                  void decide(() => onTransfer(item.id, "decline"))
                }
              >
                Decline
              </button>
              <button
                className="accept"
                disabled={busy}
                onClick={() => void decide(() => onTransfer(item.id, "accept"))}
              >
                Receive
              </button>
            </div>
          </article>
        ))}
        {shareOffers.map((item) => (
          <article className="inbox-item" key={item.id}>
            <div className="inbox-icon shares">{item.ticker}</div>
            <div>
              <strong>
                {item.sellerName} offered {formatQuantity(item.quantity)}{" "}
                {item.ticker}
              </strong>
              <p>Total asking price: {formatJoellars(item.askingPriceCents)}</p>
              <p>
                Buyer fee (0.25%):{" "}
                {formatJoellars(feeForGross(item.askingPriceCents))} · Total
                from your bank account:{" "}
                <strong>
                  {formatJoellars(
                    item.askingPriceCents + feeForGross(item.askingPriceCents),
                  )}
                </strong>
              </p>
              <span>Accepted shares remain frozen shareholding assets.</span>
            </div>
            <div className="inbox-decisions">
              <button
                disabled={busy}
                onClick={() => void decide(() => onOffer(item.id, "decline"))}
              >
                Decline
              </button>
              <button
                className="accept"
                disabled={busy}
                onClick={() => void decide(() => onOffer(item.id, "accept"))}
              >
                Accept offer
              </button>
            </div>
          </article>
        ))}
        {transfers.length + shareOffers.length === 0 && (
          <div className="empty-inbox">
            <Inbox size={32} />
            <strong>Your inbox is clear</strong>
            <span>
              Incoming transactions and private share offers appear here.
            </span>
          </div>
        )}
      </div>
    </ModalShell>
  );
}

function JoeBankModal({
  availableCents,
  onClose,
  onPortfolioChange,
}: {
  availableCents: number;
  onClose: () => void;
  onPortfolioChange: () => Promise<void>;
}) {
  const [bank, setBank] = useState<JoeBankSnapshot | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [repayment, setRepayment] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const reload = useCallback(async () => {
    setBank(await loadJoeBank());
  }, []);
  useEffect(() => {
    void reload().catch((error) =>
      setMessage(
        error instanceof Error ? error.message : "Joe Bank is unavailable.",
      ),
    );
  }, [reload]);
  const offered = bank?.loans.find((loan) => loan.stage === "offered");
  const awaiting = bank?.loans.find((loan) => loan.stage === "awaiting_review");
  const active = bank?.loans.find((loan) => loan.stage === "active");
  const applicationCents = Math.round(Number(amount) * 100);
  const repaymentCents = Math.round(Number(repayment) * 100);
  const run = async (action: () => Promise<void>, success: string) => {
    setBusy(true);
    setMessage("");
    try {
      await action();
      await Promise.all([reload(), onPortfolioChange()]);
      setMessage(success);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Joe Bank could not complete that request.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <ModalShell
      title="Joe Bank"
      eyebrow="SIMULATED RECOVERY LENDING"
      onClose={onClose}
    >
      {!bank ? (
        <div className="bank-loading">
          <RefreshCw size={18} /> Loading account status…
        </div>
      ) : (
        <>
          <div className="bank-status-row">
            <div>
              <span>Financial classification</span>
              <strong
                className={
                  bank.financialStatus === "bankrupt" ? "negative" : "positive"
                }
              >
                {bank.financialStatus === "bankrupt"
                  ? "Bankrupt — confirmed"
                  : "Normal"}
              </strong>
            </div>
            <div>
              <span>Application limit</span>
              <strong>{formatJoellars(bank.maxLoanCents)}</strong>
            </div>
          </div>
          <div className="bank-disclosure">
            <ShieldCheck size={17} />
            <p>{bank.disclosure}</p>
          </div>
          {awaiting && (
            <section className="bank-panel">
              <span className="eyebrow">UNDER REVIEW</span>
              <h3>{formatJoellars(awaiting.principalCents)} requested</h3>
              <p>
                Joe Bank has not offered terms yet. You may withdraw this
                application at any time.
              </p>
              <button
                className="bank-secondary"
                disabled={busy}
                onClick={() =>
                  void run(
                    () => decideJoeBankOffer(awaiting.id, "decline"),
                    "Application withdrawn.",
                  )
                }
              >
                Withdraw application
              </button>
            </section>
          )}
          {offered && (
            <section className="bank-panel offered">
              <span className="eyebrow">TERMS READY</span>
              <div className="bank-offer-grid">
                <div>
                  <small>Loan amount</small>
                  <strong>{formatJoellars(offered.principalCents)}</strong>
                </div>
                <div>
                  <small>Variable APR</small>
                  <strong>{(offered.annualRateBps / 100).toFixed(2)}%</strong>
                </div>
              </div>
              <p>
                {offered.decisionNote || "Joe Bank has offered these terms."}
              </p>
              <div className="bank-decisions">
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => decideJoeBankOffer(offered.id, "decline"),
                      "Loan offer declined.",
                    )
                  }
                >
                  Decline
                </button>
                <button
                  className="accept"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => decideJoeBankOffer(offered.id, "accept"),
                      "Loan accepted and added to disposable balance.",
                    )
                  }
                >
                  Accept terms
                </button>
              </div>
            </section>
          )}
          {active && (
            <section className="bank-panel active">
              <span className="eyebrow">ACTIVE LIABILITY</span>
              <div className="bank-offer-grid">
                <div>
                  <small>Outstanding</small>
                  <strong>{formatJoellars(active.outstandingCents)}</strong>
                </div>
                <div>
                  <small>Variable APR</small>
                  <strong>{(active.annualRateBps / 100).toFixed(2)}%</strong>
                </div>
              </div>
              <label className="form-field">
                <span>Repay from disposable J$</span>
                <div className="money-input">
                  <b>J$</b>
                  <input
                    value={repayment}
                    onChange={(event) => setRepayment(event.target.value)}
                    inputMode="decimal"
                    placeholder="0.00"
                  />
                </div>
                <small>Disposable now: {formatJoellars(availableCents)}</small>
              </label>
              <button
                className="modal-submit"
                disabled={
                  busy ||
                  repaymentCents <= 0 ||
                  repaymentCents > active.outstandingCents ||
                  repaymentCents > availableCents
                }
                onClick={() =>
                  void run(
                    () => repayJoeBankLoan(active.id, repaymentCents),
                    "Repayment recorded.",
                  )
                }
              >
                {busy ? "Recording…" : "Make repayment"}
              </button>
            </section>
          )}
          {bank.canApply && (
            <section className="bank-panel">
              <span className="eyebrow">NEW APPLICATION</span>
              <h3>Request recovery funds</h3>
              <p>
                An operator will review the request and offer a rate. No J$ is
                credited until you accept the terms.
              </p>
              <label className="form-field">
                <span>Requested amount</span>
                <div className="money-input">
                  <b>J$</b>
                  <input
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    inputMode="decimal"
                    placeholder="0.00"
                  />
                </div>
              </label>
              <label className="form-field">
                <span>Reason for request</span>
                <textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  maxLength={1000}
                  placeholder="Explain why recovery support is needed…"
                />
              </label>
              <button
                className="modal-submit"
                disabled={
                  busy ||
                  applicationCents <= 0 ||
                  applicationCents > bank.maxLoanCents ||
                  note.trim().length < 10
                }
                onClick={() =>
                  void run(async () => {
                    await applyForJoeBankLoan(applicationCents, note);
                    setAmount("");
                    setNote("");
                  }, "Application sent to Joe Bank.")
                }
              >
                {busy ? "Submitting…" : "Submit application"}
              </button>
            </section>
          )}
          {!bank.canApply &&
            !awaiting &&
            !offered &&
            !active &&
            bank.financialStatus !== "bankrupt" && (
              <div className="bank-ineligible">
                <Landmark size={22} />
                <strong>No borrowing access</strong>
                <span>
                  Joe Bank applications become available only after an operator
                  formally confirms bankruptcy.
                </span>
              </div>
            )}
          {bank.loans.length > 0 && (
            <section className="bank-history">
              <h3>Loan history</h3>
              {bank.loans.map((loan) => (
                <div key={loan.id}>
                  <span>
                    <strong>{formatJoellars(loan.principalCents)}</strong>
                    <small>
                      {new Date(loan.requestedAt).toLocaleDateString()}
                    </small>
                  </span>
                  <b className={`status-tag ${loan.stage}`}>
                    {loan.stage.replaceAll("_", " ")}
                  </b>
                </div>
              ))}
            </section>
          )}
        </>
      )}
      {message && <div className="auth-message bank-message">{message}</div>}
    </ModalShell>
  );
}

function parseAmount(value: string): number {
  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(value)) return 0;
  const [whole, fraction = ""] = value.split(".");
  return Number(BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0")));
}
