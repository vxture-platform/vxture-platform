/**
 * pricing-model.ts — /pricing 页面数据适配层
 * @package @vxture/website
 * @layer Presentation
 * @category Marketing / Pricing
 *
 * 页面所需的完整定价模型在这里收口。2026-08-30 起取数来源是
 * `GET /api/products/:code/plans`（website-bff；product.plans / plan_versions /
 * plan_prices / plan_components 真源），此前写死在 i18n 里的价目表已删——官网
 * 上线后不能再有一份与数据库平行的价格。
 *
 * 这里只做形状适配与展示推导，**不造数据**：
 * - 价格：只认 cycle_count=1 的整周期价（与 console SubscribePage 的
 *   priceForCycle 同口径）；月/年各自独立，缺哪个就是哪个不可售；两个都没有
 *   = 联系销售；
 * - 对比表：行 = 阶梯里实际出现的配额键 ∪ 功能键，值按类型推导（-1 = 不限、
 *   0/false = 不含、*.bytes 键按容量格式化）。以前 i18n 表里没有数据支撑的行
 *   （私有化部署、专属支持与 SLA）和「最受欢迎」标记一律不再出现。
 *
 * 受众映射（tier → 个人/团队/私有化）是业务规则，属于代码而非文案，
 * 因此固定在本文件，不进 i18n。
 */

import { formatCurrency, type Locale } from "@vxture-platform/shared";
import type {
  ProductPlanOption,
  ProductPlanPrice,
  ProductPlansResponse,
} from "@/api/product-plans.api";

// ============================================================================
// Types
// ============================================================================

export type PlanAudience = "person" | "team" | "private";

/** 页面切换用的展示值域 */
export type BillingCycle = "monthly" | "yearly";

/** wire 值域：plan_prices.cycle_unit 与 console 深链 cycle 参数 */
export type CycleUnit = "month" | "year";

export interface PlanPrice {
  amount: number;
  currency: string;
}

export interface PricingPlan {
  tier: string;
  planCode: string;
  /** product.plans.plan_name */
  name: string;
  /** product.plans.description，可空 */
  description: string | null;
  /** 月付整周期价；null = 该档不按月售 */
  monthly: PlanPrice | null;
  /** 年付整周期价；null = 该档不按年售 */
  yearly: PlanPrice | null;
  /** quota["member.max"]；-1 = 不限；null = 无席位口径 */
  seats: number | null;
  /** 功能键（plan_components.features） */
  features: string[];
  /** 配额键值（plan_components.quota） */
  quota: Record<string, unknown>;
  audience: PlanAudience;
}

/** 对比表单元格：渲染层按 kind 决定图标/文案/格式化 */
export type CompareCell =
  | { kind: "yes" }
  | { kind: "no" }
  | { kind: "unlimited" }
  | { kind: "number"; value: number }
  | { kind: "bytes"; value: number }
  | { kind: "text"; value: string };

export interface ComparisonRow {
  /** 配额键或功能键（展示文案由 i18n 字典映射，缺词条回落键名） */
  key: string;
  /** 每档一列，顺序与 plans 一致 */
  cells: CompareCell[];
}

export type ComparisonGroupId = "quota" | "features";

export interface ComparisonGroup {
  id: ComparisonGroupId;
  rows: ComparisonRow[];
}

export interface PricingModel {
  code: string;
  /** 页面标题：营销名（catalog.items）优先，退回目录里的 nick / product_name */
  name: string;
  plans: PricingPlan[];
  comparison: ComparisonGroup[];
}

// ============================================================================
// Constants
// ============================================================================

/** 数值配额里的「不限」哨兵（seed / biz-260 口径，console QuotasPage 同判） */
export const UNLIMITED = -1;

/** tier → 受众。free/starter/pro 个人档，business 团队在线，enterprise 团队私有化。 */
const TIER_AUDIENCE: Record<string, PlanAudience> = {
  free: "person",
  starter: "person",
  pro: "person",
  business: "team",
  enterprise: "private",
};

/**
 * 对比表里已知配额键的展示顺序：先席位与容量类硬上限，再月度池，再档位级
 * 开关。**不是白名单**——阶梯里出现的每个键都会渲染，这里没列的排在后面按
 * 字母序。
 */
const QUOTA_KEY_ORDER = [
  "member.max",
  "dataset.max",
  "datasource.max",
  "service_endpoint.max",
  "storage.bytes",
  "ai.credit",
  "service.api.call",
  "quality.check.run",
  "retention.days",
  "sync.frequency",
  "varda.enabled",
  "varda.readonly",
];

// ============================================================================
// Model building
// ============================================================================

/**
 * 把 BFF 响应适配成页面模型。产品不可见或没有已发布套餐 → null，由页面渲染
 * 「暂未开放订阅」空态（不再拿任何静态价兜底）。
 *
 * @param data - `GET /api/products/:code/plans` 响应
 * @param displayName - 营销名（products.catalog.items 里的 name），无则退回目录名
 */
export function buildPricingModel(
  data: ProductPlansResponse,
  displayName: string | null,
  locale?: string,
): PricingModel | null {
  if (!data.product || data.plans.length === 0) return null;
  const plans = data.plans.map(toPricingPlan);
  // 标题按 locale 取名，与 /products 的 catalogDisplayName 同判：中文页用产品主名
  // product_name（「专注训练智能体」），英文页用副名 nick（品牌/英文名）。此前无条件
  // nick 优先——vxtpl 的 nick 就是 "Vxtpl"，中文页标题成了机器码
  // （owner 2026-09-02 报「显示的是 vxtpl，看不懂是啥」）。营销目录里有专门的
  // 营销名时仍优先它。
  const name = data.product.name.trim();
  const nick = data.product.nick?.trim();
  const catalogName = locale?.toLowerCase().startsWith("en")
    ? nick || name
    : name || nick;
  return {
    code: data.product.code,
    name: displayName ?? catalogName ?? data.product.code,
    plans,
    comparison: buildComparison(plans),
  };
}

function toPricingPlan(option: ProductPlanOption): PricingPlan {
  return {
    tier: option.tier,
    planCode: option.planCode,
    name: option.planName,
    description: option.description ?? null,
    monthly: pickPrice(option.prices, "month"),
    yearly: pickPrice(option.prices, "year"),
    seats: option.seats,
    features: [...option.features],
    quota: option.quota ?? {},
    audience: TIER_AUDIENCE[option.tier] ?? "person",
  };
}

/**
 * 只认 cycle_count=1 的整周期价；同周期多币种时取阶梯给出的首条（BFF 按
 * cycle_unit, cycle_count 排序，币种顺序由 DB 决定）。
 */
function pickPrice(
  prices: ProductPlanPrice[],
  unit: CycleUnit,
): PlanPrice | null {
  const hit = prices.find((p) => p.cycleUnit === unit && p.cycleCount === 1);
  if (!hit) return null;
  const amount = Number.parseFloat(hit.price);
  return Number.isFinite(amount) ? { amount, currency: hit.currency } : null;
}

function buildComparison(plans: PricingPlan[]): ComparisonGroup[] {
  const quotaKeys = orderQuotaKeys(
    unionInOrder(plans.map((plan) => Object.keys(plan.quota))),
  );
  const featureKeys = unionInOrder(plans.map((plan) => plan.features));

  const groups: ComparisonGroup[] = [
    {
      id: "quota",
      rows: quotaKeys.map((key) => ({
        key,
        cells: plans.map((plan) => toCompareCell(key, plan.quota[key])),
      })),
    },
    {
      id: "features",
      rows: featureKeys.map((key) => ({
        key,
        cells: plans.map((plan) =>
          plan.features.includes(key) ? { kind: "yes" } : { kind: "no" },
        ),
      })),
    },
  ];
  return groups.filter((group) => group.rows.length > 0);
}

/** 按首次出现顺序取并集（plans 已按 tier 升序，低档先出现的键排前）。 */
function unionInOrder(lists: string[][]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const key of list) {
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}

function orderQuotaKeys(keys: string[]): string[] {
  const rank = (key: string) => {
    const i = QUOTA_KEY_ORDER.indexOf(key);
    return i < 0 ? QUOTA_KEY_ORDER.length : i;
  };
  return [...keys].sort((a, b) => {
    const diff = rank(a) - rank(b);
    return diff !== 0 ? diff : a.localeCompare(b);
  });
}

/**
 * 配额值 → 单元格。布尔按开关；数值 -1 不限、0 不含、*.bytes 按容量；
 * 其余字符串（如 sync.frequency 的 manual/daily/hourly/realtime）交给渲染层
 * 查值域词典。数字字符串也按数值处理（jsonb 里两种写法都见过，BFF readSeats
 * 同样容错）。
 */
export function toCompareCell(key: string, raw: unknown): CompareCell {
  if (raw === undefined || raw === null) return { kind: "no" };
  if (typeof raw === "boolean") return raw ? { kind: "yes" } : { kind: "no" };
  const n =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" &&
          raw.trim() !== "" &&
          Number.isFinite(Number(raw))
        ? Number(raw)
        : null;
  if (n !== null) {
    if (n === UNLIMITED) return { kind: "unlimited" };
    if (n === 0) return { kind: "no" };
    return key.endsWith(".bytes")
      ? { kind: "bytes", value: n }
      : { kind: "number", value: n };
  }
  if (typeof raw === "string") return { kind: "text", value: raw };
  return { kind: "text", value: JSON.stringify(raw) };
}

// ============================================================================
// Display helpers
// ============================================================================

/** 阶梯里至少一档挂了价的周期（决定月付/年付切换是否出现、默认落在哪）。 */
export function availableCycles(plans: PricingPlan[]): BillingCycle[] {
  const cycles: BillingCycle[] = [];
  if (plans.some((plan) => plan.monthly)) cycles.push("monthly");
  if (plans.some((plan) => plan.yearly)) cycles.push("yearly");
  return cycles;
}

/**
 * 某档在当前周期下实际展示的价：优先当前周期，没有就退到另一周期并把
 * 单位一起带回去（渲染层必须按 unit 标注，不能把月价当年价）。两个周期都没价
 * → null = 联系销售。
 */
export function displayedPrice(
  plan: PricingPlan,
  cycle: BillingCycle,
): { price: PlanPrice; unit: CycleUnit } | null {
  const preferred: [PlanPrice | null, CycleUnit][] =
    cycle === "yearly"
      ? [
          [plan.yearly, "year"],
          [plan.monthly, "month"],
        ]
      : [
          [plan.monthly, "month"],
          [plan.yearly, "year"],
        ];
  for (const [price, unit] of preferred) {
    if (price) return { price, unit };
  }
  return null;
}

/**
 * 营销价展示：走 @vxture-platform/shared 的 formatCurrency（110-locale-layer 指定的
 * 唯一货币格式化入口），符号随 locale 与币种本地化。
 *
 * 整价不带小数（¥1,999），非整价保留到分（¥0.01 / ¥166.58）。此前一律
 * `maximumFractionDigits: 0`：运营把套餐定价 0.01 做真实支付链路验证，官网把它
 * 四舍五入成「¥0」——一个明明要收钱的档位显示成免费，而 `isFree` 又按 `amount === 0`
 * 判，于是出现「¥0 但不是免费」的自相矛盾（owner 2026-09-02 报）。价格是钱，
 * 不能被展示层改数。
 */
export function formatPrice(
  amount: number,
  currency: string,
  locale: Locale,
): string {
  return formatCurrency(amount, locale, currency, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

/** 年付折合月价：向下取到分（不再向下取到整元——0.01/年 曾被取成 0）。 */
export function monthlyEquivalent(yearlyAmount: number): number {
  return Math.floor((yearlyAmount / 12) * 100) / 100;
}

/** 年付相对月付的节省额与比例（仅当两个周期都有价才有意义） */
export function yearlySavings(
  monthly: number,
  yearly: number,
): { save: number; percent: number } {
  const full = monthly * 12;
  const save = full - yearly;
  return { save, percent: full > 0 ? Math.round((save / full) * 100) : 0 };
}

/** 二进制字节格式化（与 console QuotasPage.formatBytes 同款：配额都是 2 的幂）。 */
export function formatBytes(value: number): string {
  const neg = value < 0 ? "-" : "";
  let v = Math.abs(value);
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  const digits = v >= 100 || i === 0 ? 0 : 1;
  return `${neg}${v.toFixed(digits)} ${units[i]}`;
}
