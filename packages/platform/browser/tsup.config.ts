/**
 * tsup.config.ts — @vxture/platform-browser 的打包配置。
 *
 * 这个文件此前不存在，而 `package.json` 里一直写着 `build: rimraf dist && tsup`——
 * 没有配置也没有 CLI 入参，tsup 只会说一句 `No input files` 然后失败。
 *
 * 它从没被发现，是因为 `Dockerfile.nextjs` 里预构建工作区依赖的那一步选择器方向写反、
 * 一直匹配空集（见该文件注释），本包从来没被构建过；而三个消费方门户
 * （website / console / admin）都在 `next.config.js` 里把它 alias 到 `src`，
 * 走源码消费，也不需要 dist。
 *
 * 修好那一步之后本包第一次真的被构建，于是当场失败。补上配置而不是删掉 build 脚本：
 * `package.json` 的 `main` / `types` 指向 `dist/`，删脚本会让那两行继续说假话——
 * **一个指向不存在产物的入口声明，是留给下一个人的陷阱。**
 *
 * 与 `@vxture/core-locale` 同形，唯一差别是本包的 `main` 用 `.js`（见下方 outExtension）。
 */
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  /* `package.json` 的 `main` 写的是 `dist/index.js`，所以 CJS 产物必须落成 `.js`
     而不是兄弟包用的 `.cjs`——否则 build 成功了，按 `main` 解析仍然找不到文件，
     又是一次「绿着的失败」。 */
  outExtension({ format }) {
    return { js: format === "esm" ? ".mjs" : ".js" };
  },
  dts: true,
  sourcemap: true,
  // clean 由 package.json 的 build 脚本显式 rimraf，避免 watch 模式触发循环
  target: "es2023",
  keepNames: true,
  treeshake: true,
});
