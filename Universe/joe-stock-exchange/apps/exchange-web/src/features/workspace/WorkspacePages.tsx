import { MemberBankPanel } from "./MemberBankPanel";
import type { Holding, NewsEvent, PortfolioSnapshot } from "@joese/contracts";
import { formatJoellars } from "@joese/ui";
import { ArrowLeftRight, Inbox, Landmark, Newspaper } from "lucide-react";
import { PortfolioRail } from "../portfolio/PortfolioRail";
export function AccountOverview({
  portfolio,
  onTransaction,
  onInbox,
  onOffer,
  onSettings,
  onJoeBank,
}: {
  portfolio: PortfolioSnapshot;
  onTransaction: () => void;
  onInbox: () => void;
  onOffer: (holding: Holding) => void;
  onSettings: () => void;
  onJoeBank: () => void;
}) {
  return (
    <section className="workspace-page account-page">
      <div className="workspace-heading">
        <span className="workspace-eyebrow">YOUR JOE UNIVERSE ACCOUNT</span>
        <h1>Account Overview</h1>
        <p>Your available J$, investments and company shares in one place.</p>
      </div>
      <div className="workspace-quick-actions">
        <button onClick={onTransaction}>
          <ArrowLeftRight size={18} />
          New transaction
        </button>
        <button onClick={onInbox}>
          <Inbox size={18} />
          Inbox (
          {portfolio.inbox.transfers.length +
            portfolio.inbox.shareOffers.length}
          )
        </button>
        <a href="https://bank.joe-univer.se">
          <Landmark size={18} />
          Joe Banking
        </a>
      </div>
      <PortfolioRail
        variant="overview"
        portfolio={portfolio}
        onCollapse={() => {}}
        onTransaction={onTransaction}
        onInbox={onInbox}
        onSellShares={onOffer}
        onSettings={onSettings}
        onJoeBank={onJoeBank}
      />
      {import.meta.env.VITE_DEMO_MODE !== "true" && (
        <MemberBankPanel key={portfolio.summary.id} />
      )}
      <p className="workspace-footnote">
        Asset values are reference estimates. Frozen shares require a named
        member's accepted offer; Banking does not redeem them.
      </p>
    </section>
  );
}
export function MemberNews({ news }: { news: NewsEvent[] }) {
  const published = news
    .filter((n) => n.status === "published")
    .sort(
      (a, b) =>
        new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
    );
  return (
    <section className="workspace-page">
      <div className="workspace-heading">
        <span className="workspace-eyebrow">THE JOE WIRE</span>
        <h1>News</h1>
        <p>
          Published events from across the exchange. Rate-operation bulletins
          will join this feed when Banking's scheduled operations are connected.
        </p>
      </div>
      {!published.length ? (
        <div className="workspace-state">
          <Newspaper size={28} />
          <h2>No published articles yet</h2>
          <p>Drafts and scheduled bulletins appear only when published.</p>
        </div>
      ) : (
        <div className="member-news-list">
          {published.map((item) => (
            <article
              key={item.id}
              className="member-news-article"
              id={`article-${item.id}`}
            >
              <div className="member-news-meta">
                <span>{item.category}</span>
                <span>
                  {item.direction} · {item.severity}
                </span>
                <time dateTime={item.publishedAt}>
                  {new Date(item.publishedAt).toLocaleString(undefined, {
                    timeZone: "America/New_York",
                    timeZoneName: "short",
                  })}
                </time>
              </div>
              <h2>{item.headline}</h2>
              <p>{item.article}</p>
              {item.effectiveAt && (
                <p>
                  Effective:{" "}
                  {new Date(item.effectiveAt).toLocaleString(undefined, {
                    timeZone: "America/New_York",
                    timeZoneName: "short",
                  })}
                </p>
              )}
              {item.sourceOperationId && (
                <a href={`#article-${item.id}`}>
                  Rate operation {item.sourceOperationId}
                </a>
              )}
              <footer>
                <span>{item.authorName}</span>
                <span>{item.affectedTickers.join(" · ")}</span>
              </footer>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
export function PlannedMemberPage({
  onBrowse,
}: {
  kind: "discussion";
  portfolio: PortfolioSnapshot;
  onBrowse: () => void;
}) {
  return (
    <section className="workspace-page">
      <div className="workspace-heading">
        <span className="workspace-eyebrow">MEMBER WORKSPACE</span>
        <h1>Discussion</h1>
        <p>A future space for all members to share their opinions.</p>
      </div>
      <div className="workspace-state">
        <span className="workspace-status">Design deferred</span>
        <h2>Discussion is planned</h2>
        <p>
          Posting, threading and moderation remain to be designed.
          Listing-specific comments are available in Stock Listings.
        </p>
        <button onClick={onBrowse}>Browse stock listings</button>
      </div>
    </section>
  );
}
