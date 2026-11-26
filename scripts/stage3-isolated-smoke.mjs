// Deliberately uses the isolated QA ports. Never run this against working/remote data.
import assert from "node:assert/strict";
const api = "http://127.0.0.1:8789/v1",
  bank = "http://127.0.0.1:8790/v1",
  checks = [];
const mark = (name) => {
  checks.push(name);
  console.log("Passed:", name);
};
async function envelope(url, options = {}) {
  const r = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(15000),
    }),
    p = await r.json();
  return {
    status: r.status,
    data: p.data,
    error: p.error,
    cookie: r.headers.get("set-cookie")?.split(";")[0],
  };
}
async function login(member) {
  const surface = member === "operator" ? "console" : "member",
    origin =
      surface === "console" ? "http://127.0.0.1:4174" : "http://127.0.0.1:4173";
  const session = await envelope(api + "/sso/demo", {
    method: "POST",
    headers: {
      origin,
      "x-joese-surface": surface,
      "content-type": "application/json",
    },
    body: JSON.stringify({ member }),
  });
  assert.equal(session.status, 200);
  const cookie = session.cookie;
  const state = await envelope(api + "/sso/session", {
    headers: { cookie, "x-joese-surface": surface },
  });
  assert.equal(state.data.localDemo, true);
  return { cookie, surface, origin, csrf: state.data.csrf };
}
async function call(
  actor,
  path,
  body,
  key = crypto.randomUUID(),
  expected = 200,
) {
  const r = await envelope(api + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      cookie: actor.cookie,
      origin: actor.origin,
      "x-joese-surface": actor.surface,
      "x-csrf-token": actor.csrf,
      "idempotency-key": key,
      "content-type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.equal(
    r.status,
    expected,
    `${path}: ${r.error?.message ?? JSON.stringify(r.data)}`,
  );
  return r.data;
}
const alice = await login("alice"),
  bob = await login("bob"),
  operator = await login("operator");
const command = (actor, action, input = {}, key) =>
  call(
    actor,
    actor.surface === "console"
      ? "/console/economy/commands"
      : "/economy/commands",
    { action, input },
    key,
  );
const balance = async (actor) =>
  (await call(actor, "/me/portfolio")).summary.disposableBalanceCents;
const bobBefore = await balance(bob),
  aliceBefore = await balance(alice);
const draft = await command(operator, "policy.draft", {
  rules: {
    designVersion: "economy-v2",
    initialRatePpm: 10000,
    lendingBudgetCents: 1000000,
    redistributionBudgetCents: 10000,
    openingGrantsEnabled: false,
    loans: [
      {
        id: "stage3-fixed",
        title: "Isolated QA loan",
        minimumCents: 100,
        maximumCents: 100000,
        termWeeks: 4,
        weeklyRatePpm: 10000,
        variable: false,
        spreadPpm: 0,
      },
    ],
  },
});
await command(operator, "policy.approve", { id: draft.id });
await command(operator, "reserve.initialize", {}, "stage3-reserve-once");
await command(operator, "reserve.initialize", {}, "stage3-reserve-once");
mark("policy review and once-only reserve");
const company = (await call(alice, "/companies")).find(
  (c) => c.ticker === "TST",
);
assert(company);
await call(alice, "/companies/register", { companyId: company.id });
const service = await command(alice, "service.request", {
  companyId: company.id,
  appId: "stage3-isolated-service",
  name: "Isolated QA service",
});
await command(operator, "service.approve", { id: service.id });
const plan = await command(alice, "plan.create", {
  serviceId: service.id,
  title: "QA purchase",
  terms: "Fictional local testing only.",
  kind: "purchase",
  amountCents: 1000,
});
const consent = { planId: plan.id, termsHash: plan.termsHash, consent: true };
const payment = await command(
  bob,
  "checkout.accept",
  consent,
  "stage3-checkout-once",
);
await command(bob, "checkout.accept", consent, "stage3-checkout-once");
assert.equal(await balance(bob), bobBefore - 1000);
let report = (await call(alice, "/companies")).find((c) => c.id === company.id);
assert.equal(report.bank.totalRevenueCents, 1000);
assert.equal(report.bank.operatingCents, 1000);
const holder = (await call(bob, "/companies")).find((c) => c.id === company.id);
assert.equal(holder.bank.services, undefined);
assert.equal(holder.bank.payments, undefined);
mark("consented purchase, retry and scoped company reporting");
await command(alice, "payment.refund", { id: payment.id });
await command(alice, "payment.refund", { id: payment.id });
assert.equal(await balance(bob), bobBefore);
mark("full refund with no duplicate credit");
const recurring = await command(alice, "plan.create", {
  serviceId: service.id,
  title: "QA recurring plan",
  terms: "J$2 per calendar day; cancel future payments.",
  kind: "subscription",
  amountCents: 200,
  intervalDays: 1,
});
const subscription = await command(alice, "checkout.accept", {
  planId: recurring.id,
  termsHash: recurring.termsHash,
  consent: true,
});
await call(
  alice,
  "/economy/commands",
  { action: "subscription.retry", input: { id: subscription.subscriptionId } },
  crypto.randomUUID(),
  409,
);
await command(alice, "subscription.cancel", {
  id: subscription.subscriptionId,
});
assert.equal(
  (await call(alice, "/economy/me")).subscriptions[0].state,
  "canceled",
);
mark("recurring consent, early-retry denial and cancellation");
await command(alice, "company.pool", { companyId: company.id, poolBps: 5000 });
const agreement = await command(alice, "employee.invite", {
  companyId: company.id,
  employeeId: "bob",
  allocationBps: 10000,
});
await command(bob, "employee.accept", {
  id: agreement.id,
  termsHash: agreement.termsHash,
});
assert.equal((await call(bob, "/economy/me")).employees[0].state, "accepted");
mark("employee invitation and exact agreement acceptance");
const wire = await call(
  alice,
  "/transfers",
  { receiver: "bob", amountCents: 123, message: "Stage 3 isolated wire" },
  crypto.randomUUID(),
  201,
);
assert.equal(await balance(alice), aliceBefore - 200 - 123);
await call(bob, `/transfers/${wire.id}/accept`, {});
assert.equal(await balance(bob), bobBefore + 123);
mark("shared-bank receiver-approved wire");
const offer = await command(operator, "loan.offer", {
  customerId: "demo-bob",
  productId: "stage3-fixed",
  principalCents: 5000,
  expiresAt: Math.floor(Date.now() / 1000) + 86400,
});
assert.equal(await balance(bob), bobBefore + 123);
const loan = await command(bob, "loan.accept", {
  id: offer.id,
  termsHash: offer.termsHash,
});
assert.equal(await balance(bob), bobBefore + 5123);
await command(bob, "loan.repay", { id: loan.id, amountCents: 5000 });
assert.equal(await balance(bob), bobBefore + 123);
assert.equal(
  (await call(bob, "/economy/me")).offers[0].contract.state,
  "repaid",
);
mark("reserve-funded accepted loan and repayment");
const post = await call(alice, "/posts", {
  companyId: company.id,
  title: "Stage 3 isolated progress",
  body: "Testing both accounts and console moderation.",
});
await call(operator, `/console/posts/${post.id}/delete`, {
  version: 1,
  reason: "Remove isolated test post",
});
assert.equal(
  (await call(alice, "/posts")).find((p) => p.id === post.id).body,
  null,
);
mark("company post publication and console deletion");
const wall = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
})
  .format(new Date())
  .replace(" ", "T");
const tomorrow = new Date(
  Date.parse(wall.slice(0, 10) + "T12:00:00Z") + 86400000,
)
  .toISOString()
  .slice(0, 10);
const future = await command(operator, "rate.schedule", {
  policyVersion: draft.version,
  effectiveLocal: tomorrow + "T12:00",
  deltaPpm: -50,
  explanation: "Isolated future adjustment.",
});
await command(operator, "rate.cancel", { id: future.id });
const rate = await command(
  operator,
  "rate.schedule",
  {
    policyVersion: draft.version,
    effectiveLocal: wall,
    deltaPpm: -50,
    explanation: "Isolated effective adjustment.",
    internalNote: "PRIVATE QA NOTE",
  },
  "stage3-current-rate",
);
await command(
  operator,
  "rate.schedule",
  {
    policyVersion: draft.version,
    effectiveLocal: wall,
    deltaPpm: -50,
    explanation: "Isolated effective adjustment.",
    internalNote: "PRIVATE QA NOTE",
  },
  "stage3-current-rate",
);
await call(operator, "/console/economy/sync", {});
const news = (await call(alice, "/market/snapshot")).news.filter(
  (n) => n.sourceOperationId === rate.id,
);
assert.equal(news.length, 1);
assert.equal(news[0].direction, "bullish");
assert(!news[0].article.includes("PRIVATE QA NOTE"));
mark("scheduled cancellation and one applied public rate bulletin");
const bankLogin = await envelope(bank + "/dev/session", {
  method: "POST",
  headers: {
    origin: "http://127.0.0.1:4180",
    "content-type": "application/json",
  },
  body: JSON.stringify({ customer_id: "demo-bob" }),
});
assert.equal(bankLogin.status, 200);
const native = await envelope(bank + "/me/summary", {
  headers: { cookie: bankLogin.cookie },
});
assert.equal(native.data.available_cents, await balance(bob));
const nativeLoans = await envelope(bank + "/economy/me", {
  headers: { cookie: bankLogin.cookie },
});
assert.equal(nativeLoans.data.offers[0].contract.state, "repaid");
mark("bank website APIs see the same account and contract");
for (const port of [8790, 8789]) {
  const r = await fetch(`http://127.0.0.1:${port}/cdn-cgi/local/scheduled`, {
    signal: AbortSignal.timeout(20000),
  });
  assert.equal(r.status, 200, `scheduled ${port}: ${await r.text()}`);
}
const dashboard = await call(operator, "/console/economy");
assert.equal(dashboard.snapshot.state, "reconciled");
assert.equal(dashboard.snapshot.metrics.memberCount, 2);
mark("actual local scheduled workers and reconciled noon dashboard");
console.log(
  JSON.stringify(
    { passed: checks.length, checks, scope: "Isolated copied databases only" },
    null,
    2,
  ),
);
