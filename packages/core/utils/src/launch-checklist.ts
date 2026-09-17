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
 * 判据没变，变的是平台看得见的东西。2026-09-17 起**全部检查项都是机器判定**，
 * 这张表与检查单等长——所以它现在的作用从「哪几项算机器说了算」变成了
 * 「**新增检查项时，先证明你能测它**」。加一项而它进不了这张表，说明那一项要么
 * 定义里有一半在对方那边，要么根本没有判据——两种都不该先进检查单。
 *
 * ── 三项曾被判为「测不到」，后来都被推翻了，理由各不相同 ──
 *
 *   `c1_s2s`       2026-10-01 转自动。判据是换票审计——**换票发生在平台上**，
 *                  平台是签发方，看得见这件事的全部。
 *
 *   `c1_identity`  2026-09-17 转自动。旧论证是「它的定义有一半是对方的 RP 实现，
 *                  平台只测得到我方注册了客户端」。那个论证的漏洞在于**找错了判据**：
 *                  平台确实测不到「对方写没写回调处理」，但测得到**有人真的用平台
 *                  账号登进了这个产品**——每一次成功的 OIDC 登录都往
 *                  `session.refresh_tokens` 落一行、带 `client_id`。
 *                  那一行的存在**蕴含**了 RP 实现完成:登录流程没接通，它不会出现。
 *                  这不是「观测到一个数就当它通过」，是那个数与被测的事互为充要。
 *
 *   `acceptance`   2026-09-17 转自动。旧论证是「拿两个上游授权检查的结论塞进这一项，
 *                  等于把『端到端跑通了』换成『授权配了』」——那个论证仍然成立，
 *                  变的是**五段台账现在齐了**:登录（v0.26.200 接入）、开通、权益、
 *                  用量、回调投递，外加 2026-09-17 补的开通回执。
 *                  判据不是「五件事各自发生过」，是**五段落在同一个工作区**——
 *                  那正是这一项定义里的「整条链实际跑通过一次」。
 *
 * ── 退役的那一项 ──
 *   `data_plane`   2026-10-09 退役，不在本表也不在检查单里。它要求产品**自己库里**
 *                  的 schema 布局，而那份模板平台登记为「非平台标准、不是平台义务」，
 *                  opera 却又注解成「平台按模板 provision」——同一项三处定义矛盾。
 *                  见 `migrations/2026-10-09-checklist-data-plane-retire.sql`。
 *
 * ── 为什么不在 DDL 里加一列 ──
 *   只有这两个消费方，都在 TS 里。加一列就是第三份事实，还得配一条守卫去比对它
 *   和这里是否一致——为一个两处消费的常量引入一次迁移与一条守卫，不划算。
 *   若将来有 SQL 侧的消费方（报表、DB 约束），再加列并把这里作为镜像。
 */

/**
 * 由平台实测判定的检查项。**人工不得勾选/取消**——它们的值由复验写入
 * （opera-bff 的 `PATCH /products/:id/checklist/:itemCode` 对这几项回
 * `CATALOG_CHECKLIST_ITEM_AUTO_DETERMINED`）。
 *
 * 与 `portals/opera/src/features/product/launch-checks.ts` 里带 `itemCode` 的检查
 * 一一对应；那边负责**怎么测**，这里负责**哪几项算机器说了算**。
 *
 * 判据取不到时没有人工兜底这条路——那是有意的，也是有代价的：一项自动检查若因为
 * 上游读取失败而红着，运营者只能走「带理由跳过」（`launch_override_*`，v0.26.202），
 * 那条路会留痕并在产品页常驻提示。**不要为了绕开一次读取失败把某项改回人工**，
 * 那等于把一条有判据的检查换成一个没有判据的勾。
 */
export const AUTO_DETERMINED_CHECKLIST_ITEMS = [
  /** 产品行在目录里、产品码/类型齐备。纯读平台自己的表。 */
  "catalog_registered",
  /**
   * 有人真的用平台账号登进了这个产品——`session.refresh_tokens` 里带该产品客户端
   * `client_id` 的最近一行。登录流程没接通就不会有这一行，所以它蕴含 RP 实现完成。
   */
  "c1_identity",
  /** 对方真的拉过权益——`GET /platform/entitlements` 在平台侧留下的「最近一次」键。 */
  "c2_entitlement",
  /** 对方真的报过用量——`POST /usage/consume` 在平台侧留下的最近事件。 */
  "c3_metering",
  /**
   * 对方真的换过票去调基础设施——`POST /oidc/token` 的 token-exchange 在
   * `support.audit_logs` 留下的最近一条（`after.caller_product` = 本产品）。
   */
  "c1_s2s",
  /**
   * 端到端链路跑通过一次——登录 → 开通 → 权益 → 用量 → 回调投递五段都有台账，
   * **且落在同一个工作区**。同工作区是这一项的要害：五件事各自发生过，
   * 不等于一条链走通了。
   */
  "acceptance",
] as const;

export type AutoDeterminedChecklistItem =
  (typeof AUTO_DETERMINED_CHECKLIST_ITEMS)[number];

/** 这一项是不是机器说了算。 */
export function isAutoDeterminedChecklistItem(itemCode: string): boolean {
  return (AUTO_DETERMINED_CHECKLIST_ITEMS as readonly string[]).includes(
    itemCode,
  );
}
