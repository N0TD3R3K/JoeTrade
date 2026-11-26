import {
  BookOpen,
  Building2,
  ChartNoAxesCombined,
  LayoutDashboard,
  MessageSquare,
  Newspaper,
  NotebookPen,
  X,
} from "lucide-react";
import type { MouseEvent } from "react";
import { MEMBER_DESTINATIONS, type MemberPage } from "./routes";
const icons = {
  account: LayoutDashboard,
  market: ChartNoAxesCombined,
  news: Newspaper,
  posts: NotebookPen,
  discussion: MessageSquare,
  company: Building2,
};
export function MemberNavigation({
  page,
  open,
  onClose,
  onNavigate,
}: {
  page: MemberPage;
  open: boolean;
  onClose: () => void;
  onNavigate: (page: Exclude<MemberPage, "not-found">) => void;
}) {
  function follow(
    event: MouseEvent<HTMLAnchorElement>,
    destination: Exclude<MemberPage, "not-found">,
  ) {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    onNavigate(destination);
    onClose();
  }
  return (
    <>
      {open && (
        <button
          className="member-nav-scrim"
          aria-label="Close navigation overlay"
          onClick={onClose}
        />
      )}
      <aside className={`member-navigation ${open ? "is-open" : ""}`}>
        <div className="member-nav-brand">
          <span className="brand-gem">J</span>
          <div>
            <strong>JOESE</strong>
            <small>JOE UNIVERSE</small>
          </div>
          <button
            aria-label="Close navigation"
            className="member-nav-close"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        <nav aria-label="Member navigation">
          {MEMBER_DESTINATIONS.map((item) => {
            const Icon = icons[item.page];
            return (
              <a
                key={item.page}
                href={item.path}
                aria-current={page === item.page ? "page" : undefined}
                onClick={(e) => follow(e, item.page)}
              >
                <Icon size={19} />
                <span>{item.label}</span>
              </a>
            );
          })}
        </nav>
        <div className="member-nav-bottom">
          <a href="/guide">
            <BookOpen size={18} />
            Member guide
          </a>
          <p>
            Fictional J$ only.
            <br />
            One identity. One Banking balance.
          </p>
        </div>
      </aside>
    </>
  );
}
