export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function json(
  data: unknown,
  status = 200,
  extra: HeadersInit = {},
): Response {
  const headers = new Headers(extra);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify({ data }), { status, headers });
}

export async function readBody(
  request: Request,
  maximumBytes = 8192,
): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    throw new ApiError(415, "JSON_REQUIRED", "Use application/json.");
  }
  if (Number(request.headers.get("content-length")) > maximumBytes) {
    throw new ApiError(413, "BODY_TOO_LARGE", "The request is too large.");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).length > maximumBytes)
    throw new ApiError(413, "BODY_TOO_LARGE", "The request is too large.");
  try {
    const data: unknown = JSON.parse(text);
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw new Error();
    return data as Record<string, unknown>;
  } catch {
    throw new ApiError(400, "INVALID_JSON", "Provide a JSON object.");
  }
}

export function textField(
  value: unknown,
  name: string,
  max: number,
  required = true,
): string {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (required && !value.trim())
  ) {
    throw new ApiError(400, "INVALID_FIELD", `Provide a valid ${name}.`);
  }
  return value.trim();
}

export function amountField(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > 1_000_000_000_000
  ) {
    throw new ApiError(
      400,
      "INVALID_AMOUNT",
      "Use a positive whole-cent J$ amount.",
    );
  }
  return value;
}

export function idempotencyKey(request: Request): string {
  const key = request.headers.get("idempotency-key");
  if (!key || !/^[A-Za-z0-9_-]{8,128}$/.test(key)) {
    throw new ApiError(
      400,
      "IDEMPOTENCY_REQUIRED",
      "Provide an Idempotency-Key of 8–128 letters, digits, hyphens or underscores.",
    );
  }
  return key;
}

export async function sha256(value: string): Promise<string> {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
    (v) => v.toString(16).padStart(2, "0"),
  ).join("");
}

export function token(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export function cookie(request: Request, name: string): string | null {
  const pair = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return pair?.slice(name.length + 1) ?? null;
}
