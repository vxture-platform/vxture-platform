/**
 * tsup.config.ts - @vxture/design-tokens 构建配置。
 *
 * 只打 TS 面；CSS 经 package exports 直接暴露源文件——Tailwind 需要读到 `@theme`
 * 原文，任何打包都会把它降级成普通变量声明，工具类就不产出了。
 */
import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm", "cjs"],
  outExtension({ format }) {
    return { js: format === "esm" ? ".mjs" : ".cjs" };
  },
  dts: true,
  clean: true,
  treeshake: true,
  sourcemap: true,
});
