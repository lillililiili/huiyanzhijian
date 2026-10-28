import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "./",
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["src/app/testSetup.ts"],
    testTimeout: 20000,
    include: [
      "src/app/**/*.test.ts",
      "src/app/**/*.test.tsx",
      "src/pages/**/*.test.ts",
      "src/pages/**/*.test.tsx",
      "src/charts/**/*.test.ts",
      "src/ui/**/*.test.tsx"
    ]
  },
  server: {
    proxy: { "/api": "http://127.0.0.1:4192" },
    host: "127.0.0.1",
    port: 4180,
    strictPort: true
  },
  preview: {
    proxy: { "/api": "http://127.0.0.1:4192" },
    host: "127.0.0.1",
    port: 4180,
    strictPort: true
  }
});
