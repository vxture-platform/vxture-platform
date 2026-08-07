import { defineConfig } from "tsup";

/**
 * "use client" 注入插件。
 *
 * 背景：tsup 的 banner 选项在 treeshake:true 时会被 Rollup 的 renderChunk 覆盖。
 * 改用 buildEnd 钩子（所有 renderChunk 完成、文件已写入磁盘后）直接改产物首行。
 *
 * ⚠ 必须包成**插件**，不能直接写在 defineConfig 顶层：DTS 走 worker 线程，
 *   顶层的 buildEnd 会被 structuredClone 序列化，而函数不可克隆——报
 *   DataCloneError，且 JS 产物已经写完，看起来像"构建卡住"。
 *
 * 只对 index 注入。server 子入口刻意不加——它承载的是可在 RSC 中渲染的纯叶子，
 * 加了反而把消费方拖成客户端组件。
 *
 * 注：tsup 会把 config 打成临时 .mjs，顶层 import "fs" 会被 esbuild 转成 require()
 * 并在 ESM 上下文中失败，故用动态 import()。
 */
const useClientPlugin = {
  name: "use-client-banner",
  async buildEnd({ writtenFiles }: { writtenFiles: { name: string }[] }) {
    const { readFileSync, writeFileSync } = await import("node:fs");

    for (const file of writtenFiles) {
      const normalized = file.name.replaceAll("\\", "/");
      if (!/\/index\.(mjs|cjs)$/.test(normalized)) continue;
      const content = readFileSync(file.name, "utf8");
      if (!content.startsWith('"use client"')) {
        writeFileSync(file.name, `"use client";\n${content}`);
      }
    }
  },
};

export default defineConfig({
  // styles 子入口只导出配方层（纯字符串常量，无 React）。刻意不并进 index：
  // design-system 用 `export * from "@vxture/design-ui"` 转发主入口，配方一旦
  // 进主入口就会连带成为伞包的公开面，产品侧就能拿它手搓控件——那正是配方层
  // 要杜绝的。走子入口，只有 DS 内部按路径引得到。
  entry: {
    index: "src/index.ts",
    server: "src/server.ts",
    styles: "src/styles/recipes.ts",
  },
  format: ["esm", "cjs"],
  outExtension({ format }) {
    return { js: format === "esm" ? ".mjs" : ".cjs" };
  },
  dts: true,
  clean: true,
  treeshake: true,
  sourcemap: true,
  external: ["react", "react-dom", "@phosphor-icons/react"],
  plugins: [useClientPlugin],
});
