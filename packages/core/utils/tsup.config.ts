import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", phone: "src/utils/phone.utils.ts" },
  format: ["esm", "cjs"],
  outExtension({ format }) {
    return { js: format === "esm" ? ".mjs" : ".cjs" };
  },
  dts: true,
  sourcemap: true,
  // clean 移至 package.json build 脚本显式执行，避免 watch 模式下触发循环
  target: "es2023",
  keepNames: true,
  treeshake: true,
});
