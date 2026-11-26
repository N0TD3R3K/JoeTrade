import { centralRequest } from "./central-client";
export const money = (value: number | null | undefined) =>
  value === null || value === undefined
    ? "Unavailable"
    : `J$${(value / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const nyTime = (value: number | null) =>
  value === null
    ? "Not scheduled"
    : new Date(value * 1000).toLocaleString("en-US", {
        timeZone: "America/New_York",
        timeZoneName: "short",
      });
export function toCents(value: FormDataEntryValue | null): number {
  const text = String(value ?? "");
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(text))
    throw new Error("Enter a J$ amount with up to two decimal places.");
  const [whole, fraction = ""] = text.split(".");
  return Number(BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0")));
}
export function percentagePpm(value: FormDataEntryValue | null): number {
  const text = String(value ?? "");
  if (!/^-?\d{1,3}(\.\d{1,3})?$/.test(text))
    throw new Error("Enter a percentage with up to three decimal places.");
  return Math.round(Number(text) * 10000);
}
export const economyAction = (
  surface: "member" | "console",
  action: string,
  input: unknown,
) =>
  centralRequest(
    surface,
    surface === "console" ? "/console/economy/commands" : "/economy/commands",
    { method: "POST", body: JSON.stringify({ action, input }) },
  );
