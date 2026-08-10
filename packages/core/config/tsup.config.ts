import { defineConfig } from "tsup";

export default defineConfig({
  // Two entries on purpose. The OpenAPI helper imports @nestjs/swagger at module
  // scope, so exporting it from the barrel would drag swagger (and its
  // class-transformer reach) into EVERY core-config consumer's bundle — varda-bff
  // and agent-template-bff included, which never asked for docs. A subpath keeps
  // the cost with the services that opt in.
  entry: { index: "src/index.ts", openapi: "src/utils/openapi.ts" },
  format: ["esm", "cjs"],
  outExtension({ format }) {
    return { js: format === "esm" ? ".mjs" : ".cjs" };
  },
  dts: true,
  sourcemap: true,
  // clean 移至 package.json build 脚本显式执行，避免 watch 模式下触发循环
  target: "es2023",
  treeshake: true,
  experimentalDts: false,
  esbuildOptions(options) {
    options.keepNames = true;
  },
});
