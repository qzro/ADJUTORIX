import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    restoreMocks: true,
    clearMocks: true,
    include: [
      "tests/renderer/editor_buffers.test.ts",
      "tests/renderer/file_tree_pane.test.tsx",
      "tests/renderer/diagnostic_parser.test.ts",
      "tests/renderer/about_panel.test.tsx",
      "tests/renderer/release_surface_guard.test.ts",
      "tests/renderer/interaction_contract.test.tsx",
      "tests/renderer/active_buffer_diff_review.test.ts"
    ],
    coverage: {
      enabled: false
    }
  }
});
