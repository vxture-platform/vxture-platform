"use client";

/* 服务状态 — 接入产品各渠道的存活 + 就绪看板。
 *
 * 2026-08-11 自 admin 迁入（继维护窗口之后的第二批）。**不是搬文件，是换了数据源**：
 * admin 那份探的是本地 dev-panel（:8090），从没连过生产，它自己的 tech-debt 登记也
 * 承认这一点（TD-036 / 20-admin-platform-refinement-plan.md P4「Q6 维持 dev-only」）。
 * 这里改探接入平台的产品线（opera-bff `/api/product-health`，源头是
 * product.products 目录行 + 各自登记的 OIDC 客户端）。
 *
 * 呈现形态的口径已建档：`docs/20-specs/000-platform/opera/20-service-monitor.md`
 * §4（含探测范围 §2、端点约定 §3）——改动前先读那份，本注释只讲实现细节。
 *
 * ── 2026-08-15：改成两级可展开表（与「模型服务」同一形态）─────────────────────
 *
 * 此前是"一个产品一行、每个信息格内部再劈成 prod/beta 两条子行"。那个形态在只有两个
 * 渠道时还读得过去，但每一列都要自己拆一次，列与列之间的对齐全靠 `ChannelSplit` 的
 * 内边距凑——加第三个渠道就是把每个格子再劈一刀。
 *
 * 现在：**主行 = prod 环境，渠道标签 `stable`**（与 `appoidc.oidc_clients.release_channel`
 * 的取值对齐，而不是自造一个 "Prod" 词）；展开后是 beta 与 canary 两条子行。归属关系靠
 * **列对齐**读出来（子表用 `leadingSpacer` 占住父表折叠列那一格），不是靠缩进方框。
 *
 * ── 清单与渠道的口径（owner 2026-08-15 定渠道；2026-08-30 定清单）──────────────
 *
 * **清单 = 产品目录**（`40-product-registry.md` §4）。BFF 以 `product.products` 为主表，
 * 目录里每个未删除的产品本页都有一行——没有任何 OIDC 客户端的产品标「**未接入**」，
 * 并带产品状态（草稿/已上线/…）。此前主表是客户端表外加一份硬编码豁免名单，本页与
 * 「产品目录」是两份清单（目录 21、本页 12，其中 5 个目录里不存在）。
 *
 * 三个渠道都以 `appoidc.oidc_clients.release_channel` 为准，BFF 现在三个都返回：
 *
 * - **stable = prod**，主行。
 * - **beta / canary**：`release_channel='beta'/'canary'` 的客户端，有就探、没有就是
 *   「未配置」。这两个都要在**基础接入**时登记，登记之后才有地址可探。
 *
 * 「未接入」（产品没有任何客户端）与「未配置」（有客户端、只是这个渠道没登记）是两件
 * 事，各用各的词；两者都是**正常态不是故障**——显示中性色而不是跑一次探测再报红。把一
 * 个从来没被探过的渠道涂成故障色，是在报告一件没有发生过的事。
 *
 * "stable 客户端的第二个 redirect_uri = beta"那条 seed 期的派生路径已在 BFF 退役
 * （2026-08-30）：回调白名单里多一个地址，不等于登记了一个渠道。
 *
 * 骨架与 opera 既有页面同构：ListPageTemplate 三槽 + FilterBar + DataTable +
 * useListPagination；不带任何 admin 遗留的 vx-* 产品 CSS 类。只读页面，无能力门。
 * 刷新节奏放宽到 30s（口径见 20-service-monitor.md §4），另留一个手动刷新按钮。 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  ActionMenu,
  Badge,
  Banner,
  BulkActionBar,
  Button,
  DataTable,
  Drawer,
  EmptyState,
  FilterBar,
  Icon,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  ListPageTemplate,
  MetricGrid,
  NativeSelect,
  Section,
  StatusBadge,
  ViewHeader,
  useListPagination,
  useToast,
  type IconName,
  type StatusBadgeTone,
} from "@vxture/design-system";
import { ListPagination } from "@/modules/shared/ListPagination";
import {
  PRODUCT_STATE_META,
  type ProductState,
} from "@/features/product/lifecycle";
import { api, OperaApiError } from "@/lib/api";
import { useVisiblePolling } from "@/lib/useVisiblePolling";

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

const REFRESH_INTERVAL_MS = 30_000;

type ProductLayer = "L1" | "L2" | "L3" | "client" | "external" | "unclassified";

type LivenessStatus =
  | "healthy"
  | "unhealthy"
  | "unreachable"
  | "not_configured"
  | "not_applicable";
type ReadinessStatus =
  | "ready"
  | "degraded"
  | "fail"
  | "not_implemented"
  | "unreachable"
  | "not_configured"
  | "not_applicable";

interface LivenessProbe {
  status: LivenessStatus;
  path: string | null;
  httpStatus: number | null;
  durationMs: number | null;
  service: string | null;
  version: string | null;
  gitSha: string | null;
  stage: string | null;
  buildTime: string | null;
  error: string | null;
  checkedAt: string;
}

interface ReadinessProbe {
  status: ReadinessStatus;
  path: string | null;
  httpStatus: number | null;
  durationMs: number | null;
  checks: Record<string, string> | null;
  error: string | null;
  checkedAt: string;
}

interface ProductChannelHealth {
  /** 该渠道登记的客户端；null = 这个渠道没登记，也就没有探测发生过。 */
  clientId: string | null;
  origin: string | null;
  health: LivenessProbe;
  status: ReadinessProbe;
}

type ChannelKey = "prod" | "beta" | "canary";

interface ProductHealthItem {
  productId: string;
  productCode: string;
  productName: string;
  layer: ProductLayer;
  state: ProductState;
  /** 至少一个渠道有活跃客户端。false = 目录里有、基础接入还没做。 */
  onboarded: boolean;
  prod: ProductChannelHealth;
  beta: ProductChannelHealth;
  canary: ProductChannelHealth;
}

const LAYER_LABEL: Record<ProductLayer, string> = {
  L1: "L1",
  L2: "L2",
  L3: "L3",
  client: "Client",
  external: "External",
  unclassified: "未分类",
};

const LAYER_ICON: Record<ProductLayer, IconName> = {
  L1: "stack",
  L2: "cube",
  L3: "squares-four",
  client: "desktop",
  external: "globe",
  unclassified: "circle-dashed",
};

const LIVENESS_LABELS: Record<LivenessStatus, string> = {
  healthy: "健康",
  unhealthy: "异常",
  unreachable: "不可达",
  not_configured: "未配置",
  not_applicable: "不适用",
};

const READINESS_LABELS: Record<ReadinessStatus, string> = {
  ready: "就绪",
  degraded: "降级",
  fail: "未就绪",
  not_implemented: "未实现",
  unreachable: "不可达",
  not_configured: "未配置",
  not_applicable: "不适用",
};

/** 渠道级的第三个中性态（2026-08-31）：client 型产品登记了客户端、但没有服务面可探
 *  （回调是 loopback）。与「未配置」（渠道没登记）、「未接入」（产品没有任何客户端）
 *  是三件事，各用各的词，都不计入「需要关注」。 */
const NOT_APPLICABLE_DETAIL = "客户端产品，无服务面";

/** 产品级的中性态：目录里有、没有任何客户端。与渠道级的「未配置」是两个词。 */
const NOT_ONBOARDED_LABEL = "未接入";

function livenessTone(status: LivenessStatus): StatusBadgeTone {
  if (status === "healthy") return "success";
  if (status === "not_configured" || status === "not_applicable")
    return "neutral";
  return "danger";
}

function readinessTone(status: ReadinessStatus): StatusBadgeTone {
  if (status === "ready") return "success";
  if (status === "degraded") return "warning";
  if (
    status === "not_configured" ||
    status === "not_implemented" ||
    status === "not_applicable"
  )
    return "neutral";
  return "danger";
}

/** 一个渠道是否需要人关注：health 不健康，或 status 明确 fail/degraded/不可达。
 * 未配置、未实现都是中性事实，不算需要关注。 */
function channelNeedsAttention(channel: ProductChannelHealth): boolean {
  const healthBad =
    channel.health.status === "unhealthy" ||
    channel.health.status === "unreachable";
  const statusBad =
    channel.status.status === "fail" ||
    channel.status.status === "degraded" ||
    channel.status.status === "unreachable";
  return healthBad || statusBad;
}

/** 产品是否需要人关注：**只看 stable（prod）**，且只看已接入的产品。
 *
 * 未接入（目录里有、没有任何客户端）是一个待办事实，不是故障——它在表里有自己的
 * 词和自己的统计格，不借「需要关注」这个红字。beta / canary 是辅助渠道，坏了不把
 * 产品整行标红（owner 2026-08-15）。 */
function productNeedsAttention(item: ProductHealthItem): boolean {
  return item.onboarded && channelNeedsAttention(item.prod);
}

const TIME_FORMAT = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const DATE_FORMAT = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "medium",
});

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : TIME_FORMAT.format(d);
}

function formatBuildTime(iso: string | null): string {
  if (!iso || iso === "unknown") return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : DATE_FORMAT.format(d);
}

function formatChecks(checks: Record<string, string> | null): string | null {
  if (!checks) return null;
  const entries = Object.entries(checks);
  if (entries.length === 0) return null;
  return entries.map(([k, v]) => `${k} ${v}`).join(" · ");
}

/** prod 是主读数，beta 是辅助参照——用字重 + 颜色区分，不用字号：内容区（标题列
 * 以外）统一 `text-body-sm`，一屏里两种字号会读成两套系统。prod 加粗
 * （`font-semibold`）、深色前景；beta 常规字重、`text-muted-foreground` 淡化
 * （2026-08-12，原先 prod 用 `text-label-md`/`text-body-sm`、beta 用
 * `text-body-xs`，字号本身就在做强调，跟标题列的字号连成一片，分不出主次）。 */
type ChannelEmphasis = "prod" | "beta";

/** 两个 emphasis 共用同一套字号，只在字重/颜色上分叉。 */
const EMPHASIS_TEXT: Record<ChannelEmphasis, string> = {
  prod: "text-body-sm font-semibold text-foreground",
  beta: "text-body-sm font-normal text-muted-foreground",
};

/**
 * 表里的一行。**逻辑上是一张表**，只是行之间有父子关系：产品行是对象，渠道行是它
 * 的附属明细，可折叠。
 *
 * 之所以拉平成一个行集而不是"展开行里再嵌一张表"：嵌套那条路要靠占位格数、固定
 * 列宽、隐藏表头三样东西去凑对齐，而且每一样都能单独失配。同一个 `columns` 渲染
 * 两种行，列位置由结构保证，不需要任何对齐补偿。
 */
type HealthRow =
  | { key: string; kind: "product"; item: ProductHealthItem }
  | {
      key: string;
      kind: "channel";
      item: ProductHealthItem;
      channel: "beta" | "canary";
    };

/** 一行对应的渠道读数：产品行读 stable（prod），渠道行读它自己的。 */
function channelOf(row: HealthRow): ProductChannelHealth {
  return row.kind === "product" ? row.item.prod : row.item[row.channel];
}

/** 探测点的默认路径约定（与 opera-bff `product-health.router.ts` 同源）。
 *  两条并发探、先拿到的非 404 视为命中；两条都 404 才记未实现。 */
const LIVENESS_PATHS = ["/api/health", "/healthz"] as const;
const READINESS_PATHS = ["/api/ready", "/readyz"] as const;

function LivenessLine({
  probe,
  emphasis,
}: {
  probe: LivenessProbe;
  emphasis: ChannelEmphasis;
}) {
  const isProd = emphasis === "prod";
  const detail =
    probe.status === "healthy"
      ? probe.durationMs !== null
        ? `${probe.durationMs}ms`
        : null
      : probe.status === "unreachable"
        ? (probe.error ?? "连接失败")
        : probe.status === "unhealthy"
          ? (probe.error ?? `HTTP ${probe.httpStatus ?? "?"}`)
          : probe.status === "not_applicable"
            ? NOT_APPLICABLE_DETAIL
            : null;

  return (
    <span className="inline-flex items-center gap-2xs min-w-0">
      <StatusBadge
        tone={livenessTone(probe.status)}
        dot
        {...(isProd ? { className: "font-semibold" } : {})}
      >
        {LIVENESS_LABELS[probe.status]}
      </StatusBadge>
      {detail ? (
        <span className={`${EMPHASIS_TEXT[emphasis]} truncate`}>{detail}</span>
      ) : null}
    </span>
  );
}

function ReadinessLine({
  probe,
  emphasis,
}: {
  probe: ReadinessProbe;
  emphasis: ChannelEmphasis;
}) {
  const isProd = emphasis === "prod";
  const checksSummary = formatChecks(probe.checks);
  const detail =
    checksSummary ??
    (probe.status === "unreachable" ? (probe.error ?? "连接失败") : null);

  return (
    <span className="inline-flex items-center gap-2xs min-w-0">
      <StatusBadge
        tone={readinessTone(probe.status)}
        dot
        {...(isProd ? { className: "font-semibold" } : {})}
      >
        {READINESS_LABELS[probe.status]}
      </StatusBadge>
      {detail ? (
        <span className={`${EMPHASIS_TEXT[emphasis]} truncate`}>{detail}</span>
      ) : null}
    </span>
  );
}

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready" };

type StatusFilter = "all" | "attention";

const CSV_HEADER = [
  "产品",
  "代码",
  "层级",
  "渠道",
  "存活",
  "就绪",
  "版本",
  "源",
  "最近探测",
];

/**
 * 一行 = 一个 (产品, 渠道)，**与屏幕上看到的行一一对应**。
 *
 * 原来是一行塞进 prod 与 beta 两组读数，那是双渠道同挤一行时的形状；现在表里
 * 一个渠道就是一行，导出与复制都跟着它走——否则粘到工单里的东西与截图对不上。
 *
 * 未登记的渠道**照样出一行**：「beta / 未配置」正是要发给做基础接入的人的那句话，
 * 把它从导出里省掉，等于让最需要被传达的事实无法复制。未接入的产品同理：
 * 「stable / 未接入」就是要发给产品方的那句话。
 */
function toCsvRow(row: HealthRow): string[] {
  const { item } = row;
  const base = [item.productName, item.productCode, LAYER_LABEL[item.layer]];
  const channelName = row.kind === "product" ? "stable" : row.channel;
  if (!item.onboarded) {
    return [
      ...base,
      channelName,
      NOT_ONBOARDED_LABEL,
      NOT_ONBOARDED_LABEL,
      "",
      "",
      "",
    ];
  }
  const channel = channelOf(row);
  if (!channel.clientId) {
    return [...base, channelName, "未配置", "未配置", "", "", ""];
  }
  return [
    ...base,
    channelName,
    LIVENESS_LABELS[channel.health.status],
    READINESS_LABELS[channel.status.status],
    channel.health.version ?? "",
    channel.origin ?? "",
    channel.health.checkedAt,
  ];
}

/** 一个产品在导出里占三行：stable + beta + canary。 */
function productCsvRows(item: ProductHealthItem): string[][] {
  return [
    toCsvRow({ key: item.productId, kind: "product", item }),
    toCsvRow({
      key: `${item.productId}:beta`,
      kind: "channel",
      item,
      channel: "beta",
    }),
    toCsvRow({
      key: `${item.productId}:canary`,
      kind: "channel",
      item,
      channel: "canary",
    }),
  ];
}

export default function ServiceMonitorPage() {
  const tShared = useTranslations();
  const { toast } = useToast();
  const [items, setItems] = useState<ProductHealthItem[]>([]);
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  /* 缺省全部收起：一屏先回答「哪些产品的 prod 有问题」，要看渠道再展开。 */
  const [expandedKeys, setExpandedKeys] = useState<readonly string[]>([]);
  /** 打开「探测点」抽屉的目标：哪个产品的哪个渠道。 */
  const [probeTarget, setProbeTarget] = useState<{
    item: ProductHealthItem;
    channel: "stable" | "beta" | "canary";
  } | null>(null);
  const [selected, setSelected] = useState<readonly string[]>([]);

  const reload = useCallback(async (opts?: { silent?: boolean }) => {
    if (opts?.silent) {
      setRefreshing(true);
    } else {
      setLoad({ kind: "loading" });
    }
    try {
      const data = await api.get<ProductHealthItem[]>("/api/product-health");
      setItems(data);
      setLastFetchedAt(new Date());
      setLoad({ kind: "ready" });
    } catch (error) {
      setLoad({
        kind: "error",
        message:
          error instanceof OperaApiError
            ? error.message
            : "读取产品健康数据失败",
      });
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  /* 隐藏即停、回前台补取、卸载即清（`useVisiblePolling` 文件头讲了原来那份错在哪）。
     30 秒这个频次来自设计文件 §7.3：存活/就绪探测对被测方是真实请求，没人看时不该
     继续打。 */
  useVisiblePolling(() => void reload({ silent: true }), REFRESH_INTERVAL_MS);

  const visible = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return items.filter((item) => {
      const matchesKeyword =
        kw === "" ||
        item.productName.toLowerCase().includes(kw) ||
        item.productCode.toLowerCase().includes(kw);
      const matchesStatus =
        statusFilter === "all" || productNeedsAttention(item);
      return matchesKeyword && matchesStatus;
    });
  }, [items, keyword, statusFilter]);

  const filtered = keyword.trim() !== "" || statusFilter !== "all";
  const pager = useListPagination(visible, 20);

  function toggleExpanded(key: string) {
    setExpandedKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  }

  /** 展开的产品在自己下面多出两行；不展开就只有它自己。 */
  const displayRows: HealthRow[] = pager.pageRows.flatMap((item) =>
    expandedKeys.includes(item.productId)
      ? [
          { key: item.productId, kind: "product" as const, item },
          {
            key: `${item.productId}:beta`,
            kind: "channel" as const,
            item,
            channel: "beta" as const,
          },
          {
            key: `${item.productId}:canary`,
            kind: "channel" as const,
            item,
            channel: "canary" as const,
          },
        ]
      : [{ key: item.productId, kind: "product" as const, item }],
  );

  const allExpanded =
    pager.pageRows.length > 0 &&
    pager.pageRows.every((r) => expandedKeys.includes(r.productId));

  const copyRow = async (row: HealthRow) => {
    const text = toCsvRow(row).join(" · ");
    try {
      await navigator.clipboard.writeText(text);
      toast({ tone: "success", title: "已复制诊断信息到剪贴板" });
    } catch {
      toast({
        tone: "danger",
        title: tShared("common.copyFailed"),
        description: tShared("common.copyDenied"),
      });
    }
  };

  const exportSelected = () => {
    const ids = new Set(selected);
    const picked = visible.filter((r) => ids.has(r.productId));
    downloadCsv(`service-monitor-${Date.now()}.csv`, [
      CSV_HEADER,
      ...picked.flatMap(productCsvRows),
    ]);
    toast({ tone: "success", title: `已导出 ${picked.length} 条记录` });
    setSelected([]);
  };

  const stats = useMemo(() => {
    const attention = items.filter(productNeedsAttention).length;
    const onboarded = items.filter((i) => i.onboarded).length;
    /* 就绪只统计已接入产品的 stable：beta / canary 未登记、产品未接入，把它们计进
       分母会得到一个 "2/24 已实现" 这样的数——分母里大半是从来没存在过的渠道。 */
    const readinessImplemented = items.filter(
      (i) =>
        i.onboarded &&
        i.prod.status.status !== "not_configured" &&
        i.prod.status.status !== "not_implemented",
    ).length;
    return {
      total: items.length,
      onboarded,
      attention,
      readinessImplemented,
    };
  }, [items]);

  function resetFilters() {
    setKeyword("");
    setStatusFilter("all");
  }

  /* 二级表用 `leadingSpacer` 占住父表折叠列那一格来对齐：渠道与产品的归属关系靠
     **列对齐**读出来，而不是靠一个缩进的方框。列宽与父表逐列对齐，所以「存活」
     在上下两级是同一条竖线。 */
  const pagination = (
    <ListPagination
      className="w-full"
      currentPage={pager.page}
      pageCount={pager.pageCount}
      total={items.length}
      filteredTotal={visible.length}
      pageSize={pager.pageSize}
      onPageSizeChange={pager.onPageSizeChange}
      onPageChange={pager.onPageChange}
    />
  );

  const emptyState =
    load.kind === "loading" ? (
      <EmptyState
        title={tShared("common.loading")}
        description="正在探测各产品 stable 渠道的存活与就绪状态。"
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
    ) : filtered ? (
      <EmptyState
        title="没有匹配的产品"
        description={tShared("common.noMatchHint")}
      />
    ) : (
      <EmptyState
        title="产品目录为空"
        description="本页的清单就是「产品管理 · 产品目录」。先在那里登记产品，登记后这里自动出现一行（未接入），签发接入凭据后开始探测。"
      />
    );

  return (
    <>
      <ListPageTemplate
        header={
          <ViewHeader
            icon="server"
            title="服务状态"
            description="产品目录里的每个产品按渠道看存活与就绪。主行是 stable（prod），展开看 beta 与 canary——渠道要在「接入凭据」登记 OIDC 客户端，登记之后才有地址可探；没有任何客户端的产品显示「未接入」。清单来自产品目录，探测目标来自客户端登记，两者都不是静态清单。"
            secondary={
              lastFetchedAt ? (
                <Badge>
                  上次探测 {formatTime(lastFetchedAt.toISOString())}
                </Badge>
              ) : null
            }
            action={
              <Button
                variant="outline"
                onClick={() => void reload()}
                disabled={load.kind === "loading" || refreshing}
              >
                <Icon name="refresh" size="sm" aria-hidden="true" />
                {tShared("common.refresh")}
              </Button>
            }
          />
        }
        summary={
          <MetricGrid
            aria-label="产品健康概览"
            loading={load.kind === "loading" && items.length === 0}
            columns={4}
            items={[
              {
                id: "total",
                label: "目录产品",
                value: String(stats.total),
                icon: "server",
                help: "与「产品管理 · 产品目录」同一份清单（含草稿）。",
              },
              {
                /* 目录里有、但还没签发任何 OIDC 客户端的产品，差值就是「未接入」。 */
                id: "onboarded",
                label: "已接入",
                value: `${stats.onboarded}/${stats.total}`,
                icon: "circle-dashed",
                help: "至少签发了一个活跃 OIDC 客户端的产品数；其余显示「未接入」，要在「接入凭据」登记后才有地址可探。",
              },
              {
                id: "attention",
                label: "需要关注",
                value: String(stats.attention),
                icon: "warning",
                ...(stats.attention > 0 ? { tone: "danger" as const } : {}),
              },
              {
                id: "readiness",
                label: "就绪已实现",
                value: `${stats.readinessImplemented}/${stats.onboarded}`,
                icon: "shield-check",
                help: "已接入产品里，stable 渠道实现了 readiness（/api/ready 或 /readyz）的占比",
              },
            ]}
          />
        }
        filters={
          <FilterBar
            view="list"
            onViewChange={() => {}}
            cardsDisabledReason={tShared("common.cardsRetired")}
            count={
              visible.length === items.length
                ? items.length
                : `${visible.length} / ${items.length}`
            }
            scope={
              <Button
                variant="outline"
                size="sm"
                disabled={pager.pageRows.length === 0}
                onClick={() =>
                  setExpandedKeys(
                    allExpanded ? [] : pager.pageRows.map((r) => r.productId),
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
                placeholder="搜索产品名称 / 代码…"
                aria-label="搜索产品"
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
                setStatusFilter(e.target.value as StatusFilter);
                pager.resetPage();
              }}
              aria-label={tShared("filters.stateLabel")}
            >
              <option value="all">全部产品</option>
              <option value="attention">需要关注</option>
            </NativeSelect>
            <Button variant="outline" size="md" onClick={resetFilters}>
              重置
            </Button>
          </FilterBar>
        }
        bulkBar={
          <BulkActionBar
            count={selected.length}
            noun="个"
            onClear={() => setSelected([])}
            actions={[
              {
                id: "export",
                label: "导出所选",
                icon: "download",
                onSelect: exportSelected,
              },
            ]}
          />
        }
        table={
          <DataTable
            columns={[
              {
                /* 折叠开关放在这一列里，不用 DataTable 的展开列——一张表两种行，
                 折叠是产品行自己的事。渠道行这一格留空，缩进即由此而来。 */
                id: "product",
                header: tShared("columns.product"),
                cell: (r: HealthRow) =>
                  r.kind === "product" ? (
                    <div className="flex items-center gap-xs">
                      <Button
                        variant="ghost"
                        size="md"
                        aria-label={
                          expandedKeys.includes(r.key) ? "收起渠道" : "展开渠道"
                        }
                        onClick={() => toggleExpanded(r.key)}
                      >
                        <Icon
                          name={
                            expandedKeys.includes(r.key)
                              ? "chevron-down"
                              : "chevron-right"
                          }
                          size="sm"
                          aria-hidden="true"
                        />
                      </Button>
                      <Icon
                        name={LAYER_ICON[r.item.layer]}
                        size="sm"
                        className="shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <div className="flex flex-col gap-2xs">
                        <span className="inline-flex items-center gap-xs text-label-md text-foreground">
                          {r.item.productName}
                          {/* 产品状态只在不是「已上线」时显示：目录里的草稿 / 已停用 /
                           已退役产品同样在清单里，读数旁边得说明它处在哪一步。 */}
                          {r.item.state !== "active" ? (
                            <StatusBadge
                              tone={PRODUCT_STATE_META[r.item.state].tone}
                            >
                              {PRODUCT_STATE_META[r.item.state].label}
                            </StatusBadge>
                          ) : null}
                        </span>
                        <span className="text-body-sm text-muted-foreground">
                          {r.item.productCode} · {LAYER_LABEL[r.item.layer]}
                        </span>
                      </div>
                    </div>
                  ) : null,
              },
              {
                id: "channel",
                header: "渠道",
                align: "center",
                width: "xs",
                cell: (r: HealthRow) =>
                  r.kind === "product" ? (
                    <Badge variant="secondary">stable</Badge>
                  ) : (
                    <Badge variant="outline">{r.channel}</Badge>
                  ),
              },
              {
                /* 三种中性态各用各的词：未接入（产品没有任何客户端）、未配置（这个
                 渠道没登记）、以及探过之后的真实读数。前两种走同一个 Badge，不进
                 `LivenessLine`——后者只会把 status 映射成颜色，而没有客户端就没有
                 status 可映射。 */
                id: "health",
                header: "存活",
                width: "sm",
                cell: (r: HealthRow) => {
                  const channel = channelOf(r);
                  const emphasis = r.kind === "product" ? "prod" : "beta";
                  if (!r.item.onboarded) {
                    return (
                      <StatusBadge tone="neutral" dot>
                        {NOT_ONBOARDED_LABEL}
                      </StatusBadge>
                    );
                  }
                  return channel.clientId ? (
                    <LivenessLine probe={channel.health} emphasis={emphasis} />
                  ) : (
                    <StatusBadge tone="neutral" dot>
                      未配置
                    </StatusBadge>
                  );
                },
              },
              {
                id: "status",
                header: "就绪",
                width: "sm",
                cell: (r: HealthRow) => {
                  const channel = channelOf(r);
                  const emphasis = r.kind === "product" ? "prod" : "beta";
                  if (!r.item.onboarded) {
                    return (
                      <StatusBadge tone="neutral" dot>
                        {NOT_ONBOARDED_LABEL}
                      </StatusBadge>
                    );
                  }
                  return channel.clientId ? (
                    <ReadinessLine probe={channel.status} emphasis={emphasis} />
                  ) : (
                    <StatusBadge tone="neutral" dot>
                      未配置
                    </StatusBadge>
                  );
                },
              },
              {
                id: "version",
                header: "版本",
                width: "sm",
                cell: (r: HealthRow) => {
                  const channel = channelOf(r);
                  const emphasis = r.kind === "product" ? "prod" : "beta";
                  return channel.clientId ? (
                    <span className={`${EMPHASIS_TEXT[emphasis]} truncate`}>
                      {channel.health.version ?? "—"}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  );
                },
              },
              {
                id: "buildTime",
                header: "发布时间",
                width: "sm",
                cell: (r: HealthRow) => {
                  const channel = channelOf(r);
                  const emphasis = r.kind === "product" ? "prod" : "beta";
                  return channel.clientId ? (
                    <span className={EMPHASIS_TEXT[emphasis]}>
                      {formatBuildTime(channel.health.buildTime)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  );
                },
              },
              {
                id: "checkedAt",
                header: "最近探测",
                width: "sm",
                cell: (r: HealthRow) => {
                  const channel = channelOf(r);
                  const emphasis = r.kind === "product" ? "prod" : "beta";
                  return channel.clientId ? (
                    <span className={EMPHASIS_TEXT[emphasis]}>
                      {formatTime(channel.health.checkedAt)}
                    </span>
                  ) : (
                    /* 不写"从未"也不写时间：没有地址就没有发生过探测这件事。 */
                    <span className="text-muted-foreground">—</span>
                  );
                },
              },
            ]}
            /* 没有序号列：一张表里两级行，行号会把渠道明细也编进去——12 个产品
             全展开后编到 36，而计数条上写的是 12，两个数对不上。行号在这页本来
             也不承担任何用途。 */
            rows={displayRows}
            rowKey={(r: HealthRow) => r.key}
            selectedKeys={selected}
            onSelectionChange={setSelected}
            /* 勾选一条渠道明细没有意义——批量动作的对象是产品。 */
            isRowSelectable={(r: HealthRow) => r.kind === "product"}
            rowActions={(r: HealthRow) => (
              /* **两种行同一套条目**：一张表里行就是行，没有理由让渠道行少一个动作。
               「复制诊断信息」对未登记的渠道尤其有用——「beta / 未配置」正是要发给
               做基础接入的人的那句话。 */
              <ActionMenu
                label={
                  r.kind === "product"
                    ? `${r.item.productName} 操作`
                    : `${r.item.productName} ${r.channel} 操作`
                }
                items={[
                  {
                    id: "probe",
                    label: "探测点",
                    icon: "target",
                    onSelect: () =>
                      setProbeTarget({
                        item: r.item,
                        channel: r.kind === "product" ? "stable" : r.channel,
                      }),
                  },
                  {
                    id: "copy",
                    label: "复制诊断信息",
                    icon: "copy",
                    separatorBefore: true,
                    onSelect: () => void copyRow(r),
                  },
                ]}
              />
            )}
            footer={pagination}
            empty={emptyState}
          />
        }
      />

      {/* ── 探测点：从哪儿读、读哪条路径、命中了哪个 ──────────────────────── */}
      <Drawer
        open={probeTarget !== null}
        onClose={() => setProbeTarget(null)}
        width="md"
        title={
          probeTarget ? `探测点 · ${probeTarget.item.productName}` : undefined
        }
        description={
          probeTarget
            ? `${probeTarget.item.productCode} · ${probeTarget.channel}`
            : undefined
        }
      >
        {probeTarget ? <ProbePoints target={probeTarget} /> : null}
      </Drawer>
    </>
  );
}

/**
 * 探测点详情：**探测目标不是配置出来的，是登记出来的**。
 *
 * origin = 该渠道 OIDC 客户端 `redirect_uris` 去掉路径后的源；路径则是两套运行时
 * 约定各试一条（Next 前端 / Nest 后端），先拿到的非 404 视为命中。所以这里显示的
 * 是"读的是哪个地址的哪条路径"，而**没有可编辑的输入框**——改探测目标的正确做法是
 * 去改那个客户端的回调地址，在这里另开一个覆盖字段会立刻产生两个真相。
 *
 * 真要做到"可配置"，缺的不是界面是**存放处**：需要一张 per-product 的探针覆盖表
 * （自定义路径 / 超时 / 是否跳过），平台侧目前没有。见页面上的说明。
 */
function ProbePoints({
  target,
}: {
  target: { item: ProductHealthItem; channel: "stable" | "beta" | "canary" };
}) {
  const channelKey: ChannelKey =
    target.channel === "stable" ? "prod" : target.channel;
  const channel = target.item[channelKey];
  const configured = channel.clientId !== null;

  return (
    <div className="flex flex-col gap-lg">
      <Banner
        tone="info"
        title="探测目标来自 OIDC 客户端登记，不是这里的配置"
        description="origin 取自该渠道客户端 redirect_uris 去掉路径后的源。要换探测目标，去「产品管理 · 接入凭据」改回调地址——在这里另开一个覆盖字段会立刻产生两个真相。"
      />

      {!target.item.onboarded ? (
        <EmptyState
          icon="target"
          title="产品尚未接入"
          description="这个产品在产品目录里，但还没有任何 OIDC 客户端，因此没有 origin，也就没有探测发生过。去「产品管理 · 接入凭据」为它签发 stable 渠道的客户端后，这里开始显示探测结果。"
        />
      ) : !configured ? (
        <EmptyState
          icon="target"
          title={`${target.channel} 尚未登记`}
          description={`这个产品名下没有 release_channel='${target.channel}' 的活跃 OIDC 客户端，因此没有 origin，也就没有探测发生过。在「接入凭据」按该渠道登记客户端后，这里会显示与 stable 同样的内容。`}
        />
      ) : (
        <>
          <Section title="源" icon="globe" level={2}>
            <p className="font-mono text-code-sm text-foreground">
              {channel.origin ?? "—"}
            </p>
            <p className="text-body-sm text-muted-foreground">
              客户端 {channel.clientId}
              {channel.origin === null
                ? " · 回调地址解析不出 origin，无法探测"
                : null}
            </p>
          </Section>

          <Section
            title="存活探测"
            icon="waveform"
            level={2}
            description="两条路径并发试，先拿到的非 404 视为命中；两条都 404 记异常——存活不是可选项。"
          >
            <ProbeDetail
              paths={LIVENESS_PATHS}
              hit={channel.health.path}
              httpStatus={channel.health.httpStatus}
              durationMs={channel.health.durationMs}
              error={channel.health.error}
              extra={[
                ["service", channel.health.service],
                ["version", channel.health.version],
                ["gitSha", channel.health.gitSha],
                ["stage", channel.health.stage],
              ]}
            />
          </Section>

          <Section
            title="就绪探测"
            icon="shield-check"
            level={2}
            description="025 标准把 readiness 列为可选，两条都 404 记「未实现」而不是异常。"
          >
            <ProbeDetail
              paths={READINESS_PATHS}
              hit={channel.status.path}
              httpStatus={channel.status.httpStatus}
              durationMs={channel.status.durationMs}
              error={channel.status.error}
              extra={[["checks", formatChecks(channel.status.checks)]]}
            />
          </Section>
        </>
      )}

      <Banner
        tone="warning"
        title="还不能在这里配置"
        description="自定义探测路径 / 超时 / 临时跳过，缺的不是界面是存放处——平台侧没有 per-product 的探针覆盖表。真要做，那张表得先建，否则这里填的东西没有地方落。"
      />
    </div>
  );
}

/** 一条探测的"试了哪些、命中哪个、结果如何"。 */
function ProbeDetail({
  paths,
  hit,
  httpStatus,
  durationMs,
  error,
  extra,
}: {
  paths: readonly string[];
  hit: string | null;
  httpStatus: number | null;
  durationMs: number | null;
  error: string | null;
  extra: readonly (readonly [string, string | null])[];
}) {
  return (
    <div className="flex flex-col gap-sm">
      <div className="flex flex-wrap gap-2xs">
        {paths.map((p) => (
          <Badge key={p} variant={p === hit ? "secondary" : "outline"}>
            {p}
            {p === hit ? " · 命中" : ""}
          </Badge>
        ))}
      </div>
      <dl className="flex flex-col gap-2xs text-body-sm">
        <FactLine
          label="HTTP"
          value={httpStatus !== null ? String(httpStatus) : null}
        />
        <FactLine
          label="耗时"
          value={durationMs !== null ? `${durationMs}ms` : null}
        />
        <FactLine label="错误" value={error} />
        {extra.map(([k, v]) => (
          <FactLine key={k} label={k} value={v} />
        ))}
      </dl>
    </div>
  );
}

function FactLine({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex gap-sm">
      <dt className="w-panel-3xs shrink-0 text-muted-foreground">{label}</dt>
      <dd className="font-mono text-code-sm text-foreground">{value ?? "—"}</dd>
    </div>
  );
}
