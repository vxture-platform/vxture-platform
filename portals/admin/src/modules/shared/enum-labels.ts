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
 *   已收  TicketStatus/TicketPriority  同上（2026-09-21 随工单详情页立的契约）
 *   未收  订单状态/账单状态/发票类型/税种/支付来源/对账态…
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
import type {
  BillStatus,
  PaySource,
  SubscriptionStatus,
  SuspensionReason,
  TicketPriority,
  MergeStrategy,
  ProductLayerValue,
  TicketStatus,
  UserKycStatus,
} from "@vxture-platform/shared";
import type {
  BillingBillType,
  OrderOperationStatus,
  ProductCapabilityStatus,
  ProductCapabilityType,
  SubscriptionOperationCycle,
  SubscriptionOperationQuotaRisk,
} from "@/entities/console";

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
 * 暂停原因的界面文案。
 *
 * 值域在 `@vxture-platform/shared` 的 catalog-domains（`SUSPENSION_REASONS`，与
 * `chk_subscription_suspensions_reason` 由 `lint:catalog-domains` 逐值对账），所以它
 * 满足本模块的收录边界：先有值域契约,再谈它的展示映射。
 *
 * **不在这里判「顺不顺延」**：那是政策，同一份派生表（`SUSPENSION_REASON_EXTENDS_TERM`）
 * 既被 admin-bff 用来写 `extends_term`、又被这一侧用来告诉运营他正要做什么。文案与政策
 * 分开放，是为了改译名不会碰到政策。
 */
export function useSuspensionReasonLabels(): Record<SuspensionReason, string> {
  const t = useTranslations("enums.suspensionReason");
  return {
    platform_ops: t("platform_ops"),
    dispute_review: t("dispute_review"),
    customer_violation: t("customer_violation"),
    other: t("other"),
  } satisfies Record<SuspensionReason, string>;
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

/**
 * 账单状态。
 *
 * 收的是五份 `billStatusLabel`（BillingDetailPage / BillingPage /
 * PromotionRedemptionsPage / InvoicesPage / PaymentsPage）。前四份完全一致,
 * `unpaid` 走默认分支;PaymentsPage 那份额外显式处理 `unpaid`,默认回「未关联」
 * ——**那不是同一件事**:支付记录可以没有关联账单,那时它拿到的是 null。
 * 所以「未关联」留在调用点,不进这张表:它描述的是「没有账单」,不是某个账单状态。
 *
 * 值域 2026-09-21 立进 shared 的 catalog-domains,与 `chk_invoices_bill_status`
 * 由 `lint:catalog-domains` 逐值对账。
 */
export function useBillStatusLabels(): Record<BillStatus, string> {
  const t = useTranslations("enums.billStatus");
  return {
    unpaid: t("unpaid"),
    paying: t("paying"),
    paid: t("paid"),
    partial: t("partial"),
    cancelled: t("cancelled"),
    overdue: t("overdue"),
  } satisfies Record<BillStatus, string>;
}

/**
 * 支付来源。
 *
 * 收的是四份 `paySourceLabel`,而它们**互不相同**——三份漏了 `voucher` 分支:
 *
 *   OrderDetailPage    online/offline/voucher → 线上/线下/券        默认「无」
 *   OrdersPage         online/offline         → 线上/线下           默认「无」  ← 券显示成「无」
 *   PaymentsPage       online/offline         → 线上/线下           默认「无」  ← 同上
 *   BillingDetailPage  offline/online         → 线下/线上           默认「未设置」← 券显示成「未设置」
 *
 * `voucher` 是券结算腿（product_321 P7,DDL 注释里写着),是一种**真实的**支付
 * 来源,不是「没有来源」。运营在支付记录页看到「无」会以为这笔没有来源。
 * 这与 subscriptionStatus 漏 `expired` 是同一类缺陷,只是影响面大三倍。
 *
 * 「没有来源」不在这个值域里:列是 NOT NULL 带默认值,没有支付就根本没有那一行。
 * 调用方持有可空引用时,自己渲染那个「无」。
 */
function usePaySourceLabels(): Record<PaySource, string> {
  const t = useTranslations("enums.paySource");
  return {
    online: t("online"),
    offline: t("offline"),
    voucher: t("voucher"),
  } satisfies Record<PaySource, string>;
}

/**
 * 取一条支付来源的文案,含「没有来源」那一档。
 *
 * 导出的是这个而不是上面那张表:admin 侧的 `OrderPaySource` 比值域多一个
 * `"none"`（BFF 把 `pay_source` 为 null 的行映射成它）。表只认值域内的三个值,
 * 于是九个调用点每处都要写一遍 `x === "none" ? … : labels[x]`——那个「无」就又
 * 散成九份了,而它原本就已经散成两种说法（「无」和「未设置」）。
 *
 * 「无」取共享词条 `common.none`,与全站同一个词。
 */
export function usePaySourceLabel(): (source: PaySource | "none") => string {
  const labels = usePaySourceLabels();
  const tCommon = useTranslations("common");
  return (source) => (source === "none" ? tCommon("none") : labels[source]);
}

/**
 * 账单类型。
 *
 * 收三份（BillingDetailPage / BillingPage / InvoicesPage），内容完全一致。
 *
 * 值域是 admin 侧的四值,不是 DB 的。`normalizeBillType()` 把 DDL 的
 * `normal/one_off/adjustment/prepaid_statement` 改名成 `normal/adjust/supplement/
 * prepaid`——**1:1 无损**,只是换了写法,所以照原样收口。那层改名本身是笔债
 * （凭空多一套值域要维护）,但不在文案收口的范围里。
 */
export function useBillTypeLabels(): Record<BillingBillType, string> {
  const t = useTranslations("enums.billType");
  return {
    normal: t("normal"),
    adjust: t("adjust"),
    supplement: t("supplement"),
    prepaid: t("prepaid"),
  } satisfies Record<BillingBillType, string>;
}

/**
 * 订单状态（**运营视图**,不是订单实体状态）。
 *
 * 收两份（OrderDetailPage / OrdersPage）,内容完全一致。
 *
 * 这个值域不对应任何 DB CHECK,所以**没有提升进 shared 的 catalog-domains**
 * （那份文件的定位是「DB CHECK / seed / 服务对齐的值域契约」）。它是
 * `mapEntityOrderStatus()` 用订单实体状态 + 账单状态**算出来**的运营视图:
 *   · DDL 的 cancelled/expired 合并成 `closed`（都是「未收过钱就关掉」）
 *   · `refunded` 自己一档（2026-09-25）——此前也并进 `closed`,于是一张**收过钱又退
 *     出去**的单与从没成立过的单长得一样,运营看不出钱动过
 *   · 账单 partial → `partial_pending`（未付与待复核两态都判,钱只在账单上）
 *   · `paid` 单独浮出成 `paid_unprovisioned`,刻意不并进 `confirmed`
 *     ——否则已收款未履约的悬挂单在运营视角「已完结」,永不被发现
 *
 * ⚠ `overdue` 与 `abnormal` 目前是**死值**:`mapEntityOrderStatus()` 只产出其余
 * 七个,全 BFF 搜不到写这两个值的地方。留着不删——类型里少一个分支,将来真有
 * 地方产出时会静默落到别处;留着则 `satisfies` 保证它有文案。
 */
export function useOrderStatusLabels(): Record<OrderOperationStatus, string> {
  const t = useTranslations("enums.orderStatus");
  return {
    pending: t("pending"),
    pending_verify: t("pending_verify"),
    confirmed: t("confirmed"),
    overdue: t("overdue"),
    closed: t("closed"),
    paid_unprovisioned: t("paid_unprovisioned"),
    partial_pending: t("partial_pending"),
    refunded: t("refunded"),
    abnormal: t("abnormal"),
  } satisfies Record<OrderOperationStatus, string>;
}

/** 配额风险三档。收两份（SubscriptionDetailPage / SubscriptionsPage），内容一致。 */
export function useQuotaRiskLabels(): Record<
  SubscriptionOperationQuotaRisk,
  string
> {
  const t = useTranslations("enums.quotaRisk");
  return {
    normal: t("normal"),
    warning: t("warning"),
    danger: t("danger"),
  } satisfies Record<SubscriptionOperationQuotaRisk, string>;
}

/**
 * 产品的上架状态。收两份（ProductsPage 的 `productStatusLabel` / 产品详情页的
 * `statusLabel`，逐值一致），以及产品列表筛选那三个写死中文的 `<option>`。
 *
 * 值域是 admin-bff 投影出来的四档（`mapProductCapabilityStatus`），不是库里的
 * `product.products.status` 五值（draft / developing / active / inactive /
 * deprecated，权威源在 `@vxture-platform/shared` 的 `PRODUCT_STATUSES`）：
 * inactive 与 deprecated 在 admin 这一侧都投成 `archived`。两轴不得合并——
 * 一份是运营改状态时能选的值（在 opera），一份是 admin 的读取面分组。
 *
 * `developing`（开发中）是 2026-09-24 才接上的一档：它在 DDL 里 2026-10-29 就
 * 存在，而 admin 两侧都把它折进 `archived`——**一个还没建的产品被说成已归档**。
 * 那次接线一并把这四条文案收到这里，`satisfies` 从此让漏分支编译不过。
 */
export function useCapabilityStatusLabels(): Record<
  ProductCapabilityStatus,
  string
> {
  const t = useTranslations("enums.capabilityStatus");
  return {
    active: t("active"),
    developing: t("developing"),
    draft: t("draft"),
    archived: t("archived"),
  } satisfies Record<ProductCapabilityStatus, string>;
}

/**
 * 能力类型。收两份（ProductCapabilityDetailPage / SubscriptionDetailPage），一致。
 *
 * 与 `@vxture/core-utils` 的 `PRODUCT_TYPES`（general_platform / industry_platform /
 * general_agent / industry_agent / undefined,自带 labelZh/labelEn）**不是同一个轴**:
 * 那个说「产品是什么」,这个说「能力属于哪一类」。别把两者合并。
 */
export function useCapabilityTypeLabels(): Record<
  ProductCapabilityType,
  string
> {
  const t = useTranslations("enums.capabilityType");
  return {
    platform: t("platform"),
    agent: t("agent"),
    model: t("model"),
    data: t("data"),
    service: t("service"),
  } satisfies Record<ProductCapabilityType, string>;
}

/**
 * 工单状态的界面文案——这是**存储的七值**（`chk_tickets_status`）。
 *
 * 工单列表说的是另一种话：admin-bff 把这七值投影成四档
 * （open / processing / blocked / closed）给队列视图用，那四个走
 * `ticketStatusLabel()`。两份不得合并：一份是写入面能选的值，一份是
 * 读取面的分组。写操作一律用这一份。
 */
export function useTicketStatusLabels(): Record<TicketStatus, string> {
  const t = useTranslations("enums.ticketStatus");
  return {
    open: t("open"),
    pending: t("pending"),
    in_progress: t("inProgress"),
    resolved: t("resolved"),
    closed: t("closed"),
    reopened: t("reopened"),
    cancelled: t("cancelled"),
  } satisfies Record<TicketStatus, string>;
}

/**
 * 配额合并策略。值域 `MERGE_STRATEGIES` 在 @shared 的 catalog-domains，
 * 对着 `chk_product_metrics_merge_strategy`。
 */
export function useMergeStrategyLabels(): Record<MergeStrategy, string> {
  const t = useTranslations("enums.mergeStrategy");
  return {
    max: t("max"),
    union: t("union"),
    pool: t("pool"),
    tiered: t("tiered"),
  } satisfies Record<MergeStrategy, string>;
}

/**
 * 产品分层。值域 `PRODUCT_LAYERS` 在 @shared（product_100_matrix §2）。
 * 文案带码（「L1 基础支撑」而不是「基础支撑」）：内部口头就说 L1/L2/L3，
 * 只留中文反而要在心里换一道——同工单优先级那条。
 */
export function useProductLayerLabels(): Record<ProductLayerValue, string> {
  const t = useTranslations("enums.productLayer");
  return {
    L1: t("L1"),
    L2: t("L2"),
    L3: t("L3"),
  } satisfies Record<ProductLayerValue, string>;
}

/**
 * 自然人实名认证。值域 `USER_KYC_STATUSES` 在 @shared 的 catalog-domains，
 * 对着 `chk_user_kycs_status`——先有值域契约，才有这份文案（规矩见本文件头注）。
 */
export function useUserKycStatusLabels(): Record<UserKycStatus, string> {
  const t = useTranslations("enums.userKycStatus");
  return {
    unverified: t("unverified"),
    pending: t("pending"),
    verified: t("verified"),
    rejected: t("rejected"),
  } satisfies Record<UserKycStatus, string>;
}

/**
 * 工单优先级。码与中文并列（「P0 紧急」而不是「紧急」）：运营口头与
 * 工单里都直接说 P0/P1，只留中文反而要在心里换一道。
 */
export function useTicketPriorityLabels(): Record<TicketPriority, string> {
  const t = useTranslations("enums.ticketPriority");
  return {
    p0: t("p0"),
    p1: t("p1"),
    p2: t("p2"),
    p3: t("p3"),
  } satisfies Record<TicketPriority, string>;
}
