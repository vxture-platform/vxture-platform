"use client";

/* Endpoint — 统一能力入口，业务系统只依赖 Endpoint。路由两档也落在这里：
 * primary 必填，fallback 留空即 Single、设了即 Failover。
 *
 * 2026-08-12 接真实数据（liaison #246，vxture-atlas#148 已合并）：Atlas 交付
 * `/capability/endpoints*`——稳定能力入口 code 间接到 primary/fallback
 * modelCode 的一层，没有独立的 Router 资源，failover 语义就是 fallbackModelCode
 * 有没有值。`code` 创建后不可变（PUT 时即使传了也被 Atlas 静默忽略，这里直接
 * 禁用输入框，不给操作者一个"看起来能改但改不动"的假象）。原先的 qps 字段是
 * mocks 演示数据，真实接口没有——已删除，不编一个假指标凑数。
 *
 * ── 2026-08-13 改按**推导状态**呈现（vxture-atlas 管理面设计稿第 1 条规则）──────
 *
 * 这页此前只有一个「已启用／已停用」列，而那是 `isActive`——**运营的意图**。
 * Atlas 从不把父级动作写到子级上（停用一个模型不会去停用指着它的 endpoint，那样
 * 会连带杀掉 fallback 还好好的入口、覆盖运营自己关掉某一条的决定，而且重新上线时
 * 没法分辨该把哪些再打开），后果改为**读时推导**成 `resolution`。
 *
 * 于是意图与后果会分叉，且**只在上游坏掉时才分叉**：一个 `isActive: true` 却指着
 * 已下线模型的入口，在旧页面上是一个绿色的「已启用」。这个设计规则本身就是从
 * 「三条这样的记录躺在注册表里、页面全绿」学来的，而这页当时正是那块绿色。
 *
 * 所以状态列现在读 `resolution` 而不是 `isActive`（`disabled` 一档就等价于
 * isActive=false，没有信息损失），primary/fallback 各自带上它为什么能／不能服务，
 * 并且**顶部横幅点名所有分叉的入口**——`degraded`（primary 倒了、fallback 顶着、
 * 调用仍然成功）是最容易被漏掉的一个，因为从调用方看一切正常。
 *
 * 模型选择用 Combobox 而不是原生 select：模型注册中心会长到几十条，且业务侧
 * 记的是编码不是名称，需要可搜索的下拉。已下线的模型不进候选，但**当前已经挂着的
 * 那个例外**——把它从列表里抹掉会让编辑框显示空白，一次无关的保存就顺手把路由改了。 */

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
  BulkActionBar,
  Button,
  Combobox,
  DataTable,
  DialogForm,
  EmptyState,
  Field,
  FieldDescription,
  FieldGroup,
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
  ViewHeader,
  useToast,
  useListPagination,
} from "@vxture/design-system";
import { useOperatorSession } from "@/features/session/SessionProvider";
import {
  AVAILABILITY_META,
  RESOLUTION_META,
  deleteFailureToast,
  resolutionDivergesFromIntent,
  type EndpointModelRef,
  type EndpointResolutionState,
} from "@/features/atlas/lifecycle";
import { api, OperaApiError } from "@/lib/api";

/** 与 opera-bff atlas.router.ts 同名能力码——endpoints 复用 model:model.manage
 * （路由配置本质是模型间接层，同一批人管，admin.operator_permission 里没有
 * 更细的能力码）。 */
const MANAGE = "model:model.manage";

interface ModelEndpointRecord {
  id: string;
  code: string;
  category: string;
  primaryModelCode: string;
  fallbackModelCode: string | null;
  /** 运营的意图。 */
  isActive: boolean;
  /** 意图的后果，读时推导。**可选**：Atlas 是外部主机、本仓不钉它的版本，落后的
   *  部署不会回这两个字段——缺失按「未知」渲染，不退回用 isActive 假装推导过。 */
  resolution?: EndpointResolutionState;
  /** primary 在前、fallback 在后，各带 availability。 */
  models?: EndpointModelRef[];
  createdAt: string;
  updatedAt: string;
}

interface AiModelSummary {
  id: string;
  modelCode: string;
  isActive: boolean;
}

/** 只看异常 = 运营意图与实际后果分叉的那些（degraded / unresolvable）。
 *  已停用的不算异常——那是运营自己关的。 */
type ResolutionFilter = "all" | "diverging" | EndpointResolutionState;

/** fallback 的"不设"档。空串在 Combobox 里选不中，需要一个显式值。 */
const NO_FALLBACK = "__none__";

type DialogState =
  | { kind: "create" }
  | { kind: "edit"; row: ModelEndpointRecord }
  | { kind: "route"; row: ModelEndpointRecord }
  | { kind: "delete"; row: ModelEndpointRecord }
  | null;

interface EndpointDraft {
  code: string;
  category: string;
  primaryModelCode: string;
  fallbackModelCode: string;
}

const EMPTY_DRAFT: EndpointDraft = {
  code: "",
  category: "chat",
  primaryModelCode: "",
  fallbackModelCode: NO_FALLBACK,
};

function draftFromRecord(row: ModelEndpointRecord): EndpointDraft {
  return {
    code: row.code,
    category: row.category,
    primaryModelCode: row.primaryModelCode,
    fallbackModelCode: row.fallbackModelCode ?? NO_FALLBACK,
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

/**
 * 一个模型引用格。可服务时只显示编码——把「一切正常」也渲染成一枚标，会让整张表
 * 长满绿点，真正出事的那一行反而不再跳出来。只有服务不了时才加标，并说明是哪一层
 * 关的（模型自己，还是它底下的 Provider）。
 */
function ModelRefCell({
  modelCode,
  models,
}: {
  modelCode: string;
  models: EndpointModelRef[] | undefined;
}) {
  const ref = models?.find((m) => m.modelCode === modelCode);
  /* 上游没回这一条的话不编状态：不知道 ≠ 正常。 */
  const availability = ref?.availability;
  return (
    <span className="flex flex-col gap-2xs">
      <span className="text-code-sm">{modelCode}</span>
      {availability && availability !== "available" ? (
        <Badge variant="outline" className="w-fit">
          {AVAILABILITY_META[availability].label}
        </Badge>
      ) : null}
    </span>
  );
}

/** `useSearchParams` 需要 Suspense 边界。 */
export default function EndpointsPage() {
  return (
    <Suspense fallback={null}>
      <EndpointsPageContent />
    </Suspense>
  );
}

function EndpointsPageContent() {
  const { toast } = useToast();
  const { can } = useOperatorSession();
  const canManage = can(MANAGE);
  /* Model 页的「入口 N」点进来落在这个过滤上：primary 与 fallback 都算，因为
     挡住模型删除的那个计数也是这么数的。 */
  const search = useSearchParams();
  const modelCodeFilter = search.get("modelCode") ?? "";
  /* 权益配置页从某个产品的路由授权点进来，只想看那一条。上游没有按 code 查单条的
     参数，本地过滤即可——列表本来就整份取回，不存在"翻到那一页才有"的问题。 */
  const endpointCodeFilter = search.get("endpointCode") ?? "";
  const [rows, setRows] = useState<ModelEndpointRecord[]>([]);
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [models, setModels] = useState<AiModelSummary[]>([]);
  const [keyword, setKeyword] = useState("");
  const [resolutionFilter, setResolutionFilter] =
    useState<ResolutionFilter>("all");
  const [selectedKeys, setSelectedKeys] = useState<readonly string[]>([]);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [draft, setDraft] = useState<EndpointDraft>(EMPTY_DRAFT);
  const [submitting, setSubmitting] = useState(false);

  const reload = useCallback(async () => {
    setLoad({ kind: "loading" });
    try {
      const [endpointsData, modelsData] = await Promise.all([
        api.get<ModelEndpointRecord[]>(
          `/api/atlas/endpoints?includeInactive=true${
            modelCodeFilter
              ? `&modelCode=${encodeURIComponent(modelCodeFilter)}`
              : ""
          }`,
        ),
        api.get<AiModelSummary[]>("/api/atlas/models?includeInactive=true"),
      ]);
      setRows(endpointsData);
      setModels(modelsData);
      setLoad({ kind: "ready" });
    } catch (error) {
      setLoad({
        kind: "error",
        message:
          error instanceof OperaApiError ? error.message : "读取 Endpoint 失败",
      });
    }
  }, [modelCodeFilter]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** 启用中却没在正常服务的——意图与后果分叉，唯一值得主动看的一批。 */
  const diverging = useMemo(
    () =>
      rows.filter((r) =>
        resolutionDivergesFromIntent(r.isActive, r.resolution),
      ),
    [rows],
  );

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (endpointCodeFilter === "" || r.code === endpointCodeFilter) &&
        (resolutionFilter === "all" ||
          (resolutionFilter === "diverging"
            ? resolutionDivergesFromIntent(r.isActive, r.resolution)
            : r.resolution === resolutionFilter)) &&
        (kw === "" ||
          r.code.toLowerCase().includes(kw) ||
          r.primaryModelCode.toLowerCase().includes(kw) ||
          (r.fallbackModelCode ?? "").toLowerCase().includes(kw)),
    );
  }, [rows, keyword, resolutionFilter, endpointCodeFilter]);

  const pager = useListPagination(filtered, 20);

  /**
   * 已下线的模型不进候选：挂上去等于给 Endpoint 埋一个必然失败的 primary。
   *
   * **但当前已经挂着的那个例外**——它可能正是刚被下线的那个（这页存在的意义就是
   * 让这种情况看得见）。把它从候选里抹掉，Combobox 会选不中当前值、显示成空白，
   * 于是一次只想改类别的保存会顺手把 primary 一起改了。宁可让它带着「已下线」的
   * 标留在列表里。
   */
  const modelItemsFor = useCallback(
    (currentValue: string) => {
      const items = models
        .filter((m) => m.isActive)
        .map((m) => ({ value: m.modelCode, label: m.modelCode }));
      if (
        currentValue !== "" &&
        currentValue !== NO_FALLBACK &&
        !items.some((i) => i.value === currentValue)
      ) {
        items.unshift({
          value: currentValue,
          label: `${currentValue}（已下线）`,
        });
      }
      return items;
    },
    [models],
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

  function openCreate() {
    setDraft(EMPTY_DRAFT);
    setDialog({ kind: "create" });
  }

  function openFrom(row: ModelEndpointRecord, kind: "edit" | "route") {
    setDraft(draftFromRecord(row));
    setDialog({ kind, row });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dialog) return;

    if (dialog.kind === "delete") {
      const row = dialog.row;
      setDialog(null);
      setSubmitting(true);
      try {
        await api.delete(`/api/atlas/endpoints/${row.id}`);
        toast({ tone: "success", title: `${row.code} 已删除` });
        await reload();
      } catch (error) {
        /* 两条前置条件（先停用、无引用）都是有名有姓的拒绝，不是一句"删除失败"
           ——被挡住的人需要知道接下来该动哪个东西。 */
        toast({ tone: "danger", ...deleteFailureToast(error, "删除失败") });
      } finally {
        setSubmitting(false);
      }
      return;
    }

    const fallbackModelCode =
      draft.fallbackModelCode === NO_FALLBACK ? null : draft.fallbackModelCode;

    setSubmitting(true);
    try {
      if (dialog.kind === "create") {
        await api.post("/api/atlas/endpoints", {
          code: draft.code.trim(),
          category: draft.category.trim() || "chat",
          primaryModelCode: draft.primaryModelCode,
          fallbackModelCode,
        });
        toast({
          tone: "success",
          title: `${draft.code} 已创建`,
          description: fallbackModelCode
            ? `Failover：${draft.primaryModelCode} → ${fallbackModelCode}`
            : `Single：${draft.primaryModelCode}`,
        });
      } else {
        await api.patch(`/api/atlas/endpoints/${dialog.row.id}`, {
          category: draft.category.trim() || "chat",
          primaryModelCode: draft.primaryModelCode,
          fallbackModelCode,
        });
        toast({
          tone: "success",
          title:
            dialog.kind === "route"
              ? `${dialog.row.code} 路由已更新`
              : `${draft.code} 已保存`,
          description: fallbackModelCode
            ? `Failover：${draft.primaryModelCode} → ${fallbackModelCode}`
            : `Single：${draft.primaryModelCode}`,
        });
      }
      setDialog(null);
      await reload();
    } catch (error) {
      toast({ tone: "danger", title: "保存失败", ...describeError(error) });
    } finally {
      setSubmitting(false);
    }
  }

  const routeOnly = dialog?.kind === "route";
  const formOpen =
    dialog?.kind === "create" || dialog?.kind === "edit" || routeOnly;
  const draftValid =
    draft.primaryModelCode !== "" &&
    (routeOnly || draft.code.trim() !== "") &&
    draft.fallbackModelCode !== draft.primaryModelCode;
  const editing = dialog?.kind === "edit";

  const rowMenu = (r: ModelEndpointRecord) => (
    <ActionMenu
      label={`${r.code} 操作`}
      disabled={submitting}
      items={[
        {
          id: "route",
          label: "调整路由",
          icon: "tree-structure",
          onSelect: () => openFrom(r, "route"),
        },
        {
          id: "edit",
          label: "编辑",
          icon: "edit",
          onSelect: () => openFrom(r, "edit"),
        },
        r.isActive
          ? {
              id: "disable",
              label: "停用",
              icon: "pause" as const,
              separatorBefore: true,
              onSelect: () =>
                void runAction(`${r.code} 已停用`, () =>
                  api.post(`/api/atlas/endpoints/${r.id}/deactivate`),
                ),
            }
          : {
              id: "enable",
              label: "启用",
              icon: "play" as const,
              separatorBefore: true,
              onSelect: () =>
                void runAction(`${r.code} 已启用`, () =>
                  api.post(`/api/atlas/endpoints/${r.id}/activate`),
                ),
            },
        {
          id: "delete",
          label: "删除",
          icon: "trash",
          danger: true,
          separatorBefore: true,
          onSelect: () => setDialog({ kind: "delete", row: r }),
        },
      ]}
    />
  );

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
      <EmptyState title="读取中…" description="正在读取 Endpoint 清单。" />
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
      <EmptyState title="没有匹配的 Endpoint" description="换个关键词再看。" />
    ) : (
      <EmptyState
        title="暂无 Endpoint"
        description="点击「新建 Endpoint」开始。"
      />
    );

  return (
    <>
      <ListPageTemplate
        header={
          <ViewHeader
            icon="plug"
            title="模型路由"
            description="统一能力入口（chat/default、embedding/default…）。业务系统永远访问 Endpoint，不直接访问模型；这里配的 primary/fallback 是运行时真实生效的路由。「解析状态」是读时从所指模型推导出来的实际后果，不是启停开关——停用一个模型永远不会去停用指着它的入口。"
            action={
              canManage ? (
                <Button onClick={openCreate} disabled={submitting}>
                  <Icon name="plus" size="sm" />
                  新建 Endpoint
                </Button>
              ) : null
            }
          />
        }
        summary={
          <div className="flex flex-col gap-sm">
            {/* 过滤态要显式可见、可清除。 */}
            {modelCodeFilter ? (
              <Banner
                tone="info"
                title={`只显示引用 ${modelCodeFilter} 的入口`}
                description="从 Model 页的「入口 N」点进来的。primary 与 fallback 都算——挡住模型删除的那个计数也是这么数的，剪断一条 failover 链和弄坏一个 primary 是同一类问题。"
                action={
                  <Button asChild variant="secondary" size="sm">
                    <Link href="/model/routes">显示全部</Link>
                  </Button>
                }
              />
            ) : null}
            {endpointCodeFilter ? (
              <Banner
                tone="info"
                title={`只显示 ${endpointCodeFilter} 这一条路由`}
                action={
                  <Button asChild variant="secondary" size="sm">
                    <Link href="/model/routes">显示全部</Link>
                  </Button>
                }
              />
            ) : null}
            {/* 分叉的入口要主动点名，不能只等人去翻表：`degraded` 从调用方看一切正常
                （fallback 顶着，调用还在成功），是最容易一直没人管的一档——而此刻这个
                入口已经没有第二层了。 */}
            {diverging.length > 0 ? (
              <Banner
                tone={
                  diverging.some((r) => r.resolution === "unresolvable")
                    ? "danger"
                    : "warning"
                }
                title={`${diverging.length} 个 Endpoint 启用中，但没在正常服务`}
                description={diverging
                  .map((r) =>
                    r.resolution
                      ? `${r.code}（${RESOLUTION_META[r.resolution].label}）`
                      : r.code,
                  )
                  .join("、")}
                action={
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setResolutionFilter("diverging");
                      pager.resetPage();
                    }}
                  >
                    只看这些
                  </Button>
                }
              />
            ) : null}
          </div>
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
                placeholder="搜索 Endpoint 或模型编码…"
                aria-label="搜索 Endpoint"
                value={keyword}
                onChange={(e) => {
                  setKeyword(e.target.value);
                  pager.resetPage();
                }}
              />
            </InputGroup>
            <NativeSelect
              wrapperClassName="w-fit"
              value={resolutionFilter}
              onChange={(e) => {
                setResolutionFilter(e.target.value as ResolutionFilter);
                pager.resetPage();
              }}
              aria-label="解析状态筛选"
            >
              <option value="all">全部状态</option>
              <option value="diverging">仅异常（启用中但没在服务）</option>
              <option value="serving">服务中</option>
              <option value="degraded">降级服务</option>
              <option value="unresolvable">无法解析</option>
              <option value="disabled">已停用</option>
            </NativeSelect>
          </FilterBar>
        }
        bulkBar={
          canManage ? (
            <BulkActionBar
              count={selectedKeys.length}
              noun="个"
              onClear={() => setSelectedKeys([])}
              actions={[
                {
                  id: "enable",
                  label: "启用",
                  icon: "play",
                  onSelect: () => {
                    const ids = [...selectedKeys];
                    setSelectedKeys([]);
                    void Promise.all(
                      ids.map((id) =>
                        api.post(`/api/atlas/endpoints/${id}/activate`),
                      ),
                    )
                      .then(() => {
                        toast({
                          tone: "success",
                          title: `${ids.length} 个 Endpoint 已启用`,
                        });
                        return reload();
                      })
                      .catch((error: unknown) =>
                        toast({
                          tone: "danger",
                          title: "启用失败",
                          ...describeError(error),
                        }),
                      );
                  },
                },
                {
                  id: "disable",
                  label: "停用",
                  icon: "pause",
                  danger: true,
                  onSelect: () => {
                    const ids = [...selectedKeys];
                    setSelectedKeys([]);
                    void Promise.all(
                      ids.map((id) =>
                        api.post(`/api/atlas/endpoints/${id}/deactivate`),
                      ),
                    )
                      .then(() => {
                        toast({
                          tone: "success",
                          title: `${ids.length} 个 Endpoint 已停用`,
                        });
                        return reload();
                      })
                      .catch((error: unknown) =>
                        toast({
                          tone: "danger",
                          title: "停用失败",
                          ...describeError(error),
                        }),
                      );
                  },
                },
              ]}
            />
          ) : null
        }
        table={
          <DataTable
            columns={[
              {
                id: "code",
                header: "Endpoint",
                cell: (r: ModelEndpointRecord) => (
                  <TableTitleCell
                    icon="plug"
                    title={<span className="font-mono">{r.code}</span>}
                    description={r.category}
                    {...(canManage
                      ? { onTitleClick: () => openFrom(r, "edit") }
                      : {})}
                  />
                ),
              },
              {
                id: "primary",
                header: "Primary",
                width: "sm",
                cell: (r: ModelEndpointRecord) => (
                  <ModelRefCell
                    modelCode={r.primaryModelCode}
                    models={r.models}
                  />
                ),
              },
              {
                id: "fallback",
                header: "Fallback",
                width: "sm",
                cell: (r: ModelEndpointRecord) =>
                  r.fallbackModelCode ? (
                    <ModelRefCell
                      modelCode={r.fallbackModelCode}
                      models={r.models}
                    />
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  ),
              },
              {
                /* 读 resolution 而不是 isActive：后者是意图，前者是它当前实际
                   在干什么。`disabled` 一档等价于 isActive=false，没有信息损失。 */
                id: "resolution",
                header: "解析状态",
                align: "center",
                width: "xs",
                cell: (r: ModelEndpointRecord) =>
                  r.resolution ? (
                    <StatusBadge tone={RESOLUTION_META[r.resolution].tone} dot>
                      {RESOLUTION_META[r.resolution].label}
                    </StatusBadge>
                  ) : (
                    /* 这台 Atlas 还没回 resolution。退回显示意图，并说明它只是
                       意图——不假装这里推导过任何东西。 */
                    <StatusBadge tone="neutral" dot>
                      {r.isActive ? "已启用（未推导）" : "已停用"}
                    </StatusBadge>
                  ),
              },
            ]}
            rows={pager.pageRows}
            rowKey={(r) => r.id}
            selectedKeys={selectedKeys}
            onSelectionChange={setSelectedKeys}
            indexStart={pager.indexStart}
            {...(canManage ? { rowActions: rowMenu } : {})}
            footer={pagination}
            empty={emptyState}
          />
        }
      />

      <DialogForm
        open={formOpen}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        title={
          routeOnly && dialog?.kind === "route"
            ? `调整路由 · ${dialog.row.code}`
            : editing
              ? "编辑 Endpoint"
              : "新建 Endpoint"
        }
        description="primary 必填；留空 fallback 即 Single 路由，设了就是 Failover——primary 失败时自动切过去。调用方带 endpointCode 走这个入口时，这条链是唯一权威：模型自己的 config.fallbackModelCodes 不再叠加。"
        submitLabel={dialog?.kind === "create" ? "创建" : "保存"}
        submitting={submitting}
        submitDisabled={!draftValid}
        onSubmit={submit}
      >
        <FieldGroup>
          {routeOnly ? null : (
            <>
              <Field>
                <FieldLabel htmlFor="endpoint-code">Endpoint 编码</FieldLabel>
                <Input
                  id="endpoint-code"
                  value={draft.code}
                  onChange={(e) => setDraft({ ...draft, code: e.target.value })}
                  placeholder="chat/default"
                  disabled={editing}
                />
                <FieldDescription>
                  {editing
                    ? "创建后不可变——Atlas 会静默忽略这里的改动，所以直接锁住。"
                    : "全局唯一，业务侧写死在配置里，创建后改动等于让调用方 404。"}
                </FieldDescription>
              </Field>

              <Field>
                <FieldLabel htmlFor="endpoint-category">类别</FieldLabel>
                <Input
                  id="endpoint-category"
                  value={draft.category}
                  onChange={(e) =>
                    setDraft({ ...draft, category: e.target.value })
                  }
                  placeholder="chat"
                />
              </Field>
            </>
          )}

          <Field>
            <FieldLabel>Primary 模型</FieldLabel>
            <Combobox
              items={modelItemsFor(draft.primaryModelCode)}
              value={draft.primaryModelCode}
              onValueChange={(v) => setDraft({ ...draft, primaryModelCode: v })}
              placeholder="选择模型"
              searchPlaceholder="搜索模型编码…"
            />
            <FieldDescription>
              已下线的模型不进候选，但当前已经挂着的那个会带「已下线」留在列表里
              ——抹掉它会让这一格看起来是空的，然后被一次无关的保存改掉。
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel>Fallback 模型</FieldLabel>
            <Combobox
              items={[
                { value: NO_FALLBACK, label: "不设（Single 路由）" },
                ...modelItemsFor(draft.fallbackModelCode),
              ]}
              value={draft.fallbackModelCode}
              onValueChange={(v) =>
                setDraft({ ...draft, fallbackModelCode: v })
              }
              placeholder="不设（Single 路由）"
              searchPlaceholder="搜索模型编码…"
            />
            <FieldDescription>
              不能与 primary 相同——同一个模型挂两档，failover 等于没有。
            </FieldDescription>
          </Field>
        </FieldGroup>
      </DialogForm>

      <DialogForm
        open={dialog?.kind === "delete"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        size="sm"
        danger
        title={
          dialog?.kind === "delete"
            ? `删除 ${dialog.row.code}`
            : "删除 Endpoint"
        }
        /* 两条前置条件如实写出来，不预判：能不能删由 Atlas 用与推导状态同一份数据源
           判定，前端再算一遍就是给同一个问题造第二个答案。被挡住时 409 会点名。
           `resolution` 与前置条件同一个提交加进来，所以它在不在就是判据。 */
        description={
          dialog?.kind === "delete" && dialog.row.resolution === undefined
            ? "⚠ 这台 Atlas 还没有删除前置条件（响应里没有解析状态）。在这个版本上删除不会检查这个入口是否还在被引用，也不要求先停用。删除之后，仍写着这个 code 的业务调用会立刻收到 404。"
            : "两条前置条件：这个入口必须已经停用，且 Atlas 内部没有任何东西还在引用它。不满足会被拒绝并告知是什么挡住了——不会级联删除任何东西。删除之后，仍写着这个 code 的业务调用会收到 404。"
        }
        submitLabel="删除"
        submitting={submitting}
        onSubmit={submit}
      />
    </>
  );
}
