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
import { fetchOperatorNotices, fetchOpsTodos } from "@/api/admin-bff";
import type { OperatorNoticeItem } from "@/api/admin-bff";
import type {
  OpsTodo,
  OpsTodoKind,
  OpsTodoProgress,
  OpsTodoSeverity,
  TenantOperationStatus,
  TenantRiskLevel,
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

/*
 * 待办的**判据不在这个文件里**（2026-09-28 根治）。
 *
 * 此前这一页自己拉租户 / 工单 / 订单三张表，在浏览器里派生「哪些算待办、多紧急、
 * 等了多久」；告警作业在服务端另写一份判据，两边各算各的——退款申请两边都没算，
 * 于是一张 ¥99 的退款单挂了一上午没人知道（owner：「根治是做一个服务端「待办」
 * 接口，页面和作业读同一份」）。现在判据只有 `@vxture/service-ops-todos` 一份：
 * 严重度、优先级、等待起点、进度键、去处全部由 GET /api/ops/todos 下发，页面只做
 * 筛选 / 排序 / 分页 / CSV / 渲染，不再自己派生。
 */

/** 紧急 / 关注 / 一般——服务端三档，页面沿用。 */
type TodoSeverity = OpsTodoSeverity;
/**
 * 统计卡 / 分类筛选的档位。服务端的七个 kind 收成五档：三种收款态订单同属
 * 「收款确认」（owner 2026-09-02：「这种需要紧急处理的确认付款事项，应该推送到
 * 待办事项中」），其余各自一档。`refund`（退款审核）2026-09-28 加入——那张没人
 * 看见的退款单正属于这一类。
 */
type TodoType = "payment" | "refund" | "verification" | "risk" | "ticket";

const KIND_TYPE: Record<OpsTodoKind, TodoType> = {
  confirm_payment: "payment",
  reprovision: "payment",
  follow_up_balance: "payment",
  refund_audit: "refund",
  verification: "verification",
  risk: "risk",
  ticket: "ticket",
};

/**
 * 表格 / CSV 直接消费的一行。由 `toRow` 从服务端的 `OpsTodo` 拍平——只做文案与
 * 可视码的整理，不做任何判断（判断都在服务端）。
 */
interface TodoRow {
  id: string;
  kind: OpsTodoKind;
  type: TodoType;
  /**
   * 事项的**可视编号**，单独成字段而不是揉进句子：订单 `order_no`、退款 `refund_no`、
   * 工单 `ticket_no`；租户级事项没有单据号，用带前缀的租户号。一律是可视码，
   * **任何场景不展示 UUID**（服务端契约里根本没有 UUID）。
   */
  code: string;
  /** 「任务」列的副行：单号 · 产品 / 套餐、租户号、工单号 · 优先级。 */
  secondary: string;
  /** 租户详情页；没有租户号就没有去处。 */
  tenantHref: string | null;
  /** 面向用户的租户号（带 T- 前缀），CSV 与租户列副行用。 */
  tenantCode: string;
  tenantName: string;
  tenantIsCompany: boolean;
  /**
   * 租户列的副行：**是谁在等**。收款 / 退款是申报人 / 申请人（客服要联系的正是
   * 这个人），认证 / 风险是租户联系人，工单是提单人——都由服务端按各自的来源填
   * `applicant`。查不到就是「—」，**不退回 UUID，也不拿平台经办人冒充客户**。
   */
  contactName: string;
  /** 联系人 + 邮箱 + 手机，只进 title 提示，不占列宽。 */
  contactTooltip: string;
  tenantMeta: string;
  href: string;
  severity: TodoSeverity;
  priority: number;
  /**
   * 等待起点（ISO）。「等待」列与统计卡的「最久等了」都从它算；起点按哪个时刻
   * 取（申报 / 确认收款 / 退款申请 / 认证提交 / 工单更新）是服务端的规则。
   */
  waitingSince: string;
  /** 收款是应收、退款是退款额；其余「—」。 */
  amountText: string | null;
  /**
   * 已收到的那一部分（只有尾款挂账的待办有）。客服跟尾款时要说的正是
   * 「已收 X、应付 Y」；读不到就是 null，句子退回只说应付的那一版。
   */
  paidText: string | null;
  progress: OpsTodoProgress;
  /** 工单标题；只有工单有。 */
  ticketTitle: string | null;
  /** 搜索框匹配的全文，小写。 */
  searchText: string;
}

const TODO_TYPE_ICON: Record<TodoType, IconName> = {
  payment: "credit-card",
  refund: "undo",
  verification: "medal",
  risk: "warning",
  ticket: "chat-circle",
};

/**
 * 主页分类栏列四档（owner 2026-09-20：「去掉 风险复核」）。
 *
 * **去的是主页这一层，不是这类待办本身**——`risk` 仍由服务端产出、仍进「全部
 * 任务」页并可处理。若连产出一并摘掉，现存的风险事项会在运营台完全不可见，
 * 成为没人看得见的孤儿。
 */
export type TodoScope = "queue" | "all";

const TODO_FILTER_TYPES: readonly TodoType[] = [
  "payment",
  "refund",
  "verification",
  "ticket",
];

/** 每类待办的次要去处：同类全量列表——运营处理完一条常要看这类还剩多少。 */
const TODO_LIST_HREF: Record<TodoType, string> = {
  payment: "/orders",
  // 退款没有独立列表页：退款单挂在订单详情的任务卡上，同类全量看订单列表。
  refund: "/orders",
  verification: "/verifications",
  risk: "/tenants",
  ticket: "/tickets",
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

/** 派生行时要用到的、按界面语言取的文案。纯函数拿不到 `t`，由组件传进来。 */
interface TodoLabels {
  unknown: string;
  ticketPriority: Record<TicketPriority, string>;
  /** 风险行副行的后半句：风险档 + 租户状态。 */
  riskMeta: (risk: string, status: string) => string;
}

/**
 * 金额在这一层就格式化好——CSV 与表格两处要同一个写法；应收与已收
 * 也要同一个，两个数要拼进同一句话里。读不出数就是 null，不拿 0 冒充。
 */
function formatMoney(
  value: string | null | undefined,
  currency: string,
): string | null {
  if (!value) return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return formatCurrency(num, currency || "CNY");
}

function tenantTypeText(type: string | null | undefined): string | null {
  if (type === "company" || type === "individual") return typeLabel(type);
  return null;
}

const TENANT_STATUSES: readonly TenantOperationStatus[] = [
  "trial",
  "active",
  "suspended",
  "cancelled",
];

const TENANT_RISK_LEVELS: readonly TenantRiskLevel[] = [
  "normal",
  "follow_up",
  "high",
];

/*
 * 枚举原值→文案走 tenant-utils 同一份（租户列表 / 详情页用的就是它），
 * 而不在这一页再写一张映射表——四份 subscriptionStatusLabel 互不相同那事
 * （check-enum-label-sprawl 头注）就是这么来的。
 *
 * 接口给的是 `string | null`，所以先在值域里找得到才取文案：`statusLabel`
 * 与 `riskLabel` 都有默认分支（「注销」/「正常」），直接灌一个读不到的值
 * 会得到一个看上去很确切的错答案。
 */
function tenantStatusText(status: string | null | undefined): string | null {
  const known = TENANT_STATUSES.find((value) => value === status);
  return known ? statusLabel(known) : null;
}

function tenantRiskText(risk: string | null | undefined): string | null {
  const known = TENANT_RISK_LEVELS.find((value) => value === risk);
  return known ? riskLabel(known) : null;
}

/** 租户自填的自由文本（地区 / 行业 / 规模）；空与「未设置」都算没有。 */
function filledText(value: string | null | undefined): string | null {
  return value && !isUnset(value) ? value : null;
}

/**
 * CSV 的「租户属性」一列：类型 / 地区 / 状态——运营按地区分工、按状态挑出已暂停
 * 的那几家都要这三项。读不到的那一段不占位；三项都读不到才是「—」。
 */
function tenantMetaText(tenant: OpsTodo["tenant"], labels: TodoLabels): string {
  return (
    [
      tenantTypeText(tenant?.type),
      filledText(tenant?.region),
      tenantStatusText(tenant?.status),
    ]
      .filter(Boolean)
      .join(" / ") || labels.unknown
  );
}

function ticketPriorityText(priority: string, labels: TodoLabels): string {
  return (
    (labels.ticketPriority as Record<string, string>)[priority] ?? priority
  );
}

function secondaryLine(
  todo: OpsTodo,
  code: string,
  labels: TodoLabels,
): string {
  if (todo.subject.type === "ticket") {
    return todo.ticket
      ? `${code} · ${ticketPriorityText(todo.ticket.priority, labels)}`
      : code;
  }
  if (todo.subject.type === "tenant") {
    // 这一条为何进了待办，答案就在这两个词里：风险档与租户状态。只报租户号
    // 等于让运营点进详情页再看一眼。
    if (todo.kind === "risk") {
      return `${code} · ${labels.riskMeta(
        tenantRiskText(todo.tenant?.riskLevel) ?? labels.unknown,
        tenantStatusText(todo.tenant?.status) ?? labels.unknown,
      )}`;
    }
    // 认证行：行业 / 规模——审材料前先知道对面是干什么的、多大。读不到的
    // 那一段不占位，不讲「— · —」。
    return [
      code,
      filledText(todo.tenant?.industry),
      filledText(todo.tenant?.scale),
    ]
      .filter(Boolean)
      .join(" · ");
  }
  return [
    code,
    todo.product && !isUnset(todo.product.name) ? todo.product.name : null,
    todo.product && todo.product.planName && !isUnset(todo.product.planName)
      ? todo.product.planName
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function toRow(todo: OpsTodo, labels: TodoLabels): TodoRow {
  const tenantNo = todo.tenant?.no ?? null;
  const tenantCode = formatPrincipalNoOr(tenantNo, "tenant", labels.unknown);
  // 租户级事项的「编号」就是租户号，上屏要带前缀；单据类原样是可视码。
  const code = todo.subject.type === "tenant" ? tenantCode : todo.subject.no;
  const tenantName = todo.tenant?.name || labels.unknown;
  const contactName = todo.applicant?.name || labels.unknown;
  const contactTooltip =
    [todo.applicant?.name, todo.applicant?.email, todo.applicant?.phone]
      .filter(Boolean)
      .join(" · ") || labels.unknown;
  const amountText = todo.amount
    ? formatMoney(todo.amount.value, todo.amount.currency)
    : null;
  const paidText = todo.amount
    ? formatMoney(todo.amount.paid, todo.amount.currency)
    : null;
  const ticketTitle = todo.ticket?.title ?? null;
  const secondary = secondaryLine(todo, code, labels);
  return {
    id: todo.id,
    kind: todo.kind,
    type: KIND_TYPE[todo.kind],
    code,
    secondary,
    // 地址栏走可读码，不带显示前缀（BFF 双接受，但规范形是裸号）。
    tenantHref: tenantNo ? `/tenants/${encodeURIComponent(tenantNo)}` : null,
    tenantCode,
    tenantName,
    tenantIsCompany: todo.tenant?.type === "company",
    contactName,
    contactTooltip,
    tenantMeta: tenantMetaText(todo.tenant, labels),
    href: todo.href,
    severity: todo.severity,
    priority: todo.priority,
    waitingSince: todo.waitingSince,
    amountText,
    paidText,
    progress: todo.progress,
    ticketTitle,
    searchText: [
      secondary,
      ticketTitle,
      tenantName,
      contactName,
      todo.applicant?.email,
      todo.applicant?.phone,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase(),
  };
}

/**
 * 拍平 + 排序。同一档紧急度里，优先级小的在前、等得最久的排最前——这一页是
 * 排班表，不是动态流。服务端也按同一规则排过，这里再排一次是让筛选后的子集
 * 仍然成立，不依赖接口的输出顺序。
 */
function buildRows(todos: readonly OpsTodo[], labels: TodoLabels): TodoRow[] {
  return todos
    .map((todo) => toRow(todo, labels))
    .sort((left, right) => {
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

/**
 * 「任务」列那一句话。素材（是哪一种、金额、工单标题）来自服务端，句子在渲染时
 * 按界面语言拼——表格与 CSV 两处同一个写法。
 */
function taskSentence(t: TPage, row: TodoRow): string {
  const amount = row.amountText ?? t("unknown");
  switch (row.kind) {
    case "confirm_payment":
      return t("task.confirmPayment", { amount });
    case "reprovision":
      return t("task.reprovision", { amount });
    case "follow_up_balance":
      // 尾款要把「已收多少」说出来——运营打电话跟客户说的正是这两个数。
      // 读不到实付就只说应付，不拿应付冒充已收。
      return row.paidText
        ? t("task.followUpBalance", { amount, paid: row.paidText })
        : t("task.followUpBalanceAmountOnly", { amount });
    case "refund_audit":
      return t("task.refundAudit", { amount });
    case "verification":
      return t("task.verification");
    case "risk":
      return t("task.risk");
    case "ticket":
      return t("task.ticket", { title: row.ticketTitle ?? row.code });
  }
}

/** 一批待办里等得最久的那个起点；空集合为 null。 */
function oldestWaitingSince(items: readonly TodoRow[]): string | null {
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
    refund: tTypes("refund"),
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

function useProgressLabels(): Record<OpsTodoProgress, string> {
  const tProgress = useTranslations("opsTodosPage.progress");
  return {
    pendingVerify: tProgress("pendingVerify"),
    paidUnprovisioned: tProgress("paidUnprovisioned"),
    partialPending: tProgress("partialPending"),
    refundAudit: tProgress("refundAudit"),
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
 * 直接摆在行尾，`href` 由服务端按类型分流（订单详情 / 认证审核页 / 租户详情 / 工单）。
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
    // 退款审核在订单详情页的任务卡上做，主按钮与认证同一个动词「去审核」。
    refund: {
      primary: tActions("goReview"),
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
  progressLabels: Record<OpsTodoProgress, string>,
): readonly CsvColumn<TodoRow>[] {
  return [
    // 编号单列一栏——运营拿 CSV 正是为了按单号去对账。
    { label: t("csv.code"), value: (item) => item.code },
    { label: t("csv.task"), value: (item) => taskSentence(t, item) },
    { label: t("csv.tenant"), value: (item) => item.tenantName },
    { label: t("csv.contact"), value: (item) => item.contactName },
    // 租户属性不进表格，仍留在 CSV 里——那是对账要用的。
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
 *   queue（/ops-todos）     主页。只列与统计卡对齐的**四类**。
 *   all  （/ops-todos/all） 全部任务。五类齐全，风险复核在这里有落点。
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
  const [serverTodos, setServerTodos] = useState<OpsTodo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  /** 接口读失败的原因。空白与 0 在这一页是两件事：读不到不能画成「今天没事」。 */
  const [loadError, setLoadError] = useState<string | null>(null);
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
  /** 五类全量。页头的「任务 N」报的是这个数——owner：「tag 显示 全部代办数量」。 */
  const allTodos = useMemo(
    () => buildRows(serverTodos, todoLabels),
    [serverTodos, todoLabels],
  );
  /**
   * 本视图实际要列的那些。
   *
   * 主页只列四类：统计卡是那四张，表格再混进第五类就对不上了。
   * 风险复核不是被删掉，是搬到「全部任务」——那一页五类齐全。
   */
  const todos = useMemo(
    () =>
      isAll
        ? allTodos
        : allTodos.filter((todo) => TODO_FILTER_TYPES.includes(todo.type)),
    [allTodos, isAll],
  );
  /** 主页上被折进「全部任务」的那些，区块说明要把这个数说出来。 */
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
   * 接口没读到就说没读到——空白与 0 在这里是两件事。
   */
  const cardSentence = (type: TodoType, items: readonly TodoRow[]) => {
    if (isLoading) return tPage("cards.loading");
    if (loadError) return tPage("empty.loadFailedTitle");
    const oldest = oldestWaitingSince(items);
    const params = {
      count: formatNumber(items.length),
      wait: oldest ? waitText(tPage, elapsedParts(oldest, now)) : "",
    };
    switch (type) {
      case "payment":
        return items.length
          ? tPage("cards.payment", params)
          : tPage("cards.paymentEmpty");
      case "refund":
        return items.length
          ? tPage("cards.refund", params)
          : tPage("cards.refundEmpty");
      case "verification":
        return items.length
          ? tPage("cards.verification", params)
          : tPage("cards.verificationEmpty");
      case "ticket":
        return items.length
          ? tPage("cards.ticket", params)
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
    ? [...TODO_FILTER_TYPES, "risk"]
    : TODO_FILTER_TYPES;

  const todoMenu = (item: TodoRow) => {
    const tenantHref = item.tenantHref ?? "";
    // 主按钮已经去租户页的（风险复核）不再重复列一次「查看租户」；没有租户号的
    // 也不列——一个跳不到地方的菜单项比没有更糟。
    const showTenant = tenantHref !== "" && item.href !== tenantHref;
    return (
      <ActionMenu
        label={tPage("actions.menuLabel", { code: item.code })}
        items={[
          ...(showTenant
            ? [
                {
                  id: "tenant",
                  label: tShared("actions.viewTenant"),
                  icon: "buildings" as const,
                  onSelect: () => router.push(tenantHref),
                },
              ]
            : []),
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
    setLoadError(null);

    // 一次读全量：页面与告警作业读的是同一份服务端待办，这里不再拼三张表。
    fetchOpsTodos()
      .then((items) => {
        if (!cancelled) {
          setServerTodos(items);
          setNow(Date.now());
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setServerTodos([]);
          setLoadError(
            error instanceof Error
              ? error.message
              : tPage("empty.loadFailedTitle"),
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
    // 主页把「本页列了几条」与「总共几条」的差额**说出来**：页头 badge 报五类全量，
    // 这里只列四类，不点破就会被当成数字对不上。
    !isAll && hiddenCount > 0
      ? tPage("section.hiddenRisk", { count: formatNumber(hiddenCount) })
      : null,
    typeFilter !== "all"
      ? tPage("section.filteringType", { type: typeLabels[typeFilter] })
      : null,
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
            /* 标题行直接报总量，免得运营为了知道"还剩多少"去数统计卡。
               **两个视图都报五类全量**（owner：「tag 显示 全部代办数量」）——
               它是这件事的总数，不是本页列了几条，所以既不随筛选变、也不随
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
           role=button，后者只报数。四张 / 五张随视图走，列数跟着卡数。 */
        <div
          className={
            isAll
              ? "grid min-w-0 grid-cols-1 gap-md sm:grid-cols-2 xl:grid-cols-5"
              : "grid min-w-0 grid-cols-1 gap-md sm:grid-cols-2 xl:grid-cols-4"
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
                meta={
                  isLoading || loadError
                    ? tPage("unknown")
                    : formatNumber(items.length)
                }
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
            // 全部任务页的页头已经叫「全部任务」了，区块再叫一遍等于把同一个词
            // 摞两层；这里说的是它列的是什么。
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
                /* 无"新建"：待办由服务端聚合产生。 */
                <>
                  {/* 两个视图**互相通着**：主页去全量，全量回主页。只给单向出口的话，
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
                {/* 「全部紧急度」四字会顶到下拉箭头底下（owner 2026-09-20 实看），
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
                    const sentence = taskSentence(tPage, item);
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
                  cell: (item) => {
                    const tenantHref = item.tenantHref ?? "";
                    return (
                      <TableTitleCell
                        icon={
                          item.tenantIsCompany ? "buildings" : "building-office"
                        }
                        title={item.tenantName}
                        description={item.contactName}
                        tooltip={`${item.tenantName} · ${item.contactTooltip}`}
                        // 没有租户号就没有去处，标题不做成可点的——跳回原地的
                        // 假动作比不可点更糟。
                        {...(tenantHref !== ""
                          ? { onTitleClick: () => router.push(tenantHref) }
                          : {})}
                      />
                    );
                  },
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
                    loadError
                      ? tPage("empty.loadFailedTitle")
                      : tPage("empty.title")
                  }
                  description={
                    loadError ??
                    (hasActiveFilter
                      ? tShared("common.adjustFiltersHint")
                      : undefined)
                  }
                  action={
                    hasActiveFilter && !loadError ? (
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
            {/* 翻页行与上方筛选行**同为 Section 的直接子元素**，于是左右边距一致
              （owner 2026-09-20：「表格的头部操作行，底部翻页行，格式没有统一」）。
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

          {/* S2 系统消息——只在主页出现；全部任务页是待办的二级页，不该把消息区
            再画一遍。数据来自 admin.operator_notices（发布面在 opera，系统事件
            由通知分发器镜像写入）。 */}
          {isAll ? null : <SystemNoticesSummary />}
        </>
      }
    />
  );
}
