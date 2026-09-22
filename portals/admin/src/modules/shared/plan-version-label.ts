/**
 * plan-version-label.ts —— 套餐版本的展示口径 `V1.20260922`。
 * @package  @vxture/admin
 * @layer    Application
 * @category shared
 *
 * ── 三个号各管一段，别混 ──
 *   version_no    内部身份：唯一键 `(plan_id, version_no)`、排序、以及详情路由
 *                 `/plan-versions/<产品>/<套餐码>/<版本号>/edit` 全都拄它。
 *                 它还是 98 列锁的锚点列，本就不可改写——所以**不能把它换成日期**。
 *   major_no      主版本号 V1/V2…：**人设定的商业代际**，不自增。价格或档位结构变了
 *                 才升；只改配额这类小改沿用当前主版本，于是同一 V1 下可以有多个
 *                 日期修订（owner 2026-09-22）。它也是锚点列（`_no` 后缀），只在
 *                 开草稿时一次写入，之后不改。
 *   published_at  发布（启用）那一刻：自动写入，是事实不是设定项。运营问的
 *                 「什么时间启用」只有它能答——`created_at` 是草稿何时开的。
 *
 * ── 读不到就说读不到 ──
 * 本列上线前就已发布的版本没有发布时刻可考（既不在表里，也不在审计里——发布动作
 * 此前压根不留痕）。这时只画 `V1`，**不拿 `created_at` 冒充**：那是另一个时刻，
 * 填进去就是给一个看起来很确定的错答案。
 *
 * ── 日期一律走共享格式化件 ──
 * 不手搓 `getFullYear()` + `padStart` 拼串（`lint:datetime-discipline` §1c 会拦，
 * 而它拦得对：手搓的那种必然在时区与补零上各错一次）。紧凑段用 `formatDay` 配
 * **固定的 en-CA**（ISO 序，与调用方 locale 无关）再抽数字；成列显示的启用日期走
 * 页面 locale，与全站其它日期同一口径（admin 不钉时区，跟浏览器本地）。
 *
 * @author AI-Generated
 * @date 2026-09-22
 */

import { formatDay } from "@vxture-platform/shared";

export interface PlanVersionIdentity {
  majorNo: number;
  publishedAt: string | null;
  status?: string;
}

/** 主版本号段：读不到按 V1 算（库里是 NOT NULL DEFAULT 1，回落不会造出假代际）。 */
function majorSegment(majorNo: number): string {
  return `V${Number.isFinite(majorNo) && majorNo >= 1 ? majorNo : 1}`;
}

/**
 * 版本标签。
 *
 * 已发布且有发布时刻 → `V1.20260922`
 * 已发布但时刻不可考 → `V1`（该列上线之前发布的）
 * 草稿               → `V1`（草稿还没启用，日期段无从谈起；调用方另配草稿徽标）
 */
export function planVersionLabel(v: PlanVersionIdentity): string {
  const major = majorSegment(v.majorNo);
  if (!v.publishedAt) return major;
  /* en-CA 固定给 ISO 序（2026-09-22），抽出数字即 20260922。写死这个 locale 是
     故意的：这一段是**标识符**不是给人读的日期，不该随调用方 locale 变形。 */
  const digits = formatDay(v.publishedAt, "en-CA", "").replace(/\D/g, "");
  return digits.length === 8 ? `${major}.${digits}` : major;
}

/**
 * 启用日期，给单独成列/成行的场合用（如版本表的「启用时间」）。
 * 读不到回 `—`——全站通例：读不到显示「—」，不显示 0、不退回别的时刻。
 */
export function planVersionEffectiveDate(
  v: Pick<PlanVersionIdentity, "publishedAt">,
  locale?: string,
): string {
  return v.publishedAt ? formatDay(v.publishedAt, locale, "—") : "—";
}
