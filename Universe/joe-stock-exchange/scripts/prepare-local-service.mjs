import { readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
const root = new URL("../", import.meta.url),
  bank = new URL("../joe-banking/.dev.vars", root),
  exchange = new URL("workers/exchange-api/.dev.vars", root);
function read(p) {
  return existsSync(p) ? readFileSync(p, "utf8") : "";
}
function value(text, name) {
  return text
    .split(/\r?\n/)
    .find((l) => l.startsWith(`${name}=`))
    ?.slice(name.length + 1)
    .trim();
}
function set(p, name, secret) {
  const lines = read(p)
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith(`${name}=`));
  writeFileSync(p, [...lines, `${name}=${secret}`, ""].join("\n"), {
    mode: 0o600,
  });
  chmodSync(fileURLToPath(p), 0o600);
}
const secret =
  value(read(bank), "JOESE_LOCAL_SERVICE_SECRET") ||
  randomBytes(36).toString("base64url");
set(bank, "JOESE_LOCAL_SERVICE_SECRET", secret);
set(exchange, "LOCAL_SERVICE_SECRET", secret);
if (!value(read(exchange), "SESSION_SECRET"))
  set(exchange, "SESSION_SECRET", randomBytes(48).toString("base64url"));
console.log(
  "Isolated local service credentials are ready. Secret values were not printed.",
);
