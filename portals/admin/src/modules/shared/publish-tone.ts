/**
 * publish-tone.ts —— 产品域「发布态 / 可见性 / 类目」的展示映射。
 *
 * @package @vxture/admin
 * @layer Presentation
 * @category Shared
 *
 * ── 为什么单起一个文件 ────────────────────────────────────────────────────
 * `status-tone.ts` 收的是**商业交易**那一串值域（订单/账单/发票/对账/订阅）。
 * 产品域是另一条线：能力、方案、服务套餐、套餐版本四类对象共用同一组发布态与
 * 可见性，跟交易没有关系。
 *
 * ── 为什么四个族合成一张表 ────────────────────────────────────────────────
 * 迁移前它们是四个 CSS 前缀：`vx-product-pill--*`、`vx-product-solution-pill--*`、
 * `vx-service-plan-pill--*`、`vx-product-plan-pill--*`。逐档比对之后发现色值
 * **一字不差**——active 全绿、draft 全黄、archived 全灰、public 全绿、internal
 * 全灰。四个前缀装的是同一张表，分开写不是在区分什么，是抄了四遍
 * （owner 2026-08-06 判：合）。
 *
 * ── 两处原设计的不一致，在这里收敛 ────────────────────────────────────────
 * 1. **「不公开」有两个词两个色**：套餐版本用 `private` 标黄，方案与服务套餐用
 *    `internal` 标灰。同一件事说两个词、给两种语气。统一到 `internal`/灰——
 *    不对外可见是一种归属，不是一个需要留意的信号。
 * 2. **类目色里有一个红**：产品类型原先是 platform=蓝 / model=紫 / agent=青 /
 *    data=绿 / service=**红** / self=灰 / partner=黄。「服务类产品」的红会和
 *    「订单逾期」的红在同一屏里抢读，绿同理。**类目一律 `neutral`**：并列的
 *    类目没有严重度，靠文字与图标区分（判据见 `status-tone.ts` 的六档对应表）。
 */

import type { StatusTone } from "@vxture/shared";
import type {
  ProductCapabilityIntegrationStatus,
  ProductCapabilityStatus,
} from "@/entities/console";

/**
 * 发布态。四类对象共用：产品能力、业务方案、服务套餐、套餐版本。
 *
 * `draft` 是工作副本，不该有"正常"的绿；`archived` 是已退场，不是出了事。
 */
export const PUBLISH_STATUS_TONE: Record<ProductCapabilityStatus, StatusTone> =
  {
    active: "success",
    draft: "warning",
    archived: "neutral",
  };

/** 套餐版本的启用态，值域比发布态短一档。 */
export const PLAN_ACTIVE_TONE = {
  active: "success",
  inactive: "neutral",
} as const satisfies Record<string, StatusTone>;

/**
 * 可见性。对外可见是达成的一步（success），不对外只是归属（neutral）。
 *
 * `private` 是 `internal` 的旧名，保留为同义档以免调用点各写各的。
 */
export const VISIBILITY_TONE = {
  public: "success",
  internal: "neutral",
  private: "neutral",
} as const satisfies Record<string, StatusTone>;

/**
 * 产品能力的接入态。
 *
 * 值域只有四个，CSS 却定义了八档——`ready` / `draft` / `partner_config` /
 * `policy_missing` 四条早已没有对应值，是更早一版值域的残留，一并退役。
 *
 * 两处按六档对应表纠正：`testing`（测试中）是流程在走，落 `info` 不落 `warning`；
 * `not_required`（无需接入）是不适用，落 `neutral` 不落 `success`——它不是一项达成。
 */
export const ACCESS_STATUS_TONE: Record<
  ProductCapabilityIntegrationStatus,
  StatusTone
> = {
  connected: "success",
  testing: "info",
  config_required: "danger",
  not_required: "neutral",
};

/**
 * ~~categoryTone~~ 已删。类目标改用朴素 `Badge`，不再经语气档。
 *
 * 走 `StatusBadge tone="neutral"` 那一版在登录态实测下露馅（2026-08-06）：
 * `StatusBadge` 会按语气自动配图标，`neutral` 配的是 ⓘ，于是产品列表里每个
 * 「服务」「自建」「数据」前面都顶着一个信息图标——那个图标不表达任何东西，
 * 只是语气档的默认值漏了出来。**类目本来就不是状态**，`Badge` 的描边中性标
 * 才是它该有的样子。
 */
