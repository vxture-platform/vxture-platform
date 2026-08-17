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
import {
  deleteDescription,
  deleteFailureToast,
  formatDependentCount,
} from "@/features/atlas/lifecycle";
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
  isActive: boolean;
  health?: { status: ProviderHealthStatus };
  /** 名下未删除的模型数（不论启停）——挡住删除的就是这个数。 */
  modelCount?: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * **模型的状态是三值**：`active` / `inactive` / `deprecated`。
 *
 * `deprecated` = 仍可解析、不再推荐——它的 `isActive` 仍是 true。所以这一档
 * **不能**用「启用/停用」那个布尔表达，这正是 product_251 B-3 要枚举不要布尔的原句。
 * provider / 密钥仍是两值，故本页只有模型这一处读 `state`。
 */
type ModelState = "active" | "inactive" | "deprecated";

interface AiModelRecord {
  id: string;
  providerId: string | null;
  modelCode: string;
  modelName: string;
  provider: string;
  endpointUrl: string;
  protocol: string;
  capabilities: string[];
  keyReference: { source: "env"; name: string; configured: boolean } | null;
  state: ModelState;
  /**
   * 何时弃用的——运营要判断「还剩多久」，光知道「是否」不够。
   * 可选：旧 atlas 根本没有这个字段（归一层只补 `state`，不编造时间）。
   */
  deprecatedAt?: string | null;
  /** @deprecated 布尔装不下 `deprecated`；仅存量代码在读，改完即删。 */
  isActive: boolean;
  /** 引用它的未删除授权数（旧的租户轴，管理面在 admin）。挡删除。 */
  grantCount?: number;
  /** 把它挂作 primary **或 fallback** 的未删除 endpoint 数。挡删除。 */
  endpointRefCount?: number;
  createdAt: string;
  updatedAt: string;
}

interface ProviderKeyRecord {
  id: string;
  providerCode: string;
  keyAlias: string;
  keyScope: string;
  isActive: boolean;
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
  capabilities: string[];
  keyReferenceName: string;
}

function emptyModelDraft(providerId: string, protocol: string): ModelDraft {
  return {
    modelCode: "",
    modelName: "",
    providerId,
    endpointUrl: "",
    protocol,
    capabilities: ["chat"],
    keyReferenceName: "",
  };
}

function modelDraftFrom(row: AiModelRecord): ModelDraft {
  return {
    modelCode: row.modelCode,
    modelName: row.modelName,
    providerId: row.providerId ?? "",
    endpointUrl: row.endpointUrl,
    protocol: row.protocol,
    capabilities: [...row.capabilities],
    keyReferenceName: row.keyReference?.name ?? "",
  };
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
        (statusFilter === "active" ? !p.isActive : p.isActive)
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
    () => providers.filter((p) => p.isActive || p.id === modelDraft.providerId),
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

    const payload = {
      providerCode: providerDraft.providerCode.trim(),
      providerName: providerDraft.providerName.trim(),
      providerType: providerDraft.providerType,
      description: providerDraft.description.trim() || null,
      /* `logoUrl` 不进载荷：opera 不再录入也不再展示。Atlas 侧对**未出现**的键按
         「不改」处理，所以老数据不会被这里的保存悄悄抹掉。 */
      homepageUrl: providerDraft.homepageUrl.trim() || null,
      consoleUrl: providerDraft.consoleUrl.trim() || null,
      billingUrl: providerDraft.billingUrl.trim() || null,
    };

    setSubmitting(true);
    try {
      if (providerDialog.kind === "create") {
        await api.post("/api/atlas/providers", payload);
        toast({
          tone: "success",
          title: `${providerDraft.providerName} 已接入`,
        });
      } else {
        await api.patch(
          `/api/atlas/providers/${providerDialog.row.id}`,
          payload,
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
      providerId ?? providers.find((p) => p.isActive)?.id ?? "";
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
    const payload = {
      modelCode: modelDraft.modelCode.trim(),
      modelName: modelDraft.modelName.trim(),
      providerId: modelDraft.providerId || null,
      provider: provider?.providerCode ?? modelDraft.providerId,
      endpointUrl: modelDraft.endpointUrl.trim(),
      protocol: modelDraft.protocol,
      capabilities: modelDraft.capabilities,
      keyReference: modelDraft.keyReferenceName.trim()
        ? { source: "env" as const, name: modelDraft.keyReferenceName.trim() }
        : null,
    };

    setSubmitting(true);
    try {
      if (modelDialog.kind === "create") {
        await api.post("/api/atlas/models", payload);
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
        await api.patch(`/api/atlas/models/${modelDialog.row.id}`, payload);
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
          `/api/atlas/provider-keys/${key.id}/${key.isActive ? "deactivate" : "activate"}`,
          {},
        ),
      );
      toast({
        tone: "success",
        title: `密钥「${key.keyAlias}」已${key.isActive ? "停用" : "启用"}`,
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
              header: "协议",
              align: "center",
              width: "xs",
              cell: (m: AiModelRecord) => m.protocol,
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
                  {m.endpointRefCount === undefined ? (
                    <span className="text-muted-foreground">入口 —</span>
                  ) : m.endpointRefCount === 0 ? (
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
                    授权 {formatDependentCount(m.grantCount)}
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
            description="供应商与它名下的模型。展开一行看归属：模型永远挂在某一家 Provider 下，两者都启用才可服务——「健康」列从真实流量派生、不做周期探活，要立刻得到结论用行操作里的「验证接入」。"
            action={
              <div className="flex items-center gap-sm">
                {canManageModels ? (
                  <Button
                    variant="outline"
                    onClick={() => openModelCreate()}
                    disabled={submitting || !providers.some((p) => p.isActive)}
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
                  const activeCount = owned.filter((m) => m.isActive).length;
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
                  <StatusBadge tone={r.isActive ? "success" : "neutral"} dot>
                    {r.isActive ? "启用" : "停用"}
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
                          disabled: !canManageModels || !r.isActive,
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
                        r.isActive
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
        title={editingProvider ? "编辑 Provider" : "接入 Provider"}
        submitLabel={editingProvider ? "保存" : "接入"}
        submitting={submitting}
        submitDisabled={!providerDraftValid}
        onSubmit={submitProvider}
      >
        {/* 三档（DS `FieldTier`）：身份 = 决定这是哪一家、创建后改不了；常规 = 运营
            真正会用到的；高级 = 填不填都行。**不平铺**——八个字段一长串时，读的人
            无从判断哪些必须停下来想，结果要么每栏都想一遍要么一路 Tab 过去。 */}
        <FieldTier
          tier="identity"
          hint="决定这是哪一家。Code 与类型创建后改不了——Atlas 的列锁只给这两列 INSERT，不给 UPDATE。"
        >
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
              全局唯一，模型注册时引用它。创建后不可改：改它等于换一家供应商，而它
              名下的模型仍指着原来那条。
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
            <FieldDescription>
              同样创建后不可改（与 Code 同一把列锁）。
            </FieldDescription>
          </Field>
        </FieldTier>

        <FieldTier
          tier="details"
          hint="运营时真正会用到的：密钥要轮换时去对方控制台，成本异常时去账单页。"
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
                密钥轮换、配额调整都在对方控制台做，填了就能从行上直接跳过去。
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
                Atlas
                计量但不计费（ADR-004），真实花了多少钱只有对方账单页知道。
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
              <FieldDescription>
                纯登记，运营流程上用不到——放在高级档就是这个意思。
              </FieldDescription>
            </Field>
          </div>
        </FieldTier>
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
        description={deleteDescription(
          providerDialog?.kind === "delete"
            ? providerDialog.row.modelCount
            : undefined,
          "两条前置条件：这家必须已经停用，且名下没有未删除的模型（不论启停）。不满足会被拒绝并点名是哪些模型挡住了——不会级联删除任何模型或授权。",
          "⚠ 这台 Atlas 还没有删除前置条件（响应里没有模型数）。在这个版本上删除 Provider 会**级联软删它名下的所有模型，以及那些模型上的每一条租户授权**——一次点击撤销租户从未同意交出的访问权，且不可撤销。先手动清空，或升级 Atlas 之后再删。",
        )}
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
        size="lg"
        title={editingModel ? "编辑模型" : "注册模型"}
        description="编码是业务侧唯一认得的标识，注册后不建议再改。"
        submitLabel={editingModel ? "保存" : "注册"}
        submitting={submitting}
        submitDisabled={!modelDraftValid}
        onSubmit={submitModel}
      >
        {/* 两档（DS `FieldTier`）。**没有高级档**：这七项没有一项是可留空的，
            凑一个空高级档只是把规则抄一遍。 */}
        <FieldTier
          tier="identity"
          hint="编码创建后不可改；Provider 只列启用中的——模型可用的前提是它和 Provider 都启用。"
        >
          <FieldGroup>
            <div className="grid grid-cols-2 gap-md">
              <Field>
                <FieldLabel htmlFor="model-code">编码</FieldLabel>
                <Input
                  id="model-code"
                  value={modelDraft.modelCode}
                  onChange={(e) =>
                    setModelDraft({ ...modelDraft, modelCode: e.target.value })
                  }
                  placeholder="gpt-5-mini"
                  disabled={editingModel}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="model-name">名称</FieldLabel>
                <Input
                  id="model-name"
                  value={modelDraft.modelName}
                  onChange={(e) =>
                    setModelDraft({ ...modelDraft, modelName: e.target.value })
                  }
                  placeholder="GPT-5 Mini"
                />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="model-provider">Provider</FieldLabel>
              <NativeSelect
                id="model-provider"
                value={modelDraft.providerId}
                onChange={(e) =>
                  setModelDraft({ ...modelDraft, providerId: e.target.value })
                }
              >
                {activeProviders.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.providerName}
                    {p.isActive ? "" : "（已停用）"}
                  </option>
                ))}
              </NativeSelect>
              <FieldDescription>
                只列启用中的 Provider——一个模型可用的前提是它**和它的 Provider
                都启用**，数据面同样按这条判。当前已经挂着的那个即使停用了也会留在列表里。
              </FieldDescription>
            </Field>
          </FieldGroup>
        </FieldTier>

        <FieldTier
          tier="details"
          hint="接入参数：填错要到第一次真实调用才暴露。"
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="model-endpoint">Endpoint URL</FieldLabel>
              <Input
                id="model-endpoint"
                value={modelDraft.endpointUrl}
                onChange={(e) =>
                  setModelDraft({ ...modelDraft, endpointUrl: e.target.value })
                }
                placeholder="https://api.openai.com/v1"
              />
            </Field>
            <div className="grid grid-cols-2 gap-md">
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
                    ? (protocols.find((p) => p.protocol === modelDraft.protocol)
                        ?.description ?? "来自 Atlas 的协议词表。")
                    : "协议词表读取失败——只能保留当前值。这里不列一份手写的候选：选到 Atlas 不认的协议，要到第一次真实调用才会暴露。"}
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="model-key">
                  密钥引用（env 变量名）
                </FieldLabel>
                <Input
                  id="model-key"
                  value={modelDraft.keyReferenceName}
                  onChange={(e) =>
                    setModelDraft({
                      ...modelDraft,
                      keyReferenceName: e.target.value,
                    })
                  }
                  placeholder="OPENAI_API_KEY"
                />
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
        description={deleteDescription(
          modelDialog?.kind === "delete"
            ? modelDialog.row.endpointRefCount
            : undefined,
          "两条前置条件：这个模型必须已经下线，且没有任何入口或授权还在引用它（入口引用把 fallback 也算进去）。不满足会被拒绝并点名是什么挡住了——不会级联删除任何东西。",
          "⚠ 这台 Atlas 还没有删除前置条件（响应里没有被引用计数）。在这个版本上删除不会检查还有谁在引用它：仍指着它的 Endpoint 会变成一条断链，正在用它的调用会开始失败。先自己确认没有引用再删，或升级 Atlas。",
        )}
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
          自检会验证：密钥能否解析、适配器与 wire 参数的实际生效值、chat 与
          stream 两条路径的连通性与延迟，以及**上游有没有回传
          usage**（决定这个模型能否被真实计量）。
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
                            tone={k.isActive ? "success" : "neutral"}
                            dot
                          >
                            {k.isActive ? "启用" : "停用"}
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
                              label: k.isActive ? "停用" : "启用",
                              icon: k.isActive ? "pause" : "play",
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
