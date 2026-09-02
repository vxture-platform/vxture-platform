"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import {
  ActionButton,
  ActionMenu,
  Badge,
  DataTable,
  EmptyState,
  FilterBar,
  Input,
  ListPageTemplate,
  MetricGrid,
  NativeSelect,
  Section,
  SegmentedControl,
  StatusBadge,
  TableTitleCell,
} from "@vxture/design-system";
import type { IconName, StatusBadgeTone } from "@vxture/design-system";
import { exportRowsToCsv, type CsvColumn } from "@/lib/exportCsv";
import { ListPagination } from "@/modules/shared/ListPagination";
import type { PageSize } from "@/modules/shared/PageSizePicker";
import {
  fetchOrderOperations,
  fetchSupportTicketsStrict,
  fetchTenantOperationsStrict,
} from "@/api/admin-bff";
import type {
  OrderOperationRecord,
  SupportTicketRecord,
  TenantOperationRecord,
} from "@/entities/console";
import { PageHeader } from "@/modules/shared/PageHeader";
import {
  formatNumber,
  riskLabel,
  statusLabel,
  typeLabel,
  verifiedLabel,
} from "@/modules/tenants/tenant-utils";

type TodoSeverity = "rose" | "amber" | "blue" | "green";
/**
 * `payment`（收款确认）2026-09-02 加入：客户已申报付款 / 钱到了没开通 / 收了一半的
 * 订单，是全平台最紧急的人工事项，此前只在订单列表的状态筛选里，总览待办看不到
 * （owner：「这种需要紧急处理的确认付款事项，应该推送到待办事项中」）。
 * `usage` / `subscription` 两档自 2026-08-30 起从未产生过一条（见 buildOpsTodos），
 * 随本次一并摘掉，不再占分类栏。
 */
type TodoType = "payment" | "verification" | "risk" | "ticket";

interface OpsTodoItem {
  id: string;
  type: TodoType;
  title: string;
  description: string;
  tenantId: string;
  /** 面向用户的租户编码，跳转用——地址栏不出 UUID。 */
  tenantCode: string;
  tenantName: string;
  tenantMeta: string;
  href: string;
  severity: TodoSeverity;
  priority: number;
  updatedAt: string;
  icon: IconName;
  tags: string[];
}

const TODO_TYPE_LABEL: Record<TodoType, string> = {
  payment: "收款确认",
  verification: "认证审核",
  risk: "风险复核",
  ticket: "工单处理",
};

const TODO_TYPE_ICON: Record<TodoType, IconName> = {
  payment: "credit-card",
  verification: "medal",
  risk: "warning",
  ticket: "chat-circle",
};

/**
 * 需要运营动手的订单态 → 待办。与订单列表的 ATTENTION_RANK（product_321 §4.2）同一
 * 口径：钱在途（客户已申报，等核对到账）最急；钱到了没开通（段 2 未落）其次；
 * 收了一半挂账再次。`pending`（客户还没付）不是待办——那是客户的事，TTL 自动关。
 */
const ORDER_TODO: Partial<
  Record<
    OrderOperationRecord["orderStatus"],
    {
      title: string;
      description: string;
      severity: TodoSeverity;
      priority: number;
    }
  >
> = {
  pending_verify: {
    title: "客户已申报付款，待确认收款",
    description:
      "客户已完成支付并申报，请核对到账后在订单里确认收款（自动开通）或驳回申报。",
    severity: "rose",
    priority: 2,
  },
  paid_unprovisioned: {
    title: "已收款但权益未开通",
    description: "账单已结清，开通没有落地，请在订单里重试开通。",
    severity: "rose",
    priority: 3,
  },
  partial_pending: {
    title: "部分收款，尾款挂账",
    description: "已收到部分款项但未结清，请跟进尾款并在订单里确认收款。",
    severity: "amber",
    priority: 15,
  },
};

/* 收 `locale` 而不是写死 `"zh-CN"`：日期的字段顺序属于语言——中文
   `2026/08/18`，英文 `08/18/2026`。同一串数字，读出来是两个日期。 */
function formatDateTime(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function severityOrder(severity: TodoSeverity) {
  if (severity === "rose") return 0;
  if (severity === "amber") return 1;
  if (severity === "blue") return 2;
  return 3;
}

function buildTenantMeta(tenant: TenantOperationRecord) {
  return `${typeLabel(tenant.tenantType)} / ${tenant.region} / ${statusLabel(tenant.status)}`;
}

function ticketSeverity(ticket: SupportTicketRecord): TodoSeverity {
  if (ticket.priority === "p0" || ticket.status === "blocked") return "rose";
  if (ticket.priority === "p1") return "amber";
  return "blue";
}

function ticketPriority(ticket: SupportTicketRecord) {
  if (ticket.priority === "p0") return 1;
  if (ticket.priority === "p1") return 10;
  if (ticket.priority === "p2") return 30;
  return 50;
}

function buildOpsTodos(
  tenants: TenantOperationRecord[],
  tickets: SupportTicketRecord[],
  orders: OrderOperationRecord[],
): OpsTodoItem[] {
  const orderTodos = orders.flatMap((order) => {
    const spec = ORDER_TODO[order.orderStatus];
    if (!spec) return [];
    return [
      {
        id: `${order.tenantId}-order-${order.id}`,
        type: "payment" as const,
        title: `${order.orderNo} ${spec.title}`,
        description: `${order.tenantName} · ${order.solutionName} · ${order.servicePlanName}，金额 ${order.currency} ${order.amount.toFixed(2)}。${spec.description}`,
        tenantId: order.tenantId,
        tenantCode: order.tenantCode,
        tenantName: order.tenantName,
        tenantMeta: `${typeLabel(order.tenantType)} / ${order.region}`,
        // 直达订单详情（可读码 order_no），「确认收款」按钮就在那一页。
        href: `/orders/${encodeURIComponent(order.orderNo)}`,
        severity: spec.severity,
        priority: spec.priority,
        updatedAt: order.updatedAt,
        icon: TODO_TYPE_ICON.payment,
        tags: [TODO_TYPE_LABEL.payment, order.tierName],
      },
    ];
  });

  const tenantTodos = tenants.flatMap((tenant) => {
    const items: OpsTodoItem[] = [];
    const tenantMeta = buildTenantMeta(tenant);
    const tenantHref = `/tenants/${tenant.id}`;

    if (tenant.verifiedStatus === "pending") {
      items.push({
        id: `${tenant.id}-verification`,
        type: "verification",
        title: `${tenant.displayName} 认证待审核`,
        description: `当前认证状态为${verifiedLabel(tenant.verifiedStatus)}，需要核验资质材料与联系人信息。`,
        tenantId: tenant.id,
        tenantCode: tenant.tenantCode,
        tenantName: tenant.displayName,
        tenantMeta,
        href: "/verifications",
        severity: "amber",
        priority: 20,
        updatedAt:
          tenant.verificationSubmittedAt ??
          tenant.lastActiveAt ??
          tenant.createdAt,
        icon: TODO_TYPE_ICON.verification,
        tags: [tenant.industry, tenant.scale],
      });
    }

    if (tenant.riskLevel !== "normal" || tenant.status === "suspended") {
      items.push({
        id: `${tenant.id}-risk`,
        type: "risk",
        title: `${tenant.displayName} 风险状态需复核`,
        description: tenant.notes,
        tenantId: tenant.id,
        tenantCode: tenant.tenantCode,
        tenantName: tenant.displayName,
        tenantMeta,
        href: tenantHref,
        severity:
          tenant.riskLevel === "high" || tenant.status === "suspended"
            ? "rose"
            : "amber",
        priority: tenant.riskLevel === "high" ? 5 : 25,
        updatedAt: tenant.lastActiveAt ?? tenant.createdAt,
        icon: TODO_TYPE_ICON.risk,
        // SLA 标签删了：租户投影里那个字段从来是字面量 "未设置"，没有来源（2026-08-30）。
        tags: [`风险 ${riskLabel(tenant.riskLevel)}`],
      });
    }

    // 用量预警 / 订阅跟进两类待办原来从租户**列表**的 usage[] / subscriptions[] 派生，
    // 而列表从没带过这两个数组（一直是空占位），所以它们一条都没生成过。2026-08-30
    // 列表投影不再携带明细数组，这两段随之删除；订阅侧真正要人动手的是收款，
    // 2026-09-02 起由上面的 orderTodos 按订单态派生。

    return items;
  });

  const ticketTodos = tickets
    .filter((ticket) => ticket.status !== "closed")
    .map((ticket) => ({
      id: `${ticket.tenantId}-${ticket.id}`,
      type: "ticket" as const,
      title: `${ticket.id} ${ticket.title}`,
      description: `${ticket.tenantName} 的 ${ticket.priority.toUpperCase()} 工单处于${ticket.status === "blocked" ? "阻塞" : ticket.status === "processing" ? "处理中" : "待处理"}状态。`,
      tenantId: ticket.tenantId,
      tenantCode: ticket.tenantCode,
      tenantName: ticket.tenantName,
      tenantMeta: `${typeLabel(ticket.tenantType)} / ${ticket.region} / ${statusLabel(ticket.tenantStatus)}`,
      href: "/tickets",
      severity: ticketSeverity(ticket),
      priority: ticketPriority(ticket),
      updatedAt: ticket.updatedAt,
      icon: TODO_TYPE_ICON.ticket,
      tags: [ticket.priority.toUpperCase(), TODO_TYPE_LABEL.ticket],
    }));

  return [...orderTodos, ...tenantTodos, ...ticketTodos].sort((left, right) => {
    const severityDiff =
      severityOrder(left.severity) - severityOrder(right.severity);
    if (severityDiff !== 0) return severityDiff;
    return (
      left.priority - right.priority ||
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
    );
  });
}

const SEVERITY_LABEL: Record<TodoSeverity, string> = {
  rose: "紧急",
  amber: "关注",
  blue: "一般",
  green: "正常",
};

const SEVERITY_TONE: Record<TodoSeverity, StatusBadgeTone> = {
  rose: "danger",
  amber: "warning",
  blue: "info",
  green: "success",
};

const CSV_COLUMNS: readonly CsvColumn<OpsTodoItem>[] = [
  { label: "事项", value: (item) => item.title },
  { label: "说明", value: (item) => item.description },
  { label: "租户", value: (item) => item.tenantName },
  { label: "租户属性", value: (item) => item.tenantMeta },
  { label: "类型", value: (item) => TODO_TYPE_LABEL[item.type] },
  { label: "紧急度", value: (item) => SEVERITY_LABEL[item.severity] },
  { label: "标签", value: (item) => item.tags.join(" / ") },
  { label: "更新时间", value: (item) => item.updatedAt },
];

export function OpsTodosPage() {
  const locale = useLocale();
  const tShared = useTranslations();
  const router = useRouter();
  const [tenants, setTenants] = useState<TenantOperationRecord[]>([]);
  const [tickets, setTickets] = useState<SupportTicketRecord[]>([]);
  const [orders, setOrders] = useState<OrderOperationRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [tenantLoadError, setTenantLoadError] = useState<string | null>(null);
  const [ticketLoadError, setTicketLoadError] = useState<string | null>(null);
  const [orderLoadError, setOrderLoadError] = useState<string | null>(null);
  const todos = useMemo(
    () => buildOpsTodos(tenants, tickets, orders),
    [tenants, tickets, orders],
  );
  const urgentTodos = todos.filter((todo) => todo.severity === "rose");
  const paymentTodos = todos.filter((todo) => todo.type === "payment");
  const verificationTodos = todos.filter(
    (todo) => todo.type === "verification",
  );
  const ticketTodos = todos.filter((todo) => todo.type === "ticket");
  const affectedTenants = new Set(todos.map((todo) => todo.tenantId)).size;
  const [typeFilter, setTypeFilter] = useState<TodoType | "all">("all");
  const [severityFilter, setSeverityFilter] = useState<TodoSeverity | "all">(
    "all",
  );
  const [query, setQuery] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<readonly string[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(20);

  const filteredTodos = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return todos.filter((todo) => {
      if (typeFilter !== "all" && todo.type !== typeFilter) return false;
      if (severityFilter !== "all" && todo.severity !== severityFilter)
        return false;
      if (!keyword) return true;
      return [todo.title, todo.description, todo.tenantName, ...todo.tags]
        .join(" ")
        .toLowerCase()
        .includes(keyword);
    });
  }, [todos, typeFilter, severityFilter, query]);

  const pageCount = Math.max(1, Math.ceil(filteredTodos.length / pageSize));
  const activePage = Math.min(page, pageCount);
  const pageTodos = filteredTodos.slice(
    (activePage - 1) * pageSize,
    activePage * pageSize,
  );
  const selectedTodos = filteredTodos.filter((todo) =>
    selectedKeys.includes(todo.id),
  );

  const todoActions = (item: OpsTodoItem) => (
    <ActionMenu
      label={`${item.title} 待办操作`}
      items={[
        {
          id: "entry",
          label: "处理入口",
          icon: "arrow-right",
          onSelect: () => router.push(item.href),
        },
        {
          id: "tenant",
          label: tShared("actions.viewTenant"),
          icon: "buildings",
          onSelect: () =>
            router.push(`/tenants/${encodeURIComponent(item.tenantCode)}`),
        },
      ]}
    />
  );

  const pagination = (
    <ListPagination
      currentPage={activePage}
      pageCount={pageCount}
      total={filteredTodos.length}
      pageSize={pageSize}
      onPageSizeChange={(value) => {
        setPageSize(value);
        setPage(1);
      }}
      onPageChange={setPage}
    />
  );
  useEffect(() => {
    let cancelled = false;

    setIsLoading(true);
    setTenantLoadError(null);
    setTicketLoadError(null);
    setOrderLoadError(null);

    Promise.all([
      fetchTenantOperationsStrict(),
      fetchSupportTicketsStrict().catch((error) => {
        if (!cancelled) {
          setTicketLoadError(
            error instanceof Error ? error.message : "工单数据读取失败",
          );
        }
        return [];
      }),
      // 订单读取失败不拖垮整页（同工单的降级方式）：没有订单权限的运营仍能看其余待办。
      fetchOrderOperations().catch((error) => {
        if (!cancelled) {
          setOrderLoadError(
            error instanceof Error ? error.message : "订单数据读取失败",
          );
        }
        return [];
      }),
    ])
      .then(([tenantRecords, ticketRecords, orderRecords]) => {
        if (!cancelled) {
          setTenants(tenantRecords);
          setTickets(ticketRecords);
          setOrders(orderRecords);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setTenants([]);
          setTickets([]);
          setOrders([]);
          setTenantLoadError(
            error instanceof Error ? error.message : "租户运营数据读取失败",
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <ListPageTemplate
      className="w-full "
      header={
        <PageHeader
          icon="table"
          title="待办任务"
          description="聚合待确认收款的订单、认证审核、风险租户与工单，帮助运营按优先级推进人工处理。"
          secondary={<Badge>只读聚合</Badge>}
        />
      }
      summary={
        <MetricGrid
          loading={isLoading}
          aria-label="待办任务统计"
          items={[
            {
              id: "urgent",
              help: "严重程度为最高档的待办。",
              icon: "warning",
              label: "紧急事项",
              value: formatNumber(urgentTodos.length),
              tags: [`影响租户 ${formatNumber(affectedTenants)}`],
              tone: urgentTodos.length ? "danger" : "success",
            },
            {
              id: "payment",
              help: "客户已申报付款待确认、已收款未开通、部分收款挂账的订单。",
              icon: "credit-card",
              label: "待确认收款",
              value: formatNumber(paymentTodos.length),
              tags: [orderLoadError ? "订单未接入" : "订单侧确认"],
              tone: paymentTodos.length ? "danger" : "success",
            },
            {
              id: "verification",
              help: "来源为租户认证审核的待办。",
              icon: "medal",
              label: "认证待审",
              value: formatNumber(verificationTodos.length),
              tags: ["组织资质"],
              tone: verificationTodos.length ? "warning" : "success",
            },
            {
              id: "tickets",
              help: "来源为工单的待办。",
              icon: "chat-circle",
              label: "未关闭工单",
              value: formatNumber(ticketTodos.length),
              tags: [
                `P0/P1 ${formatNumber(ticketTodos.filter((todo) => todo.priority <= 10).length)}`,
              ],
              tone: ticketTodos.length ? "warning" : "success",
            },
            {
              id: "all",
              help: "全部待办条数，不分来源与紧急度。",
              icon: "table",
              label: "全部待办",
              value: formatNumber(todos.length),
              tags: ["按优先级排序"],
            },
          ]}
        />
      }
      table={
        <Section
          title="优先处理队列"
          // 图标跟随当前分类，"全部"档退回队列自身图标。
          icon={typeFilter === "all" ? "table" : TODO_TYPE_ICON[typeFilter]}
          level={2}
          description={`按紧急度与优先级排序，共 ${formatNumber(todos.length)} 条${ticketLoadError ? "（工单未接入）" : ""}${orderLoadError ? "（订单未接入）" : ""}。`}
          action={
            <SegmentedControl
              ariaLabel="待办分类"
              value={typeFilter}
              onChange={(next) => {
                setTypeFilter(next);
                // 换分类即换行集，旧选择与页码随之失效。
                setSelectedKeys([]);
                setPage(1);
              }}
              items={[
                { value: "all" as const, label: "全部", count: todos.length },
                ...(Object.keys(TODO_TYPE_LABEL) as TodoType[]).map((type) => ({
                  value: type,
                  label: TODO_TYPE_LABEL[type],
                  icon: TODO_TYPE_ICON[type],
                  count: todos.filter((todo) => todo.type === type).length,
                })),
              ]}
            />
          }
        >
          <FilterBar
            view="list"
            onViewChange={() => {}}
            cardsDisabledReason={tShared("common.cardsRetired")}
            aria-label="待办任务筛选"
            count={`${formatNumber(filteredTodos.length)} 条`}
            search={
              <Input
                type="search"
                className="grow basis-media-3xl max-w-panel-sm"
                placeholder="搜索事项、租户、标签…"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
                aria-label="搜索待办任务"
              />
            }
            onReset={() => {
              setQuery("");
              setTypeFilter("all");
              setSeverityFilter("all");
              setSelectedKeys([]);
              setPage(1);
            }}
            actions={
              /* 无"新建"：待办由聚合产生。 */
              <ActionButton
                icon="arrow-down"
                variant={selectedTodos.length > 0 ? "default" : "outline"}
                disabled={selectedTodos.length === 0}
                onClick={() =>
                  exportRowsToCsv("ops-todos", CSV_COLUMNS, selectedTodos)
                }
              >
                {tShared("common.export")}
              </ActionButton>
            }
          >
            <NativeSelect
              wrapperClassName="w-fit basis-media-xl"
              value={severityFilter}
              onChange={(event) => {
                setSeverityFilter(event.target.value as TodoSeverity | "all");
                setPage(1);
              }}
              aria-label="紧急度"
            >
              <option value="all">全部紧急度</option>
              {(Object.keys(SEVERITY_LABEL) as TodoSeverity[]).map(
                (severity) => (
                  <option key={severity} value={severity}>
                    {SEVERITY_LABEL[severity]}
                  </option>
                ),
              )}
            </NativeSelect>
          </FilterBar>

          <DataTable
            columns={[
              {
                id: "item",
                header: "事项",
                cell: (item) => (
                  <TableTitleCell
                    icon={item.icon}
                    title={item.title}
                    description={item.description}
                    onTitleClick={() => router.push(item.href)}
                  />
                ),
              },
              {
                id: "tenant",
                header: "租户",
                cell: (item) => (
                  <TableTitleCell
                    title={item.tenantName}
                    description={item.tenantMeta}
                    onTitleClick={() =>
                      router.push(
                        `/tenants/${encodeURIComponent(item.tenantCode)}`,
                      )
                    }
                  />
                ),
              },
              {
                id: "type",
                header: tShared("columns.kind"),
                cell: (item) => TODO_TYPE_LABEL[item.type],
              },
              {
                id: "severity",
                header: "紧急度",
                cell: (item) => (
                  <StatusBadge tone={SEVERITY_TONE[item.severity]}>
                    {SEVERITY_LABEL[item.severity]}
                  </StatusBadge>
                ),
              },
              {
                id: "tags",
                header: "标签",
                cell: (item) => (
                  <span className="flex flex-wrap gap-xs">
                    {item.tags.slice(0, 3).map((tag) => (
                      <Badge key={tag}>{tag}</Badge>
                    ))}
                  </span>
                ),
              },
              {
                id: "updated",
                header: tShared("columns.updatedAt"),
                align: "right",
                cell: (item) => formatDateTime(item.updatedAt, locale),
              },
            ]}
            rows={pageTodos}
            rowKey={(item) => item.id}
            indexStart={(activePage - 1) * pageSize + 1}
            selectedKeys={selectedKeys}
            onSelectionChange={setSelectedKeys}
            loading={isLoading}
            empty={
              <EmptyState
                title={tenantLoadError ? "待办数据读取失败" : "当前没有待办"}
                description={
                  tenantLoadError ??
                  (query || typeFilter !== "all" || severityFilter !== "all"
                    ? tShared("common.adjustFiltersHint")
                    : (ticketLoadError ?? "数据库中没有匹配的待办任务。"))
                }
              />
            }
            footer={pagination}
            rowActions={todoActions}
          />
        </Section>
      }
    />
  );
}
