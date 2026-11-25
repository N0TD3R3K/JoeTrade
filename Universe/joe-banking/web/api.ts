export interface Member {
  id: string;
  display_name: string;
  email: string;
  username: string;
  status: string;
  role: string;
}
export interface AuthState {
  customer: Member | null;
  csrf_token: string | null;
  local_demo: boolean;
  joeauth_configured: boolean;
}
export interface Summary {
  posted_cents: number;
  available_cents: number;
  held_cents: number;
  flexible_deposit_cents: number;
  inbox_count: number;
  holds: Array<{ purpose: string; amount_cents: number }>;
}
export interface Wire {
  id: string;
  sender_customer_id: string;
  receiver_customer_id: string;
  amount_cents: number;
  memo: string;
  status: "pending_receiver" | "accepted" | "declined" | "cancelled_by_sender";
  created_at: number;
  resolved_at: number | null;
  sender_name: string;
  receiver_name: string;
}
export interface Activity {
  id: string;
  transaction_type: string;
  description: string;
  amount_cents: number;
  created_at: number;
}
export interface Recipient {
  id: string;
  display_name: string;
  masked_email: string;
}

export async function api<T>(
  path: string,
  options?: { body?: unknown; csrf?: string | null; key?: string },
): Promise<T> {
  const response = await fetch(`/v1${path}`, {
    method: options ? "POST" : "GET",
    credentials: "same-origin",
    headers: options
      ? {
          "content-type": "application/json",
          ...(options.csrf ? { "x-csrf-token": options.csrf } : {}),
          ...(options.key ? { "idempotency-key": options.key } : {}),
        }
      : {},
    body: options ? JSON.stringify(options.body ?? {}) : undefined,
  });
  const result = (await response.json()) as {
    data: T;
    error?: { message: string };
  };
  if (!response.ok)
    throw new Error(
      result.error?.message ?? "This action could not be completed.",
    );
  return result.data;
}

export function money(cents: number): string {
  return `J$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function parseCents(input: string): number | null {
  if (!/^\d{1,11}(?:\.\d{1,2})?$/.test(input)) return null;
  const [whole, fraction = ""] = input.split(".");
  const cents = Number(BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0")));
  return cents > 0 && cents <= 1_000_000_000_000 && Number.isSafeInteger(cents)
    ? cents
    : null;
}

export function date(value: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  }).format(value * 1000);
}
