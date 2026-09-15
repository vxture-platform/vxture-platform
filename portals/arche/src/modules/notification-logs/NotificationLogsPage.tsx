"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useTableLabels } from "@/modules/shared/table";
import {
  ActionButton,
  DataTable,
  EmptyState,
  FilterBar,
  Input,
  ListPageTemplate,
  MetricGrid,
  NativeSelect,
  StatusBadge,
  TableTitleCell,
  useToast,
} from "@vxture/design-system";
import type {
  DataTableColumn,
  DataTableSort,
  StatusBadgeTone,
} from "@vxture/design-system";
import { fetchNotificationLogs } from "@/api/arche-bff";
import type { NotificationLogRecord } from "@/entities/console";
import { exportRowsToCsv, type CsvColumn } from "@/lib/exportCsv";
import { sortParams } from "@/lib/table-sort";
import { PageHeader } from "@/modules/shared/PageHeader";
import { ListPagination } from "@/modules/shared/ListPagination";
import { type PageSize } from "@/modules/shared/PageSizePicker";
import { formatDateTime as sharedDateTime } from "@vxture-platform/shared";

/* 收 `locale` 而不是写死 `"zh-CN"`：日期的字段顺序属于语言——中文
   `2026/08/18`，英文 `08/18/2026`。同一串数字，读出来是两个日期。 */
function formatDateTime(value: string, locale: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return sharedDateTime(d, locale);
}

// 通知投递台账（support.notification_logs，只读）。守卫 audit:notification_log.read。
// 回执字段由投递 webhook 回写。表截在 500 条，排序交给 BFF（sortParams）。

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

/* 列序：接收方是这一行「发给谁」，作标题列居左；其余居中。时间收在末列。 */
function columnsOf(
  locale: string,
): readonly DataTableColumn<NotificationLogRecord>[] {
  return [
    {
      id: "recipient",
      header: "接收方",
      sortable: true,
      cell: (item) => (
        <TableTitleCell
          icon="user"
          title={item.recipient}
          {...(item.subject ? { description: item.subject } : {})}
        />
      ),
    },
    {
      id: "template",
      header: "模板",
      sortable: true,
      cell: (item) => item.templateCode,
    },
    {
      id: "channel",
      header: "渠道",
      sortable: true,
      cell: (item) => CHANNEL_LABELS[item.channel] ?? item.channel,
    },
    {
      id: "status",
      header: "状态",
      sortable: true,
      cell: (item) => (
        <StatusBadge tone={statusTone(item.status)}>
          {STATUS_LABELS[item.status] ?? item.status}
          {item.retryCount > 0 ? ` ·${item.retryCount}` : ""}
        </StatusBadge>
      ),
    },
    {
      id: "tenant",
      header: "租户",
      sortable: true,
      cell: (item) => item.tenantName ?? "-",
    },
    {
      id: "createdAt",
      header: "时间",
      sortable: true,
      cell: (item) => formatDateTime(item.createdAt, locale),
    },
  ];
}

export function NotificationLogsPage() {
  const locale = useLocale();
  const tableColumns = useMemo(() => columnsOf(locale), [locale]);
  const tShared = useTranslations();
  const tableLabels = useTableLabels();
  const { toast } = useToast();
  const [items, setItems] = useState<NotificationLogRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [channelFilter, setChannelFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sort, setSort] = useState<DataTableSort | undefined>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(20);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchNotificationLogs(sortParams(sort))
      .then((rows) => {
        if (active) setItems(rows);
      })
      .catch((error) =>
        toast({ tone: "danger", title: "加载失败", ...describeError(error) }),
      )
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort]);

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
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);
  const pageCount = Math.ceil(filtered.length / pageSize);

  const failedCount = items.filter(
    (i) => i.status === "failed" || i.status === "bounced",
  ).length;

  return (
    <ListPageTemplate
      className="vx-notification-page"
      header={
        <PageHeader
          icon="bell"
          title="发送记录"
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
              help: "当前加载到的投递记录条数。",
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
          view="list"
          onViewChange={() => {}}
          cardsDisabledReason="卡片视图已下线，改用列表"
          count={`${filtered.length} 条`}
          aria-label="发送记录筛选"
          search={
            <Input
              type="search"
              className="min-w-media-2xl grow basis-0 max-w-panel-sm"
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
            wrapperClassName="w-fit basis-media-xl"
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
            wrapperClassName="w-fit basis-media-xl"
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
          labels={tableLabels}
          columns={tableColumns}
          rows={pageItems}
          rowKey={(item) => item.id}
          loading={loading}
          indexStart={(page - 1) * pageSize + 1}
          selectedKeys={[...selectedIds]}
          onSelectionChange={(keys) => setSelectedIds(new Set(keys))}
          {...(sort ? { sort: sort } : {})}
          onSortChange={(next) => {
            setSort(next);
            setPage(1);
          }}
          empty={
            <EmptyState
              title="暂无通知记录"
              description={
                search || channelFilter !== "all" || statusFilter !== "all"
                  ? tShared("common.adjustFiltersHint")
                  : "还没有通知投递记录"
              }
            />
          }
          footer={
            <ListPagination
              currentPage={page}
              pageCount={pageCount}
              total={filtered.length}
              pageSize={pageSize}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1);
              }}
              onPageChange={setPage}
            />
          }
        />
      }
    />
  );
}
