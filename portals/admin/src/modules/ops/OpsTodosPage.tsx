"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useTableLabels } from "@/modules/shared/table";
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
  Button,
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
import { formatClock, formatDay } from "@vxture-platform/shared";

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
  /**
   * 事项的**可视编号**,单独成字段而不是揉进 `title`。
   *
   * 三路来源各有各的码:订单 `order_no`、工单 `ticket_no`(BFF 侧
   * `id: row.ticket_no`,不是主键)、租户级事项没有单据号故用 `tenantCode`。
   * 一律是可视码,**任何场景不展示 UUID**。
   */
  code: string;
  description: string;
  tenantId: string;
  /** 面向用户的租户编码，跳转用——地址栏不出 UUID。 */
  tenantCode: string;
  tenantName: string;
  /**
   * 租户侧的**联系人**(`ownerName`),租户列的副行。
   *
   * 订单记录本身不带它——`operatorName` 是平台经办人,不是客户——所以订单待办
   * 走本页已载入的租户表按 `tenantId` 反查;查不到就是「—」,**不退回 UUID,也不
   * 拿经办人冒充客户**。
   */
  tenantUser: string;
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
 * 分类栏只列这三档（owner 2026-09-20：「去掉 风险复核」）。
 *
 * **去的是筛选栏这一层，不是这类待办本身**——`risk` 仍在 buildOpsTodos 里产出、
 * 仍进「全部」档与表格的「类型」列、仍可处理。若连产出一并摘掉，现存的风险事项
 * 会在运营台完全不可见，成为没人看得见的孤儿。
 *
 * 所以此处单独列清单而不是从 TODO_TYPE_LABEL 删键：标签与图标仍要给表格用。
 */
export type TodoScope = "queue" | "all";

const TODO_FILTER_TYPES: readonly TodoType[] = [
  "payment",
  "verification",
  "ticket",
];

/** 读不到联系人时的占位。显示「—」而不是空白,空白分不清「没有」与「没加载」。 */
const UNKNOWN_USER = "—";

/**
 * 每类待办的**主操作**:去哪一页、按钮叫什么。
 *
 * 此前四类共用一个「处理入口」,点之前不知道会跳到哪;`href` 本来就已按类型分流
 * (订单详情 / 认证审核页 / 租户详情 / 工单列表),缺的只是把去处写进按钮。
 * `listHref` 是同类全量列表——运营处理完一条常要看这类还剩多少。
 */
const TODO_ACTION: Record<
  TodoType,
  { label: string; icon: IconName; listLabel: string; listHref: string }
> = {
  payment: {
    label: "去确认收款",
    icon: "credit-card",
    listLabel: "查看全部订单",
    listHref: "/orders",
  },
  verification: {
    label: "去审核认证",
    icon: "medal",
    listLabel: "查看全部认证",
    listHref: "/verifications",
  },
  risk: {
    label: "去复核风险",
    icon: "warning",
    listLabel: "查看全部租户",
    listHref: "/tenants",
  },
  ticket: {
    label: "去处理工单",
    icon: "chat-circle",
    listLabel: "查看全部工单",
    listHref: "/tickets",
  },
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
  // 订单待办的联系人要从租户表借。用 Map 而不是每单 find:租户上限 500 行、
  // 订单可比它多,逐单线性扫是 O(n·m)。
  const tenantOwnerById = new Map(
    tenants.map((tenant) => [tenant.id, tenant.ownerName] as const),
  );

  const orderTodos = orders.flatMap((order) => {
    const spec = ORDER_TODO[order.orderStatus];
    if (!spec) return [];
    return [
      {
        id: `${order.tenantId}-order-${order.id}`,
        type: "payment" as const,
        code: order.orderNo,
        title: spec.title,
        description: `${order.tenantName} · ${order.solutionName} · ${order.servicePlanName}，金额 ${order.currency} ${order.amount.toFixed(2)}。${spec.description}`,
        tenantId: order.tenantId,
        tenantCode: order.tenantCode,
        tenantName: order.tenantName,
        tenantUser: tenantOwnerById.get(order.tenantId) ?? UNKNOWN_USER,
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
    // 地址栏走可读码。此前这里是 `tenant.id`(UUID),与表格租户列那处的
    // `tenantCode` 各走各的——全站规则是任何路由都不出 UUID。
    const tenantHref = `/tenants/${encodeURIComponent(tenant.tenantCode)}`;

    if (tenant.verifiedStatus === "pending") {
      items.push({
        id: `${tenant.id}-verification`,
        type: "verification",
        code: tenant.tenantCode,
        title: "认证待审核",
        description: `当前认证状态为${verifiedLabel(tenant.verifiedStatus)}，需要核验资质材料与联系人信息。`,
        tenantId: tenant.id,
        tenantCode: tenant.tenantCode,
        tenantName: tenant.displayName,
        tenantUser: tenant.ownerName || UNKNOWN_USER,
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
        code: tenant.tenantCode,
        title: "风险状态需复核",
        description: tenant.notes,
        tenantId: tenant.id,
        tenantCode: tenant.tenantCode,
        tenantName: tenant.displayName,
        tenantUser: tenant.ownerName || UNKNOWN_USER,
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
      code: ticket.id,
      title: ticket.title,
      description: `${ticket.tenantName} 的 ${ticket.priority.toUpperCase()} 工单处于${ticket.status === "blocked" ? "阻塞" : ticket.status === "processing" ? "处理中" : "待处理"}状态。`,
      tenantId: ticket.tenantId,
      tenantCode: ticket.tenantCode,
      tenantName: ticket.tenantName,
      tenantUser: ticket.ownerName || UNKNOWN_USER,
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
  // 编号单列一栏:它此前揉在 title 里,拆出去之后若不补这一列,导出的 CSV 会**丢掉
  // 编号**——而运营拿 CSV 正是为了按单号去对账。
  { label: "编号", value: (item) => item.code },
  { label: "事项", value: (item) => item.title },
  { label: "说明", value: (item) => item.description },
  { label: "租户", value: (item) => item.tenantName },
  { label: "用户", value: (item) => item.tenantUser },
  { label: "租户属性", value: (item) => item.tenantMeta },
  { label: "类型", value: (item) => TODO_TYPE_LABEL[item.type] },
  { label: "紧急度", value: (item) => SEVERITY_LABEL[item.severity] },
  { label: "标签", value: (item) => item.tags.join(" / ") },
  { label: "更新时间", value: (item) => item.updatedAt },
];

/**
 * 两个视图共用本件（owner 2026-09-20：「全部任务做二级页面展示」）。
 *
 *   queue（/ops-todos）     主页。只列与统计卡、筛选栏对齐的**三类**。
 *   all  （/ops-todos/all） 全部任务。四类齐全，风险复核在这里有落点。
 *
 * 拆成两个视图而不是两份代码：表格列、操作菜单、CSV 列、翻页全都一样，复制一份
 * 迟早两边长歪。差别只有「列哪几类」与「有没有那个去处按钮」，用一个 prop 收住。
 */
export function OpsTodosPage({ scope = "queue" }: { scope?: TodoScope } = {}) {
  const isAll = scope === "all";
  const locale = useLocale();
  const tShared = useTranslations();
  const tableLabels = useTableLabels();
  const router = useRouter();
  const [tenants, setTenants] = useState<TenantOperationRecord[]>([]);
  const [tickets, setTickets] = useState<SupportTicketRecord[]>([]);
  const [orders, setOrders] = useState<OrderOperationRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [tenantLoadError, setTenantLoadError] = useState<string | null>(null);
  const [ticketLoadError, setTicketLoadError] = useState<string | null>(null);
  const [orderLoadError, setOrderLoadError] = useState<string | null>(null);
  /** 四类全量。H0 的「任务 N」报的是这个数——owner：「tag 显示 全部代办数量」。 */
  const allTodos = useMemo(
    () => buildOpsTodos(tenants, tickets, orders),
    [tenants, tickets, orders],
  );
  /**
   * 本视图实际要列的那些。
   *
   * 主页只列三类:统计卡是那三张、筛选栏是那三档,表格再混进第四类就对不上了。
   * 风险复核不是被删掉,是搬到「全部任务」——那一页四类齐全。
   */
  const todos = useMemo(
    () =>
      isAll
        ? allTodos
        : allTodos.filter((todo) => TODO_FILTER_TYPES.includes(todo.type)),
    [allTodos, isAll],
  );
  /** 主页上被折进「全部任务」的那些,区块说明要把这个数说出来。 */
  const hiddenCount = allTodos.length - todos.length;
  const paymentTodos = todos.filter((todo) => todo.type === "payment");
  const verificationTodos = todos.filter(
    (todo) => todo.type === "verification",
  );
  const ticketTodos = todos.filter((todo) => todo.type === "ticket");
  const riskTodos = todos.filter((todo) => todo.type === "risk");
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

  const todoActions = (item: OpsTodoItem) => {
    const action = TODO_ACTION[item.type];
    return (
      <ActionMenu
        label={`${item.title} 待办操作`}
        items={[
          {
            id: "entry",
            label: action.label,
            icon: action.icon,
            onSelect: () => router.push(item.href),
          },
          {
            id: "tenant",
            label: tShared("actions.viewTenant"),
            icon: "buildings",
            onSelect: () =>
              router.push(`/tenants/${encodeURIComponent(item.tenantCode)}`),
          },
          {
            id: "list",
            label: action.listLabel,
            icon: "table",
            onSelect: () => router.push(action.listHref),
          },
        ]}
      />
    );
  };

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
          title={isAll ? "全部任务" : "待办任务"}
          description={
            isAll
              ? "四类待办的全量清单，含只在本页出现的风险复核。"
              : "聚合待确认收款的订单、认证审核与工单，帮助运营按优先级推进人工处理。"
          }
          secondary={
            <span className="inline-flex items-center gap-xs">
              {/* 标题行直接报总量,免得运营为了知道"还剩多少"去数统计卡。
                  **两个视图都报四类全量**(owner:「tag 显示 全部代办数量」)——
                  它是这件事的总数,不是本页列了几条,所以既不随筛选变、也不随
                  视图变。主页与它的差额由区块说明点明。 */}
              <Badge>任务 {formatNumber(allTodos.length)}</Badge>
              <Badge>只读聚合</Badge>
            </span>
          }
        />
      }
      summary={
        <MetricGrid
          loading={isLoading}
          aria-label="待办任务统计"
          // 卡与下方筛选栏**同名同图标同口径**(owner 2026-09-20:「保留与统计区
          // 对应的三个,注意名称一致」)——标签一律取 TODO_TYPE_LABEL,杜绝两处各写
          // 一套中文("待确认收款" vs "收款确认")导致运营以为是两个不同的数。
          //
          // 列数跟着**卡数**走:全部任务页多一张风险复核,写死 3 会在右侧空出一块
          // (2026-09-20 owner 实看报过一次同样的病)。
          columns={isAll ? 4 : 3}
          items={[
            {
              id: "payment",
              help: "客户已申报付款待确认、已收款未开通、部分收款挂账的订单。",
              icon: TODO_TYPE_ICON.payment,
              label: TODO_TYPE_LABEL.payment,
              value: formatNumber(paymentTodos.length),
              tags: [orderLoadError ? "订单未接入" : "订单侧确认"],
              tone: paymentTodos.length ? "danger" : "success",
            },
            {
              id: "verification",
              help: "来源为租户认证审核的待办。",
              icon: TODO_TYPE_ICON.verification,
              label: TODO_TYPE_LABEL.verification,
              value: formatNumber(verificationTodos.length),
              tags: ["组织资质"],
              tone: verificationTodos.length ? "warning" : "success",
            },
            {
              id: "tickets",
              help: "来源为工单的待办。",
              icon: TODO_TYPE_ICON.ticket,
              label: TODO_TYPE_LABEL.ticket,
              value: formatNumber(ticketTodos.length),
              tags: [
                `P0/P1 ${formatNumber(ticketTodos.filter((todo) => todo.priority <= 10).length)}`,
              ],
              tone: ticketTodos.length ? "warning" : "success",
            },
            // 第四张只在全部任务页出现——主页不列这一类,列了卡就成了点不到的数。
            ...(isAll
              ? [
                  {
                    id: "risk",
                    help: "风险等级异常或已暂停的租户。",
                    icon: TODO_TYPE_ICON.risk,
                    label: TODO_TYPE_LABEL.risk,
                    value: formatNumber(riskTodos.length),
                    tags: ["仅本页可见"],
                    tone: (riskTodos.length
                      ? "danger"
                      : "success") as StatusBadgeTone,
                  },
                ]
              : []),
          ]}
        />
      }
      table={
        <>
          <Section
            // 全部任务页的页头已经叫「全部任务」了,区块再叫一遍等于把同一个词
            // 摞两层;这里说的是它列的是什么。
            title={isAll ? "任务明细" : "优先处理队列"}
            // 图标跟随当前分类，"全部"档退回队列自身图标。
            icon={typeFilter === "all" ? "table" : TODO_TYPE_ICON[typeFilter]}
            level={2}
            // 主页把「本页列了几条」与「总共几条」的差额**说出来**:标题 badge 报
            // 四类全量,这里只列三类,不点破就会被当成数字对不上。
            description={`按紧急度与优先级排序，共 ${formatNumber(todos.length)} 条${
              !isAll && hiddenCount > 0
                ? `；另有 ${formatNumber(hiddenCount)} 条${TODO_TYPE_LABEL.risk}在「全部任务」里`
                : ""
            }${ticketLoadError ? "（工单未接入）" : ""}${orderLoadError ? "（订单未接入）" : ""}。`}
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
                  ...(isAll
                    ? (Object.keys(TODO_TYPE_LABEL) as TodoType[])
                    : TODO_FILTER_TYPES
                  ).map((type) => ({
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
              count={formatNumber(filteredTodos.length)}
              search={
                <Input
                  type="search"
                  className="min-w-media-2xl grow basis-0 max-w-panel-sm"
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
                <>
                  {/* 两个视图**互相通着**:主页去全量,全量回主页。只给单向出口的话,
                      运营从全量页回来只能按浏览器后退。 */}
                  <ActionButton
                    icon={isAll ? "arrow-left" : "table"}
                    variant="outline"
                    onClick={() =>
                      router.push(isAll ? "/ops-todos" : "/ops-todos/all")
                    }
                  >
                    {isAll ? "回到待办队列" : "查看全部任务"}
                  </ActionButton>
                  <ActionButton
                    icon="arrow-down"
                    variant={selectedTodos.length > 0 ? "default" : "outline"}
                    disabled={selectedTodos.length === 0}
                    onClick={() =>
                      exportRowsToCsv(
                        isAll ? "ops-todos-all" : "ops-todos",
                        CSV_COLUMNS,
                        selectedTodos,
                      )
                    }
                  >
                    {tShared("common.export")}
                  </ActionButton>
                </>
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
                {/* 「全部紧急度」四字会顶到下拉箭头底下(owner 2026-09-20 实看),
                  收成「全部」——aria-label 已经说明这一栏是紧急度。 */}
                <option value="all">全部</option>
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
              labels={tableLabels}
              columns={[
                {
                  id: "item",
                  header: "事项",
                  cell: (item) => (
                    <TableTitleCell
                      icon={item.icon}
                      title={
                        <span className="inline-flex flex-wrap items-baseline gap-2xs">
                          <span>{item.title}</span>
                          <span className="font-mono text-body-sm text-muted-foreground">
                            {item.code}
                          </span>
                        </span>
                      }
                      description={item.description}
                      onTitleClick={() => router.push(item.href)}
                    />
                  ),
                },
                {
                  id: "tenant",
                  header: "租户",
                  cell: (item) => (
                    <span className="inline-flex flex-col items-center gap-2xs">
                      <Button
                        variant="link"
                        size="sm"
                        onClick={() =>
                          router.push(
                            `/tenants/${encodeURIComponent(item.tenantCode)}`,
                          )
                        }
                      >
                        {item.tenantName}
                      </Button>
                      {/* 副行是**联系人**(owner 2026-09-20:「租户名称 + 用户,主副
                        两行显示」)。租户属性(类型/地区/状态)不进表格,仍留在 CSV
                        导出里——那是对账要用的,屏幕上一行放不下。 */}
                      <span className="text-body-sm text-muted-foreground">
                        {item.tenantUser}
                      </span>
                    </span>
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
                    <span className="flex flex-wrap justify-center gap-xs">
                      {item.tags.slice(0, 3).map((tag) => (
                        <Badge key={tag}>{tag}</Badge>
                      ))}
                    </span>
                  ),
                },
                {
                  id: "updated",
                  header: tShared("columns.updatedAt"),
                  cell: (item) => (
                    <span className="inline-flex flex-col gap-2xs">
                      <span>{formatDay(item.updatedAt, locale)}</span>
                      <span className="text-body-sm text-muted-foreground">
                        {formatClock(item.updatedAt, locale)}
                      </span>
                    </span>
                  ),
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
              rowActions={todoActions}
            />
            {/* 翻页行与上方筛选行**同为 Section 的直接子元素**,于是左右边距一致
              (owner 2026-09-20:「表格的头部操作行,底部翻页行,格式没有统一」)。
              此前它走 DataTable 的 `footer` 槽——那一槽渲染在表格卡片**内**、
              贴着表格左右边,比卡片外的筛选行窄一圈。 */}
            {pagination}
          </Section>

          {/* S2 系统消息——只在主页出现;全部任务页是待办的二级页,不该把消息区
            再画一遍。本轮只立壳,不接数据(owner 2026-09-20:「暂空占位…可以
            后续实现」)。
            用途:opera 侧的产品上线、能力新增、变更通告要同步给运营——三个平台
            由不同人员使用,消息不能只落在发的人那一边。
            库里 `support.inbox_messages` 已存在,缺的是读侧接口与二级页面。
            「查看全部」先停用而不是先隐藏:隐藏会让这一区看起来只是一段说明,
            停用才说得清"有这个去处,只是还没通"。 */}
          {isAll ? null : (
            <Section
              title="系统消息"
              icon="bell"
              level={2}
              description="来自 opera 与产品侧的平台通知：产品上线、能力新增、变更通告。"
              action={
                <ActionButton variant="outline" icon="arrow-right" disabled>
                  查看全部
                </ActionButton>
              }
            >
              <EmptyState
                icon="bell"
                title="消息通道还未开通"
                description="开通后，这里显示当天已读与全部未读的消息；更早的消息到「全部消息」里查。"
              />
            </Section>
          )}
        </>
      }
    />
  );
}
