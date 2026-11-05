/**
 * Next.js accessibility and React checks.
 * @package @vxture/workbench
 * @layer Presentation
 * @category config
 * @author AI-Generated
 * @date 2026-11-05
 */
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";
const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
});
const config = [
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts"] },
  ...compat.extends("next/core-web-vitals"),
];
export default config;
