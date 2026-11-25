import { readFileSync } from "node:fs";
let settings = {};
try {
  settings = Object.fromEntries(
    readFileSync(".env.production", "utf8")
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith("#"))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i), l.slice(i + 1).trim()];
      }),
  );
} catch {}
const values = { ...settings, ...process.env };
const errors = [];
if (values.VITE_API_BASE_URL !== "/v1")
  errors.push(
    "Use VITE_API_BASE_URL=/v1 for the same-origin Worker API proxy.",
  );
if (values.VITE_DEMO_MODE !== "false")
  errors.push("Disable synthetic frontend demo mode.");
if (values.VITE_IDENTITY_MODE !== "joeauth")
  errors.push("Set VITE_IDENTITY_MODE=joeauth.");
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
