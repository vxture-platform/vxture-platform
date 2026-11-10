/**
 * Resolve browser helpers from source in clean portal test environments.
 * @package @vxture/workbench
 * @layer Presentation
 * @category test-config
 * @author AI-Generated
 * @date 2026-11-11
 */
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@vxture/platform-browser": fileURLToPath(
        new URL("../../packages/platform/browser/src", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
