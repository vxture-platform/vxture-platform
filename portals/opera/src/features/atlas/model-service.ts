/**
 * model-service.ts — 模型服务（Provider / Model）的共享领域层。
 * @package @vxture/opera
 * @layer Presentation
 * @category Features - Atlas
 *
 * 列表页（`/model/services`）与两张二级页（Provider 详情 / Model 详情）共用这一份：
 * 类型、值域、草稿↔记录的映射、三个开放映射与定价策略的解析、以及送给 atlas 的
 * `config` 组装。把它们收成一处，是因为「接入 Provider」「注册模型」从页首弹窗提成
 * 独立的二级页之后，三处会分别用到同一套解析与组装——复制一遍就会有第二份会漂移的
 * 真相，而其中 `buildProviderConfig` / `buildModelConfig` 的「出现即整体替换」那条铁律
 * 一旦两份不一致，失败方式是安静的（一次普通编辑把别人写进去的键抹掉，不报错）。
 *
 * 纯模块，无 JSX、无 React：呈现件（WireReport / ProbeInspection）与页面各自 import。
 */

import type { StatusBadgeTone } from "@vxture/design-system";
import { formatDateTime } from "@vxture-platform/shared";
import type { ModelState, ObjectState } from "@/features/atlas/state";
import { OperaApiError } from "@/lib/api";

/** 读模型服务要 `model:provider.manage`（Provider）/ `model:model.manage`（Model）。 */
export const PROVIDER_MANAGE = "model:provider.manage";
export const MODEL_MANAGE = "model:model.manage";

export type ProviderHealthStatus = "healthy" | "degraded" | "down" | "unknown";

export interface ModelProviderRecord {
  id: string;
  providerCode: string;
  providerType: string;
  providerName: string;
  description: string | null;
  homepageUrl: string | null;
  consoleUrl: string | null;
  billingUrl: string | null;
  /** 两值：`active` / `inactive`。Provider 没有第三档。 */
  state: ObjectState;
  health: { status: ProviderHealthStatus };
  /** 名下未删除的模型数（不论启停）——挡住删除的就是这个数。契约必有。 */
  modelCount: number;
  /** Provider 层的自由配置，含 `config.wire` 覆盖。线协议抽屉据它判断归属。 */
  config: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface AiModelRecord {
  id: string;
  providerId: string | null;
  modelCode: string;
  modelName: string;
  provider: string;
  endpointUrl: string;
  protocol: string;
  /** 由哪一层契约服务：chat / embedding / rerank / parse。**创建后不可改**。 */
  modelType: string;
  description: string | null;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  capabilities: string[];
  supportsStreaming: boolean;
  sort: number;
  /** 上游+wire 指纹。它一变，就是有人把这个 modelCode 指到了别的地方。 */
  behaviorVersion: string;
  /** 本模型声明的自由配置，含 `config.wire` 覆盖。**声明值，不是生效值**。 */
  config: Record<string, unknown> | null;
  /**
   * 实际生效的线协议描述符（atlas 直发，纯配置合并、不发上游请求）。
   *
   * 与 `config` 并列不是冗余：那一份说「本层声明了什么」，这一份说「实际跑什么」。
   * **不要在这里自己合并三层**——上游是逐键合并（headers 走 string-map 合并、
   * authStyle 遇非法值静默回退），重实现的失败方式是安静地渲染一个从未被用过的描述符。
   */
  resolvedWire: {
    schemaVersion: number;
    chatPath: string | null;
    authStyle: string;
    headers: Record<string, string>;
    streamUsage: string;
    supports: Record<string, boolean>;
    paramMap: Record<string, string>;
    /** 厂商私有开关（wire schema v2）。值是任意 JSON，不是 string-map。 */
    extraBody: Record<string, unknown>;
  };
  /**
   * `managed` = 引用密钥库（vault）别名，运行时唯一认的来源；`env` 是 ADR-003
   * 之前的遗留行——运行时已不读它，编辑时要引导改挂 vault。
   */
  keyReference: {
    source: "env" | "managed";
    name: string;
    configured: boolean;
  } | null;
  /**
   * **三值**：`active` / `inactive` / `deprecated`。`deprecated` 仍可解析、只是不再
   * 推荐——所以这一档**不能**用「启用/停用」那个布尔表达（product_251 B-3 原句）。
   * provider / 密钥是两值。
   */
  state: ModelState;
  /** 何时弃用的——运营要判断「还剩多久」，光知道「是否」不够。 */
  deprecatedAt: string | null;
  /** 引用它的未删除授权数（旧的租户轴，管理面在 admin）。挡删除。 */
  grantCount: number;
  /** 把它挂作 primary **或 fallback** 的未删除 endpoint 数。挡删除。 */
  endpointRefCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderKeyRecord {
  id: string;
  providerCode: string;
  keyAlias: string;
  keyScope: string;
  state: ObjectState;
  lastRotatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProtocolCatalogEntry {
  protocol: string;
  description: string;
  knownUpstreams: string[];
}

export interface ProbeCheck {
  mode: string;
  ok: boolean;
  latencyMs: number | null;
  /** 只在 `ok === true` 时是一次观测：Atlas 的 `failedCheck()` 在失败分支上把它
   *  写死为 false，所以失败的检查上它不携带任何关于上游的信息。 */
  usageReported: boolean;
  /** atlas v0.3.0 新增。有没有拿到可交付的内容（正文或工具调用，思维链不算）。 */
  contentReceived: boolean;
  totalTokens: number | null;
  error?: { code: string; message: string };
}

export interface ModelProbeBody {
  /**
   * 这一次自检的 atlas 请求 id。**排障的锚点**：带上它就能在 atlas 的 reqlog 里
   * 直接定位这一次真实调用，而不必靠时间戳去猜。此前门户的本地类型漏掉了它，于是
   * 一份本来就在响应里的、最有用的排障线索被整条丢掉——「完整错误反馈」缺的正是这个。
   */
  requestId: string;
  keyResolved: boolean;
  resolvedProtocol: string | null;
  adapter: string;
  endpointUrl: string;
  checks: ProbeCheck[];
}

export interface ProviderProbeResult {
  providerId: string;
  providerCode: string;
  probedModel: { id: string; modelCode: string };
  probe: ModelProbeBody;
  ok: boolean;
}

export interface ModelProbeResult extends ModelProbeBody {
  modelCode: string;
  provider: string;
  ok: boolean;
}

export const PROVIDER_TYPES = [
  { value: "online", label: "在线 API" },
  { value: "private", label: "私有部署" },
  { value: "custom", label: "自定义" },
];

/**
 * 模型由**哪一层契约**服务。四个值对应 atlas 上四个不同的 surface
 * （`/v1/chat` · `/v1/embed` · `/v1/rerank` · `/v1/parse`），**创建后不可改**——
 * atlas 的列锁不给 UPDATE，改它等于把模型挪到另一个面上而 modelCode 没变。
 *
 * 此前这一项根本不在表单里，注册载荷也不送，于是服务端一律默认 `chat`：
 * **经 opera 注册的模型只能是 chat**。而在产库里四类都真实存在（别的途径建的）。
 */
export const MODEL_TYPES = [
  { value: "chat", label: "对话（chat）", hint: "走 /v1/chat，支持流式" },
  {
    value: "embedding",
    label: "向量（embedding）",
    hint: "走 /v1/embed。runos 的能力发现向量与 reembed 依赖这一类",
  },
  { value: "rerank", label: "重排（rerank）", hint: "走 /v1/rerank" },
  {
    value: "parse",
    label: "解析（parse）",
    hint: "走 /v1/parse，文档版面解析",
  },
];

export const KEY_SCOPES = [
  { value: "shared", label: "共享（多租户复用同一把）" },
  { value: "dedicated", label: "专属（单租户/单场景独占）" },
];

export const CAPABILITY_OPTIONS = [
  "chat",
  "reasoning",
  "embedding",
  "vision",
  "image",
  "audio",
  "video",
  "tool_calling",
];

export const HEALTH_META: Record<
  ProviderHealthStatus,
  { label: string; tone: StatusBadgeTone }
> = {
  healthy: { label: "健康", tone: "success" },
  degraded: { label: "降级", tone: "warning" },
  down: { label: "故障", tone: "danger" },
  unknown: { label: "无数据", tone: "neutral" },
};

/**
 * 按值取健康度展示；认不出的值原样显示成中性徽标，缺失时才是「无数据」——
 * 把一个没见过的值渲染成「无数据」等于替上游编了一句话。
 */
export function healthMeta(status: string | undefined): {
  label: string;
  tone: StatusBadgeTone;
} {
  if (!status) return HEALTH_META.unknown;
  return (
    HEALTH_META[status as ProviderHealthStatus] ?? {
      label: status,
      tone: "neutral",
    }
  );
}

/**
 * Atlas 能力面健康快照（#562）。与上面 provider 行的「健康」（由真实流量派生）不同：
 * 这份是 `/capability/health` 的配置态——路由 configIssues、供应商余额、Atlas 组件，
 * 与实时流量无关。逐字抄自 atlas service/src/health，多出来的字段忽略。
 */
export interface ServiceHealthView {
  generatedAt: string;
  models: Array<{
    modelCode: string;
    providerCode: string;
    state: string;
    detail?: string;
  }>;
  routes: Array<{
    code: string;
    state: "ok" | "degraded" | "down";
    configIssues: Array<{
      role: string;
      modelCode: string;
      code: string;
      detail: string;
    }>;
  }>;
  vendors: Array<{
    providerCode: string;
    state: "ok" | "balance_low" | "not_supported" | "unknown";
    detail?: string;
    balance?: number;
  }>;
  atlas: Array<{ component: string; state: string; detail?: string }>;
}

export interface CapabilityHealthSummary {
  routesDown: string[];
  routesWithConfigIssues: string[];
  vendorsLow: Array<{ providerCode: string; outOfMoney: boolean }>;
  atlasNotOk: string[];
  hasCritical: boolean;
  total: number;
}

/** 把一份快照收敛成「有几件该管的事」。ok 的不计——只数 warning 及以上。 */
export function summarizeHealth(v: ServiceHealthView): CapabilityHealthSummary {
  const routesDown = v.routes
    .filter((r) => r.state === "down")
    .map((r) => r.code);
  const routesWithConfigIssues = v.routes
    .filter((r) => r.state !== "down" && r.configIssues.length > 0)
    .map((r) => r.code);
  const vendorsLow = v.vendors
    .filter((x) => x.state === "balance_low")
    .map((x) => ({
      providerCode: x.providerCode,
      outOfMoney: typeof x.balance === "number" && x.balance <= 0,
    }));
  const atlasNotOk = v.atlas
    .filter((c) => c.state !== "ok")
    .map((c) => c.component);
  const hasCritical =
    routesDown.length > 0 ||
    vendorsLow.some((x) => x.outOfMoney) ||
    v.atlas.some((c) => c.state === "down");
  const total =
    routesDown.length +
    routesWithConfigIssues.length +
    vendorsLow.length +
    atlasNotOk.length;
  return {
    routesDown,
    routesWithConfigIssues,
    vendorsLow,
    atlasNotOk,
    hasCritical,
    total,
  };
}

/** 与本仓其它页同一份写法（`RunosChangeTable` / 审计页）：解析失败就原样显示。 */
/* 收 `locale` 而不是写死 `"zh-CN"`：日期的字段顺序属于语言——
   中文 `2026/8/18 10:37`，英文 `8/18/2026, 10:37`。写死的后果不是「没翻译」，
   是英文用户会把 8/18 读成 18 月。（数字与百分比两种语言逐字相同，所以那些
   没跟着改，见 scripts/guardrails 旁的说明。） */
export function formatTime(iso: string, locale: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : formatDateTime(d, locale);
}

/**
 * 模型三态的呈现。**「已弃用」用 warning 而不是 neutral**：它仍在服务，
 * 用中性色会读成「已经关了、不用管」——而它恰恰是需要人去安排迁移的那一档。
 */
export const MODEL_STATE_META: Record<
  ModelState,
  { label: string; tone: StatusBadgeTone }
> = {
  active: { label: "启用", tone: "success" },
  inactive: { label: "停用", tone: "neutral" },
  deprecated: { label: "已弃用", tone: "warning" },
};

/** 按值取模型状态展示；认不出的值原样显示成中性徽标（同 `healthMeta`）。 */
export function modelStateMeta(state: string): {
  label: string;
  tone: StatusBadgeTone;
} {
  return (
    MODEL_STATE_META[state as ModelState] ?? { label: state, tone: "neutral" }
  );
}

/** 孤儿模型的分组键——不是一个真实 provider id，只用于把它们聚在一起显示。 */
export const ORPHAN = "__orphan__";

export interface ProviderDraft {
  providerCode: string;
  providerName: string;
  providerType: string;
  description: string;
  homepageUrl: string;
  consoleUrl: string;
  billingUrl: string;
  /* ── config.wire 的七个可写键 ───────────────────────────────────────────
   *
   * 这一层是「这家上游的线格式怪癖」：同一个 protocol 下各家仍有参数级差异，
   * 而那些差异**按设计就该是注册表数据、不是代码**（atlas 的判据一句话：线格式
   * 不同才写代码，参数不同一律写数据）。此前门户一个都填不了，于是这条判据对
   * opera 只成立了一半——接一家怪一点的上游，仍然要有人去改 atlas。
   *
   * 空串一律表示「不声明，继承协议默认」。**不是** false、不是 0：三层叠加是
   * 逐键合并的，一个没声明的键会让下一层的值透上来，而一个声明成 false 的键会
   * 把它压住。这两件事在界面上必须能分开说，所以布尔项用三态下拉而不是勾选框。
   */
  chatPath: string;
  authStyle: string;
  streamUsage: string;
  supportsTools: string;
  supportsToolChoice: string;
  supportsTopP: string;
  supportsTemperature: string;
  /** 三个开放映射的原始 JSON 文本。空串 = 不声明。 */
  headers: string;
  paramMap: string;
  extraBody: string;
  /** `config.pricing.offPeak` 的原始 JSON 文本。空串 = 不声明（＝全周期按峰价估）。 */
  offPeakPricing: string;
}

export const EMPTY_PROVIDER_DRAFT: ProviderDraft = {
  providerCode: "",
  providerName: "",
  providerType: "online",
  description: "",
  homepageUrl: "",
  consoleUrl: "",
  billingUrl: "",
  chatPath: "",
  authStyle: "",
  streamUsage: "",
  supportsTools: "",
  supportsToolChoice: "",
  supportsTopP: "",
  supportsTemperature: "",
  headers: "",
  paramMap: "",
  extraBody: "",
  offPeakPricing: "",
};

export function providerDraftFrom(row: ModelProviderRecord): ProviderDraft {
  /* 读的是**本层声明值**（`config.wire`），不是模型抽屉里那个 `resolvedWire`
     ——后者已经把协议默认合并进来了，拿它预填等于把默认值抄成这一家的声明，
     保存一次就真的变成声明，从此再也回不到「跟随默认」。 */
  const wire = readDeclaredWire(row.config);
  const supports = readWireSupports(wire);
  return {
    providerCode: row.providerCode,
    providerName: row.providerName,
    providerType: row.providerType,
    description: row.description ?? "",
    homepageUrl: row.homepageUrl ?? "",
    consoleUrl: row.consoleUrl ?? "",
    billingUrl: row.billingUrl ?? "",
    chatPath: typeof wire?.["chatPath"] === "string" ? wire["chatPath"] : "",
    authStyle: readWireAuthStyle(wire),
    streamUsage:
      typeof wire?.["streamUsage"] === "string" ? wire["streamUsage"] : "",
    supportsTools: supports.tools,
    supportsToolChoice: supports.toolChoice,
    supportsTopP: supports.topP,
    supportsTemperature: supports.temperature,
    headers: formatJsonForEdit(readWireRecord(wire, "headers")),
    paramMap: formatJsonForEdit(readWireRecord(wire, "paramMap")),
    extraBody: formatJsonForEdit(readWireRecord(wire, "extraBody")),
    offPeakPricing: formatJsonForEdit(readOffPeakPolicy(row.config)),
  };
}

/** `config.pricing.offPeak` 的声明值。与 wire 同层同性质：这是本层声明的，不是生效值。 */
function readOffPeakPolicy(
  config: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  const pricing = config?.["pricing"];
  if (
    typeof pricing !== "object" ||
    pricing === null ||
    Array.isArray(pricing)
  ) {
    return null;
  }
  const offPeak = (pricing as Record<string, unknown>)["offPeak"];
  if (
    typeof offPeak !== "object" ||
    offPeak === null ||
    Array.isArray(offPeak)
  ) {
    return null;
  }
  return offPeak as Record<string, unknown>;
}

/** 鉴权样式在 wire 里是嵌套的 `auth.style`，不是平铺的 `authStyle`。 */
function readWireAuthStyle(wire: Record<string, unknown> | null): string {
  const auth = wire?.["auth"];
  if (typeof auth !== "object" || auth === null || Array.isArray(auth)) {
    return "";
  }
  const style = (auth as Record<string, unknown>)["style"];
  return typeof style === "string" ? style : "";
}

/** 四个能力开关各自回填成 `""`（没声明）/ `"true"` / `"false"`。 */
function readWireSupports(wire: Record<string, unknown> | null): {
  tools: string;
  toolChoice: string;
  topP: string;
  temperature: string;
} {
  const raw = readWireRecord(wire, "supports");
  const read = (key: string): string =>
    typeof raw?.[key] === "boolean" ? String(raw[key]) : "";
  return {
    tools: read("tools"),
    toolChoice: read("toolChoice"),
    topP: read("topP"),
    temperature: read("temperature"),
  };
}

export interface ModelDraft {
  modelCode: string;
  modelName: string;
  providerId: string;
  endpointUrl: string;
  protocol: string;
  /** 创建后不可改，编辑态锁死且不进载荷。 */
  modelType: string;
  description: string;
  /** 原始输入，提交时才转数字——空串表示"不设"，与 0 不是一回事。 */
  contextWindow: string;
  maxOutputTokens: string;
  supportsStreaming: boolean;
  sort: string;
  capabilities: string[];
  /** 密钥库（vault）别名。空串 = 不引用。env 路径已随 ADR-003 退役，不再收。 */
  keyAlias: string;
  /**
   * `config.upstreamModel`：真实发给上游的 model 参数。空串 = 用编码本身。
   * 「同一模型多家供应」的场景全靠它：编码带供应方前缀保全局唯一，这里填上游认的名。
   */
  upstreamModel: string;
  /**
   * `config.wire.extraBody` 的原始 JSON 文本。空串 = 不声明。
   *
   * 存文本而不是对象，是为了让「填错了」这件事停在表单里：半截 JSON 也要能留在
   * 输入框里等人改完，转成对象的那一步放到提交前，失败就点名不提交。
   */
  extraBody: string;
}

/** 空串 → 不送这个键（让 atlas 用它自己的默认）；有值 → 必须是非负整数。 */
export function parseOptionalInt(raw: string): number | null | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  const n = Number(trimmed);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

export function emptyModelDraft(
  providerId: string,
  protocol: string,
): ModelDraft {
  return {
    modelCode: "",
    modelName: "",
    providerId,
    endpointUrl: "",
    protocol,
    modelType: "chat",
    description: "",
    contextWindow: "",
    maxOutputTokens: "",
    supportsStreaming: true,
    sort: "",
    capabilities: ["chat"],
    keyAlias: "",
    upstreamModel: "",
    extraBody: "",
  };
}

export function modelDraftFrom(row: AiModelRecord): ModelDraft {
  return {
    modelCode: row.modelCode,
    modelName: row.modelName,
    providerId: row.providerId ?? "",
    endpointUrl: row.endpointUrl,
    protocol: row.protocol,
    modelType: row.modelType,
    description: row.description ?? "",
    contextWindow: row.contextWindow == null ? "" : String(row.contextWindow),
    maxOutputTokens:
      row.maxOutputTokens == null ? "" : String(row.maxOutputTokens),
    supportsStreaming: row.supportsStreaming,
    sort: String(row.sort),
    capabilities: [...row.capabilities],
    /* env 来源的旧引用不预填：运行时已不读它，预填会让人以为它还生效。
       表单里对这种行单独给出改挂 vault 的提示。 */
    keyAlias:
      row.keyReference?.source === "managed" ? row.keyReference.name : "",
    upstreamModel:
      typeof row.config?.["upstreamModel"] === "string"
        ? row.config["upstreamModel"]
        : "",
    /* 回填的是**本模型声明的**那一份，不是 `resolvedWire.extraBody`：后者已经把
       协议默认与 Provider 那两层合并进来了，拿它预填等于把别人层里的开关抄进本层，
       保存一次就真的变成本模型的声明——一次编辑悄悄改变了继承关系。 */
    extraBody: formatJsonForEdit(
      readWireRecord(readDeclaredWire(row.config), "extraBody"),
    ),
  };
}

/**
 * atlas 自己管理、`extraBody` 覆盖它们没有正当用途的请求体键
 * （`vxture-atlas/service/src/providers/wire.ts` 的 `RESERVED_BODY_KEYS`）。
 *
 * 抄一份在这里不是重复校验：上游确实会拒（400），但那要等一次往返，而拒绝的理由
 * 「model 由适配器管理」在填表的当下最有用。尤其 `model`——把它写进 extraBody 会
 * 绕过 `upstreamModel`，让注册表里的模型名和真正发出去的不是同一个，而这件事
 * 不会报错。
 */
const RESERVED_BODY_KEYS = [
  "model",
  "messages",
  "stream",
  "stream_options",
  "system",
] as const;

/** 本层 `config.wire` 的声明值。不是 `resolvedWire`（那是三层合并后的）。 */
function readDeclaredWire(
  config: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  const wire = config?.["wire"];
  if (typeof wire !== "object" || wire === null || Array.isArray(wire)) {
    return null;
  }
  return wire as Record<string, unknown>;
}

/** `wire` 下某个对象键（headers / supports / paramMap / extraBody）。 */
function readWireRecord(
  wire: Record<string, unknown> | null,
  key: string,
): Record<string, unknown> | null {
  const value = wire?.[key];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

/** 回填进输入框的文本。空对象与"没声明"都回空串——两者对上游是同一件事。 */
function formatJsonForEdit(value: Record<string, unknown> | null): string {
  if (!value || Object.keys(value).length === 0) return "";
  return JSON.stringify(value, null, 2);
}

export type ExtraBodyParse =
  | { ok: true; value: Record<string, unknown> | null }
  | { ok: false; reason: string };

/**
 * 文本 → string map（`headers` / `paramMap`）。
 *
 * 与 `extraBody` 分开一个函数而不是加参数，是因为上游对这两类的判据本就不同：
 * 这两个键的**值必须是字符串**（`validateStringMap`），extraBody 的值是任意
 * JSON。合并成一个"通用 JSON 校验"就会把这条区别抹掉，于是一个
 * `headers: {"x-timeout": 30}` 要等到 400 才知道错在哪。
 */
export function parseStringMap(raw: string, label: string): ExtraBodyParse {
  const text = raw.trim();
  if (text === "") return { ok: true, value: null };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: `${label}不是合法的 JSON。` };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: `${label}要一个对象（\`{ ... }\`）。` };
  }

  const record = parsed as Record<string, unknown>;
  const nonString = Object.entries(record)
    .filter(([, value]) => typeof value !== "string")
    .map(([key]) => key);
  if (nonString.length > 0) {
    return {
      ok: false,
      reason: `${label}的值必须都是字符串，${nonString.join(" / ")} 不是——数字与布尔要写成带引号的字面量。`,
    };
  }

  return { ok: true, value: Object.keys(record).length > 0 ? record : null };
}

/**
 * 文本 → 对象。**三种失败各有各的说法**，不合并成一句"格式错误"：填错的人需要
 * 知道是语法坏了、还是形状不对、还是这个键根本轮不到他配。
 */
export function parseExtraBody(raw: string): ExtraBodyParse {
  const text = raw.trim();
  if (text === "") return { ok: true, value: null };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: "不是合法的 JSON。" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      ok: false,
      reason:
        "要一个对象（`{ ... }`），不是数组或标量——它是并进请求体的一组键。",
    };
  }

  const record = parsed as Record<string, unknown>;
  const reserved = RESERVED_BODY_KEYS.filter((key) => key in record);
  if (reserved.length > 0) {
    return {
      ok: false,
      reason: `${reserved.join(" / ")} 由适配器管理，不能在这里覆盖${
        reserved.includes("model")
          ? "——model 写在这里会绕过「上游模型名」，让注册表里的名字和真正发出去的不是同一个"
          : ""
      }。`,
    };
  }

  return { ok: true, value: Object.keys(record).length > 0 ? record : null };
}

/* ── config.pricing.offPeak · 低谷定价策略 ────────────────────────────────
 *
 * 在配上之前，atlas 的成本汇总把**所有**请求按峰价估。它不会把这个错数当精确值
 * 端出去（响应里有 `coverage.requestsWithoutPricingWindow` 说明有多少请求没有窗口），
 * 但配上之前那个数不适合拿来做成本决策——DeepSeek 官方口径是高峰 35 小时 / 168 小时，
 * **约 79% 的时段是半价**。
 *
 * 声明的是**高峰窗口**，低谷是它的补集——与供应商自己的表述一致，避免同一事实
 * 有第二个来源。
 *
 * 为什么在这里就校验，而不是等 atlas 的 400：与上面三个开放映射同一条理由——
 * 上游确实也会拒（`OBSERVABILITY_INVALID_PRICING_POLICY`），但要等一次往返，
 * 而各类失败的说法各不相同，在填表的当下最有用。timezone 尤其：写别的时区而按
 * UTC 求值会折错 8 小时，**而算出来的数完全像真的**。
 *
 * 一个要写下来的后果：这一份是**回存路径也走的**——编辑一个已有策略的 provider
 * 时，库里那份会被读回输入框、保存时再过一遍这里。所以一份 atlas 存下了、却不合
 * 本校验的策略，会挡住这个 provider 的其它编辑。这是有意的：本校验逐条对着 atlas
 * 自己的规则写，能被它接受的都能过；过不了就说明库里那份本身有问题，那时候把它
 * 拦下来并指名哪一条不合，比让人改个名字顺手把一份坏策略又存回去要好。
 *
 * 未知键原样保留（只校验规定的四条），所以 atlas 后续加可选键不会被这里挡掉。
 */
const OFF_PEAK_APPLIES_TO = [
  "input",
  "cachedInput",
  "output",
  "request",
] as const;

/** DeepSeek 的现行策略，可直接用（取自 api-docs.deepseek.com/quick_start/pricing）。 */
export const DEEPSEEK_OFF_PEAK_PRESET = JSON.stringify(
  {
    timezone: "UTC",
    multiplier: "0.50000000",
    appliesTo: ["input", "cachedInput", "output", "request"],
    peakWindows: [
      { days: [1, 2, 3, 4, 5], fromHour: 1, toHour: 4 },
      { days: [1, 2, 3, 4, 5], fromHour: 6, toHour: 10 },
    ],
  },
  null,
  2,
);

export function parseOffPeakPolicy(raw: string): ExtraBodyParse {
  const text = raw.trim();
  if (text === "") return { ok: true, value: null };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: "低谷定价不是合法的 JSON。" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      ok: false,
      reason: "低谷定价要一个对象（`{ ... }`），不是数组或标量。",
    };
  }
  const policy = parsed as Record<string, unknown>;

  /* 分桶在 UTC 做。这一条不是挑剔——写别的时区而按 UTC 求值会折错 8 小时。 */
  if (policy["timezone"] !== "UTC") {
    return {
      ok: false,
      reason:
        '`timezone` 只能是 "UTC"——分桶在 UTC 做，写别的时区会静默折错几小时。',
    };
  }

  /* 金额不走 float，所以是十进制字符串而不是数字。 */
  const multiplier = policy["multiplier"];
  if (
    typeof multiplier !== "string" ||
    !/^\d+(\.\d{1,8})?$/u.test(multiplier)
  ) {
    return {
      ok: false,
      reason:
        'multiplier 要一个十进制字符串（不是数值）、最多 8 位小数，如 "0.50000000"——金额不走 float。',
    };
  }

  /* 空不等于「全部」，那是猜。 */
  const appliesTo = policy["appliesTo"];
  if (!Array.isArray(appliesTo) || appliesTo.length === 0) {
    return {
      ok: false,
      reason: `\`appliesTo\` 不能为空——空不当成「全部」。取值：${OFF_PEAK_APPLIES_TO.join(" / ")}。`,
    };
  }
  const badApplies = appliesTo.filter(
    (v) => typeof v !== "string" || !OFF_PEAK_APPLIES_TO.includes(v as never),
  );
  if (badApplies.length > 0) {
    return {
      ok: false,
      reason: `\`appliesTo\` 里 ${badApplies.join(" / ")} 不是可用取值（${OFF_PEAK_APPLIES_TO.join(" / ")}）。`,
    };
  }

  /* 空等于「没有高峰」，会凭空把整张账砍半。 */
  const windows = policy["peakWindows"];
  if (!Array.isArray(windows) || windows.length === 0) {
    return {
      ok: false,
      reason:
        "`peakWindows` 不能为空——声明的是高峰窗口，空等于「没有高峰」，会把整张账凭空砍半。",
    };
  }
  for (const [index, entry] of windows.entries()) {
    const at = `第 ${index + 1} 个 peakWindow`;
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return { ok: false, reason: `${at}要一个对象。` };
    }
    const win = entry as Record<string, unknown>;
    const days = win["days"];
    if (
      !Array.isArray(days) ||
      days.length === 0 ||
      days.some(
        (d) => !Number.isInteger(d) || (d as number) < 1 || (d as number) > 7,
      )
    ) {
      return {
        ok: false,
        reason: `${at}的 \`days\` 要非空、且都是 ISO 星期 1–7（1 = 周一）。`,
      };
    }
    const from = win["fromHour"];
    const to = win["toHour"];
    if (!Number.isInteger(from) || !Number.isInteger(to)) {
      return {
        ok: false,
        reason: `${at}的 \`fromHour\` / \`toHour\` 要整数。`,
      };
    }
    if (
      !(
        (from as number) >= 0 &&
        (from as number) < (to as number) &&
        (to as number) <= 24
      )
    ) {
      return {
        ok: false,
        reason: `${at}要满足 \`0 ≤ fromHour < toHour ≤ 24\`（左闭右开），现在是 ${String(from)} → ${String(to)}。`,
      };
    }
  }

  return { ok: true, value: policy };
}

/** 表单直接拥有的那些 wire 键。重建时先删掉它们，不认识的键原样留着。 */
const PROVIDER_WIRE_KEYS = [
  "chatPath",
  "auth",
  "streamUsage",
  "supports",
  "headers",
  "paramMap",
  "extraBody",
] as const;

/**
 * 组装送给 atlas 的 Provider `config`。
 *
 * 与模型那边同一条铁律：atlas 的 update 只要载荷里出现 `config` 就**整体替换**，
 * 不与库里旧值合并。所以既有 config 必须原样带回去——这里 `{...existing}` 打头
 * 就是为了这个。此前这个表单一次都没送过 config，所以这条铁律还没有咬到它；
 * 从这一版开始它会送，于是它开始适用。
 *
 * 把读回来的值再写回去在这里是无损的，依据是 DDL 自己写的那句：
 * `model_providers.config` 是「non-sensitive connection metadata; keys never
 * live here」。密钥住在 provider-keys 密钥库里，不在这一列——所以 atlas 读时
 * 剥掉密钥类键这件事，对这一列没有可剥的东西。
 *
 * `wire` 内部同理但更细一层：表单只拥有 `PROVIDER_WIRE_KEYS` 这七个，先删这七个
 * 再按表单重建，**其余键原样保留**。atlas 写入侧对未知键是拒绝，所以库里理论上
 * 不会有第八个键；但"理论上不会有"和"有了就被这个表单悄悄删掉"是两回事，而后者
 * 不报错——一次普通的改名字保存就能抹掉一条别人用 API 写进去的新键。
 *
 * `schemaVersion` 跟着非空的 wire 一起写（取自协议词表信封里上游自报的数）：
 * 只认识旧 schema 的服务读到新键会静默忽略，版本号是让那件事出声的唯一防线。
 */
export function buildProviderConfig(
  existing: Record<string, unknown> | null,
  draft: ProviderDraft,
  parsed: {
    headers: Record<string, unknown> | null;
    paramMap: Record<string, unknown> | null;
    extraBody: Record<string, unknown> | null;
    offPeak: Record<string, unknown> | null;
  },
  wireSchemaVersion: number | null,
): Record<string, unknown> | null {
  const next: Record<string, unknown> = { ...(existing ?? {}) };
  const existingWire = readDeclaredWire(next);
  const wire: Record<string, unknown> = { ...(existingWire ?? {}) };
  for (const key of PROVIDER_WIRE_KEYS) delete wire[key];

  if (draft.chatPath.trim()) wire["chatPath"] = draft.chatPath.trim();
  if (draft.authStyle) wire["auth"] = { style: draft.authStyle };
  if (draft.streamUsage) wire["streamUsage"] = draft.streamUsage;

  /* 三态：`""` 不进对象（继承），`"true"`/`"false"` 才落一个布尔。 */
  const supports: Record<string, boolean> = {};
  const declare = (key: string, value: string) => {
    if (value === "true" || value === "false") supports[key] = value === "true";
  };
  declare("tools", draft.supportsTools);
  declare("toolChoice", draft.supportsToolChoice);
  declare("topP", draft.supportsTopP);
  declare("temperature", draft.supportsTemperature);
  if (Object.keys(supports).length > 0) wire["supports"] = supports;

  if (parsed.headers) wire["headers"] = parsed.headers;
  if (parsed.paramMap) wire["paramMap"] = parsed.paramMap;
  if (parsed.extraBody) wire["extraBody"] = parsed.extraBody;

  /* 只剩 schemaVersion 的 wire 是一句没有内容的话，当空处理。 */
  const declaredKeys = Object.keys(wire).filter((k) => k !== "schemaVersion");
  if (declaredKeys.length > 0) {
    if (wireSchemaVersion !== null) wire["schemaVersion"] = wireSchemaVersion;
    next["wire"] = wire;
  } else {
    delete next["wire"];
  }

  /* `pricing` 与 `wire` 同性质：表单只拥有 `offPeak` 这一个键，其余原样保留。
     清空输入框＝撤下策略（该 provider 回到全周期按峰价估），所以是 delete 而不是
     留一个空对象——留空对象等于声明了一条什么都不打折的策略，两者在成本汇总里
     不是一回事：后者不会计入 `requestsWithoutPricingWindow`。 */
  const existingPricing = next["pricing"];
  const pricing: Record<string, unknown> =
    typeof existingPricing === "object" &&
    existingPricing !== null &&
    !Array.isArray(existingPricing)
      ? { ...(existingPricing as Record<string, unknown>) }
      : {};
  if (parsed.offPeak) {
    pricing["offPeak"] = parsed.offPeak;
  } else {
    delete pricing["offPeak"];
  }
  if (Object.keys(pricing).length > 0) {
    next["pricing"] = pricing;
  } else {
    delete next["pricing"];
  }

  return Object.keys(next).length > 0 ? next : null;
}

/**
 * 组装送给 atlas 的 `config`。
 *
 * atlas 的 update 只要载荷里出现 `keyReference` 或 `config`，就会**整体替换**
 * 存量 config（`mergeModelConfig` 不与库里旧值合并）——而本表单每次保存都送
 * keyReference。不把既有 config 一并送回去，一次普通编辑就会把 `config.wire`
 * 覆盖与 `upstreamModel` 悄悄抹平。读回的 config 已被 atlas 剥掉密钥类键
 * （managedKeyAlias 由它按 keyReference 自己并回去），round-trip 无损。
 *
 * 同一条道理往下一层：`wire` 里除 `extraBody` 之外的键（chatPath / headers /
 * supports / paramMap…）本表单一个都不管，但它们和 extraBody 住在同一个对象里，
 * 所以这里逐键重建 `wire` 而不是整体覆盖。
 *
 * 写 extraBody 时把 `schemaVersion` 一并声明进去（取自协议词表信封里上游自报的
 * 那个数）。理由在 atlas 的 wire.ts 头注上：一个只认识 v1 的旧服务读到带
 * `extraBody` 的行会忽略它，版本号是让这件事出声的唯一防线——不声明就得到一个
 * 配了却静默不生效的开关。词表没取到（`null`）时不声明：宁可少一句话，也不写
 * 一个我们并没有观测到的版本号。
 */
export function buildModelConfig(
  existing: Record<string, unknown> | null,
  upstreamModel: string,
  extraBody: Record<string, unknown> | null,
  wireSchemaVersion: number | null,
): Record<string, unknown> | null {
  const next: Record<string, unknown> = { ...(existing ?? {}) };
  delete next["upstreamModel"];
  const trimmed = upstreamModel.trim();
  if (trimmed) next["upstreamModel"] = trimmed;

  const existingWire = next["wire"];
  const wire: Record<string, unknown> =
    typeof existingWire === "object" &&
    existingWire !== null &&
    !Array.isArray(existingWire)
      ? { ...(existingWire as Record<string, unknown>) }
      : {};
  delete wire["extraBody"];
  if (extraBody) {
    wire["extraBody"] = extraBody;
    if (wireSchemaVersion !== null) wire["schemaVersion"] = wireSchemaVersion;
  }

  if (Object.keys(wire).length > 0) next["wire"] = wire;
  else delete next["wire"];

  return Object.keys(next).length > 0 ? next : null;
}

export function describeError(error: unknown): { description?: string } {
  return error instanceof OperaApiError && error.message
    ? { description: error.message }
    : {};
}

export type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready" };
