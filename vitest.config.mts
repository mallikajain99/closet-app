import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    // Everything under test is a pure function with no DOM dependency.
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
