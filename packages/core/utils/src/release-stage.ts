/**
 * release-stage.ts - 产品**承诺等级**(release_stage)的单一权威源
 *
 * @package @vxture/core-utils
 * @description
 *   `product.products.release_stage` 回答的是**「买了之后平台承诺什么」**，与另外几根轴正交：
 *     - `status`(draft/developing/active/inactive/deprecated) = 接入状态，见下。
 *     - `is_customer_visible` / `is_workforce_visible` = 可见域（按受众切，不按门户切）。
 *     - 售卖态(待发售/开售中/已停售) = **派生**，不落列：有没有在售的公开套餐，一句 SQL 就有答案。
 *     - `product_type` / `origin` / `layer` = 类型 / 来源 / 层级。
 *
 *   ── 2026-10-29：从「成熟度」改写成「承诺等级」，四档 ──
 *
 *   旧值域是 `ga` / `beta` / `developing`。GA = General Availability，是标准的**工程发布**
 *   术语（alpha → beta → RC → GA → EOL）。它准确，但它回答的是「代码走到第几个里程碑」；
 *   客户在应用中心看徽标，想知道的是「我买了之后你承诺什么」——那是另一件事。
 *
 *     preview 预览版  功能仍在快速演进，接口可能变更，不承诺 SLA
 *     beta    公测版  功能成形，接口不再破坏性变更，SLA 尽力而为
 *     stable  正式版  完整 SLA，任何变更有通知期
 *     sunset  停售中  已购客户的服务与续订不受影响，**不再接受新订阅**   ← 新增
 *
 *   **缺的是尾巴不是头。** 头部不缺：产品还没开售时，「敬请期待 / 即将开放」由售卖态
 *   回答，不需要这根轴再说一遍——旧的 `developing` 承担的正是那份重复职责，于是它一边
 *   和 `status='draft'` 的显示名撞车、一边兼任「不可订」的判据，两件事都不该归它。
 *   尾部是真缺：产品要退役时，「老客户继续用」和「新客户不能买」是两件事，在 `sunset`
 *   之前只能一刀切停用、所有人一起断。
 *
 *   码也改（`ga → stable` / `developing → preview`）而不是只改中文显示名：`ga` 是缩写，
 *   库里存着看不出含义；只改显示名会让库里存 `ga` 而屏幕上写别的，读库的人要自己在脑子里
 *   做一次映射——这类映射攒够三处就开始出错。DDL 侧见
 *   `migrations/2026-10-29-product-lifecycle-domains.sql`（含全量重放的处置）。
 *
 *   ── `subscribable` 这一档现在是过渡态，不要照着它推语义 ──
 *
 *   `preview.subscribable = false` **是改名前 `developing` 的逐字延续**，不是「预览版不能卖」
 *   这个判断——按设计，预览版是**已开售但仍在演进**。留成 false 只为了让这一批是纯改名：
 *   可订性判据换成「存在在售的公开套餐」是后续批次的事，提前在这里放开会在两批之间开一个
 *   窗口，让开发中的产品可被下单。
 *
 *   同理 `sunset.subscribable = false` 此刻是惰性的（还没有产品会是 sunset）。它真正该有的
 *   行为是**按 intent 分**：`new`/`upgrade` 拦、`renew` 放行。少了续订那一半，就会重犯
 *   `plans.is_public` 当年的错——那条判据的注释自己写着：「把一个在售档改成邀请制就会连带
 *   掐断老客户的续订，界面上只是 409，而客户什么都没做错」。
 *
 *   ── 这两个谓词谁在执行 ──
 *   - `isForwardReleaseStageMove` → admin-bff `PATCH capabilities/:code/content`，事务内、
 *     写之前判；倒退回 409。
 *   - `isReleaseStageSubscribable` → console-bff `POST /api/subscription/orders`，拒
 *     `PRODUCT_NOT_RELEASED`。**上述过渡态说的就是这一处**。
 *
 *   口径成文在 `docs/20-specs/000-platform/opera/40-product-registry.md`。
 */

/** 受管的 release_stage 全集。顺序 = 承诺链的前进方向。 */
export const RELEASE_STAGES = ["preview", "beta", "stable", "sunset"] as const;

export type ReleaseStage = (typeof RELEASE_STAGES)[number];

export interface ReleaseStageDef {
  readonly value: ReleaseStage;
  readonly labelZh: string;
  readonly labelEn: string;
  /**
   * 该档位能否自助订阅。
   *
   * **过渡态**，见文件头注：`preview` 的 false 是改名前 `developing` 的逐字延续，
   * `sunset` 的 false 还缺「续订放行」那一半。判据换成「存在在售的公开套餐」之后，
   * 这个字段连同 `isReleaseStageSubscribable` 一起退役。
   */
  readonly subscribable: boolean;
}

/** 值 → 展示定义。顺序即下拉/呈现顺序（承诺由浅到深，最后是停售）。 */
export const RELEASE_STAGE_DEFS: readonly ReleaseStageDef[] = [
  {
    value: "preview",
    labelZh: "预览版",
    labelEn: "Preview",
    subscribable: false,
  },
  { value: "beta", labelZh: "公测版", labelEn: "Beta", subscribable: true },
  { value: "stable", labelZh: "正式版", labelEn: "Stable", subscribable: true },
  {
    value: "sunset",
    labelZh: "停售中",
    labelEn: "Sunset",
    subscribable: false,
  },
] as const;

/** 写入校验:是否受管枚举内的合法值。 */
export function isValidReleaseStage(value: string): value is ReleaseStage {
  return (RELEASE_STAGES as readonly string[]).includes(value);
}

/** 取展示标签(缺省 zh)。未登记值退回原字符串。 */
export function releaseStageLabel(
  value: string,
  locale: "zh" | "en" = "zh",
): string {
  const def = RELEASE_STAGE_DEFS.find((d) => d.value === value);
  if (!def) return value;
  return locale === "en" ? def.labelEn : def.labelZh;
}

/** 该档位能否订阅(未登记值按不可订处理,保守)。 */
export function isReleaseStageSubscribable(value: string): boolean {
  return (
    RELEASE_STAGE_DEFS.find((d) => d.value === value)?.subscribable ?? false
  );
}

/**
 * 承诺等级只向前走：`preview → beta → stable → sunset`，允许跨级。
 *
 * 倒退（比如 `stable → preview`）不是一个合法的产品事实：它会让官网当场把一个已发布
 * 产品的订阅入口换成「敬请期待」。要把产品从客户面前收回去，该动的是可见域（上不上站）
 * 或 `status`（接入状态）——几根轴各管一件事。
 *
 * **`sunset` 是终点但不是终态**：它在链条末尾，`isForwardReleaseStageMove` 因此不放行
 * `sunset → stable`。而「决定继续卖」是个真实的业务动作，需要一条显式的回边——那条边
 * 由调用方（admin 的停售/恢复动作）另行放行并留审计，不从这里开口子：这个函数守的是
 * 「承诺不能无声地降级」，回到在售是一次有主体、该留痕的决定，不是一次表单保存。
 *
 * 同态（from === to）返回 `true`：反复保存同一张表单不该报错。未登记值一律 `false`（保守）。
 */
export function isForwardReleaseStageMove(from: string, to: string): boolean {
  if (from === to) return true;
  const order: readonly string[] = RELEASE_STAGES;
  const i = order.indexOf(from);
  const j = order.indexOf(to);
  if (i < 0 || j < 0) return false;
  return j > i;
}
