"use client";

/* Metering — Atlas 事实计量（用量汇总）。
 *
 * 2026-08-11 接真实数据：源头是 opera-bff 的 GET /api/atlas/usage-summaries，
 * 代理 Atlas 真实的 `/capability/usage-summaries`。
 *
 * 2026-08-12 修正响应形状（liaison #251，vxture-atlas#151）：这个端点以前是永远
 * 返回 [] 的死桩，之前接的字段形状（statType/totalCostAmount/currency/
 * success-failed 拆分/id）是没有真实响应可核对的猜测。真实端点从 Atlas 自己的请求
 * 日志聚合，没有唯一 id（rowKey 用维度拼），没有任何成本/币种字段（Atlas 计量不
 * 计费，ADR-004），失败数只有 errors 一个计数。
 *
 * ── 2026-08-13 五根聚合轴（vxture-atlas#159 §4）───────────────────────────────
 *
 * 这页此前顶着一条横幅，写着「Atlas 实际只交付 Tenant 一维，缺的三个维度已列入验收
 * 清单」。那条横幅现在是**错的**：`groupBy` 已经支持 tenant / provider / model /
 * endpoint / product 五根轴，每一行还带 `dimension` 说明自己是按哪根轴聚出来的。
 * 一条描述过时上游状态的横幅比没有横幅更糟——它会让人以为这里已经没什么可看的了。
 *
 * 成本那半句仍然成立且保留：Atlas **计量但不计费**（ADR-004），请求路径上没有任何
 * 地方把 token 乘以价格。这页不显示、也不估算任何金额。
 *
 * 三件与"轴"有关、必须如实讲出来的事：
 *
 * 1. **计费主体是 (tenant, workspace) 这一对**，不是其中任何一个。tenant:workspace
 *    是 1:N——只按 tenant 分组会盖掉是哪个工作区烧的，只按 workspace 分组会丢掉该
 *    找谁收钱。默认轴按两者一起分组，所以它的行数比从前多，这是对的。
 *
 * 2. **endpoint 轴的总数不等于其它轴的总数**。它排除没有 endpoint_code 的行而不是
 *    把它们兜成一桶：那些行要么是调用方直接点名 modelCode/taskProfile（一种正当的
 *    路由方式，不是缺口），要么早于 incr/03。两者都不是"入口"，所以都不作为入口
 *    上报。endpoint 的历史也只从 incr/03 上线那天开始，没有回填——更早的请求是哪个
 *    入口服务的从来没被记过，回填只能靠猜，而猜比明说有缺口更糟。
 *
 * 3. **不属于当前轴的身份字段是 null**，不是缺数据：一条 provider 汇总行没有租户，
 *    因为它就是跨所有租户求和的。所以列随轴变，而不是画一张五轴通用、四列常年空着
 *    的宽表。
 *
 * 只读：这里记的是请求/Token 用量事实，定价是 admin 商业层（price-rules）的事。 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActionMenu,
  Banner,
  BulkActionBar,
  Button,
  DataTable,
  EmptyState,
  FilterBar,
  Icon,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  MetricGrid,
  NativeSelect,
  Pagination,
  Section,
  SegmentedControl,
  ViewHeader,
  ViewLayout,
  useListPagination,
  useToast,
  type DataTableColumn,
  type IconName,
} from "@vxture/design-system";
import { STALE_ATLAS_HINT } from "@/features/atlas/lifecycle";
import {
  useTenancyDirectory,
  workspaceLabel,
  type TenancyDirectory,
} from "@/features/tenancy/directory";
import { WorkspaceCell } from "@/features/tenancy/WorkspaceCell";
import { api, OperaApiError } from "@/lib/api";

/** 触发一次浏览器下载；用完立即回收 URL，不留 blob 常驻内存。 */
function downloadCsv(filename: string, rows: readonly string[][]) {
  const csv = rows
    .map((cols) => cols.map((c) => `"${c.replace(/"/g, '""')}"`).join(","))
    .join("\r\n");
  const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

type RollupDimension = "tenant" | "provider" | "model" | "endpoint" | "product";

interface UsageSummaryRecord {
  cycleMonth: string;
  tenantId: string | null;
  workspaceId: string | null;
  applicationId: string | null;
  applicationType: string | null;
  providerCode: string | null;
  modelCode: string | null;
  endpointCode: string | null;
  productCode: string | null;
  requests: string;
  inputTokens: string;
  outputTokens: string;
  totalTokens: string;
  errors: string;
}

/**
 * 上游回的是信封（product_251 A-4）：`groupBy` 由服务端兜底解析（不送＝`tenant`），
 * 所以轴是**解析出来的**，必须回显——而回显只能放在信封上。
 *
 * 它此前复制在每一行上。那是 A-4 点名修掉的缺陷：**空结果时这个回显整个消失**，
 * 拿到 `[]` 的调用方无从得知自己查的是哪根轴。信封是唯一一个空结果也带得走的位置。
 */
interface UsageSummaryPage {
  dimension: RollupDimension;
  items: UsageSummaryRecord[];
}

const AXES: {
  value: RollupDimension;
  label: string;
  icon: IconName;
  /** 这根轴回答的问题——轴名本身说不清它为什么存在。 */
  answers: string;
}[] = [
  {
    value: "tenant",
    label: "租户",
    icon: "building",
    answers: "这个客户消耗了多少，以及是在哪个工作区消耗的。",
  },
  {
    value: "provider",
    label: "Provider",
    icon: "plugs-connected",
    answers: "哪家供应商的量在涨。",
  },
  {
    value: "model",
    label: "Model",
    icon: "brain",
    answers: "哪个模型烧掉的 token 最多。",
  },
  {
    value: "endpoint",
    label: "Endpoint",
    icon: "plug",
    answers: "有多少流量是走这个能力入口进来的。",
  },
  {
    value: "product",
    label: "Product",
    icon: "package",
    answers:
      "跑一个产品要花多少——产品服务的定价就是从这个数推的。它是聚合轴，不是计费主体。",
  },
];

/** application_type 的人话。上游存的是机器值，页面不该原样端给运营看。 */
const APPLICATION_TYPE_LABELS: Record<string, string> = {
  agent: "智能体",
  workflow: "工作流",
  api_client: "API 客户端",
  internal_service: "内部服务",
};

/**
 * 一行在当前轴上的**原始身份**（id 或 code）。这是稳定键，用来拼 rowKey、导出、
 * 以及名字查不到时的兜底显示——名字会变，id 不会。
 */
function rowIdentity(
  dimension: RollupDimension,
  r: UsageSummaryRecord,
): string {
  switch (dimension) {
    case "provider":
      return r.providerCode ?? "—";
    case "model":
      return r.modelCode ?? "—";
    case "endpoint":
      return r.endpointCode ?? "—";
    case "product":
      return r.productCode ?? "—";
    default:
      return [r.tenantId ?? "—", r.workspaceId ?? "—"].join(" / ");
  }
}

/**
 * 一行在当前轴上**给人看的名字**。
 *
 * 只有租户轴需要查号：另外四根轴的身份本来就是人写的编码（`openai`、
 * `chat/default`、`karda`），它们已经是名字了，再去查一次只会把一个本来就好懂的
 * 值换成另一个说法。
 *
 * 租户轴走 `workspaceLabel`，拿到的是「租户 · 工作区」——**不是只有租户名**。计费
 * 主体本来就是这一对，而且工作区名几乎全是「默认工作空间」，缺了租户那一半就没有
 * 分辨力（规则见 features/tenancy/directory.ts）。
 */
function displayName(
  dimension: RollupDimension,
  r: UsageSummaryRecord,
  dir: TenancyDirectory,
): string {
  if (dimension !== "tenant") return rowIdentity(dimension, r);
  return workspaceLabel(dir, r.workspaceId);
}

function rowKey(dimension: RollupDimension, r: UsageSummaryRecord): string {
  return [
    dimension,
    rowIdentity(dimension, r),
    r.cycleMonth,
    r.applicationId ?? "—",
    r.applicationType ?? "—",
  ].join("·");
}

/** uuid 取尾段。整串 36 个字符在表格里读不动，而尾段足够在一屏内区分不同的行。 */
function shortId(id: string): string {
  const tail = id.split("-").at(-1);
  return tail && tail.length >= 8 ? `…${tail.slice(-8)}` : id;
}

function formatNumber(value: string): string {
  const n = Number(value);
  return Number.isFinite(n) ? new Intl.NumberFormat("zh-CN").format(n) : value;
}

type LoadState =
  | { kind: "loading" }
  /** 这台 Atlas 不认这根轴（400）。与"读取失败"分开：不是错，是版本还没到。 */
  | { kind: "unsupported-axis" }
  | { kind: "error"; message: string }
  | { kind: "ready" };

/** 名称与 id **两列都导**：名称给人看，id 给对账用——名称会改，id 不会，只导名称
 *  的表半年后就对不回是哪个租户了。 */
const CSV_HEADER = [
  "聚合轴",
  "对象名称",
  "对象标识",
  "工作区名称",
  "周期",
  "Application 类型",
  "Application ID",
  "总请求",
  "错误数",
  "Input Token",
  "Output Token",
  "Total Token",
];

function toCsvRow(
  dimension: RollupDimension,
  r: UsageSummaryRecord,
  dir: TenancyDirectory,
): string[] {
  return [
    dimension,
    displayName(dimension, r, dir),
    rowIdentity(dimension, r),
    dir.workspaces[r.workspaceId ?? ""]?.name ?? "",
    r.cycleMonth,
    r.applicationType
      ? (APPLICATION_TYPE_LABELS[r.applicationType] ?? r.applicationType)
      : "",
    r.applicationId ?? "",
    r.requests,
    r.errors,
    r.inputTokens,
    r.outputTokens,
    r.totalTokens,
  ];
}

export default function MeteringPage() {
  const { toast } = useToast();
  const [axis, setAxis] = useState<RollupDimension>("tenant");
  /** 上游回显的轴。见 `reload()` 里为什么不直接用 `axis`。 */
  const [resolvedAxis, setResolvedAxis] = useState<RollupDimension>("tenant");
  const [rows, setRows] = useState<UsageSummaryRecord[]>([]);
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [keyword, setKeyword] = useState("");
  const [cycleMonth, setCycleMonth] = useState("all");
  const [selectedKeys, setSelectedKeys] = useState<readonly string[]>([]);

  const reload = useCallback(async () => {
    setLoad({ kind: "loading" });
    try {
      const page = await api.get<UsageSummaryPage>(
        `/api/atlas/usage-summaries?groupBy=${axis}`,
      );
      /* 用信封回显的轴，不用本地 `axis`：两者正常时一致，不一致时**上游是对的**
         （比如它把一个它不认的值兜底成了 tenant）。信任本地那个会让表格按一根
         上游根本没聚过的轴去解释每一行。 */
      setResolvedAxis(page.dimension);
      setRows(page.items);
      setLoad({ kind: "ready" });
    } catch (error) {
      /* 轴不被上游接受时 Atlas 回 400 并说明合法取值——那不是"读取失败"，是这台
         Atlas 还没交付这根轴。分开说，否则会让人去查网络和权限。 */
      setLoad(
        error instanceof OperaApiError && error.status === 400
          ? { kind: "unsupported-axis" }
          : {
              kind: "error",
              message:
                error instanceof OperaApiError
                  ? error.message
                  : "读取用量数据失败",
            },
      );
    }
  }, [axis]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /* 查号：只查这批行里真的出现过的 id，查不到就退回显示 id，不阻塞页面。
     工作区的显示形态（租户在上、工作区在下）由查号台那边统一定，这里不自己拼。 */
  const tenancy = useTenancyDirectory(
    rows.map((r) => r.tenantId).filter((v): v is string => !!v),
    rows.map((r) => r.workspaceId).filter((v): v is string => !!v),
  );

  const cycleMonths = useMemo(
    () =>
      Array.from(new Set(rows.map((r) => r.cycleMonth)))
        .sort()
        .reverse(),
    [rows],
  );

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (cycleMonth === "all" || r.cycleMonth === cycleMonth) &&
        /* 名字和 id 都能搜到：页面上显示的是名字，但工单和日志里贴过来的是 id，
           两边都得能落地。displayName 在租户轴上已经是「租户 · 工作区」，所以
           搜租户名或工作区名都命中，不用再单独拼一条工作区条件。 */
        (kw === "" ||
          displayName(resolvedAxis, r, tenancy).toLowerCase().includes(kw) ||
          rowIdentity(resolvedAxis, r).toLowerCase().includes(kw)),
    );
  }, [rows, keyword, cycleMonth, tenancy, resolvedAxis]);

  const pager = useListPagination(filtered, 20);

  const copyRow = async (r: UsageSummaryRecord) => {
    const text = toCsvRow(resolvedAxis, r, tenancy).filter(Boolean).join(" · ");
    try {
      await navigator.clipboard.writeText(text);
      toast({ tone: "success", title: "已复制该行到剪贴板" });
    } catch {
      toast({
        tone: "danger",
        title: "复制失败",
        description: "浏览器拒绝了剪贴板访问，请手动选中复制。",
      });
    }
  };

  const exportSelected = () => {
    const ids = new Set(selectedKeys);
    const picked = filtered.filter((r) => ids.has(rowKey(resolvedAxis, r)));
    downloadCsv(`atlas-usage-${axis}.csv`, [
      CSV_HEADER,
      ...picked.map((r) => toCsvRow(resolvedAxis, r, tenancy)),
    ]);
    toast({ tone: "success", title: `已导出 ${picked.length} 条记录` });
    setSelectedKeys([]);
  };

  const totals = useMemo(
    () =>
      filtered.reduce(
        (acc, r) => ({
          requests: acc.requests + Number(r.requests || 0),
          errors: acc.errors + Number(r.errors || 0),
          inputTokens: acc.inputTokens + Number(r.inputTokens || 0),
          outputTokens: acc.outputTokens + Number(r.outputTokens || 0),
        }),
        { requests: 0, errors: 0, inputTokens: 0, outputTokens: 0 },
      ),
    [filtered],
  );

  const currentAxis = AXES.find((a) => a.value === axis) ?? AXES[0]!;

  /**
   * 列随轴变。不属于当前轴的身份字段本就是 null——画一张五轴通用的宽表，等于常年
   * 摆着四列空格，而空格读起来像"没数据"，不像"这根轴上不存在这个概念"。
   */
  const columns = useMemo<DataTableColumn<UsageSummaryRecord>[]>(() => {
    const identity: DataTableColumn<UsageSummaryRecord> = {
      id: "identity",
      header: currentAxis.label,
      cell: (r: UsageSummaryRecord) =>
        resolvedAxis === "tenant" ? (
          /* 租户在上、工作区在下——工作区一律以租户为主导，规则集中在
             features/tenancy/directory.ts，这里不自己拼一份。 */
          <WorkspaceCell directory={tenancy} workspaceId={r.workspaceId} />
        ) : (
          <span className="text-code-sm">{rowIdentity(resolvedAxis, r)}</span>
        ),
    };

    const numbers: DataTableColumn<UsageSummaryRecord>[] = [
      {
        id: "requests",
        header: "请求数",
        align: "right",
        width: "sm",
        cell: (r: UsageSummaryRecord) =>
          `${formatNumber(r.requests)}（错误 ${formatNumber(r.errors)}）`,
      },
      {
        id: "tokens",
        header: "Token（入/出/总）",
        align: "right",
        width: "sm",
        cell: (r: UsageSummaryRecord) =>
          `${formatNumber(r.inputTokens)} / ${formatNumber(r.outputTokens)} / ${formatNumber(r.totalTokens)}`,
      },
      {
        id: "cycle",
        header: "周期",
        align: "center",
        width: "xs",
        cell: (r: UsageSummaryRecord) => r.cycleMonth,
      },
    ];

    /* provider / model 轴刻意**不**按 application 拆：它们回答的是跨所有调用方的
       成本/量的问题，拆开只会让行数翻倍而不服务那个问题。 */
    return axis === "tenant"
      ? [
          identity,
          {
            /**
             * 类型能翻成人话，**id 翻不了**：应用注册表（智能体 / 工作流 / API
             * 客户端）在各产品自己的库里，平台库没有这张表，opera-bff 也不该为了
             * 一个展示字段去跨产品库联查。
             *
             * 所以这里显示"类型 + 短 id"，并且悬停可取完整 uuid——把一个查不到的
             * 名字编出来，比显示 id 更糟。
             */
            id: "application",
            header: "Application",
            width: "sm",
            cell: (r: UsageSummaryRecord) =>
              r.applicationId || r.applicationType ? (
                <span
                  className="flex flex-col gap-2xs"
                  title={r.applicationId ?? undefined}
                >
                  <span className="text-body-sm text-foreground">
                    {r.applicationType
                      ? (APPLICATION_TYPE_LABELS[r.applicationType] ??
                        r.applicationType)
                      : "未标注类型"}
                  </span>
                  {r.applicationId ? (
                    <span className="text-code-sm text-muted-foreground">
                      {shortId(r.applicationId)}
                    </span>
                  ) : null}
                </span>
              ) : (
                <span className="text-muted-foreground">—</span>
              ),
          },
          ...numbers,
        ]
      : [identity, ...numbers];
    /* tenancy 必须在依赖里：查号是异步回来的，漏了它列会一直用第一次渲染时那份空
       目录，名字到了也不会重画——表面看就是"查号台没生效"。 */
  }, [axis, currentAxis.label, tenancy, resolvedAxis]);

  const emptyState =
    load.kind === "loading" ? (
      <EmptyState title="读取中…" description="正在读取用量汇总。" />
    ) : load.kind === "unsupported-axis" ? (
      <EmptyState
        title={`当前 Atlas 部署不支持按 ${currentAxis.label} 聚合`}
        description={`${STALE_ATLAS_HINT} product 轴与 workspace 维度由 vxture-atlas#172 交付。换一根轴仍然可用——这里不退回 tenant 数据顶替，那会让人以为看的是这根轴。`}
        action={
          <Button variant="secondary" onClick={() => setAxis("tenant")}>
            回到租户轴
          </Button>
        }
      />
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
      <EmptyState title="没有匹配的记录" description="换个关键词或周期再看。" />
    ) : (
      <EmptyState
        title="这根轴上暂无用量"
        description={
          axis === "endpoint"
            ? "只有走能力入口路由的请求会落在这根轴上；直接点名 modelCode 的调用不会。"
            : "Atlas 尚未回传任何用量汇总。"
        }
      />
    );

  return (
    <ViewLayout>
      <ViewHeader
        icon="gauge"
        title="用量计量"
        description="所有请求必须被计量。这里记的是请求 / Token 用量事实，不做定价——Atlas 计量但不计费，销售价格归 admin 的价格规则。"
      />

      {axis === "endpoint" ? (
        /* 这条只在 endpoint 轴出现，因为它只对这根轴成立。常驻横幅会被读成"这页
           整体不可信"，而实际上另外四根轴是能加总的。 */
        <Banner
          tone="info"
          title="Endpoint 轴的总数不会等于其它轴的总数"
          description="它只覆盖走入口路由的流量：调用方直接点名 modelCode / taskProfile 的请求是一种正当的路由方式，不是缺口，所以不作为入口上报。另外入口历史只从 incr/03 上线那天开始——更早的请求是哪个入口服务的从没被记录过，没有回填（回填只能靠猜）。已停用的入口仍带着它的历史流量出现：停用一个入口是让它不再路由，不是改写它已经路由过的。"
        />
      ) : null}

      <MetricGrid
        loading={load.kind === "loading" && rows.length === 0}
        columns={4}
        items={[
          {
            id: "requests",
            label: "总请求",
            value: formatNumber(String(totals.requests)),
            icon: "gauge",
          },
          {
            id: "errors",
            label: "错误数",
            value: formatNumber(String(totals.errors)),
            icon: "warning",
            ...(totals.errors > 0 ? { trendTone: "warning" as const } : {}),
          },
          {
            id: "in",
            label: "Input Token",
            value: formatNumber(String(totals.inputTokens)),
            icon: "arrow-down",
          },
          {
            id: "out",
            label: "Output Token",
            value: formatNumber(String(totals.outputTokens)),
            icon: "arrow-up",
          },
        ]}
      />

      <Section
        title={`按 ${currentAxis.label} 汇总`}
        icon="chart-bar"
        level={2}
        description={currentAxis.answers}
      >
        <FilterBar
          view="list"
          onViewChange={() => {}}
          cardsDisabledReason="卡片视图已下线，改用列表"
          count={
            filtered.length === rows.length
              ? rows.length
              : `${filtered.length} / ${rows.length}`
          }
          /* 聚合轴放左段而不是混进右边那串筛选里：右边的每一个控件都是"在同一份
             数据里少看几行"，而换轴是**换一份数据**——列会跟着变。五个档位一次全
             露出来，也免去了下拉里"还有哪些轴"要点开才知道。 */
          scope={
            <SegmentedControl
              size="sm"
              ariaLabel="聚合轴"
              items={AXES.map((a) => ({
                value: a.value,
                label: a.label,
                icon: a.icon,
              }))}
              value={axis}
              onChange={(v) => {
                setAxis(v);
                setSelectedKeys([]);
                setCycleMonth("all");
                pager.resetPage();
              }}
            />
          }
        >
          <InputGroup className="grow basis-media-3xl max-w-panel-sm">
            <InputGroupAddon>
              <Icon name="search" size="sm" aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
              placeholder={`搜索${currentAxis.label}…`}
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
            value={cycleMonth}
            onChange={(e) => {
              setCycleMonth(e.target.value);
              pager.resetPage();
            }}
            aria-label="结算周期"
          >
            <option value="all">全部周期</option>
            {cycleMonths.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </NativeSelect>
        </FilterBar>

        <BulkActionBar
          count={selectedKeys.length}
          noun="条"
          onClear={() => setSelectedKeys([])}
          actions={[
            {
              id: "export",
              label: "导出所选",
              icon: "download",
              onSelect: exportSelected,
            },
          ]}
        />

        <DataTable
          columns={columns}
          rows={pager.pageRows}
          rowKey={(r) => rowKey(resolvedAxis, r)}
          selectedKeys={selectedKeys}
          onSelectionChange={setSelectedKeys}
          indexStart={pager.indexStart}
          rowActions={(r) => (
            <ActionMenu
              label={`${rowIdentity(resolvedAxis, r)} 操作`}
              items={[
                {
                  id: "copy",
                  label: "复制该行",
                  icon: "copy",
                  onSelect: () => void copyRow(r),
                },
              ]}
            />
          )}
          empty={emptyState}
          footer={
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
          }
        />
      </Section>
    </ViewLayout>
  );
}
