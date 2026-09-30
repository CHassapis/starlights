import path from "path";
import { defineConfig } from "vitest/config";

// unit tests for the pure rules modules (src/**/*.test.ts); no browser needed
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
