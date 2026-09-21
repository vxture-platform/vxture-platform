"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useTableLabels } from "@/modules/shared/table";
import {
  ActionButton,
  ActionMenu,
  Badge,
  Banner,
  DataTable,
  DialogForm,
  EmptyState,
  Field,
  FieldLabel,
  FilterBar,
  Input,
  ListPageTemplate,
  MetricGrid,
  NativeSelect,
  StatusBadge,
  TableTitleCell,
  Textarea,
  useToast,
} from "@vxture/design-system";
import type { DataTableColumn, StatusBadgeTone } from "@vxture/design-system";
import { ListPagination } from "@/modules/shared/ListPagination";
import type { IconName } from "@vxture/design-system";
import {
  disableAccount,
  enableAccount,
  fetchAccountOperations,
  forceLogoutAccount,
} from "@/api/admin-bff";
import type { AccountOperationRecord } from "@/entities/console";
import { isListTruncated } from "@/lib/list-truncation";
import { PageHeader } from "@/modules/shared/PageHeader";
import { type PageSize } from "@/modules/shared/PageSizePicker";
import { formatDate, formatNumber } from "@/modules/tenants/tenant-utils";
import { formatPrincipalNoOr } from "@vxture-platform/shared";
import { resolveIpLocation } from "@/shared/ip-location";

type StatusFilter = "all" | AccountOperationRecord["status"];
type TenantTypeFilter = "all" | "company" | "individual" | "mixed";
type RoleFilter = "all" | "owner" | "admin" | "member";
/** 此刻在不在线。与账号状态是**两件事**：状态说能不能进，在线说此刻在不在。 */
type OnlineFilter = "all" | "online" | "offline";

/* 分组的展示名与次第。次第固定（owner > admin > member），出现与否看数据。 */
const ROLE_FILTER_ORDER: ReadonlyArray<{
  value: Exclude<RoleFilter, "all">;
  label: string;
}> = [
  { value: "owner", label: "Owner" },
  { value: "admin", label: "Admin" },
  { value: "member", label: "Member" },
];
type AccountsPageCopy = {
  eyebrow: string;
  title: string;
  description: string;
  summaryAriaLabel: string;
  toolbarAriaLabel: string;
  directoryAriaLabel: string;
  searchPlaceholder: string;
  searchAriaLabel: string;
  statusAriaLabel: string;
  tenantTypeAriaLabel: string;
  roleAriaLabel: string;
  createActionLabel: string;
  loadingTitle: string;
  loadingDescription: string;
  emptyTitle: string;
  emptyDescription: string;
};

type AccountStatusIndicatorTone =
  | "normal"
  | "progress"
  | "attention"
  | "closed";

const defaultAccountsPageCopy: AccountsPageCopy = {
  eyebrow: "租户账号",
  title: "账号管理",
  description:
    "平台运营侧跨租户检索账号、识别安全状态、处理账号启停与登录问题。",
  summaryAriaLabel: "账号运营统计",
  toolbarAriaLabel: "账号筛选",
  directoryAriaLabel: "账号清单",
  searchPlaceholder: "搜索账号、联系方式、租户、权限",
  searchAriaLabel: "搜索账号",
  statusAriaLabel: "账号状态",
  tenantTypeAriaLabel: "租户类型",
  roleAriaLabel: "权限类型",
  createActionLabel: "新建账号",
  loadingTitle: "正在加载账号",
  loadingDescription: "正在读取平台账号运营数据。",
  emptyTitle: "没有匹配的账号",
  emptyDescription: "清空筛选条件后可查看全部账号。",
};

function roleGroup(role: string): Exclude<RoleFilter, "all"> {
  const normalized = role.toLowerCase();
  if (normalized.includes("owner")) return "owner";
  if (normalized.includes("admin")) return "admin";
  return "member";
}

function accountRoleGroup(
  account: AccountOperationRecord,
): Exclude<RoleFilter, "all"> {
  const groups = account.tenantBindings.map((tenant) => roleGroup(tenant.role));
  if (groups.includes("owner")) return "owner";
  if (groups.includes("admin")) return "admin";
  return roleGroup(account.role);
}

function accountHighestRole(account: AccountOperationRecord) {
  const owner = account.tenantBindings.find(
    (tenant) => roleGroup(tenant.role) === "owner",
  );
  if (owner) return owner.role;

  const admin = account.tenantBindings.find(
    (tenant) => roleGroup(tenant.role) === "admin",
  );
  if (admin) return admin.role;

  return account.role;
}

function accountHighestRoleLabel(account: AccountOperationRecord) {
  const role = accountHighestRole(account);
  const normalized = role.toLowerCase();
  if (normalized.includes("owner")) return "owner";
  if (normalized.includes("admin")) return "admin";
  return role;
}

function accountTenantSummary(account: AccountOperationRecord) {
  const personalCount = account.tenantBindings.filter(
    (tenant) => tenant.tenantType === "individual",
  ).length;
  const companyCount = account.tenantBindings.filter(
    (tenant) => tenant.tenantType === "company",
  ).length;
  const tags = [
    personalCount > 0 ? "个人" : null,
    companyCount === 1
      ? "组织"
      : companyCount > 1
        ? `组织 ${formatNumber(companyCount)}`
        : null,
  ].filter(Boolean) as string[];
  const primary =
    account.tenantBindings.find((tenant) => tenant.isPrimaryOwner) ??
    account.tenantBindings[0];

  return {
    tags: tags.length ? tags : ["未归属"],
    primaryName: primary?.tenantName ?? account.primaryTenantName,
    personalCount,
    companyCount,
  };
}

function accountMatchesTenantType(
  account: AccountOperationRecord,
  filter: TenantTypeFilter,
) {
  if (filter === "all") return true;
  const summary = accountTenantSummary(account);
  if (filter === "mixed")
    return summary.personalCount > 0 && summary.companyCount > 0;
  return account.tenantBindings.some((tenant) => tenant.tenantType === filter);
}

function accountStatusLabel(status: AccountOperationRecord["status"]) {
  if (status === "active") return "正常";
  if (status === "invited") return "待激活";
  if (status === "locked") return "已锁定";
  return "已停用";
}

/** 账号态 → 语气。取自 `.vx-account-status-pill--*`：invited 是蓝（brand）。 */
const ACCOUNT_STATUS_TONE: Record<
  AccountOperationRecord["status"],
  StatusBadgeTone
> = {
  active: "success",
  invited: "brand",
  locked: "warning",
  disabled: "neutral",
};

function accountStatusIndicator(account: AccountOperationRecord): {
  tone: AccountStatusIndicatorTone;
  label: string;
  icon: IconName;
} {
  if (account.status === "disabled") {
    return { tone: "closed", label: "已停用", icon: "x" };
  }

  if (account.status === "locked") {
    return { tone: "attention", label: "已锁定", icon: "warning" };
  }

  if (account.status === "invited") {
    return { tone: "progress", label: "待激活", icon: "clock" };
  }

  return { tone: "normal", label: "正常", icon: "check" };
}

function accountSearchText(account: AccountOperationRecord) {
  return [
    account.id,
    /* 两种形态都收：屏幕上是 `U-1649201736`，但运营多半直接粘 10 位数字。
       只收一种，另一种就搜不到。 */
    account.accountCode,
    formatPrincipalNoOr(account.accountCode, "user", ""),
    account.displayName,
    account.email,
    account.phone,
    account.status,
    account.role,
    account.primaryTenantCode,
    account.primaryTenantName,
    account.lastActiveLocation,
    ...account.tenantBindings.map(
      (tenant) =>
        `${formatPrincipalNoOr(tenant.tenantCode, "tenant", "—")} ${tenant.tenantName} ${tenant.role}`,
    ),
  ]
    .join(" ")
    .toLowerCase();
}

function AccountActionsMenu({
  account,
  busy,
  onToggleStatus,
  onForceLogout,
  onViewDetail,
}: {
  account: AccountOperationRecord;
  busy: boolean;
  onToggleStatus: (account: AccountOperationRecord) => void;
  onForceLogout: (account: AccountOperationRecord) => void;
  onViewDetail: (account: AccountOperationRecord) => void;
}) {
  const tShared = useTranslations();
  const isDisabled = account.status === "disabled";
  return (
    <div
      className="relative z-[1] inline-flex justify-self-end"
      onClick={(event) => event.stopPropagation()}
    >
      <ActionMenu
        label={`${account.displayName} 操作`}
        disabled={busy}
        items={[
          {
            id: "details",
            label: tShared("actions.viewDetail"),
            icon: "arrow-right",
            disabled: busy,
            onSelect: () => onViewDetail(account),
          },
          {
            id: "reset-password",
            label: "重置密码",
            icon: "key",
            // 凭据重置对 C 端用户（可能社交-only/无验证邮箱）需专用设计，C12 延后。
            disabled: true,
          },
          {
            /* 不在线就没有会话可吊销——按在线状态置灰（owner 2026-09-21）。
               灰的原因写进 hint：光灰着不说为什么，运营会当成按钮坏了。 */
            id: "force-logout",
            label: "强制下线",
            icon: "sign-out",
            disabled: busy || isDisabled || !account.online,
            ...(!isDisabled && !account.online
              ? { hint: "该账号当前没有活跃会话" }
              : {}),
            onSelect: () => onForceLogout(account),
          },
          {
            id: "toggle-status",
            label: isDisabled ? "恢复账号" : "停用账号",
            icon: isDisabled ? "success" : "warning",
            disabled: busy,
            onSelect: () => onToggleStatus(account),
          },
        ]}
      />
    </div>
  );
}

interface AccountRowActions {
  actionBusy: boolean;
  onToggleStatus: (account: AccountOperationRecord) => void;
  onForceLogout: (account: AccountOperationRecord) => void;
  onViewDetail: (account: AccountOperationRecord) => void;
}

/**
 * 状态标走 `StatusBadge`，语气由 `ACCOUNT_STATUS_TONE` 给。
 *
 * 租户列随 `showTenantContext` 出没——平台账号视图没有租户归属这回事。
 *
 * 账号名可点、跳详情页，与租户列表同规矩——所以跳转回调要从调用点传进来，
 * 行动作菜单里的那一个在这儿够不着。
 */
function useAccountColumns(
  showTenantContext: boolean,
  onViewDetail: (account: AccountOperationRecord) => void,
): DataTableColumn<AccountOperationRecord>[] {
  const locale = useLocale();
  const tShared = useTranslations();
  return [
    {
      id: "account",
      header: "账号",
      /* 邮箱挪去「联系方式」（owner 2026-09-21：与租户管理-成员账号同形）。 */
      cell: (account) => (
        <TableTitleCell
          icon="user"
          title={account.displayName}
          description={formatPrincipalNoOr(account.accountCode, "user", "—")}
          onTitleClick={() => onViewDetail(account)}
        />
      ),
    },
    {
      id: "contact",
      header: "联系方式",
      /* 电话在上：account.users.phone 是 NOT NULL 的强锚点，邮箱是次标识。
         与租户详情的成员表同一口径。读不到显示「—」不显示空。 */
      cell: (account) => (
        <TableTitleCell
          layout="stacked"
          title={account.phone || "—"}
          description={account.email || "—"}
        />
      ),
    },
    ...(showTenantContext
      ? [
          {
            id: "tenant",
            header: "租户",
            cell: (account: AccountOperationRecord) => {
              const summary = accountTenantSummary(account);
              return (
                <span className="inline-flex flex-col items-center gap-2xs">
                  <span className="inline-flex flex-wrap justify-center gap-2xs">
                    {summary.tags.map((tag) => (
                      <StatusBadge key={tag} tone="brand" icon={false}>
                        {tag}
                      </StatusBadge>
                    ))}
                  </span>
                  <span className="text-body-sm text-muted-foreground">
                    {summary.primaryName}
                  </span>
                </span>
              );
            },
          },
        ]
      : []),
    {
      id: "status",
      header: tShared("columns.state"),
      align: "center",
      /**
       * 账号状态与在线状态**两个平级**（owner 2026-09-21）——都是整枚 badge，
       * 不做主副。它们问的不是一回事：状态说这个人能不能进来（运营改才变），
       * 在线说他此刻在不在（自己会变）。
       *
       * 在线放在这里而不是「登录活动」列，是因为**「强制下线」按它置灰**：
       * 按钮灰了，原因必须在同一行看得见，否则运营只会觉得按钮坏了。
       */
      cell: (account) => {
        const indicator = accountStatusIndicator(account);
        return (
          <span className="inline-flex flex-col items-center gap-2xs">
            <StatusBadge
              tone={ACCOUNT_STATUS_TONE[account.status]}
              icon={indicator.icon}
            >
              {accountStatusLabel(account.status)}
            </StatusBadge>
            <StatusBadge tone={account.online ? "success" : "neutral"}>
              {account.online
                ? tShared("status.generic.online")
                : tShared("status.generic.offline")}
            </StatusBadge>
          </span>
        );
      },
    },
    {
      id: "permission",
      header: "权限",
      align: "center",
      cell: (account) => (
        <span className="inline-flex flex-col items-center gap-2xs">
          <Badge>{accountHighestRoleLabel(account)}</Badge>
          <span className="text-body-sm text-muted-foreground">
            {showTenantContext
              ? `${formatNumber(account.tenantCount)} 个租户`
              : "平台角色"}
          </span>
        </span>
      ),
    },
    {
      id: "login",
      /* 「登录活动」而不是「登录」：这一列装的是**过去**——什么时候、从哪、
         30 天几次。「此刻在不在」是状态，已并进「状态」列。 */
      header: "登录活动",
      align: "center",
      /* 地点走前端共用的 `resolveIpLocation`，与租户详情的成员表同一份。
         此前画的是 BFF 的 `lastActiveLocation`，而那个字段在 mapper 里写死
         「未知」——一枚永远写着「未知」的徽标是噪音，不是信息。 */
      cell: (account) => (
        <TableTitleCell
          layout="stacked"
          title={formatDate(account.lastActiveAt, locale)}
          description={`${resolveIpLocation(account.lastActiveIp)} · ${formatNumber(account.loginCount30d)} 次`}
        />
      ),
    },
  ];
}

export function AccountsPage({
  copy = defaultAccountsPageCopy,
  loadAccounts = fetchAccountOperations,
  showTenantContext = true,
}: {
  copy?: Partial<AccountsPageCopy>;
  loadAccounts?: () => Promise<AccountOperationRecord[]>;
  showTenantContext?: boolean;
} = {}) {
  const tShared = useTranslations();
  const tableLabels = useTableLabels();
  const pageCopy = { ...defaultAccountsPageCopy, ...copy };
  const router = useRouter();
  const [accounts, setAccounts] = useState<AccountOperationRecord[]>([]);
  const [accountsTruncated, setAccountsTruncated] = useState(false);
  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [tenantTypeFilter, setTenantTypeFilter] =
    useState<TenantTypeFilter>("all");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [onlineFilter, setOnlineFilter] = useState<OnlineFilter>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(20);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { toast } = useToast();
  const [actionBusy, setActionBusy] = useState(false);
  const [pendingAction, setPendingAction] = useState<{
    account: AccountOperationRecord;
    kind: "disable" | "enable" | "force-logout";
  } | null>(null);
  const [actionReason, setActionReason] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);

    loadAccounts()
      .then((records) => {
        if (active) {
          setAccounts(records);
          setAccountsTruncated(isListTruncated(records));
        }
      })
      .catch((error) => {
        if (active) {
          setAccounts([]);
          setAccountsTruncated(false);
          setLoadError(
            error instanceof Error ? error.message : "账号数据读取失败",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [loadAccounts]);

  function requestToggleStatus(account: AccountOperationRecord) {
    setActionReason("");
    setPendingAction({
      account,
      kind: account.status === "disabled" ? "enable" : "disable",
    });
  }
  function requestForceLogout(account: AccountOperationRecord) {
    setActionReason("");
    setPendingAction({ account, kind: "force-logout" });
  }
  function closePending() {
    if (!actionBusy) {
      setPendingAction(null);
      setActionReason("");
    }
  }
  async function confirmPending(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pendingAction) return;
    const { account, kind } = pendingAction;
    const reason = actionReason.trim() || undefined;
    setActionBusy(true);
    try {
      if (kind === "disable") {
        await disableAccount(account.id, reason);
        toast({ tone: "success", title: "已停用账号" });
      } else if (kind === "enable") {
        await enableAccount(account.id, reason);
        toast({ tone: "success", title: "已恢复账号" });
      } else {
        const result = await forceLogoutAccount(account.id, reason);
        toast({
          tone: "success",
          title: "已强制下线",
          description: `已吊销 ${result.revoked} 个会话。`,
        });
      }
      const refreshed = await loadAccounts();
      setAccounts(refreshed);
      setAccountsTruncated(isListTruncated(refreshed));
      setPendingAction(null);
      setActionReason("");
    } catch (error) {
      toast({
        tone: "danger",
        title: "操作失败",
        ...(error instanceof Error && error.message
          ? { description: error.message }
          : {}),
      });
    } finally {
      setActionBusy(false);
    }
  }
  const accountActions: AccountRowActions = {
    actionBusy,
    onToggleStatus: requestToggleStatus,
    onForceLogout: requestForceLogout,
    /* 详情路由参数用**面向用户的账号编码**（user_no），不是 UUID——
       地址栏是可见面，与租户详情同规矩。 */
    onViewDetail: (account) =>
      router.push(`/accounts/${encodeURIComponent(account.accountCode)}`),
  };

  const accountColumns = useAccountColumns(
    showTenantContext,
    accountActions.onViewDetail,
  );

  const filteredAccounts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return accounts.filter((account) => {
      if (statusFilter !== "all" && account.status !== statusFilter)
        return false;
      if (
        onlineFilter !== "all" &&
        account.online !== (onlineFilter === "online")
      )
        return false;
      if (
        showTenantContext &&
        !accountMatchesTenantType(account, tenantTypeFilter)
      )
        return false;
      if (roleFilter !== "all" && accountRoleGroup(account) !== roleFilter)
        return false;
      if (
        normalizedQuery &&
        !accountSearchText(account).includes(normalizedQuery)
      )
        return false;
      return true;
    });
  }, [
    accounts,
    onlineFilter,
    query,
    roleFilter,
    showTenantContext,
    statusFilter,
    tenantTypeFilter,
  ]);

  /* 角色筛选的选项：这批账号里**真实出现过**的分组，按固定次第排。
     `accountRoleGroup` 把开放集的角色名收成三组，所以这里只会出现那三个值——
     但出现哪几个由数据说了算，空的那组不占一行。 */
  const roleFilterOptions = useMemo(() => {
    const present = new Set(accounts.map(accountRoleGroup));
    return ROLE_FILTER_ORDER.filter((option) => present.has(option.value));
  }, [accounts]);

  const pageCount = Math.max(1, Math.ceil(filteredAccounts.length / pageSize));
  const visibleAccounts = filteredAccounts.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  const activeAccounts = accounts.filter(
    (account) => account.status === "active",
  ).length;
  const invitedAccounts = accounts.filter(
    (account) => account.status === "invited",
  ).length;
  const lockedAccounts = accounts.filter(
    (account) => account.status === "locked",
  ).length;
  const disabledAccounts = accounts.filter(
    (account) => account.status === "disabled",
  ).length;

  useEffect(() => {
    setCurrentPage(1);
  }, [pageSize, query, roleFilter, statusFilter, tenantTypeFilter]);

  function handleReset() {
    setQuery("");
    setStatusFilter("all");
    setOnlineFilter("all");
    setTenantTypeFilter("all");
    setRoleFilter("all");
  }

  return (
    <>
      <ListPageTemplate
        className="w-full "
        header={
          <PageHeader
            icon="user"
            eyebrow={pageCopy.eyebrow}
            title={pageCopy.title}
            description={pageCopy.description}
          />
        }
        summary={
          <>
            {" "}
            <MetricGrid
              loading={loading}
              aria-label={pageCopy.summaryAriaLabel}
              items={[
                {
                  id: "total",
                  help: "当前列表加载到的全部账号数，不区分状态。",
                  icon: "user",
                  label: "账号总数",
                  value: formatNumber(accounts.length),
                  tags: [`活跃 ${formatNumber(activeAccounts)}`],
                  // 身份类图标原本走 `--identity-icon` 修饰去色（gray-400）：这张卡是
                  // 基数不是状态，不该跟着染品牌色。neutral 是 DS 里表达"刻意去色"的档。
                  tone: "neutral",
                },
                {
                  id: "invited",
                  help: "已发出邀请但本人尚未激活的账号（状态 invited）。",
                  icon: "clock",
                  label: "待激活",
                  value: formatNumber(invitedAccounts),
                  tags: ["邀请中"],
                  tone: "warning",
                },
                {
                  id: "locked",
                  help: "因风控或连续登录失败被锁定的账号（状态 locked）。",
                  icon: "warning",
                  label: "已锁定",
                  value: formatNumber(lockedAccounts),
                  tags: ["临时锁定"],
                  tone: lockedAccounts ? "warning" : "success",
                },
                {
                  id: "disabled",
                  help: "被管理员停用、无法登录的账号（状态 disabled）。",
                  icon: "x",
                  label: "已停用",
                  value: formatNumber(disabledAccounts),
                  tags: ["长期未用"],
                  tone: disabledAccounts ? "danger" : "success",
                },
              ]}
            />
            {accountsTruncated ? (
              <Banner
                tone="warning"
                title="当前账号列表可能未展示全部数据"
                description="本次加载已达到单次读取上限（500 条），如未看到目标账号，请尝试缩小筛选范围（如按状态、权限等）重新查询。"
              />
            ) : null}
          </>
        }
        filters={
          <FilterBar
            view="list"
            onViewChange={() => {}}
            cardsDisabledReason={tShared("common.cardsRetired")}
            count={formatNumber(filteredAccounts.length)}
            search={
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={pageCopy.searchPlaceholder}
                className="min-w-media-2xl grow basis-0 max-w-panel-sm"
                aria-label={pageCopy.searchAriaLabel}
              />
            }
            onReset={handleReset}
            actions={
              <>
                <ActionButton variant="outline" icon="plus" disabled>
                  {pageCopy.createActionLabel}
                </ActionButton>
              </>
            }
          >
            {/* 顺序是 owner 定的（2026-09-21）：全部租户 | 登录状态 | 全部状态 |
                全部权限。从「他属于哪儿」收到「他此刻怎样」，再到「他能干什么」。 */}
            <>
              {showTenantContext ? (
                <NativeSelect
                  wrapperClassName="w-fit basis-media-xl"
                  value={tenantTypeFilter}
                  onChange={(event) =>
                    setTenantTypeFilter(event.target.value as TenantTypeFilter)
                  }
                  aria-label={pageCopy.tenantTypeAriaLabel}
                >
                  <option value="all">全部租户</option>
                  <option value="individual">个人</option>
                  <option value="company">组织</option>
                  <option value="mixed">个人+组织</option>
                </NativeSelect>
              ) : null}
              <NativeSelect
                wrapperClassName="w-fit basis-media-xl"
                value={onlineFilter}
                onChange={(event) =>
                  setOnlineFilter(event.target.value as OnlineFilter)
                }
                aria-label={tShared("filters.allLoginStates")}
              >
                <option value="all">{tShared("filters.allLoginStates")}</option>
                <option value="online">
                  {tShared("status.generic.online")}
                </option>
                <option value="offline">
                  {tShared("status.generic.offline")}
                </option>
              </NativeSelect>
              <NativeSelect
                wrapperClassName="w-fit basis-media-xl"
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value as StatusFilter)
                }
                aria-label={pageCopy.statusAriaLabel}
              >
                <option value="all">{tShared("filters.allStates")}</option>
                <option value="active">
                  {tShared("status.generic.normal")}
                </option>
                <option value="invited">待激活</option>
                <option value="locked">已锁定</option>
                <option value="disabled">已停用</option>
              </NativeSelect>
              {/* 选项从**当前这批账号**里派生，不写死（owner 2026-09-21：
                  「需要补齐角色，现在不全」）。原来钉死 Owner/Admin/Member 三档，
                  而租户侧的角色名是开放集——任何第四种角色都选不中。
                  派生的口径与 `accountRoleGroup` 同源，所以选了必有结果。 */}
              <NativeSelect
                wrapperClassName="w-fit basis-media-xl"
                value={roleFilter}
                onChange={(event) =>
                  setRoleFilter(event.target.value as RoleFilter)
                }
                aria-label={pageCopy.roleAriaLabel}
              >
                <option value="all">全部权限</option>
                {roleFilterOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </NativeSelect>
            </>
          </FilterBar>
        }
        table={
          <section
            className="grid min-w-0 max-w-full gap-xs"
            aria-label={pageCopy.directoryAriaLabel}
          >
            {/* 列表态的加载由 DataTable 出骨架行，卡片态没有骨架，仍留这行提示。 */}

            <DataTable
              labels={tableLabels}
              columns={accountColumns}
              rows={visibleAccounts}
              rowKey={(account) => account.id}
              loading={loading}
              indexStart={(Math.min(currentPage, pageCount) - 1) * pageSize + 1}
              selectedKeys={[...selectedAccountIds]}
              onSelectionChange={(keys) => setSelectedAccountIds(new Set(keys))}
              rowActions={(account) => (
                <AccountActionsMenu
                  account={account}
                  busy={accountActions.actionBusy}
                  onToggleStatus={accountActions.onToggleStatus}
                  onForceLogout={accountActions.onForceLogout}
                  onViewDetail={accountActions.onViewDetail}
                />
              )}
              empty={
                <EmptyState
                  title={loadError ? "账号数据读取失败" : pageCopy.emptyTitle}
                  description={loadError ?? pageCopy.emptyDescription}
                  action={
                    <ActionButton
                      variant="outline"
                      icon="x"
                      onClick={handleReset}
                    >
                      {tShared("common.clearFilters")}
                    </ActionButton>
                  }
                />
              }
            />
          </section>
        }
        footer={
          <ListPagination
            currentPage={Math.min(currentPage, pageCount)}
            pageCount={pageCount}
            total={filteredAccounts.length}
            pageSize={pageSize}
            onPageSizeChange={setPageSize}
            onPageChange={(page) =>
              setCurrentPage(Math.min(Math.max(page, 1), pageCount))
            }
          />
        }
      />
      {pendingAction ? (
        <DialogForm
          open
          title={
            pendingAction.kind === "disable"
              ? "停用账号"
              : pendingAction.kind === "enable"
                ? "恢复账号"
                : "强制下线"
          }
          description={
            pendingAction.kind === "disable"
              ? `将停用 ${pendingAction.account.displayName}（${pendingAction.account.email}）：封禁全部登录路径并吊销其所有会话，可稍后恢复。`
              : pendingAction.kind === "enable"
                ? `将恢复 ${pendingAction.account.displayName} 的账号为正常状态。`
                : `将吊销 ${pendingAction.account.displayName} 的全部活跃会话，该用户需重新登录。`
          }
          submitLabel={
            pendingAction.kind === "disable"
              ? "确认停用"
              : pendingAction.kind === "enable"
                ? "确认恢复"
                : "确认下线"
          }
          danger={pendingAction.kind === "disable"}
          submitting={actionBusy}
          onOpenChange={(open) => {
            if (!open) closePending();
          }}
          onSubmit={(event) => void confirmPending(event)}
          cancelLabel={tShared("actions.cancel")}
        >
          <Field>
            <FieldLabel htmlFor="accountspage-field">备注（可选）</FieldLabel>
            <Textarea
              id="accountspage-field"
              value={actionReason}
              onChange={(e) => setActionReason(e.target.value)}
              rows={3}
              placeholder="记录处置原因，将写入审计日志"
              maxLength={512}
            />
          </Field>
        </DialogForm>
      ) : null}
    </>
  );
}
