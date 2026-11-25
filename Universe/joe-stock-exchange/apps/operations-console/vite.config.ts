import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
export default defineConfig({
  plugins: [react()],
  server: {
    strictPort: true,
    proxy: {
      "/v1": {
        target: "http://127.0.0.1:8787",
        headers: { "x-joese-surface": "console" },
      },
    },
  },
});
