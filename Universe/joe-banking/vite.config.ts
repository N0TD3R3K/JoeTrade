import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist/client" },
  server: { proxy: { "/v1": "http://127.0.0.1:8788" } },
  test: { include: ["tests/**/*.test.ts"] },
});
