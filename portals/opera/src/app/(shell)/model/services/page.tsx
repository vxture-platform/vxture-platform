"use client";

/* 模型服务 — Provider 与 Model 合并成一张两层表（owner 2026-08-14 定）。
 *
 * ── 为什么合并 ────────────────────────────────────────────────────────────
 *
 * 这两个对象是**一对多的归属关系**，之前拆成两页，于是最要紧的那件事——"这个模型
 * 挂在哪家、这家底下有哪些模型"——在任何一页上都看不全：Provider 页只有一个数字，
 * Model 页只有一列供应商名。要对上得来回切页，再靠脑子拼。
 *
 * 现在一级行是 Provider（核心信息 + 模型数），展开是它名下的模型二级表。三种状态
 * 各答一个问题：全部收起 = 有哪些供应商、各带多少模型；单个展开 = 这家和它的模型
 * 挨着看；全部展开 = 整个归属关系一屏铺开。
 *
 * 两个"新建"也并到页首一起放。此前注册模型要先切到另一页，而注册模型这件事几乎
 * 总是紧跟在看完某家 Provider 之后发生。
 *
 * ── 一条不能省的诚实 ──────────────────────────────────────────────────────
 *
 * **孤儿模型单独成组显示，不藏。** `providerId` 为空、或指向一个不在列表里的
 * provider 的模型，按归属关系是无处可挂的。挂到任意一家名下是编，直接不显示则是
 * 让它们从此消失——而它们恰恰是最需要被看见的：一个解析不到 provider 的模型无法
 * 服务任何调用（Atlas 的数据面同样按"模型和它的 provider 都启用"判定）。
 *
 * ── 保留的两页原有能力 ────────────────────────────────────────────────────
 *
 * Provider：CRUD、启停、密钥抽屉（vault，写操作挂 step-up）、验证接入（真实调用）。
 * Model：CRUD、启停、自检（真实调用、烧 token）、依赖计数（挡删除的那两个数）。
 * 删除前置条件、协议词表、上游落后时的降级，全部照旧，见 features/atlas/lifecycle。 */

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import {
  ActionMenu,
  Badge,
  Banner,
  Button,
  DataTable,
  DialogForm,
  Drawer,
  EmptyState,
  Field,
  FieldDescription,
  FieldGroup,
  FieldTier,
  FieldLabel,
  FilterBar,
  Icon,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  ListPageTemplate,
  NativeSelect,
  StatusBadge,
  TableTitleCell,
  Textarea,
  ViewHeader,
  useListPagination,
  useToast,
  type StatusBadgeTone,
} from "@vxture/design-system";
import { ListPagination } from "@/modules/shared/ListPagination";
import { useOperatorSession } from "@/features/session/SessionProvider";
import { useConfirmLabels } from "@/lib/destructive";
import { isStepUpCancelled, useStepUp } from "@/features/stepup/StepUpProvider";
import { deleteFailureToast } from "@/features/atlas/lifecycle";
import {
  isEnabled,
  isServing,
  type ModelState,
  type ObjectState,
} from "@/features/atlas/state";
import { api, OperaApiError } from "@/lib/api";

const PROVIDER_MANAGE = "model:provider.manage";
const MODEL_MANAGE = "model:model.manage";

type ProviderHealthStatus = "healthy" | "degraded" | "down" | "unknown";

interface ModelProviderRecord {
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

interface AiModelRecord {
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

interface ProviderKeyRecord {
  id: string;
  providerCode: string;
  keyAlias: string;
  keyScope: string;
  state: ObjectState;
  lastRotatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ProtocolCatalogEntry {
  protocol: string;
  description: string;
  knownUpstreams: string[];
}

interface ProbeCheck {
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

interface ModelProbeBody {
  keyResolved: boolean;
  resolvedProtocol: string | null;
  adapter: string;
  endpointUrl: string;
  checks: ProbeCheck[];
}

interface ProviderProbeResult {
  providerId: string;
  providerCode: string;
  probedModel: { id: string; modelCode: string };
  probe: ModelProbeBody;
  ok: boolean;
}

interface ModelProbeResult extends ModelProbeBody {
  modelCode: string;
  provider: string;
  ok: boolean;
}

const PROVIDER_TYPES = [
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
const MODEL_TYPES = [
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

const KEY_SCOPES = [
  { value: "shared", label: "共享（多租户复用同一把）" },
  { value: "dedicated", label: "专属（单租户/单场景独占）" },
];

const CAPABILITY_OPTIONS = [
  "chat",
  "reasoning",
  "embedding",
  "vision",
  "image",
  "audio",
  "video",
  "tool_calling",
];

const HEALTH_META: Record<
  ProviderHealthStatus,
  { label: string; tone: StatusBadgeTone }
> = {
  healthy: { label: "健康", tone: "success" },
  degraded: { label: "降级", tone: "warning" },
  down: { label: "故障", tone: "danger" },
  unknown: { label: "无数据", tone: "neutral" },
};

/** 与本仓其它页同一份写法（`RunosChangeTable` / 审计页）：解析失败就原样显示。 */
/* 收 `locale` 而不是写死 `"zh-CN"`：日期的字段顺序属于语言——
   中文 `2026/8/18 10:37`，英文 `8/18/2026, 10:37`。写死的后果不是「没翻译」，
   是英文用户会把 8/18 读成 18 月。（数字与百分比两种语言逐字相同，所以那些
   没跟着改，见 scripts/guardrails 旁的说明。） */
function formatTime(iso: string, locale: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString(locale, { hour12: false });
}

/**
 * 模型三态的呈现。**「已弃用」用 warning 而不是 neutral**：它仍在服务，
 * 用中性色会读成「已经关了、不用管」——而它恰恰是需要人去安排迁移的那一档。
 */
const MODEL_STATE_META: Record<
  ModelState,
  { label: string; tone: StatusBadgeTone }
> = {
  active: { label: "启用", tone: "success" },
  inactive: { label: "停用", tone: "neutral" },
  deprecated: { label: "已弃用", tone: "warning" },
};

/** 孤儿模型的分组键——不是一个真实 provider id，只用于把它们聚在一起显示。 */
const ORPHAN = "__orphan__";

interface ProviderDraft {
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

const EMPTY_PROVIDER_DRAFT: ProviderDraft = {
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

function providerDraftFrom(row: ModelProviderRecord): ProviderDraft {
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

interface ModelDraft {
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
function parseOptionalInt(raw: string): number | null | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  const n = Number(trimmed);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function emptyModelDraft(providerId: string, protocol: string): ModelDraft {
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

function modelDraftFrom(row: AiModelRecord): ModelDraft {
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

/**
 * 文本 → string map（`headers` / `paramMap`）。
 *
 * 与 `extraBody` 分开一个函数而不是加参数，是因为上游对这两类的判据本就不同：
 * 这两个键的**值必须是字符串**（`validateStringMap`），extraBody 的值是任意
 * JSON。合并成一个"通用 JSON 校验"就会把这条区别抹掉，于是一个
 * `headers: {"x-timeout": 30}` 要等到 400 才知道错在哪。
 */
function parseStringMap(raw: string, label: string): ExtraBodyParse {
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

type ExtraBodyParse =
  | { ok: true; value: Record<string, unknown> | null }
  | { ok: false; reason: string };

/**
 * 文本 → 对象。**三种失败各有各的说法**，不合并成一句"格式错误"：填错的人需要
 * 知道是语法坏了、还是形状不对、还是这个键根本轮不到他配。
 */
function parseExtraBody(raw: string): ExtraBodyParse {
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
const DEEPSEEK_OFF_PEAK_PRESET = JSON.stringify(
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

function parseOffPeakPolicy(raw: string): ExtraBodyParse {
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
        '`multiplier` 要一个十进制**字符串**、最多 8 位小数（如 "0.50000000"）——金额不走 float。',
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
function buildProviderConfig(
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
function buildModelConfig(
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

function describeError(error: unknown): { description?: string } {
  return error instanceof OperaApiError && error.message
    ? { description: error.message }
    : {};
}

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready" };

/* 没有 `delete` 档：删除的确认由 DS 的 `ConfirmDestructive` 接管（菜单项的
   `confirm`），落锤直接走 `deleteProvider`。留一个只用来开确认框的 dialog 档，
   等于把同一件事记在两个地方。 */
type ProviderDialog =
  | { kind: "create" }
  | { kind: "edit"; row: ModelProviderRecord }
  | null;

type ModelDialog =
  | { kind: "create" }
  | { kind: "edit"; row: AiModelRecord }
  | null;

/** `useSearchParams` 需要 Suspense 边界。 */
export default function ModelServicePage() {
  return (
    <Suspense fallback={null}>
      <ModelServiceContent />
    </Suspense>
  );
}

function ModelServiceContent() {
  const locale = useLocale();
  const tShared = useTranslations();
  const withLabels = useConfirmLabels();
  const { toast } = useToast();
  const { can } = useOperatorSession();
  const { runWithStepUp } = useStepUp();
  const canManageProviders = can(PROVIDER_MANAGE);
  const canManageModels = can(MODEL_MANAGE);

  /* 旧的 /atlas/models?providerId= 深链跳过来时带的展开目标。 */
  const expandParam = useSearchParams().get("providerId") ?? "";

  const [providers, setProviders] = useState<ModelProviderRecord[]>([]);
  const [models, setModels] = useState<AiModelRecord[]>([]);
  const [protocols, setProtocols] = useState<ProtocolCatalogEntry[]>([]);
  /* 上游自己声明它读得懂的 wire schema 版本。`null` = 词表没取到，此时不臆造一个
     版本号写进注册表——宁可不声明，也不声明一个我们并没有观测到的数字。 */
  const [wireSchemaVersion, setWireSchemaVersion] = useState<number | null>(
    null,
  );
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "active" | "inactive"
  >("all");
  const [expandedKeys, setExpandedKeys] = useState<readonly string[]>(
    expandParam ? [expandParam] : [],
  );
  const [submitting, setSubmitting] = useState(false);

  const [providerDialog, setProviderDialog] = useState<ProviderDialog>(null);
  const [providerDraft, setProviderDraft] =
    useState<ProviderDraft>(EMPTY_PROVIDER_DRAFT);
  const [modelDialog, setModelDialog] = useState<ModelDialog>(null);
  const [modelDraft, setModelDraft] = useState<ModelDraft>(
    emptyModelDraft("", "openai-compatible"),
  );
  /**
   * 模型表单里的密钥候选：所选 Provider 的 vault 别名清单。
   * `"unavailable"` = 读取失败（多半是没有 model:provider.manage）——降级为手填别名，
   * 别名照样以 `managed` 形态提交，不因为列不出来就退回已退役的 env 路径。
   */
  const [aliasOptions, setAliasOptions] = useState<
    ProviderKeyRecord[] | "unavailable" | null
  >(null);

  /* 密钥抽屉 */
  const [keysProvider, setKeysProvider] = useState<ModelProviderRecord | null>(
    null,
  );
  const [keys, setKeys] = useState<ProviderKeyRecord[]>([]);
  const [keysLoad, setKeysLoad] = useState<LoadState>({ kind: "ready" });
  const [keyDialog, setKeyDialog] = useState<
    { kind: "create" } | { kind: "rotate"; key: ProviderKeyRecord } | null
  >(null);
  const [keyAlias, setKeyAlias] = useState("");
  const [keyScope, setKeyScope] = useState("shared");
  const [plaintextKey, setPlaintextKey] = useState("");

  /* 探测：provider 级与 model 级各一套确认框 + 结果框 */
  const [verifyTarget, setVerifyTarget] = useState<ModelProviderRecord | null>(
    null,
  );
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<ProviderProbeResult | null>(
    null,
  );
  const [wireTarget, setWireTarget] = useState<AiModelRecord | null>(null);
  const [probeTarget, setProbeTarget] = useState<AiModelRecord | null>(null);
  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<ModelProbeResult | null>(null);

  const reload = useCallback(async () => {
    setLoad({ kind: "loading" });
    try {
      const [providerRows, modelRows] = await Promise.all([
        api.get<ModelProviderRecord[]>(
          "/api/atlas/providers?includeInactive=true",
        ),
        api.get<AiModelRecord[]>("/api/atlas/models?includeInactive=true"),
      ]);
      setProviders(providerRows);
      setModels(modelRows);
      setLoad({ kind: "ready" });
    } catch (error) {
      setLoad({
        kind: "error",
        message:
          error instanceof OperaApiError ? error.message : "读取模型服务失败",
      });
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  /* 协议词表单独取、失败不挡页面：它只喂一个下拉。
     信封里的 `wireSchemaVersion` 一并留下：写 `config.wire` 时要把它声明进去，
     见 `buildModelConfig` 头注——那是「配了却静默不生效」的唯一防线。 */
  useEffect(() => {
    void api
      .get<{
        wireSchemaVersion: number;
        protocols: ProtocolCatalogEntry[];
      }>("/api/atlas/protocols")
      .then((r) => {
        setProtocols(r.protocols);
        setWireSchemaVersion(r.wireSchemaVersion);
      })
      .catch(() => setProtocols([]));
  }, []);

  const providerById = useMemo(
    () => new Map(providers.map((p) => [p.id, p])),
    [providers],
  );

  /* 模型表单开着时，跟着所选 Provider 拉它的 vault 别名清单喂密钥下拉。 */
  const modelFormOpen =
    modelDialog?.kind === "create" || modelDialog?.kind === "edit";
  const draftProviderCode =
    providerById.get(modelDraft.providerId)?.providerCode ?? "";
  useEffect(() => {
    if (!modelFormOpen || draftProviderCode === "") {
      setAliasOptions(null);
      return;
    }
    let cancelled = false;
    setAliasOptions(null);
    void api
      .get<ProviderKeyRecord[]>(
        `/api/atlas/provider-keys?providerCode=${encodeURIComponent(draftProviderCode)}`,
      )
      .then((rows) => {
        if (!cancelled) setAliasOptions(rows);
      })
      .catch(() => {
        if (!cancelled) setAliasOptions("unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [modelFormOpen, draftProviderCode]);

  /** providerId → 它名下的模型。归属在这里算一次，两层都用这一份。 */
  const modelsByProvider = useMemo(() => {
    const map = new Map<string, AiModelRecord[]>();
    for (const m of models) {
      const key =
        m.providerId && providerById.has(m.providerId) ? m.providerId : ORPHAN;
      map.set(key, [...(map.get(key) ?? []), m]);
    }
    return map;
  }, [models, providerById]);

  const orphanModels = modelsByProvider.get(ORPHAN) ?? [];

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return providers.filter((p) => {
      if (
        statusFilter !== "all" &&
        (statusFilter === "active" ? !isEnabled(p.state) : isEnabled(p.state))
      ) {
        return false;
      }
      if (kw === "") return true;
      /* 关键词同时搜两层：搜一个模型编码应该把它所属的 provider 行留下来，
         否则"这个模型挂在哪家"这个最常见的问题，在合并页上反而答不了。 */
      return (
        p.providerName.toLowerCase().includes(kw) ||
        p.providerCode.toLowerCase().includes(kw) ||
        (modelsByProvider.get(p.id) ?? []).some(
          (m) =>
            m.modelCode.toLowerCase().includes(kw) ||
            m.modelName.toLowerCase().includes(kw),
        )
      );
    });
  }, [providers, keyword, statusFilter, modelsByProvider]);

  const pager = useListPagination(filtered, 20);

  const allExpanded =
    pager.pageRows.length > 0 &&
    pager.pageRows.every((p) => expandedKeys.includes(p.id));

  const protocolOptions = useMemo(() => {
    const codes = protocols.map((p) => p.protocol);
    return modelDraft.protocol && !codes.includes(modelDraft.protocol)
      ? [modelDraft.protocol, ...codes]
      : codes;
  }, [protocols, modelDraft.protocol]);

  const activeProviders = useMemo(
    () =>
      providers.filter(
        (p) => isEnabled(p.state) || p.id === modelDraft.providerId,
      ),
    [providers, modelDraft.providerId],
  );

  async function runAction(label: string, action: () => Promise<unknown>) {
    setSubmitting(true);
    try {
      await action();
      toast({ tone: "success", title: label });
      await reload();
    } catch (error) {
      toast({ tone: "danger", title: `${label}失败`, ...describeError(error) });
    } finally {
      setSubmitting(false);
    }
  }

  // ── Provider 表单 ────────────────────────────────────────────────────────

  function openProviderCreate() {
    setProviderDraft(EMPTY_PROVIDER_DRAFT);
    setProviderDialog({ kind: "create" });
  }

  function openProviderEdit(row: ModelProviderRecord) {
    setProviderDraft(providerDraftFrom(row));
    setProviderDialog({ kind: "edit", row });
  }

  /**
   * 这家有没有声明过任何线协议怪癖。
   *
   * 用来决定「线协议」那一档**默认开着还是收着**：`advanced` 档缺省折叠是对的
   * ——绝大多数 Provider 没有怪癖，收起来正好。但对已经配了的那几家，折叠等于
   * 让人打开编辑框却看不到这家有一条自定义鉴权样式，然后照着默认去猜为什么行为
   * 不一样。**有声明就摊开**，那一条信息比省下的两行高度值钱。
   */
  const providerWireDeclared =
    providerDraft.chatPath.trim() !== "" ||
    providerDraft.authStyle !== "" ||
    providerDraft.streamUsage !== "" ||
    providerDraft.supportsTools !== "" ||
    providerDraft.supportsToolChoice !== "" ||
    providerDraft.supportsTopP !== "" ||
    providerDraft.supportsTemperature !== "" ||
    providerDraft.headers.trim() !== "" ||
    providerDraft.paramMap.trim() !== "" ||
    providerDraft.extraBody.trim() !== "";

  /**
   * 删除一家 Provider。落锤，由菜单项的 `confirm.onConfirm` 调用。
   *
   * **失败要重新抛出**：DS 的确认件按 Promise 是否 rejected 决定关不关框——吞掉
   * 异常等于让一次失败的删除看起来成功了，而那正是这轮改动要消灭的东西。Toast
   * 仍在这里出（那是产品判断，件不该替我们发明错误 UI）。
   */
  async function deleteProvider(row: ModelProviderRecord) {
    try {
      await api.delete(`/api/atlas/providers/${row.id}`);
      toast({ tone: "success", title: `${row.providerName} 已删除` });
      await reload();
    } catch (error) {
      toast({ tone: "danger", ...deleteFailureToast(error, "删除失败") });
      throw error;
    }
  }

  async function submitProvider(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!providerDialog) return;

    /* 三个开放映射先各自解析。上游确实也会拒，但要等一次往返，而三类失败
       （语法坏了 / 形状不对 / 值类型不对）的说法各不相同，在填表的当下最有用。 */
    const headers = parseStringMap(providerDraft.headers, "附加请求头");
    const paramMap = parseStringMap(providerDraft.paramMap, "参数改名");
    const extraBody = parseExtraBody(providerDraft.extraBody);
    const badWire = [headers, paramMap, extraBody].find((r) => !r.ok);
    if (badWire && !badWire.ok) {
      toast({
        tone: "danger",
        title: "线协议没通过",
        description: badWire.reason,
      });
      return;
    }

    /* 定价策略单独一档报错，不并进「线协议没通过」——它不是线协议，
       而且填错它的后果是成本数字悄悄偏掉，与连不上是两类事。 */
    const offPeak = parseOffPeakPolicy(providerDraft.offPeakPricing);
    if (!offPeak.ok) {
      toast({
        tone: "danger",
        title: "低谷定价没通过",
        description: offPeak.reason,
      });
      return;
    }

    /* 可改的那些。`logoUrl` 不进载荷：opera 不再录入也不再展示，而 Atlas 对**未出现**
       的键按「不改」处理，所以老数据不会被这里的保存悄悄抹掉。

       `config` 与它们相反，是**出现即整体替换**——所以它由 `buildProviderConfig`
       把既有值一并带回去，见那里的头注。 */
    const mutable = {
      providerName: providerDraft.providerName.trim(),
      description: providerDraft.description.trim() || null,
      homepageUrl: providerDraft.homepageUrl.trim() || null,
      consoleUrl: providerDraft.consoleUrl.trim() || null,
      billingUrl: providerDraft.billingUrl.trim() || null,
      config: buildProviderConfig(
        providerDialog.kind === "edit" ? providerDialog.row.config : null,
        providerDraft,
        {
          headers: headers.ok ? headers.value : null,
          paramMap: paramMap.ok ? paramMap.value : null,
          extraBody: extraBody.ok ? extraBody.value : null,
          offPeak: offPeak.value,
        },
        wireSchemaVersion,
      ),
    };

    setSubmitting(true);
    try {
      if (providerDialog.kind === "create") {
        await api.post("/api/atlas/providers", {
          providerCode: providerDraft.providerCode.trim(),
          providerType: providerDraft.providerType,
          ...mutable,
        });
        toast({
          tone: "success",
          title: `${providerDraft.providerName} 已接入`,
        });
      } else {
        /* **只送可改的**。`providerCode` / `providerType` 上面两个输入框在编辑态是
           disabled 的，但值照旧躺在 draft 里——此前它们跟着 PATCH 一起发出去，而
           Atlas 对这两个键的判据是「出现即拒」（`normalizeUpdateProvider`：
           `body.providerCode !== undefined` 就 400 `MODEL_ADMIN_VALIDATION_FAILED`，
           不比对值），所以**编辑 Provider 保存必然失败**，且报的是一条看起来像
           "你想改 code" 的错——而用户根本没改。禁用一个输入框不等于把它从载荷里去掉。 */
        await api.patch(
          `/api/atlas/providers/${providerDialog.row.id}`,
          mutable,
        );
        toast({
          tone: "success",
          title: `${providerDraft.providerName} 已保存`,
        });
      }
      setProviderDialog(null);
      await reload();
    } catch (error) {
      toast({ tone: "danger", title: "保存失败", ...describeError(error) });
    } finally {
      setSubmitting(false);
    }
  }

  // ── Model 表单 ───────────────────────────────────────────────────────────

  /** 从某个 provider 行发起注册时预填它——这正是合并之后最顺的一条路径。 */
  function openModelCreate(providerId?: string) {
    const fallbackProvider =
      providerId ?? providers.find((p) => isEnabled(p.state))?.id ?? "";
    setModelDraft(
      emptyModelDraft(
        fallbackProvider,
        protocols[0]?.protocol ?? "openai-compatible",
      ),
    );
    setModelDialog({ kind: "create" });
  }

  function openModelEdit(row: AiModelRecord) {
    setModelDraft(modelDraftFrom(row));
    setModelDialog({ kind: "edit", row });
  }

  function toggleCapability(cap: string) {
    setModelDraft((d) => ({
      ...d,
      capabilities: d.capabilities.includes(cap)
        ? d.capabilities.filter((c) => c !== cap)
        : [...d.capabilities, cap],
    }));
  }

  /** 删除一个模型。失败重新抛出，理由见 `deleteProvider`。 */
  async function deleteModel(row: AiModelRecord) {
    try {
      await api.delete(`/api/atlas/models/${row.id}`);
      toast({ tone: "success", title: `${row.modelName} 已删除` });
      await reload();
    } catch (error) {
      toast({ tone: "danger", ...deleteFailureToast(error, "删除失败") });
      throw error;
    }
  }

  async function submitModel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!modelDialog) return;

    const provider = providerById.get(modelDraft.providerId);
    /**
     * 可改的那些。**`modelCode` 与 `provider` 只在创建时送**：
     *
     *   `modelCode`  Atlas 的身份列，`98_column_locks.sql` 只给 INSERT。出现即 400
     *                （`normalizeUpdateModel` 第一段，不比对值）——它是消费方 pin 的
     *                版本标识，而 reqlog 按值存了它、没有外键，改名会把这个模型自己的
     *                计量历史劈成两半。
     *   `provider`   **根本不是列**：读的时候从所属 provider 联出来的。Atlas 同样
     *                「出现即 400」，并指明换归属要用 `providerId`（下面送的就是它）。
     *
     * 两个输入框在编辑态都已经 disabled，但值照旧躺在 draft 里——此前整包 PATCH 出去，
     * **编辑模型保存必然失败**。禁用输入框 ≠ 把字段从载荷里去掉。
     */
    /* 三个数值字段先校验再拼：非法值**不静默丢掉**，也不当成"不设"送出去
       ——那两种都会让人以为自己填的生效了。 */
    const contextWindow = parseOptionalInt(modelDraft.contextWindow);
    const maxOutputTokens = parseOptionalInt(modelDraft.maxOutputTokens);
    const sort = parseOptionalInt(modelDraft.sort);
    const badField = [
      [contextWindow, "上下文窗口"],
      [maxOutputTokens, "最大输出"],
      [sort, "排序权重"],
    ].find(([v]) => v === null);
    if (badField) {
      toast({
        tone: "danger",
        title: `${badField[1]}要填非负整数`,
        description: "留空表示不设；填了就必须是一个 atlas 收得下的整数。",
      });
      return;
    }

    /* 厂商开关和上面三个数值字段同一条规矩：非法值不静默丢掉、也不当成"没配"送
       出去。上游确实也会拒，但那要等一次往返，而理由在填表的当下最有用。 */
    const extraBody = parseExtraBody(modelDraft.extraBody);
    if (!extraBody.ok) {
      toast({
        tone: "danger",
        title: "厂商开关没通过",
        description: extraBody.reason,
      });
      return;
    }

    const mutable = {
      modelName: modelDraft.modelName.trim(),
      providerId: modelDraft.providerId || null,
      endpointUrl: modelDraft.endpointUrl.trim(),
      protocol: modelDraft.protocol,
      description: modelDraft.description.trim() || null,
      capabilities: modelDraft.capabilities,
      supportsStreaming: modelDraft.supportsStreaming,
      ...(contextWindow !== undefined ? { contextWindow } : {}),
      ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
      ...(sort !== undefined ? { sort } : {}),
      /* 只送 `managed`（vault 别名）。env 形态 atlas 已「出现即 400」（ADR-003），
         此前这里送的正是 env——填了密钥引用的注册/编辑必然失败。 */
      keyReference: modelDraft.keyAlias.trim()
        ? { source: "managed" as const, name: modelDraft.keyAlias.trim() }
        : null,
      /* keyReference 在场时 atlas 整体替换 config，必须把存量 round-trip 回去，
         见 buildModelConfig 头注。 */
      config: buildModelConfig(
        modelDialog.kind === "edit" ? modelDialog.row.config : null,
        modelDraft.upstreamModel,
        extraBody.value,
        wireSchemaVersion,
      ),
    };

    setSubmitting(true);
    try {
      if (modelDialog.kind === "create") {
        await api.post("/api/atlas/models", {
          modelCode: modelDraft.modelCode.trim(),
          provider: provider?.providerCode ?? modelDraft.providerId,
          /* `modelType` 只在创建时送——它和 modelCode 一样是身份列，
             出现在 PATCH 里会被 atlas 直接 400。 */
          modelType: modelDraft.modelType,
          ...mutable,
        });
        toast({ tone: "success", title: `${modelDraft.modelCode} 已注册` });
        /* 注册完把它所属的 provider 展开——不然新注册的东西看不见。 */
        if (modelDraft.providerId) {
          setExpandedKeys((prev) =>
            prev.includes(modelDraft.providerId)
              ? prev
              : [...prev, modelDraft.providerId],
          );
        }
      } else {
        await api.patch(`/api/atlas/models/${modelDialog.row.id}`, mutable);
        toast({ tone: "success", title: `${modelDraft.modelCode} 已保存` });
      }
      setModelDialog(null);
      await reload();
    } catch (error) {
      toast({ tone: "danger", title: "保存失败", ...describeError(error) });
    } finally {
      setSubmitting(false);
    }
  }

  // ── 密钥抽屉 ─────────────────────────────────────────────────────────────

  const loadKeys = useCallback(async (providerCode: string) => {
    setKeysLoad({ kind: "loading" });
    try {
      const data = await api.get<ProviderKeyRecord[]>(
        `/api/atlas/provider-keys?providerCode=${encodeURIComponent(providerCode)}`,
      );
      setKeys(data);
      setKeysLoad({ kind: "ready" });
    } catch (error) {
      setKeysLoad({
        kind: "error",
        message:
          error instanceof OperaApiError ? error.message : "读取密钥失败",
      });
    }
  }, []);

  function openKeys(row: ModelProviderRecord) {
    setKeysProvider(row);
    void loadKeys(row.providerCode);
  }

  async function submitKeyDialog(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!keyDialog || !keysProvider) return;
    setSubmitting(true);
    try {
      await runWithStepUp(async () => {
        if (keyDialog.kind === "create") {
          await api.post("/api/atlas/provider-keys", {
            providerCode: keysProvider.providerCode,
            keyAlias: keyAlias.trim(),
            keyScope,
            plaintextKey,
          });
        } else {
          await api.post(
            `/api/atlas/provider-keys/${keyDialog.key.id}/rotate`,
            { plaintextKey },
          );
        }
      });
      toast({
        tone: "success",
        title:
          keyDialog.kind === "create"
            ? `密钥「${keyAlias.trim()}」已入库`
            : `密钥「${keyDialog.key.keyAlias}」已轮换`,
      });
      setKeyDialog(null);
      await loadKeys(keysProvider.providerCode);
    } catch (error) {
      if (!isStepUpCancelled(error)) {
        toast({
          tone: "danger",
          title: keyDialog.kind === "create" ? "入库失败" : "轮换失败",
          ...describeError(error),
        });
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleKeyActive(key: ProviderKeyRecord) {
    if (!keysProvider) return;
    setSubmitting(true);
    try {
      await runWithStepUp(() =>
        api.post(
          `/api/atlas/provider-keys/${key.id}/${isEnabled(key.state) ? "deactivate" : "activate"}`,
          {},
        ),
      );
      toast({
        tone: "success",
        title: `密钥「${key.keyAlias}」已${isEnabled(key.state) ? "停用" : "启用"}`,
      });
      await loadKeys(keysProvider.providerCode);
    } catch (error) {
      if (!isStepUpCancelled(error)) {
        toast({ tone: "danger", title: "操作失败", ...describeError(error) });
      }
    } finally {
      setSubmitting(false);
    }
  }

  // ── 探测 ─────────────────────────────────────────────────────────────────

  async function runVerify() {
    if (!verifyTarget) return;
    const target = verifyTarget;
    setVerifying(true);
    try {
      const result = await api.post<ProviderProbeResult>(
        `/api/atlas/providers/${target.id}/probe`,
      );
      setVerifyTarget(null);
      setVerifyResult(result);
    } catch (error) {
      const status = error instanceof OperaApiError ? error.status : 0;
      const routeMissing =
        error instanceof OperaApiError &&
        error.status === 404 &&
        error.code === undefined;
      toast({
        tone: status === 409 || routeMissing ? "warning" : "danger",
        title: routeMissing
          ? "当前 Atlas 部署还没有 Provider 探测接口"
          : status === 409
            ? "无法验证：该 Provider 名下没有启用中的模型"
            : status === 429
              ? "自检冷却中（同一模型两次间隔需 ≥10 秒）"
              : "验证失败",
        ...(routeMissing
          ? {
              description:
                "这条路由由 vxture-atlas#159 §1 交付（应用镜像 v0.4.0）。在此之前只能用单个模型的自检来验这家 Provider 的接入。",
            }
          : status === 409
            ? {
                description:
                  "验证是借这家名下某个启用模型发起一次真实调用完成的；先注册并启用一个模型再试。",
              }
            : describeError(error)),
      });
    } finally {
      setVerifying(false);
    }
  }

  async function runProbe() {
    if (!probeTarget) return;
    const target = probeTarget;
    setProbing(true);
    try {
      const result = await api.post<ModelProbeResult>(
        `/api/atlas/models/${target.id}/probe`,
      );
      setProbeTarget(null);
      setProbeResult(result);
    } catch (error) {
      toast({
        tone: "danger",
        title:
          error instanceof OperaApiError && error.status === 429
            ? "自检冷却中（同一模型两次间隔需 ≥10 秒）"
            : "自检失败",
        ...describeError(error),
      });
    } finally {
      setProbing(false);
    }
  }

  // ── 渲染 ─────────────────────────────────────────────────────────────────

  const providerDraftValid =
    providerDraft.providerCode.trim() !== "" &&
    providerDraft.providerName.trim() !== "";
  const modelDraftValid =
    modelDraft.modelCode.trim() !== "" &&
    modelDraft.modelName.trim() !== "" &&
    modelDraft.endpointUrl.trim() !== "" &&
    modelDraft.capabilities.length > 0;
  const editingProvider = providerDialog?.kind === "edit";
  const editingModel = modelDialog?.kind === "edit";

  /** 二级表：某个 provider 名下的模型。 */
  function modelSubTable(rows: AiModelRecord[], providerId: string | null) {
    if (rows.length === 0) {
      return (
        <div className="flex items-center justify-between gap-sm px-md py-sm">
          <span className="text-body-sm text-muted-foreground">
            这家名下还没有模型。
          </span>
          {canManageModels && providerId ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => openModelCreate(providerId)}
            >
              <Icon name="plus" size="sm" aria-hidden="true" />
              为它注册一个
            </Button>
          ) : null}
        </div>
      );
    }
    /* 不套内边距盒子：二级表用 `leadingSpacer` 占住父表折叠列那一格来对齐，
       归属关系靠**列对齐**读出来，而不是靠一个缩进的方框。序号列、操作列照常，
       只有选择那一格空着——它在这里的职责就是那一格宽度。 */
    return (
      <div>
        <DataTable
          leadingSpacer
          indexStart={1}
          columns={[
            {
              id: "model",
              header: "模型",
              cell: (m: AiModelRecord) => (
                <TableTitleCell
                  icon="brain"
                  title={m.modelName}
                  description={m.modelCode}
                  {...(canManageModels
                    ? { onTitleClick: () => openModelEdit(m) }
                    : {})}
                />
              ),
            },
            {
              id: "capabilities",
              header: "能力",
              width: "md",
              cell: (m: AiModelRecord) => (
                <span className="flex flex-wrap gap-2xs">
                  {m.capabilities.slice(0, 3).map((c) => (
                    <Badge key={c} variant="secondary">
                      {c}
                    </Badge>
                  ))}
                  {m.capabilities.length > 3 ? (
                    <Badge variant="secondary">
                      +{m.capabilities.length - 3}
                    </Badge>
                  ) : null}
                </span>
              ),
            },
            {
              id: "protocol",
              header: "类型 / 协议",
              align: "center",
              width: "sm",
              cell: (m: AiModelRecord) => (
                <span className="flex flex-col items-center gap-2xs">
                  {/* 非 chat 的单独标出来：它们走的是 atlas 上完全不同的 surface，
                      而列表里最容易发生的误会就是把一个 embedding 模型当对话模型挑走。 */}
                  <Badge
                    variant={m.modelType === "chat" ? "outline" : "default"}
                  >
                    {MODEL_TYPES.find((t) => t.value === m.modelType)?.value ??
                      m.modelType}
                  </Badge>
                  {/* behaviorVersion 挂在这里而不是单开一列：平时没人需要读它，
                      但「同一个 modelCode 行为变了」发生时它是唯一的证据——编码锁死
                      不可改，而 endpointUrl / providerId / config 都可以改。 */}
                  <span
                    className="text-body-sm text-muted-foreground"
                    title={`行为指纹 ${m.behaviorVersion}｜它一变，就是有人把这个编码指到了别的上游、或改了 wire`}
                  >
                    {m.protocol}
                  </span>
                </span>
              ),
            },
            {
              id: "context",
              header: "上下文 / 输出",
              align: "right",
              width: "xs",
              cell: (m: AiModelRecord) => (
                <span className="flex flex-col items-end gap-2xs text-body-sm">
                  {/* 未声明就写「未声明」，不写 0——0 是一个会被当真的数字。 */}
                  <span>
                    {m.contextWindow == null ? (
                      <span className="text-muted-foreground">未声明</span>
                    ) : (
                      m.contextWindow.toLocaleString("zh-CN")
                    )}
                  </span>
                  <span className="text-muted-foreground">
                    {m.maxOutputTokens == null
                      ? "—"
                      : m.maxOutputTokens.toLocaleString("zh-CN")}
                  </span>
                </span>
              ),
            },
            {
              /* 挡住删除的两个数。入口数可点；授权数不可点——那是旧的租户轴授权，
                 管理面在 admin，链到本门户会是个假入口。 */
              id: "refs",
              header: "被引用",
              align: "right",
              width: "sm",
              cell: (m: AiModelRecord) => (
                <span className="flex flex-col items-end gap-2xs text-body-sm">
                  {m.endpointRefCount === 0 ? (
                    <span className="text-muted-foreground">入口 0</span>
                  ) : (
                    <Button asChild variant="link" size="sm">
                      <Link
                        href={`/model/routes?modelCode=${encodeURIComponent(m.modelCode)}`}
                      >
                        入口 {m.endpointRefCount}
                      </Link>
                    </Button>
                  )}
                  <span className="text-muted-foreground">
                    授权 {m.grantCount}
                  </span>
                </span>
              ),
            },
            {
              id: "status",
              header: "状态",
              align: "center",
              width: "xs",
              cell: (m: AiModelRecord) => (
                /* 已弃用的把**时间**一并带出来：运营要判断的是「还剩多久、该不该
                   现在迁」，只告诉他「是」回答不了那个问题。上游特意为此补了
                   `deprecatedAt`（atlas#236）。旧 atlas 没有这个字段，就只显示状态。 */
                <span
                  title={
                    m.state === "deprecated" && m.deprecatedAt
                      ? `弃用于 ${formatTime(m.deprecatedAt, locale)}`
                      : undefined
                  }
                >
                  <StatusBadge tone={MODEL_STATE_META[m.state].tone} dot>
                    {MODEL_STATE_META[m.state].label}
                  </StatusBadge>
                </span>
              ),
            },
          ]}
          rows={rows}
          rowKey={(m) => m.id}
          {...(canManageModels
            ? {
                rowActions: (m: AiModelRecord) => (
                  <ActionMenu
                    label={`${m.modelCode} 操作`}
                    disabled={submitting}
                    items={[
                      {
                        id: "edit",
                        label: "编辑",
                        icon: "edit",
                        onSelect: () => openModelEdit(m),
                      },
                      /* 「线协议」排在「自检」前面是有意的：两者回答的问题相邻，
                         而这个不花钱。此前想看生效的 wire 只能跑自检——真实调用、
                         烧 token——于是这个问题实际上没人问。 */
                      {
                        id: "wire",
                        label: "线协议（生效值）",
                        icon: "code",
                        onSelect: () => setWireTarget(m),
                      },
                      {
                        id: "probe",
                        label: "自检（真实调用）",
                        icon: "target",
                        onSelect: () => setProbeTarget(m),
                      },
                      /* 停用与弃用是两件事，所以是两个动作而不是一个开关：
                         停用＝关掉它；弃用＝「别再往上建了，它还能用」。
                         已停用的行不给「弃用」——运营明确关掉的模型报 `inactive`
                         而不是 `deprecated`（atlas 的优先级如此），给了也看不出效果。 */
                      m.state === "inactive"
                        ? {
                            id: "enable",
                            label: "重新上线",
                            icon: "play" as const,
                            onSelect: () =>
                              void runAction(`${m.modelCode} 已重新上线`, () =>
                                api.post(`/api/atlas/models/${m.id}/activate`),
                              ),
                          }
                        : {
                            id: "disable",
                            label: "下线",
                            icon: "prohibit" as const,
                            onSelect: () =>
                              void runAction(`${m.modelCode} 已下线`, () =>
                                api.post(
                                  `/api/atlas/models/${m.id}/deactivate`,
                                ),
                              ),
                          },
                      ...(m.state === "deprecated"
                        ? [
                            {
                              id: "undeprecate",
                              label: "撤销弃用",
                              icon: "clock-counter-clockwise" as const,
                              onSelect: () =>
                                void runAction(
                                  `${m.modelCode} 已撤销弃用`,
                                  () =>
                                    api.post(
                                      `/api/atlas/models/${m.id}/undeprecate`,
                                    ),
                                ),
                            },
                          ]
                        : m.state === "active"
                          ? [
                              {
                                id: "deprecate",
                                label: "弃用（仍可调用）",
                                icon: "warning" as const,
                                onSelect: () =>
                                  void runAction(
                                    `${m.modelCode} 已标记弃用`,
                                    () =>
                                      api.post(
                                        `/api/atlas/models/${m.id}/deprecate`,
                                      ),
                                  ),
                              },
                            ]
                          : []),
                      {
                        id: "delete",
                        label: "删除",
                        icon: "trash",
                        danger: true,
                        separatorBefore: true,
                        /* 两条前置条件此前只写在对话框的描述里——那是**描述**，
                           不是门闩：读的人得自己去别处确认这个模型下没下线、还有
                           没有人引用它。接成 `met` 之后，不满足直接禁用确认钮并
                           标出是哪一条。判据与 Atlas 的删除前置一致。

                           「已下线」用 `!isServing()` 而不是 `!isEnabled()`：
                           `deprecated` 的 `is_active` 仍是 true，按 isEnabled
                           判会把一个弃用中的模型标成「已下线」，然后被 Atlas 拒。 */
                        confirm: withLabels({
                          verb: "删除",
                          target: `模型 ${m.modelCode}`,
                          consequence:
                            "删除后不可恢复。不会级联删除任何东西——前置条件不满足时 Atlas 会拒绝并点名是什么挡住了。",
                          preconditions: [
                            {
                              label: "模型已下线",
                              met: !isServing(m.state),
                            },
                            {
                              label:
                                "没有入口或授权还在引用它（入口引用把 fallback 也算进去）",
                              met:
                                m.grantCount === 0 && m.endpointRefCount === 0,
                            },
                          ],
                          onConfirm: () => deleteModel(m),
                        }),
                      },
                    ]}
                  />
                ),
              }
            : {})}
        />
      </div>
    );
  }

  const emptyState =
    load.kind === "loading" ? (
      <EmptyState
        title={tShared("common.loading")}
        description="正在读取 Provider 与模型。"
      />
    ) : load.kind === "error" ? (
      <EmptyState
        title={tShared("common.loadFailed")}
        description={load.message}
        action={
          <Button variant="secondary" onClick={() => void reload()}>
            {tShared("common.retry")}
          </Button>
        }
      />
    ) : filtered.length !== providers.length ? (
      <EmptyState
        title="没有匹配的 Provider"
        description="关键词同时匹配供应商与它名下的模型；换个词或筛选条件再看。"
      />
    ) : (
      <EmptyState
        title="暂无 Provider"
        description="点击「接入 Provider」开始。"
      />
    );

  return (
    <>
      <ListPageTemplate
        header={
          <ViewHeader
            icon="plugs-connected"
            title="模型服务"
            description="供应商与它名下的模型，展开行查看归属；两者都启用才可服务。「健康」由真实流量派生，要即时结论用行操作里的「验证接入」。"
            action={
              <div className="flex items-center gap-sm">
                {canManageModels ? (
                  <Button
                    variant="outline"
                    onClick={() => openModelCreate()}
                    disabled={
                      submitting || !providers.some((p) => isEnabled(p.state))
                    }
                  >
                    <Icon name="plus" size="sm" aria-hidden="true" />
                    注册模型
                  </Button>
                ) : null}
                {canManageProviders ? (
                  <Button onClick={openProviderCreate} disabled={submitting}>
                    <Icon name="plus" size="sm" aria-hidden="true" />
                    接入 Provider
                  </Button>
                ) : null}
              </div>
            }
          />
        }
        summary={
          orphanModels.length > 0 ? (
            /* 孤儿模型不藏。它们无法服务任何调用——挂不到 provider 就解析不出上游，
               而这恰恰是最需要被看见的一类。 */
            <Banner
              tone="warning"
              title={`${orphanModels.length} 个模型没有可解析的 Provider`}
              description="providerId 为空、或指向一个不存在的供应商。这些模型解析不出上游，无法服务任何调用。它们列在表格下方——就地改归属或删除。"
            />
          ) : null
        }
        footer={
          /* 孤儿模型给出**可操作的**清单，而不是只在横幅里点名。上面那条横幅让人
             "改归属或删除"，却不给入口，等于把问题指出来又把门关上。 */
          orphanModels.length > 0 ? (
            <div className="flex flex-col gap-sm rounded-md border border-warning-border">
              <div className="px-md pt-sm text-label-md text-foreground">
                未归属模型（{orphanModels.length}）
              </div>
              {modelSubTable(orphanModels, null)}
            </div>
          ) : null
        }
        filters={
          <FilterBar
            view="list"
            onViewChange={() => {}}
            cardsDisabledReason={tShared("common.cardsRetired")}
            count={
              filtered.length === providers.length
                ? `${providers.length} 家 · ${models.length} 个模型`
                : `${filtered.length} / ${providers.length} 家`
            }
            scope={
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setExpandedKeys(
                    allExpanded ? [] : pager.pageRows.map((p) => p.id),
                  )
                }
              >
                <Icon
                  name={allExpanded ? "chevron-up" : "chevron-down"}
                  size="sm"
                  aria-hidden="true"
                />
                {allExpanded ? "全部收起" : "全部展开"}
              </Button>
            }
          >
            <InputGroup className="grow basis-media-3xl max-w-panel-sm">
              <InputGroupAddon>
                <Icon name="search" size="sm" aria-hidden="true" />
              </InputGroupAddon>
              <InputGroupInput
                placeholder="搜索供应商或模型…"
                aria-label="搜索"
                value={keyword}
                onChange={(e) => {
                  setKeyword(e.target.value);
                  pager.resetPage();
                }}
              />
            </InputGroup>
            <NativeSelect
              wrapperClassName="w-fit"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as typeof statusFilter);
                pager.resetPage();
              }}
              aria-label={tShared("filters.stateLabel")}
            >
              <option value="all">{tShared("filters.allStates")}</option>
              <option value="active">{tShared("actions.enable")}</option>
              <option value="inactive">{tShared("actions.disable")}</option>
            </NativeSelect>
          </FilterBar>
        }
        table={
          <DataTable
            columns={[
              {
                id: "name",
                header: "Provider",
                /* **不引供应商 logo**（2026-08-16 owner 定）：一屏十几家供应商，
                   认标确实比认字快，但代价是 15 个外部图源进 CSP `img-src`、每次开页
                   把运营台的访问泄给对方 CDN，还要处理商标资产的授权——为一个图标付
                   这些，不值。统一用通用图标。 */
                cell: (r: ModelProviderRecord) => (
                  <TableTitleCell
                    icon="plugs-connected"
                    title={r.providerName}
                    description={r.providerCode}
                    {...(canManageProviders
                      ? { onTitleClick: () => openProviderEdit(r) }
                      : {})}
                  />
                ),
              },
              {
                id: "type",
                header: tShared("columns.kind"),
                align: "center",
                width: "xs",
                cell: (r: ModelProviderRecord) =>
                  PROVIDER_TYPES.find((t) => t.value === r.providerType)
                    ?.label ?? r.providerType,
              },
              {
                /* 合并之后这一列不再是链接，而是**展开提示**：要看是哪些模型，
                   就在这一行展开，不用跳走。挡住删除的仍然是这个数。 */
                id: "models",
                header: "模型数",
                align: "right",
                width: "xs",
                cell: (r: ModelProviderRecord) => {
                  const owned = modelsByProvider.get(r.id) ?? [];
                  /* 数的是**还能服务的**（`deprecated` 算能）——这一格回答的是
                     "这家现在撑着多少模型"，少算弃用的会低报真实服务面。 */
                  const activeCount = owned.filter((m) =>
                    isServing(m.state),
                  ).length;
                  /* 两个来源：`modelCount` 是 Atlas 给的、也是挡住删除的那个数；
                     `owned` 是本页按 providerId 分的组，也就是展开后列出来的那些。
                     正常情况下两者相等。**不等的时候必须说**——否则这一列会和它
                     正下方的清单对不上，而"列上的数字和事实不符"正是这套计数最初
                     要解决的问题。 */
                  const authoritative = r.modelCount;
                  const disagrees =
                    authoritative !== undefined &&
                    authoritative !== owned.length;
                  return (
                    <span className="flex flex-col items-end gap-2xs">
                      <span className="text-body-sm">
                        {authoritative ?? owned.length}
                      </span>
                      {disagrees ? (
                        <span
                          className="text-body-sm text-warning-foreground"
                          title="Atlas 报的模型数与本页按 providerId 分出来的组不一致——展开看到的是后者。"
                        >
                          展开可见 {owned.length}
                        </span>
                      ) : owned.length > 0 ? (
                        <span className="text-body-sm text-muted-foreground">
                          {activeCount} 启用
                        </span>
                      ) : null}
                    </span>
                  );
                },
              },
              {
                id: "health",
                header: tShared("columns.health"),
                align: "center",
                width: "xs",
                cell: (r: ModelProviderRecord) => (
                  <StatusBadge
                    tone={HEALTH_META[r.health?.status ?? "unknown"].tone}
                    dot
                  >
                    {HEALTH_META[r.health?.status ?? "unknown"].label}
                  </StatusBadge>
                ),
              },
              {
                id: "status",
                header: tShared("columns.state"),
                align: "center",
                width: "xs",
                cell: (r: ModelProviderRecord) => (
                  <StatusBadge
                    tone={isEnabled(r.state) ? "success" : "neutral"}
                    dot
                  >
                    {isEnabled(r.state)
                      ? tShared("actions.enable")
                      : tShared("actions.disable")}
                  </StatusBadge>
                ),
              },
            ]}
            rows={pager.pageRows}
            rowKey={(r: ModelProviderRecord) => r.id}
            indexStart={pager.indexStart}
            expandedKeys={expandedKeys}
            onExpandedChange={setExpandedKeys}
            expandedContent={(r: ModelProviderRecord) =>
              modelSubTable(modelsByProvider.get(r.id) ?? [], r.id)
            }
            {...(canManageProviders
              ? {
                  rowActions: (r: ModelProviderRecord) => (
                    <ActionMenu
                      label={`${r.providerName} 操作`}
                      disabled={submitting}
                      items={[
                        {
                          id: "add-model",
                          label: "为它注册模型",
                          icon: "plus",
                          disabled: !canManageModels || !isEnabled(r.state),
                          onSelect: () => openModelCreate(r.id),
                        },
                        {
                          id: "edit",
                          label: tShared("common.edit"),
                          icon: "edit",
                          separatorBefore: true,
                          onSelect: () => openProviderEdit(r),
                        },
                        ...(r.consoleUrl
                          ? [
                              {
                                /* 密钥轮换、配额调整都在对方控制台做——运营流程本来
                                   就要跳出去，填了地址就别让人再去搜一次。 */
                                id: "vendor-console",
                                label: "对方控制台",
                                icon: "external-link" as const,
                                separatorBefore: true,
                                onSelect: () =>
                                  window.open(
                                    r.consoleUrl!,
                                    "_blank",
                                    "noopener,noreferrer",
                                  ),
                              },
                            ]
                          : []),
                        ...(r.billingUrl
                          ? [
                              {
                                /* Atlas 计量但不计费（ADR-004）：真花了多少钱只有
                                   对方账单页知道，本门户不显示也不估算金额。 */
                                id: "vendor-billing",
                                label: "对方账单",
                                icon: "receipt" as const,
                                onSelect: () =>
                                  window.open(
                                    r.billingUrl!,
                                    "_blank",
                                    "noopener,noreferrer",
                                  ),
                              },
                            ]
                          : []),
                        {
                          id: "keys",
                          label: "密钥管理",
                          icon: "key",
                          onSelect: () => openKeys(r),
                        },
                        {
                          id: "verify",
                          label: "验证接入（真实调用）",
                          icon: "target",
                          onSelect: () => setVerifyTarget(r),
                        },
                        isEnabled(r.state)
                          ? {
                              id: "disable",
                              label: tShared("actions.disable"),
                              icon: "pause" as const,
                              separatorBefore: true,
                              onSelect: () =>
                                void runAction(`${r.providerName} 已停用`, () =>
                                  api.post(
                                    `/api/atlas/providers/${r.id}/deactivate`,
                                  ),
                                ),
                            }
                          : {
                              id: "enable",
                              label: tShared("actions.enable"),
                              icon: "play" as const,
                              separatorBefore: true,
                              onSelect: () =>
                                void runAction(`${r.providerName} 已启用`, () =>
                                  api.post(
                                    `/api/atlas/providers/${r.id}/activate`,
                                  ),
                                ),
                            },
                        {
                          id: "delete",
                          label: tShared("actions.delete"),
                          icon: "trash",
                          danger: true,
                          /* Provider 是两值状态（没有 deprecated 档），所以
                             「已停用」用 `!isEnabled()` 就够。 */
                          confirm: withLabels({
                            verb: tShared("actions.delete"),
                            target: `Provider ${r.providerName}`,
                            consequence:
                              "删除后不可恢复。不会级联删除名下的任何模型或授权——前置条件不满足时 Atlas 会拒绝并点名是哪些模型挡住了。",
                            preconditions: [
                              {
                                label: "这家已停用",
                                met: !isEnabled(r.state),
                              },
                              {
                                label: "名下没有未删除的模型（不论启停）",
                                met: r.modelCount === 0,
                              },
                            ],
                            onConfirm: () => deleteProvider(r),
                          }),
                        },
                      ]}
                    />
                  ),
                }
              : {})}
            footer={
              <ListPagination
                className="w-full"
                currentPage={pager.page}
                pageCount={pager.pageCount}
                total={providers.length}
                filteredTotal={filtered.length}
                pageSize={pager.pageSize}
                onPageSizeChange={pager.onPageSizeChange}
                onPageChange={pager.onPageChange}
              />
            }
            empty={emptyState}
          />
        }
      />

      {/* ── Provider 表单 ────────────────────────────────────────────────── */}
      <DialogForm
        open={providerDialog?.kind === "create" || editingProvider}
        onOpenChange={(open) => {
          if (!open) setProviderDialog(null);
        }}
        size="xl"
        title={editingProvider ? "编辑 Provider" : "接入 Provider"}
        description="Provider＝模型的供应方（收费主体）。密钥、账单都按它归属；同一个模型由多家供应时，每家各接入一次。"
        submitLabel={editingProvider ? tShared("common.save") : "接入"}
        submitting={submitting}
        submitDisabled={!providerDraftValid}
        onSubmit={submitProvider}
      >
        {/* 三档（DS `FieldTier`）：身份 = 决定这是哪一家、创建后改不了；常规 = 运营
            真正会用到的；高级 = 填不填都行。**不平铺**——八个字段一长串时，读的人
            无从判断哪些必须停下来想，结果要么每栏都想一遍要么一路 Tab 过去。
            `density-compact` 是 DS 的密度轴：注册面板走 xl 双栏 + 紧凑密度，
            整表一屏可见、不出滚动条（owner 2026-08-24 定）。 */}
        <div className="density-compact flex flex-col gap-md">
          <FieldTier
            tier="identity"
            hint="决定这是哪一家。Code 与类型创建后不可改。"
          >
            <div className="grid grid-cols-3 gap-md">
              <Field>
                <FieldLabel htmlFor="provider-code">Code</FieldLabel>
                <Input
                  id="provider-code"
                  value={providerDraft.providerCode}
                  onChange={(e) =>
                    setProviderDraft({
                      ...providerDraft,
                      providerCode: e.target.value,
                    })
                  }
                  placeholder="openai"
                  disabled={editingProvider}
                />
                <FieldDescription>
                  全局唯一，模型与密钥都按它归属。
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="provider-name">名称</FieldLabel>
                <Input
                  id="provider-name"
                  value={providerDraft.providerName}
                  onChange={(e) =>
                    setProviderDraft({
                      ...providerDraft,
                      providerName: e.target.value,
                    })
                  }
                  placeholder="OpenAI"
                />
                <FieldDescription>
                  列表与选择器里显示的名字，可改。
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="provider-type">
                  {tShared("columns.kind")}
                </FieldLabel>
                <NativeSelect
                  id="provider-type"
                  value={providerDraft.providerType}
                  onChange={(e) =>
                    setProviderDraft({
                      ...providerDraft,
                      providerType: e.target.value,
                    })
                  }
                  disabled={editingProvider}
                >
                  {PROVIDER_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </NativeSelect>
                <FieldDescription>创建后不可改。</FieldDescription>
              </Field>
            </div>
          </FieldTier>

          <FieldTier
            tier="details"
            hint="填了地址，行操作里就有对方控制台与账单的直达入口。"
          >
            <Field>
              <FieldLabel htmlFor="provider-description">简介</FieldLabel>
              <Textarea
                id="provider-description"
                value={providerDraft.description}
                onChange={(e) =>
                  setProviderDraft({
                    ...providerDraft,
                    description: e.target.value,
                  })
                }
                rows={2}
              />
            </Field>
            <div className="grid grid-cols-2 gap-md">
              <Field>
                <FieldLabel htmlFor="provider-console">控制台 URL</FieldLabel>
                <Input
                  id="provider-console"
                  value={providerDraft.consoleUrl}
                  onChange={(e) =>
                    setProviderDraft({
                      ...providerDraft,
                      consoleUrl: e.target.value,
                    })
                  }
                />
                <FieldDescription>
                  密钥轮换、配额调整在这里做。
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="provider-billing">账单 URL</FieldLabel>
                <Input
                  id="provider-billing"
                  value={providerDraft.billingUrl}
                  onChange={(e) =>
                    setProviderDraft({
                      ...providerDraft,
                      billingUrl: e.target.value,
                    })
                  }
                />
                <FieldDescription>
                  实际花费以对方账单为准（Atlas 计量不计费）。
                </FieldDescription>
              </Field>
            </div>
          </FieldTier>

          {/* ── 线协议（config.wire）─────────────────────────────────────────
              同一个 protocol 下各家上游仍有参数级差异：端点后缀、鉴权头样式、
              流式要不要显式 opt-in usage、支不支持 tool calling。按 Atlas 的判据
              「线格式不同才写代码，参数不同一律写数据」，这些本就该在注册表里，
              而此前门户一个都填不了——于是接一家怪一点的上游还是得改 Atlas。

              全部留空就是「这家没有怪癖」，用协议默认。逐键合并：这里声明的会压住
              协议默认，再被单个模型的同名键压住。 */}
          <FieldTier
            tier="advanced"
            /* 覆盖档名：同一张表单里已经有一个 advanced 档（下面那个纯登记的），
               两个都用标准名会变成两个一模一样的折叠条。分档是为了让人一眼知道
               里面是什么，撞名正好把这件事抵消掉。 */
            title="线协议（config.wire）"
            defaultOpen={providerWireDeclared}
            hint="留空＝跟随协议默认。整家生效，单个模型可以再覆盖。"
          >
            <div className="grid grid-cols-3 gap-md">
              <Field>
                <FieldLabel htmlFor="provider-chat-path">端点后缀</FieldLabel>
                <Input
                  id="provider-chat-path"
                  value={providerDraft.chatPath}
                  onChange={(e) =>
                    setProviderDraft({
                      ...providerDraft,
                      chatPath: e.target.value,
                    })
                  }
                  placeholder="/chat/completions"
                  className="font-mono"
                />
                <FieldDescription>接在接入地址后面的那一段。</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="provider-auth-style">鉴权样式</FieldLabel>
                <NativeSelect
                  id="provider-auth-style"
                  value={providerDraft.authStyle}
                  onChange={(e) =>
                    setProviderDraft({
                      ...providerDraft,
                      authStyle: e.target.value,
                    })
                  }
                >
                  <option value="">跟随协议默认</option>
                  <option value="bearer">bearer（Authorization）</option>
                  <option value="x-api-key">x-api-key</option>
                  <option value="none">none（不带凭据）</option>
                </NativeSelect>
                <FieldDescription>密钥放在哪个头里送。</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="provider-stream-usage">
                  流式 usage
                </FieldLabel>
                <NativeSelect
                  id="provider-stream-usage"
                  value={providerDraft.streamUsage}
                  onChange={(e) =>
                    setProviderDraft({
                      ...providerDraft,
                      streamUsage: e.target.value,
                    })
                  }
                >
                  <option value="">跟随协议默认</option>
                  <option value="stream_options">
                    stream_options（要显式要）
                  </option>
                  <option value="native">native（上游自己带）</option>
                  <option value="none">none（流里不回）</option>
                </NativeSelect>
                {/* 这一项直接决定流式调用会不会被计量：选 none 等于承认这家的
                    流式请求没有 usage 可记，而不是"随便填一个"。 */}
                <FieldDescription>
                  选 none＝这家流式不回 usage，那些调用不会被计量。
                </FieldDescription>
              </Field>
            </div>
            {/* 四个能力开关是**三态**而不是勾选框：没声明会让协议默认透上来，
                声明成"不支持"会把它压住——这两件事不是同一个意思。 */}
            <div className="grid grid-cols-4 gap-md">
              {(
                [
                  ["provider-supports-tools", "工具调用", "supportsTools"],
                  [
                    "provider-supports-tool-choice",
                    "指定工具",
                    "supportsToolChoice",
                  ],
                  ["provider-supports-top-p", "top_p", "supportsTopP"],
                  [
                    "provider-supports-temperature",
                    "temperature",
                    "supportsTemperature",
                  ],
                ] as const
              ).map(([id, label, key]) => (
                <Field key={key}>
                  <FieldLabel htmlFor={id}>{label}</FieldLabel>
                  <NativeSelect
                    id={id}
                    value={providerDraft[key]}
                    onChange={(e) =>
                      setProviderDraft({
                        ...providerDraft,
                        [key]: e.target.value,
                      })
                    }
                  >
                    <option value="">跟随默认</option>
                    <option value="true">支持</option>
                    <option value="false">不支持</option>
                  </NativeSelect>
                </Field>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-md">
              <Field>
                <FieldLabel htmlFor="provider-headers">附加请求头</FieldLabel>
                <Textarea
                  id="provider-headers"
                  rows={2}
                  value={providerDraft.headers}
                  onChange={(e) =>
                    setProviderDraft({
                      ...providerDraft,
                      headers: e.target.value,
                    })
                  }
                  placeholder={'{"anthropic-version":"2023-06-01"}'}
                  className="font-mono"
                />
                <FieldDescription>JSON 对象，值必须是字符串。</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="provider-param-map">参数改名</FieldLabel>
                <Textarea
                  id="provider-param-map"
                  rows={2}
                  value={providerDraft.paramMap}
                  onChange={(e) =>
                    setProviderDraft({
                      ...providerDraft,
                      paramMap: e.target.value,
                    })
                  }
                  placeholder={'{"maxTokens":"max_completion_tokens"}'}
                  className="font-mono"
                />
                <FieldDescription>
                  只能给已有参数换名字，塞不进新字段。
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="provider-extra-body">厂商开关</FieldLabel>
                <Textarea
                  id="provider-extra-body"
                  rows={2}
                  value={providerDraft.extraBody}
                  onChange={(e) =>
                    setProviderDraft({
                      ...providerDraft,
                      extraBody: e.target.value,
                    })
                  }
                  placeholder={'{"user_id":"vxture"}'}
                  className="font-mono"
                />
                <FieldDescription>
                  整家默认的新字段。单个模型的开关在模型表单里配。
                </FieldDescription>
              </Field>
            </div>
          </FieldTier>

          {/* ── 低谷定价（config.pricing.offPeak）────────────────────────────
              不配不是错，但**在配上之前 Atlas 的成本汇总把所有请求按峰价估**。
              以 DeepSeek 为例，高峰只有 35 小时 / 168 小时——约 79% 的时段实际是
              半价，而估出来的数看起来完全正常（响应里只有一个
              `coverage.requestsWithoutPricingWindow` 计数在提示这件事）。

              声明的是**高峰窗口**，低谷是它的补集：与供应商自己的表述一致，
              避免同一事实有第二个来源。

              与线协议同理，**有声明就摊开**——已经配了策略却看不见它，会让人
              照着「没打折」去解释账单。 */}
          <FieldTier
            tier="advanced"
            title="低谷定价（config.pricing.offPeak）"
            defaultOpen={providerDraft.offPeakPricing.trim() !== ""}
            hint="留空＝不打折，全周期按峰价估。声明的是高峰窗口，低谷是补集。"
          >
            <Field>
              <FieldLabel htmlFor="provider-off-peak">低谷定价策略</FieldLabel>
              <Textarea
                id="provider-off-peak"
                rows={8}
                value={providerDraft.offPeakPricing}
                onChange={(e) =>
                  setProviderDraft({
                    ...providerDraft,
                    offPeakPricing: e.target.value,
                  })
                }
                placeholder={DEEPSEEK_OFF_PEAK_PRESET}
                className="font-mono"
              />
              <FieldDescription>
                {
                  "JSON 对象。`timezone` 只能是 UTC（分桶在 UTC 做）；`multiplier` 是十进制字符串、最多 8 位小数（金额不走 float）；`appliesTo` 与 `peakWindows` 都不能为空——空不当成「全部」，也不当成「没有高峰」。`fromHour`/`toHour` 左闭右开。"
                }
              </FieldDescription>
              <div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    setProviderDraft({
                      ...providerDraft,
                      offPeakPricing: DEEPSEEK_OFF_PEAK_PRESET,
                    })
                  }
                >
                  填入 DeepSeek 现行策略
                </Button>
              </div>
            </Field>
          </FieldTier>

          <FieldTier tier="advanced" hint="填不填都不影响接入。">
            <div className="grid grid-cols-2 gap-md">
              <Field>
                <FieldLabel htmlFor="provider-homepage">主页 URL</FieldLabel>
                <Input
                  id="provider-homepage"
                  value={providerDraft.homepageUrl}
                  onChange={(e) =>
                    setProviderDraft({
                      ...providerDraft,
                      homepageUrl: e.target.value,
                    })
                  }
                />
                <FieldDescription>纯登记。</FieldDescription>
              </Field>
            </div>
          </FieldTier>
        </div>
      </DialogForm>

      {/* ── Model 表单 ───────────────────────────────────────────────────── */}
      <DialogForm
        open={modelDialog?.kind === "create" || editingModel}
        onOpenChange={(open) => {
          if (!open) setModelDialog(null);
        }}
        size="xl"
        title={editingModel ? "编辑模型" : "注册模型"}
        description="一条模型＝从某家 Provider 接入的某个模型。编码与类型创建后不可改，其余随时可调。"
        submitLabel={editingModel ? tShared("common.save") : "注册"}
        submitting={submitting}
        submitDisabled={!modelDraftValid}
        onSubmit={submitModel}
      >
        {/* 三档（DS `FieldTier`）：身份（不可改）/ 接入参数 / 可留空的容量与呈现。
            xl 双栏 + `density-compact`（DS 密度轴），整表一屏可见、不出滚动条。 */}
        <div className="density-compact flex flex-col gap-md">
          <FieldTier tier="identity" hint="决定这是哪个模型、由谁供应。">
            <FieldGroup>
              <div className="grid grid-cols-2 gap-md">
                <Field>
                  <FieldLabel htmlFor="model-code">编码</FieldLabel>
                  <Input
                    id="model-code"
                    value={modelDraft.modelCode}
                    onChange={(e) =>
                      setModelDraft({
                        ...modelDraft,
                        modelCode: e.target.value,
                      })
                    }
                    placeholder="deepseek/deepseek-v4-flash"
                    disabled={editingModel}
                  />
                  <FieldDescription>
                    全局唯一。同一上游模型由多家供应时各注册一条，编码加
                    「供应方/」前缀区分，上游真实名填「上游模型名」。
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="model-name">名称</FieldLabel>
                  <Input
                    id="model-name"
                    value={modelDraft.modelName}
                    onChange={(e) =>
                      setModelDraft({
                        ...modelDraft,
                        modelName: e.target.value,
                      })
                    }
                    placeholder="DeepSeek V4 Flash（火山）"
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-md">
                <Field>
                  <FieldLabel htmlFor="model-provider">Provider</FieldLabel>
                  <NativeSelect
                    id="model-provider"
                    value={modelDraft.providerId}
                    onChange={(e) =>
                      setModelDraft({
                        ...modelDraft,
                        providerId: e.target.value,
                      })
                    }
                  >
                    {/* 孤儿模型（providerId 为空）编辑时给个占位项，不然浏览器会显示
                    第一项的文字而值仍是空串——看着选了，其实没选。 */}
                    {modelDraft.providerId === "" ? (
                      <option value="">— 选择 Provider —</option>
                    ) : null}
                    {activeProviders.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.providerName}
                        {isEnabled(p.state) ? "" : "（已停用）"}
                      </option>
                    ))}
                  </NativeSelect>
                  <FieldDescription>
                    只列启用中的（当前已挂的除外）。模型与 Provider
                    都启用才可服务；换它即换供应方与密钥来源。
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="model-type">
                    {tShared("columns.kind")}
                  </FieldLabel>
                  <NativeSelect
                    id="model-type"
                    value={modelDraft.modelType}
                    onChange={(e) =>
                      setModelDraft({
                        ...modelDraft,
                        modelType: e.target.value,
                      })
                    }
                    disabled={editingModel}
                  >
                    {MODEL_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </NativeSelect>
                  <FieldDescription>
                    {MODEL_TYPES.find((t) => t.value === modelDraft.modelType)
                      ?.hint ?? ""}
                    {editingModel
                      ? "。创建后不可改，要换类型只能重新注册。"
                      : "。创建后不可改。"}
                  </FieldDescription>
                </Field>
              </div>
            </FieldGroup>
          </FieldTier>

          <FieldTier
            tier="details"
            hint="接入参数：填错要到第一次真实调用才暴露。"
          >
            <FieldGroup>
              <div className="grid grid-cols-2 gap-md">
                <Field>
                  <FieldLabel htmlFor="model-endpoint">Endpoint URL</FieldLabel>
                  <Input
                    id="model-endpoint"
                    value={modelDraft.endpointUrl}
                    onChange={(e) =>
                      setModelDraft({
                        ...modelDraft,
                        endpointUrl: e.target.value,
                      })
                    }
                    placeholder="https://api.openai.com/v1"
                  />
                  <FieldDescription>上游 API 的基地址。</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="model-protocol">协议</FieldLabel>
                  <NativeSelect
                    id="model-protocol"
                    value={modelDraft.protocol}
                    onChange={(e) =>
                      setModelDraft({ ...modelDraft, protocol: e.target.value })
                    }
                  >
                    {protocolOptions.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </NativeSelect>
                  <FieldDescription>
                    {protocols.length > 0
                      ? (protocols.find(
                          (p) => p.protocol === modelDraft.protocol,
                        )?.description ?? "来自 Atlas 的协议词表。")
                      : "协议词表读取失败，只能保留当前值。"}
                  </FieldDescription>
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-md">
                <Field>
                  <FieldLabel htmlFor="model-upstream">上游模型名</FieldLabel>
                  <Input
                    id="model-upstream"
                    value={modelDraft.upstreamModel}
                    onChange={(e) =>
                      setModelDraft({
                        ...modelDraft,
                        upstreamModel: e.target.value,
                      })
                    }
                    placeholder="deepseek-v4-flash / ep-2026…"
                    className="font-mono"
                  />
                  <FieldDescription>
                    调用上游时送的 model
                    参数，留空＝直接用编码。编码带了供应方前缀、 或上游用接入点
                    ID（火山引擎 ep-…）时必填。
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="model-key">
                    密钥（vault 别名）
                  </FieldLabel>
                  {aliasOptions === "unavailable" ? (
                    /* 列不出来（没有 provider.manage 或上游故障）就手填——照样以
                   managed 形态提交，绝不退回已退役的 env 路径。 */
                    <>
                      <Input
                        id="model-key"
                        value={modelDraft.keyAlias}
                        onChange={(e) =>
                          setModelDraft({
                            ...modelDraft,
                            keyAlias: e.target.value,
                          })
                        }
                        placeholder="default"
                        className="font-mono"
                      />
                      <FieldDescription>
                        密钥清单读取失败；直接填这家 Provider
                        密钥库里的别名也可。
                      </FieldDescription>
                    </>
                  ) : (
                    <>
                      <NativeSelect
                        id="model-key"
                        value={modelDraft.keyAlias}
                        onChange={(e) =>
                          setModelDraft({
                            ...modelDraft,
                            keyAlias: e.target.value,
                          })
                        }
                      >
                        <option value="">
                          不引用（仅私有/自定义上游可免）
                        </option>
                        {/* 当前值不在清单里（别名已删或清单还没到）也得显示——
                        下拉悄悄换值等于替人改了配置。 */}
                        {modelDraft.keyAlias !== "" &&
                        !(aliasOptions ?? []).some(
                          (k) => k.keyAlias === modelDraft.keyAlias,
                        ) ? (
                          <option value={modelDraft.keyAlias}>
                            {modelDraft.keyAlias}（不在清单中）
                          </option>
                        ) : null}
                        {(aliasOptions ?? []).map((k) => (
                          <option key={k.id} value={k.keyAlias}>
                            {k.keyAlias}
                            {isEnabled(k.state) ? "" : "（已停用）"}
                          </option>
                        ))}
                      </NativeSelect>
                      <FieldDescription>
                        {aliasOptions !== null && aliasOptions.length === 0
                          ? "这家还没有密钥——先在 Provider 行操作「密钥管理」里录入。"
                          : "从这家 Provider 的密钥库里选。"}
                        {modelDialog?.kind === "edit" &&
                        modelDialog.row.keyReference?.source === "env"
                          ? ` 原引用的 env 变量 ${modelDialog.row.keyReference.name} 已退役（ADR-003），运行时不再读取——请改选 vault 别名。`
                          : ""}
                      </FieldDescription>
                    </>
                  )}
                </Field>
              </div>
              <Field>
                <FieldLabel>能力标签</FieldLabel>
                <div className="flex flex-wrap gap-sm">
                  {CAPABILITY_OPTIONS.map((c) => {
                    const active = modelDraft.capabilities.includes(c);
                    return (
                      <Button
                        key={c}
                        type="button"
                        variant="ghost"
                        onClick={() => toggleCapability(c)}
                        /* 视觉全由里面的 Badge 给：这里只要一个可聚焦、可回车触发的
                         按钮语义，所以把 Button 自己的尺寸与内边距归零。 */
                        className="inline-flex h-auto w-auto p-0 hover:bg-transparent"
                      >
                        <Badge variant={active ? "default" : "outline"}>
                          {c}
                        </Badge>
                      </Button>
                    );
                  })}
                </div>
                <FieldDescription>至少选一项。</FieldDescription>
              </Field>
            </FieldGroup>
          </FieldTier>

          {/* 容量与呈现：全部可留空，留空 = 用 atlas 自己的默认，不是 0。
              厂商开关也住在这一档，所以**这个模型已经声明了开关时默认摊开**——与
              Provider 那边同一条规矩：折叠等于让人打开编辑框却看不到这个模型有一条
              关掉思考的开关，然后照着默认去猜为什么行为不一样。 */}
          <FieldTier
            tier="advanced"
            defaultOpen={modelDraft.extraBody.trim() !== ""}
            hint="都可留空，留空＝用 Atlas 默认。"
          >
            <FieldGroup>
              {/* 说明与厂商开关并排：两个都是 rows=2 的 Textarea，占的高度和原来
                  单栏一个说明一样——xl 双栏「一屏可见、不出滚动条」的账不变。 */}
              <div className="grid grid-cols-2 gap-md">
                <Field>
                  <FieldLabel htmlFor="model-description">说明</FieldLabel>
                  <Textarea
                    id="model-description"
                    rows={2}
                    value={modelDraft.description}
                    onChange={(e) =>
                      setModelDraft({
                        ...modelDraft,
                        description: e.target.value,
                      })
                    }
                    placeholder="这个模型适合做什么、有什么已知限制"
                  />
                </Field>
                {/* `config.wire.extraBody`（wire schema v2）。
                    在此之前门户没有任何地方能配它，于是「接一家上游只写注册表数据」
                    这句话对 opera 不成立：一个默认开思考的模型（DeepSeek V4）注册完
                    就是坏的——流式一个 token 都不交付——而唯一的修法是一条门户填不了
                    的配置。这个输入框就是把那条路补上。 */}
                <Field>
                  <FieldLabel htmlFor="model-extra-body">厂商开关</FieldLabel>
                  <Textarea
                    id="model-extra-body"
                    rows={2}
                    value={modelDraft.extraBody}
                    onChange={(e) =>
                      setModelDraft({
                        ...modelDraft,
                        extraBody: e.target.value,
                      })
                    }
                    placeholder={'{"thinking":{"type":"disabled"}}'}
                    className="font-mono"
                  />
                  <FieldDescription>
                    原样并进请求体的 JSON 对象，留空＝不声明。改名已有参数用
                    paramMap，这里管的是新字段。
                  </FieldDescription>
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-md">
                <Field>
                  <FieldLabel htmlFor="model-context">上下文窗口</FieldLabel>
                  <Input
                    id="model-context"
                    inputMode="numeric"
                    value={modelDraft.contextWindow}
                    onChange={(e) =>
                      setModelDraft({
                        ...modelDraft,
                        contextWindow: e.target.value,
                      })
                    }
                    placeholder="128000"
                  />
                  <FieldDescription>token 数，留空＝不声明。</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="model-max-output">最大输出</FieldLabel>
                  <Input
                    id="model-max-output"
                    inputMode="numeric"
                    value={modelDraft.maxOutputTokens}
                    onChange={(e) =>
                      setModelDraft({
                        ...modelDraft,
                        maxOutputTokens: e.target.value,
                      })
                    }
                    placeholder="16384"
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-md">
                <Field>
                  <FieldLabel htmlFor="model-sort">排序权重</FieldLabel>
                  <Input
                    id="model-sort"
                    inputMode="numeric"
                    value={modelDraft.sort}
                    onChange={(e) =>
                      setModelDraft({ ...modelDraft, sort: e.target.value })
                    }
                    placeholder="999"
                  />
                  <FieldDescription>越小越靠前，默认 999。</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="model-streaming">流式</FieldLabel>
                  <NativeSelect
                    id="model-streaming"
                    value={modelDraft.supportsStreaming ? "yes" : "no"}
                    onChange={(e) =>
                      setModelDraft({
                        ...modelDraft,
                        supportsStreaming: e.target.value === "yes",
                      })
                    }
                  >
                    <option value="yes">支持</option>
                    <option value="no">不支持</option>
                  </NativeSelect>
                  <FieldDescription>
                    声明不支持，调用方就不会走 stream 路径。
                  </FieldDescription>
                </Field>
              </div>
            </FieldGroup>
          </FieldTier>
        </div>
      </DialogForm>

      {/* ── Provider 验证接入 ────────────────────────────────────────────── */}
      <DialogForm
        open={verifyTarget !== null}
        onOpenChange={(open) => {
          if (!open) setVerifyTarget(null);
        }}
        size="sm"
        title={
          verifyTarget ? `验证 ${verifyTarget.providerName}` : "验证 Provider"
        }
        submitLabel="开始验证"
        submitting={verifying}
        onSubmit={(e) => {
          e.preventDefault();
          void runVerify();
        }}
      >
        <Banner
          tone="warning"
          title="会发起真实上游调用并消耗 token"
          description="Atlas 会挑这家名下 modelCode 最小的启用模型跑一次自检（限制 16 token 以内），用量记平台哨兵账、不扣租户配额。与模型自检共用同一个 10 秒冷却。"
        />
      </DialogForm>

      <DialogForm
        open={verifyResult !== null}
        onOpenChange={(open) => {
          if (!open) setVerifyResult(null);
        }}
        title={
          verifyResult ? `验证结果 · ${verifyResult.providerCode}` : "验证结果"
        }
        submitLabel={tShared("common.close")}
        cancelLabel=""
        onSubmit={(e) => {
          e.preventDefault();
          setVerifyResult(null);
        }}
      >
        {verifyResult ? (
          <ProbeReport
            ok={verifyResult.ok}
            lead={`借模型 ${verifyResult.probedModel.modelCode} 验证；${
              verifyResult.probe.keyResolved
                ? "密钥已解析。"
                : "密钥未解析——该 Provider 当前无法真实调用。"
            }`}
            body={verifyResult.probe}
          />
        ) : null}
      </DialogForm>

      {/* ── Model 自检 ───────────────────────────────────────────────────── */}
      <DialogForm
        open={probeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setProbeTarget(null);
        }}
        size="sm"
        title={probeTarget ? `自检 ${probeTarget.modelCode}` : "模型自检"}
        submitLabel="开始自检"
        submitting={probing}
        onSubmit={(e) => {
          e.preventDefault();
          void runProbe();
        }}
      >
        <Banner
          tone="warning"
          title="会发起真实上游调用并消耗 token"
          description="Atlas 侧限制在 16 token 以内，用量记在平台哨兵账上、不扣任何租户配额。同一模型两次自检需间隔 10 秒以上。"
        />
        <p className="text-body-sm text-muted-foreground">
          自检会验证：密钥能否解析、wire 参数的实际生效值、chat 与 stream
          两条路径的连通性与延迟，以及上游是否回传 usage（决定能否计量）。
        </p>
      </DialogForm>

      <DialogForm
        open={probeResult !== null}
        onOpenChange={(open) => {
          if (!open) setProbeResult(null);
        }}
        title={probeResult ? `自检结果 · ${probeResult.modelCode}` : "自检结果"}
        submitLabel={tShared("common.close")}
        cancelLabel=""
        onSubmit={(e) => {
          e.preventDefault();
          setProbeResult(null);
        }}
      >
        {probeResult ? (
          <ProbeReport
            ok={probeResult.ok}
            lead={
              probeResult.keyResolved
                ? "密钥已解析。"
                : "密钥未解析——这个模型当前无法真实调用。"
            }
            body={probeResult}
          />
        ) : null}
      </DialogForm>

      {/* ── 线协议抽屉 ───────────────────────────────────────────────────── */}
      <Drawer
        open={wireTarget !== null}
        onClose={() => setWireTarget(null)}
        width="md"
        title="线协议"
        description={
          wireTarget
            ? `${wireTarget.modelName}（${wireTarget.modelCode}） · ${wireTarget.protocol}`
            : ""
        }
      >
        {wireTarget ? (
          <WireReport
            model={wireTarget}
            provider={providers.find(
              (p) => p.providerCode === wireTarget.provider,
            )}
          />
        ) : null}
      </Drawer>

      {/* ── 密钥抽屉 ─────────────────────────────────────────────────────── */}
      <Drawer
        open={keysProvider !== null}
        onClose={() => {
          setKeysProvider(null);
          setKeys([]);
          setKeysLoad({ kind: "ready" });
        }}
        width="md"
        title="密钥管理"
        description={
          keysProvider
            ? `${keysProvider.providerName}（${keysProvider.providerCode}）`
            : undefined
        }
      >
        {keysProvider ? (
          <div className="flex flex-col gap-lg">
            <Banner
              tone="info"
              title="零明文持有"
              description="密钥只在这里录入一次，之后任何读接口都不会回显——包括这个页面自己。忘记了只能轮换，不能查看。"
            />
            {keysLoad.kind === "loading" ? (
              <EmptyState
                title={tShared("common.loading")}
                description="正在读取密钥清单。"
              />
            ) : keysLoad.kind === "error" ? (
              <EmptyState
                title={tShared("common.loadFailed")}
                description={keysLoad.message}
                action={
                  <Button
                    variant="secondary"
                    onClick={() => void loadKeys(keysProvider.providerCode)}
                  >
                    {tShared("common.retry")}
                  </Button>
                }
              />
            ) : (
              <div className="flex flex-col gap-sm">
                {keys.length === 0 ? (
                  <p className="text-body-sm text-muted-foreground">
                    暂无密钥。
                  </p>
                ) : (
                  keys.map((k) => (
                    <div
                      key={k.id}
                      className="flex items-center justify-between gap-sm rounded-md border border-border p-sm"
                    >
                      <div className="flex flex-col gap-2xs">
                        <div className="flex items-center gap-sm">
                          <span className="font-mono text-code-sm">
                            {k.keyAlias}
                          </span>
                          <Badge variant="outline">
                            {KEY_SCOPES.find((s) => s.value === k.keyScope)
                              ?.label ?? k.keyScope}
                          </Badge>
                          <StatusBadge
                            tone={isEnabled(k.state) ? "success" : "neutral"}
                            dot
                          >
                            {isEnabled(k.state)
                              ? tShared("actions.enable")
                              : tShared("actions.disable")}
                          </StatusBadge>
                        </div>
                        <span className="text-body-sm text-muted-foreground">
                          最近轮换：{k.lastRotatedAt ?? tShared("common.never")}
                        </span>
                      </div>
                      {canManageProviders ? (
                        <ActionMenu
                          label={`${k.keyAlias} 操作`}
                          disabled={submitting}
                          items={[
                            {
                              id: "rotate",
                              label: "轮换",
                              icon: "refresh",
                              onSelect: () => {
                                setPlaintextKey("");
                                setKeyDialog({ kind: "rotate", key: k });
                              },
                            },
                            {
                              id: "toggle",
                              label: isEnabled(k.state)
                                ? tShared("actions.disable")
                                : tShared("actions.enable"),
                              icon: isEnabled(k.state) ? "pause" : "play",
                              onSelect: () => void toggleKeyActive(k),
                            },
                          ]}
                        />
                      ) : null}
                    </div>
                  ))
                )}
                {canManageProviders ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="self-start"
                    onClick={() => {
                      setKeyAlias("");
                      setKeyScope("shared");
                      setPlaintextKey("");
                      setKeyDialog({ kind: "create" });
                    }}
                  >
                    <Icon name="plus" size="sm" aria-hidden="true" />
                    录入密钥
                  </Button>
                ) : null}
              </div>
            )}
          </div>
        ) : null}
      </Drawer>

      <DialogForm
        open={keyDialog !== null}
        onOpenChange={(open) => {
          if (!open) setKeyDialog(null);
        }}
        size="sm"
        title={
          keyDialog?.kind === "rotate"
            ? `轮换「${keyDialog.key.keyAlias}」`
            : "录入密钥"
        }
        description={
          keyDialog?.kind === "rotate"
            ? "新值会替换旧密文，旧值不保留、不可找回。"
            : undefined
        }
        submitLabel={keyDialog?.kind === "rotate" ? "轮换" : "入库"}
        submitting={submitting}
        submitDisabled={
          keyDialog?.kind === "create"
            ? keyAlias.trim() === "" || plaintextKey.trim() === ""
            : plaintextKey.trim() === ""
        }
        onSubmit={submitKeyDialog}
      >
        <FieldGroup>
          {keyDialog?.kind === "create" ? (
            <>
              <Field>
                <FieldLabel htmlFor="key-alias">Alias</FieldLabel>
                <Input
                  id="key-alias"
                  value={keyAlias}
                  onChange={(e) => setKeyAlias(e.target.value)}
                  placeholder="default"
                  className="font-mono"
                />
                <FieldDescription>
                  同一 Provider 下唯一；模型注册时按 Provider + Alias 引用。
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="key-scope">范围</FieldLabel>
                <NativeSelect
                  id="key-scope"
                  value={keyScope}
                  onChange={(e) => setKeyScope(e.target.value)}
                >
                  {KEY_SCOPES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </>
          ) : null}
          <Field>
            <FieldLabel htmlFor="key-plaintext">密钥明文</FieldLabel>
            <Input
              id="key-plaintext"
              type="password"
              value={plaintextKey}
              onChange={(e) => setPlaintextKey(e.target.value)}
              placeholder="sk-…"
              autoComplete="off"
              className="font-mono"
            />
            <FieldDescription>
              提交后立即加密入库，这个页面不会再显示它——包括你自己刷新之后。
            </FieldDescription>
          </Field>
        </FieldGroup>
      </DialogForm>
    </>
  );
}

/**
 * 一个 wire 键的归属：值从 atlas 的 `resolvedWire` 来，来源只按**声明层的存在性**判定。
 *
 * 这条边界是刻意的。判断「谁声明了这个键」只需要看原始层里有没有这个 key——纯存在性，
 * 无歧义。而**算出生效值**要复刻 `applyOverlay` 的逐键合并语义，那是同一个事实的第二个
 * 实现，且失败方式是安静的：渲染出一个从来没有请求用过的描述符。
 */
type WireOrigin = "model" | "provider" | "merged" | "default";

const WIRE_ORIGIN_LABEL: Record<WireOrigin, string> = {
  model: "本模型覆盖",
  provider: "Provider 覆盖",
  /**
   * 对象类的键（`headers` / `supports` / `paramMap`）是**逐子键**合并的，所以多层
   * 同时声明时，生效值里每个子键可能来自不同的层。
   *
   * 实测过一个真实例子：`supports` 的四个子键分别来自三层——`temperature` 是协议
   * 默认、`topP` 来自 Provider、`tools`/`toolChoice` 被本模型改成 false。此时标
   * 「本模型覆盖」会让人以为整个值由模型定，那是**这个抽屉自己在撒谎**，而它存在的
   * 理由恰恰是消灭这种误读。
   */
  merged: "多层合并",
  default: "协议默认",
};

const WIRE_ORIGIN_TONE: Record<
  WireOrigin,
  "info" | "warning" | "neutral" | "danger"
> = {
  model: "info",
  provider: "warning",
  merged: "info",
  default: "neutral",
};

/** `config.wire` 里有没有这个键。不看值——值由上游合并后给出。 */
function declaresWireKey(
  config: Record<string, unknown> | null | undefined,
  key: string,
): boolean {
  const wire = config?.["wire"];
  if (typeof wire !== "object" || wire === null || Array.isArray(wire)) {
    return false;
  }
  return key in (wire as Record<string, unknown>);
}

function wireOriginOf(
  key: string,
  value: unknown,
  model: AiModelRecord,
  provider: ModelProviderRecord | undefined,
): WireOrigin {
  const byModel = declaresWireKey(model.config, key);
  const byProvider = declaresWireKey(provider?.config, key);

  /* 对象类的键逐子键合并，所以两层都声明时**没有哪一层"赢了"**——生效值里不同的
     子键来自不同的层，甚至还留着协议默认的那一份。标成任何单一来源都是误导。 */
  if (byModel && byProvider && value !== null && typeof value === "object") {
    return "merged";
  }
  /* 标量键才有"压过"这回事，顺序与上游一致：模型压 provider，provider 压协议默认。 */
  if (byModel) return "model";
  if (byProvider) return "provider";
  return "default";
}

/**
 * 值怎么显示。对象类的键（headers / supports / paramMap / extraBody）平铺成一行行
 * `k=v`。
 *
 * 子值用 `JSON.stringify` 而不是 `String`：前七个键的子值都是标量，`extraBody`
 * 的不是——DeepSeek 关思考的开关是 `thinking: {"type":"disabled"}`，`String()`
 * 会把它渲染成 `thinking=[object Object]`，也就是把唯一要看的那部分吃掉。
 */
function formatWireValue(value: unknown): string {
  if (value === null) return "—（用适配器默认）";
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return entries.length
      ? entries
          .map(
            ([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`,
          )
          .join("  ")
      : "—（空）";
  }
  return String(value);
}

/**
 * 线协议抽屉：这个模型**实际跑的**线描述符，以及每个键由哪一层定的。
 *
 * 存在的理由是 `behaviorVersion` 旁边的一个洞：它说「配置动了」，但想知道**动成了
 * 什么**，此前只能跑一次自检——而自检是真实上游调用、要烧 token。便宜的信号指向一个
 * 昂贵的答案，结果就是没人去问。atlas 2026-08-24 起直发 `resolvedWire`，这里把它接出来。
 */
function WireReport({
  model,
  provider,
}: {
  readonly model: AiModelRecord;
  readonly provider: ModelProviderRecord | undefined;
}) {
  const wire = model.resolvedWire;
  const rows: ReadonlyArray<{ key: string; value: unknown }> = [
    { key: "chatPath", value: wire.chatPath },
    { key: "auth", value: wire.authStyle },
    { key: "streamUsage", value: wire.streamUsage },
    { key: "headers", value: wire.headers },
    { key: "supports", value: wire.supports },
    { key: "paramMap", value: wire.paramMap },
    /* v2 加的第八个键。它此前不在这张表里，于是一个靠 `extraBody` 才跑得起来的
       模型（关掉思考的 DeepSeek）在这个抽屉里看不到自己真正的开关——抽屉存在的
       理由是「实际跑什么」，少一个键就是把它变回一句半真话。 */
    { key: "extraBody", value: wire.extraBody },
  ];

  return (
    <div className="flex flex-col gap-md">
      <Banner
        tone="info"
        title="这是生效值，不是声明值"
        description={`协议默认 ← Provider 的 config.wire ← 本模型的，三层叠加后的结果，由 Atlas 合并（wire schema v${wire.schemaVersion}）。标签指出每个键由哪一层声明——那是存在性判断；合并本身不在门户做，逐键合并的语义只有一份，在上游。`}
      />
      <dl className="flex flex-col gap-sm">
        {rows.map((r) => {
          const origin = wireOriginOf(r.key, r.value, model, provider);
          return (
            <div
              key={r.key}
              className="flex flex-col gap-2xs rounded-md border border-border p-sm"
            >
              <div className="flex items-center justify-between gap-sm">
                <dt className="font-mono text-code-sm">{r.key}</dt>
                <StatusBadge tone={WIRE_ORIGIN_TONE[origin]} dot>
                  {WIRE_ORIGIN_LABEL[origin]}
                </StatusBadge>
              </div>
              <dd className="font-mono text-code-sm break-all text-muted-foreground">
                {formatWireValue(r.value)}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

/** 两处探测结果共用一份呈现——provider 探测的 body 就是一次模型自检。 */
function ProbeReport({
  ok,
  lead,
  body,
}: {
  readonly ok: boolean;
  readonly lead: string;
  readonly body: ModelProbeBody;
}) {
  return (
    <div className="flex flex-col gap-md">
      <Banner
        tone={ok ? "success" : "danger"}
        title={ok ? "接入正常" : "接入异常"}
        description={lead}
      />
      <dl className="grid grid-cols-2 gap-sm text-body-sm">
        <dt className="text-muted-foreground">协议（生效值）</dt>
        <dd className="font-mono">
          {body.resolvedProtocol ?? "—（走了回退层）"}
        </dd>
        <dt className="text-muted-foreground">适配器</dt>
        <dd className="font-mono">{body.adapter}</dd>
        <dt className="text-muted-foreground">Endpoint</dt>
        <dd className="font-mono break-all">{body.endpointUrl}</dd>
      </dl>
      <div className="flex flex-col gap-sm">
        {body.checks.map((c) => (
          <div
            key={c.mode}
            className="flex items-center justify-between gap-sm rounded-md border border-border p-sm"
          >
            <div className="flex items-center gap-sm">
              <StatusBadge tone={c.ok ? "success" : "danger"} dot>
                {c.mode}
              </StatusBadge>
              <span className="text-body-sm text-muted-foreground">
                {c.latencyMs != null ? `${c.latencyMs}ms` : "—"}
                {c.totalTokens != null ? ` · ${c.totalTokens} tokens` : ""}
              </span>
            </div>
            {/* 计量结论只在检查通过时才说得出口。失败的检查上 usageReported
                恒为 false，把它渲染成「未回 usage（无法计量）」是在陈述一个没有
                发生过的观测——真正的原因在下面的错误行里。

                `usageReported && !contentReceived` 单独喊出来：那是回了 usage
                却一个 token 都没交付的组合，也就是旧自检会判成绿灯的那一种。 */}
            <span className="text-body-sm">
              {!c.ok ? (
                <span className="text-danger-foreground">
                  {c.usageReported && !c.contentReceived
                    ? "回了 usage，但没有交付任何内容"
                    : (c.error?.code ?? "未通过")}
                </span>
              ) : c.usageReported ? (
                <span className="text-muted-foreground">已回 usage</span>
              ) : (
                <span className="text-warning-foreground">
                  未回 usage（无法计量）
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
      {body.checks.some((c) => c.error) ? (
        <div className="flex flex-col gap-2xs">
          {body.checks
            .filter((c) => c.error)
            .map((c) => (
              <p
                key={`${c.mode}-err`}
                className="text-body-sm text-muted-foreground break-all"
              >
                <span className="font-mono">{c.mode}</span>：{c.error?.message}
              </p>
            ))}
        </div>
      ) : null}
    </div>
  );
}
