"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useTableLabels } from "@/modules/shared/table";
import { useRouter } from "next/navigation";
import {
  ActionButton,
  ActionMenu,
  Badge,
  Button,
  DataTable,
  EmptyState,
  EntryCard,
  FilterBar,
  Input,
  ListPageTemplate,
  NativeSelect,
  Section,
  StatusBadge,
  TableTitleCell,
} from "@vxture/design-system";
import type { IconName, StatusBadgeTone } from "@vxture/design-system";
import type { TicketPriority } from "@vxture-platform/shared";
import { exportRowsToCsv, type CsvColumn } from "@/lib/exportCsv";
import { ListPagination } from "@/modules/shared/ListPagination";
import type { PageSize } from "@/modules/shared/PageSizePicker";
import { useTicketPriorityLabels } from "@/modules/shared/enum-labels";
import { isUnset } from "@/modules/shared/display";
import { formatCurrency } from "@/modules/commercial/CommercialUtils";
import {
  fetchOperatorNotices,
  fetchOrderOperations,
  fetchSupportTicketsStrict,
  fetchTenantOperationsStrict,
} from "@/api/admin-bff";
import type { OperatorNoticeItem } from "@/api/admin-bff";
import type {
  OrderOperationRecord,
  SupportTicketRecord,
  TenantOperationRecord,
  TenantOperationType,
} from "@/entities/console";
import { PageHeader } from "@/modules/shared/PageHeader";
import {
  formatNumber,
  riskLabel,
  statusLabel,
  typeLabel,
} from "@/modules/tenants/tenant-utils";
import { formatPrincipalNoOr } from "@vxture-platform/shared";

type TPage = ReturnType<typeof useTranslations<"opsTodosPage">>;

/** 紧急 / 关注 / 一般。此前还有一档 `green`，没有任何来源产出它，随本次摘掉。 */
type TodoSeverity = "rose" | "amber" | "blue";
/**
 * `payment`（收款确认）2026-09-02 加入：客户已申报付款 / 钱到了没开通 / 收了一半的
 * 订单，是全平台最紧急的人工事项，此前只在订单列表的状态筛选里，总览待办看不到
 * （owner：「这种需要紧急处理的确认付款事项，应该推送到待办事项中」）。
 * `usage` / `subscription` 两档自 2026-08-30 起从未产生过一条（见 buildOpsTodos），
 * 随本次一并摘掉，不再占分类栏。
 */
type TodoType = "payment" | "verification" | "risk" | "ticket";

/**
 * 「任务」列那一句话的**素材**，不是成句。句子在渲染时按界面语言由 `taskSentence`
 * 拼出来；这里只记它是哪一种、带哪几个参数。金额在这一层就格式化好——CSV 与表格
 * 两处要同一个写法。
 */
type TaskSpec =
  | { kind: "confirmPayment"; amount: string }
  | { kind: "reprovision"; amount: string }
  | { kind: "followUpBalance"; amount: string; paid: string }
  | { kind: "verification" }
  | { kind: "risk" }
  | { kind: "ticket"; title: string };

/**
 * 「进展」列的档位。订单待办按运营侧五步（下单 → 客户申报 → 核对到账 → 自动开通
 * → 完成）报「第几步」；其余三类没有步骤，只报一个状态词。
 */
type ProgressKey =
  | "pendingVerify"
  | "paidUnprovisioned"
  | "partialPending"
  | "verification"
  | "risk"
  | "ticketOpen"
  | "ticketProcessing"
  | "ticketBlocked";

interface OpsTodoItem {
  id: string;
  type: TodoType;
  /**
   * 事项的**可视编号**,单独成字段而不是揉进句子。
   *
   * 三路来源各有各的码:订单 `order_no`、工单 `ticket_no`(BFF 侧
   * `id: row.ticket_no`,不是主键)、租户级事项没有单据号故用 `tenantCode`。
   * 一律是可视码,**任何场景不展示 UUID**。
   */
  code: string;
  task: TaskSpec;
  /** 「任务」列的副行：单号 · 套餐 / 租户码 · 风险 / 工单号 · 优先级。 */
  secondary: string;
  tenantId: string;
  /** 面向用户的租户编码，跳转用——地址栏不出 UUID。 */
  tenantCode: string;
  tenantName: string;
  tenantType: TenantOperationType;
  /**
   * 租户列的副行：**是谁在等**。
   *
   * 订单待办取申报腿的申报人（`declaredBy.displayName`，接口 2026-09-27 起下发）——
   * 客服要联系的正是这个人；接口没带时退回本页已载入的租户表按 `tenantId` 反查
   * 联系人。其余三类就是租户联系人。查不到就是「—」，**不退回 UUID，也不拿平台
   * 经办人冒充客户**。
   */
  contactName: string;
  tenantMeta: string;
  href: string;
  severity: TodoSeverity;
  priority: number;
  /**
   * 等待起点（ISO）。「等待」列与统计卡的「最久等了」都从它算：
   * 订单待办取客户申报时刻（钱在途）/ 确认收款时刻（已付未开通）；认证取提交时刻；
   * 工单只有 `updatedAt` 一根时间列，先用它。
   */
  waitingSince: string;
  /** 只有收款确认才有金额；其余显示「—」。 */
  amountText: string | null;
  progress: ProgressKey;
  /** 搜索框匹配的全文，小写。 */
  searchText: string;
}

const TODO_TYPE_ICON: Record<TodoType, IconName> = {
  payment: "credit-card",
  verification: "medal",
  risk: "warning",
  ticket: "chat-circle",
};

/**
 * 分类栏只列这三档（owner 2026-09-20：「去掉 风险复核」）。
 *
 * **去的是主页这一层，不是这类待办本身**——`risk` 仍在 buildOpsTodos 里产出、
 * 仍进「全部任务」页并可处理。若连产出一并摘掉，现存的风险事项会在运营台完全
 * 不可见，成为没人看得见的孤儿。
 */
export type TodoScope = "queue" | "all";

const TODO_FILTER_TYPES: readonly TodoType[] = [
  "payment",
  "verification",
  "ticket",
];

/** 每类待办的次要去处：同类全量列表——运营处理完一条常要看这类还剩多少。 */
const TODO_LIST_HREF: Record<TodoType, string> = {
  payment: "/orders",
  verification: "/verifications",
  risk: "/tenants",
  ticket: "/tickets",
};

/**
 * 需要运营动手的订单态 → 待办。与订单列表的 ATTENTION_RANK（product_321 §4.2）同一
 * 口径：钱在途（客户已申报，等核对到账）最急；钱到了没开通（段 2 未落）其次；
 * 收了一半挂账再次。`pending`（客户还没付）不是待办——那是客户的事，TTL 自动关。
 *
 * 键名与结构被 `check-ops-todo-alerts` 守卫读取（每类待办都要有「推不推告警」的
 * 裁定），改形状先看那条守卫。
 */
const ORDER_TODO: Partial<
  Record<
    OrderOperationRecord["orderStatus"],
    {
      task: "confirmPayment" | "reprovision" | "followUpBalance";
      progress: ProgressKey;
      severity: TodoSeverity;
      priority: number;
    }
  >
> = {
  pending_verify: {
    task: "confirmPayment",
    progress: "pendingVerify",
    severity: "rose",
    priority: 2,
  },
  paid_unprovisioned: {
    task: "reprovision",
    progress: "paidUnprovisioned",
    severity: "rose",
    priority: 3,
  },
  partial_pending: {
    task: "followUpBalance",
    progress: "partialPending",
    severity: "amber",
    priority: 15,
  },
};

function severityOrder(severity: TodoSeverity) {
  if (severity === "rose") return 0;
  if (severity === "amber") return 1;
  return 2;
}

const SEVERITY_TONE: Record<TodoSeverity, StatusBadgeTone> = {
  rose: "danger",
  amber: "warning",
  blue: "info",
};

const SEVERITIES: readonly TodoSeverity[] = ["rose", "amber", "blue"];

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

function ticketProgress(status: SupportTicketRecord["status"]): ProgressKey {
  if (status === "blocked") return "ticketBlocked";
  if (status === "processing") return "ticketProcessing";
  return "ticketOpen";
}

/**
 * 订单待办的等待起点。钱在途：从客户申报那一刻起算（`declaredPayment.declaredAt`）；
 * 已付未开通：从确认收款那一刻起算；都读不到就退回最近更新时刻——宁可少算也
 * 不能没有。
 */
function orderWaitingSince(order: OrderOperationRecord) {
  if (order.orderStatus === "pending_verify") {
    return order.declaredPayment?.declaredAt ?? order.updatedAt;
  }
  if (order.orderStatus === "paid_unprovisioned") {
    return order.confirmedAt ?? order.updatedAt;
  }
  return order.updatedAt;
}

function orderTask(
  kind: "confirmPayment" | "reprovision" | "followUpBalance",
  order: OrderOperationRecord,
): TaskSpec {
  const amount = formatCurrency(order.amount, order.currency);
  if (kind === "followUpBalance") {
    return {
      kind,
      amount,
      paid: formatCurrency(order.paidAmount, order.currency),
    };
  }
  if (kind === "reprovision") return { kind, amount };
  return { kind, amount };
}

/** 派生待办时要用到的、按界面语言取的文案。纯函数拿不到 `t`，由组件传进来。 */
interface TodoLabels {
  unknown: string;
  ticketPriority: Record<TicketPriority, string>;
  riskMeta: (risk: string, status: string) => string;
}

function buildOpsTodos(
  tenants: TenantOperationRecord[],
  tickets: SupportTicketRecord[],
  orders: OrderOperationRecord[],
  labels: TodoLabels,
): OpsTodoItem[] {
  // 订单待办的联系人要从租户表借。用 Map 而不是每单 find:租户上限 500 行、
  // 订单可比它多,逐单线性扫是 O(n·m)。
  const tenantOwnerById = new Map(
    tenants.map((tenant) => [tenant.id, tenant.ownerName] as const),
  );

  const orderTodos = orders.flatMap((order) => {
    const spec = ORDER_TODO[order.orderStatus];
    if (!spec) return [];
    const secondary = [
      order.orderNo,
      isUnset(order.servicePlanName) ? null : order.servicePlanName,
      isUnset(order.tierName) ? null : order.tierName,
    ]
      .filter(Boolean)
      .join(" · ");
    const contactName =
      order.declaredBy?.displayName ||
      tenantOwnerById.get(order.tenantId) ||
      labels.unknown;
    return [
      {
        id: `${order.tenantId}-order-${order.id}`,
        type: "payment" as const,
        code: order.orderNo,
        task: orderTask(spec.task, order),
        secondary,
        tenantId: order.tenantId,
        tenantCode: formatPrincipalNoOr(order.tenantCode, "tenant", "—"),
        tenantName: order.tenantName,
        tenantType: order.tenantType,
        contactName,
        tenantMeta: `${typeLabel(order.tenantType)} / ${order.region}`,
        // 直达订单详情（可读码 order_no），「确认收款」按钮就在那一页的任务卡上。
        href: `/orders/${encodeURIComponent(order.orderNo)}`,
        severity: spec.severity,
        priority: spec.priority,
        waitingSince: orderWaitingSince(order),
        amountText: formatCurrency(order.amount, order.currency),
        progress: spec.progress,
        searchText: [secondary, order.tenantName, contactName]
          .join(" ")
          .toLowerCase(),
      },
    ];
  });

  const tenantTodos = tenants.flatMap((tenant) => {
    const items: OpsTodoItem[] = [];
    const tenantMeta = buildTenantMeta(tenant);
    const code = formatPrincipalNoOr(tenant.tenantCode, "tenant", "—");
    const contactName = tenant.ownerName || labels.unknown;
    // 地址栏走可读码。此前这里是 `tenant.id`(UUID),与表格租户列那处的
    // `tenantCode` 各走各的——全站规则是任何路由都不出 UUID。
    const tenantHref = `/tenants/${encodeURIComponent(tenant.tenantCode)}`;

    if (tenant.verifiedStatus === "pending") {
      const secondary = [code, tenant.industry, tenant.scale]
        .filter(Boolean)
        .join(" · ");
      items.push({
        id: `${tenant.id}-verification`,
        type: "verification",
        code,
        task: { kind: "verification" },
        secondary,
        tenantId: tenant.id,
        tenantCode: code,
        tenantName: tenant.displayName,
        tenantType: tenant.tenantType,
        contactName,
        tenantMeta,
        href: "/verifications",
        severity: "amber",
        priority: 20,
        waitingSince: tenant.verificationSubmittedAt ?? tenant.createdAt,
        amountText: null,
        progress: "verification",
        searchText: [secondary, tenant.displayName, contactName]
          .join(" ")
          .toLowerCase(),
      });
    }

    if (tenant.riskLevel !== "normal" || tenant.status === "suspended") {
      const secondary = `${code} · ${labels.riskMeta(
        riskLabel(tenant.riskLevel),
        statusLabel(tenant.status),
      )}`;
      items.push({
        id: `${tenant.id}-risk`,
        type: "risk",
        code,
        task: { kind: "risk" },
        secondary,
        tenantId: tenant.id,
        tenantCode: code,
        tenantName: tenant.displayName,
        tenantType: tenant.tenantType,
        contactName,
        tenantMeta,
        href: tenantHref,
        severity:
          tenant.riskLevel === "high" || tenant.status === "suspended"
            ? "rose"
            : "amber",
        priority: tenant.riskLevel === "high" ? 5 : 25,
        // 风险没有「进入风险态」的时刻列，只能拿最近活跃 / 创建时刻当起点。
        waitingSince: tenant.lastActiveAt ?? tenant.createdAt,
        amountText: null,
        progress: "risk",
        searchText: [secondary, tenant.displayName, contactName]
          .join(" ")
          .toLowerCase(),
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
    .map((ticket) => {
      const secondary = `${ticket.id} · ${labels.ticketPriority[ticket.priority]}`;
      const contactName = ticket.ownerName || labels.unknown;
      return {
        id: `${ticket.tenantId}-${ticket.id}`,
        type: "ticket" as const,
        code: ticket.id,
        task: { kind: "ticket" as const, title: ticket.title },
        secondary,
        tenantId: ticket.tenantId,
        tenantCode: formatPrincipalNoOr(ticket.tenantCode, "tenant", "—"),
        tenantName: ticket.tenantName,
        tenantType: ticket.tenantType,
        contactName,
        tenantMeta: `${typeLabel(ticket.tenantType)} / ${ticket.region} / ${statusLabel(ticket.tenantStatus)}`,
        // 跳这张工单本身（2026-09-21）。原先这里是 `/tickets`，于是行操作里的
        // 「去处理工单」与「查看全部工单」是同一个地址——点进去还得自己
        // 在列表里找回那一条。`ticket.id` 是可读码 `ticket_no`（BFF 投影就是它）。
        href: `/tickets/${encodeURIComponent(ticket.id)}`,
        severity: ticketSeverity(ticket),
        priority: ticketPriority(ticket),
        waitingSince: ticket.updatedAt,
        amountText: null,
        progress: ticketProgress(ticket.status),
        searchText: [secondary, ticket.title, ticket.tenantName, contactName]
          .join(" ")
          .toLowerCase(),
      };
    });

  // 同一档紧急度里，等得最久的排最前——这一页是排班表，不是动态流。
  return [...orderTodos, ...tenantTodos, ...ticketTodos].sort((left, right) => {
    const severityDiff =
      severityOrder(left.severity) - severityOrder(right.severity);
    if (severityDiff !== 0) return severityDiff;
    return (
      left.priority - right.priority ||
      new Date(left.waitingSince).getTime() -
        new Date(right.waitingSince).getTime()
    );
  });
}

/** 把等待时长拆成天 / 小时 / 分钟；起点读不出来按 0 算，不让一条坏数据把整页拖垮。 */
function elapsedParts(sinceIso: string, now: number) {
  const since = new Date(sinceIso).getTime();
  const ms = Number.isFinite(since) ? Math.max(0, now - since) : 0;
  const totalMinutes = Math.floor(ms / 60_000);
  return {
    ms,
    days: Math.floor(totalMinutes / 1440),
    hours: Math.floor((totalMinutes % 1440) / 60),
    minutes: totalMinutes % 60,
  };
}

const DAY_MS = 24 * 60 * 60_000;

/** 超 24 小时橙、超 3 天红（设计稿 §4）。 */
function waitTone(ms: number): StatusBadgeTone {
  if (ms > 3 * DAY_MS) return "danger";
  if (ms > DAY_MS) return "warning";
  return "neutral";
}

function waitText(t: TPage, parts: ReturnType<typeof elapsedParts>) {
  if (parts.days > 0) {
    return t("wait.days", { days: parts.days, hours: parts.hours });
  }
  if (parts.hours > 0) {
    return t("wait.hours", { hours: parts.hours, minutes: parts.minutes });
  }
  if (parts.minutes > 0) return t("wait.minutes", { minutes: parts.minutes });
  return t("wait.justNow");
}

function taskSentence(t: TPage, task: TaskSpec): string {
  switch (task.kind) {
    case "confirmPayment":
      return t("task.confirmPayment", { amount: task.amount });
    case "reprovision":
      return t("task.reprovision", { amount: task.amount });
    case "followUpBalance":
      return t("task.followUpBalance", {
        amount: task.amount,
        paid: task.paid,
      });
    case "verification":
      return t("task.verification");
    case "risk":
      return t("task.risk");
    case "ticket":
      return t("task.ticket", { title: task.title });
  }
}

/** 一条待办里等得最久的那个起点；空集合为 null。 */
function oldestWaitingSince(items: readonly OpsTodoItem[]): string | null {
  let oldest: string | null = null;
  let oldestMs = Number.POSITIVE_INFINITY;
  for (const item of items) {
    const ms = new Date(item.waitingSince).getTime();
    if (Number.isFinite(ms) && ms < oldestMs) {
      oldestMs = ms;
      oldest = item.waitingSince;
    }
  }
  return oldest;
}

function useTodoTypeLabels(): Record<TodoType, string> {
  const tTypes = useTranslations("opsTodosPage.types");
  return {
    payment: tTypes("payment"),
    verification: tTypes("verification"),
    risk: tTypes("risk"),
    ticket: tTypes("ticket"),
  };
}

function useSeverityLabels(): Record<TodoSeverity, string> {
  const tSeverity = useTranslations("opsTodosPage.severity");
  return {
    rose: tSeverity("urgent"),
    amber: tSeverity("attention"),
    blue: tSeverity("normal"),
  };
}

function useProgressLabels(): Record<ProgressKey, string> {
  const tProgress = useTranslations("opsTodosPage.progress");
  return {
    pendingVerify: tProgress("pendingVerify"),
    paidUnprovisioned: tProgress("paidUnprovisioned"),
    partialPending: tProgress("partialPending"),
    verification: tProgress("verification"),
    risk: tProgress("risk"),
    ticketOpen: tProgress("ticketOpen"),
    ticketProcessing: tProgress("ticketProcessing"),
    ticketBlocked: tProgress("ticketBlocked"),
  };
}

/**
 * 每类待办的**主按钮**叫什么、次要去处叫什么。
 *
 * 此前四类共用一个「处理入口」藏在 ⋯ 菜单里，点之前不知道会跳到哪；现在主按钮
 * 直接摆在行尾，`href` 本来就已按类型分流（订单详情 / 认证审核页 / 租户详情 / 工单）。
 */
function useTodoActionLabels(): Record<
  TodoType,
  { primary: string; list: string }
> {
  const tActions = useTranslations("opsTodosPage.actions");
  return {
    payment: {
      primary: tActions("goVerify"),
      list: tActions("viewAllOrders"),
    },
    verification: {
      primary: tActions("goReview"),
      list: tActions("viewAllVerifications"),
    },
    risk: {
      primary: tActions("goRecheck"),
      list: tActions("viewAllTenants"),
    },
    ticket: {
      primary: tActions("goHandle"),
      list: tActions("viewAllTickets"),
    },
  };
}

/* 收 `t` 的工厂而不是模块级常量：常量在模块加载时就求值了，那一刻没有任何
   运行时上下文，而列头与文案要按界面语言取（同 OrdersPage 的 orderCsvColumns）。 */
function todoCsvColumns(
  t: TPage,
  typeLabels: Record<TodoType, string>,
  severityLabels: Record<TodoSeverity, string>,
  progressLabels: Record<ProgressKey, string>,
): readonly CsvColumn<OpsTodoItem>[] {
  return [
    // 编号单列一栏——运营拿 CSV 正是为了按单号去对账。
    { label: t("csv.code"), value: (item) => item.code },
    { label: t("csv.task"), value: (item) => taskSentence(t, item.task) },
    { label: t("csv.tenant"), value: (item) => item.tenantName },
    { label: t("csv.contact"), value: (item) => item.contactName },
    // 租户属性(类型/地区/状态)不进表格,仍留在 CSV 里——那是对账要用的。
    { label: t("csv.tenantMeta"), value: (item) => item.tenantMeta },
    { label: t("csv.type"), value: (item) => typeLabels[item.type] },
    {
      label: t("csv.severity"),
      value: (item) => severityLabels[item.severity],
    },
    { label: t("csv.amount"), value: (item) => item.amountText },
    { label: t("csv.waitingSince"), value: (item) => item.waitingSince },
    {
      label: t("csv.progress"),
      value: (item) => progressLabels[item.progress],
    },
  ];
}

/**
 * 待办页尾的「系统消息」一行（owner 2026-09-27：块保留，改成一行摘要 + 「查看全部」）。
 *
 * 只报「几条未读、最新一条是什么」，不在这里列消息、不在这里点已读——那些在
 * /messages（`SystemNoticesSection` 的 all 档）。摘要读的是 digest 档（当天已读 +
 * 所有未读），取其中第一条未读当「最新」。
 */
function SystemNoticesSummary() {
  const tPage = useTranslations("opsTodosPage");
  const router = useRouter();
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error" }
    | { status: "ready"; unread: number; latest: OperatorNoticeItem | null }
  >({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetchOperatorNotices({ scope: "digest", limit: 10, offset: 0 })
      .then((result) => {
        if (cancelled) return;
        setState({
          status: "ready",
          unread: result.unread,
          latest: result.items.find((item) => item.readAt === null) ?? null,
        });
      })
      .catch(() => {
        // 读失败要显影，不能画成「没有未读」——那是两件事。
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  let line: string;
  if (state.status === "loading") {
    line = tPage("notices.loading");
  } else if (state.status === "error") {
    line = tPage("notices.loadFailed");
  } else if (state.unread > 0) {
    line = state.latest
      ? tPage("notices.unread", {
          count: formatNumber(state.unread),
          title: state.latest.title,
        })
      : tPage("notices.unreadOnly", { count: formatNumber(state.unread) });
  } else {
    line = tPage("notices.none");
  }

  return (
    <Section
      title={tPage("notices.title")}
      icon="bell"
      level={2}
      action={
        <ActionButton
          variant="outline"
          icon="arrow-right"
          onClick={() => router.push("/messages")}
        >
          {tPage("notices.viewAll")}
        </ActionButton>
      }
    >
      <p className="text-body-sm text-muted-foreground">{line}</p>
    </Section>
  );
}

/**
 * 两个视图共用本件（owner 2026-09-20：「全部任务做二级页面展示」）。
 *
 *   queue（/ops-todos）     主页。只列与统计卡对齐的**三类**。
 *   all  （/ops-todos/all） 全部任务。四类齐全，风险复核在这里有落点。
 *
 * 拆成两个视图而不是两份代码：表格列、操作菜单、CSV 列、翻页全都一样，复制一份
 * 迟早两边长歪。差别只有「列哪几类」与「有没有那个去处按钮」，用一个 prop 收住。
 */
export function OpsTodosPage({ scope = "queue" }: { scope?: TodoScope } = {}) {
  const isAll = scope === "all";
  const tPage = useTranslations("opsTodosPage");
  const tShared = useTranslations();
  const tableLabels = useTableLabels();
  const typeLabels = useTodoTypeLabels();
  const severityLabels = useSeverityLabels();
  const progressLabels = useProgressLabels();
  const actionLabels = useTodoActionLabels();
  const ticketPriorityLabels = useTicketPriorityLabels();
  const router = useRouter();
  const [tenants, setTenants] = useState<TenantOperationRecord[]>([]);
  const [tickets, setTickets] = useState<SupportTicketRecord[]>([]);
  const [orders, setOrders] = useState<OrderOperationRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [tenantLoadError, setTenantLoadError] = useState<string | null>(null);
  const [ticketLoadError, setTicketLoadError] = useState<string | null>(null);
  const [orderLoadError, setOrderLoadError] = useState<string | null>(null);
  /**
   * 「等待」列的参照时刻。数据到手那一刻定一次，不在渲染里现取——渲染里取会让
   * 每次重渲染都换一个数，也会让服务端与客户端首屏对不上。
   */
  const [now, setNow] = useState(() => Date.now());

  const todoLabels = useMemo<TodoLabels>(
    () => ({
      unknown: tPage("unknown"),
      ticketPriority: ticketPriorityLabels,
      riskMeta: (risk, status) => tPage("secondary.riskMeta", { risk, status }),
    }),
    [tPage, ticketPriorityLabels],
  );
  /** 四类全量。页头的「任务 N」报的是这个数——owner：「tag 显示 全部代办数量」。 */
  const allTodos = useMemo(
    () => buildOpsTodos(tenants, tickets, orders, todoLabels),
    [tenants, tickets, orders, todoLabels],
  );
  /**
   * 本视图实际要列的那些。
   *
   * 主页只列三类:统计卡是那三张,表格再混进第四类就对不上了。
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
      return todo.searchText.includes(keyword);
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
  const hasActiveFilter =
    Boolean(query) || typeFilter !== "all" || severityFilter !== "all";

  /** 点卡片即筛选；再点一次回到全部。换分类即换行集，旧选择与页码随之失效。 */
  const toggleTypeFilter = (type: TodoType) => {
    setTypeFilter((current) => (current === type ? "all" : type));
    setSelectedKeys([]);
    setPage(1);
  };

  const resetFilters = () => {
    setQuery("");
    setTypeFilter("all");
    setSeverityFilter("all");
    setSelectedKeys([]);
    setPage(1);
  };

  /**
   * 统计卡的一句人话：「N 笔待你核对，最久等了 6 分钟」。没有就说没有；
   * 那一路数据没读到就说没读到——空白与 0 在这里是两件事。
   */
  const cardSentence = (type: TodoType, items: readonly OpsTodoItem[]) => {
    if (isLoading) return tPage("cards.loading");
    const oldest = oldestWaitingSince(items);
    const params = {
      count: formatNumber(items.length),
      wait: oldest ? waitText(tPage, elapsedParts(oldest, now)) : "",
    };
    switch (type) {
      case "payment":
        if (items.length) return tPage("cards.payment", params);
        return orderLoadError
          ? tPage("cards.paymentUnavailable")
          : tPage("cards.paymentEmpty");
      case "verification":
        return items.length
          ? tPage("cards.verification", params)
          : tPage("cards.verificationEmpty");
      case "ticket":
        if (items.length) return tPage("cards.ticket", params);
        return ticketLoadError
          ? tPage("cards.ticketUnavailable")
          : tPage("cards.ticketEmpty");
      case "risk":
        return items.length
          ? tPage("cards.risk", params)
          : tPage("cards.riskEmpty");
    }
  };

  // 卡的清单跟着视图走：全部任务页多一张风险复核，主页不列这一类——列了卡就成了
  // 点不到的数。
  const cardTypes: readonly TodoType[] = isAll
    ? ["payment", "verification", "ticket", "risk"]
    : TODO_FILTER_TYPES;

  const todoMenu = (item: OpsTodoItem) => {
    const tenantHref = `/tenants/${encodeURIComponent(item.tenantCode)}`;
    return (
      <ActionMenu
        label={tPage("actions.menuLabel", { code: item.code })}
        items={[
          // 主按钮已经去租户页的（风险复核）不再重复列一次「查看租户」。
          ...(item.href === tenantHref
            ? []
            : [
                {
                  id: "tenant",
                  label: tShared("actions.viewTenant"),
                  icon: "buildings" as const,
                  onSelect: () => router.push(tenantHref),
                },
              ]),
          {
            id: "list",
            label: actionLabels[item.type].list,
            icon: "table" as const,
            onSelect: () => router.push(TODO_LIST_HREF[item.type]),
          },
        ]}
      />
    );
  };

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
            error instanceof Error
              ? error.message
              : tPage("empty.ticketsFailed"),
          );
        }
        return [];
      }),
      // 订单读取失败不拖垮整页（同工单的降级方式）：没有订单权限的运营仍能看其余待办。
      fetchOrderOperations().catch((error) => {
        if (!cancelled) {
          setOrderLoadError(
            error instanceof Error
              ? error.message
              : tPage("empty.ordersFailed"),
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
          setNow(Date.now());
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setTenants([]);
          setTickets([]);
          setOrders([]);
          setTenantLoadError(
            error instanceof Error
              ? error.message
              : tPage("empty.tenantsFailed"),
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
  }, [tPage]);

  const sectionDescription = [
    tPage("section.summary", { count: formatNumber(todos.length) }),
    // 主页把「本页列了几条」与「总共几条」的差额**说出来**:页头 badge 报四类全量,
    // 这里只列三类,不点破就会被当成数字对不上。
    !isAll && hiddenCount > 0
      ? tPage("section.hiddenRisk", { count: formatNumber(hiddenCount) })
      : null,
    typeFilter !== "all"
      ? tPage("section.filteringType", { type: typeLabels[typeFilter] })
      : null,
    ticketLoadError ? tPage("section.ticketsUnavailable") : null,
    orderLoadError ? tPage("section.ordersUnavailable") : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <ListPageTemplate
      className="w-full "
      header={
        <PageHeader
          icon="table"
          title={isAll ? tPage("header.allTitle") : tPage("header.queueTitle")}
          description={
            isAll
              ? tPage("header.allDescription")
              : tPage("header.queueDescription")
          }
          secondary={
            /* 标题行直接报总量,免得运营为了知道"还剩多少"去数统计卡。
               **两个视图都报四类全量**(owner:「tag 显示 全部代办数量」)——
               它是这件事的总数,不是本页列了几条,所以既不随筛选变、也不随
               视图变。主页与它的差额由区块说明点明。 */
            <Badge>
              {tPage("header.totalBadge", {
                count: formatNumber(allTodos.length),
              })}
            </Badge>
          }
        />
      }
      summary={
        /* 统计卡就是分类筛选（设计稿 §4：「点卡片即筛选，下面的分段按钮就不要了——
           二选一」）。用 EntryCard 而不是 MetricGrid：前者整卡可点、自带键盘与
           role=button，后者只报数。三张 / 四张随视图走，列数跟着卡数。 */
        <div
          className={
            isAll
              ? "grid min-w-0 grid-cols-1 gap-md sm:grid-cols-2 xl:grid-cols-4"
              : "grid min-w-0 grid-cols-1 gap-md sm:grid-cols-3"
          }
        >
          {cardTypes.map((type) => {
            const items = todos.filter((todo) => todo.type === type);
            const active = typeFilter === type;
            return (
              <EntryCard
                key={type}
                icon={TODO_TYPE_ICON[type]}
                title={typeLabels[type]}
                meta={isLoading ? tPage("unknown") : formatNumber(items.length)}
                description={cardSentence(type, items)}
                aria-pressed={active}
                onClick={() => toggleTypeFilter(type)}
              >
                {active ? (
                  <StatusBadge tone="info" dot>
                    {tPage("cards.filtering")}
                  </StatusBadge>
                ) : null}
              </EntryCard>
            );
          })}
        </div>
      }
      table={
        <>
          <Section
            // 全部任务页的页头已经叫「全部任务」了,区块再叫一遍等于把同一个词
            // 摞两层;这里说的是它列的是什么。
            title={
              isAll ? tPage("section.allTitle") : tPage("section.queueTitle")
            }
            // 图标跟随当前分类，"全部"档退回队列自身图标。
            icon={typeFilter === "all" ? "table" : TODO_TYPE_ICON[typeFilter]}
            level={2}
            description={sectionDescription}
          >
            <FilterBar
              aria-label={tPage("filters.ariaLabel")}
              count={formatNumber(filteredTodos.length)}
              search={
                <Input
                  type="search"
                  className="min-w-media-2xl grow basis-0 max-w-panel-sm"
                  placeholder={tPage("filters.searchPlaceholder")}
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setPage(1);
                  }}
                  aria-label={tPage("filters.searchAriaLabel")}
                />
              }
              onReset={resetFilters}
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
                    {isAll
                      ? tPage("filters.backToQueue")
                      : tPage("filters.toAll")}
                  </ActionButton>
                  <ActionButton
                    icon="arrow-down"
                    variant={selectedTodos.length > 0 ? "default" : "outline"}
                    disabled={selectedTodos.length === 0}
                    onClick={() =>
                      exportRowsToCsv(
                        isAll ? "ops-todos-all" : "ops-todos",
                        todoCsvColumns(
                          tPage,
                          typeLabels,
                          severityLabels,
                          progressLabels,
                        ),
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
                aria-label={tPage("filters.severityAriaLabel")}
              >
                {/* 「全部紧急度」四字会顶到下拉箭头底下(owner 2026-09-20 实看),
                  收成「全部」——aria-label 已经说明这一栏是紧急度。 */}
                <option value="all">{tPage("filters.severityAll")}</option>
                {SEVERITIES.map((severity) => (
                  <option key={severity} value={severity}>
                    {severityLabels[severity]}
                  </option>
                ))}
              </NativeSelect>
            </FilterBar>

            {/* 七列定宽（设计稿 §4）：紧急度 / 任务 / 租户 · 申报人 / 金额 / 等待 /
                进展 / 操作。短列走 DataTable 的宽度分档（它是最小宽度，DS 不开
                自由 px），任务与租户两列留 auto 分掉余下的空间；任务格主辅两行各自
                截断、整句放进 title，1440 宽下不出横向滚动。 */}
            <DataTable
              labels={tableLabels}
              columns={[
                {
                  id: "severity",
                  header: tPage("columns.severity"),
                  cell: (item) => (
                    <StatusBadge tone={SEVERITY_TONE[item.severity]} dot>
                      {severityLabels[item.severity]}
                    </StatusBadge>
                  ),
                },
                {
                  id: "task",
                  header: tPage("columns.task"),
                  align: "left",
                  cell: (item) => {
                    const sentence = taskSentence(tPage, item.task);
                    return (
                      <TableTitleCell
                        icon={TODO_TYPE_ICON[item.type]}
                        title={sentence}
                        description={item.secondary}
                        tooltip={`${sentence} · ${item.secondary}`}
                        onTitleClick={() => router.push(item.href)}
                      />
                    );
                  },
                },
                {
                  id: "tenant",
                  header: tPage("columns.tenant"),
                  align: "left",
                  cell: (item) => (
                    <TableTitleCell
                      icon={
                        item.tenantType === "company"
                          ? "buildings"
                          : "building-office"
                      }
                      title={item.tenantName}
                      description={item.contactName}
                      tooltip={`${item.tenantName} · ${item.contactName}`}
                      onTitleClick={() =>
                        router.push(
                          `/tenants/${encodeURIComponent(item.tenantCode)}`,
                        )
                      }
                    />
                  ),
                },
                {
                  id: "amount",
                  header: tPage("columns.amount"),
                  align: "money",
                  cell: (item) => item.amountText ?? tPage("unknown"),
                },
                {
                  id: "wait",
                  header: tPage("columns.wait"),
                  width: "xs",
                  cell: (item) => {
                    const parts = elapsedParts(item.waitingSince, now);
                    return (
                      <StatusBadge tone={waitTone(parts.ms)} dot>
                        {waitText(tPage, parts)}
                      </StatusBadge>
                    );
                  },
                },
                {
                  id: "progress",
                  header: tPage("columns.progress"),
                  width: "sm",
                  cell: (item) => progressLabels[item.progress],
                },
                {
                  id: "actions",
                  header: tPage("columns.actions"),
                  width: "sm",
                  cell: (item) => (
                    <span className="inline-flex items-center gap-xs">
                      <Button size="sm" onClick={() => router.push(item.href)}>
                        {actionLabels[item.type].primary}
                      </Button>
                      {todoMenu(item)}
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
                  title={
                    tenantLoadError
                      ? tPage("empty.loadFailedTitle")
                      : tPage("empty.title")
                  }
                  description={
                    tenantLoadError ??
                    (hasActiveFilter
                      ? tShared("common.adjustFiltersHint")
                      : ticketLoadError)
                  }
                  action={
                    hasActiveFilter && !tenantLoadError ? (
                      <ActionButton
                        variant="outline"
                        icon="x"
                        onClick={resetFilters}
                      >
                        {tShared("common.clearFilters")}
                      </ActionButton>
                    ) : undefined
                  }
                />
              }
            />
            {/* 翻页行与上方筛选行**同为 Section 的直接子元素**,于是左右边距一致
              (owner 2026-09-20:「表格的头部操作行,底部翻页行,格式没有统一」)。
              只在装不下一页时才出现——一条任务配一整条翻页器是空转。 */}
            {filteredTodos.length > pageSize ? (
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
            ) : null}
          </Section>

          {/* S2 系统消息——只在主页出现;全部任务页是待办的二级页,不该把消息区
            再画一遍。数据来自 admin.operator_notices(发布面在 opera)。 */}
          {isAll ? null : <SystemNoticesSummary />}
        </>
      }
    />
  );
}
