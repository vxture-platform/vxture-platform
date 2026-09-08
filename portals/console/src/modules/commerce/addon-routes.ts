/**
 * addon-routes.ts — 加油包相关地址的唯一权威。
 * @package @vxture/console
 * @layer Application
 *
 * ── 为什么单独一个模块 ──
 * 这些地址有多个调用点：加油包板块自己（下单后跳支付页）、派生待办（「去支付」的
 * 链接）、配额页（「去加购」的入口）。各处写字面量意味着搬家时可以只改一处而编译器
 * 不会有任何意见——漏掉的那处要点到才 404。
 *
 * 放在**叶子模块**而不是塞进 AddonPacksSection.tsx：后者是 `"use client"` 的重组件
 * （DataTable、ActionMenu 一整串），而 useDerivedTodos 被外壳到处用；从它反向导入
 * 组件模块会把整棵组件树拖进外壳的模块图。这里没有任何 React 依赖。
 *
 * ── 2026-09-08 的搬家 ──
 * 加油包板块从配额页迁到费用中心（owner 板块梳理）：加油包是一次性购买，与订阅、
 * 订单、账单、发票同属「钱」这条线；配额页答的是「用了多少、还剩多少」。
 * 旧支付页地址保留跳转——在途订单会撞上它。
 */

/** 加油包板块在费用中心页内的锚点 id。 */
export const ADDON_SECTION_ID = "quota-addons";

/** 配额页「去加购」的落点：跨页直达费用中心的加油包板块。 */
export const ADDON_SECTION_HREF = `/billing#${ADDON_SECTION_ID}`;

/** 加油包订单的支付页地址。 */
export function buildAddonPayHref(orderNo: string): string {
  return `/billing/addon-pay/${orderNo}`;
}
