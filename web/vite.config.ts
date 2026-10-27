import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "./",
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["src/app/testSetup.ts"],
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
    host: "127.0.0.1",
    port: 4180,
    strictPort: true
  },
  preview: {
    host: "127.0.0.1",
    port: 4180,
    strictPort: true
  }
});
