import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Pure logic and server-rendered component regressions run without a browser DOM.
 * @package @vxture/console
 * @layer Presentation
 * @category test-config
 */
export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Match the application source alias without requiring local build artifacts.
      "@vxture/platform-browser": fileURLToPath(
        new URL("../../packages/platform/browser/src", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
