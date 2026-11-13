/**
 * Authentication regression test configuration.
 * @package @vxture/accounts
 * @layer Presentation
 * @category test-config
 * @author AI-Generated
 * @date 2026-11-13
 */
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  esbuild: { jsx: "automatic" },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
