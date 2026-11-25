import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseConfigFileTextToJson } from "typescript";
const parsed = parseConfigFileTextToJson("wrangler.jsonc", readFileSync(resolve(process.cwd(), "wrangler.jsonc"), "utf8"));
if (parsed.error) throw new Error("The Worker configuration could not be read.");
const config = parsed.config;
function stop(message) {
  console.error(`Cloudflare deployment stopped: ${message}`);
  process.exit(1);
}
const ids = (config.d1_databases ?? []).map((x) => x.database_id);
if (
  !ids.length ||
  ids.some((id) => !id || /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(id))
)
  stop("replace the placeholder D1 database_id in this Worker configuration.");
if (config.vars?.BANKING_MODE !== "connected")
  stop("BANKING_MODE must be connected.");
if (config.name === "joese-exchange-api") {
  const v = config.vars ?? {};
  if (v.ENVIRONMENT !== "production" || v.LOCAL_DEMO !== "false")
    stop("production must disable local demo access.");
  for (const name of [
    "APP_ORIGIN",
    "CONSOLE_ORIGIN",
    "BANKING_API_URL",
    "JOEAUTH_ISSUER",
  ]) {
    try {
      const url = new URL(v[name]);
      if (url.protocol !== "https:" || !url.hostname.endsWith(".joe-univer.se"))
        throw new Error();
    } catch {
      stop(`${name} must be an approved HTTPS joe-univer.se address.`);
    }
  }
}
