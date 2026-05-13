import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    restoreMocks: true,
    clearMocks: true,
    include: ["tests/renderer/**/*.test.{ts,tsx}"],
    coverage: {
      enabled: false
    }
  }
});
