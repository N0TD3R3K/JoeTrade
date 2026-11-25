const body = (properties: Record<string, unknown>, required: string[]) => ({
  required: true,
  content: {
    "application/json": { schema: { type: "object", properties, required } },
  },
});
const csrf = {
  name: "X-CSRF-Token",
  in: "header",
  required: true,
  schema: { type: "string" },
};
const key = {
  name: "Idempotency-Key",
  in: "header",
  required: true,
  schema: { type: "string", minLength: 8, maxLength: 128 },
};
const op = (summary: string, write = false, requestBody?: unknown) => ({
  summary,
  security: [{ memberSession: [] }, { consoleSession: [] }],
  ...(write ? { parameters: [csrf, key] } : {}),
  ...(requestBody ? { requestBody } : {}),
  responses: {
    "201": {
      description:
        "Order, proposal, offer or wire created; inspect status for pending matching.",
    },
    "200": {
      description:
        "JSON data envelope; financial responses contain the durable operation/reference.",
    },
    "401": { description: "JoeAuth sign-in required" },
    "403": { description: "Product permission or CSRF check denied" },
    "409": {
      description:
        "Invalid state, insufficient available funds, changed terms, or competing operation",
    },
    "503": {
      description:
        "Banking unavailable or settlement pending. Keep the same operation key when retrying.",
    },
  },
});
const listingBody = body(
  {
    ticker: { type: "string", pattern: "^[A-Z]{3}$" },
    name: { type: "string", minLength: 2, maxLength: 100 },
    description: { type: "string", minLength: 10, maxLength: 2000 },
    projectUrl: { type: "string", format: "uri" },
    developerUserId: {
      type: "string",
      description:
        "Required for staff-created proposals; member-created proposals always belong to that authenticated member.",
    },
    contributionCents: { type: "integer", minimum: 500000 },
    shares: { type: "integer", minimum: 1, maximum: 1000000 },
  },
  [
    "ticker",
    "name",
    "description",
    "projectUrl",
    "contributionCents",
    "shares",
  ],
);
export const connectedOpenApi = {
  openapi: "3.1.0",
  info: {
    title: "JoeTrade connected JOESE API",
    version: "0.2.0",
    description:
      "Fictional J$ only. JoeAuth supplies identity; Joe Banking owns liquid J$. Same-origin /v1 proxy recommended. Sign in through /sso/member/login or /sso/console/login; get a CSRF token from /sso/session. New accounts require an approved product and bank subject link. No password, deposit, cash-out, loan-disbursement or bank-redemption API is exposed here.",
  },
  servers: [{ url: "/v1" }],
  components: {
    securitySchemes: {
      memberSession: {
        type: "apiKey",
        in: "cookie",
        name: "joese_member_session",
      },
      consoleSession: {
        type: "apiKey",
        in: "cookie",
        name: "joese_console_session",
      },
    },
  },
  paths: {
    "/sso/session": { get: op("Current product session and CSRF token") },
    "/sso/{surface}/login": {
      get: {
        summary: "JoeAuth Authorization Code + PKCE redirect",
        parameters: [
          {
            name: "surface",
            in: "path",
            required: true,
            schema: { enum: ["member", "console"] },
          },
        ],
        responses: { "302": { description: "Redirect to JoeAuth" } },
      },
    },
    "/market/snapshot": {
      get: op("Published listings, quotes, history, news and schedule"),
    },
    "/me/portfolio": {
      get: op(
        "Holdings plus current available balance fetched from Joe Banking",
      ),
    },
    "/me/inbox": { get: op("Incoming bank wires and private share offers") },
    "/orders": {
      post: op(
        "Reserve an order through Banking and enter the member matching queue",
        true,
        body(
          {
            ticker: { type: "string" },
            side: { enum: ["buy", "sell"] },
            quantity: { type: "number", exclusiveMinimum: 0 },
            limitPriceCents: { type: "integer", minimum: 1 },
          },
          ["ticker", "side", "quantity"],
        ),
      ),
    },
    "/orders/{id}/cancel": {
      post: op("Cancel own remaining order and release its cash/assets", true),
    },
    "/transfers": {
      post: op(
        "Send a receiver-approved Joe Banking wire",
        true,
        body(
          {
            receiver: { type: "string" },
            amountCents: { type: "integer", minimum: 1 },
            message: { type: "string", maxLength: 240 },
          },
          ["receiver", "amountCents"],
        ),
      ),
    },
    "/transfers/{id}/{action}": {
      post: op(
        "Accept/decline an incoming wire or cancel own pending wire",
        true,
      ),
    },
    "/share-offers": {
      post: op(
        "Reserve own frozen shares for a named member; never redeem to the bank",
        true,
        body(
          {
            buyer: { type: "string" },
            ticker: { type: "string" },
            quantity: { type: "integer", minimum: 1 },
            askingPriceCents: { type: "integer", minimum: 1 },
          },
          ["buyer", "ticker", "quantity", "askingPriceCents"],
        ),
      ),
    },
    "/share-offers/{id}/{action}": {
      post: op(
        "Named buyer accepts/declines, or seller cancels. Acceptance moves exact shares and settles banking funds",
        true,
      ),
    },
    "/listings": {
      get: op("Own listing proposals"),
      post: op(
        "Submit own company for operator review without moving cash",
        true,
        listingBody,
      ),
    },
    "/listing-proposals/{id}/launch": {
      post: op(
        "Founder confirms approved capital contribution and receives frozen shares",
        true,
      ),
    },
    "/console/listing-proposals": {
      get: op("Staff launch queue"),
      post: op(
        "Prepare a proposal for a linked founder; never debit the founder",
        true,
        listingBody,
      ),
    },
    "/console/listing-proposals/{id}/{action}": {
      post: op("Staff approves or declines a proposal", true),
    },
    "/console/assets": { get: op("Staff listing details") },
    "/console/assets/{ticker}": {
      patch: op(
        "Edit attributed company information; prices and financial ownership are not editable",
        true,
      ),
    },
    "/console/members": {
      get: op("Staff members with current Banking balances"),
    },
    "/console/news": {
      get: op("Staff news records"),
      post: op("Create an attributed Joe Wire event", true),
    },
    "/console/comments": { get: op("Moderation queue") },
    "/console/market": { get: op("Market ticks and order counts") },
    "/console/audit": { get: op("Attributed product audit trail") },
    "/console/financial-operations": {
      get: op("Recover and inspect settlement operations"),
    },
  },
};

for (const [path, value] of Object.entries(connectedOpenApi.paths)) {
  const names = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
  if (!names.length || path.includes("{surface}")) continue;
  const item = value as unknown as Record<string, unknown>;
  item.parameters = names.map((name) => ({
    name,
    in: "path",
    required: true,
    schema:
      name === "action"
        ? {
            type: "string",
            enum: path.includes("listing-proposals")
              ? ["approve", "decline"]
              : ["accept", "decline", "cancel"],
          }
        : { type: "string" },
  }));
}
