import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * website 的单元测试（2026-09-08 起）。与 console 同口径：只覆盖不碰 React / Next
 * 的纯逻辑——内容注册表、法务文档加载、i18n 路由推导这一类。页面本身仍靠
 * tsc / eslint / 守卫 / owner 走查，不在这里装 jsdom。
 *
 * 这个门户此前**一个测试都没有**（139 个源文件，连 test 脚本都没配）。先立基座，
 * 再按「坏了不报错」的优先级往上铺，不追覆盖率数字。
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
