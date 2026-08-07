/**
 * status-tone.constants.ts — 业务状态 → 语气档 的**展示映射**（跨门户共用）。
 *
 * ── 为什么不在 DS ──────────────────────────────────────────────────────────
 * DS 零业务语义是硬规矩：组件不认识"订阅过期"或"企业版"，`tone.ts` 拒收业务状态
 * 是先例。所以"某个业务状态该显什么颜色"这件事，DS 不能知道。
 *
 * ── 为什么不在 catalog-domains.constants.ts ───────────────────────────────
 * 那份文件自己写明「Pure value sets + types. ZERO business logic」——它是值域契约，
 * DB CHECK / seed / 服务都按它对齐。映射是展示逻辑，塞进去会破坏它的定位。放在
 * 同级独立模块，取值仍**引用**那份契约，两边不会分叉。
 *
 * ── 为什么在 shared 而不是各门户各写一份 ──────────────────────────────────
 * admin 现在有 244 个 pill 选择器把这套映射写死在 CSS 里（`--tier`/`--bill`/
 * `--payment`…），console 要展示同样的状态时只能再抄一遍。抄出来的那份不会跟着改。
 *
 * ── 边界：只映射 shared 已经拥有值域的状态 ────────────────────────────────
 * 下面每一族都对应 catalog-domains 里的一个值集。admin 还有一批状态（发票税种、
 * 对账态、工单分级…）尚无共享值域——**先有值域契约，再谈它的展示映射**，否则等于
 * 让展示层先于契约定义业务词汇。那些暂时留在 admin 侧。
 */

import type {
  SubscriptionStatus,
  Tier,
  PlanVersionStatus,
} from "./catalog-domains.constants";

/**
 * 语气档。与 DS 的 `Tone` 同名同值——刻意不 import DS：shared 是后端也在用的
 * 契约包，不该为了一个字符串联合把 UI 包拖进依赖图。两边任一处增删档位，
 * TypeScript 会在门户的赋值处报错，不会静默分叉。
 */
export type StatusTone =
  | "brand"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "neutral";

/**
 * 订阅状态。
 *
 * `overdue` 取 warning 而非 danger：它是欠费宽限期，**权益仍在**（与 expired
 * 的权益已失效相对）——用 danger 会让运营以为服务已经停了。
 * `trialing` 取 info 而非 success：试用是一种"进行中"，不是达成态。
 */
export const SUBSCRIPTION_STATUS_TONE: Record<SubscriptionStatus, StatusTone> =
  {
    active: "success",
    // 权益仍在、只是快到期——值得留意但没出事，落 warning 不落 danger。
    expiring: "warning",
    trialing: "info",
    overdue: "warning",
    suspended: "warning",
    expired: "neutral",
    cancelled: "neutral",
  };

/**
 * 商业档位。
 *
 * 只有 `free` 是中性，其余递进——但**不用颜色表达高低**（那需要一个连续色阶，
 * 而语气档是离散的）。付费档统一 brand，企业版单独 info 以示区隔。
 */
export const TIER_TONE: Record<Tier, StatusTone> = {
  free: "neutral",
  starter: "brand",
  pro: "brand",
  business: "brand",
  enterprise: "info",
};

/** 套餐版本发布生命周期。draft 是工作副本，不该有"正常"的绿色。 */
export const PLAN_VERSION_STATUS_TONE: Record<PlanVersionStatus, StatusTone> = {
  draft: "neutral",
  published: "success",
};

/**
 * 取语气档，未知值回落 `neutral`。
 *
 * 后端新增了枚举值而前端还没跟上时，这里回落成中性徽章而不是抛错或渲染空白——
 * 一个没有颜色的徽章仍然读得出文字，而崩掉的页面什么也读不出。
 */
export function resolveStatusTone<K extends string>(
  map: Record<K, StatusTone>,
  value: string | null | undefined,
): StatusTone {
  if (!value) return "neutral";
  return (map as Record<string, StatusTone>)[value] ?? "neutral";
}
