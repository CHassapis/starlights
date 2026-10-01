import path from "path";
import { defineConfig } from "vitest/config";

// unit tests for the pure rules modules and the compendium (renderer tests render to static HTML); no browser needed
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "lore-ingest/**/*.test.ts"],
    environment: "node",
  },
});
