import { defineConfig } from "tsup";

export default defineConfig({
  // 两个入口分开打包：`edge` 不得把主入口的服务端依赖捎带进 Edge runtime。
  entry: ["src/index.ts", "src/edge.ts"],
  format: ["esm", "cjs"],
  outExtension({ format }) {
    return { js: format === "esm" ? ".mjs" : ".cjs" };
  },
  dts: true,
  sourcemap: true,
  target: "es2023",
  treeshake: true,
  external: ["next", "next/server"],
  experimentalDts: false,
  esbuildOptions(options) {
    options.keepNames = true;
  },
});
