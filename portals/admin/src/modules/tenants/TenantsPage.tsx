"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ActionButton,
  ActionMenu,
  Banner,
  Badge,
  DataTable,
  EmptyState,
  FilterBar,
  Input,
  ListCardGrid,
  ListPageTemplate,
  MetricGrid,
  MetricListCard,
  NativeSelect,
  StatusBadge,
  TableTitleCell,
  useToast,
} from "@vxture/design-system";
import type { DataTableColumn } from "@vxture/design-system";
import { ListPagination } from "@/modules/shared/ListPagination";
import {
  fetchTenantOperationsStrict,
  resumeTenant,
  suspendTenant,
} from "@/api/admin-bff";
import type { TenantOperationRecord } from "@/entities/console";
import { isListTruncated } from "@/lib/list-truncation";
import { PageHeader } from "@/modules/shared/PageHeader";
import { type PageSize } from "@/modules/shared/PageSizePicker";
import { resolveStatusTone } from "@vxture-platform/shared";
import {
  TENANT_RISK_TONE,
  TENANT_STATUS_TONE,
  VERIFICATION_TONE,
  formatDate,
  formatNumber,
  normalizeTenantRiskLevel,
  riskLabel,
  statusLabel,
  tenantRiskOptions,
  tenantSearchText,
  typeLabel,
  verifiedLabel,
} from "./tenant-utils";
import { useStepUp, isStepUpCancelled } from "@/providers/StepUpProvider";

type ViewMode = "list" | "cards";
type StatusFilter = "all" | TenantOperationRecord["status"];
type TypeFilter = "all" | TenantOperationRecord["tenantType"];
type RiskFilter = "all" | TenantOperationRecord["riskLevel"];
type VerificationFilter = "all" | TenantOperationRecord["verifiedStatus"];

function TenantActionsMenu({
  tenant,
  busy,
  onToggleStatus,
}: {
  tenant: TenantOperationRecord;
  busy: boolean;
  onToggleStatus: (tenant: TenantOperationRecord) => void;
}) {
  const router = useRouter();
  const isSuspended = tenant.status === "suspended";

  return (
    <div
      className="vx-tenant-actions"
      onClick={(event) => event.stopPropagation()}
    >
      <ActionMenu
        label={`${tenant.displayName} 操作`}
        items={[
          {
            id: "details",
            label: "查看详情",
            icon: "arrow-right",
            onSelect: () =>
              router.push(`/tenants/${encodeURIComponent(tenant.id)}`),
          },
          {
            id: "edit",
            label: "编辑资料",
            icon: "edit",
            disabled: true,
          },
          {
            id: "subscription",
            label: "订阅处理",
            icon: "star",
            disabled: true,
          },
          {
            // 暂停 → suspendTenant / 已暂停恢复 → resumeTenant；已注销租户无切换语义，置灰。
            id: "toggle-status",
            label: isSuspended ? "恢复租户" : "暂停租户",
            icon: isSuspended ? "success" : "warning",
            disabled: busy || tenant.status === "cancelled",
            onSelect: () => onToggleStatus(tenant),
          },
        ]}
      />
    </div>
  );
}

/**
 * 状态标走 `StatusBadge`，语气按值域各自取表（`tenant-tone.ts`）——这一族此前
 * 是 12 个值域共用一个 CSS 前缀，见那个文件的文件头。
 */
function useTenantColumns(): DataTableColumn<TenantOperationRecord>[] {
  const router = useRouter();

  return [
    {
      id: "tenant",
      header: "租户",
      cell: (tenant) => (
        <TableTitleCell
          icon={tenant.tenantType === "company" ? "buildings" : "user"}
          title={tenant.displayName}
          description={`${tenant.tenantCode} · ${tenant.region}`}
          onTitleClick={() =>
            router.push(`/tenants/${encodeURIComponent(tenant.id)}`)
          }
        />
      ),
    },
    {
      id: "member",
      header: "成员",
      align: "right",
      cell: (tenant) => formatNumber(tenant.memberCount),
    },
    {
      id: "status",
      header: "状态",
      align: "center",
      /* 两枚标各说各的一件事：租户态、认证态。图标交给各自的语气自动配——
         此前这里借了 `tenantStatusIndicator` 的图标，而那是个**复合**信号
         （状态与认证一起判），于是一枚标里语气来自 status、文字来自 status、
         图标却在替认证说话：绿底「正常」配一个时钟，读起来像"正常但在等"
         （2026-08-06 登录态走查抓到）。认证态就在旁边，不必让它挤进来。 */
      cell: (tenant) => (
        <span className="inline-flex flex-wrap items-center justify-center gap-2xs">
          <StatusBadge tone={TENANT_STATUS_TONE[tenant.status]}>
            {statusLabel(tenant.status)}
          </StatusBadge>
          <StatusBadge tone={VERIFICATION_TONE[tenant.verifiedStatus]}>
            {verifiedLabel(tenant.verifiedStatus)}
          </StatusBadge>
        </span>
      ),
    },
    {
      id: "subscription",
      header: "订阅",
      align: "center",
      cell: (tenant) => (
        <TableTitleCell
          title={
            <Badge>
              {formatNumber(
                tenant.subscriptions.length || tenant.subscriptionCount,
              )}{" "}
              产品
            </Badge>
          }
          description={`本月：¥ ${formatNumber(tenant.monthlyRevenue)} 元`}
        />
      ),
    },
    {
      id: "service",
      header: "服务",
      align: "center",
      cell: (tenant) => {
        const riskLevel = normalizeTenantRiskLevel(tenant.riskLevel);
        const ticketTotal = Math.max(
          tenant.tickets.length,
          tenant.ticketOpenCount,
        );
        return (
          <TableTitleCell
            title={
              <StatusBadge tone={TENANT_RISK_TONE[riskLevel]}>
                {riskLabel(riskLevel)}
              </StatusBadge>
            }
            description={`总工单 ${formatNumber(ticketTotal)} | 待处理 ${formatNumber(tenant.ticketOpenCount)}`}
          />
        );
      },
    },
  ];
}

function TenantCards({
  tenants,
  actionBusy,
  onToggleStatus,
}: {
  tenants: TenantOperationRecord[];
  actionBusy: boolean;
  onToggleStatus: (tenant: TenantOperationRecord) => void;
}) {
  const router = useRouter();

  return (
    /* 卡片视图改用 DS 的 MetricListCard + ListCardGrid。原实现是一套手搓的
     * `vx-tenant-directory-card` 栅格（跨 4 个业务域抄了 17 份），卡内的三列读数、
     * 顶缘色条、截断规则各页各写一遍。样式文件保留不动——里面的结构已被提炼进
     * DS，类名只是不再被引用。 */
    <ListCardGrid aria-label="租户卡片">
      {tenants.map((tenant) => {
        const riskLevel = normalizeTenantRiskLevel(tenant.riskLevel);
        return (
          <MetricListCard
            key={tenant.id}
            icon={tenant.tenantType === "company" ? "buildings" : "user"}
            title={tenant.displayName}
            description={`${tenant.tenantCode} · ${typeLabel(tenant.tenantType)}`}
            /* 卡的语气取风险档：一屏卡片里最该先被看见的就是高风险那几张。
             * 风险档目前没有共享值域，映射留在 admin 侧（见 status-tone 的边界）。 */
            tone={TENANT_RISK_TONE[riskLevel]}
            onClick={() =>
              router.push(`/tenants/${encodeURIComponent(tenant.id)}`)
            }
            actions={
              <TenantActionsMenu
                tenant={tenant}
                busy={actionBusy}
                onToggleStatus={onToggleStatus}
              />
            }
            badges={
              <>
                <StatusBadge
                  tone={resolveStatusTone(TENANT_STATUS_TONE, tenant.status)}
                >
                  {statusLabel(tenant.status)}
                </StatusBadge>
                <StatusBadge
                  tone={resolveStatusTone(
                    VERIFICATION_TONE,
                    tenant.verifiedStatus,
                  )}
                >
                  {verifiedLabel(tenant.verifiedStatus)}
                </StatusBadge>
                <StatusBadge tone={TENANT_RISK_TONE[riskLevel]}>
                  {riskLabel(riskLevel)}
                </StatusBadge>
              </>
            }
            metrics={[
              {
                key: "subscriptions",
                value: formatNumber(tenant.subscriptionCount),
                label: "订阅",
              },
              {
                key: "members",
                value: formatNumber(tenant.memberCount),
                label: "用户",
              },
              {
                key: "tokens",
                value: formatNumber(tenant.tokenUsed),
                label: "Token",
              },
            ]}
            footer={
              <>
                <span className="truncate">{tenant.industry}</span>
                <span className="shrink-0">
                  {tenant.ticketOpenCount} 工单 ·{" "}
                  {formatDate(tenant.lastActiveAt)}
                </span>
              </>
            }
          />
        );
      })}
    </ListCardGrid>
  );
}

export function TenantsPage() {
  const { toast } = useToast();
  const { runWithStepUp } = useStepUp();
  const [tenants, setTenants] = useState<TenantOperationRecord[]>([]);
  const [tenantsTruncated, setTenantsTruncated] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [selectedTenantIds, setSelectedTenantIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [riskFilter, setRiskFilter] = useState<RiskFilter>("all");
  const [verificationFilter, setVerificationFilter] =
    useState<VerificationFilter>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(20);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadTenants = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const records = await fetchTenantOperationsStrict();
      setTenants(records);
      setTenantsTruncated(isListTruncated(records));
      setLoadError(null);
    } catch (error) {
      setTenants([]);
      setTenantsTruncated(false);
      setLoadError(error instanceof Error ? error.message : "租户数据读取失败");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTenants();
  }, [loadTenants]);

  async function handleToggleTenantStatus(tenant: TenantOperationRecord) {
    if (actionBusy) return;
    const resuming = tenant.status === "suspended";
    setActionBusy(true);
    try {
      await runWithStepUp(() =>
        resuming ? resumeTenant(tenant.id) : suspendTenant(tenant.id),
      );
      await loadTenants(true);
      toast({
        tone: "success",
        title: resuming ? "已恢复租户" : "已暂停租户",
        description: `${tenant.displayName} ${resuming ? "已恢复为正常状态。" : "已暂停。"}`,
      });
    } catch (error) {
      if (isStepUpCancelled(error)) return;
      toast({
        tone: "danger",
        title: "操作失败",
        description:
          error instanceof Error
            ? error.message
            : "无法更新租户状态，请稍后重试。",
      });
    } finally {
      setActionBusy(false);
    }
  }

  const tenantColumns = useTenantColumns();

  const filteredTenants = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return tenants.filter((tenant) => {
      if (statusFilter !== "all" && tenant.status !== statusFilter)
        return false;
      if (typeFilter !== "all" && tenant.tenantType !== typeFilter)
        return false;
      if (riskFilter !== "all" && tenant.riskLevel !== riskFilter) return false;
      if (
        verificationFilter !== "all" &&
        tenant.verifiedStatus !== verificationFilter
      )
        return false;
      if (
        normalizedQuery &&
        !tenantSearchText(tenant).includes(normalizedQuery)
      )
        return false;
      return true;
    });
  }, [
    query,
    riskFilter,
    statusFilter,
    tenants,
    typeFilter,
    verificationFilter,
  ]);

  const pageCount = Math.max(1, Math.ceil(filteredTenants.length / pageSize));
  const visibleTenants = filteredTenants.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  const individualTenants = tenants.filter(
    (tenant) => tenant.tenantType === "individual",
  ).length;
  const companyTenants = tenants.filter(
    (tenant) => tenant.tenantType === "company",
  ).length;
  const pendingVerifications = tenants.filter(
    (tenant) => tenant.verifiedStatus === "pending",
  ).length;
  const pendingIndividualVerifications = tenants.filter(
    (tenant) =>
      tenant.verifiedStatus === "pending" && tenant.tenantType === "individual",
  ).length;
  const pendingCompanyVerifications = tenants.filter(
    (tenant) =>
      tenant.verifiedStatus === "pending" && tenant.tenantType === "company",
  ).length;
  const trialProductTenants = tenants.filter(
    (tenant) => tenant.subscriptionCount > 0 && tenant.monthlyRevenue <= 0,
  ).length;
  const riskTenants = tenants.filter(
    (tenant) => normalizeTenantRiskLevel(tenant.riskLevel) !== "normal",
  ).length;

  useEffect(() => {
    setCurrentPage(1);
  }, [
    pageSize,
    query,
    riskFilter,
    statusFilter,
    typeFilter,
    verificationFilter,
    viewMode,
  ]);

  function handleReset() {
    setQuery("");
    setStatusFilter("all");
    setTypeFilter("all");
    setRiskFilter("all");
    setVerificationFilter("all");
  }

  return (
    <>
      <ListPageTemplate
        className="vx-tenant-management-page vx-tenant-operations-page"
        header={
          <PageHeader
            icon="buildings"
            eyebrow="租户账号"
            title="租户信息"
            description="平台运营侧统一检索租户、识别风险、处理订阅和进入单租户管理。"
          />
        }
        summary={
          <>
            {" "}
            <MetricGrid
              loading={loading}
              aria-label="租户运营统计"
              items={[
                {
                  id: "total",
                  help: "当前筛选条件下的租户数。",
                  icon: "buildings",
                  label: "租户总数",
                  value: formatNumber(tenants.length),
                  tags: [
                    `个人 ${formatNumber(individualTenants)}`,
                    `组织 ${formatNumber(companyTenants)}`,
                  ],
                },
                {
                  id: "pending-verification",
                  help: "提交了组织认证、尚未审核的租户。",
                  icon: "medal",
                  label: "认证待审",
                  value: formatNumber(pendingVerifications),
                  tags: [
                    `个人 ${formatNumber(pendingIndividualVerifications)}`,
                    `组织 ${formatNumber(pendingCompanyVerifications)}`,
                  ],
                  tone: "warning",
                },
                {
                  id: "trial",
                  help: "有订阅但月收入为零的租户。",
                  icon: "star",
                  label: "试用租户",
                  value: formatNumber(trialProductTenants),
                  tags: ["未付费"],
                  tone: "warning",
                },
                {
                  id: "risk",
                  help: "风险等级非正常的租户。",
                  icon: "warning",
                  label: "风险租户",
                  value: formatNumber(riskTenants),
                  tags: ["需跟进"],
                  tone: riskTenants ? "danger" : "success",
                },
              ]}
            />
            {tenantsTruncated ? (
              <Banner
                tone="warning"
                title="当前租户列表可能未展示全部数据"
                description="本次加载已达到单次读取上限（500 条），如未看到目标租户，请尝试缩小筛选范围（如按状态、认证情况等）重新查询。"
              />
            ) : null}
          </>
        }
        filters={
          <FilterBar
            view={viewMode}
            onViewChange={setViewMode}
            cardsDisabledReason="卡片视图已停用：列表视图提供选择、排序、分页与跨页批量，运营台的清单是拿来扫读和对比的。"
            count={formatNumber(filteredTenants.length)}
            aria-label="租户筛选"
            search={
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索租户、编码、联系人、产品"
                className="vx-tenant-search"
                aria-label="搜索租户"
              />
            }
            onReset={handleReset}
            actions={
              <>
                <ActionButton variant="outline" icon="plus" disabled>
                  新建租户
                </ActionButton>
              </>
            }
          >
            <div className="vx-tenant-filters">
              <NativeSelect
                className="vx-input vx-tenant-select"
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value as StatusFilter)
                }
                aria-label="租户状态"
              >
                <option value="all">全部状态</option>
                <option value="active">正常</option>
                <option value="trial">试用</option>
                <option value="suspended">暂停</option>
                <option value="cancelled">注销</option>
              </NativeSelect>
              <NativeSelect
                className="vx-input vx-tenant-select"
                value={typeFilter}
                onChange={(event) =>
                  setTypeFilter(event.target.value as TypeFilter)
                }
                aria-label="租户类型"
              >
                <option value="all">全部类型</option>
                <option value="company">企业租户</option>
                <option value="individual">个人租户</option>
              </NativeSelect>
              <NativeSelect
                className="vx-input vx-tenant-select"
                value={verificationFilter}
                onChange={(event) =>
                  setVerificationFilter(
                    event.target.value as VerificationFilter,
                  )
                }
                aria-label="认证状态"
              >
                <option value="all">全部认证</option>
                <option value="verified">已认证</option>
                <option value="pending">待审核</option>
                <option value="unverified">未认证</option>
                <option value="rejected">已驳回</option>
              </NativeSelect>
              <NativeSelect
                className="vx-input vx-tenant-select"
                value={riskFilter}
                onChange={(event) =>
                  setRiskFilter(event.target.value as RiskFilter)
                }
                aria-label="风险等级"
              >
                <option value="all">全部风险</option>
                {tenantRiskOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </FilterBar>
        }
        table={
          <section className="vx-tenant-directory" aria-label="租户清单">
            {/* 列表态的加载由 DataTable 出骨架行，卡片态没有骨架，仍留这行提示。 */}
            {loading && viewMode === "cards" ? (
              <header className="vx-tenant-directory__header">
                <span>读取中</span>
              </header>
            ) : null}

            {viewMode === "list" ? (
              <DataTable
                columns={tenantColumns}
                rows={visibleTenants}
                rowKey={(tenant) => tenant.id}
                loading={loading}
                indexStart={
                  (Math.min(currentPage, pageCount) - 1) * pageSize + 1
                }
                selectedKeys={[...selectedTenantIds]}
                onSelectionChange={(keys) =>
                  setSelectedTenantIds(new Set(keys))
                }
                rowActions={(tenant) => (
                  <TenantActionsMenu
                    tenant={tenant}
                    busy={actionBusy}
                    onToggleStatus={handleToggleTenantStatus}
                  />
                )}
                empty={
                  <EmptyState
                    title={loadError ? "租户数据读取失败" : "没有匹配的租户"}
                    description={loadError ?? "清空筛选条件后可查看全部租户。"}
                    action={
                      <ActionButton
                        variant="outline"
                        icon="x"
                        onClick={handleReset}
                      >
                        清空筛选
                      </ActionButton>
                    }
                  />
                }
              />
            ) : visibleTenants.length ? (
              <TenantCards
                tenants={visibleTenants}
                actionBusy={actionBusy}
                onToggleStatus={handleToggleTenantStatus}
              />
            ) : (
              <EmptyState
                title={loading ? "正在加载租户" : "没有匹配的租户"}
                description={
                  loading
                    ? "正在读取平台租户运营数据。"
                    : (loadError ?? "清空筛选条件后可查看全部租户。")
                }
                action={
                  <ActionButton
                    variant="outline"
                    icon="x"
                    onClick={handleReset}
                  >
                    清空筛选
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
            total={filteredTenants.length}
            pageSize={pageSize}
            onPageSizeChange={setPageSize}
            onPageChange={(page) =>
              setCurrentPage(Math.min(Math.max(page, 1), pageCount))
            }
          />
        }
      />
    </>
  );
}
