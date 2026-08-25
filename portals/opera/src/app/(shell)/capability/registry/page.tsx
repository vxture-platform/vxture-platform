"use client";

/* Capability — Runos 四原语（连接器/技能/执行器/资产）统一注册台账。
 *
 * 2026-08-11 接真实数据：opera-bff 的 runos.router.ts 直接代理 Runos 真实的
 * `/capability/capabilities` + `/capability/endpoints`（vxture-runos
 * service/src/registry/registry.controller.ts 是权威契约）。M1 只登记
 * connector/executor 两种原语，Policy/Credential/Quality Profile/Audit/
 * Supply Catalog/Plugin 六块 Runos 侧还没有对应接口，继续留在各自的
 * "规划中"占位页，这里不假装能管。
 *
 * 2026-08-12 补 Skill 注册 + certified 审核（liaison #248，ADR-009，已合并到
 * runos main）：primitiveType 现在接受 "skill"，asset 仍拒绝——asset 相关选项
 * 不加。Skill 的 operations 系统强制恰好一条 fetch（riskLevel=read，
 * interactionMode=sync），不给用户填这段，提交时前端直接拼死。Skill 的
 * content 目前是直接提交的 JSON 字符串字段，不是真实的 plugin 文件包——
 * capabilityReferences 是注册方自己声明的，不是从内容解析出来的，两者都等
 * runos 侧的 plugin ingest pipeline 落地后再升级，这里如实做成 JSON textarea
 * 而不是假装有解析。四项 certified 审核清单名称固定
 * （prompt_injection_surface/secret_handling/dangerous_operation_surface/
 * provenance），不是可配置项，outcome 由 Runos 服务端算，opera 不接受直传。
 * 同批（#249/#250）Credential 与 Grant 也有了真实端点，那两页已从"规划中"
 * 占位换成真表单——上面 2026-08-11 那段列的"六块都还没接口"只对当时成立，
 * 现在只剩 Policy / Quality Profile / Audit / Plugin 四块仍是占位。
 *
 * Endpoint 没有独立的列表接口——它永远挂在某个 capability 的某个版本下，注册
 * 与查看都在这个页面的详情抽屉里做，不单独开一页假装有独立集合。
 *
 * 2026-08-13 补四样写路由（runos `incr/04`，起于 `vxture-runos#65`）。这四个
 * 字段**在 runos 库里一直可写、只是没有路由**，所以此前"注册进去就再也改不动"：
 *   - **元数据编辑**（`PATCH /capability/capabilities/:id`）：只有 title 与
 *     ownerRef。`providerId` **刻意不给编辑**——runos `98_column_locks.sql` 把它
 *     列为身份列，provider 转让是另一件受治理的事、要另一条路由（M1 不存在）。
 *     这里不放这个字段，免得有人以为是漏了。
 *   - **版本退役**（`PATCH .../versions/:v/state`，v0.8.0 由 `lifecycle` 改名）：`deprecated`（仍可解析，
 *     只是打信号）/ `withdrawn`（从快照掉出去）。**到不了 stable**，晋升是另一条
 *     路由。withdraw 一个当前被 stable 别名指着的版本，会连带删掉 stable 别名，
 *     该能力将**暂时没有 stable 可解析**——所以这个确认框必须说清楚。
 *   - **official 准入档**（`POST .../official`）：仅第一方
 *     （arda/karda/terra/ontos/runos），非第一方 runos 直接 409。
 *     `experimental → certified` 不走这里，走认证清单。
 *   - **重算发现向量**（`POST .../versions/:v/reembed`）：换了 embedding 模型、
 *     或注册那次 embed 失败了，此前没有回头路。**当前禁用**——runos 绑的是
 *     `NullEmbeddingProvider`（恒返回 null），调用必然 409；全库 347 个版本的
 *     `embedding` 列全空。检索按设计是关键词匹配，嵌入是将来的替换实现。
 *
 * 因此页面顶部原来那条"注册后无法下架（TD-010）"横幅已撤——它当时是对的，现在
 * 不是了。 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import {
  ActionMenu,
  Badge,
  Banner,
  Button,
  Checkbox,
  DataTable,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
  Section,
  StatusBadge,
  TableTitleCell,
  Textarea,
  ViewHeader,
  useListPagination,
  useToast,
  type StatusBadgeTone,
} from "@vxture/design-system";
import { useOperatorSession } from "@/features/session/SessionProvider";
import { api, OperaApiError } from "@/lib/api";
import { confirmLabels } from "@/lib/destructive";
import { RISK_LEVEL_META } from "@/lib/status";

const MANAGE = "capability:runos.manage";

/**
 * 本控制台的展示语言。**写死而不是读浏览器**：opera 是中文控制台，运营者之间对
 * 一个能力的称呼要一致；跟着浏览器变，等于两个人看同一行说的是两个名字。
 */
const CONSOLE_LOCALE = "zh-CN";

/**
 * 一个能力的三个名字各有各的职责，**一个都不能省**：
 *
 * | 字段 | 是什么 | 谁在什么场合看它 |
 * | --- | --- | --- |
 * | `displayName[locale]` | 业务语言的名字 | 与 agent 对话的最终用户 |
 * | `title` | **运营名**（契约原话：title remains the operational name） | 运营者、跨仓沟通 |
 * | `capabilityId` | 机器标识 | 审计行、端点、授权、检索 |
 *
 * 所以主名换成 `displayName` 之后，`capabilityId` **仍然必须在行上看得见**——审计
 * 事件里出现的是它，控制台只显示业务名会让人在两者之间对不上号。这与导航保留英文
 * 原词是同一条判断。
 *
 * 回落**只落到 `title`，不跨 locale**（契约 §3.2）：拿 `en` 顶替缺失的 `zh-CN`，
 * 会让人读到一个语言不明的名字却以为那就是中文名。
 */
function resolveNames(r: {
  capabilityId: string;
  title: string;
  displayName?: Record<string, string>;
}): {
  /** 行上的主名。 */
  primary: string;
  /** 与主名不同时才需要另外显示的运营名；相同则为 null。 */
  operational: string | null;
  /** 有别的语言的名字、但没有本控制台这门语言的——运营者该去补一个。 */
  missingConsoleLocale: boolean;
  /** 除本控制台语言外还登记了哪些语言。 */
  otherLocales: string[];
} {
  const map = r.displayName ?? {};
  const localized = map[CONSOLE_LOCALE]?.trim();
  const others = Object.keys(map).filter(
    (k) => k !== CONSOLE_LOCALE && (map[k] ?? "").trim() !== "",
  );
  const primary = localized || r.title;
  return {
    primary,
    operational: localized && localized !== r.title ? r.title : null,
    missingConsoleLocale: !localized && others.length > 0,
    otherLocales: others,
  };
}

interface CapabilityRecord {
  capabilityId: string;
  primitiveType: string;
  providerId: string;
  ownerRef: string;
  /** **运营名**（runos 契约原话：`title` remains the operational name）。 */
  title: string;
  /** 面向最终用户的名字，按 locale 分键。库里默认 `{}`，落后的部署不回这个字段。 */
  displayName?: Record<string, string>;
  admissionTier: string;
  /** 15 选 1。v0.5.0 起注册必填——落后的部署不回这个字段，所以可选。 */
  category?: string;
  /** 0..8 个。 */
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

/**
 * 能力分类法（runos `incr/07`，v0.5.0 起**强制**）。
 *
 * 顺序照 runos 文档原样，不按字母重排——那份词表是分组给出的
 * （通信/CRM/支持/研发运维/安全 · 财务/人事/交易/市场/数据 · 文档/效率/开发/法务/其他），
 * 重排会把这个分组读没了。
 *
 * **`other` 是真实选项，不是缺省回落**：所以表单不预选任何一项，逼一次显式选择。
 * 前端替人补一个默认分类，等于替运营做了判断还不告诉他——而这个字段会进
 * `runos_discover` 的检索面，选错了是业务 agent 找不到这个能力。
 */
const CATEGORIES = [
  { value: "communication", label: "communication · 通信" },
  { value: "crm", label: "crm · 客户关系" },
  { value: "support", label: "support · 客服支持" },
  { value: "devops", label: "devops · 研发运维" },
  { value: "security", label: "security · 安全" },
  { value: "finance", label: "finance · 财务" },
  { value: "hr", label: "hr · 人事" },
  { value: "commerce", label: "commerce · 交易" },
  { value: "marketing", label: "marketing · 市场" },
  { value: "data", label: "data · 数据" },
  { value: "documents", label: "documents · 文档" },
  { value: "productivity", label: "productivity · 效率" },
  { value: "development", label: "development · 开发" },
  { value: "legal", label: "legal · 法务" },
  { value: "other", label: "other · 其他" },
] as const;

/** runos 侧的 tag 规则：0..8 个，`^[a-z0-9][a-z0-9-]{1,31}$`。 */
const TAG_PATTERN = /^[a-z0-9][a-z0-9-]{1,31}$/;
const MAX_TAGS = 8;

/**
 * 校验 tag 列表，**判据逐字照抄 runos**——前端算宽了会让人以为填对了然后被 400，
 * 算严了会挡住合法输入。返回第一条不合规的说明，全合规返回 null。
 */
function validateTags(tags: string[]): string | null {
  if (tags.length > MAX_TAGS)
    return `最多 ${MAX_TAGS} 个，现在有 ${tags.length} 个`;
  const bad = tags.find((t) => !TAG_PATTERN.test(t));
  if (bad !== undefined) {
    return `「${bad}」不合规：只允许小写字母、数字与连字符，须以字母或数字开头，长度 2–32`;
  }
  const dup = tags.find((t, i) => tags.indexOf(t) !== i);
  return dup === undefined ? null : `「${dup}」重复了`;
}

/** 逗号 / 空格 / 换行分隔 → 去空去重的 tag 数组。 */
function parseTags(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(/[\s,，]+/)
        .map((t) => t.trim())
        .filter(Boolean),
    ),
  ];
}

interface CapabilityVersionRecord {
  capabilityId: string;
  version: string;
  state: string;
  contract: Record<string, unknown>;
  contentDigest: string;
  createdAt: string;
}

interface CapabilityAliasRecord {
  capabilityId: string;
  alias: string;
  version: string;
  updatedAt: string;
}

interface EndpointInstanceRecord {
  id: string;
  capabilityId: string;
  version: string;
  environment: string;
  baseUrl: string;
  /** runos v0.8.0：由 `status` 改名（B-3 仓内统一 state/status/lifecycle 三个词）。 */
  state: string;
  createdAt: string;
}

interface CapabilityDetailRecord extends CapabilityRecord {
  versions: CapabilityVersionRecord[];
  aliases: CapabilityAliasRecord[];
  endpoints: EndpointInstanceRecord[];
}

/** `GET /governance/credentials` 的元数据行——不含任何密钥材料。 */
interface CredentialBindingRecord {
  bindingId: string;
  credentialClass: string;
  appliesTo: string[];
  state: string;
}

/** 一条操作在 contract 里的形状（`120-capability-model.md`）。 */
interface ContractOperation {
  operation: string;
  description?: string;
  interactionMode?: string;
  riskLevel: string;
}

/**
 * 读出这个版本声明的操作。contract 是自由 JSON，逐层试探着读，读不出来就当没有
 * ——不猜，也不把"解析失败"渲染成"没有危险操作"。
 */
function declaredOperations(v: CapabilityVersionRecord): ContractOperation[] {
  const raw = v.contract?.["operations"];
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((o) => {
    if (!o || typeof o !== "object") return [];
    const r = o as Record<string, unknown>;
    return typeof r["operation"] === "string" &&
      typeof r["riskLevel"] === "string"
      ? [
          {
            operation: r["operation"],
            riskLevel: r["riskLevel"],
            ...(typeof r["description"] === "string"
              ? { description: r["description"] }
              : {}),
            ...(typeof r["interactionMode"] === "string"
              ? { interactionMode: r["interactionMode"] }
              : {}),
          } satisfies ContractOperation,
        ]
      : [];
  });
}

/**
 * 这个版本声明了哪些凭证类。形状来自 contract 的 `credentialRequirements`
 * （runos `contract-schema.ts`）——contract 是自由 JSON，所以这里逐层试探着读，
 * 读不出来就当没声明，不猜。
 */
function declaredCredentialClasses(v: CapabilityVersionRecord): string[] {
  const raw = v.contract?.["credentialRequirements"];
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) =>
      r && typeof r === "object"
        ? (r as { credentialClass?: unknown }).credentialClass
        : undefined,
    )
    .filter((c): c is string => typeof c === "string" && c !== "");
}

/**
 * 晋升前缺哪些凭证。**判定条件逐字照抄 runos 的 `findActive`**
 * （`credential-binding.repository.ts`）：
 *
 *     state === "active" && credentialClass 相等 && appliesTo 包含该 capabilityId
 *
 * 照抄不是偷懒，是这里**绝不能有第二套判断**：前端算宽了，页面说能晋升、服务器
 * 回 409；算严了，明明能晋升却被自己的界面拦住。两种都比不做检查更糟。服务器
 * 始终是权威，这里只负责**提前把话说了**——280 §1.1 要的就是这个：这一步是运营者
 * 最容易毫无准备撞上的，失败出现在最不明显的时刻（「为什么它就是上不了线」）。
 */
function missingCredentialClasses(
  v: CapabilityVersionRecord,
  bindings: CredentialBindingRecord[],
): string[] {
  return declaredCredentialClasses(v).filter(
    (cls) =>
      !bindings.some(
        (b) =>
          b.state === "active" &&
          b.credentialClass === cls &&
          b.appliesTo.includes(v.capabilityId),
      ),
  );
}

const PRIMITIVE_LABELS: Record<string, string> = {
  connector: "连接器",
  skill: "技能",
  executor: "执行器",
  asset: "资产",
};

/**
 * Skill 的 operations 系统强制恰好一条，不给用户编辑——见文件头。
 *
 * ── 2026-08-23：补上 `inputSchema` / `outputSchema` / `idempotent` ─────────────
 *
 * 少这三个字段时**注册 Skill 必然失败**：runos 的 `validation.ts` 只有一个操作校验
 * 循环，它对**每一条** operation 都要求这三样，skill 那条 fetch 并不例外（skill 专属
 * 的检查是在那个循环**之后**追加的，不是替换它）。所以此前提交一个 skill 会一次性
 * 收到三条错误：`invalid_schema` × 2 + `missing_field: idempotent`。
 *
 * 值得记一笔的是 runos **自己的设计文档与自己的校验器在这里不一致**：
 * `120-capability-model.md` §4.3 写着「No input/output schemas: the single `fetch`
 * operation returns the content」，而校验器要求它们必须是 JSON Schema 对象。我们按
 * **校验器**走（那才是会拒绝请求的那一方），并用**空 schema `{}`** 来编码——空 schema
 * 在 JSON Schema 里的含义正是「不作任何约束」，是"没有 schema"最接近的合法表达；
 * 编一个 `{content: string}` 的出参形状会是我们在替 runos 宣布一件它没说过的事。
 * 这条不一致值得回给 runos（要么校验器给 skill 放行，要么文档改口）。
 *
 * `idempotent: true` 是事实判断：取一份内容不改变任何东西。
 */
const SKILL_OPERATION = {
  operation: "fetch",
  description: "分发 Skill 内容，不执行——执行永远在 agent 自己的运行时里",
  interactionMode: "sync",
  riskLevel: "read",
  inputSchema: {},
  outputSchema: {},
  idempotent: true,
} as const;

const CERTIFICATION_ITEMS = [
  { key: "prompt_injection_surface", label: "Prompt injection surface" },
  { key: "secret_handling", label: "Secret handling" },
  { key: "dangerous_operation_surface", label: "Dangerous operation surface" },
  { key: "provenance", label: "Provenance" },
] as const;

const ADMISSION_TONE: Record<string, StatusBadgeTone> = {
  official: "success",
  certified: "info",
  experimental: "neutral",
};

const VERSION_STATE_TONE: Record<string, StatusBadgeTone> = {
  draft: "neutral",
  submitted: "neutral",
  admitted: "info",
  stable: "success",
  deprecated: "warning",
  withdrawn: "danger",
};

const ENDPOINT_STATE_TONE: Record<string, StatusBadgeTone> = {
  active: "success",
  draining: "warning",
  disabled: "neutral",
};

const CONTRACT_TEMPLATE = `{
  "version": "1.0.0",
  "summary": "一句话描述这个能力做什么（≤200 字，用于语义检索）",
  "useWhen": "什么场景该用它",
  "avoidWhen": "什么场景不该用它",
  "operations": [
    {
      "operation": "run_code",
      "description": "运行一段代码",
      "inputSchema": { "type": "object", "properties": {} },
      "outputSchema": { "type": "object" },
      "interactionMode": "sync",
      "riskLevel": "read",
      "idempotent": false
    }
  ]
}`;

/** Skill 的主 contract 不含 operations——系统强制那一条，提交时前端拼死。 */
const SKILL_CONTRACT_TEMPLATE = `{
  "version": "1.0.0",
  "summary": "一句话描述这个 Skill 提供什么程序化知识（≤200 字，用于语义检索）",
  "useWhen": "什么场景该用它",
  "avoidWhen": "什么场景不该用它"
}`;

const EXECUTOR_TEMPLATE = `{
  "runtimeClass": "code-python",
  "resourceLimits": { "cpu": 1, "memoryMb": 512, "wallTimeSeconds": 60 },
  "egressPolicy": "none",
  "persistence": "ephemeral"
}`;

const SKILL_TEMPLATE = `{
  "format": "agent-skills",
  "content": "SKILL.md 的文本内容，直接作为字符串提交",
  "scripts": [],
  "capabilityReferences": []
}`;

/** scripts 非空必须声明一条 required 的 Executor 依赖；留空表示不声明依赖。 */
const SKILL_DEPENDENCIES_TEMPLATE = `[]`;

interface RegisterDraft {
  capabilityId: string;
  primitiveType: "connector" | "executor" | "skill";
  providerId: string;
  ownerRef: string;
  title: string;
  /** 空串 = 还没选。**不预设默认值**——`other` 是真实选项不是回落，见 CATEGORIES。 */
  category: string;
  /** 原始输入，提交时才 parse；让人能随手用逗号或空格分隔。 */
  tagsInput: string;
  contractJson: string;
  executorJson: string;
  skillJson: string;
  dependenciesJson: string;
}

const EMPTY_DRAFT: RegisterDraft = {
  capabilityId: "",
  primitiveType: "executor",
  providerId: "",
  ownerRef: "",
  title: "",
  category: "",
  tagsInput: "",
  contractJson: CONTRACT_TEMPLATE,
  executorJson: EXECUTOR_TEMPLATE,
  skillJson: SKILL_TEMPLATE,
  dependenciesJson: SKILL_DEPENDENCIES_TEMPLATE,
};

interface EndpointDraft {
  version: string;
  environment: "prod" | "sandbox";
  baseUrl: string;
}

function emptyEndpointDraft(version: string): EndpointDraft {
  return { version, environment: "sandbox", baseUrl: "" };
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

export default function CapabilitiesPage() {
  const { toast } = useToast();
  const { can } = useOperatorSession();
  const canManage = can(MANAGE);

  const [rows, setRows] = useState<CapabilityRecord[]>([]);
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [keyword, setKeyword] = useState("");
  /* 这两个下推给 runos（带索引、AND 语义），与本地的 keyword 过滤不是一回事。 */
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState("");
  const [primitiveFilter, setPrimitiveFilter] = useState<string>("all");
  const [selectedKeys, setSelectedKeys] = useState<readonly string[]>([]);

  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CapabilityDetailRecord | null>(null);
  /** null = 这次没读到绑定清单（不是"没有绑定"）——读不到就不做前置判断，
   *  退回让 runos 自己在 promote 时拒，而不是凭一份空清单说人家缺凭证。 */
  const [credentialBindings, setCredentialBindings] = useState<
    CredentialBindingRecord[] | null
  >(null);
  const [detailLoad, setDetailLoad] = useState<LoadState>({ kind: "ready" });

  const [registerOpen, setRegisterOpen] = useState(false);
  const [draft, setDraft] = useState<RegisterDraft>(EMPTY_DRAFT);
  const [submitting, setSubmitting] = useState(false);

  const [endpointDialog, setEndpointDialog] = useState<EndpointDraft | null>(
    null,
  );

  /** 元数据编辑草稿。null = 未打开；providerId 不在里面——身份列，见文件头。 */
  const [metaDraft, setMetaDraft] = useState<{
    title: string;
    /** 业务名按 locale 分开填——契约只认白名单里的键，多一个就是 `invalid_locale`。 */
    displayZh: string;
    displayEn: string;
    ownerRef: string;
    category: string;
    tagsInput: string;
  } | null>(null);
  /** 版本退役确认。`state` 只可能是 deprecated / withdrawn——stable 走 promote。 */
  const [lifecycleDialog, setLifecycleDialog] = useState<{
    version: string;
    state: "deprecated" | "withdrawn";
  } | null>(null);
  const [officialOpen, setOfficialOpen] = useState(false);

  const [certOpen, setCertOpen] = useState(false);
  const [certItems, setCertItems] = useState<
    Record<string, { pass: boolean; note: string }>
  >(() =>
    Object.fromEntries(
      CERTIFICATION_ITEMS.map((c) => [c.key, { pass: true, note: "" }]),
    ),
  );
  /** 四项的复核依据都非空才能提交——runos 侧对空 note 是整批 400。 */
  const certificationComplete = CERTIFICATION_ITEMS.every(
    (c) => (certItems[c.key]?.note ?? "").trim() !== "",
  );

  const reload = useCallback(async () => {
    setLoad({ kind: "loading" });
    try {
      /* 分类与标签下推给 runos，不在本地筛：`?tag=` 是**全部命中**（AND）语义，
         而且是带索引的（btree(category) + GIN(tags)）。在前端拿全量再过滤，既
         重复实现了那条 AND 语义，又会随目录长大越来越慢。 */
      const p = new URLSearchParams();
      if (categoryFilter !== "all") p.set("category", categoryFilter);
      for (const t of parseTags(tagFilter)) p.append("tag", t);
      const data = await api.get<CapabilityRecord[]>(
        `/api/runos/capabilities${p.size ? `?${p.toString()}` : ""}`,
      );
      setRows(data);
      setLoad({ kind: "ready" });
    } catch (error) {
      setLoad({
        kind: "error",
        message:
          error instanceof OperaApiError
            ? error.message
            : "读取 Capability 失败",
      });
    }
  }, [categoryFilter, tagFilter]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const loadDetail = useCallback(async (capabilityId: string) => {
    setDetailLoad({ kind: "loading" });
    try {
      /* 凭证绑定和详情一起取：晋升的硬门要在**点之前**就看得见，等点完拿 409
         回来就已经晚了（280 §1.1）。绑定读不到不挡详情——那样只是退回旧行为，
         而挡住详情等于为了一个提示把整个抽屉废掉。 */
      const [data, bindings] = await Promise.all([
        api.get<CapabilityDetailRecord>(
          `/api/runos/capabilities/${encodeURIComponent(capabilityId)}`,
        ),
        api
          .get<CredentialBindingRecord[]>("/api/runos/credentials")
          .catch(() => null),
      ]);
      setDetail(data);
      setCredentialBindings(bindings);
      setDetailLoad({ kind: "ready" });
    } catch (error) {
      setDetailLoad({
        kind: "error",
        message:
          error instanceof OperaApiError ? error.message : "读取详情失败",
      });
    }
  }, []);

  function criticalOps(v: CapabilityVersionRecord): ContractOperation[] {
    return declaredOperations(v).filter((o) => o.riskLevel === "critical");
  }

  /** 绑定清单没读到（null）时返回空数组 = 不做前置判断，让 runos 自己拒。 */
  function missingCredentials(v: CapabilityVersionRecord): string[] {
    return credentialBindings
      ? missingCredentialClasses(v, credentialBindings)
      : [];
  }

  function openDetail(capabilityId: string) {
    setDetailId(capabilityId);
    void loadDetail(capabilityId);
  }

  function closeDetail() {
    setDetailId(null);
    setDetail(null);
  }

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (primitiveFilter === "all" || r.primitiveType === primitiveFilter) &&
        (kw === "" ||
          r.capabilityId.toLowerCase().includes(kw) ||
          r.title.toLowerCase().includes(kw)),
    );
  }, [rows, keyword, primitiveFilter]);

  const pager = useListPagination(filtered, 20);

  function openRegister() {
    setDraft(EMPTY_DRAFT);
    setRegisterOpen(true);
  }

  async function submitRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    /* 分类法先校验：它是**注册的硬前置**（v0.5.0 起 missing_category 直接拒），
       而 contract 解析失败的提示会盖住真正的原因，让人以为是 JSON 写错了。 */
    if (!draft.category) {
      toast({
        tone: "danger",
        title: "请先选择分类",
        description:
          "category 是必填的（15 选 1）。填不出来就选 other——它是真实选项，不是「没填」。",
      });
      return;
    }
    const registerTags = parseTags(draft.tagsInput);
    const tagError = validateTags(registerTags);
    if (tagError) {
      toast({ tone: "danger", title: "标签不合规", description: tagError });
      return;
    }
    let contract: Record<string, unknown>;
    try {
      contract = JSON.parse(draft.contractJson) as Record<string, unknown>;
    } catch {
      toast({
        tone: "danger",
        title: "contract 不是合法 JSON",
        description: "先修好 JSON 语法再提交。",
      });
      return;
    }
    if (draft.primitiveType === "executor") {
      try {
        contract.executor = JSON.parse(draft.executorJson);
      } catch {
        toast({
          tone: "danger",
          title: "executor 不是合法 JSON",
          description: "先修好 JSON 语法再提交。",
        });
        return;
      }
    }
    if (draft.primitiveType === "skill") {
      try {
        contract.skill = JSON.parse(draft.skillJson);
      } catch {
        toast({
          tone: "danger",
          title: "skill 不是合法 JSON",
          description: "先修好 JSON 语法再提交。",
        });
        return;
      }
      try {
        const dependencies = draft.dependenciesJson.trim()
          ? JSON.parse(draft.dependenciesJson)
          : [];
        if (Array.isArray(dependencies) && dependencies.length > 0) {
          contract.dependencies = dependencies;
        }
      } catch {
        toast({
          tone: "danger",
          title: "dependencies 不是合法 JSON",
          description: "先修好 JSON 语法再提交。",
        });
        return;
      }
      /* operations 系统强制恰好一条 fetch，不接受用户填的版本——见文件头。 */
      contract.operations = [SKILL_OPERATION];
    }

    setSubmitting(true);
    try {
      await api.post("/api/runos/capabilities", {
        capability: {
          capabilityId: draft.capabilityId.trim(),
          primitiveType: draft.primitiveType,
          providerId: draft.providerId.trim(),
          ownerRef: draft.ownerRef.trim(),
          title: draft.title.trim(),
          category: draft.category,
          /* tags 省略而不是送空数组：0 个是合法的，但送 `[]` 与不送在语义上一样，
             少送一个字段就少一次被上游校验的机会。 */
          ...(registerTags.length > 0 ? { tags: registerTags } : {}),
        },
        contract,
      });
      toast({ tone: "success", title: `${draft.capabilityId} 已注册` });
      setRegisterOpen(false);
      await reload();
    } catch (error) {
      toast({ tone: "danger", title: "注册失败", ...describeError(error) });
    } finally {
      setSubmitting(false);
    }
  }

  async function promote(capabilityId: string, version: string) {
    setSubmitting(true);
    try {
      await api.post(
        `/api/runos/capabilities/${encodeURIComponent(capabilityId)}/versions/${encodeURIComponent(version)}/promote`,
      );
      toast({
        tone: "success",
        title: `${capabilityId}@${version} 已提升为 stable`,
      });
      await loadDetail(capabilityId);
    } catch (error) {
      toast({ tone: "danger", title: "提升失败", ...describeError(error) });
    } finally {
      setSubmitting(false);
    }
  }

  async function submitEndpoint(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!endpointDialog || !detail) return;
    setSubmitting(true);
    try {
      await api.post("/api/runos/endpoints", {
        capabilityId: detail.capabilityId,
        version: endpointDialog.version,
        environment: endpointDialog.environment,
        baseUrl: endpointDialog.baseUrl.trim(),
      });
      toast({ tone: "success", title: "Endpoint 已注册" });
      setEndpointDialog(null);
      await loadDetail(detail.capabilityId);
    } catch (error) {
      toast({ tone: "danger", title: "注册失败", ...describeError(error) });
    } finally {
      setSubmitting(false);
    }
  }

  function openCertification() {
    setCertItems(
      Object.fromEntries(
        CERTIFICATION_ITEMS.map((c) => [c.key, { pass: true, note: "" }]),
      ),
    );
    setCertOpen(true);
  }

  async function submitCertification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    setSubmitting(true);
    try {
      const result = await api.post<{ outcome: "certified" | "rejected" }>(
        `/api/runos/capabilities/${encodeURIComponent(detail.capabilityId)}/certification`,
        {
          /* `note` **必填且非空**，四项一条都不能省：runos 的 `certify()` 对每一项都
             判 `typeof note !== "string" || note.trim() === ""` 并整批 400
             （`REGISTRY_CHECKLIST_ITEM_INVALID`）。此前这里把空备注**整个键省掉**、
             界面上又写着"可选"，于是默认状态提交必然失败——而失败信息说的是"item X
             requires a boolean pass and a non-empty note"，读起来像是这一项填错了。
             这条要求本身是合理的：一句"通过"没有复核价值，写下为什么才有。 */
          items: CERTIFICATION_ITEMS.map((c) => ({
            item: c.key,
            pass: certItems[c.key]?.pass ?? false,
            note: certItems[c.key]?.note.trim() ?? "",
          })),
        },
      );
      toast({
        tone: result.outcome === "certified" ? "success" : "warning",
        title:
          result.outcome === "certified"
            ? `${detail.capabilityId} 已通过 certified 审核`
            : `${detail.capabilityId} 审核未通过`,
        description:
          result.outcome === "certified"
            ? "admission_tier 已置为 certified。"
            : "四项里有未通过的——outcome 由 Runos 服务端算，不接受直传。",
      });
      setCertOpen(false);
      await loadDetail(detail.capabilityId);
    } catch (error) {
      toast({ tone: "danger", title: "提交失败", ...describeError(error) });
    } finally {
      setSubmitting(false);
    }
  }

  async function setEndpointState(endpointId: string, state: string) {
    if (!detail) return;
    setSubmitting(true);
    try {
      /* 体字段跟随 runos v0.8.0 改成 `state`。**端点是三态**（active / draining /
         disabled），不是二元开关，所以仍走通用的 state 写法而不是 activate/deactivate
         动作端点——那对只该给开/关两种状态的对象用（B-3 的判据本身）。 */
      await api.patch(`/api/runos/endpoints/${endpointId}/status`, { state });
      toast({
        tone: "success",
        title: `Endpoint 已${state === "active" ? "启用" : state === "disabled" ? "禁用" : "转排空"}`,
        /* 端点状态同样经快照下发，不是即时的（170 §2：禁用端点与撤版本都是钝器，
           两者都受快照约束）。故障处置时最容易在这里误判"我已经把它摘了"。 */
        ...(state === "active"
          ? {}
          : {
              description:
                "经快照下发，不是立刻生效——最多还有一个刷新周期的流量会打到它。要立即止血，不能只靠这一步。",
            }),
      });
      await loadDetail(detail.capabilityId);
    } catch (error) {
      toast({ tone: "danger", title: "操作失败", ...describeError(error) });
    } finally {
      setSubmitting(false);
    }
  }

  async function submitMetadata(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!metaDraft || !detail) return;
    const metaTags = parseTags(metaDraft.tagsInput);
    const tagError = validateTags(metaTags);
    if (tagError) {
      toast({ tone: "danger", title: "标签不合规", description: tagError });
      return;
    }
    const nextDisplayName: Record<string, string> = {};
    if (metaDraft.displayZh.trim())
      nextDisplayName["zh-CN"] = metaDraft.displayZh.trim();
    if (metaDraft.displayEn.trim())
      nextDisplayName["en"] = metaDraft.displayEn.trim();

    setSubmitting(true);
    try {
      await api.patch(
        `/api/runos/capabilities/${encodeURIComponent(detail.capabilityId)}`,
        {
          ...(metaDraft.title.trim() ? { title: metaDraft.title.trim() } : {}),
          ...(metaDraft.ownerRef.trim()
            ? { ownerRef: metaDraft.ownerRef.trim() }
            : {}),
          ...(metaDraft.category ? { category: metaDraft.category } : {}),
          /* displayName 与 tags 同理：**清空是有意义的操作**，所以判据是"与原值
             不同"而不是"非空"——按非空判，名字一旦填上就再也删不掉。空串的键整个
             不进 map（而不是送一个空值），否则库里会留下一个"有这门语言、内容是
             空"的条目，读的时候回落不了。 */
          ...(JSON.stringify(nextDisplayName) !==
          JSON.stringify(detail.displayName ?? {})
            ? { displayName: nextDisplayName }
            : {}),
          /* tags 与其它字段不同：**空数组是有意义的**（清空标签），所以只要这一栏
             被动过就送，不能沿用"空则不送"那条——那样标签一旦加上就再也删不掉。
             判据是与原值不同，而不是非空。 */
          ...(metaTags.join(",") !== (detail.tags ?? []).join(",")
            ? { tags: metaTags }
            : {}),
        },
      );
      toast({ tone: "success", title: `${detail.capabilityId} 元数据已更新` });
      setMetaDraft(null);
      await loadDetail(detail.capabilityId);
      await reload();
    } catch (error) {
      toast({ tone: "danger", title: "更新失败", ...describeError(error) });
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * 把一个版本置为 deprecated / withdrawn。
   *
   * 两个入口共用它：`deprecated` 仍走本页的提示对话框（它不是破坏性动作——仍可
   * 解析，只是打了个退役信号），`withdrawn` 走 DS 的确认件。**失败重新抛出**，
   * 否则确认件会把失败当成成功关掉框。
   */
  async function applyVersionState(
    version: string,
    state: "deprecated" | "withdrawn",
  ) {
    if (!detail) return;
    try {
      /* 字段名是 `droppedAliases`（**复数、数组**），不是 `droppedAlias`。 */
      const result = await api.patch<{ droppedAliases?: string[] }>(
        `/api/runos/capabilities/${encodeURIComponent(detail.capabilityId)}/versions/${encodeURIComponent(version)}`,
        { state },
      );
      const dropped = result.droppedAliases ?? [];
      const lostStable = dropped.includes("stable");
      toast({
        tone: dropped.length > 0 ? "warning" : "success",
        title: `${detail.capabilityId}@${version} 已置为 ${state}`,
        ...(dropped.length > 0
          ? {
              description:
                `指向它的别名已被一并删除：${dropped.join("、")}。` +
                (lostStable
                  ? "其中 stable 是解析入口——这个能力现在**没有 stable 可解析**，请尽快提升另一个版本。"
                  : "调用方如果按这些别名解析，现在会落空。"),
            }
          : {}),
      });
      await loadDetail(detail.capabilityId);
    } catch (error) {
      toast({ tone: "danger", title: "操作失败", ...describeError(error) });
      throw error;
    }
  }

  async function submitLifecycle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!lifecycleDialog || !detail) return;
    const { version, state } = lifecycleDialog;
    setSubmitting(true);
    try {
      /* 字段名是 `droppedAliases`（**复数、数组**），不是 `droppedAlias`。写错的那半年
         里下面这条警告一次都没触发过：撤掉一个正是 stable 的版本，界面只给一个平静的
         绿色 toast，没有人被告知这个能力当下已经没有 stable 可解析。
         掉的也不只有 stable——`latest` 与任何自定义别名都跟着掉，所以按实际掉的那几个
         报，而不是预设是哪一个。 */
      const result = await api.patch<{ droppedAliases?: string[] }>(
        `/api/runos/capabilities/${encodeURIComponent(detail.capabilityId)}/versions/${encodeURIComponent(version)}/lifecycle`,
        { state },
      );
      const dropped = result.droppedAliases ?? [];
      const lostStable = dropped.includes("stable");
      toast({
        tone: dropped.length > 0 ? "warning" : "success",
        title: `${detail.capabilityId}@${version} 已置为 ${state}`,
        ...(dropped.length > 0
          ? {
              description:
                `指向它的别名已被一并删除：${dropped.join("、")}。` +
                (lostStable
                  ? "其中 stable 是解析入口——这个能力现在**没有 stable 可解析**，请尽快提升另一个版本。"
                  : "调用方如果按这些别名解析，现在会落空。"),
            }
          : {}),
      });
      setLifecycleDialog(null);
      await loadDetail(detail.capabilityId);
    } catch (error) {
      toast({ tone: "danger", title: "操作失败", ...describeError(error) });
    } finally {
      setSubmitting(false);
    }
  }

  async function reembed(version: string) {
    if (!detail) return;
    setSubmitting(true);
    try {
      const result = await api.post<{ dimensions: number }>(
        `/api/runos/capabilities/${encodeURIComponent(detail.capabilityId)}/versions/${encodeURIComponent(version)}/reembed`,
      );
      toast({
        tone: "success",
        title: `${version} 的发现向量已重算`,
        description: `${result.dimensions} 维。语义检索会在下一次查询时用上新向量。`,
      });
    } catch (error) {
      /* embedding provider 返回空时 runos 报 409，向量保持不变——不是部分成功。 */
      toast({ tone: "danger", title: "重算失败", ...describeError(error) });
    } finally {
      setSubmitting(false);
    }
  }

  async function submitOfficial(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    setSubmitting(true);
    try {
      await api.post(
        `/api/runos/capabilities/${encodeURIComponent(detail.capabilityId)}/official`,
      );
      toast({
        tone: "success",
        title: `${detail.capabilityId} 已置为 official`,
      });
      setOfficialOpen(false);
      await loadDetail(detail.capabilityId);
      await reload();
    } catch (error) {
      /* 非第一方 provider 会拿到 409 not_first_party——原样透传 runos 的说法，
         不在前端预判第一方名单，那份名单在 runos 侧、会变。 */
      toast({ tone: "danger", title: "置档失败", ...describeError(error) });
    } finally {
      setSubmitting(false);
    }
  }

  /* `category` 的标签与说明都写着「必填」，但门禁原来没拦——运营者能一路点到「注册」
     然后吃一个服务端报错。要么拦，要么别写必填；这里选拦。 */
  const draftValid =
    draft.capabilityId.trim() !== "" &&
    draft.providerId.trim() !== "" &&
    draft.ownerRef.trim() !== "" &&
    draft.title.trim() !== "" &&
    draft.category !== "";

  const pagination = (
    <Pagination
      className="w-full"
      page={pager.page}
      pageCount={pager.pageCount}
      total={rows.length}
      filteredTotal={filtered.length}
      pageSize={pager.pageSize}
      onPageSizeChange={pager.onPageSizeChange}
      onPageChange={pager.onPageChange}
    />
  );

  const emptyState =
    load.kind === "loading" ? (
      <EmptyState title="读取中…" description="正在读取 Capability 清单。" />
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
    ) : filtered.length !== rows.length ? (
      <EmptyState
        title="没有匹配的 Capability"
        description="换个关键词或筛选条件再看。"
      />
    ) : (
      <EmptyState
        title="暂无 Capability"
        description="点击「注册 Capability」开始。"
      />
    );

  const stableAlias = detail?.aliases.find((a) => a.alias === "stable");
  const latestAlias = detail?.aliases.find((a) => a.alias === "latest");

  return (
    <>
      <ListPageTemplate
        summary={
          <Banner
            tone="info"
            title="能改的只有 title 与 ownerRef"
            description="capabilityId / providerId / primitiveType 是身份列，注册后永久锁定（runos 98_column_locks.sql），写错了只能改数据库。版本可以退役（deprecated / withdrawn）但不能删除——目录保留历史。"
          />
        }
        header={
          <ViewHeader
            icon="stack"
            title="能力注册"
            description="四原语统一注册台账；数据来自 Runos 的 /capability/capabilities。连接器 / 执行器 / 技能可注册，资产仍未开放。"
            action={
              canManage ? (
                <Button onClick={openRegister} disabled={submitting}>
                  <Icon name="plus" size="sm" aria-hidden="true" />
                  注册 Capability
                </Button>
              ) : null
            }
          />
        }
        filters={
          <FilterBar
            view="list"
            onViewChange={() => {}}
            cardsDisabledReason="卡片视图已下线，改用列表"
            count={
              filtered.length === rows.length
                ? rows.length
                : `${filtered.length} / ${rows.length}`
            }
          >
            <InputGroup className="grow basis-media-3xl max-w-panel-sm">
              <InputGroupAddon>
                <Icon name="search" size="sm" aria-hidden="true" />
              </InputGroupAddon>
              <InputGroupInput
                placeholder="搜索 Capability…"
                aria-label="搜索 Capability"
                value={keyword}
                onChange={(e) => {
                  setKeyword(e.target.value);
                  pager.resetPage();
                }}
              />
            </InputGroup>
            <NativeSelect
              wrapperClassName="w-fit"
              value={primitiveFilter}
              onChange={(e) => {
                setPrimitiveFilter(e.target.value);
                pager.resetPage();
              }}
              aria-label="原语类型筛选"
            >
              <option value="all">全部类型</option>
              <option value="connector">连接器</option>
              <option value="executor">执行器</option>
              <option value="skill">技能</option>
              <option value="asset">资产（尚不可注册）</option>
            </NativeSelect>
            <NativeSelect
              wrapperClassName="w-fit"
              value={categoryFilter}
              onChange={(e) => {
                setCategoryFilter(e.target.value);
                pager.resetPage();
              }}
              aria-label="分类筛选"
            >
              <option value="all">全部分类</option>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </NativeSelect>
            <InputGroup className="w-fit basis-media-xl">
              <InputGroupAddon>
                <Icon name="filter" size="sm" aria-hidden="true" />
              </InputGroupAddon>
              <InputGroupInput
                placeholder="标签，多个为「全部命中」"
                aria-label="标签筛选"
                value={tagFilter}
                onChange={(e) => {
                  setTagFilter(e.target.value);
                  pager.resetPage();
                }}
              />
            </InputGroup>
          </FilterBar>
        }
        table={
          <DataTable
            columns={[
              {
                /* 主名换成 `displayName`（业务语言），`capabilityId` 落到副行——
                   但**必须还在行上**：审计事件、端点、授权用的都是它。见
                   `resolveNames` 的表。 */
                id: "id",
                header: "能力",
                cell: (r: CapabilityRecord) => {
                  const n = resolveNames(r);
                  return (
                    <TableTitleCell
                      icon="stack"
                      title={
                        <span className="flex items-center gap-xs">
                          <span>{n.primary}</span>
                          {n.operational ? (
                            /* 运营名与业务名不同时两个都要在：运营者在跨仓 issue、
                               日志里读到的是运营名，只显示业务名会对不上。 */
                            <span className="text-body-sm font-normal text-muted-foreground">
                              {n.operational}
                            </span>
                          ) : null}
                          {n.missingConsoleLocale ? (
                            <Badge
                              variant="outline"
                              title={`已登记 ${n.otherLocales.join(" / ")}，缺 ${CONSOLE_LOCALE}——当前显示的是运营名`}
                            >
                              缺中文名
                            </Badge>
                          ) : null}
                        </span>
                      }
                      description={
                        <span className="font-mono">{r.capabilityId}</span>
                      }
                      onTitleClick={() => openDetail(r.capabilityId)}
                    />
                  );
                },
              },
              {
                id: "provider",
                header: "Provider",
                width: "sm",
                cell: (r: CapabilityRecord) => (
                  <span className="text-code-sm">{r.providerId}</span>
                ),
              },
              {
                id: "taxonomy",
                header: "分类 / 标签",
                width: "md",
                cell: (r: CapabilityRecord) => (
                  <span className="flex flex-col gap-2xs">
                    {/* 分类缺失 = 这条是分类法强制之前注册的老行，如实标出来：
                        它现在改不了自己，但一次 PATCH 就能补上。 */}
                    {r.category ? (
                      <Badge variant="secondary">{r.category}</Badge>
                    ) : (
                      <Badge variant="outline">未分类</Badge>
                    )}
                    {r.tags && r.tags.length > 0 ? (
                      <span className="flex flex-wrap gap-2xs">
                        {r.tags.slice(0, 3).map((t) => (
                          <Badge key={t} variant="outline">
                            {t}
                          </Badge>
                        ))}
                        {r.tags.length > 3 ? (
                          <Badge variant="outline">+{r.tags.length - 3}</Badge>
                        ) : null}
                      </span>
                    ) : null}
                  </span>
                ),
              },
              {
                id: "owner",
                header: "Owner",
                width: "sm",
                cell: (r: CapabilityRecord) => (
                  <span className="text-body-sm text-muted-foreground">
                    {r.ownerRef}
                  </span>
                ),
              },
              {
                id: "type",
                header: "类型",
                align: "center",
                width: "xs",
                cell: (r: CapabilityRecord) => (
                  <Badge variant="secondary">
                    {PRIMITIVE_LABELS[r.primitiveType] ?? r.primitiveType}
                  </Badge>
                ),
              },
              {
                id: "tier",
                header: "准入等级",
                align: "center",
                width: "xs",
                cell: (r: CapabilityRecord) => (
                  <StatusBadge
                    tone={ADMISSION_TONE[r.admissionTier] ?? "neutral"}
                    dot
                  >
                    {r.admissionTier}
                  </StatusBadge>
                ),
              },
            ]}
            rows={pager.pageRows}
            rowKey={(r: CapabilityRecord) => r.capabilityId}
            selectedKeys={selectedKeys}
            onSelectionChange={setSelectedKeys}
            indexStart={pager.indexStart}
            rowActions={(r: CapabilityRecord) => (
              <ActionMenu
                label={`${r.capabilityId} 操作`}
                items={[
                  {
                    id: "detail",
                    label: "查看详情",
                    icon: "eye",
                    onSelect: () => openDetail(r.capabilityId),
                  },
                ]}
              />
            )}
            footer={pagination}
            empty={emptyState}
          />
        }
      />

      {/* ── 注册 Capability ─────────────────────────────────────────────── */}
      <DialogForm
        open={registerOpen}
        onOpenChange={setRegisterOpen}
        title="注册 Capability"
        description="asset 的注册机制还没上线；skill 的 operations 系统固定为一条 fetch，不需要填。"
        submitLabel="注册"
        submitting={submitting}
        submitDisabled={!draftValid}
        onSubmit={submitRegister}
      >
        {/* 三档（DS `FieldTier`）：身份 = 这个能力是什么、怎么被寻址；常规 = 归属与
            检索面；高级 = 契约 JSON。**契约档能收起是因为它有模板**——换类型时自动
            换成对应模板，不动也能提交；十几行 textarea 平铺在必填项下面，只会把真正
            需要停下来想的四个字段淹掉。 */}
        <FieldTier
          tier="identity"
          hint="ID 前缀必须等于 Provider；类型决定下面出现哪份契约，选错要重来。"
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="cap-id">Capability ID</FieldLabel>
              <Input
                id="cap-id"
                value={draft.capabilityId}
                onChange={(e) =>
                  setDraft({ ...draft, capabilityId: e.target.value })
                }
                placeholder="runos.code-sandbox"
                className="font-mono"
              />
              <FieldDescription>
                格式 {"{provider}.{name}"}，两段都是小写
                kebab；前缀必须等于下面的 Provider。
              </FieldDescription>
            </Field>
            <div className="grid grid-cols-2 gap-md">
              <Field>
                <FieldLabel htmlFor="cap-type">类型</FieldLabel>
                <NativeSelect
                  id="cap-type"
                  value={draft.primitiveType}
                  onChange={(e) => {
                    const primitiveType = e.target
                      .value as RegisterDraft["primitiveType"];
                    setDraft({
                      ...draft,
                      primitiveType,
                      contractJson:
                        primitiveType === "skill"
                          ? SKILL_CONTRACT_TEMPLATE
                          : CONTRACT_TEMPLATE,
                    });
                  }}
                >
                  <option value="executor">执行器（Executor）</option>
                  <option value="connector">连接器（Connector）</option>
                  <option value="skill">技能（Skill）</option>
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="cap-provider">Provider</FieldLabel>
                <Input
                  id="cap-provider"
                  value={draft.providerId}
                  onChange={(e) =>
                    setDraft({ ...draft, providerId: e.target.value })
                  }
                  placeholder="runos"
                />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="cap-title">标题</FieldLabel>
              <Input
                id="cap-title"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="Python code sandbox"
              />
            </Field>
          </FieldGroup>
        </FieldTier>

        <FieldTier
          tier="details"
          hint="分类进 runos_discover 的检索面——选错等于让业务 agent 搜不到这个能力。"
        >
          <FieldGroup>
            <div className="grid grid-cols-2 gap-md">
              <Field>
                <FieldLabel htmlFor="cap-category">分类（必填）</FieldLabel>
                <NativeSelect
                  id="cap-category"
                  value={draft.category}
                  onChange={(e) =>
                    setDraft({ ...draft, category: e.target.value })
                  }
                >
                  {/* 空选项不给默认值：`other` 是真实选项，替人预选任何一项都等于
                      替运营做了分类决定，而这个字段会进 runos_discover 的检索面。 */}
                  <option value="">— 请选择 —</option>
                  {CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </NativeSelect>
                <FieldDescription>
                  15 选 1，注册必填。业务 agent
                  用它收窄检索范围，所以选错等于让人
                  搜不到这个能力。填不出来就选 other——那是一个明确的判断。
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="cap-tags">标签（可选）</FieldLabel>
                <Input
                  id="cap-tags"
                  value={draft.tagsInput}
                  onChange={(e) =>
                    setDraft({ ...draft, tagsInput: e.target.value })
                  }
                  placeholder="invoice, ocr"
                  className="font-mono"
                />
                <FieldDescription>
                  最多 8 个，小写字母 / 数字 / 连字符，长度
                  2–32。逗号或空格分隔。
                </FieldDescription>
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="cap-owner">Owner Ref</FieldLabel>
              <Input
                id="cap-owner"
                value={draft.ownerRef}
                onChange={(e) =>
                  setDraft({ ...draft, ownerRef: e.target.value })
                }
                placeholder="runos/executor"
              />
            </Field>
          </FieldGroup>
        </FieldTier>

        <FieldTier
          tier="advanced"
          title="契约（JSON 直填）"
          hint="已按类型预填模板，不改也能注册；contract 字段仍在 M1 阶段会长，做成表单只会漏字段。"
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="cap-contract">
                Contract（JSON，version / summary / useWhen / avoidWhen
                {draft.primitiveType === "skill" ? "" : " / operations"}）
              </FieldLabel>
              <Textarea
                id="cap-contract"
                value={draft.contractJson}
                onChange={(e) =>
                  setDraft({ ...draft, contractJson: e.target.value })
                }
                rows={draft.primitiveType === "skill" ? 6 : 12}
                className="font-mono text-code-sm"
              />
              <FieldDescription>
                {draft.primitiveType === "skill"
                  ? "operations 不在这里填——Skill 的 operations 系统强制恰好一条 fetch，提交时自动补上。"
                  : "contract 结构还在 M1 阶段，没有做成表单——字段随时可能长（见 vxture-runos 120-capability-model.md），先按 JSON 直填，比做一个会漏字段的表单诚实。"}
              </FieldDescription>
            </Field>
            {draft.primitiveType === "executor" ? (
              <Field>
                <FieldLabel htmlFor="cap-executor">
                  Executor 契约（JSON，runtimeClass / resourceLimits /
                  egressPolicy / persistence）
                </FieldLabel>
                <Textarea
                  id="cap-executor"
                  value={draft.executorJson}
                  onChange={(e) =>
                    setDraft({ ...draft, executorJson: e.target.value })
                  }
                  rows={6}
                  className="font-mono text-code-sm"
                />
                <FieldDescription>
                  M1 只接受
                  egressPolicy=&quot;none&quot;、persistence=&quot;ephemeral&quot;。
                </FieldDescription>
              </Field>
            ) : null}
            {draft.primitiveType === "skill" ? (
              <>
                <Field>
                  <FieldLabel htmlFor="cap-skill">
                    Skill 契约（JSON，format / content / scripts /
                    capabilityReferences）
                  </FieldLabel>
                  <Textarea
                    id="cap-skill"
                    value={draft.skillJson}
                    onChange={(e) =>
                      setDraft({ ...draft, skillJson: e.target.value })
                    }
                    rows={8}
                    className="font-mono text-code-sm"
                  />
                  <FieldDescription>
                    content 目前是直接提交的字符串（SKILL.md 文本），不是真实的
                    plugin 文件包；capabilityReferences
                    是自己声明的，不是从内容解析出来的——两者都等 runos 侧的
                    ingest pipeline 落地后再升级。
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="cap-dependencies">
                    Dependencies（JSON 数组，可选）
                  </FieldLabel>
                  <Textarea
                    id="cap-dependencies"
                    value={draft.dependenciesJson}
                    onChange={(e) =>
                      setDraft({ ...draft, dependenciesJson: e.target.value })
                    }
                    rows={4}
                    className="font-mono text-code-sm"
                    placeholder={`[{ "capabilityId": "runos.code-sandbox", "kind": "required", "note": "脚本执行依赖" }]`}
                  />
                  <FieldDescription>
                    scripts 非空时必须声明一条 kind=&quot;required&quot; 的
                    Executor 依赖；不声明依赖就留空数组。
                  </FieldDescription>
                </Field>
              </>
            ) : null}
          </FieldGroup>
        </FieldTier>
      </DialogForm>

      {/* ── 详情抽屉 ─────────────────────────────────────────────────────── */}
      <Drawer
        open={detailId !== null}
        onClose={closeDetail}
        width="md"
        /* 抽屉标题跟着表格走：主名在前、机器标识在下。两处一致，否则从表格点进来
           会觉得像是打开了另一个东西。 */
        title={
          detail
            ? resolveNames(detail).primary
            : detailId
              ? detailId
              : undefined
        }
        description={
          detailId ? <span className="font-mono">{detailId}</span> : undefined
        }
      >
        {detailLoad.kind === "loading" ? (
          <EmptyState title="读取中…" description="正在读取详情。" />
        ) : detailLoad.kind === "error" ? (
          <EmptyState
            title="读取失败"
            description={detailLoad.message}
            action={
              <Button
                variant="secondary"
                onClick={() => detailId && void loadDetail(detailId)}
              >
                重试
              </Button>
            }
          />
        ) : detail ? (
          <div className="flex flex-col gap-lg">
            <div className="flex flex-wrap items-center justify-between gap-sm">
              <div className="flex flex-wrap items-center gap-sm">
                <Badge variant="secondary">
                  {PRIMITIVE_LABELS[detail.primitiveType] ??
                    detail.primitiveType}
                </Badge>
                <StatusBadge
                  tone={ADMISSION_TONE[detail.admissionTier] ?? "neutral"}
                  dot
                >
                  {detail.admissionTier}
                </StatusBadge>
                <span className="text-body-sm text-muted-foreground">
                  Provider {detail.providerId} · Owner {detail.ownerRef}
                </span>
                {/* 三个名字在详情里一次摆全：表格上主名 + 机器标识就够了，但要核对
                    「最终用户看到的到底是哪几个字」时，得能一眼看到整张 locale 表。 */}
                <span className="flex flex-wrap items-center gap-2xs">
                  <span className="text-body-sm text-muted-foreground">
                    运营名 {detail.title}
                  </span>
                  {Object.entries(detail.displayName ?? {}).length === 0 ? (
                    <Badge variant="outline">未登记业务名</Badge>
                  ) : (
                    Object.entries(detail.displayName ?? {}).map(([loc, v]) => (
                      <Badge key={loc} variant="secondary">
                        {loc} {v}
                      </Badge>
                    ))
                  )}
                </span>
              </div>
              {canManage ? (
                <ActionMenu
                  label={`${detail.capabilityId} 管理`}
                  disabled={submitting}
                  items={[
                    {
                      id: "meta",
                      label: "编辑元数据",
                      icon: "edit",
                      onSelect: () =>
                        setMetaDraft({
                          title: detail.title,
                          displayZh: detail.displayName?.["zh-CN"] ?? "",
                          displayEn: detail.displayName?.["en"] ?? "",
                          ownerRef: detail.ownerRef,
                          category: detail.category ?? "",
                          tagsInput: (detail.tags ?? []).join(", "),
                        }),
                    },
                    {
                      /**
                       * `official` 也要禁掉，不只是 `certified`。
                       *
                       * 准入档是**有序的**（`experimental < certified < official`），而
                       * `certify()` 判过之后是**无条件**把 tier 置成 `certified`——对一个
                       * 已经是 official 的能力跑这份清单，不是"再确认一次"，是**降级**，
                       * 而按钮上写着"提交 certified 审核"，读起来像是往上走。
                       * （2026-08-23 联调实测：first-party 注册进来是 official，跑完四项
                       * 全过的清单之后变成 certified。）
                       */
                      id: "certify",
                      label: "提交 certified 审核",
                      icon: "clipboard",
                      disabled:
                        detail.admissionTier === "certified" ||
                        detail.admissionTier === "official",
                      onSelect: openCertification,
                    },
                    {
                      id: "official",
                      label: "置为 official（仅第一方）",
                      icon: "shield",
                      disabled: detail.admissionTier === "official",
                      onSelect: () => setOfficialOpen(true),
                    },
                  ]}
                />
              ) : null}
            </div>

            <Section title="别名" icon="link" level={2}>
              <div className="flex flex-col gap-2xs text-body-sm">
                <div>
                  <span className="text-muted-foreground">latest → </span>
                  <span className="font-mono">
                    {latestAlias?.version ?? "—"}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">stable → </span>
                  <span className="font-mono">
                    {stableAlias?.version ?? "（尚未提升）"}
                  </span>
                </div>
              </div>
            </Section>

            <Section title="版本" icon="git-branch" level={2}>
              <div className="flex flex-col gap-sm">
                {detail.versions.length === 0 ? (
                  <p className="text-body-sm text-muted-foreground">
                    暂无版本。
                  </p>
                ) : (
                  detail.versions.map((v) => (
                    <div
                      key={v.version}
                      className="flex flex-col gap-sm rounded-md border border-border p-sm"
                    >
                      <div className="flex items-center justify-between gap-sm">
                        <div className="flex items-center gap-sm">
                          <span className="font-mono text-code-sm">
                            {v.version}
                          </span>
                          <StatusBadge
                            tone={VERSION_STATE_TONE[v.state] ?? "neutral"}
                            dot
                          >
                            {v.state}
                          </StatusBadge>
                          {/* critical 操作数摆在版本行上。此前 operations 只存在于
                            那块 contract JSON 里，等于"有 18 个不可逆操作，但你得
                            自己读 JSON 才知道"。critical 是唯一会被 Grant 整类拒绝
                            的等级，配授权的人必须先看得见它。 */}
                          {criticalOps(v).length > 0 ? (
                            <StatusBadge tone="danger" dot>
                              critical {criticalOps(v).length}
                            </StatusBadge>
                          ) : null}
                          {/* 摆在行上而不是只藏在操作菜单里：菜单要点开才看得见，
                            而这条正是运营者会一直卡着不知道为什么的那个原因。 */}
                          {v.state !== "stable" &&
                          missingCredentials(v).length > 0 ? (
                            <Badge
                              variant="outline"
                              title={`晋升前需要为这些凭证类配置活跃绑定（appliesTo 要含 ${v.capabilityId}）：${missingCredentials(v).join("、")}`}
                            >
                              缺凭证 {missingCredentials(v).length}
                            </Badge>
                          ) : null}
                        </div>
                        {canManage ? (
                          <ActionMenu
                            label={`${v.version} 操作`}
                            disabled={submitting}
                            items={[
                              {
                                id: "promote",
                                label:
                                  v.state === "stable"
                                    ? "已是 stable"
                                    : missingCredentials(v).length > 0
                                      ? `缺凭证：${missingCredentials(v).join("、")}`
                                      : "提升为 stable",
                                icon: "arrow-up",
                                /* 两道拦截，理由不同：
                                 - 状态：runos 只允许 admitted / stable 进 promote。
                                 - 凭证：声明了却没有活跃绑定的类，runos 回 409
                                   credential_binding_missing。这一条**必须在点之前
                                   就说**，否则失败出现在最不明显的时刻。 */
                                disabled:
                                  v.state === "stable" ||
                                  (v.state !== "admitted" &&
                                    v.state !== "stable") ||
                                  missingCredentials(v).length > 0,
                                onSelect: () =>
                                  void promote(detail.capabilityId, v.version),
                              },
                              {
                                /* **当前部署下这个动作必然失败**，所以摆出来就要说明白。
                                 runos 的 `runos.module.ts` 绑的是 `NullEmbeddingProvider`
                                 ——`embed()` 恒返回 null，服务端随即回 409
                                 `embedding_unavailable` 并保持原向量不变。全库 347 个
                                 版本的 `embedding` 列因此全空。
                                 这不是缺陷：检索按设计就是关键词匹配（`210` §4 明说排序
                                 是服务端的事、不进契约），嵌入是将来换实现时才接上的。
                                 **不藏起来**——藏了就要在门户里维护一份"上游接没接嵌入"
                                 的判断，那份判断只会漂移；接上的那天这里自动就好了。
                                 但也不能让人点了才发现，所以禁用并把理由写在标签上。 */
                                id: "reembed",
                                label: "重算发现向量（上游未接嵌入）",
                                icon: "refresh",
                                disabled: true,
                                onSelect: () => void reembed(v.version),
                              },
                              {
                                id: "deprecate",
                                label: "标记 deprecated",
                                icon: "warning",
                                separatorBefore: true,
                                disabled: v.state === "deprecated",
                                onSelect: () =>
                                  setLifecycleDialog({
                                    version: v.version,
                                    state: "deprecated",
                                  }),
                              },
                              {
                                id: "withdraw",
                                label: "撤下 withdrawn",
                                icon: "prohibit",
                                danger: true,
                                disabled: v.state === "withdrawn",
                                confirm: confirmLabels({
                                  verb: "撤下",
                                  target: `版本 ${v.version}`,
                                  /* 「不是立刻」这一句必须留：撤版本与禁端点都受
                                     快照约束，最多还有一个刷新周期按旧状态放行。
                                     把它当急停用是这套管理面最容易犯的错。 */
                                  consequence:
                                    "withdrawn 会把这个版本从解析快照里去掉，此后指向它的调用会解析失败——**但不是立刻**：调用走快照，最多还有一个刷新周期的流量按旧状态放行。如果它是当前的 stable，stable 别名会被一并删除，该能力将暂时没有 stable 可解析。状态单向，撤下后没有恢复路由。",
                                  onConfirm: () =>
                                    applyVersionState(v.version, "withdrawn"),
                                }),
                              },
                            ]}
                          />
                        ) : null}
                      </div>

                      {/* 操作清单。此前只存在于那块 contract JSON 里——18 个不可逆
                        操作躺在一个文本框中，谁也不会去读。critical 单独染色：它
                        是唯一会被 Grant 的审批闸门整类拒绝的等级。 */}
                      {declaredOperations(v).length > 0 ? (
                        <div className="flex flex-wrap items-center gap-2xs">
                          {declaredOperations(v).map((o) => {
                            const meta = RISK_LEVEL_META[o.riskLevel] ?? {
                              label: o.riskLevel,
                              tone: "neutral" as StatusBadgeTone,
                            };
                            return (
                              <StatusBadge
                                key={o.operation}
                                tone={meta.tone}
                                {...(o.riskLevel === "critical"
                                  ? { dot: true }
                                  : {})}
                              >
                                <span className="font-mono">{o.operation}</span>
                                <span className="text-muted-foreground">
                                  {" · "}
                                  {meta.label}
                                </span>
                              </StatusBadge>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </Section>

            <Section
              title="Endpoint"
              icon="plug"
              level={2}
              description="按环境登记的物理端点；没有独立列表接口，永远挂在某个版本下。"
            >
              <div className="flex flex-col gap-sm">
                {detail.endpoints.length === 0 ? (
                  <p className="text-body-sm text-muted-foreground">
                    暂无 Endpoint。
                  </p>
                ) : (
                  detail.endpoints.map((ep) => (
                    <div
                      key={ep.id}
                      className="flex items-center justify-between gap-sm rounded-md border border-border p-sm"
                    >
                      <div className="flex flex-col gap-2xs">
                        <div className="flex items-center gap-sm">
                          <Badge variant="outline">{ep.environment}</Badge>
                          <span className="font-mono text-code-sm">
                            {ep.version}
                          </span>
                          <StatusBadge
                            tone={ENDPOINT_STATE_TONE[ep.state] ?? "neutral"}
                            dot
                          >
                            {ep.state}
                          </StatusBadge>
                        </div>
                        <span className="text-code-sm text-muted-foreground break-all">
                          {ep.baseUrl}
                        </span>
                      </div>
                      {canManage ? (
                        <NativeSelect
                          wrapperClassName="w-fit shrink-0"
                          value={ep.state}
                          disabled={submitting}
                          onChange={(e) =>
                            void setEndpointState(ep.id, e.target.value)
                          }
                          aria-label={`${ep.id} 状态`}
                        >
                          <option value="active">active</option>
                          <option value="draining">draining</option>
                          <option value="disabled">disabled</option>
                        </NativeSelect>
                      ) : null}
                    </div>
                  ))
                )}
                {canManage ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="self-start"
                    onClick={() =>
                      setEndpointDialog(
                        emptyEndpointDraft(latestAlias?.version ?? ""),
                      )
                    }
                  >
                    <Icon name="plus" size="sm" aria-hidden="true" />
                    注册 Endpoint
                  </Button>
                ) : null}
              </div>
            </Section>
          </div>
        ) : null}
      </Drawer>

      {/* ── 注册 Endpoint（挂在当前详情的 capability 下）────────────────────── */}
      <Dialog
        open={endpointDialog !== null}
        onOpenChange={(open) => {
          if (!open) setEndpointDialog(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              注册 Endpoint{detail ? ` · ${detail.capabilityId}` : ""}
            </DialogTitle>
          </DialogHeader>
          {endpointDialog ? (
            <form
              className="flex flex-col gap-md"
              onSubmit={(e) => void submitEndpoint(e)}
            >
              <Banner
                tone="info"
                title="没有独立列表接口"
                description="Endpoint 永远挂在某个版本下，这里注册后会出现在上面的版本列表旁。"
              />
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="ep-version">版本</FieldLabel>
                  <Input
                    id="ep-version"
                    value={endpointDialog.version}
                    onChange={(e) =>
                      setEndpointDialog({
                        ...endpointDialog,
                        version: e.target.value,
                      })
                    }
                    placeholder="1.0.0"
                    className="font-mono"
                  />
                  <FieldDescription>必须是已注册过的版本号。</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="ep-env">环境</FieldLabel>
                  <NativeSelect
                    id="ep-env"
                    value={endpointDialog.environment}
                    onChange={(e) =>
                      setEndpointDialog({
                        ...endpointDialog,
                        environment: e.target
                          .value as EndpointDraft["environment"],
                      })
                    }
                  >
                    <option value="sandbox">sandbox</option>
                    <option value="prod">prod</option>
                  </NativeSelect>
                </Field>
                <Field>
                  <FieldLabel htmlFor="ep-url">Base URL</FieldLabel>
                  <Input
                    id="ep-url"
                    value={endpointDialog.baseUrl}
                    onChange={(e) =>
                      setEndpointDialog({
                        ...endpointDialog,
                        baseUrl: e.target.value,
                      })
                    }
                    placeholder="http://executor:3210/mcp"
                    className="font-mono"
                  />
                </Field>
              </FieldGroup>
              <DialogFooter>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setEndpointDialog(null)}
                >
                  取消
                </Button>
                <Button
                  type="submit"
                  disabled={
                    submitting ||
                    endpointDialog.version.trim() === "" ||
                    endpointDialog.baseUrl.trim() === ""
                  }
                >
                  注册
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
      {/* ── 提交 certified 审核（四项固定，不是可配置清单）──────────────────── */}
      <Dialog
        open={certOpen}
        onOpenChange={(open) => {
          if (!open) setCertOpen(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              提交 certified 审核{detail ? ` · ${detail.capabilityId}` : ""}
            </DialogTitle>
          </DialogHeader>
          <form
            className="flex flex-col gap-md"
            onSubmit={(e) => void submitCertification(e)}
          >
            <Banner
              tone="info"
              title="四项固定，全过才算 certified；每项都要写复核依据"
              description="outcome 由 Runos 服务端计算——全部通过才把 admission_tier 置为 certified，任一不通过则 rejected。这里不接受直传 outcome。四项的复核依据都是必填的（Runos 侧硬校验）：只勾一个「通过」没有复核价值，写下为什么才有；不通过的那项更要写清卡在哪。"
            />
            <div className="flex flex-col gap-md">
              {CERTIFICATION_ITEMS.map((c) => (
                <div key={c.key} className="flex flex-col gap-2xs">
                  <label className="flex items-center gap-sm text-body-sm">
                    <Checkbox
                      checked={certItems[c.key]?.pass ?? false}
                      onCheckedChange={(checked) =>
                        setCertItems((all) => ({
                          ...all,
                          [c.key]: {
                            pass: checked === true,
                            note: all[c.key]?.note ?? "",
                          },
                        }))
                      }
                    />
                    {c.label}
                    <span className="font-mono text-code-sm text-muted-foreground">
                      {c.key}
                    </span>
                  </label>
                  <Input
                    value={certItems[c.key]?.note ?? ""}
                    onChange={(e) =>
                      setCertItems((all) => ({
                        ...all,
                        [c.key]: {
                          pass: all[c.key]?.pass ?? true,
                          note: e.target.value,
                        },
                      }))
                    }
                    placeholder="复核依据（必填）——查了什么、结论是什么"
                    aria-label={`${c.label} 的复核依据`}
                  />
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setCertOpen(false)}
              >
                取消
              </Button>
              {/* 四条复核依据缺一条就提交不了——上游是整批 400，让人填完再发比
                  发出去挨一句看不懂的报错好。 */}
              <Button
                type="submit"
                disabled={submitting || !certificationComplete}
              >
                提交
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── 编辑元数据（只有 title / ownerRef——身份列锁死，见文件头）─────────── */}
      <DialogForm
        open={metaDraft !== null}
        onOpenChange={(open) => {
          if (!open) setMetaDraft(null);
        }}
        size="sm"
        title={
          detail ? `编辑「${detail.capabilityId}」` : "编辑 Capability 元数据"
        }
        description="能改标题、负责团队、分类与标签。capabilityId / providerId / primitiveType 是身份列，runos 侧锁死——provider 转让是另一件受治理的事，M1 没有这条路径。"
        submitLabel="保存"
        submitting={submitting}
        submitDisabled={
          metaDraft == null ||
          (metaDraft.title.trim() === "" &&
            metaDraft.ownerRef.trim() === "" &&
            metaDraft.category === "" &&
            metaDraft.displayZh.trim() === "" &&
            metaDraft.displayEn.trim() === "")
        }
        onSubmit={submitMetadata}
      >
        {metaDraft ? (
          <FieldGroup>
            {/* 三档（DS `FieldTier`）：呈现名 = 人读到的；归属与分类 = 检索面；
                标签可选。**能改的只有这几项**——身份（capabilityId / 类型 / Provider）
                注册后就锁死了，所以这个弹窗里没有身份档。 */}
            <FieldTier
              tier="identity"
              title="呈现名"
              hint="业务名是呈现不是身份：解析、授权、计量、审计一律不认它。清空是有效操作，会删掉那门语言。"
            >
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="meta-title">运营名（title）</FieldLabel>
                  <Input
                    id="meta-title"
                    value={metaDraft.title}
                    onChange={(e) =>
                      setMetaDraft({ ...metaDraft, title: e.target.value })
                    }
                    placeholder="Python code sandbox"
                  />
                  <FieldDescription>
                    运营者之间以及跨仓沟通用的名字。业务名缺某个语言时，界面回落到它。
                  </FieldDescription>
                </Field>

                <div className="grid grid-cols-2 gap-md">
                  <Field>
                    <FieldLabel htmlFor="meta-display-zh">
                      业务名 · 中文
                    </FieldLabel>
                    <Input
                      id="meta-display-zh"
                      value={metaDraft.displayZh}
                      onChange={(e) =>
                        setMetaDraft({
                          ...metaDraft,
                          displayZh: e.target.value,
                        })
                      }
                      maxLength={60}
                      placeholder="发票查询"
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="meta-display-en">
                      业务名 · English
                    </FieldLabel>
                    <Input
                      id="meta-display-en"
                      value={metaDraft.displayEn}
                      onChange={(e) =>
                        setMetaDraft({
                          ...metaDraft,
                          displayEn: e.target.value,
                        })
                      }
                      maxLength={60}
                      placeholder="Invoice Query"
                    />
                  </Field>
                </div>
                <FieldDescription>
                  给最终用户看的名字——与 agent 对话的人读到的是这个，不是
                  capabilityId。只认 zh-CN / en 两个键（多一个 runos 回
                  invalid_locale），各限 60
                  字。留空即不登记该语言，界面回落到运营名；
                  清空是有效操作，会把已登记的那门语言删掉。它是呈现不是身份：解析、
                  授权、计量、审计一律不认它。
                </FieldDescription>
              </FieldGroup>
            </FieldTier>

            <FieldTier
              tier="details"
              hint="归属与检索面，分类选错等于让业务 agent 搜不到。"
            >
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="meta-owner">Owner Ref</FieldLabel>
                  <Input
                    id="meta-owner"
                    value={metaDraft.ownerRef}
                    onChange={(e) =>
                      setMetaDraft({ ...metaDraft, ownerRef: e.target.value })
                    }
                    placeholder="runos/executor"
                  />
                  <FieldDescription>
                    负责团队标识。留空表示不改这一项。
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="meta-category">分类</FieldLabel>
                  <NativeSelect
                    id="meta-category"
                    value={metaDraft.category}
                    onChange={(e) =>
                      setMetaDraft({ ...metaDraft, category: e.target.value })
                    }
                  >
                    <option value="">— 不改 —</option>
                    {CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </NativeSelect>
                  <FieldDescription>
                    与注册同一套校验。改分类会改变业务 agent 检索到它的范围。
                  </FieldDescription>
                </Field>
              </FieldGroup>
            </FieldTier>

            <FieldTier tier="advanced" hint="可选，最多 8 个。">
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="meta-tags">标签</FieldLabel>
                  <Input
                    id="meta-tags"
                    value={metaDraft.tagsInput}
                    onChange={(e) =>
                      setMetaDraft({ ...metaDraft, tagsInput: e.target.value })
                    }
                    placeholder="invoice, ocr"
                    className="font-mono"
                  />
                  <FieldDescription>
                    最多 8 个，小写字母 / 数字 / 连字符，长度 2–32。
                    <strong>清空即删除全部标签</strong>
                    ——这一栏与上面几项不同，空是一个 有效值，不是「不改」。
                  </FieldDescription>
                </Field>
              </FieldGroup>
            </FieldTier>
          </FieldGroup>
        ) : null}
      </DialogForm>

      {/* ── 版本退役（到不了 stable——晋升走 promote）──────────────────────── */}
      <DialogForm
        open={lifecycleDialog !== null}
        onOpenChange={(open) => {
          if (!open) setLifecycleDialog(null);
        }}
        size="sm"
        danger={lifecycleDialog?.state === "withdrawn"}
        /* 只剩 `deprecated` 一档：`withdrawn` 是破坏性的，它的确认由 DS 的
           `ConfirmDestructive` 接管（菜单项的 `confirm`）。 */
        title={
          lifecycleDialog
            ? `标记版本 ${lifecycleDialog.version} 为 deprecated`
            : "版本退役"
        }
        description="deprecated 仍然可以解析，只是对外打了个退役信号，给调用方留迁移窗口。要真正停用请改用 withdrawn。"
        submitLabel="标记退役"
        submitting={submitting}
        onSubmit={submitLifecycle}
      />

      {/* ── official 准入档（仅第一方）───────────────────────────────────── */}
      <DialogForm
        open={officialOpen}
        onOpenChange={(open) => {
          if (!open) setOfficialOpen(false);
        }}
        size="sm"
        title={
          detail ? `将「${detail.capabilityId}」置为 official` : "置为 official"
        }
        description="official 是第一方专属档位（arda / karda / terra / ontos / runos）。这里不预判名单——名单在 runos 侧且会变，非第一方 provider 提交后会拿到 runos 的 not_first_party 拒绝，原样显示。注意这条路径与 certified 审核无关：experimental → certified 走四项审核清单，official 是直接置档。"
        submitLabel="置为 official"
        submitting={submitting}
        onSubmit={submitOfficial}
      />
    </>
  );
}
