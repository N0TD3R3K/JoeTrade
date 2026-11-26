import { spawn, execFileSync } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  unlinkSync,
  createWriteStream,
} from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import net from "node:net";
const root = fileURLToPath(new URL("../", import.meta.url)),
  state = path.join(root, ".wrangler/local");
const record = path.join(state, "running.json");
const urls = {
  exchange: "http://127.0.0.1:4173/",
  console: "http://127.0.0.1:4174/",
  bank: "http://127.0.0.1:4180/",
};
function owned(pid) {
  try {
    return (
      execFileSync("ps", ["-p", String(pid), "-o", "command="], {
        encoding: "utf8",
      }).includes("scripts/local-dev.mjs") &&
      execFileSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], {
        encoding: "utf8",
      })
        .split("\n")
        .includes("n" + root.replace(/\/$/, ""))
    );
  } catch {
    return false;
  }
}
if (process.argv.includes("--stop")) {
  if (existsSync(record)) {
    const run = JSON.parse(readFileSync(record));
    if (owned(run.pid)) {
      process.kill(run.pid, "SIGINT");
      console.log(
        "Stopping the three local websites and their background services.",
      );
    } else console.log("No owned local preview is running.");
  } else console.log("No local preview is running.");
  process.exit(0);
}
if (existsSync(record)) {
  const run = JSON.parse(readFileSync(record));
  if (owned(run.pid)) {
    console.log("Local websites already running:", urls);
    process.exit(0);
  }
}
for (const port of [4173, 4174, 4180, 8787, 8788, 8791]) {
  const free = await new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
  if (!free)
    throw new Error(
      `Port ${port} is already used. Stop that preview before starting this one.`,
    );
}
mkdirSync(state, { recursive: true });
const exchange = path.join(root, "Universe/joe-stock-exchange"),
  bank = path.join(root, "Universe/joe-banking");
const credentials = readFileSync(
  path.join(exchange, "workers/exchange-api/.dev.vars"),
  "utf8",
);
const secret = credentials
  .split(/\r?\n/)
  .find((line) => line.startsWith("LOCAL_SERVICE_SECRET="))
  ?.split("=")
  .slice(1)
  .join("=")
  .trim()
  .replace(/^['"]|['"]$/g, "");
if (!secret || secret.length < 32)
  throw new Error(
    "The existing local service credentials need to be prepared first.",
  );
const engineDir = path.join(state, "engine");
mkdirSync(engineDir, { recursive: true });
writeFileSync(
  path.join(engineDir, ".dev.vars"),
  `INTERNAL_API_KEY=${secret}\n`,
  { mode: 0o600 },
);
writeFileSync(
  path.join(engineDir, "wrangler.json"),
  JSON.stringify(
    {
      name: "joese-market-engine-local",
      main: path.join(exchange, "workers/market-engine/src/index.ts"),
      compatibility_date: "2026-11-11",
      workers_dev: false,
      vars: { BANKING_MODE: "connected" },
      triggers: { crons: ["0 * * * *"] },
      d1_databases: [
        {
          binding: "DB",
          database_name: "joese-local",
          database_id: "11111111-1111-1111-1111-111111111111",
          migrations_dir: path.join(exchange, "database/migrations"),
        },
      ],
    },
    null,
    2,
  ),
);
const children = [];
let stopping = false,
  timer;
function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  for (const child of children) child.kill("SIGINT");
  if (existsSync(record)) unlinkSync(record);
  setTimeout(() => {
    for (const child of children)
      if (child.exitCode === null) child.kill("SIGTERM");
    process.exit(0);
  }, 1500);
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, stop);
function start(name, cwd, bin, args) {
  const log = createWriteStream(path.join(state, name + ".log"), {
      flags: "a",
    }),
    child = spawn(bin, args, {
      cwd,
      env: {
        ...process.env,
        WRANGLER_SEND_METRICS: "false",
        WRANGLER_LOG_PATH: path.join(state, name + "-wrangler.log"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
  children.push(child);
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  child.on("exit", (code) => {
    if (!stopping) {
      console.error(
        `${name} stopped (${code}). See ${path.join(state, name + ".log")}`,
      );
      stop();
    }
  });
  return child;
}
const wrangler = (project) => path.join(project, "node_modules/.bin/wrangler");
start("bank-api", bank, wrangler(bank), [
  "dev",
  "--local",
  "--ip",
  "127.0.0.1",
  "--port",
  "8788",
  "--inspector-port",
  "9238",
  "--test-scheduled",
  "--persist-to",
  ".wrangler/state",
]);
start("exchange-api", exchange, wrangler(exchange), [
  "dev",
  "--local",
  "--ip",
  "127.0.0.1",
  "--port",
  "8787",
  "--inspector-port",
  "9237",
  "--test-scheduled",
  "--persist-to",
  ".wrangler/state",
  "--config",
  "workers/exchange-api/wrangler.local.jsonc",
]);
start("market-engine", exchange, wrangler(exchange), [
  "dev",
  "--local",
  "--ip",
  "127.0.0.1",
  "--port",
  "8791",
  "--inspector-port",
  "9239",
  "--persist-to",
  ".wrangler/state",
  "--config",
  path.join(engineDir, "wrangler.json"),
]);
start("exchange-web", exchange, path.join(exchange, "node_modules/.bin/vite"), [
  "--host",
  "127.0.0.1",
  "--port",
  "4173",
  "--strictPort",
  "--config",
  path.join(exchange, "apps/exchange-web/vite.config.ts"),
  path.join(exchange, "apps/exchange-web"),
]);
start("console-web", exchange, path.join(exchange, "node_modules/.bin/vite"), [
  "--host",
  "127.0.0.1",
  "--port",
  "4174",
  "--strictPort",
  "--config",
  path.join(exchange, "apps/operations-console/vite.config.ts"),
  path.join(exchange, "apps/operations-console"),
]);
start("bank-web", bank, path.join(bank, "node_modules/.bin/vite"), [
  "--host",
  "127.0.0.1",
  "--port",
  "4180",
  "--strictPort",
]);
// Vite reads only the needed local testing flags; production configuration is untouched.
for (const child of children)
  child.on("error", (error) => {
    console.error(error.message);
    stop();
  });
writeFileSync(
  record,
  JSON.stringify(
    {
      pid: process.pid,
      children: children.map((c) => c.pid),
      urls,
      startedAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
async function ready(url) {
  for (let attempt = 0; attempt < 100 && !stopping; attempt++) {
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Could not start ${url}`);
}
try {
  await Promise.all([
    ready("http://127.0.0.1:8788/v1/health"),
    ready("http://127.0.0.1:8787/v1/health"),
    ready("http://127.0.0.1:8791/health"),
    ...Object.values(urls).map(ready),
  ]);
} catch (error) {
  console.error(error.message);
  stop();
}
let runningJobs = false;
async function jobs() {
  if (stopping || runningJobs) return;
  runningJobs = true;
  try {
    for (const port of [8788, 8787]) {
      const response = await fetch(
        `http://127.0.0.1:${port}/cdn-cgi/local/scheduled`,
        { signal: AbortSignal.timeout(12000) },
      );
      if (!response.ok)
        console.error(
          `Local scheduled work on ${port} will retry (${response.status}).`,
        );
    }
    const hour = new Date(
      Math.floor(Date.now() / 3600000) * 3600000,
    ).toISOString();
    const response = await fetch("http://127.0.0.1:8791/run", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-api-key": secret,
      },
      body: JSON.stringify({ scheduledAt: hour, force: false }),
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok)
      console.error(`Local market tick will retry (${response.status}).`);
  } catch {
    console.error("Local scheduled work will retry shortly.");
  } finally {
    runningJobs = false;
  }
}
if (!stopping) {
  console.log("Ready for local testing:");
  for (const [name, url] of Object.entries(urls))
    console.log(`${name}: ${url}`);
  console.log(
    "Alice/Bob demo accounts, separate operator, and local scheduled work are enabled.",
  );
  timer = setInterval(jobs, 60000);
  await jobs();
}
