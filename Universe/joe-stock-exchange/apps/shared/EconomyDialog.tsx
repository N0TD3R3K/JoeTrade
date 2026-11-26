import { useEffect, useRef, type ReactNode } from "react";
export function EconomyDialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLElement>(null),
    close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null,
      node = dialog.current!;
    const controls = () =>
      Array.from(
        node.querySelectorAll<HTMLElement>(
          'button,input,select,textarea,a[href],[tabindex="0"]',
        ),
      ).filter((e) => !(e as HTMLButtonElement).disabled);
    controls()[0]?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close.current();
      }
      if (event.key === "Tab") {
        const list = controls(),
          first = list[0],
          last = list.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="bank-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        ref={dialog}
        className="bank-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="economy-dialog-title"
      >
        <div className="bank-section-header">
          <h2 id="economy-dialog-title">{title}</h2>
          <button onClick={onClose} aria-label="Close dialog">
            Close
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
