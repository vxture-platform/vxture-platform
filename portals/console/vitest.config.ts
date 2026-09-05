import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * console 的单元测试(批 8 起)。只覆盖 `src/lib/**` 一类不碰 React / Next 的纯逻辑:
 * 主体码展示、计量格式化、收件箱展示与列表合并。页面本身仍靠 tsc / eslint / 守卫 /
 * owner 走查,不在这里装 jsdom。
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
