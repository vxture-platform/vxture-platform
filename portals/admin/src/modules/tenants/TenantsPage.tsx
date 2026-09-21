"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useTableLabels } from "@/modules/shared/table";
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
  ListPageTemplate,
  MetricGrid,
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
import {} from "@vxture-platform/shared";
import {
  TENANT_RISK_TONE,
  TENANT_STATUS_TONE,
  VERIFICATION_TONE,
  formatNumber,
  normalizeTenantRiskLevel,
  riskLabel,
  statusLabel,
  tenantRiskOptions,
  tenantSearchText,
  verifiedLabel,
} from "./tenant-utils";
import { useStepUp, isStepUpCancelled } from "@/providers/StepUpProvider";
import { formatPrincipalNoOr } from "@vxture-platform/shared";

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
  const tShared = useTranslations();
  const router = useRouter();
  const isSuspended = tenant.status === "suspended";

  /* 地址栏走可读码（tenant_no），不是 UUID。板块与编辑态用 query 带过去，
     详情页挂载时读一次（见 TenantDetailPage 的 `?tab=` / `?edit=1`）。 */
  const go = (tab?: string, edit?: boolean) => {
    const query = [
      ...(tab ? [`tab=${tab}`] : []),
      ...(edit ? ["edit=1"] : []),
    ].join("&");
    router.push(
      `/tenants/${encodeURIComponent(tenant.tenantCode)}${query ? `?${query}` : ""}`,
    );
  };

  return (
    <div
      className="relative z-[1] inline-flex justify-self-end"
      onClick={(event) => event.stopPropagation()}
    >
      <ActionMenu
        label={`${tenant.tenantName} 操作`}
        items={[
          {
            id: "details",
            label: tShared("actions.viewDetail"),
            icon: "arrow-right",
            onSelect: () => go(),
          },
          {
            /* 不在列表页弹编辑框——那就是把详情页的表单又搭一遍。跳过去并把
               编辑态打开，一份表单只留一处实现。 */
            id: "edit",
            label: "编辑资料",
            icon: "edit",
            onSelect: () => go("info", true),
          },
          /* 下面四条是详情页板块的快捷入口。六个板块只放四个：
             「租户信息」已经是「查看详情」的落地点，再列一条是同一个地址；
             「风控审计」不是运营主动要去干的事，是出了问题才查的，摆进常用
             菜单会稀释前四条。 */
          {
            id: "members",
            label: "成员账号",
            icon: "user",
            separatorBefore: true,
            onSelect: () => go("members"),
          },
          {
            id: "subscriptions",
            label: "订阅产品",
            icon: "star",
            onSelect: () => go("subscriptions"),
          },
          {
            id: "usage",
            label: "配额用量",
            icon: "graph",
            onSelect: () => go("usage"),
          },
          {
            id: "tickets",
            label: "工单服务",
            icon: "chat-circle",
            onSelect: () => go("tickets"),
          },
          {
            // 暂停 → suspendTenant / 已暂停恢复 → resumeTenant；已注销租户无切换语义，置灰。
            // 这一条不跳：它的宾语就是这一行租户，在原地做完最短。
            id: "toggle-status",
            label: isSuspended ? "恢复租户" : "暂停租户",
            icon: isSuspended ? "success" : "warning",
            separatorBefore: true,
            disabled: busy || tenant.status === "cancelled",
            ...(tenant.status === "cancelled"
              ? { hint: "已注销的租户没有暂停 / 恢复语义" }
              : {}),
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
  const tShared = useTranslations();
  const router = useRouter();

  return [
    {
      id: "tenant",
      header: "租户",
      /* 标题用**全称**而不是简称（owner 2026-09-21：「这是管理平台，要全称」）。
         tenantName = tenancy.tenants.name，跟着 KYC 走的认证名；简称是租户自己日常
         用的。运营要能拿屏幕上这个名字去对合同与发票。
         （#419 之前两者投影到同一列，看不出区别；现在才是真的两个值。） */
      cell: (tenant) => (
        <TableTitleCell
          icon={
            tenant.tenantType === "company" ? "buildings" : "building-office"
          }
          title={tenant.tenantName}
          description={`${formatPrincipalNoOr(tenant.tenantCode, "tenant", "—")} · ${tenant.region}`}
          onTitleClick={() =>
            router.push(`/tenants/${encodeURIComponent(tenant.tenantCode)}`)
          }
        />
      ),
    },
    {
      id: "owner",
      header: "主管理员",
      cell: (tenant) => (
        <TableTitleCell
          layout="stacked"
          title={tenant.ownerName || "—"}
          {...(tenant.ownerEmail ? { description: tenant.ownerEmail } : {})}
        />
      ),
    },
    {
      id: "member",
      header: "成员",
      align: "center",
      cell: (tenant) => formatNumber(tenant.memberCount),
    },
    {
      id: "status",
      header: tShared("columns.state"),
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
          layout="stacked"
          title={<Badge>{formatNumber(tenant.productCount)} 产品</Badge>}
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
        // 「总工单」原来取 max(tickets.length, ticketOpenCount)，而列表里 tickets[] 一直
        // 是空占位，所以它其实就是待处理数——现在只说待处理，不再摆一个同值的「总数」。
        return (
          <span className="inline-flex flex-col items-center gap-2xs">
            {
              <StatusBadge tone={TENANT_RISK_TONE[riskLevel]}>
                {riskLabel(riskLevel)}
              </StatusBadge>
            }
            <span className="text-body-sm text-muted-foreground">{`待处理工单 ${formatNumber(tenant.ticketOpenCount)}`}</span>
          </span>
        );
      },
    },
  ];
}

export function TenantsPage() {
  const tShared = useTranslations();
  const tableLabels = useTableLabels();
  const { toast } = useToast();
  const { runWithStepUp } = useStepUp();
  const [tenants, setTenants] = useState<TenantOperationRecord[]>([]);
  const [tenantsTruncated, setTenantsTruncated] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
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
        description: `${tenant.tenantName} ${resuming ? "已恢复为正常状态。" : "已暂停。"}`,
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
  /* 「使用租户」= 手上有订阅的那些，下排再拆付费 / 试用两个数。
     换口径而不是改名（owner 2026-09-21 裁定）：原卡叫「试用租户」，口径是
     「有订阅但月收入为零」——把它直接改叫「使用租户」会把付费客户排在外面，
     标题与数对不上。一张卡要回答的是「多少人在用、其中多少付钱」。 */
  const activeProductTenants = tenants.filter(
    (tenant) => tenant.subscriptionCount > 0,
  ).length;
  const payingTenants = tenants.filter(
    (tenant) => tenant.subscriptionCount > 0 && tenant.monthlyRevenue > 0,
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
        className="w-full vx-tenant-operations-page"
        header={
          <PageHeader
            icon="buildings"
            eyebrow="租户账号"
            title="租户管理"
            description="平台运营侧统一检索租户、识别风险、处理订阅和进入单租户管理。"
          />
        }
        summary={
          <>
            {" "}
            <MetricGrid
              loading={loading}
              aria-label="租户运营统计"
              // 三张卡要显式写列数：MetricGrid 默认 columns = 4。
              columns={3}
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
                /* 「认证待审」删于 2026-09-21。owner：与待办重复。
                   重复不是它唯一的毛病——待办那份是按自己的谓词派生的，这张卡是列表
                   自己 filter 出来的，两个数早晚对不上，而运营会信先看到的那个。 */
                {
                  id: "active",
                  help: "手上至少有一条订阅的租户。",
                  icon: "star",
                  label: "使用租户",
                  value: formatNumber(activeProductTenants),
                  tags: [
                    `付费 ${formatNumber(payingTenants)}`,
                    `试用 ${formatNumber(trialProductTenants)}`,
                  ],
                },
                {
                  id: "risk",
                  help: "风险等级非正常的租户。",
                  icon: "warning",
                  label: "风险关注",
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
            view="list"
            onViewChange={() => {}}
            cardsDisabledReason={tShared("common.cardsRetired")}
            count={formatNumber(filteredTenants.length)}
            aria-label="租户筛选"
            search={
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索租户、编码、联系人、产品"
                className="min-w-media-2xl grow basis-0 max-w-panel-sm"
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
            <>
              <NativeSelect
                wrapperClassName="w-fit basis-media-xl"
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value as StatusFilter)
                }
                aria-label="租户状态"
              >
                <option value="all">{tShared("filters.allStates")}</option>
                <option value="active">
                  {tShared("status.generic.normal")}
                </option>
                <option value="trial">{tShared("status.generic.trial")}</option>
                <option value="suspended">{tShared("actions.pause")}</option>
                <option value="cancelled">注销</option>
              </NativeSelect>
              <NativeSelect
                wrapperClassName="w-fit basis-media-xl"
                value={typeFilter}
                onChange={(event) =>
                  setTypeFilter(event.target.value as TypeFilter)
                }
                aria-label={tShared("columns.tenantType")}
              >
                <option value="all">{tShared("filters.allKinds")}</option>
                <option value="company">企业租户</option>
                <option value="individual">个人租户</option>
              </NativeSelect>
              <NativeSelect
                wrapperClassName="w-fit basis-media-xl"
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
                <option value="rejected">
                  {tShared("status.generic.rejected")}
                </option>
              </NativeSelect>
              <NativeSelect
                wrapperClassName="w-fit basis-media-xl"
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
            </>
          </FilterBar>
        }
        table={
          <section
            className="grid min-w-0 max-w-full gap-xs"
            aria-label="租户清单"
          >
            {/* 列表态的加载由 DataTable 出骨架行，卡片态没有骨架，仍留这行提示。 */}

            <DataTable
              labels={tableLabels}
              columns={tenantColumns}
              rows={visibleTenants}
              rowKey={(tenant) => tenant.id}
              loading={loading}
              indexStart={(Math.min(currentPage, pageCount) - 1) * pageSize + 1}
              selectedKeys={[...selectedTenantIds]}
              onSelectionChange={(keys) => setSelectedTenantIds(new Set(keys))}
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
