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
  Pagination,
  StatusBadge,
  TableTitleCell,
  Textarea,
  ViewHeader,
  useListPagination,
  useToast,
  type StatusBadgeTone,
} from "@vxture/design-system";
import { useOperatorSession } from "@/features/session/SessionProvider";
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
  usageReported: boolean;
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
function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString("zh-CN", { hour12: false });
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
}

const EMPTY_PROVIDER_DRAFT: ProviderDraft = {
  providerCode: "",
  providerName: "",
  providerType: "online",
  description: "",
  homepageUrl: "",
  consoleUrl: "",
  billingUrl: "",
};

function providerDraftFrom(row: ModelProviderRecord): ProviderDraft {
  return {
    providerCode: row.providerCode,
    providerName: row.providerName,
    providerType: row.providerType,
    description: row.description ?? "",
    homepageUrl: row.homepageUrl ?? "",
    consoleUrl: row.consoleUrl ?? "",
    billingUrl: row.billingUrl ?? "",
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
  };
}

/**
 * 组装送给 atlas 的 `config`。
 *
 * atlas 的 update 只要载荷里出现 `keyReference` 或 `config`，就会**整体替换**
 * 存量 config（`mergeModelConfig` 不与库里旧值合并）——而本表单每次保存都送
 * keyReference。不把既有 config 一并送回去，一次普通编辑就会把 `config.wire`
 * 覆盖与 `upstreamModel` 悄悄抹平。读回的 config 已被 atlas 剥掉密钥类键
 * （managedKeyAlias 由它按 keyReference 自己并回去），round-trip 无损。
 */
function buildModelConfig(
  existing: Record<string, unknown> | null,
  upstreamModel: string,
): Record<string, unknown> | null {
  const next: Record<string, unknown> = { ...(existing ?? {}) };
  delete next["upstreamModel"];
  const trimmed = upstreamModel.trim();
  if (trimmed) next["upstreamModel"] = trimmed;
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

type ProviderDialog =
  | { kind: "create" }
  | { kind: "edit"; row: ModelProviderRecord }
  | { kind: "delete"; row: ModelProviderRecord }
  | null;

type ModelDialog =
  | { kind: "create" }
  | { kind: "edit"; row: AiModelRecord }
  | { kind: "delete"; row: AiModelRecord }
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

  /* 协议词表单独取、失败不挡页面：它只喂一个下拉。 */
  useEffect(() => {
    void api
      .get<{ protocols: ProtocolCatalogEntry[] }>("/api/atlas/protocols")
      .then((r) => setProtocols(r.protocols))
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

  async function submitProvider(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!providerDialog) return;

    if (providerDialog.kind === "delete") {
      const row = providerDialog.row;
      setProviderDialog(null);
      setSubmitting(true);
      try {
        await api.delete(`/api/atlas/providers/${row.id}`);
        toast({ tone: "success", title: `${row.providerName} 已删除` });
        await reload();
      } catch (error) {
        toast({ tone: "danger", ...deleteFailureToast(error, "删除失败") });
      } finally {
        setSubmitting(false);
      }
      return;
    }

    /* 可改的那些。`logoUrl` 不进载荷：opera 不再录入也不再展示，而 Atlas 对**未出现**
       的键按「不改」处理，所以老数据不会被这里的保存悄悄抹掉。 */
    const mutable = {
      providerName: providerDraft.providerName.trim(),
      description: providerDraft.description.trim() || null,
      homepageUrl: providerDraft.homepageUrl.trim() || null,
      consoleUrl: providerDraft.consoleUrl.trim() || null,
      billingUrl: providerDraft.billingUrl.trim() || null,
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

  async function submitModel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!modelDialog) return;

    if (modelDialog.kind === "delete") {
      const row = modelDialog.row;
      setModelDialog(null);
      setSubmitting(true);
      try {
        await api.delete(`/api/atlas/models/${row.id}`);
        toast({ tone: "success", title: `${row.modelName} 已删除` });
        await reload();
      } catch (error) {
        toast({ tone: "danger", ...deleteFailureToast(error, "删除失败") });
      } finally {
        setSubmitting(false);
      }
      return;
    }

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
                      ? `弃用于 ${formatTime(m.deprecatedAt)}`
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
                        onSelect: () =>
                          setModelDialog({ kind: "delete", row: m }),
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
      <EmptyState title="读取中…" description="正在读取 Provider 与模型。" />
    ) : load.kind === "error" ? (
      <EmptyState
        title="读取失败"
        description={load.message}
        action={
          <Button variant="secondary" onClick={() => void reload()}>
            重试
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
            cardsDisabledReason="卡片视图已下线，改用列表"
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
              aria-label="状态筛选"
            >
              <option value="all">全部状态</option>
              <option value="active">启用</option>
              <option value="inactive">停用</option>
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
                header: "类型",
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
                header: "健康",
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
                header: "状态",
                align: "center",
                width: "xs",
                cell: (r: ModelProviderRecord) => (
                  <StatusBadge
                    tone={isEnabled(r.state) ? "success" : "neutral"}
                    dot
                  >
                    {isEnabled(r.state) ? "启用" : "停用"}
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
                          label: "编辑",
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
                              label: "停用",
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
                              label: "启用",
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
                          label: "删除",
                          icon: "trash",
                          danger: true,
                          onSelect: () =>
                            setProviderDialog({ kind: "delete", row: r }),
                        },
                      ]}
                    />
                  ),
                }
              : {})}
            footer={
              <Pagination
                className="w-full"
                page={pager.page}
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
        submitLabel={editingProvider ? "保存" : "接入"}
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
                <FieldLabel htmlFor="provider-type">类型</FieldLabel>
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

      <DialogForm
        open={providerDialog?.kind === "delete"}
        onOpenChange={(open) => {
          if (!open) setProviderDialog(null);
        }}
        size="sm"
        danger
        title={
          providerDialog?.kind === "delete"
            ? `删除 ${providerDialog.row.providerName}`
            : "删除 Provider"
        }
        description="两条前置条件：这家必须已经停用，且名下没有未删除的模型（不论启停）。不满足会被拒绝并点名是哪些模型挡住了——不会级联删除任何模型或授权。"
        submitLabel="删除"
        submitting={submitting}
        onSubmit={submitProvider}
      />

      {/* ── Model 表单 ───────────────────────────────────────────────────── */}
      <DialogForm
        open={modelDialog?.kind === "create" || editingModel}
        onOpenChange={(open) => {
          if (!open) setModelDialog(null);
        }}
        size="xl"
        title={editingModel ? "编辑模型" : "注册模型"}
        description="一条模型＝从某家 Provider 接入的某个模型。编码与类型创建后不可改，其余随时可调。"
        submitLabel={editingModel ? "保存" : "注册"}
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
                  <FieldLabel htmlFor="model-type">类型</FieldLabel>
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

          {/* 容量与呈现：全部可留空，留空 = 用 atlas 自己的默认，不是 0。 */}
          <FieldTier tier="advanced" hint="都可留空，留空＝用 Atlas 默认。">
            <FieldGroup>
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

      <DialogForm
        open={modelDialog?.kind === "delete"}
        onOpenChange={(open) => {
          if (!open) setModelDialog(null);
        }}
        size="sm"
        danger
        title={
          modelDialog?.kind === "delete"
            ? `删除 ${modelDialog.row.modelCode}`
            : "删除模型"
        }
        description="两条前置条件：这个模型必须已经下线，且没有任何入口或授权还在引用它（入口引用把 fallback 也算进去）。不满足会被拒绝并点名是什么挡住了——不会级联删除任何东西。"
        submitLabel="删除"
        submitting={submitting}
        onSubmit={submitModel}
      />

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
        submitLabel="关闭"
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
        submitLabel="关闭"
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
              <EmptyState title="读取中…" description="正在读取密钥清单。" />
            ) : keysLoad.kind === "error" ? (
              <EmptyState
                title="读取失败"
                description={keysLoad.message}
                action={
                  <Button
                    variant="secondary"
                    onClick={() => void loadKeys(keysProvider.providerCode)}
                  >
                    重试
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
                            {isEnabled(k.state) ? "启用" : "停用"}
                          </StatusBadge>
                        </div>
                        <span className="text-body-sm text-muted-foreground">
                          最近轮换：{k.lastRotatedAt ?? "从未"}
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
                              label: isEnabled(k.state) ? "停用" : "启用",
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

/** 值怎么显示。对象类的键（headers / supports / paramMap）平铺成一行行 `k=v`。 */
function formatWireValue(value: unknown): string {
  if (value === null) return "—（用适配器默认）";
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return entries.length
      ? entries.map(([k, v]) => `${k}=${String(v)}`).join("  ")
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
            <span className="text-body-sm">
              {c.usageReported ? (
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
