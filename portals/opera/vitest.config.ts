import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * opera 的单元测试。照 console 的同名文件立的约定:只覆盖 `src/lib/**` 一类不碰
 * React / Next 的纯逻辑，页面本身仍靠 tsc / eslint / 守卫 / owner 走查，**不在这里装
 * jsdom**。
 *
 * 第一批只有一个:目录页的游标栈（`vxture-platform#306`）。它原先写在组件里，于是
 * 唯一的验证方式是读代码——而其中一条不变式（reset 在第一页返回同一引用）肉眼看不出
 * 后果。**按这个约定，可测的东西要先搬出组件。**
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
