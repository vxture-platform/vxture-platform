"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  ActionButton,
  ActionMenu,
  Badge,
  Banner,
  DataTable,
  DialogForm,
  EmptyState,
  FilterBar,
  Input,
  Label,
  ListCardGrid,
  ListPageTemplate,
  MetricGrid,
  MetricListCard,
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

type ViewMode = "list" | "cards";
type StatusFilter = "all" | AccountOperationRecord["status"];
type TenantTypeFilter = "all" | "company" | "individual" | "mixed";
type RoleFilter = "all" | "owner" | "admin" | "member";
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
  title: "账号体系",
  description:
    "平台运营侧跨租户检索账号、识别安全状态、处理账号启停与登录问题。",
  summaryAriaLabel: "账号运营统计",
  toolbarAriaLabel: "账号筛选",
  directoryAriaLabel: "账号清单",
  searchPlaceholder: "搜索账号、邮箱、租户、权限",
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
    account.accountCode,
    account.displayName,
    account.email,
    account.phone,
    account.status,
    account.role,
    account.primaryTenantCode,
    account.primaryTenantName,
    account.lastActiveLocation,
    ...account.tenantBindings.map(
      (tenant) => `${tenant.tenantCode} ${tenant.tenantName} ${tenant.role}`,
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
}: {
  account: AccountOperationRecord;
  busy: boolean;
  onToggleStatus: (account: AccountOperationRecord) => void;
  onForceLogout: (account: AccountOperationRecord) => void;
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
            disabled: true,
          },
          {
            id: "reset-password",
            label: "重置密码",
            icon: "key",
            // 凭据重置对 C 端用户（可能社交-only/无验证邮箱）需专用设计，C12 延后。
            disabled: true,
          },
          {
            id: "force-logout",
            label: "强制下线",
            icon: "sign-out",
            disabled: busy || isDisabled,
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
}

/**
 * 状态标走 `StatusBadge`，语气由 `ACCOUNT_STATUS_TONE` 给。
 *
 * 租户列随 `showTenantContext` 出没——平台账号视图没有租户归属这回事。
 */
function useAccountColumns(
  showTenantContext: boolean,
): DataTableColumn<AccountOperationRecord>[] {
  const locale = useLocale();
  const tShared = useTranslations();
  return [
    {
      id: "account",
      header: "账号",
      cell: (account) => (
        <TableTitleCell
          icon="user"
          title={account.displayName}
          description={`${account.accountCode} · ${account.email}`}
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
                <TableTitleCell
                  title={
                    <span className="inline-flex flex-wrap gap-2xs">
                      {summary.tags.map((tag) => (
                        <StatusBadge key={tag} tone="brand" icon={false}>
                          {tag}
                        </StatusBadge>
                      ))}
                    </span>
                  }
                  description={summary.primaryName}
                />
              );
            },
          },
        ]
      : []),
    {
      id: "status",
      header: tShared("columns.state"),
      align: "center",
      cell: (account) => {
        const indicator = accountStatusIndicator(account);
        return (
          <StatusBadge
            tone={ACCOUNT_STATUS_TONE[account.status]}
            icon={indicator.icon}
          >
            {accountStatusLabel(account.status)}
          </StatusBadge>
        );
      },
    },
    {
      id: "permission",
      header: "权限",
      align: "center",
      cell: (account) => (
        <TableTitleCell
          title={<Badge>{accountHighestRoleLabel(account)}</Badge>}
          description={
            showTenantContext
              ? `${formatNumber(account.tenantCount)} 个租户`
              : "平台角色"
          }
        />
      ),
    },
    {
      id: "login",
      header: "登录",
      align: "center",
      cell: (account) => (
        <TableTitleCell
          title={<Badge>{account.lastActiveLocation}</Badge>}
          description={`${formatDate(account.lastActiveAt, locale)} · ${formatNumber(account.loginCount30d)} 次`}
        />
      ),
    },
  ];
}

function AccountCards({
  accounts,
  showTenantContext,
  actions,
}: {
  accounts: AccountOperationRecord[];
  showTenantContext: boolean;
  actions: AccountRowActions;
}) {
  const locale = useLocale();
  return (
    <ListCardGrid aria-label="账号卡片">
      {accounts.map((account) => (
        <MetricListCard
          key={account.id}
          icon="user"
          title={account.displayName}
          description={`${account.accountCode} · ${account.email}`}
          tone={ACCOUNT_STATUS_TONE[account.status]}
          actions={
            <AccountActionsMenu
              account={account}
              busy={actions.actionBusy}
              onToggleStatus={actions.onToggleStatus}
              onForceLogout={actions.onForceLogout}
            />
          }
          badges={
            <>
              <StatusBadge tone={ACCOUNT_STATUS_TONE[account.status]}>
                {accountStatusLabel(account.status)}
              </StatusBadge>
              {showTenantContext
                ? accountTenantSummary(account).tags.map((tag) => (
                    <StatusBadge key={tag} tone="brand" icon={false}>
                      {tag}
                    </StatusBadge>
                  ))
                : null}
              <Badge>{accountHighestRoleLabel(account)}</Badge>
            </>
          }
          metrics={[
            showTenantContext
              ? {
                  key: "tenants",
                  value: formatNumber(account.tenantCount),
                  label: "租户",
                }
              : {
                  key: "role",
                  value: accountHighestRoleLabel(account),
                  label: "平台角色",
                },
            {
              key: "logins",
              value: formatNumber(account.loginCount30d),
              label: "30日登录",
            },
            {
              key: "location",
              value: account.lastActiveLocation,
              label: "地址",
            },
          ]}
          footer={
            <>
              <span>
                {showTenantContext
                  ? accountTenantSummary(account).primaryName
                  : "平台用户"}
              </span>
              <strong>{formatDate(account.lastActiveAt, locale)}</strong>
            </>
          }
        />
      ))}
    </ListCardGrid>
  );
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
  const pageCopy = { ...defaultAccountsPageCopy, ...copy };
  const [accounts, setAccounts] = useState<AccountOperationRecord[]>([]);
  const [accountsTruncated, setAccountsTruncated] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [tenantTypeFilter, setTenantTypeFilter] =
    useState<TenantTypeFilter>("all");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
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
  };

  const accountColumns = useAccountColumns(showTenantContext);

  const filteredAccounts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return accounts.filter((account) => {
      if (statusFilter !== "all" && account.status !== statusFilter)
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
    query,
    roleFilter,
    showTenantContext,
    statusFilter,
    tenantTypeFilter,
  ]);

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
  }, [pageSize, query, roleFilter, statusFilter, tenantTypeFilter, viewMode]);

  function handleReset() {
    setQuery("");
    setStatusFilter("all");
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
            view={viewMode}
            onViewChange={setViewMode}
            cardsDisabledReason={tShared("common.cardsRetired")}
            count={formatNumber(filteredAccounts.length)}
            search={
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={pageCopy.searchPlaceholder}
                className="grow basis-media-3xl max-w-panel-sm"
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
            <>
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
                value={roleFilter}
                onChange={(event) =>
                  setRoleFilter(event.target.value as RoleFilter)
                }
                aria-label={pageCopy.roleAriaLabel}
              >
                <option value="all">全部权限</option>
                <option value="owner">Owner</option>
                <option value="admin">Admin</option>
                <option value="member">Member</option>
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
            {loading && viewMode === "cards" ? (
              <header className="flex min-h-0 items-center justify-end gap-sm text-body-sm font-normal text-muted-foreground">
                <span>{tShared("common.loading")}</span>
              </header>
            ) : null}

            {viewMode === "list" ? (
              <DataTable
                columns={accountColumns}
                rows={visibleAccounts}
                rowKey={(account) => account.id}
                loading={loading}
                indexStart={
                  (Math.min(currentPage, pageCount) - 1) * pageSize + 1
                }
                selectedKeys={[...selectedAccountIds]}
                onSelectionChange={(keys) =>
                  setSelectedAccountIds(new Set(keys))
                }
                rowActions={(account) => (
                  <AccountActionsMenu
                    account={account}
                    busy={accountActions.actionBusy}
                    onToggleStatus={accountActions.onToggleStatus}
                    onForceLogout={accountActions.onForceLogout}
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
            ) : visibleAccounts.length ? (
              <AccountCards
                accounts={visibleAccounts}
                showTenantContext={showTenantContext}
                actions={accountActions}
              />
            ) : (
              <EmptyState
                title={loading ? pageCopy.loadingTitle : pageCopy.emptyTitle}
                description={
                  loading
                    ? pageCopy.loadingDescription
                    : (loadError ?? pageCopy.emptyDescription)
                }
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
            )}
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
        >
          <Label>
            备注（可选）
            <Textarea
              value={actionReason}
              onChange={(e) => setActionReason(e.target.value)}
              rows={3}
              placeholder="记录处置原因，将写入审计日志"
              maxLength={512}
            />
          </Label>
        </DialogForm>
      ) : null}
    </>
  );
}
