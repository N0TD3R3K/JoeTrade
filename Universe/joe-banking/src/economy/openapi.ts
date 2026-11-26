const read = (summary: string) => ({
  summary,
  responses: {
    200: { description: "JSON data envelope" },
    401: { description: "Sign in required" },
    403: { description: "Scoped permission required" },
  },
});
const write = (summary: string) => ({
  ...read(summary),
  parameters: [
    {
      in: "header",
      name: "Idempotency-Key",
      required: true,
      schema: { type: "string", minLength: 8, maxLength: 128 },
    },
    {
      in: "header",
      name: "X-CSRF-Token",
      required: true,
      schema: { type: "string" },
    },
  ],
  requestBody: {
    required: true,
    content: {
      "application/json": {
        schema: {
          type: "object",
          required: ["action", "input"],
          properties: { action: { type: "string" }, input: { type: "object" } },
        },
      },
    },
  },
});
export const bankingEconomyOpenApi = {
  openapi: "3.1.0",
  info: {
    title: "Joe Banking economy API",
    version: "0.2.0",
    description:
      "Fictional nonredeemable J$ only. Versioned approved terms and explicit member consent are required.",
  },
  paths: {
    "/economy/me": {
      get: read(
        "Own banking offers, agreements, subscriptions and tax statements",
      ),
    },
    "/economy/plans/{id}": {
      get: {
        ...read("Exact immutable checkout terms"),
        parameters: [
          {
            in: "path",
            name: "id",
            required: true,
            schema: { type: "string" },
          },
        ],
      },
    },
    "/economy/commands": {
      post: write(
        "Execute a scoped member/company/console economy command; internal commands are unavailable",
      ),
    },
    "/economy/console": { get: read("Banking operator treasury dashboard") },
    "/rates/current": { get: read("Approved current weekly Joe Rate") },
    "/rates/history": {
      get: read("Applied rate history with actual effective times"),
    },
  },
};
