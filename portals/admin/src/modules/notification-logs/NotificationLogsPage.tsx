"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  ActionButton,
  DataTable,
  EmptyState,
  FilterBar,
  Input,
  ListPageTemplate,
  MetricGrid,
  NativeSelect,
  Pagination,
  StatusBadge,
  TableTitleCell,
  useToast,
} from "@vxture/design-system";
import type { DataTableColumn, StatusBadgeTone } from "@vxture/design-system";
import { fetchNotificationLogs } from "@/api/admin-bff";
import type { NotificationLogRecord } from "@/entities/console";
import { exportRowsToCsv, type CsvColumn } from "@/lib/exportCsv";
import { PageHeader } from "@/modules/shared/PageHeader";

/* 收 `locale` 而不是写死 `"zh-CN"`：日期的字段顺序属于语言——中文
   `2026/08/18`，英文 `08/18/2026`。同一串数字，读出来是两个日期。 */
function formatDateTime(value: string, locale: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// P2 占位板块建设：通知投递台账（support.notification_logs，只读）。
// 守卫 notification:log.read（seed §4.3）。回执字段由投递 webhook 回写。

const PAGE_SIZE = 20;

const CHANNEL_LABELS: Record<string, string> = {
  email: "邮件",
  sms: "短信",
  inapp: "站内",
  webhook: "Webhook",
  push: "推送",
};

const STATUS_LABELS: Record<string, string> = {
  queued: "排队中",
  sent: "已发送",
  delivered: "已送达",
  opened: "已打开",
  failed: "失败",
  bounced: "退回",
};

/** 投递状态 -> DS 语气。映射留产品侧，DS 不认业务状态。 */
function statusTone(status: string): StatusBadgeTone {
  if (status === "delivered" || status === "opened") return "success";
  if (status === "failed" || status === "bounced") return "danger";
  if (status === "sent") return "info";
  return "neutral";
}

function describeError(error: unknown): { description?: string } {
  return error instanceof Error && error.message
    ? { description: error.message }
    : {};
}

const CSV_COLUMNS: readonly CsvColumn<NotificationLogRecord>[] = [
  { label: "时间", value: (item) => item.createdAt },
  {
    label: "渠道",
    value: (item) => CHANNEL_LABELS[item.channel] ?? item.channel,
  },
  { label: "模板", value: (item) => item.templateCode },
  { label: "接收方", value: (item) => item.recipient },
  { label: "状态", value: (item) => STATUS_LABELS[item.status] ?? item.status },
  { label: "重试", value: (item) => String(item.retryCount) },
  { label: "租户", value: (item) => item.tenantName ?? "" },
  { label: "错误", value: (item) => item.errorMessage ?? "" },
];

/* 从模块级常量改成收 `locale` 的工厂：常量在模块加载时就求值了，那一刻
   没有任何运行时上下文，而列里的日期要按界面语言排。 */
function columnsOf(
  locale: string,
): readonly DataTableColumn<NotificationLogRecord>[] {
  return [
    {
      id: "createdAt",
      header: "时间",
      cell: (item) => formatDateTime(item.createdAt, locale),
    },
    {
      id: "channel",
      header: "渠道",
      cell: (item) => CHANNEL_LABELS[item.channel] ?? item.channel,
    },
    {
      id: "template",
      header: "模板",
      cell: (item) => (
        <TableTitleCell
          title={item.templateCode}
          {...(item.referenceType ? { description: item.referenceType } : {})}
        />
      ),
    },
    { id: "recipient", header: "接收方", cell: (item) => item.recipient },
    {
      id: "status",
      header: "状态",
      align: "center",
      cell: (item) => (
        <StatusBadge tone={statusTone(item.status)}>
          {STATUS_LABELS[item.status] ?? item.status}
          {item.retryCount > 0 ? ` ·${item.retryCount}` : ""}
        </StatusBadge>
      ),
    },
    { id: "tenant", header: "租户", cell: (item) => item.tenantName ?? "-" },
  ];
}

export function NotificationLogsPage() {
  const locale = useLocale();
  /* 钉在 locale 上：工厂每次调用都新建数组，而这套列此前是模块常量、
     身份稳定。不 memo 等于每次渲染换一套列。 */
  const tableColumns = useMemo(() => columnsOf(locale), [locale]);
  const tShared = useTranslations();
  const { toast } = useToast();
  const [items, setItems] = useState<NotificationLogRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [channelFilter, setChannelFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchNotificationLogs()
      .then(setItems)
      .catch((error) =>
        toast({ tone: "danger", title: "加载失败", ...describeError(error) }),
      )
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    let result = items;
    if (channelFilter !== "all")
      result = result.filter((i) => i.channel === channelFilter);
    if (statusFilter !== "all")
      result = result.filter((i) => i.status === statusFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter((i) =>
        [i.recipient, i.templateCode, i.referenceId ?? "", i.tenantName ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(q),
      );
    }
    return result;
  }, [items, search, channelFilter, statusFilter]);

  const pageItems = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page]);
  const pageCount = Math.ceil(filtered.length / PAGE_SIZE);

  const failedCount = items.filter(
    (i) => i.status === "failed" || i.status === "bounced",
  ).length;

  return (
    <ListPageTemplate
      className="vx-notification-page"
      header={
        <PageHeader
          icon="bell"
          title="通知记录"
          description="平台通知投递台账（只读）。涵盖邮件、短信、站内、Webhook、推送渠道的发送与回执状态，用于投递排障。"
        />
      }
      summary={
        <MetricGrid
          loading={loading}
          aria-label="通知投递统计"
          columns={2}
          items={[
            {
              id: "total",
              help: "当前筛选条件下的投递记录条数。",
              icon: "bell",
              label: "投递总数",
              value: String(items.length),
            },
            {
              id: "failed",
              help: "投递失败与被退回的记录合计。",
              icon: "warning",
              label: "失败 / 退回",
              value: String(failedCount),
              tone: failedCount ? "danger" : "success",
            },
          ]}
        />
      }
      filters={
        <FilterBar
          count={`${filtered.length} 条`}
          aria-label="通知记录筛选"
          search={
            <Input
              type="search"
              className="grow basis-media-3xl max-w-panel-sm"
              placeholder="搜索接收方、模板、业务号、租户…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          }
          actions={
            <ActionButton
              icon="arrow-down"
              variant={selectedIds.size > 0 ? "default" : "outline"}
              disabled={selectedIds.size === 0}
              onClick={() =>
                exportRowsToCsv(
                  "notification-logs",
                  CSV_COLUMNS,
                  filtered.filter((item) => selectedIds.has(item.id)),
                )
              }
            >
              {tShared("common.export")}
            </ActionButton>
          }
          onReset={() => {
            setSearch("");
            setChannelFilter("all");
            setStatusFilter("all");
            setPage(1);
          }}
        >
          <NativeSelect
            wrapperClassName="w-fit"
            className="w-fit basis-media-xl"
            value={channelFilter}
            onChange={(e) => {
              setChannelFilter(e.target.value);
              setPage(1);
            }}
            aria-label="投递渠道"
          >
            <option value="all">全部渠道</option>
            {Object.entries(CHANNEL_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            wrapperClassName="w-fit"
            className="w-fit basis-media-xl"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            aria-label="投递状态"
          >
            <option value="all">{tShared("filters.allStates")}</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </NativeSelect>
        </FilterBar>
      }
      table={
        <DataTable
          columns={tableColumns}
          rows={pageItems}
          rowKey={(item) => item.id}
          loading={loading}
          indexStart={(page - 1) * PAGE_SIZE + 1}
          selectedKeys={[...selectedIds]}
          onSelectionChange={(keys) => setSelectedIds(new Set(keys))}
          empty={
            <EmptyState
              title="暂无通知记录"
              description={
                search || channelFilter !== "all" || statusFilter !== "all"
                  ? tShared("common.adjustFiltersHint")
                  : "数据库中没有通知投递记录"
              }
            />
          }
          footer={
            pageCount > 1 ? (
              <Pagination
                page={page}
                pageCount={pageCount}
                onPageChange={setPage}
              />
            ) : null
          }
        />
      }
    />
  );
}
