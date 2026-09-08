/**
 * 加油包的地址们 —— 板块 2026-09-08 从配额页迁到费用中心之后。
 *
 * ── 这一格为什么要测 ──
 * 搬板块时最容易漏的不是板块本身（编译器会喊），是**指向它的那些链接**：它们都是
 * 字符串，改漏一条，类型、构建、lint 全绿，只有点到才 404。
 *
 * ── 初稿是同义反复，记在这里 ──
 * 我第一版在测试文件里自己写了 `const PAY_PREFIX = "/billing/addon-pay/"`，再断言
 * 它不以 `/quotas` 开头——那测的是测试自己，把 app 里的地址改回去它照样全绿。
 * 真正的修法不是改断言，是**把地址收成一处**（addon-routes.ts），让三个调用点都
 * 引用它；测试断言那一处，就同时管住了三个调用点。
 */

import { describe, expect, it } from "vitest";
import {
  ADDON_SECTION_HREF,
  ADDON_SECTION_ID,
  buildAddonPayHref,
} from "./addon-routes";

describe("加油包板块的锚点", () => {
  it("入口跨页指向费用中心，不是配额页自己", () => {
    // 迁移前这里是同页 scrollIntoView，锚点不带路径。跨页之后必须带上 /billing，
    // 否则点了只会在配额页里找一个不存在的元素，什么都不发生——**静默失效**，
    // 比 404 还难发现。
    expect(ADDON_SECTION_HREF).toBe(`/billing#${ADDON_SECTION_ID}`);
  });

  it("锚点 id 本身不带 # —— 拼接由 href 那一侧负责", () => {
    // 带了会拼成 `/billing##quota-addons`，浏览器找不到这个 id。
    expect(ADDON_SECTION_ID).not.toContain("#");
  });
});

describe("支付页地址", () => {
  it("落在费用中心下", () => {
    expect(buildAddonPayHref("ORD123")).toBe("/billing/addon-pay/ORD123");
  });

  it("不再落在配额页下（旧地址只保留跳转，不是权威）", () => {
    expect(buildAddonPayHref("ORD123").startsWith("/quotas")).toBe(false);
  });

  it("订单号原样拼进去", () => {
    // 订单号是我们自己发的可视码（不是 UUID），字符集受控，不需要转义；
    // 这条钉住的是「别对它做多余处理」。
    expect(buildAddonPayHref("ADO-2026-0001")).toContain("ADO-2026-0001");
  });
});
