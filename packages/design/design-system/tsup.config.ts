import { defineConfig } from "tsup";

/**
 * "use client" 注入插件
 *
 * 背景：tsup 的 banner 选项在 treeshake:true 时会被 Rollup 的 renderChunk 覆盖。
 * 改用 buildEnd 钩子（所有 renderChunk 完成、文件已写入磁盘后）直接修改产物文件，
 * 保证 "use client" 指令稳定前置在 ESM/CJS 产物首行。
 *
 * 只对主组件入口 index 注入。tokens/types/server 子入口保持 server-safe，
 * 供 Next Server Component 或后端工具安全读取类型和 token 引用。
 *
 * 注：tsup 会将 config 文件 bundle 成临时 .mjs，顶层 import 'fs' 会被 esbuild
 * 转换为 require('fs') 并在 ESM 上下文中失败。使用动态 import() 可绕过此问题。
 */
const useClientPlugin = {
  name: "use-client-banner",
  async buildEnd({ writtenFiles }: { writtenFiles: { name: string }[] }) {
    // 动态导入 fs，避免 tsup bundle config 时将顶层 import 转换为 require()
    const { readFileSync, writeFileSync } = await import("node:fs");

    for (const file of writtenFiles) {
      const normalized = file.name.replaceAll("\\", "/");
      if (/\/index\.(mjs|cjs)$/.test(normalized)) {
        const content = readFileSync(file.name, "utf8");
        if (!content.startsWith('"use client"')) {
          writeFileSync(file.name, `"use client";\n${content}`);
        }
      }
    }
  },
};

export default defineConfig({
  entry: {
    index: "src/index.ts",
    tokens: "src/tokens-entry.ts",
    types: "src/types-entry.ts",
    server: "src/server.ts",
  },
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
    options.jsx = "automatic";
    options.keepNames = true;
  },
  plugins: [useClientPlugin],

  // React 和 React-DOM 不打包进产物，由消费方提供。
  //
  // 注（vxture-platform#320，2026-08-20）：index 对 design-ui/design-tokens 的
  // 转发必须是【具名】再导出，不能是 `export *`——两包是 external（tsup 默认
  // externalize dependencies），`export *` 会原样留在产物里，叠加上面注入的
  // "use client" 后被 Next 15 的 next-flight-loader 在 server/client 边界硬拒
  // （"unsupported to use export * in a client boundary"）。workspace 源码消费
  // 不踩（指令在各组件文件、barrel 无指令），发布产物消费必炸（karda/yucer
  // 双双命中）。具名清单由 scripts/generate-reexports.mjs 在 build 前从两包
  // 已构建产物生成（src/generated-reexports.ts），类型经 `export type *` 转发
  // （编译期擦除，不产生运行时 export *）。不用 noExternal 打平：那会把
  // design-ui 的整棵三方依赖树（radix / use-sync-external-store / cmdk …）
  // 卷进产物——CJS interop 在 ESM 里渗漏 require()、且产生伞包未声明的幽灵
  // 依赖，两者都比本病更重。
  external: ["react", "react-dom", "react/jsx-runtime"],
});
