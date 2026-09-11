/**
 * launch-checklist.ts - 上架检查项里「由机器判定」的那几项的单一权威源
 *
 * @package @vxture/core-utils
 * @description
 *   `product.launch_checklist_items` 是一张可配置的目录表（新增检查项 = INSERT 一行）。
 *   其中有几项平台能自己实测出结论，其余要人来判断。**这个划分必须只有一份**：
 *   opera 的复验页据它决定写不写回，opera-bff 据它决定收不收人工勾选。两边各写一份
 *   就会漂，而漂的症状是「机器判失败、人手动勾上、闸门放行」——三方都觉得自己没错。
 *
 * ── 判据：一项检查只有在它的**全部内容**都被实测覆盖时，才算机器判定 ──
 *
 * 这条判据挡掉了两个看起来也能自动的项：
 *
 *   `c1_identity`  它的定义里有一半是**对方的事**（RP 的登录/回调/会话实现）。
 *                  平台只测得到「我方注册了 OIDC 客户端且配了回调」，自动打勾
 *                  等于替对方声明完成。
 *   `acceptance`   端到端验收。两个上游授权检查（atlas / runos）能测，但把它们
 *                  的结论塞进这一项，等于把「端到端跑通了」替换成「授权配了」
 *                  ——后者弱得多，而勾上之后没人分得清当时勾的是哪个意思。
 *
 * ── 为什么不在 DDL 里加一列 ──
 *   只有这两个消费方，都在 TS 里。加一列就是第三份事实，还得配一条守卫去比对它
 *   和这里是否一致——为一个两处消费的常量引入一次迁移与一条守卫，不划算。
 *   若将来有 SQL 侧的消费方（报表、DB 约束），再加列并把这里作为镜像。
 */

/**
 * 由平台实测判定的检查项。人工不得勾选/取消这几项——它们的值由复验写入。
 *
 * 与 `portals/opera/src/features/product/launch-checks.ts` 里带 `itemCode` 的检查
 * 一一对应；那边负责**怎么测**，这里负责**哪几项算机器说了算**。
 */
export const AUTO_DETERMINED_CHECKLIST_ITEMS = [
  /** 产品行在目录里、产品码/类型齐备。纯读平台自己的表。 */
  "catalog_registered",
  /** 对方真的拉过权益——`GET /platform/entitlements` 在平台侧留下的「最近一次」键。 */
  "c2_entitlement",
  /** 对方真的报过用量——`POST /usage/consume` 在平台侧留下的最近事件。 */
  "c3_metering",
] as const;

export type AutoDeterminedChecklistItem =
  (typeof AUTO_DETERMINED_CHECKLIST_ITEMS)[number];

/** 这一项是不是机器说了算。 */
export function isAutoDeterminedChecklistItem(itemCode: string): boolean {
  return (AUTO_DETERMINED_CHECKLIST_ITEMS as readonly string[]).includes(
    itemCode,
  );
}
