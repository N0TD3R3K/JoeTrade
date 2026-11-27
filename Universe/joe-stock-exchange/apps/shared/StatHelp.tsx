import { useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { statisticHelp } from "./statistic-help";
import "./stat-help.css";

export function StatHelp({ label }: { label: string }) {
  const description = statisticHelp[label];
  const id = useId(), button = useRef<HTMLButtonElement>(null),
    tip = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false),
    [position, setPosition] = useState({ left: 16, top: 16, width: 280 });
  useLayoutEffect(() => {
    if (!open || !description) return;
    const place = () => {
      const anchor = button.current?.getBoundingClientRect();
      if (!anchor) return;
      const width = Math.min(280, window.innerWidth - 32),
        height = tip.current?.getBoundingClientRect().height ?? 100;
      const top = anchor.bottom + height + 24 <= window.innerHeight
        ? anchor.bottom + 8 : anchor.top - height - 8;
      setPosition({
        width,
        left: Math.max(16, Math.min(anchor.left + anchor.width / 2 - width / 2, window.innerWidth - width - 16)),
        top: Math.max(16, Math.min(top, window.innerHeight - height - 16)),
      });
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const outside = (event: PointerEvent) => {
      if (!button.current?.contains(event.target as Node) && !tip.current?.contains(event.target as Node)) setOpen(false);
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    document.addEventListener("keydown", escape);
    document.addEventListener("pointerdown", outside);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      document.removeEventListener("keydown", escape);
      document.removeEventListener("pointerdown", outside);
    };
  }, [open, description]);
  if (!description) return null;
  return (
    <span className="stat-help-anchor">
      <button
        ref={button}
        type="button"
        className="stat-help-trigger"
        aria-label={`About ${label}`}
        aria-describedby={open ? id : undefined}
        onPointerEnter={() => setOpen(true)}
        onPointerLeave={() => {
          if (document.activeElement !== button.current) setOpen(false);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(event) => { event.stopPropagation(); setOpen(true); }}
      >?</button>
      {open && createPortal(
        <span ref={tip} id={id} className="stat-help-popover" role="tooltip" style={position}>
          {description}
        </span>, document.body,
      )}
    </span>
  );
}
