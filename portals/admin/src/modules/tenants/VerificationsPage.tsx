"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
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
  approveTenantVerification,
  fetchTenantVerifications,
  rejectTenantVerification,
} from "@/api/admin-bff";
import type {
  TenantOperationRecord,
  TenantOperationType,
  TenantVerificationRecord,
  TenantVerificationStatus,
} from "@/entities/console";
import { isListTruncated } from "@/lib/list-truncation";
import { PageHeader } from "@/modules/shared/PageHeader";
import { type PageSize } from "@/modules/shared/PageSizePicker";
import {
  formatDate,
  formatMoney,
  formatNumber,
  normalizeTenantRiskLevel,
  riskLabel,
  TENANT_RISK_TONE,
  tenantRiskOptions,
  verifiedLabel,
} from "./tenant-utils";

type ViewMode = "list" | "cards";
type VerificationFilter = "all" | TenantVerificationStatus;
type RiskFilter = "all" | TenantOperationRecord["riskLevel"];
type RegionFilter = "all" | string;
type VerificationStatusTone = "normal" | "progress" | "attention" | "closed";

const verificationSortWeight: Record<TenantVerificationStatus, number> = {
  pending: 0,
  rejected: 1,
  unverified: 2,
  verified: 3,
};

// 复用既有 TenantOperationRecord 版式：把实名审核记录投影到列表所需字段，
// 承载 verificationId 供审批/驳回端点调用；本读路径不覆盖的运营字段按零值占位。
type VerificationRow = TenantOperationRecord & { verificationId: string };

const verificationTenantType: Record<string, TenantOperationType> = {
  organization: "company",
  personal: "individual",
};

function mapVerificationToRow(
  record: TenantVerificationRecord,
): VerificationRow {
  const contactName = record.legalPersonName ?? record.tenantName;
  return {
    verificationId: record.id,
    id: record.tenantId,
    tenantCode: record.tenantNo,
    tenantName: record.tenantName,
    displayName: record.tenantName,
    tenantType: verificationTenantType[record.tenantType] ?? "company",
    status: record.tenantStatus === "suspended" ? "suspended" : "active",
    verifiedStatus: record.status,
    verificationSubmittedAt: record.createdAt,
    verifiedAt: record.reviewedAt,
    riskLevel: "normal",
    region: "",
    industry:
      record.verificationType === "enterprise" ? "企业认证" : "个人认证",
    scale: record.businessLicenseNo ?? "—",
    ownerName: record.legalPersonName ?? "",
    ownerEmail: "",
    contactName,
    contactPhone: "",
    createdAt: record.createdAt,
    lastActiveAt: record.updatedAt,
    memberCount: 0,
    activeMemberCount: 0,
    adminCount: 0,
    subscriptionCount: 0,
    productCount: 0,
    monthlyRevenue: 0,
    monthlyCost: 0,
    grossMarginRate: 0,
    tokenUsed: 0,
    tokenQuota: 0,
    ticketOpenCount: 0,
    satisfaction: 0,
    sla: "",
    tags: [],
    notes: record.rejectReason ?? "",
    members: [],
    subscriptions: [],
    usage: [],
    modelPolicies: [],
    auditEvents: [],
    tickets: [],
  };
}

function daysSince(value: string | null | undefined) {
  if (!value) return 0;
  const started = new Date(value).getTime();
  if (Number.isNaN(started)) return 0;
  return Math.max(0, Math.floor((Date.now() - started) / 86_400_000));
}

function verificationStatusIndicator(status: TenantVerificationStatus): {
  tone: VerificationStatusTone;
  label: string;
  icon: IconName;
} {
  if (status === "verified")
    return { tone: "normal", label: "已认证", icon: "check" };
  if (status === "pending")
    return { tone: "progress", label: "待审核", icon: "clock" };
  if (status === "rejected")
    return { tone: "attention", label: "已驳回", icon: "warning" };
  return { tone: "closed", label: "未认证", icon: "info" };
}

function verificationSearchText(tenant: TenantOperationRecord) {
  return [
    tenant.id,
    tenant.tenantCode,
    tenant.tenantName,
    tenant.displayName,
    tenant.verifiedStatus,
    tenant.riskLevel,
    tenant.region,
    tenant.industry,
    tenant.scale,
    tenant.contactName,
    tenant.contactPhone,
    tenant.ownerName,
    tenant.ownerEmail,
    tenant.notes,
  ]
    .join(" ")
    .toLowerCase();
}

/* 收 `locale` 往下传：它自己是纯函数，但里头调的 `formatDate` 现在按语言
   排日期。这是「模块级辅助函数拿不到运行时上下文」的标准形态——上提到
   调用点由组件传。 */
function verificationTimeText(tenant: TenantOperationRecord, locale: string) {
  if (tenant.verifiedStatus === "verified")
    return tenant.verifiedAt
      ? `通过 ${formatDate(tenant.verifiedAt, locale)}`
      : "已通过";
  if (tenant.verifiedStatus === "pending")
    return `等待 ${formatNumber(daysSince(tenant.verificationSubmittedAt))} 天`;
  if (tenant.verifiedStatus === "rejected") return "需补充材料";
  return "未提交材料";
}

function VerificationActionsMenu({
  tenant,
  busy,
  onApprove,
  onReject,
}: {
  tenant: VerificationRow;
  busy: boolean;
  onApprove: (row: VerificationRow) => void;
  onReject: (row: VerificationRow) => void;
}) {
  const tShared = useTranslations();
  const router = useRouter();
  const isPending = tenant.verifiedStatus === "pending";

  return (
    <div
      className="relative z-[1] inline-flex justify-self-end"
      onClick={(event) => event.stopPropagation()}
    >
      <ActionMenu
        label={`${tenant.displayName} 认证操作`}
        items={[
          {
            id: "review",
            label: isPending ? "进入审核" : tShared("actions.viewDetail"),
            icon: isPending ? "medal" : "arrow-right",
            onSelect: () =>
              router.push(`/tenants/${encodeURIComponent(tenant.id)}`),
          },
          {
            id: "approve",
            label: "通过认证",
            icon: "check",
            disabled: !isPending || busy,
            onSelect: () => onApprove(tenant),
          },
          {
            id: "reject",
            label: "驳回材料",
            icon: "x",
            disabled: !isPending || busy,
            onSelect: () => onReject(tenant),
          },
          {
            id: "history",
            label: "审核记录",
            icon: "info",
            disabled: true,
          },
        ]}
      />
    </div>
  );
}

/** 认证态 → 语气。取自 `.vx-verification-pill--*`：unverified 是灰不是红，
 * "还没提交"不是"审核不过"。 */
const VERIFIED_TONE: Record<
  VerificationRow["verifiedStatus"],
  StatusBadgeTone
> = {
  verified: "success",
  pending: "warning",
  rejected: "danger",
  unverified: "neutral",
};

function useVerificationColumns(): DataTableColumn<VerificationRow>[] {
  const locale = useLocale();
  const router = useRouter();

  return [
    {
      id: "org",
      header: "组织",
      cell: (tenant) => (
        <TableTitleCell
          icon="buildings"
          title={tenant.displayName}
          description={`${tenant.tenantCode} · ${tenant.region}`}
          onTitleClick={() =>
            router.push(`/tenants/${encodeURIComponent(tenant.id)}`)
          }
        />
      ),
    },
    {
      id: "status",
      header: "认证状态",
      align: "center",
      cell: (tenant) => {
        const indicator = verificationStatusIndicator(tenant.verifiedStatus);
        return (
          <TableTitleCell
            title={
              <StatusBadge
                tone={VERIFIED_TONE[tenant.verifiedStatus]}
                icon={indicator.icon}
                title={indicator.label}
              >
                {verifiedLabel(tenant.verifiedStatus)}
              </StatusBadge>
            }
            description={riskLabel(normalizeTenantRiskLevel(tenant.riskLevel))}
          />
        );
      },
    },
    {
      id: "subject",
      header: "主体信息",
      cell: (tenant) => (
        <TableTitleCell
          title={
            <span className="inline-flex flex-wrap gap-2xs">
              <Badge>{tenant.industry}</Badge>
              <Badge>{tenant.scale}</Badge>
            </span>
          }
          description={tenant.tenantName}
        />
      ),
    },
    {
      id: "contact",
      header: "运营联系",
      cell: (tenant) => (
        <TableTitleCell
          title={tenant.contactName}
          description={tenant.contactPhone || tenant.ownerEmail}
        />
      ),
    },
    {
      id: "time",
      header: "时间",
      cell: (tenant) => (
        <TableTitleCell
          title={
            tenant.verificationSubmittedAt
              ? formatDate(tenant.verificationSubmittedAt, locale)
              : "未提交"
          }
          description={verificationTimeText(tenant, locale)}
        />
      ),
    },
  ];
}

function VerificationCards({
  tenants,
  actionBusy,
  onApprove,
  onReject,
}: {
  tenants: VerificationRow[];
  actionBusy: boolean;
  onApprove: (row: VerificationRow) => void;
  onReject: (row: VerificationRow) => void;
}) {
  const locale = useLocale();
  const router = useRouter();

  return (
    <ListCardGrid aria-label="实名认证卡片">
      {tenants.map((tenant) => {
        const riskLevel = normalizeTenantRiskLevel(tenant.riskLevel);

        return (
          <MetricListCard
            key={tenant.id}
            icon="buildings"
            title={tenant.displayName}
            description={`${tenant.tenantCode} · ${tenant.region}`}
            /* 卡的语气取风险档，与租户列表页同一判断：一屏卡片里最该先被看见的
             * 就是高风险那几张。原来是 `vx-tenant-directory-card--{risk}`。 */
            tone={TENANT_RISK_TONE[riskLevel]}
            actions={
              <VerificationActionsMenu
                tenant={tenant}
                busy={actionBusy}
                onApprove={onApprove}
                onReject={onReject}
              />
            }
            badges={
              <>
                <StatusBadge tone={VERIFIED_TONE[tenant.verifiedStatus]}>
                  {verifiedLabel(tenant.verifiedStatus)}
                </StatusBadge>
                <StatusBadge tone={TENANT_RISK_TONE[riskLevel]}>
                  {riskLabel(riskLevel)}
                </StatusBadge>
              </>
            }
            metrics={[
              {
                key: "waiting",
                value: formatNumber(daysSince(tenant.verificationSubmittedAt)),
                label: "等待天数",
              },
              {
                key: "members",
                value: formatNumber(tenant.memberCount),
                label: "成员",
              },
              {
                key: "revenue",
                value: formatMoney(tenant.monthlyRevenue),
                label: "本月收入",
              },
            ]}
            footer={
              <>
                <span>
                  {tenant.industry} · {tenant.scale}
                </span>
                <strong>{verificationTimeText(tenant, locale)}</strong>
              </>
            }
            onClick={() =>
              router.push(`/tenants/${encodeURIComponent(tenant.id)}`)
            }
          />
        );
      })}
    </ListCardGrid>
  );
}

export function VerificationsPage() {
  const tShared = useTranslations();
  const { toast } = useToast();
  const [tenants, setTenants] = useState<VerificationRow[]>([]);
  const [verificationsTruncated, setVerificationsTruncated] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [selectedTenantIds, setSelectedTenantIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [query, setQuery] = useState("");
  const [verificationFilter, setVerificationFilter] =
    useState<VerificationFilter>("all");
  const [riskFilter, setRiskFilter] = useState<RiskFilter>("all");
  const [regionFilter, setRegionFilter] = useState<RegionFilter>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(20);
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<VerificationRow | null>(
    null,
  );
  const [rejectReason, setRejectReason] = useState("");
  const [rejectError, setRejectError] = useState<string | null>(null);

  useEffect(() => {
    const tenantId = new URLSearchParams(window.location.search).get(
      "tenantId",
    );
    if (tenantId) setQuery(tenantId);
  }, []);

  const loadVerifications = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const records = await fetchTenantVerifications();
        setTenants(records.map(mapVerificationToRow));
        setVerificationsTruncated(isListTruncated(records));
      } catch (error) {
        setVerificationsTruncated(false);
        toast({
          tone: "danger",
          title: "加载失败",
          description:
            error instanceof Error
              ? error.message
              : "无法加载实名认证列表，请稍后重试。",
        });
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    void loadVerifications();
  }, [loadVerifications]);

  const organizationTenants = useMemo(
    () =>
      tenants
        .filter((tenant) => tenant.tenantType === "company")
        .sort((left, right) => {
          const statusOrder =
            verificationSortWeight[left.verifiedStatus] -
            verificationSortWeight[right.verifiedStatus];
          if (statusOrder !== 0) return statusOrder;
          return (
            new Date(
              right.verificationSubmittedAt ?? right.createdAt,
            ).getTime() -
            new Date(left.verificationSubmittedAt ?? left.createdAt).getTime()
          );
        }),
    [tenants],
  );

  const regionOptions = useMemo(
    () =>
      Array.from(
        new Set(
          organizationTenants
            .map((tenant) => tenant.region.split("/")[0]?.trim())
            .filter(Boolean),
        ),
      ).sort(),
    [organizationTenants],
  );

  const verificationColumns = useVerificationColumns();

  const filteredTenants = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return organizationTenants.filter((tenant) => {
      const primaryRegion =
        tenant.region.split("/")[0]?.trim() || tenant.region;
      if (
        verificationFilter !== "all" &&
        tenant.verifiedStatus !== verificationFilter
      )
        return false;
      if (riskFilter !== "all" && tenant.riskLevel !== riskFilter) return false;
      if (regionFilter !== "all" && primaryRegion !== regionFilter)
        return false;
      if (
        normalizedQuery &&
        !verificationSearchText(tenant).includes(normalizedQuery)
      )
        return false;
      return true;
    });
  }, [
    organizationTenants,
    query,
    regionFilter,
    riskFilter,
    verificationFilter,
  ]);

  const pageCount = Math.max(1, Math.ceil(filteredTenants.length / pageSize));
  const visibleTenants = filteredTenants.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  const pendingCount = organizationTenants.filter(
    (tenant) => tenant.verifiedStatus === "pending",
  ).length;
  const overdueCount = organizationTenants.filter(
    (tenant) =>
      tenant.verifiedStatus === "pending" &&
      daysSince(tenant.verificationSubmittedAt) >= 3,
  ).length;
  const verifiedCount = organizationTenants.filter(
    (tenant) => tenant.verifiedStatus === "verified",
  ).length;
  const rejectedCount = organizationTenants.filter(
    (tenant) => tenant.verifiedStatus === "rejected",
  ).length;
  const unverifiedCount = organizationTenants.filter(
    (tenant) => tenant.verifiedStatus === "unverified",
  ).length;
  const passRate = organizationTenants.length
    ? Math.round((verifiedCount / organizationTenants.length) * 100)
    : 0;

  useEffect(() => {
    setCurrentPage(1);
  }, [pageSize, query, regionFilter, riskFilter, verificationFilter, viewMode]);

  function handleReset() {
    setQuery("");
    setVerificationFilter("all");
    setRiskFilter("all");
    setRegionFilter("all");
  }

  async function handleApprove(row: VerificationRow) {
    if (actionBusy) return;
    setActionBusy(true);
    try {
      await approveTenantVerification(row.verificationId);
      await loadVerifications(true);
      toast({
        tone: "success",
        title: "已通过认证",
        description: `${row.displayName} 的实名认证已通过。`,
      });
    } catch (error) {
      toast({
        tone: "danger",
        title: "操作失败",
        description:
          error instanceof Error ? error.message : "无法通过认证，请稍后重试。",
      });
    } finally {
      setActionBusy(false);
    }
  }

  function openReject(row: VerificationRow) {
    setRejectTarget(row);
    setRejectReason("");
    setRejectError(null);
  }

  function closeReject() {
    if (actionBusy) return;
    setRejectTarget(null);
    setRejectReason("");
    setRejectError(null);
  }

  async function submitReject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!rejectTarget || actionBusy) return;

    const reason = rejectReason.trim();
    if (!reason) {
      setRejectError("请填写驳回原因。");
      return;
    }

    setActionBusy(true);
    setRejectError(null);
    try {
      await rejectTenantVerification(rejectTarget.verificationId, reason);
      await loadVerifications(true);
      toast({
        tone: "success",
        title: "已驳回材料",
        description: `${rejectTarget.displayName} 的实名认证已驳回。`,
      });
      setRejectTarget(null);
      setRejectReason("");
    } catch (error) {
      setRejectError(
        error instanceof Error ? error.message : "驳回失败，请稍后重试。",
      );
    } finally {
      setActionBusy(false);
    }
  }

  return (
    <>
      <ListPageTemplate
        className="vx-tenant-management-page vx-verification-page"
        header={
          <PageHeader
            icon="medal"
            title="实名认证"
            description="集中处理组织租户提交的企业资质认证，按待审、通过、驳回和未提交状态推进审核流转。"
          />
        }
        summary={
          <>
            {" "}
            <MetricGrid
              loading={loading}
              aria-label="实名认证统计"
              items={[
                {
                  id: "organizations",
                  help: "组织类型的租户数，个人租户不计入。",
                  icon: "buildings",
                  label: "组织总数",
                  value: formatNumber(organizationTenants.length),
                  tags: [`待审 ${formatNumber(pendingCount)}`],
                },
                {
                  id: "pending",
                  help: "已提交认证材料、待审核的组织。",
                  icon: "clock",
                  label: "待审核",
                  value: formatNumber(pendingCount),
                  tags: [`超 3 天 ${formatNumber(overdueCount)}`],
                  tone: "warning",
                },
                {
                  id: "verified",
                  help: "认证已通过的组织。",
                  icon: "check",
                  label: "已认证",
                  value: formatNumber(verifiedCount),
                  tags: [`通过率 ${formatNumber(passRate)}%`],
                  tone: "success",
                },
                {
                  id: "needs-supplement",
                  help: "被驳回与尚未提交认证的组织之和。",
                  icon: "warning",
                  label: "需补充",
                  value: formatNumber(rejectedCount + unverifiedCount),
                  tags: [
                    `驳回 ${formatNumber(rejectedCount)}`,
                    `未提交 ${formatNumber(unverifiedCount)}`,
                  ],
                  tone: rejectedCount ? "danger" : "success",
                },
              ]}
            />
            {verificationsTruncated ? (
              <Banner
                tone="warning"
                title="当前实名认证列表可能未展示全部数据"
                description="本次加载已达到单次读取上限（500 条），如未看到目标记录，请尝试缩小筛选范围（如按认证状态、地区等）重新查询。"
              />
            ) : null}
          </>
        }
        filters={
          <FilterBar
            view={viewMode}
            onViewChange={setViewMode}
            cardsDisabledReason={tShared("common.cardsRetired")}
            count={formatNumber(filteredTenants.length)}
            aria-label="实名认证筛选"
            search={
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索组织、编码、联系人、地区"
                className="grow basis-media-3xl max-w-panel-sm"
                aria-label="搜索实名认证"
              />
            }
            onReset={handleReset}
            actions={
              <>
                <ActionButton variant="outline" icon="medal" disabled>
                  批量审核
                </ActionButton>
              </>
            }
          >
            <>
              <NativeSelect
                className="w-fit basis-media-xl"
                value={verificationFilter}
                onChange={(event) =>
                  setVerificationFilter(
                    event.target.value as VerificationFilter,
                  )
                }
                aria-label="认证状态"
              >
                <option value="all">全部认证</option>
                <option value="pending">待审核</option>
                <option value="verified">已认证</option>
                <option value="rejected">
                  {tShared("status.generic.rejected")}
                </option>
                <option value="unverified">未认证</option>
              </NativeSelect>
              <NativeSelect
                className="w-fit basis-media-xl"
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
              <NativeSelect
                className="w-fit basis-media-xl"
                value={regionFilter}
                onChange={(event) => setRegionFilter(event.target.value)}
                aria-label="所属区域"
              >
                <option value="all">全部区域</option>
                {regionOptions.map((region) => (
                  <option key={region} value={region}>
                    {region}
                  </option>
                ))}
              </NativeSelect>
            </>
          </FilterBar>
        }
        table={
          <section
            className="grid min-w-0 max-w-full gap-xs"
            aria-label="实名认证清单"
          >
            {/* 列表态的加载由 DataTable 出骨架行，卡片态没有骨架，仍留这行提示。 */}
            {loading && viewMode === "cards" ? (
              <header className="flex min-h-0 items-center justify-end gap-sm text-body-sm font-normal text-muted-foreground">
                <span>{tShared("common.loading")}</span>
              </header>
            ) : null}

            {viewMode === "list" ? (
              <DataTable
                columns={verificationColumns}
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
                  <VerificationActionsMenu
                    tenant={tenant}
                    busy={actionBusy}
                    onApprove={handleApprove}
                    onReject={openReject}
                  />
                )}
                empty={
                  <EmptyState
                    title="没有匹配的实名认证"
                    description="清空筛选条件后可查看全部实名认证记录。"
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
            ) : visibleTenants.length ? (
              <VerificationCards
                tenants={visibleTenants}
                actionBusy={actionBusy}
                onApprove={handleApprove}
                onReject={openReject}
              />
            ) : (
              <EmptyState
                title={loading ? "正在加载实名认证" : "没有匹配的实名认证"}
                description={
                  loading
                    ? "正在读取租户认证数据。"
                    : "清空筛选条件后可查看全部实名认证记录。"
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
            total={filteredTenants.length}
            pageSize={pageSize}
            onPageSizeChange={setPageSize}
            onPageChange={(page) =>
              setCurrentPage(Math.min(Math.max(page, 1), pageCount))
            }
          />
        }
      />

      {rejectTarget ? (
        <DialogForm
          open
          title="驳回实名认证"
          description={`将驳回 ${rejectTarget.displayName}（${rejectTarget.tenantCode}）提交的实名材料，请填写驳回原因，租户可据此补充后重新提交。`}
          submitLabel="确认驳回"
          danger
          cancelLabel={tShared("actions.discard")}
          submitting={actionBusy}
          submitDisabled={!rejectReason.trim()}
          onOpenChange={(open) => {
            if (!open) closeReject();
          }}
          onSubmit={(event) => void submitReject(event)}
        >
          <label className="vx-verification-reject-field">
            <span>驳回原因</span>
            <Textarea
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
              placeholder="例如：营业执照照片模糊无法识别，请重新上传清晰彩色扫描件。"
              maxLength={255}
              rows={4}
              autoFocus
            />
          </label>
          {rejectError ? (
            <p className="vx-verification-reject-error" role="alert">
              {rejectError}
            </p>
          ) : null}
        </DialogForm>
      ) : null}
    </>
  );
}
