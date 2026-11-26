import { useEffect, useRef, useState } from "react";
import { Landmark, X } from "lucide-react";
import {
  previewRate,
  rateChange,
  STAGE_ONE_CAPABILITIES,
} from "@joese/contracts";
import "./economy-foundation.css";
function percentPpm(value: string) {
  if (!/^-?\d{1,2}(\.\d{1,3})?$/.test(value))
    throw new Error("Use percentages with up to three decimal places.");
  const negative = value.startsWith("-"),
    [a, b = ""] = value.replace("-", "").split(".");
  return (
    Number((BigInt(a) * 1000n + BigInt(b.padEnd(3, "0"))) * 10n) *
    (negative ? -1 : 1)
  );
}
function RatePreview({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector("input")?.focus();
    return () => previous?.focus();
  }, []);

  const [current, setCurrent] = useState(""),
    [change, setChange] = useState(""),
    [result, setResult] = useState<string | null>(null),
    [error, setError] = useState("");
  return (
    <div className="economy-preview-backdrop">
      <section
        ref={dialog}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
          if (e.key === "Tab") {
            const controls = [
              ...dialog.current!.querySelectorAll<HTMLElement>(
                "button:not(:disabled),input:not(:disabled)",
              ),
            ];
            const first = controls[0],
              last = controls[controls.length - 1];
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last?.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first?.focus();
            }
          }
        }}
        className="economy-preview-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rate-preview-title"
      >
        <header>
          <div>
            <span className="eyebrow">CALCULATION ONLY</span>
            <h2 id="rate-preview-title">Rate adjustment preview</h2>
          </div>
          <button aria-label="Close rate preview" onClick={onClose}>
            <X size={22} />
          </button>
        </header>
        <p>
          This example does not read or change the current Joe Rate, schedule an
          operation, or publish news. The initial live rate has not been
          configured.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError("");
            setResult(null);
            try {
              const delta = rateChange(percentPpm(change));
              const next = previewRate(percentPpm(current), delta);
              setResult(
                `Example result: ${(next / 10000).toFixed(3)}% per week. ${delta < 0 ? "Bullish" : "Bearish"} news direction would apply only after a real operation succeeds. No operation was saved.`,
              );
            } catch (cause) {
              setError((cause as Error).message);
            }
          }}
        >
          <label>
            Example current weekly rate (%)
            <input
              value={current}
              onChange={(e) => {
                setCurrent(e.target.value);
                setResult(null);
              }}
              placeholder="Enter an example rate"
              inputMode="decimal"
              required
            />
          </label>
          <label>
            Signed change (percentage points)
            <input
              value={change}
              onChange={(e) => {
                setChange(e.target.value);
                setResult(null);
              }}
              placeholder="For example: -0.005"
              inputMode="decimal"
              required
            />
          </label>
          <label>
            Proposed date and time · America/New_York
            <input type="datetime-local" name="proposedLocalTime" required />
          </label>
          <p className="economy-preview-note">
            This field plans the future scheduling form. No timezone conversion
            or future operation is submitted in this calculation preview.
          </p>
          {error && (
            <p role="alert" className="economy-preview-error">
              {error}
            </p>
          )}
          {result && (
            <p role="status" className="economy-preview-result">
              {result}
            </p>
          )}
          <button type="submit">Calculate example</button>
        </form>
      </section>
    </div>
  );
}
export function BankEconomyFoundation() {
  const [previewOpen, setPreviewOpen] = useState(false);
  return (
    <div className="bank-economy-foundation">
      <section className="console-card connected-bank-card">
        <header className="connected-bank-heading">
          <span className="connected-bank-icon">
            <Landmark size={26} />
          </span>
          <div>
            <span className="eyebrow">SHARED ECONOMY</span>
            <h2>Joe Banking</h2>
          </div>
        </header>
        <div className="connected-bank-copy">
          <p>
            Banking owns the same liquid J$ used by the exchange. The panels
            below prepare its new controls; new banking operations are not
            available yet.
          </p>
          <p>
            Current member balances remain available in Members. Rate, tax,
            payroll and loan actions will require separate Banking permissions.
          </p>
        </div>
        <footer className="connected-bank-footer">
          <span>One balance across the Joe Universe.</span>
          <a href="https://bank.joe-univer.se">Open Joe Banking</a>
        </footer>
      </section>
      <div className="economy-foundation-grid">
        <section className="console-card economy-foundation-panel">
          <span className="economy-planned">Not connected</span>
          <h2>Economy snapshot</h2>
          <p>{STAGE_ONE_CAPABILITIES.economySnapshots.reason}</p>
          <dl>
            <div>
              <dt>Daily report</dt>
              <dd>12:00 noon · New York</dd>
            </div>
            <div>
              <dt>Planned initial reserve</dt>
              <dd>J$100,000 · not initialized</dd>
            </div>
            <div>
              <dt>Reserve warning</dt>
              <dd>Below J$90,000</dd>
            </div>
          </dl>
          <p>
            Future reports will separate member cash, holds, company cash,
            frozen capital, taxes and asset values. Missing data will not appear
            as zero.
          </p>
        </section>
        <section className="console-card economy-foundation-panel">
          <span className="economy-planned">Design preview</span>
          <h2>Interest-rate operations</h2>
          <p>{STAGE_ONE_CAPABILITIES.rateOperations.reason}</p>
          <p>
            Weekly rates: 0.300%–2.000%. Signed changes: 0.005–0.200 percentage
            points in 0.005 steps; at most two effective changes per New York
            week.
          </p>
          <button onClick={() => setPreviewOpen(true)}>
            Preview rate adjustment
          </button>
        </section>
        <section className="console-card economy-foundation-panel">
          <span className="economy-planned">Stage 2</span>
          <h2>Loan offers</h2>
          <p>{STAGE_ONE_CAPABILITIES.loans.reason}</p>
          <p>
            The future offer form will specify member, principal, weekly rate,
            term, payment schedule and expiry. The member must accept the exact
            terms before disbursement.
          </p>
          <button
            disabled
            title="An approved bank loan catalog and acceptance API are required."
          >
            Create loan offer · unavailable
          </button>
        </section>
        <section className="console-card economy-foundation-panel">
          <span className="economy-planned">Stage 2</span>
          <h2>Income, taxes and redistribution</h2>
          <p>
            Company receipts will fund employee payments and retained cash.
            Weekly tax uses the owner's whole-income brackets, followed by
            reserve-funded redistribution under an explicit budget.
          </p>
          <p>
            No company revenue, wage, tax, or distribution is being posted from
            this preview.
          </p>
          <p>
            Design example: J$1,600 of taxable income at 2% gives J$32 of tax.
          </p>
        </section>
      </div>
      {previewOpen && <RatePreview onClose={() => setPreviewOpen(false)} />}
    </div>
  );
}
