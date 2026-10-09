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
 * ── 一条不能省的诚实 ──────────────────────────────────────────────────────
 *
 * **孤儿模型单独成组显示，不藏。** `providerId` 为空、或指向一个不在列表里的
 * provider 的模型，按归属关系是无处可挂的。挂到任意一家名下是编，直接不显示则是
 * 让它们从此消失——而它们恰恰是最需要被看见的：一个解析不到 provider 的模型无法
 * 服务任何调用（Atlas 的数据面同样按"模型和它的 provider 都启用"判定）。
 *
 * ── 2026-10-05：查看 / 添加 / 编辑 提成二级页 ─────────────────────────────
 *
 * owner：「查看、添加、编辑 模型服务商 / 模型 为二级页面，汇集自检检查页面」。
 * 「接入 Provider」「注册模型」「编辑」「密钥管理」从本页的弹窗 / 抽屉，提成独立路由
 * （`/model/services/provider/:code` · `/model/services/model/:code` · `…/new`）。
 * 自检 / 验证接入 / 线协议生效值也随各自对象搬进它的详情页——它们本就属于「这一条」，
 * 不该是列表上一闪而过的浮层（见 `features/atlas/ProviderDetailPage` /
 * `ModelDetailPage` / `ProbeInspection`）。本页只剩**台账与生命周期**：筛选、展开看
 * 归属、启停 / 弃用 / 删除这类行内快动作，以及孤儿模型的点名与入口。 */

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useTableLabels } from "@/lib/table";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ActionButton,
  ActionMenu,
  Badge,
  Banner,
  Button,
  DataTable,
  EmptyState,
  FilterBar,
  Icon,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  ListPageTemplate,
  NativeSelect,
  SectionHeader,
  StatusBadge,
  TableTitleCell,
  ViewHeader,
  useListPagination,
  useToast,
} from "@vxture/design-system";
import { ListPagination } from "@/modules/shared/ListPagination";
import { useOperatorSession } from "@/features/session/SessionProvider";
import { useConfirmLabels } from "@/lib/destructive";
import { deleteFailureToast } from "@/features/atlas/lifecycle";
import { isEnabled, isServing } from "@/features/atlas/state";
import { api, OperaApiError } from "@/lib/api";
import { useTableSort, type SortAccessor } from "@/lib/table-sort";
import {
  describeError,
  formatTime,
  healthMeta,
  modelStateMeta,
  summarizeHealth,
  MODEL_TYPES,
  MODEL_MANAGE,
  ORPHAN,
  PROVIDER_MANAGE,
  PROVIDER_TYPES,
  type AiModelRecord,
  type LoadState,
  type ModelProviderRecord,
  type ServiceHealthView,
} from "@/features/atlas/model-service";

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
  const router = useRouter();
  const tShared = useTranslations();
  const tableLabels = useTableLabels();
  const withLabels = useConfirmLabels();
  const { toast } = useToast();
  const { can } = useOperatorSession();
  const canManageProviders = can(PROVIDER_MANAGE);
  const canManageModels = can(MODEL_MANAGE);

  /* 旧的 /atlas/models?providerId= 深链跳过来时带的展开目标。 */
  const expandParam = useSearchParams().get("providerId") ?? "";

  const [providers, setProviders] = useState<ModelProviderRecord[]>([]);
  const [models, setModels] = useState<AiModelRecord[]>([]);
  const [health, setHealth] = useState<ServiceHealthView | null>(null);
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "active" | "inactive"
  >("all");
  const [expandedKeys, setExpandedKeys] = useState<readonly string[]>(
    expandParam ? [expandParam] : [],
  );
  const [submitting, setSubmitting] = useState(false);

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
      // 能力面健康是尽力而为：读失败（无权限 / Atlas 不可达）不拖垮台账主体，
      // 只是不显示那条健康横幅。无人值守告警另有 platform-api watchdog 兜着（#562）。
      const healthView = await api
        .get<ServiceHealthView>("/api/atlas/health")
        .catch(() => null);
      setHealth(healthView);
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

  /** 能力面健康（configIssues / 余额 / Atlas 组件）收敛成一条横幅。 */
  const healthSummary = useMemo(
    () => (health ? summarizeHealth(health) : null),
    [health],
  );
  const healthLines = useMemo(() => {
    if (!healthSummary) return [] as string[];
    const out: string[] = [];
    if (healthSummary.routesDown.length > 0) {
      out.push(`路由不可用：${healthSummary.routesDown.join("、")}`);
    }
    if (healthSummary.routesWithConfigIssues.length > 0) {
      out.push(
        `路由配置异常：${healthSummary.routesWithConfigIssues.join("、")}（有兜底在服务，但未按声明配好）`,
      );
    }
    if (healthSummary.vendorsLow.length > 0) {
      out.push(
        `供应商余额不足：${healthSummary.vendorsLow
          .map((x) => x.providerCode + (x.outOfMoney ? "（已耗尽）" : ""))
          .join("、")}`,
      );
    }
    if (healthSummary.atlasNotOk.length > 0) {
      out.push(`Atlas 组件异常：${healthSummary.atlasNotOk.join("、")}`);
    }
    return out;
  }, [healthSummary]);

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

  const providerSortAccessors = useMemo<
    Readonly<Record<string, SortAccessor<ModelProviderRecord>>>
  >(
    () => ({
      name: (r) => r.providerName,
      type: (r) => r.providerType,
      models: (r) => modelsByProvider.get(r.id)?.length ?? 0,
      health: (r) => r.health?.status,
      status: (r) => r.state,
    }),
    [modelsByProvider],
  );
  const providerSort = useTableSort(filtered, providerSortAccessors);
  const pager = useListPagination(providerSort.rows, 20);

  const allExpanded =
    pager.pageRows.length > 0 &&
    pager.pageRows.every((p) => expandedKeys.includes(p.id));

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

  // ── 跳二级页 ─────────────────────────────────────────────────────────────

  function openProviderCreate() {
    router.push("/model/services/provider/new");
  }

  function openProviderDetail(row: ModelProviderRecord) {
    router.push(
      `/model/services/provider/${encodeURIComponent(row.providerCode)}`,
    );
  }

  function openProviderKeys(row: ModelProviderRecord) {
    router.push(
      `/model/services/provider/${encodeURIComponent(row.providerCode)}?panel=keys`,
    );
  }

  /** 从某个 provider 行发起注册时带上它——合并之后最顺的一条路径。 */
  function openModelCreate(providerId?: string) {
    router.push(
      providerId
        ? `/model/services/model/new?providerId=${encodeURIComponent(providerId)}`
        : "/model/services/model/new",
    );
  }

  function openModelDetail(row: AiModelRecord) {
    router.push(`/model/services/model/${encodeURIComponent(row.modelCode)}`);
  }

  /** 删除一家 Provider。落锤由菜单项的 `confirm.onConfirm` 调用，失败重新抛出
   *  （DS 确认件按 Promise 是否 rejected 决定关不关框，吞掉等于让失败看起来成功）。 */
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

  /** 删除一个模型。失败重新抛出，理由同上。 */
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

  // ── 渲染 ─────────────────────────────────────────────────────────────────

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
          labels={tableLabels}
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
                    ? { onTitleClick: () => openModelDetail(m) }
                    : {})}
                />
              ),
            },
            {
              id: "capabilities",
              header: "能力",
              width: "md",
              cell: (m: AiModelRecord) => (
                <span className="flex flex-wrap justify-center gap-2xs">
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
              align: "numeric",
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
              align: "numeric",
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
                  <StatusBadge tone={modelStateMeta(m.state).tone} dot>
                    {modelStateMeta(m.state).label}
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
                        id: "open",
                        label: "查看 / 编辑",
                        icon: "edit",
                        onSelect: () => openModelDetail(m),
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
                            separatorBefore: true,
                            onSelect: () =>
                              void runAction(`${m.modelCode} 已重新上线`, () =>
                                api.post(`/api/atlas/models/${m.id}/activate`),
                              ),
                          }
                        : {
                            id: "disable",
                            label: "下线",
                            icon: "prohibit" as const,
                            separatorBefore: true,
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
                        /* 两条前置条件接成 `met`，不满足直接禁用确认钮并标出是哪一条。
                           判据与 Atlas 的删除前置一致。「已下线」用 `!isServing()` 而不是
                           `!isEnabled()`：`deprecated` 的 `is_active` 仍是 true，按
                           isEnabled 判会把一个弃用中的模型标成「已下线」，然后被 Atlas 拒。 */
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
    <ListPageTemplate
      header={
        <ViewHeader
          icon="plugs-connected"
          title="模型服务"
          description="供应商与它名下的模型，展开行查看归属；两者都启用才可服务。「健康」由真实流量派生，要即时结论去该 Provider / 模型详情页的「验证接入 / 自检」。"
        />
      }
      summary={
        <>
          {/* 能力面健康（#562）：configIssues / 余额 / 宕机 / Atlas 组件。与上面行内
              「健康」（真实流量派生）互补——这条是配置态，没流量也看得见。无人值守时
              另有 platform-api watchdog 发 operator 通告。 */}
          {healthSummary && healthSummary.total > 0 ? (
            <Banner
              tone={healthSummary.hasCritical ? "danger" : "warning"}
              title={`模型服务健康：${healthSummary.total} 项待处理`}
              description={healthLines.join("；")}
            />
          ) : null}
          {orphanModels.length > 0 ? (
            /* 孤儿模型不藏。它们无法服务任何调用——挂不到 provider 就解析不出上游，
               而这恰恰是最需要被看见的一类。 */
            <Banner
              tone="warning"
              title={`${orphanModels.length} 个模型没有可解析的 Provider`}
              description="providerId 为空、或指向一个不存在的供应商。这些模型解析不出上游，无法服务任何调用。它们列在表格下方——打开它改归属或删除。"
            />
          ) : null}
        </>
      }
      footer={
        /* 孤儿模型给出**可操作的**清单，而不是只在横幅里点名。上面那条横幅让人
           "改归属或删除"，却不给入口，等于把问题指出来又把门关上。 */
        orphanModels.length > 0 ? (
          <div className="flex flex-col gap-sm rounded-md border border-warning-border">
            <div className="px-md pt-sm">
              <SectionHeader
                level={3}
                icon="warning"
                title={`未归属模型（${orphanModels.length}）`}
              />
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
          search={
            <InputGroup className="min-w-media-2xl grow basis-0 max-w-panel-sm">
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
          }
          resetLabel={tShared("filters.reset")}
          onReset={() => {
            setKeyword("");
            setStatusFilter("all");
            pager.resetPage();
          }}
          actions={
            <>
              {canManageModels ? (
                <ActionButton
                  icon="plus"
                  variant="outline"
                  onClick={() => openModelCreate()}
                  disabled={
                    submitting || !providers.some((p) => isEnabled(p.state))
                  }
                >
                  注册模型
                </ActionButton>
              ) : null}
              {canManageProviders ? (
                <ActionButton
                  icon="plus"
                  onClick={openProviderCreate}
                  disabled={submitting}
                >
                  接入 Provider
                </ActionButton>
              ) : null}
            </>
          }
        >
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
          labels={tableLabels}
          columns={[
            {
              id: "name",
              header: "Provider",
              sortable: true,
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
                    ? { onTitleClick: () => openProviderDetail(r) }
                    : {})}
                />
              ),
            },
            {
              id: "type",
              header: tShared("columns.kind"),
              sortable: true,
              width: "xs",
              cell: (r: ModelProviderRecord) =>
                PROVIDER_TYPES.find((t) => t.value === r.providerType)?.label ??
                r.providerType,
            },
            {
              /* 合并之后这一列不再是链接，而是**展开提示**：要看是哪些模型，
                 就在这一行展开，不用跳走。挡住删除的仍然是这个数。 */
              id: "models",
              header: "模型数",
              sortable: true,
              align: "numeric",
              width: "xs",
              cell: (r: ModelProviderRecord) => {
                const owned = modelsByProvider.get(r.id) ?? [];
                /* 数的是**还能服务的**（`deprecated` 算能）——这一格回答的是
                   "这家现在撑着多少模型"，少算弃用的会低报真实服务面。 */
                const activeCount = owned.filter((m) =>
                  isServing(m.state),
                ).length;
                /* 两个来源：`modelCount` 是 Atlas 给的、也是挡住删除的那个数；
                   `owned` 是本页按 providerId 分的组。正常相等；**不等必须说**——
                   否则这一列会和它正下方的清单对不上。 */
                const authoritative = r.modelCount;
                const disagrees =
                  authoritative !== undefined && authoritative !== owned.length;
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
              sortable: true,
              width: "xs",
              cell: (r: ModelProviderRecord) => (
                <StatusBadge tone={healthMeta(r.health?.status).tone} dot>
                  {healthMeta(r.health?.status).label}
                </StatusBadge>
              ),
            },
            {
              id: "status",
              header: tShared("columns.state"),
              sortable: true,
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
          {...(providerSort.sort ? { sort: providerSort.sort } : {})}
          onSortChange={(next) => {
            providerSort.onSortChange(next);
            pager.resetPage();
          }}
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
                        id: "open",
                        label: "查看 / 编辑",
                        icon: "edit",
                        separatorBefore: true,
                        onSelect: () => openProviderDetail(r),
                      },
                      {
                        /* 密钥、验证接入都在详情页上——这里深链过去并把密钥抽屉打开。 */
                        id: "keys",
                        label: "密钥管理",
                        icon: "key",
                        onSelect: () => openProviderKeys(r),
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
  );
}
