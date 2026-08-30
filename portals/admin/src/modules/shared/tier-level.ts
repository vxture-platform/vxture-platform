/**
 * tier-level.ts —— 套餐等级 → 商业分档。
 *
 * @package @vxture/admin
 * @layer Presentation
 * @category Shared
 *
 * ── 为什么等级不走六档语气 ────────────────────────────────────────────────
 * 语气表达的是**严重度**（好 / 要留意 / 坏），等级表达的是别的东西。把 enterprise
 * 映射成 `danger` 或 `brand` 都不对：前者说它出事了，后者说它是新的。
 *
 * ── 为什么不是五级深浅阶梯（owner 2026-08-06 两次实测后定）────────────────
 * 第一版把五档挂在 DS 的 `--level-1..5` 上（brand-200 → brand-600 逐级加深），
 * 实测**文字看不清**——那条阶梯是给色块用的，中间几档底色压下来了、前景还是深字。
 * 且**五级深浅并没有对应五件事**。
 *
 * 第二版收成三档、直接用 `Badge` 的三个 variant，enterprise 拿到实心品牌底。
 * 实测**太亮眼**：一列里几枚实心蓝会把视线全吸过去，而 enterprise 并不是主力档。
 *
 * 定稿是**三档、全部描边、权重按业务而不是按"等级高低"排**：
 *
 * | 档                       | 是什么       | 表现                     |
 * | ------------------------ | ------------ | ------------------------ |
 * | free                     | 还没付费     | 描边 + 弱化文字，最轻    |
 * | starter / pro / business | 云端付费主力 | 描边 + 第二级品牌淡底    |
 * | enterprise               | 私有化，非主力 | 描边 + 第一级品牌淡底  |
 *
 * **主力档比 enterprise 重**，这是有意的：视觉重量给业务重心，不给价目表的顶端。
 *
 * 三档共用 `Badge variant="outline"` 拿描边，底色与文字色由 `TIER_CLASS` 叠加。
 *
 * ── 补齐 admin 缺的两档 ───────────────────────────────────────────────────
 * `@vxture-platform/shared` 的 `TIERS` 是**五档**（product_220 §1），admin 此前只认
 * free / pro / enterprise，starter 与 business 一起掉进 `other` 的灰（盘点 §十一
 * 记的缺色）。`Record<Tier, …>` 保证不再漏。
 */

import { TIERS, type Tier } from "@vxture-platform/shared";

/** 未付费：只把文字弱化，底色不给——它是这一列里最轻的一档。 */
const FREE_CLASS = "text-muted-foreground";

/**
 * 云端付费主力：第二级淡底 + **弱**品牌描边。
 *
 * 描边走 `primary-border-soft`（brand-200）而不是 `primary-border`（brand-600）：
 * 后者是给聚焦环、强调块用的"要被看见"的边，套在一枚安静的标上会比它承载的文字
 * 还重（owner 2026-08-06 实测）。
 */
const PAID_CLASS =
  "border-primary-border-soft bg-primary-muted-strong text-primary-text";

/**
 * 私有化：第一级淡底，且**连描边都退回中性细线**——比主力档再轻一级。
 *
 * 不给它品牌描边是有意的：enterprise 不是主力，它只需要"能认出来"，不需要在一列
 * 里跳出来。`Badge variant="outline"` 自带的 `border-border` 就是那条中性细线。
 */
const ENTERPRISE_CLASS = "bg-primary-muted text-primary-text";

/** 等级 → 叠加在 `Badge variant="outline"` 上的类名。判据见文件头。 */
export const TIER_CLASS: Record<Tier, string> = {
  free: FREE_CLASS,
  starter: PAID_CLASS,
  pro: PAID_CLASS,
  business: PAID_CLASS,
  enterprise: ENTERPRISE_CLASS,
};

/**
 * 把等级码归一到类名。
 *
 * **传 code 不要传 `tierName`**：BFF 的 `tierName` 是**已本地化的展示名**
 * （企业版 / 专业版 / 基础版 / 自定义），拿它去比 `TIERS` 的英文码永远不命中，
 * 结果是整列退成最轻的一档——2026-08-06 登录态走查抓到的就是这个，四行套餐标
 * 全是灰的。订阅记录为此补发了 `tierCode`。
 *
 * `custom` 不在 `TIERS` 里（它是谈出来的方案，不是价目表上的一档），但它**是付费
 * 客户**，按主力档给。认不出的才退回最轻档——不猜。
 */
export function tierBadgeClass(tierCode: string | null | undefined): string {
  if (!tierCode) return FREE_CLASS;
  const key = tierCode.trim().toLowerCase();
  if (key === "custom") return PAID_CLASS;
  const tier = TIERS.find((value) => value === key);
  return tier ? TIER_CLASS[tier] : FREE_CLASS;
}

/**
 * 筛选下拉的档位集：五档 + 「其他」。
 *
 * `其他` 保留，但含义变窄了——此前它兜的是 starter/business/自定义三类，现在只兜
 * **不在 `TIERS` 里的自定义套餐名**。starter 与 business 各自成档，可以单独筛。
 */
export const TIER_FILTER_OPTIONS = [
  { value: "free", label: "Free" },
  { value: "starter", label: "Starter" },
  { value: "pro", label: "Pro" },
  { value: "business", label: "Business" },
  { value: "enterprise", label: "Enterprise" },
  { value: "other", label: "其他" },
] as const;

export type TierFilterValue = (typeof TIER_FILTER_OPTIONS)[number]["value"];

/** Display label for a tier code ("pro" → "Pro"); unknown codes echo as-is. */
export function tierLabel(tierCode: string | null | undefined): string {
  const hit = TIER_FILTER_OPTIONS.find((o) => o.value === tierCode);
  return hit ? hit.label : (tierCode ?? "—");
}

/** 把展示用的套餐名归一到筛选档。认不出的落 `other`。 */
export function tierFilterOf(
  tierName: string | null | undefined,
): TierFilterValue {
  const key = (tierName ?? "").trim().toLowerCase();
  const tier = TIERS.find((value) => value === key);
  return tier ?? "other";
}
