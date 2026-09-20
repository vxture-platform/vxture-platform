/**
 * enum-labels.ts — 业务枚举 → 界面文案的**单一权威**（admin 侧）。
 *
 * ── 它要解决什么 ──
 * 2026-09-20 盘点：admin 里有 380 条硬编码的枚举中文文案，散在 29 个文件里，
 * 74 个「返回中文的映射函数」+ 14 个「值全是中文的映射表」。同名函数重复得很
 * 厉害——`cycleLabel` 5 份、`subscriptionStatusLabel` 4 份、`billStatusLabel`
 * 4 份、`paySourceLabel` 4 份。
 *
 * 这不是洁癖问题。四份 `subscriptionStatusLabel` 实测**互不相同**：
 *   · OrderDetailPage 那份**漏了 `expired` 分支**,落到默认分支显示「已取消」
 *     ——权益自然到期被说成客户主动退订,运营据此判断会错。
 *     （`status-tone.constants.ts` 的头注正好警告过同一类混淆:
 *       「admin did exactly that until 2026-08-07」。）
 *   · 另外三份对 `expired` 的译名也不一致:「已到期」×2 vs「已过期」×1。
 *
 * 收成一处之后,`satisfies Record<SubscriptionStatus, string>` 让 TypeScript
 * **强制穷尽**:shared 的值域加一个状态,这里不补就编译不过。漏分支这件事在
 * 类型层面不可能再发生。
 *
 * ── 边界：先有值域契约,再谈它的文案 ──
 * 这条规矩来自 `status-tone.constants.ts` 的头注,不是我新定的。所以本模块只收
 * **值域已经成文**的枚举:
 *
 *   已收  SubscriptionStatus   值域在 @vxture-platform/shared 的 catalog-domains
 *   未收  订单状态/账单状态/发票类型/税种/支付来源/对账态/工单状态…
 *         ——它们在 admin 里连类型都是就地写的,没有值域契约。补齐要先把值域
 *           立起来(那是比文案大得多的一件事),不该让展示层先于契约定义业务词汇。
 *
 * ── 为什么是 hook 而不是纯函数 ──
 * 文案要走 `t()`,而 `t` 只能在组件里拿。与 `useTableLabels()` 同形。
 *
 * ── 为什么每个键都写成字面量 ──
 * `t(\`subscriptionStatus.${status}\`)` 这种动态键更短,但 `lint:message-usage`
 * 扫不到它——键写错或词条被删,要等到界面上渲染出键路径才发现。字面量换来的是
 * 静态可检查。
 */

import { useTranslations } from "next-intl";
import type { SubscriptionStatus } from "@vxture-platform/shared";
import type { SubscriptionOperationCycle } from "@/entities/console";

/**
 * 订阅状态的界面文案。
 *
 * `satisfies` 而不是类型标注:保留字面量类型的同时,让缺键 / 多键都编译不过。
 */
export function useSubscriptionStatusLabels(): Record<
  SubscriptionStatus,
  string
> {
  const t = useTranslations("enums.subscriptionStatus");
  return {
    active: t("active"),
    expiring: t("expiring"),
    trialing: t("trialing"),
    overdue: t("overdue"),
    suspended: t("suspended"),
    // 权益已失效,与 cancelled(客户主动退订)是两件事——这一条正是 OrderDetailPage
    // 原来漏掉的那个分支。
    expired: t("expired"),
    cancelled: t("cancelled"),
  } satisfies Record<SubscriptionStatus, string>;
}

/**
 * 订单 / 订阅的计费周期。
 *
 * 收的是四份一模一样的 `cycleLabel`（OrderDetailPage / OrdersPage /
 * SubscriptionDetailPage / SubscriptionsPage），合并不改变任何输出。
 *
 * 原来每份都是 `if (yearly) … if (once) … return "月付"`——`monthly` 走的是
 * **默认分支**。改成穷尽的 Record 之后没有默认分支了:三个值各自显式,多一个
 * 值就编译不过。
 *
 * ── billing 那两份没收进来 ──
 * `BillingDetailPage` / `BillingPage` 也各有一个 `cycleLabel`,但它们的入参是
 * `bill.billCycle`,**那不是这个枚举**:`billing.invoices.bill_cycle` 的 DDL 注释
 * 写着「如 '202607'」,而 admin-bff 写入时算的正是 `startDate.slice(0,7)`——账期
 * 年月串。那两份函数的 yearly/monthly/once 三个分支在生产数据上从不命中,只有
 * 最后的 `return cycle || "未设置"` 有效。
 * （seed 却往同一列写 'monthly'/'yearly' 字面量,所以开发库看到的是「月度」、
 *  生产看到的是「202607」。这是那一列的语义问题,不是文案问题,已单独报 owner。）
 *
 * ── 这三个值本身是 BFF 压缩过的 ──
 * DB 侧 `metering.subscriptions.cycle_unit` 的值域是
 * `day/week/month/year/perpetual`（有 CHECK）,外加一个 `cycle_count` 倍数列。
 * admin-bff 的 `mapCycle()` 把它压成三值:month→monthly、year→yearly、
 * **其余一律 once**,并且完全不看 cycle_count。
 * 后果:按天 / 按周订阅会显示成「一次性」,季度（month×3）会显示成「月付」。
 * 那是 BFF 的模型问题,本模块只负责把三值翻成文案,修不了它——同样已报 owner。
 */
export function useSubscriptionCycleLabels(): Record<
  SubscriptionOperationCycle,
  string
> {
  const t = useTranslations("enums.subscriptionCycle");
  return {
    monthly: t("monthly"),
    yearly: t("yearly"),
    once: t("once"),
  } satisfies Record<SubscriptionOperationCycle, string>;
}
