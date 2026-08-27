"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ActionButton,
  ActionMenu,
  Badge,
  Banner,
  DataTable,
  DialogForm,
  EmptyState,
  FilterBar,
  Input,
  Label,
  ListCardGrid,
  ListPageTemplate,
  MetricGrid,
  MetricListCard,
  NativeSelect,
  StatusBadge,
  TableTitleCell,
  useToast,
} from "@vxture/design-system";
import type { DataTableColumn, StatusBadgeTone } from "@vxture/design-system";
import {
  isEnabled,
  isInForce,
  isServing,
  type ModelState,
} from "@vxture-platform/shared";
import { activeTone } from "@/modules/shared/tenant-tone";
import { ListPagination } from "@/modules/shared/ListPagination";
import {
  activateModelPolicy,
  activateModelPriceRule,
  createModelPolicy,
  createModelPriceRule,
  deactivateModelPolicy,
  deactivateModelPriceRule,
  fetchAiModels,
  fetchModelPolicies,
  fetchModelPriceRules,
  fetchModelProviders,
  fetchTenantModelQuotas,
  fetchTenantModelUsageSummaries,
  fetchTenantOperations,
  updateModelPolicy,
  updateModelPriceRule,
  type ModelPolicyUpdateInput,
  type ModelPolicyWriteInput,
  type ModelPriceRuleWriteInput,
} from "@/api/admin-bff";
import type {
  AiModelRecord,
  ModelPolicyRecord,
  ModelPriceRuleRecord,
  ModelProviderRecord,
  TenantOperationRecord,
  TenantQuotaRecord,
  TenantUsageSummaryRecord,
} from "@/entities/console";
import { useTranslations } from "next-intl";
import { PageHeader } from "@/modules/shared/PageHeader";
import { type PageSize } from "@/modules/shared/PageSizePicker";

type ViewMode = "list" | "cards";
type ModelStatusFilter = "all" | "active" | "inactive";
type ModelSourceFilter = "all" | "online" | "private";
type Feedback = {
  tone: "success" | "error";
  key: string;
  values?: Record<string, number | string>;
} | null;
type ModelLinkStatus = "normal" | "abnormal" | "checking";

// Per-token unit prices are legitimately sub-cent (NUMERIC(18,6)) — keep the
// significant fraction but drop the "0.001000"-style trailing-zero noise.
// (Forcing 2dp here would flatten 0.0012 to 0.00.)
function trimUnitPrice(raw: string): string {
  const n = Number(raw);
  return Number.isFinite(n) ? String(n) : raw;
}

type PriceRuleDialogState = {
  mode: "create" | "edit";
  id: string | null;
} | null;

interface PriceRuleForm {
  modelId: string;
  billingMode: string;
  currency: string;
  unitTokens: string;
  inputUnitPrice: string;
  outputUnitPrice: string;
  requestUnitPrice: string;
  /** 留空 = 不声明缓存价。见 `defaultPriceRuleForm` 为什么它不默认 "0"。 */
  cachedInputUnitPrice: string;
  effectiveAt: string;
  expiresAt: string;
}

function defaultPriceRuleForm(modelId: string): PriceRuleForm {
  return {
    modelId,
    billingMode: "token",
    currency: "CNY",
    unitTokens: "1000000",
    inputUnitPrice: "0",
    outputUnitPrice: "0",
    requestUnitPrice: "0",
    // 空字符串，不是 "0"。上面三个默认 0 是安全的（没配价就是不计费）；缓存价
    // 的 0 却是一句具体的假话——「缓存输入免费」，对每一家供应商都不成立，而且
    // 会被静默写进每一条新规则。空 = 没声明，算成本时回退到输入单价（只高估）。
    cachedInputUnitPrice: "",
    effectiveAt: "",
    expiresAt: "",
  };
}

function priceRuleFormFromRecord(rule: ModelPriceRuleRecord): PriceRuleForm {
  return {
    modelId: rule.modelId,
    billingMode: rule.billingMode,
    currency: rule.currency,
    unitTokens: String(rule.unitTokens),
    inputUnitPrice: rule.inputUnitPrice,
    outputUnitPrice: rule.outputUnitPrice,
    requestUnitPrice: rule.requestUnitPrice,
    cachedInputUnitPrice: rule.cachedInputUnitPrice ?? "",
    effectiveAt: toDateTimeLocal(rule.effectiveAt),
    expiresAt: toDateTimeLocal(rule.expiresAt),
  };
}

/* ── 模型策略 ─────────────────────────────────────────────────────────────
 *
 * 与上面的计价规则是**相反的两种表**，同一页上并排放着，很容易照着记错：
 *
 *   计价规则  追加版本化。值列不授予 UPDATE，改价 = 新建 + 给旧的设失效。
 *   策略      就地可改。除 tenantId / effectiveAt 外每个值列都授予 UPDATE，
 *             历史只在 `audit.change_records` 里（atlas TD-038 记着这个不对称）。
 *
 * ── 只选一条，不合并 ──────────────────────────────────────────────────────
 *
 * atlas 的 `findApplicablePolicy` 对一个 (模型, 租户) 只挑**一条**：租户专属压全局
 * 默认；同作用域内 priority 小的压大的，并列时 effectiveAt 晚的压早的。挑中之后
 * 就用那一条的全部字段——**不会**把全局默认里的 RPM 借给一条只设了并发的租户策略。
 *
 * 这是运营最容易想错的地方，也是这一段代码存在的理由：同作用域的兄弟里除了排在
 * 最前的那条，其余永远不会对任何人生效，页面必须把它标出来，而不是让人自己在一
 * 列 priority 里推。
 *
 * ── 五个限额里只有两个真的会拦请求 ────────────────────────────────────────
 *
 * `QuotaService.checkRateLimit` 只调 `checkRpm` 与 `acquireConcurrency`。
 * `rateLimitTpm` / `rateLimitTpd` / `maxContextTokens` 三列 atlas 收下、存进库、
 * 读回来给你看，**运行时一次都没读过**。表单照收（上游收，早晚会用上），但必须
 * 说清楚，否则就是拿一个输入框假装一道闸门。 */

type PolicyDialogState = {
  mode: "create" | "edit";
  id: string | null;
} | null;

interface PolicyForm {
  modelId: string;
  /** 空串 = 全局默认（`tenant_id IS NULL`）。存的是 UUID，界面上只出可视码。 */
  tenantId: string;
  name: string;
  priority: string;
  maxConcurrent: string;
  rateLimitRpm: string;
  rateLimitTpm: string;
  rateLimitTpd: string;
  maxContextTokens: string;
  effectiveAt: string;
  expiresAt: string;
}

function defaultPolicyForm(modelId: string): PolicyForm {
  return {
    modelId,
    tenantId: "",
    name: "",
    /* atlas 的 `parsePriority` 对缺省就是回落到 100，这里跟它一致。 */
    priority: "100",
    /* 五个限额一律留空，**没有一个默认 "0"**。atlas 的语义是
       `null` = 不限、`0` = 拦死（`acquireConcurrency` 里 `0 >= 0` 恒成立，
       maxConcurrent 填 0 等于把这个模型对该租户整个关掉）。默认 0 会把
       「这项我没管」写成「这项我禁了」，而且是静默写进每一条新策略。 */
    maxConcurrent: "",
    rateLimitRpm: "",
    rateLimitTpm: "",
    rateLimitTpd: "",
    maxContextTokens: "",
    effectiveAt: "",
    expiresAt: "",
  };
}

function policyFormFromRecord(policy: ModelPolicyRecord): PolicyForm {
  const num = (value: number | null) => (value == null ? "" : String(value));
  return {
    modelId: policy.modelId,
    tenantId: policy.tenantId ?? "",
    name: policy.name ?? "",
    priority: String(policy.priority),
    maxConcurrent: num(policy.maxConcurrent),
    rateLimitRpm: num(policy.rateLimitRpm),
    rateLimitTpm: policy.rateLimitTpm ?? "",
    rateLimitTpd: policy.rateLimitTpd ?? "",
    maxContextTokens: num(policy.maxContextTokens),
    effectiveAt: toDateTimeLocal(policy.effectiveAt),
    expiresAt: toDateTimeLocal(policy.expiresAt),
  };
}

/**
 * 限额输入 → 载荷值。`""` → `null`（**显式发出去**，那是"取消这项限制"的唯一
 * 说法），非法 → `undefined` 让调用方点名报错。不静默丢、不当成没填。
 */
function parseLimit(raw: string): number | null | undefined {
  const text = raw.trim();
  if (text === "") return null;
  const n = Number(text);
  return Number.isSafeInteger(n) && n >= 0 ? n : undefined;
}

/** TPM / TPD 是 bigint 列，量级到不了 JS number，全程走字符串。 */
function parseBigLimit(raw: string): string | null | undefined {
  const text = raw.trim();
  if (text === "") return null;
  return /^\d+$/.test(text) ? text : undefined;
}

/** 与 atlas `findApplicablePolicy` 同一判据：启用 + 已生效 + 未失效。 */
function isPolicyInForce(policy: ModelPolicyRecord, now: number): boolean {
  if (!isEnabled(policy.state)) return false;
  const from = new Date(policy.effectiveAt).getTime();
  if (Number.isFinite(from) && from > now) return false;
  if (policy.expiresAt) {
    const until = new Date(policy.expiresAt).getTime();
    if (Number.isFinite(until) && until <= now) return false;
  }
  return true;
}

/**
 * 每条策略此刻的处境：在不在生效窗口内，以及在不在同作用域里被别人压住。
 *
 * 两件事一起算是因为它们共用同一个"现在"。分两次算就会出现一条策略按一个时间戳
 * 判成生效、按另一个判成被覆盖的窗口——小，但那正是这类判定最不该有的东西。
 *
 * `shadowed` 只在同一个 (模型, 作用域) 内部比较：一条全局默认**不会**因为某个
 * 租户有专属策略就被标成被覆盖，它对其余每个租户照常生效。把那种情况也算进来
 * 是另一种谎。
 */
function policyStandings(
  policies: readonly ModelPolicyRecord[],
  now: number,
): { inForce: ReadonlySet<string>; shadowed: ReadonlySet<string> } {
  const groups = new Map<string, ModelPolicyRecord[]>();
  const inForce = new Set<string>();
  for (const policy of policies) {
    if (!isPolicyInForce(policy, now)) continue;
    inForce.add(policy.id);
    const key = `${policy.modelId}|${policy.tenantId ?? "*"}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(policy);
    else groups.set(key, [policy]);
  }

  const shadowed = new Set<string>();
  for (const bucket of groups.values()) {
    if (bucket.length < 2) continue;
    /* 与上游 orderBy 同序：priority 升序，并列时 effectiveAt 降序。 */
    const ordered = [...bucket].sort(
      (a, b) =>
        a.priority - b.priority ||
        new Date(b.effectiveAt).getTime() - new Date(a.effectiveAt).getTime(),
    );
    for (const policy of ordered.slice(1)) shadowed.add(policy.id);
  }
  return { inForce, shadowed };
}

/** 这条策略当下真的会拦请求吗——只看 atlas 真正读的那两列。 */
function hasEnforcedLimit(policy: ModelPolicyRecord): boolean {
  return policy.rateLimitRpm != null || policy.maxConcurrent != null;
}

/** 收下了但运行时还没读的那三列。设了就得说一声，别让人以为它在拦。 */
function hasRecordedOnlyLimit(policy: ModelPolicyRecord): boolean {
  return (
    policy.rateLimitTpm != null ||
    policy.rateLimitTpd != null ||
    policy.maxContextTokens != null
  );
}

// 把后端 ISO 时间转成 datetime-local 输入控件的本地墙钟值，保证编辑回填后再提交
// 能还原为同一时刻（避免直接截断 UTC 字符串造成的时区偏移累积）。
function toDateTimeLocal(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function describeError(error: unknown): { description?: string } {
  return error instanceof Error && error.message
    ? { description: error.message }
    : {};
}

function isPrivateProvider(provider: string) {
  return ["private", "custom", "self-hosted"].includes(provider);
}

function modelSearchText(model: AiModelRecord) {
  return [
    model.modelName,
    model.modelCode,
    model.provider,
    model.protocol,
    model.endpointUrl,
    model.keyReference?.name ?? "",
    ...model.capabilities,
  ]
    .join(" ")
    .toLowerCase();
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

/* 原有 `modelTone()` 随卡片换 `MetricListCard` 一同退场——它只为拼
   `vx-model-platform-card--{tone}` 而存在。它的两个判断各自有了去处：
   「弃用的不算 muted」归下面的 `MODEL_STATE_TONE`（deprecated → warning）；
   「私有部署另给一色」则不再做——厂商是**类目**、没有严重度，卡上那个
   `Badge variant="outline"` 已经在说这件事（判据同本文件内那条注释）。 */

/**
 * 模型三态的呈现。**「已弃用」用 warning 而不是 neutral**：它仍在服务，中性色会读成
 * 「已经关了、不用管」——而它恰恰是需要人去安排迁移的那一档。
 */
const MODEL_STATE_TONE: Record<ModelState, StatusBadgeTone> = {
  active: "success",
  inactive: "neutral",
  deprecated: "warning",
};

const MODEL_STATE_ICON: Record<ModelState, "check" | "x" | "clock"> = {
  active: "check",
  inactive: "x",
  deprecated: "clock",
};

const LINK_STATUS_TONE: Record<ModelLinkStatus, StatusBadgeTone> = {
  normal: "success",
  abnormal: "danger",
  checking: "info",
};

const LINK_STATUS_LABEL: Record<ModelLinkStatus, string> = {
  normal: "正常",
  abnormal: "异常",
  checking: "检测中",
};

function detectModelLinkStatus(model: AiModelRecord): ModelLinkStatus {
  return model.endpointUrl.trim() &&
    model.protocol.trim() &&
    (model.keyReference === null || model.keyReference.configured)
    ? "normal"
    : "abnormal";
}

export function ModelPlatformPage() {
  const tShared = useTranslations();
  const t = useTranslations("modelPlatformPage");
  const { toast } = useToast();
  const [models, setModels] = useState<AiModelRecord[]>([]);
  const [providers, setProviders] = useState<ModelProviderRecord[]>([]);
  const [priceRules, setPriceRules] = useState<ModelPriceRuleRecord[]>([]);
  const [policies, setPolicies] = useState<ModelPolicyRecord[]>([]);
  const [quotas, setQuotas] = useState<TenantQuotaRecord[]>([]);
  const [usageSummaries, setUsageSummaries] = useState<
    TenantUsageSummaryRecord[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [linkStatusByModelId, setLinkStatusByModelId] = useState<
    Record<string, ModelLinkStatus>
  >({});
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ModelStatusFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<ModelSourceFilter>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(20);
  /**
   * 计价规则与策略各自分页。
   *
   * 这一页同时铺三份清单，而模型表早就分了页、下面两段没有——于是种子环境里
   * 131 个模型 + 214 条计价规则 + 133 条策略一次渲染近五百张卡，页面在浏览器里
   * 实测卡到截图连续 30 秒超时（2026-08-25）。策略那一段是本轮新加的，等于我把
   * 一个本来就吃紧的页面又压了一层。
   *
   * 三份清单三套页码而不是共用一套：它们是三张互不相干的表，共用页码会让翻计价
   * 规则把策略也翻走——那是把「同一页上」误当成「同一个东西」。
   */
  const [priceRulePage, setPriceRulePage] = useState(1);
  const [priceRulePageSize, setPriceRulePageSize] = useState<PageSize>(20);
  const [policyPage, setPolicyPage] = useState(1);
  const [policyPageSize, setPolicyPageSize] = useState<PageSize>(20);
  /**
   * 上游读取是否失败。**不复用 `feedback`**：那条横幅会被后续的保存、启停操作
   * 覆盖，而"这张表为什么是空的"必须一直可查。
   */
  const [loadFailed, setLoadFailed] = useState(false);
  /** 配额读不回来时上游给的理由；null = 读到了。见上面 `allSettled` 那段注释。 */
  const [quotaUnavailable, setQuotaUnavailable] = useState<string | null>(null);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [priceRuleDialog, setPriceRuleDialog] =
    useState<PriceRuleDialogState>(null);
  const [priceRuleForm, setPriceRuleForm] = useState<PriceRuleForm>(() =>
    defaultPriceRuleForm(""),
  );
  const [policyDialog, setPolicyDialog] = useState<PolicyDialogState>(null);
  const [policyForm, setPolicyForm] = useState<PolicyForm>(() =>
    defaultPolicyForm(""),
  );
  /**
   * 租户清单只为一件事：把作用域选择器做成**可视码**的下拉，而不是一个让人贴
   * UUID 的输入框。owner 2026-08-20 定的通用原则——UUID 任何场景都不面向用户，
   * 一律用可视码。UUID 仍然是送给 atlas 的值，只是它不出现在屏幕上。
   *
   * 读不回来就退成"只能建全局默认策略"并说明原因，不退回 UUID 输入框。
   */
  const [tenants, setTenants] = useState<TenantOperationRecord[]>([]);

  useEffect(() => {
    let active = true;
    setLoading(true);

    /**
     * **`allSettled` 而不是 `all`。**
     *
     * 这六个读里有一个是**上游明确不提供**的：atlas 的 `GET /capability/quotas` 是一个
     * 故意的 501 桩（`MODEL_ADMIN_NOT_IMPLEMENTED`，原话"Bulk quota listing across
     * tenants is not available - the platform exposes only a single-workspace
     * entitlement read"）。它永远不会成功。
     *
     * 用 `Promise.all` 的后果是**这一个 501 拖垮整页**：另外五个读全部成功，页面却整片
     * 空白，还打出「请确认 Model Platform 是否已启动」——把人指向一个根本没坏的服务。
     * 2026-08-23 实测就是这个状态（5×200 + 1×501 → 整页读取失败）。
     *
     * 现在每一路各自落地：成功的照常渲染，失败的那一格自己说清为什么，并且**说的是上游
     * 给的理由**，不是一句通用的"读取失败"。
     */
    Promise.allSettled([
      fetchAiModels(true),
      fetchModelProviders(true),
      fetchModelPriceRules({ includeInactive: true }),
      fetchModelPolicies({ includeInactive: true }),
      fetchTenantModelQuotas({ includeExpired: true }),
      fetchTenantModelUsageSummaries(),
      /* 第七路。它只喂策略的作用域下拉，失败也只影响那一个下拉——所以和上面
         六路一样各自落地，不牵连任何别的格子。 */
      fetchTenantOperations(),
    ])
      .then(
        ([
          modelsR,
          providersR,
          priceRulesR,
          policiesR,
          quotasR,
          usageR,
          tenantsR,
        ]) => {
          if (!active) return;
          /* 每一路各自落地：拿不到就空数组，让那一格自己降级，不牵连别的。 */
          const rows = <V,>(r: PromiseSettledResult<V[]>): V[] =>
            r.status === "fulfilled" ? r.value : [];
          const records = rows(modelsR);
          const providerRecords = rows(providersR);
          const priceRuleRecords = rows(priceRulesR);
          const policyRecords = rows(policiesR);
          const quotaRecords = rows(quotasR);
          /* 用量是信封不是裸数组（product_251 A-4）：轴由服务端解析，回显在信封上。
             这一格只用行，但**不在 fetch 那层就拆掉信封**——拆掉就等于把「你看的是哪
             根轴」这个事实丢掉，而空结果时那是唯一还剩下的信息。 */
          const usageRecords =
            usageR.status === "fulfilled" ? usageR.value.items : [];
          /* 模型读不到才算这一页坏了——它是主表。其余各自降级到自己那一格。 */
          setLoadFailed(modelsR.status === "rejected");
          if (modelsR.status === "rejected") {
            setFeedback({ tone: "error", key: "feedback.loadError" });
          }
          setQuotaUnavailable(
            quotasR.status === "rejected"
              ? (quotasR.reason instanceof Error && quotasR.reason.message) ||
                  "unavailable"
              : null,
          );
          setModels(records);
          setProviders(providerRecords);
          setPriceRules(priceRuleRecords);
          setPolicies(policyRecords);
          setTenants(rows(tenantsR));
          setQuotas(quotaRecords);
          setUsageSummaries(usageRecords);
          setLinkStatusByModelId(
            Object.fromEntries(
              records.map((model) => [model.id, detectModelLinkStatus(model)]),
            ),
          );
          setLoadFailed(false);
        },
      )
      .catch(() => {
        /* allSettled 不会走到这里，除非 then 里自己抛。留着是纵深防御。 */
        if (active) {
          setLoadFailed(true);
          setFeedback({ tone: "error", key: "feedback.loadError" });
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [pageSize, query, sourceFilter, statusFilter, viewMode]);

  const modelById = useMemo(
    () => new Map(models.map((model) => [model.id, model])),
    [models],
  );

  /* 页码钳在总页数内：删掉最后一页的最后一条之后，页码会指向一个不存在的页，
     那时该退回最后一页而不是显示空白——与模型表 `safeCurrentPage` 同一套。 */
  const priceRulePageCount = Math.max(
    1,
    Math.ceil(priceRules.length / priceRulePageSize),
  );
  const safePriceRulePage = Math.min(priceRulePage, priceRulePageCount);
  const pagedPriceRules = priceRules.slice(
    (safePriceRulePage - 1) * priceRulePageSize,
    safePriceRulePage * priceRulePageSize,
  );

  const policyPageCount = Math.max(
    1,
    Math.ceil(policies.length / policyPageSize),
  );
  const safePolicyPage = Math.min(policyPage, policyPageCount);
  const pagedPolicies = policies.slice(
    (safePolicyPage - 1) * policyPageSize,
    safePolicyPage * policyPageSize,
  );

  /** UUID → 可视码。屏幕上只出 value，UUID 只当 key 用。 */
  const tenantCodeById = useMemo(
    () => new Map(tenants.map((tenant) => [tenant.id, tenant.tenantCode])),
    [tenants],
  );

  /**
   * 每条策略此刻的处境。按数据重载的那一刻算一次。
   *
   * 依赖里只带 `policies` 就够：策略的生效窗口以分钟计不以秒计，为它挂一个每秒
   * 的 tick 是拿一个真实的复杂度换一个想象中的精度。
   */
  const policyStanding = useMemo(
    () => policyStandings(policies, Date.now()),
    [policies],
  );

  /** 作用域怎么说人话。**任何分支都不吐 UUID**：查不到就只说轴，不说是谁。 */
  function describePolicyScope(policy: ModelPolicyRecord): string {
    if (!policy.tenantId) return "全局默认";
    const code = tenantCodeById.get(policy.tenantId);
    return code ? `租户 ${code}` : "租户专属";
  }

  const filteredModels = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return models.filter((model) => {
      const matchesQuery =
        !normalizedQuery || modelSearchText(model).includes(normalizedQuery);
      /* 三档各自成立。此前只有两档、按布尔分，`deprecated` 会被归进「停用」——
         一个仍在服务的模型被筛进"停用"里，是这次迁移最要避开的那种静默错。 */
      const matchesStatus =
        statusFilter === "all" || statusFilter === model.state;
      const matchesSource =
        sourceFilter === "all" ||
        (sourceFilter === "online" && !isPrivateProvider(model.provider)) ||
        (sourceFilter === "private" && isPrivateProvider(model.provider));

      return matchesQuery && matchesStatus && matchesSource;
    });
  }, [models, query, sourceFilter, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredModels.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const pageStart = (safeCurrentPage - 1) * pageSize;
  const pagedModels = filteredModels.slice(pageStart, pageStart + pageSize);
  /* 数**还能服务的**（`deprecated` 算能）：这一格回答"现在撑着多少"，
     少算弃用的会低报真实服务面。 */
  const activeModels = models.filter((model) => isServing(model.state)).length;
  const inactiveModels = models.length - activeModels;
  const privateModels = models.filter((model) =>
    isPrivateProvider(model.provider),
  ).length;
  const onlineModels = models.length - privateModels;
  const activeProviders = providers.filter((provider) =>
    isEnabled(provider.state),
  );
  const activePolicies = policies.filter((policy) => isEnabled(policy.state));
  const activePriceRules = priceRules.filter((rule) => isEnabled(rule.state));
  /* 配额**没有** state / isActive —— atlas 的配额生不生效完全由 effectiveAt /
     expiresAt 这个窗口决定，读时判定。此前这里读的是一个上游从来没有过的布尔，
     于是这一格恒为 0。 */
  const activeQuotas = quotas.filter((quota) => isInForce(quota));
  const totalUsageTokens = usageSummaries.reduce(
    (total, summary) => total + Number(summary.totalTokens || 0),
    0,
  );

  const statusFilters = [
    { value: "all", label: t("filters.all") },
    { value: "active", label: t("filters.active") },
    { value: "inactive", label: t("filters.inactive") },
    { value: "deprecated", label: t("filters.deprecated") },
  ] as const;
  const sourceFilters = [
    { value: "all", label: t("filters.all") },
    { value: "online", label: t("filters.online") },
    { value: "private", label: t("filters.private") },
  ] as const;

  function providerLabel(provider: string) {
    const label = t(`providers.${provider}`);
    return label.startsWith("modelPlatformPage.providers.") ? provider : label;
  }

  /* 列定义每次渲染重建：单元格取值依赖 t / 对话框开关等本次渲染的闭包，
     memo 起来反而要把它们全列进依赖数组。 */
  const modelColumns: DataTableColumn<AiModelRecord>[] = [
    {
      id: "model",
      header: t("table.columns.model"),
      cell: (model) => (
        <TableTitleCell
          icon={isPrivateProvider(model.provider) ? "code" : "plug"}
          title={model.modelName}
          description={model.modelCode}
        />
      ),
    },
    {
      id: "status",
      header: t("table.columns.status"),
      align: "center",
      cell: (model) => (
        <StatusBadge
          tone={MODEL_STATE_TONE[model.state]}
          icon={MODEL_STATE_ICON[model.state]}
        >
          {t(`status.${model.state}`)}
        </StatusBadge>
      ),
    },
    {
      id: "link",
      header: "链路状态",
      align: "center",
      cell: (model) => {
        const link =
          linkStatusByModelId[model.id] ?? detectModelLinkStatus(model);
        return (
          <StatusBadge tone={LINK_STATUS_TONE[link]}>
            {LINK_STATUS_LABEL[link]}
          </StatusBadge>
        );
      },
    },
    {
      id: "source",
      header: "来源",
      cell: (model) => (
        <TableTitleCell
          title={providerLabel(model.provider)}
          description={model.protocol}
        />
      ),
    },
    {
      id: "capabilities",
      header: "模型能力",
      cell: (model) => (
        <span className="flex flex-wrap gap-2xs">
          {model.capabilities.slice(0, 3).map((capability) => (
            <Badge key={capability}>{capability}</Badge>
          ))}
          {model.capabilities.length > 3 ? (
            <Badge>+{model.capabilities.length - 3}</Badge>
          ) : null}
        </span>
      ),
    },
  ];

  function handleReset() {
    setQuery("");
    setStatusFilter("all");
    setSourceFilter("all");
  }

  // Provider / Model 的创建、编辑、启停、删除已迁移至 opera（技术运维平台，
  // 2026-08-11）：opera-bff 自己的 atlas.router.ts 才是这两类资源的写入口，
  // admin-bff 这一侧对应端点已撤走。本页往下只读它们（给价格规则/策略挑
  // model 用），不再提供任何写入 UI——两段裁决里 provider/model 生命周期
  // 属技术供给，归 opera；本页留的是商业封装（价格规则/策略/配额/用量）。

  // ── Price rule 写路径 ──────────────────────────────────────────────────────

  async function reloadPriceRules() {
    setPriceRules(await fetchModelPriceRules({ includeInactive: true }));
  }

  function openCreatePriceRuleDialog() {
    setPriceRuleForm(defaultPriceRuleForm(models[0]?.id ?? ""));
    setPriceRuleDialog({ mode: "create", id: null });
  }

  function openEditPriceRuleDialog(rule: ModelPriceRuleRecord) {
    setPriceRuleForm(priceRuleFormFromRecord(rule));
    setPriceRuleDialog({ mode: "edit", id: rule.id });
  }

  async function submitPriceRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!priceRuleDialog) return;

    const common: Partial<Omit<ModelPriceRuleWriteInput, "modelId">> = {
      billingMode: priceRuleForm.billingMode.trim() || "token",
      currency: priceRuleForm.currency.trim() || "CNY",
      inputUnitPrice: priceRuleForm.inputUnitPrice.trim() || "0",
      outputUnitPrice: priceRuleForm.outputUnitPrice.trim() || "0",
      requestUnitPrice: priceRuleForm.requestUnitPrice.trim() || "0",
      expiresAt: priceRuleForm.expiresAt || null,
    };
    // 没填就不发这个键——不能像上面三个那样 `|| "0"` 兜底，那会把「没声明」
    // 写成「免费」。
    const cachedInput = priceRuleForm.cachedInputUnitPrice.trim();
    if (cachedInput) common.cachedInputUnitPrice = cachedInput;
    const parsedUnitTokens = Number(priceRuleForm.unitTokens);
    if (Number.isFinite(parsedUnitTokens) && parsedUnitTokens > 0) {
      common.unitTokens = parsedUnitTokens;
    }
    if (priceRuleForm.effectiveAt) {
      common.effectiveAt = priceRuleForm.effectiveAt;
    }

    setCatalogBusy(true);
    try {
      if (priceRuleDialog.mode === "create") {
        if (!priceRuleForm.modelId) {
          toast({ tone: "danger", title: "请先选择模型" });
          return;
        }
        await createModelPriceRule({
          modelId: priceRuleForm.modelId,
          ...common,
        });
        toast({ tone: "success", title: "计价规则已创建" });
      } else if (priceRuleDialog.id) {
        // 计价规则是**追加版本化**的：atlas 的 PATCH 逐个按名拒绝 billingMode /
        // currency / unitTokens / 三个单价 / cachedInputUnitPrice / effectiveAt
        // ——数据库对这些列根本不授予 UPDATE，改价会篡改 reqlog 已经引用过的历史。
        // 复用 `common` 会把它们全发出去，于是「编辑 → 保存」必然 400，报的还是
        // 一串用户没动过的字段。这里只发 atlas 真正收的那一个。
        //
        // 要改价请新建一条规则，再把旧规则的 expiresAt 设过去。
        await updateModelPriceRule(priceRuleDialog.id, {
          expiresAt: priceRuleForm.expiresAt || null,
        });
        toast({ tone: "success", title: "计价规则已更新" });
      }
      await reloadPriceRules();
      setPriceRuleDialog(null);
    } catch (error) {
      toast({ tone: "danger", title: "保存失败", ...describeError(error) });
    } finally {
      setCatalogBusy(false);
    }
  }

  // ── 模型策略 ─────────────────────────────────────────────────────────────

  async function reloadPolicies() {
    setPolicies(await fetchModelPolicies({ includeInactive: true }));
  }

  function openCreatePolicyDialog() {
    setPolicyForm(defaultPolicyForm(models[0]?.id ?? ""));
    setPolicyDialog({ mode: "create", id: null });
  }

  function openEditPolicyDialog(policy: ModelPolicyRecord) {
    setPolicyForm(policyFormFromRecord(policy));
    setPolicyDialog({ mode: "edit", id: policy.id });
  }

  async function submitPolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!policyDialog) return;

    /* 五个限额先各自解析再拼。非法值**不静默丢掉**、也不当成"不限"送出去
       ——那两种都会让人以为自己填的生效了，而这里填错的后果是一道没设上的闸门。 */
    const maxConcurrent = parseLimit(policyForm.maxConcurrent);
    const rateLimitRpm = parseLimit(policyForm.rateLimitRpm);
    const maxContextTokens = parseLimit(policyForm.maxContextTokens);
    const rateLimitTpm = parseBigLimit(policyForm.rateLimitTpm);
    const rateLimitTpd = parseBigLimit(policyForm.rateLimitTpd);
    const badLimit = (
      [
        [maxConcurrent, "最大并发"],
        [rateLimitRpm, "RPM 上限"],
        [maxContextTokens, "最大上下文"],
        [rateLimitTpm, "TPM 上限"],
        [rateLimitTpd, "TPD 上限"],
      ] as const
    ).find(([value]) => value === undefined);
    if (badLimit) {
      toast({
        tone: "danger",
        title: `${badLimit[1]}要填非负整数`,
        description: "留空＝不限制；填 0 是一句具体的话——把这一项拦死。",
      });
      return;
    }

    const priority = Number(policyForm.priority);
    if (!Number.isSafeInteger(priority) || priority < 0) {
      toast({ tone: "danger", title: "优先级要填非负整数" });
      return;
    }

    /* 就地可改的那些。**没有 tenantId / effectiveAt**：atlas 的
       `normalizeUpdatePolicy` 对这两个是「出现即拒」（400，不比对值），库里也不
       授予 UPDATE。改租户不是编辑而是另一条策略，改开始时间要新建一个窗口。
       这与同页那个「复用 create 载荷去 PATCH」踩的是同一个坑，这里从一开始就分开。 */
    const editable: ModelPolicyUpdateInput = {
      name: policyForm.name.trim() || null,
      priority,
      maxConcurrent: maxConcurrent ?? null,
      rateLimitRpm: rateLimitRpm ?? null,
      rateLimitTpm: rateLimitTpm ?? null,
      rateLimitTpd: rateLimitTpd ?? null,
      maxContextTokens: maxContextTokens ?? null,
      expiresAt: policyForm.expiresAt || null,
    };

    setCatalogBusy(true);
    try {
      if (policyDialog.mode === "create") {
        if (!policyForm.modelId) {
          toast({ tone: "danger", title: "请先选择模型" });
          return;
        }
        const payload: ModelPolicyWriteInput = {
          modelId: policyForm.modelId,
          /* 空串 → null：全局默认策略。空串送过去会被 atlas 的 optionalString
             也归成 null，但显式写出来是为了让读代码的人看见这里有两种作用域。 */
          tenantId: policyForm.tenantId || null,
          ...editable,
        };
        if (policyForm.effectiveAt)
          payload.effectiveAt = policyForm.effectiveAt;
        await createModelPolicy(payload);
        toast({ tone: "success", title: "策略已创建" });
      } else if (policyDialog.id) {
        await updateModelPolicy(policyDialog.id, editable);
        toast({ tone: "success", title: "策略已更新" });
      }
      await reloadPolicies();
      setPolicyDialog(null);
    } catch (error) {
      toast({ tone: "danger", title: "保存失败", ...describeError(error) });
    } finally {
      setCatalogBusy(false);
    }
  }

  async function togglePolicy(policy: ModelPolicyRecord, activate: boolean) {
    setCatalogBusy(true);
    try {
      await (activate
        ? activateModelPolicy(policy.id)
        : deactivateModelPolicy(policy.id));
      await reloadPolicies();
      toast({
        tone: "success",
        title: activate ? "策略已启用" : "策略已停用",
      });
    } catch (error) {
      toast({ tone: "danger", title: "操作失败", ...describeError(error) });
    } finally {
      setCatalogBusy(false);
    }
  }

  async function togglePriceRule(
    rule: ModelPriceRuleRecord,
    activate: boolean,
  ) {
    setCatalogBusy(true);
    try {
      await (activate
        ? activateModelPriceRule(rule.id)
        : deactivateModelPriceRule(rule.id));
      await reloadPriceRules();
      toast({
        tone: "success",
        title: activate ? "规则已启用" : "规则已停用",
      });
    } catch (error) {
      toast({ tone: "danger", title: "操作失败", ...describeError(error) });
    } finally {
      setCatalogBusy(false);
    }
  }

  return (
    <>
      <ListPageTemplate
        className="w-full vx-model-platform-page"
        header={
          <PageHeader
            icon="code"
            eyebrow={t("header.eyebrow")}
            title={t("header.title")}
            description={t("header.description")}
            secondary={<Badge>{t("header.badge")}</Badge>}
          />
        }
        summary={
          <>
            {" "}
            {feedback ? (
              <p
                className={
                  feedback.tone === "success"
                    ? "vx-profile-message"
                    : "vx-profile-error"
                }
              >
                {t(feedback.key, feedback.values)}
              </p>
            ) : null}
            <MetricGrid
              loading={loading}
              aria-label={t("summary.ariaLabel")}
              columns={3}
              items={[
                {
                  id: "models",
                  help: t("summary.modelsHelp"),
                  icon: "plug",
                  label: t("summary.models"),
                  value: formatNumber(models.length),
                  tags: [
                    `${t("filters.online")} ${formatNumber(onlineModels)}`,
                    `${t("filters.private")} ${formatNumber(privateModels)}`,
                  ],
                },
                {
                  id: "active",
                  help: t("summary.activeHelp"),
                  icon: "play",
                  label: t("filters.active"),
                  value: formatNumber(activeModels),
                  tags: ["可调度"],
                  tone: activeModels ? "success" : "warning",
                },
                {
                  id: "inactive",
                  help: t("summary.inactiveHelp"),
                  icon: "code",
                  label: t("status.inactive"),
                  value: formatNumber(inactiveModels),
                  tags: inactiveModels ? ["需复核"] : ["无停用"],
                  tone: inactiveModels ? "warning" : "success",
                },
                {
                  id: "providers",
                  help: "已接入的模型供应商数量。",
                  icon: "settings",
                  label: "Provider",
                  value: formatNumber(providers.length),
                  tags: [`启用 ${formatNumber(activeProviders.length)}`],
                  tone: activeProviders.length ? "success" : "warning",
                },
                {
                  id: "policies-cost",
                  help: "启用中的模型策略数 / 启用中的价格规则数。",
                  icon: "database",
                  label: "策略 / 成本",
                  value: `${formatNumber(activePolicies.length)} / ${formatNumber(activePriceRules.length)}`,
                  tags: [
                    `策略 ${formatNumber(policies.length)}`,
                    `价格 ${formatNumber(priceRules.length)}`,
                  ],
                  tone: "brand",
                },
                {
                  id: "quota-usage",
                  help: "启用中的配额条数 / 统计期内累计消耗 token。",
                  icon: "chart-bar",
                  label: "配额 / 用量",
                  value: quotaUnavailable
                    ? `— / ${formatNumber(totalUsageTokens)}`
                    : `${formatNumber(activeQuotas.length)} / ${formatNumber(totalUsageTokens)}`,
                  tags: [
                    `配额 ${formatNumber(quotas.length)}`,
                    `汇总 ${formatNumber(usageSummaries.length)}`,
                  ],
                  tone: usageSummaries.length ? "success" : "warning",
                },
              ]}
            />
          </>
        }
        filters={
          <FilterBar
            view={viewMode}
            onViewChange={setViewMode}
            cardsDisabledReason={tShared("common.cardsRetired")}
            count={formatNumber(filteredModels.length)}
            aria-label="模型状态"
            search={
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("table.searchPlaceholder")}
                className="grow basis-media-3xl max-w-panel-sm"
                aria-label={t("table.searchAriaLabel")}
              />
            }
            onReset={handleReset}
          >
            <>
              <NativeSelect
                wrapperClassName="w-fit basis-media-xl"
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value as ModelStatusFilter)
                }
                aria-label="模型状态"
              >
                {statusFilters.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </NativeSelect>
              <NativeSelect
                wrapperClassName="w-fit basis-media-xl"
                value={sourceFilter}
                onChange={(event) =>
                  setSourceFilter(event.target.value as ModelSourceFilter)
                }
                aria-label="模型来源"
              >
                {sourceFilters.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </NativeSelect>
            </>
          </FilterBar>
        }
        table={
          <section
            className="grid min-w-0 max-w-full gap-xs"
            aria-label={t("table.toolbarTitle", {
              count: filteredModels.length,
            })}
          >
            {/* 列表态的加载由 DataTable 出骨架行，卡片态没有骨架，仍留这行提示。 */}
            {loading && viewMode === "cards" ? (
              <header className="flex min-h-0 items-center justify-end gap-sm text-body-sm font-normal text-muted-foreground">
                <span>{t("empty.loadingTitle")}</span>
              </header>
            ) : null}

            {viewMode === "list" ? (
              <DataTable
                columns={modelColumns}
                rows={pagedModels}
                rowKey={(model) => model.id}
                loading={loading}
                indexStart={pageStart + 1}
                empty={
                  loadFailed ? (
                    /* 读取失败与"筛选没匹配上"是两回事。混成一种，本页就会在顶部
                     横幅已经报出「模型数据读取失败」的同时，两行之下劝人去放宽
                     筛选——同一屏自相矛盾（2026-08-07 走查）。 */
                    <EmptyState
                      icon="warning"
                      title={t("empty.loadFailedTitle")}
                      description={t("empty.loadFailedDescription")}
                    />
                  ) : (
                    <EmptyState
                      title={t("empty.title")}
                      description={t("empty.description")}
                      action={
                        <ActionButton
                          variant="outline"
                          icon="x"
                          onClick={handleReset}
                        >
                          {t("empty.resetFilters")}
                        </ActionButton>
                      }
                    />
                  )
                }
              />
            ) : pagedModels.length ? (
              <ListCardGrid
                aria-label={t("table.toolbarTitle", {
                  count: filteredModels.length,
                })}
              >
                {pagedModels.map((model) => (
                  <MetricListCard
                    key={model.id}
                    icon={isPrivateProvider(model.provider) ? "code" : "plug"}
                    title={model.modelName}
                    description={model.modelCode}
                    tone={MODEL_STATE_TONE[model.state]}
                    badges={
                      <>
                        {/* 厂商是类目（在线 / 私有部署），没有严重度——不给语气色。
                            原先的蓝/绿两档背景实测从未生效：那族 CSS 排在
                            `.vx-tenant-pill` 基类之前，同层同特异度被基类压死。 */}
                        <Badge variant="outline">
                          {providerLabel(model.provider)}
                        </Badge>
                        <StatusBadge tone={MODEL_STATE_TONE[model.state]}>
                          {t(`status.${model.state}`)}
                        </StatusBadge>
                      </>
                    }
                    metrics={[
                      {
                        key: "capabilities",
                        value: model.capabilities.length,
                        label: t("table.columns.capabilities"),
                      },
                      {
                        key: "provider",
                        value: isPrivateProvider(model.provider)
                          ? t("filters.private")
                          : t("filters.online"),
                        label: t("table.columns.provider"),
                      },
                      {
                        key: "protocol",
                        value: model.protocol,
                        label: t("dialogs.fields.protocol"),
                      },
                    ]}
                    footer={
                      <>
                        <span>
                          {model.capabilities.slice(0, 2).join(", ") || "-"}
                        </span>
                        <strong>{model.keyReference?.name || "-"}</strong>
                      </>
                    }
                  />
                ))}
              </ListCardGrid>
            ) : (
              <EmptyState
                title={loading ? t("empty.loadingTitle") : t("empty.title")}
                description={
                  loading
                    ? t("empty.loadingDescription")
                    : t("empty.description")
                }
                action={
                  <ActionButton
                    variant="outline"
                    icon="x"
                    onClick={handleReset}
                  >
                    {t("empty.resetFilters")}
                  </ActionButton>
                }
              />
            )}
          </section>
        }
        footer={
          <ListPagination
            currentPage={safeCurrentPage}
            pageCount={totalPages}
            // 这一页的计数语走 i18n（本页整体已接 useTranslations），
            // 不是 DS 那句固定中文。
            countLabel={t("pagination.summary", {
              page: safeCurrentPage,
              totalPages,
              total: filteredModels.length,
            })}
            pageSize={pageSize}
            onPageSizeChange={setPageSize}
            onPageChange={setCurrentPage}
          />
        }
      />

      <div className="grid min-w-0">
        <section
          className="flex min-w-0 items-center gap-md py-md max-xl:flex-wrap max-lg:items-stretch"
          aria-label="模型厂商管理"
        >
          <strong>模型厂商</strong>
          <span className="inline-flex min-h-control-lg items-center pl-xs text-body-md font-extrabold whitespace-nowrap text-foreground max-lg:mr-auto">
            {formatNumber(providers.length)}
          </span>
          <span className="flex-1 max-lg:hidden" aria-hidden="true" />
          {/* 只读：厂商的创建/编辑/启停/删除已迁至 opera 技术运维平台。 */}
        </section>
        <section
          className="grid min-w-0 max-w-full gap-xs"
          aria-label="模型厂商列表"
        >
          {providers.length ? (
            <ListCardGrid>
              {providers.map((provider) => (
                <MetricListCard
                  key={provider.id}
                  icon="settings"
                  title={provider.providerName}
                  description={provider.providerCode}
                  tone={activeTone(isEnabled(provider.state))}
                  badges={
                    <>
                      <Badge>{provider.providerType}</Badge>
                      <StatusBadge tone={activeTone(isEnabled(provider.state))}>
                        {isEnabled(provider.state)
                          ? t("status.active")
                          : t("status.inactive")}
                      </StatusBadge>
                    </>
                  }
                />
              ))}
            </ListCardGrid>
          ) : (
            <EmptyState
              title="暂无厂商"
              description="供应商的接入与管理已迁至 opera 技术运维平台。"
            />
          )}
        </section>
      </div>

      <div className="grid min-w-0">
        <section
          className="flex min-w-0 items-center gap-md py-md max-xl:flex-wrap max-lg:items-stretch"
          aria-label="计价规则管理"
        >
          <strong>计价规则</strong>
          <span className="inline-flex min-h-control-lg items-center pl-xs text-body-md font-extrabold whitespace-nowrap text-foreground max-lg:mr-auto">
            {formatNumber(priceRules.length)}
          </span>
          <span className="flex-1 max-lg:hidden" aria-hidden="true" />
          <ActionButton
            icon="plus"
            disabled={models.length === 0}
            onClick={openCreatePriceRuleDialog}
          >
            新建规则
          </ActionButton>
        </section>
        <section
          className="grid min-w-0 max-w-full gap-xs"
          aria-label="计价规则列表"
        >
          {priceRules.length ? (
            <ListCardGrid>
              {pagedPriceRules.map((rule) => {
                const ruleModel = modelById.get(rule.modelId);
                return (
                  <MetricListCard
                    key={rule.id}
                    icon="database"
                    title={ruleModel?.modelName ?? rule.modelId}
                    description={`${rule.billingMode} · ${rule.currency}`}
                    tone={activeTone(isEnabled(rule.state))}
                    onClick={() => openEditPriceRuleDialog(rule)}
                    actions={
                      <ActionMenu
                        label={`${ruleModel?.modelName ?? rule.modelId} 计价规则操作`}
                        items={[
                          {
                            id: "edit",
                            label: tShared("actions.edit"),
                            icon: "edit",
                            onSelect: () => openEditPriceRuleDialog(rule),
                          },
                          {
                            id: "enable",
                            label: tShared("actions.enable"),
                            icon: "play",
                            disabled: catalogBusy || isEnabled(rule.state),
                            onSelect: () => void togglePriceRule(rule, true),
                          },
                          {
                            id: "disable",
                            label: tShared("actions.disable"),
                            icon: "stop",
                            disabled: catalogBusy || !isEnabled(rule.state),
                            onSelect: () => void togglePriceRule(rule, false),
                          },
                        ]}
                      />
                    }
                    badges={
                      <>
                        <Badge>{rule.currency}</Badge>
                        <StatusBadge tone={activeTone(isEnabled(rule.state))}>
                          {isEnabled(rule.state)
                            ? t("status.active")
                            : t("status.inactive")}
                        </StatusBadge>
                      </>
                    }
                    metrics={[
                      {
                        key: "input",
                        value: trimUnitPrice(rule.inputUnitPrice),
                        label: "输入单价",
                      },
                      {
                        key: "output",
                        value: trimUnitPrice(rule.outputUnitPrice),
                        label: "输出单价",
                      },
                      {
                        key: "cached",
                        value: rule.cachedInputUnitPrice
                          ? trimUnitPrice(rule.cachedInputUnitPrice)
                          : "—",
                        label: "缓存输入单价",
                      },
                      {
                        key: "unit",
                        value: formatNumber(rule.unitTokens),
                        label: "计价单位",
                      },
                    ]}
                  />
                );
              })}
            </ListCardGrid>
          ) : (
            <EmptyState
              title="暂无计价规则"
              description="点击「新建规则」为模型配置计价。"
            />
          )}
        </section>
        {priceRules.length > 0 ? (
          <ListPagination
            currentPage={safePriceRulePage}
            pageCount={priceRulePageCount}
            countLabel={t("pagination.summary", {
              page: safePriceRulePage,
              totalPages: priceRulePageCount,
              total: priceRules.length,
            })}
            pageSize={priceRulePageSize}
            onPageSizeChange={(value) => {
              setPriceRulePageSize(value);
              setPriceRulePage(1);
            }}
            onPageChange={setPriceRulePage}
          />
        ) : null}
      </div>

      {/* ── 模型策略 ───────────────────────────────────────────────────────
          限流与并发的闸门。与上面的计价规则同页并排，是因为运营对一个模型要问的
          两件事就是「怎么收钱」和「怎么限流」；但两张表的可改性正好相反，所以
          对话框里各自把话说清楚。 */}
      <div className="grid min-w-0">
        <section
          className="flex min-w-0 items-center gap-md py-md max-xl:flex-wrap max-lg:items-stretch"
          aria-label="模型策略管理"
        >
          <strong>模型策略</strong>
          <span className="inline-flex min-h-control-lg items-center pl-xs text-body-md font-extrabold whitespace-nowrap text-foreground max-lg:mr-auto">
            {formatNumber(policies.length)}
          </span>
          <span className="flex-1 max-lg:hidden" aria-hidden="true" />
          <ActionButton
            icon="plus"
            disabled={models.length === 0}
            onClick={openCreatePolicyDialog}
          >
            新建策略
          </ActionButton>
        </section>
        <section
          className="grid min-w-0 max-w-full gap-xs"
          aria-label="模型策略列表"
        >
          {policies.length ? (
            <ListCardGrid>
              {pagedPolicies.map((policy) => {
                const policyModel = modelById.get(policy.modelId);
                const inForce = policyStanding.inForce.has(policy.id);
                const shadowed = policyStanding.shadowed.has(policy.id);
                const enforces = hasEnforcedLimit(policy);
                return (
                  <MetricListCard
                    key={policy.id}
                    icon="shield"
                    title={
                      policy.name || policyModel?.modelName || "未命名策略"
                    }
                    description={`${describePolicyScope(policy)} · ${policyModel?.modelName ?? "模型已删除"}`}
                    tone={activeTone(isEnabled(policy.state))}
                    onClick={() => openEditPolicyDialog(policy)}
                    actions={
                      <ActionMenu
                        label={`${policy.name || policyModel?.modelName || "策略"}操作`}
                        items={[
                          {
                            id: "edit",
                            label: tShared("actions.edit"),
                            icon: "edit",
                            onSelect: () => openEditPolicyDialog(policy),
                          },
                          {
                            id: "enable",
                            label: tShared("actions.enable"),
                            icon: "play",
                            disabled: catalogBusy || isEnabled(policy.state),
                            onSelect: () => void togglePolicy(policy, true),
                          },
                          {
                            id: "disable",
                            label: tShared("actions.disable"),
                            icon: "stop",
                            disabled: catalogBusy || !isEnabled(policy.state),
                            onSelect: () => void togglePolicy(policy, false),
                          },
                        ]}
                      />
                    }
                    badges={
                      <>
                        <Badge>
                          {policy.tenantId ? "租户专属" : "全局默认"}
                        </Badge>
                        <StatusBadge tone={activeTone(isEnabled(policy.state))}>
                          {isEnabled(policy.state)
                            ? t("status.active")
                            : t("status.inactive")}
                        </StatusBadge>
                        {/* 四个只在为真时出现的告警，每个都对应一种「看着配了、其实
                          没起作用」。它们是这张卡片存在的主要理由——光看一排数字，
                          这四种情况长得和一条正常生效的策略一模一样。
                          互斥地判：一条还没到生效窗口的策略谈不上被谁覆盖。 */}
                        {isEnabled(policy.state) && !inForce ? (
                          <StatusBadge
                            tone="warning"
                            title="状态是启用，但当前时刻不在它的生效窗口里（生效时间还没到，或者失效时间已过）。它现在不参与任何选择。"
                          >
                            未在生效窗口
                          </StatusBadge>
                        ) : null}
                        {inForce && shadowed ? (
                          <StatusBadge
                            tone="warning"
                            title="同一模型、同一作用域下另有一条策略排在前面（优先级更小，或同优先级但生效更晚）。Atlas 只选一条，这一条永远轮不到。"
                          >
                            被覆盖
                          </StatusBadge>
                        ) : null}
                        {inForce && !shadowed && !enforces ? (
                          <StatusBadge
                            tone="warning"
                            title="RPM 与最大并发都没设——这两项是 Atlas 运行时唯一真正会拦请求的。这条策略正在生效，但不限制任何调用。"
                          >
                            不限制任何调用
                          </StatusBadge>
                        ) : null}
                        {hasRecordedOnlyLimit(policy) ? (
                          <StatusBadge
                            tone="neutral"
                            title="TPM / TPD / 最大上下文 Atlas 已收下并存库，但运行时还没有读它们——不要把它们当成已经在拦的闸门。"
                          >
                            含未生效项
                          </StatusBadge>
                        ) : null}
                      </>
                    }
                    /* 只放 atlas 真的会读的两项 + 决定谁赢的那一项。未生效的三项
                       不混进来充数——那正是「含未生效项」徽标要说的事。 */
                    metrics={[
                      {
                        key: "rpm",
                        value:
                          policy.rateLimitRpm == null
                            ? "不限"
                            : formatNumber(policy.rateLimitRpm),
                        label: "RPM 上限",
                      },
                      {
                        key: "concurrent",
                        value:
                          policy.maxConcurrent == null
                            ? "不限"
                            : formatNumber(policy.maxConcurrent),
                        label: "最大并发",
                      },
                      {
                        key: "priority",
                        value: formatNumber(policy.priority),
                        label: "优先级（小者先）",
                      },
                      {
                        key: "expires",
                        value: policy.expiresAt ? "有" : tShared("common.none"),
                        label: "失效时间",
                      },
                    ]}
                  />
                );
              })}
            </ListCardGrid>
          ) : (
            <section className="vx-tenant-empty">
              <EmptyState
                title="暂无模型策略"
                description="没有策略＝不限流。点击「新建策略」为某个模型设置 RPM 与并发上限。"
              />
            </section>
          )}
        </section>
        {policies.length > 0 ? (
          <ListPagination
            currentPage={safePolicyPage}
            pageCount={policyPageCount}
            countLabel={t("pagination.summary", {
              page: safePolicyPage,
              totalPages: policyPageCount,
              total: policies.length,
            })}
            pageSize={policyPageSize}
            onPageSizeChange={(value) => {
              setPolicyPageSize(value);
              setPolicyPage(1);
            }}
            onPageChange={setPolicyPage}
          />
        ) : null}
      </div>

      {priceRuleDialog ? (
        <DialogForm
          open
          title={
            priceRuleDialog.mode === "create" ? "新建计价规则" : "编辑计价规则"
          }
          submitLabel={t("dialogs.actions.save")}
          cancelLabel={t("dialogs.actions.cancel")}
          submitting={catalogBusy}
          onOpenChange={(open) => {
            if (!open) setPriceRuleDialog(null);
          }}
          onSubmit={(event) => void submitPriceRule(event)}
        >
          {/* 载荷只发 expiresAt 是对的（atlas 逐个按名拒绝其余字段），但表单不能
              继续邀请那些它会丢掉的输入 —— 否则 400 只是换成了一句假的「已更新」。
              下面的追加式字段在编辑态一律禁用，与载荷保持同一句话。 */}
          {priceRuleDialog.mode === "edit" ? (
            <p className="text-body-sm text-muted-foreground">
              计价规则按追加版本化：价格与生效时间不可就地修改。要改价请新建一条规则，
              再把这一条的失效时间设过去。
            </p>
          ) : null}
          <div>
            <Label>
              模型
              <NativeSelect
                value={priceRuleForm.modelId}
                disabled={priceRuleDialog.mode === "edit"}
                onChange={(event) =>
                  setPriceRuleForm((old) => ({
                    ...old,
                    modelId: event.target.value,
                  }))
                }
              >
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.modelName}
                  </option>
                ))}
              </NativeSelect>
            </Label>
            <Label>
              计费模式
              <Input
                value={priceRuleForm.billingMode}
                disabled={priceRuleDialog.mode === "edit"}
                onChange={(event) =>
                  setPriceRuleForm((old) => ({
                    ...old,
                    billingMode: event.target.value,
                  }))
                }
                placeholder="token"
              />
            </Label>
            <Label>
              {tShared("columns.currency")}
              <Input
                value={priceRuleForm.currency}
                disabled={priceRuleDialog.mode === "edit"}
                onChange={(event) =>
                  setPriceRuleForm((old) => ({
                    ...old,
                    currency: event.target.value,
                  }))
                }
                placeholder="CNY"
              />
            </Label>
            <Label>
              计价单位（tokens）
              <Input
                type="number"
                min={1}
                value={priceRuleForm.unitTokens}
                disabled={priceRuleDialog.mode === "edit"}
                onChange={(event) =>
                  setPriceRuleForm((old) => ({
                    ...old,
                    unitTokens: event.target.value,
                  }))
                }
              />
            </Label>
          </div>
          <div>
            <Label>
              输入单价
              <Input
                value={priceRuleForm.inputUnitPrice}
                disabled={priceRuleDialog.mode === "edit"}
                onChange={(event) =>
                  setPriceRuleForm((old) => ({
                    ...old,
                    inputUnitPrice: event.target.value,
                  }))
                }
                placeholder="0"
              />
            </Label>
            <Label>
              输出单价
              <Input
                value={priceRuleForm.outputUnitPrice}
                disabled={priceRuleDialog.mode === "edit"}
                onChange={(event) =>
                  setPriceRuleForm((old) => ({
                    ...old,
                    outputUnitPrice: event.target.value,
                  }))
                }
                placeholder="0"
              />
            </Label>
            <Label>
              缓存输入单价
              <Input
                value={priceRuleForm.cachedInputUnitPrice}
                disabled={priceRuleDialog.mode === "edit"}
                onChange={(event) =>
                  setPriceRuleForm((old) => ({
                    ...old,
                    cachedInputUnitPrice: event.target.value,
                  }))
                }
                placeholder="留空 = 不声明"
              />
            </Label>
            <Label>
              请求单价
              <Input
                value={priceRuleForm.requestUnitPrice}
                disabled={priceRuleDialog.mode === "edit"}
                onChange={(event) =>
                  setPriceRuleForm((old) => ({
                    ...old,
                    requestUnitPrice: event.target.value,
                  }))
                }
                placeholder="0"
              />
            </Label>
          </div>
          <div>
            <Label>
              生效时间
              <Input
                type="datetime-local"
                value={priceRuleForm.effectiveAt}
                disabled={priceRuleDialog.mode === "edit"}
                onChange={(event) =>
                  setPriceRuleForm((old) => ({
                    ...old,
                    effectiveAt: event.target.value,
                  }))
                }
              />
            </Label>
            <Label>
              失效时间（可选）
              <Input
                type="datetime-local"
                value={priceRuleForm.expiresAt}
                onChange={(event) =>
                  setPriceRuleForm((old) => ({
                    ...old,
                    expiresAt: event.target.value,
                  }))
                }
              />
            </Label>
          </div>
        </DialogForm>
      ) : null}

      {policyDialog ? (
        <DialogForm
          open
          title={policyDialog.mode === "create" ? "新建策略" : "编辑策略"}
          submitLabel={t("dialogs.actions.save")}
          cancelLabel={t("dialogs.actions.cancel")}
          submitting={catalogBusy}
          onOpenChange={(open) => {
            if (!open) setPolicyDialog(null);
          }}
          onSubmit={(event) => void submitPolicy(event)}
        >
          {/* 两条必须在动手之前就知道的事，所以放在最上面而不是挂在字段旁边。
              第一条纠正一个非常自然的误解（「全局定个 RPM，租户策略只补并发」），
              第二条防止把五个输入框当成五道闸门。 */}
          <Banner
            tone="info"
            title="Atlas 对一个（模型，租户）只选一条策略，不合并"
            description="租户专属压全局默认；同作用域内优先级小的压大的，并列时生效更晚的压更早的。选中之后用的是那一条的全部字段——全局默认里的 RPM 不会借给一条只设了并发的租户策略。"
          />
          <Banner
            tone="warning"
            title="五项限额里，运行时目前只拦 RPM 与最大并发"
            description="TPM / TPD / 最大上下文 Atlas 会收下并存库，但请求路径上还没有读它们。现在填是为了不丢掉这个决定，不是因为它已经在拦。"
          />
          {policyDialog.mode === "edit" ? (
            <Banner
              tone="info"
              title="策略是就地修改的，与同页的计价规则相反"
              description="除作用域与生效时间外，其余每一项都可以直接改，改完立刻是新的限额。历史不在这张表里——要查某个时刻的限额是多少，去变更审计。"
            />
          ) : null}
          <div>
            <Label>
              模型
              <NativeSelect
                value={policyForm.modelId}
                /* atlas 的 update body 里没有 modelId：一条策略属于它被创建时
                   针对的那个模型。 */
                disabled={policyDialog.mode === "edit"}
                onChange={(event) =>
                  setPolicyForm((old) => ({
                    ...old,
                    modelId: event.target.value,
                  }))
                }
              >
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.modelName}
                  </option>
                ))}
              </NativeSelect>
            </Label>
            <Label>
              作用域
              {/* **下拉而不是 UUID 输入框**：选项上出的是租户可视码，送出去的才是
                  UUID（owner 2026-08-20：UUID 任何场景都不面向用户）。
                  编辑态锁死——atlas 对 update 里的 tenantId 是「出现即拒」。 */}
              <NativeSelect
                value={policyForm.tenantId}
                disabled={policyDialog.mode === "edit"}
                onChange={(event) =>
                  setPolicyForm((old) => ({
                    ...old,
                    tenantId: event.target.value,
                  }))
                }
              >
                <option value="">全局默认（所有租户）</option>
                {/* 当前值不在清单里也要显示，否则下拉会悄悄把作用域换成全局
                    ——那是替人改了一条限流规则。仍然不吐 UUID。 */}
                {policyForm.tenantId &&
                !tenantCodeById.has(policyForm.tenantId) ? (
                  <option value={policyForm.tenantId}>
                    租户专属（不在清单中）
                  </option>
                ) : null}
                {tenants.map((tenant) => (
                  <option key={tenant.id} value={tenant.id}>
                    {tenant.tenantCode} · {tenant.tenantName}
                  </option>
                ))}
              </NativeSelect>
            </Label>
          </div>
          <div>
            <Label>
              名称（可留空）
              <Input
                value={policyForm.name}
                onChange={(event) =>
                  setPolicyForm((old) => ({ ...old, name: event.target.value }))
                }
                placeholder="如 默认限流"
              />
            </Label>
            <Label>
              优先级（小者先）
              <Input
                type="number"
                min={0}
                value={policyForm.priority}
                onChange={(event) =>
                  setPolicyForm((old) => ({
                    ...old,
                    priority: event.target.value,
                  }))
                }
              />
            </Label>
          </div>
          <div>
            <Label>
              RPM 上限
              <Input
                inputMode="numeric"
                value={policyForm.rateLimitRpm}
                onChange={(event) =>
                  setPolicyForm((old) => ({
                    ...old,
                    rateLimitRpm: event.target.value,
                  }))
                }
                placeholder="留空 = 不限"
              />
            </Label>
            <Label>
              最大并发
              <Input
                inputMode="numeric"
                value={policyForm.maxConcurrent}
                onChange={(event) =>
                  setPolicyForm((old) => ({
                    ...old,
                    maxConcurrent: event.target.value,
                  }))
                }
                placeholder="留空 = 不限；0 = 全部拒绝"
              />
            </Label>
          </div>
          <div>
            <Label>
              TPM 上限（已登记未生效）
              <Input
                inputMode="numeric"
                value={policyForm.rateLimitTpm}
                onChange={(event) =>
                  setPolicyForm((old) => ({
                    ...old,
                    rateLimitTpm: event.target.value,
                  }))
                }
                placeholder="留空 = 不限"
              />
            </Label>
            <Label>
              TPD 上限（已登记未生效）
              <Input
                inputMode="numeric"
                value={policyForm.rateLimitTpd}
                onChange={(event) =>
                  setPolicyForm((old) => ({
                    ...old,
                    rateLimitTpd: event.target.value,
                  }))
                }
                placeholder="留空 = 不限"
              />
            </Label>
          </div>
          <div>
            <Label>
              最大上下文（已登记未生效）
              <Input
                inputMode="numeric"
                value={policyForm.maxContextTokens}
                onChange={(event) =>
                  setPolicyForm((old) => ({
                    ...old,
                    maxContextTokens: event.target.value,
                  }))
                }
                placeholder="留空 = 不限"
              />
            </Label>
            <Label>
              生效时间
              <Input
                type="datetime-local"
                value={policyForm.effectiveAt}
                /* 创建后固定。atlas 对 update 里的 effectiveAt 同样「出现即拒」，
                   要换一个窗口就新建一条。 */
                disabled={policyDialog.mode === "edit"}
                onChange={(event) =>
                  setPolicyForm((old) => ({
                    ...old,
                    effectiveAt: event.target.value,
                  }))
                }
              />
            </Label>
          </div>
          <Label>
            失效时间（可选）
            <Input
              type="datetime-local"
              value={policyForm.expiresAt}
              onChange={(event) =>
                setPolicyForm((old) => ({
                  ...old,
                  expiresAt: event.target.value,
                }))
              }
            />
          </Label>
        </DialogForm>
      ) : null}
    </>
  );
}
