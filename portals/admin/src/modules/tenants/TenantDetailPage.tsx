"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { FormEvent, ReactNode } from "react";
import Link from "next/link";
import {
  ActionMenu,
  Badge,
  Button,
  DataTable,
  DetailPageTemplate,
  DialogForm,
  EmptyState,
  Icon,
  Input,
  Label,
  ListCardGrid,
  MetricListCard,
  NativeSelect,
  PanelItem,
  PanelList,
  Progress,
  Section,
  StatusBadge,
  TableTitleCell,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useToast,
  ViewLayout,
  ViewModeSwitch,
} from "@vxture/design-system";
import type { DataTableColumn, IconName } from "@vxture/design-system";
import {
  changeTenantMemberRole,
  fetchTenantMembers,
  fetchTenantOperations,
  removeTenantMember,
  suspendTenantMember,
  updateTenant,
  type UpdateTenantInput,
} from "@/api/admin-bff";
import type {
  TenantMemberRecord,
  TenantOperationMember,
  TenantOperationModelPolicy,
  TenantOperationRecord,
  TenantOperationSubscription,
  TenantOperationUsageMetric,
} from "@/entities/console";
import {
  AUDIT_RESULT_TONE,
  MEMBER_STATUS_TONE,
  POLICY_STATE_TONE,
  TENANT_SUBSCRIPTION_TONE,
  TICKET_STATUS_TONE,
} from "@/modules/shared/tenant-tone";
import { DetailSectionHeading } from "@/modules/shared/DetailSectionHeading";
import { resolveIpLocation } from "@/shared/ip-location";
import {
  auditResultLabel,
  formatDate,
  formatMoney,
  formatNumber,
  joinClasses,
  memberStatusLabel,
  modelPolicyStateLabel,
  normalizeTenantRiskLevel,
  policySourceLabel,
  riskLabel,
  statusLabel,
  subscriptionStatusLabel,
  TENANT_RISK_TONE,
  TENANT_STATUS_TONE,
  ticketStatusLabel,
  usagePercent,
  VERIFICATION_TONE,
  verifiedLabel,
} from "./tenant-utils";
import { useConfirmLabels } from "@/modules/shared/destructive";

type TenantTabId =
  | "info"
  | "members"
  | "subscriptions"
  | "usage"
  | "models"
  | "risk"
  | "tickets";
type MemberViewMode = "list" | "cards";
type MemberStatusFilter = "all" | TenantOperationMember["status"];
type MemberRoleFilter = "all" | string;

// 成员行动作接的是 fetchTenantMembers（TenantMemberRecord），而列表/卡片版式沿用
// TenantOperationMember 字段；这里投影成一个「超集视图」：保留展示字段不动，额外
// 携带 userId / roleId 供成员写端点使用（changeRole/suspend/remove 均以 userId 定位）。
type TenantMemberView = TenantOperationMember & {
  userId: string;
  roleId: string;
};

// 调整权限对话框的候选角色（roleId + 展示名）。
type MemberRoleOption = { roleId: string; label: string };

// 成员行动作句柄集合，透传到 MemberActionsMenu，避免逐个 prop 层层穿透。
type MemberActionHandlers = {
  busy: boolean;
  onChangeRole: (member: TenantMemberView) => void;
  onSuspend: (member: TenantMemberView) => void;
  /** 落锤，不是开框。确认由菜单项承担；这里返回的 Promise 成败决定框关不关。 */
  onRemove: (member: TenantMemberView) => Promise<void>;
};

function toMemberView(record: TenantMemberRecord): TenantMemberView {
  return {
    id: record.membershipId,
    userId: record.userId,
    ...(record.account ? { accountCode: record.account } : {}),
    name: record.name,
    email: record.email,
    role: record.roleName || record.roleCode || "成员",
    roleId: record.roleId,
    // TenantMemberRecord.status = active | suspended | removed（removed 已在拉取时过滤）。
    status: record.status === "suspended" ? "suspended" : "active",
    registeredAt: record.createdAt,
    activatedAt: record.createdAt,
    // 该读路径无活跃度事件源，用 updatedAt 近似「最近活跃」，无登录 IP。
    lastActiveAt: record.updatedAt,
    lastActiveIp: null,
  };
}
type TenantInfoDraft = {
  tenantCode: string;
  tenantName: string;
  displayName: string;
  tenantType: TenantOperationRecord["tenantType"];
  status: TenantOperationRecord["status"];
};

const tenantTabs: Array<{ id: TenantTabId; label: string; icon: IconName }> = [
  { id: "info", label: "租户信息", icon: "buildings" },
  { id: "members", label: "成员账号", icon: "user" },
  { id: "subscriptions", label: "订阅产品", icon: "star" },
  { id: "usage", label: "配额用量", icon: "graph" },
  { id: "models", label: "模型授权", icon: "shield-check" },
  { id: "risk", label: "风控审计", icon: "table" },
  { id: "tickets", label: "工单备注", icon: "chat-circle" },
];

const tenantTypeOptions: Array<{
  value: TenantOperationRecord["tenantType"];
  label: string;
}> = [
  { value: "company", label: "企业租户" },
  { value: "individual", label: "个人租户" },
];

const tenantStatusOptions: Array<{
  value: TenantOperationRecord["status"];
  label: string;
}> = [
  { value: "active", label: "正常" },
  { value: "trial", label: "试用" },
  { value: "suspended", label: "暂停" },
  { value: "cancelled", label: "注销" },
];

function TenantKeyMetric({
  label,
  value,
  tag,
  tags,
  danger,
}: {
  label: string;
  value: string;
  tag?: string;
  tags?: string[];
  danger?: boolean;
}) {
  const visibleTags = tags ?? (tag ? [tag] : []);

  /* 结构照 DS `LabeledValue`（标签在上、读数与标同基线），但没有直接用它：
   * 它的 `valueTag` 只收一个节点、且一定包成 `StatusBadge`，而这里的「订阅产品」
   * 要并排挂两个标。所以留成页面内的小件，标本身仍是 DS 的。 */
  return (
    <div className="flex min-w-0 flex-col gap-2xs">
      <span className="truncate text-label-sm text-muted-foreground">
        {label}
      </span>
      <span className="flex min-w-0 flex-wrap items-baseline gap-xs">
        <span
          className={`truncate text-title-md font-extrabold ${
            danger ? "text-destructive-text" : "text-foreground"
          }`}
        >
          {value}
        </span>
        {visibleTags.map((item) => (
          <StatusBadge key={item} tone="neutral" icon={false}>
            {item}
          </StatusBadge>
        ))}
      </span>
    </div>
  );
}

function createTenantInfoDraft(tenant: TenantOperationRecord): TenantInfoDraft {
  return {
    tenantCode: tenant.tenantCode,
    tenantName: tenant.tenantName,
    displayName: tenant.displayName,
    tenantType: tenant.tenantType,
    status: tenant.status,
  };
}

function isTenantInfoDirty(
  current: TenantInfoDraft | null,
  baseline: TenantInfoDraft | null,
) {
  if (!current || !baseline) return false;
  return Object.keys(current).some(
    (key) =>
      current[key as keyof TenantInfoDraft] !==
      baseline[key as keyof TenantInfoDraft],
  );
}

function isAgentSubscription(subscription: TenantOperationSubscription) {
  const searchableText =
    `${subscription.productName} ${subscription.releaseName} ${subscription.planName}`.toLowerCase();
  return (
    searchableText.includes("agent") ||
    searchableText.includes("智能体") ||
    searchableText.includes("ruyin")
  );
}

function getTenantSubscriptionSummary(tenant: TenantOperationRecord) {
  const knownSubscriptions =
    tenant.subscriptions.length || tenant.subscriptionCount;
  const agentCount = tenant.subscriptions.filter(isAgentSubscription).length;
  const platformCount = Math.max(knownSubscriptions - agentCount, 0);

  return { agentCount, platformCount };
}

function getActiveMonthCount(startedAt: string) {
  const started = new Date(startedAt);
  if (Number.isNaN(started.getTime())) return 1;

  const now = new Date();
  const monthCount =
    (now.getFullYear() - started.getFullYear()) * 12 +
    now.getMonth() -
    started.getMonth() +
    1;
  return Math.max(monthCount, 1);
}

function getTenantCumulativeRevenue(tenant: TenantOperationRecord) {
  const cumulativeRevenue = tenant.subscriptions.reduce(
    (total, subscription) =>
      total +
      subscription.monthlyRevenue * getActiveMonthCount(subscription.startedAt),
    0,
  );

  return cumulativeRevenue || tenant.monthlyRevenue;
}

function getMemberAccountCode(member: TenantOperationMember) {
  return member.accountCode ?? member.email.split("@")[0] ?? "-";
}

function getMemberStatusTime(member: TenantOperationMember) {
  return member.activatedAt ?? member.registeredAt ?? member.lastActiveAt;
}

function getMemberSearchText(member: TenantOperationMember) {
  return [
    member.name,
    member.email,
    getMemberAccountCode(member),
    member.role,
    member.status,
    resolveIpLocation(member.lastActiveIp),
  ]
    .join(" ")
    .toLowerCase();
}

function TenantConfigItem({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={joinClasses(
        "flex min-h-icon-2xl min-w-0 items-center gap-sm border-b border-dashed border-primary/10 pb-sm",
        className,
      )}
    >
      <span className="shrink-0 basis-media-lg whitespace-nowrap text-body-sm font-semibold text-muted-foreground">
        {label}
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-xs">{children}</div>
    </div>
  );
}

function TenantConfigValue({ children }: { children: ReactNode }) {
  return <strong>{children || "-"}</strong>;
}

function TenantInfoTab({
  tenant,
  draft,
  editing,
  infoDirty,
  saving,
  showVerificationReview,
  reviewHref,
  onDraftChange,
  onEdit,
  onReset,
  onSave,
}: {
  tenant: TenantOperationRecord;
  draft: TenantInfoDraft;
  editing: boolean;
  infoDirty: boolean;
  saving: boolean;
  showVerificationReview: boolean;
  reviewHref: string;
  onDraftChange: <K extends keyof TenantInfoDraft>(
    field: K,
    value: TenantInfoDraft[K],
  ) => void;
  onEdit: () => void;
  onReset: () => void;
  onSave: () => void;
}) {
  const tShared = useTranslations();
  return (
    <div className="grid min-w-0 grid-cols-1 gap-lg">
      <section className="grid min-w-0 gap-lg">
        <header>
          <DetailSectionHeading icon="buildings" title="基础资料" />
          <div
            className="flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-xs"
            aria-label="基础资料操作"
          >
            {editing ? (
              <>
                {infoDirty ? (
                  <span className="whitespace-nowrap text-body-sm font-extrabold text-destructive-text">
                    有未保存修改
                  </span>
                ) : null}
                <Button variant="outline" disabled={saving} onClick={onReset}>
                  {tShared("actions.discard")}
                </Button>
                <Button
                  className={
                    infoDirty
                      ? "border-destructive-border bg-destructive-muted text-destructive-text"
                      : undefined
                  }
                  disabled={!infoDirty || saving}
                  onClick={onSave}
                >
                  {saving ? "保存中..." : "保存"}
                </Button>
              </>
            ) : (
              <>
                {showVerificationReview ? (
                  <Link
                    className="inline-flex min-h-icon-xl items-center justify-center gap-xs rounded-lg border border-warning-border bg-warning-muted px-sm text-body-sm font-semibold whitespace-nowrap text-warning-text no-underline"
                    href={reviewHref}
                  >
                    <Icon name="medal" size="xs" fallback="placeholder" />
                    <span>认证审核</span>
                  </Link>
                ) : null}
                <Button variant="outline" onClick={onEdit}>
                  <Icon name="edit" size="xs" fallback="placeholder" />
                  <span>修改</span>
                </Button>
              </>
            )}
          </div>
        </header>
        <div className="grid min-w-0 gap-md lg:ml-media-lg">
          <div className="grid min-w-0 grid-cols-1 gap-x-lg gap-y-md lg:grid-cols-3">
            <TenantConfigItem label="租户代码">
              {editing ? (
                <Input
                  value={draft.tenantCode}
                  onChange={(event) =>
                    onDraftChange("tenantCode", event.target.value)
                  }
                />
              ) : (
                <TenantConfigValue>{draft.tenantCode}</TenantConfigValue>
              )}
            </TenantConfigItem>
            <TenantConfigItem label={tShared("columns.tenantName")}>
              {editing ? (
                <Input
                  value={draft.tenantName}
                  onChange={(event) =>
                    onDraftChange("tenantName", event.target.value)
                  }
                />
              ) : (
                <TenantConfigValue>{draft.tenantName}</TenantConfigValue>
              )}
            </TenantConfigItem>
            <TenantConfigItem label="租户简称">
              {editing ? (
                <Input
                  value={draft.displayName}
                  onChange={(event) =>
                    onDraftChange("displayName", event.target.value)
                  }
                />
              ) : (
                <TenantConfigValue>{draft.displayName}</TenantConfigValue>
              )}
            </TenantConfigItem>
          </div>

          <div className="grid min-w-0 grid-cols-1 gap-x-lg gap-y-md lg:grid-cols-3">
            <TenantConfigItem label={tShared("columns.tenantType")}>
              {editing ? (
                <NativeSelect
                  className="w-fit basis-media-xl"
                  value={draft.tenantType}
                  onChange={(event) =>
                    onDraftChange(
                      "tenantType",
                      event.target.value as TenantInfoDraft["tenantType"],
                    )
                  }
                >
                  {tenantTypeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </NativeSelect>
              ) : (
                <Badge>
                  {
                    tenantTypeOptions.find(
                      (option) => option.value === draft.tenantType,
                    )?.label
                  }
                </Badge>
              )}
            </TenantConfigItem>
            <TenantConfigItem label="租户状态">
              {editing ? (
                <NativeSelect
                  className="w-fit basis-media-xl"
                  value={draft.status}
                  onChange={(event) =>
                    onDraftChange(
                      "status",
                      event.target.value as TenantInfoDraft["status"],
                    )
                  }
                >
                  {tenantStatusOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </NativeSelect>
              ) : (
                <StatusBadge tone={TENANT_STATUS_TONE[draft.status]}>
                  {statusLabel(draft.status)}
                </StatusBadge>
              )}
            </TenantConfigItem>
            <TenantConfigItem label="认证状态">
              <StatusBadge tone={VERIFICATION_TONE[tenant.verifiedStatus]}>
                {verifiedLabel(tenant.verifiedStatus)}
              </StatusBadge>
            </TenantConfigItem>
          </div>

          <div className="grid min-w-0 grid-cols-1 gap-x-lg gap-y-md lg:grid-cols-3">
            <TenantConfigItem label="所属区域">
              <TenantConfigValue>{tenant.region}</TenantConfigValue>
            </TenantConfigItem>
            <TenantConfigItem label="所属行业">
              <TenantConfigValue>{tenant.industry}</TenantConfigValue>
            </TenantConfigItem>
            <TenantConfigItem label="人员规模">
              <TenantConfigValue>{tenant.scale}</TenantConfigValue>
            </TenantConfigItem>
          </div>
        </div>
      </section>

      <section className="grid min-w-0 gap-lg">
        <header>
          <DetailSectionHeading icon="user-switch" title="主管理员" />
        </header>
        <div className="grid min-w-0 grid-cols-1 items-stretch gap-x-lg gap-y-md lg:grid-cols-4">
          <TenantConfigItem label="姓名">
            <TenantConfigValue>
              {tenant.ownerName}
              {tenant.tenantType === "individual" ? <Badge>owner</Badge> : null}
            </TenantConfigValue>
          </TenantConfigItem>
          <TenantConfigItem label="Mail">
            <TenantConfigValue>{tenant.ownerEmail}</TenantConfigValue>
          </TenantConfigItem>
          <TenantConfigItem label="Phone">
            <TenantConfigValue>{tenant.contactPhone}</TenantConfigValue>
          </TenantConfigItem>
          <div className="flex min-h-icon-2xl min-w-0 items-center justify-start gap-xs border-b border-dashed border-primary/10 pb-sm">
            {/* 换 owner / 改主管理员无对应后端端点，保持 disabled（见 completion-plan）。 */}
            <Button variant="outline" size="md" disabled>
              <Icon name="user-switch" size="xs" fallback="placeholder" />
              <span>修改主管理员</span>
            </Button>
            {/* 凭据操作（重置密码）须经 IdP 内部端点，不在本轮直写库（见 completion-plan）。 */}
            <Button variant="outline" size="md" disabled>
              <Icon name="key" size="xs" fallback="placeholder" />
              <span>重置密码</span>
            </Button>
          </div>
        </div>
      </section>

      <section className="col-span-full grid min-w-0 gap-lg pt-xs">
        <header>
          <DetailSectionHeading icon="info" title="运营备注" />
        </header>
        <p className="m-0 text-body-sm leading-relaxed font-semibold text-foreground">
          {tenant.notes}
        </p>
        <div className="flex flex-wrap items-center gap-xs">
          {tenant.tags.map((tag) => (
            <StatusBadge key={tag} tone="brand" icon={false}>
              {tag}
            </StatusBadge>
          ))}
        </div>
      </section>
    </div>
  );
}

function MemberActionsMenu({
  member,
  actions,
}: {
  member: TenantMemberView;
  actions: MemberActionHandlers;
}) {
  const withLabels = useConfirmLabels();
  const isSuspended = member.status === "suspended";

  return (
    <div
      className="relative z-[1] inline-flex justify-self-center"
      onClick={(event) => event.stopPropagation()}
    >
      <ActionMenu
        label={`${member.name} 操作`}
        items={[
          {
            id: "role",
            label: "调整权限",
            icon: "user-switch",
            disabled: actions.busy,
            onSelect: () => actions.onChangeRole(member),
          },
          {
            // 凭据操作（重置密码）须经 IdP 内部端点，不在本轮直写库（见 completion-plan）。
            id: "password",
            label: "重置密码",
            icon: "key",
            disabled: true,
          },
          {
            // 仅提供停用；成员「恢复」暂无对应后端端点，已停用时置灰（见 completion-plan）。
            id: "status",
            label: isSuspended ? "恢复账号" : "停用账号",
            icon: isSuspended ? "success" : "warning",
            disabled: actions.busy || isSuspended,
            onSelect: () => actions.onSuspend(member),
          },
          {
            id: "remove",
            label: "移除账号",
            icon: "trash",
            disabled: actions.busy,
            danger: true,
            confirm: withLabels({
              verb: "移除",
              target: `${member.name}（${member.email || member.userId}）`,
              consequence:
                "移除后该成员立刻失去本租户的全部访问权。账号本身不受影响，重新加入需要再发一次邀请。",
              onConfirm: () => actions.onRemove(member),
            }),
          },
        ]}
      />
    </div>
  );
}

/**
 * 成员列表原来是一套手搓的 grid「表格」：一行 header + 每行一个 `display:grid`
 * 的 div，列宽靠 `grid-template-columns` 在两个选择器里各写一遍对齐，序号列与
 * 操作列的居中、列锁定、加载骨架、空态全部自己来。
 *
 * 换 `DataTable`：序号列（`indexStart`）与固定 64px 的行操作列（`rowActions`）
 * 都是它的既有契约，admin 的列表页惯例本来就长这样。
 */
function useTenantMemberColumns(): DataTableColumn<TenantMemberView>[] {
  const locale = useLocale();
  const tShared = useTranslations();

  return [
    {
      id: "account",
      header: "账号",
      cell: (member) => (
        <TableTitleCell
          icon={member.role.toLowerCase() === "owner" ? "shield-check" : "user"}
          title={member.name}
          description={`${getMemberAccountCode(member)} · ${member.email}`}
        />
      ),
    },
    {
      id: "permission",
      header: "权限",
      align: "center",
      cell: (member) => <Badge>{member.role}</Badge>,
    },
    {
      id: "status",
      header: tShared("columns.state"),
      align: "center",
      cell: (member) => {
        const statusTime = formatDate(getMemberStatusTime(member), locale);
        return (
          <TableTitleCell
            title={
              <StatusBadge tone={MEMBER_STATUS_TONE[member.status]}>
                {memberStatusLabel(member.status)}
              </StatusBadge>
            }
            description={statusTime}
            tooltip={`注册激活时间 ${statusTime}`}
          />
        );
      },
    },
    {
      id: "lastActive",
      header: "最近活跃",
      align: "center",
      cell: (member) => (
        <TableTitleCell
          title={formatDate(member.lastActiveAt, locale)}
          description={resolveIpLocation(member.lastActiveIp)}
          tooltip={
            member.lastActiveIp
              ? `登录 IP ${member.lastActiveIp}`
              : "暂无登录 IP"
          }
        />
      ),
    },
  ];
}

function TenantMemberList({
  members,
  actions,
}: {
  members: TenantMemberView[];
  actions: MemberActionHandlers;
}) {
  const columns = useTenantMemberColumns();
  return (
    <DataTable
      columns={columns}
      rows={members}
      rowKey={(member) => member.id}
      indexStart={1}
      rowActions={(member) => (
        <MemberActionsMenu member={member} actions={actions} />
      )}
      aria-label="账号列表"
    />
  );
}

function TenantMemberCards({
  members,
  actions,
}: {
  members: TenantMemberView[];
  actions: MemberActionHandlers;
}) {
  const locale = useLocale();
  return (
    <ListCardGrid aria-label="账号卡片">
      {members.map((member) => {
        const location = resolveIpLocation(member.lastActiveIp);
        const statusTime = formatDate(getMemberStatusTime(member), locale);

        return (
          <MetricListCard
            key={member.id}
            icon={
              member.role.toLowerCase() === "owner" ? "shield-check" : "user"
            }
            title={member.name}
            description={`${getMemberAccountCode(member)} · ${member.email}`}
            tone={MEMBER_STATUS_TONE[member.status]}
            actions={<MemberActionsMenu member={member} actions={actions} />}
            badges={
              <>
                <Badge>{member.role}</Badge>
                <StatusBadge tone={MEMBER_STATUS_TONE[member.status]}>
                  {memberStatusLabel(member.status)}
                </StatusBadge>
              </>
            }
            metrics={[
              { key: "registered", value: statusTime, label: "注册激活" },
              {
                key: "lastActive",
                value: formatDate(member.lastActiveAt, locale),
                label: location,
              },
            ]}
          />
        );
      })}
    </ListCardGrid>
  );
}

function TenantMembersTab({ tenantId }: { tenantId: string }) {
  const tShared = useTranslations();
  const { toast } = useToast();
  const [members, setMembers] = useState<TenantMemberView[]>([]);
  const [roleChoices, setRoleChoices] = useState<MemberRoleOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);
  const [viewMode, setViewMode] = useState<MemberViewMode>("list");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<MemberStatusFilter>("all");
  const [roleFilter, setRoleFilter] = useState<MemberRoleFilter>("all");
  const [roleTarget, setRoleTarget] = useState<TenantMemberView | null>(null);
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [roleError, setRoleError] = useState<string | null>(null);

  const loadMembers = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const records = await fetchTenantMembers(tenantId);
        setMembers(
          records
            .filter((record) => record.status !== "removed")
            .map(toMemberView),
        );
        // 调整权限候选：从成员记录派生出去重的 tenant 作用域角色（后端要求 role_scope='tenant'）。
        const choices = new Map<string, string>();
        for (const record of records) {
          if (record.roleScope === "tenant" && record.roleId) {
            choices.set(
              record.roleId,
              record.roleName || record.roleCode || record.roleId,
            );
          }
        }
        setRoleChoices(
          Array.from(choices, ([roleId, label]) => ({ roleId, label })).sort(
            (left, right) => left.label.localeCompare(right.label),
          ),
        );
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [tenantId],
  );

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  const roleOptions = useMemo(
    () =>
      Array.from(new Set(members.map((member) => member.role))).sort(
        (left, right) => left.localeCompare(right),
      ),
    [members],
  );
  const filteredMembers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return members.filter((member) => {
      const matchQuery = normalizedQuery
        ? getMemberSearchText(member).includes(normalizedQuery)
        : true;
      const matchStatus =
        statusFilter === "all" || member.status === statusFilter;
      const matchRole = roleFilter === "all" || member.role === roleFilter;
      return matchQuery && matchStatus && matchRole;
    });
  }, [members, query, roleFilter, statusFilter]);

  const activeCount = members.filter(
    (member) => member.status === "active",
  ).length;
  const invitedCount = members.filter(
    (member) => member.status === "invited",
  ).length;
  const suspendedCount = members.filter(
    (member) => member.status === "suspended",
  ).length;

  function handleReset() {
    setQuery("");
    setStatusFilter("all");
    setRoleFilter("all");
  }

  function openRoleDialog(member: TenantMemberView) {
    setRoleTarget(member);
    setSelectedRoleId(member.roleId);
    setRoleError(null);
  }

  function closeRoleDialog() {
    if (actionBusy) return;
    setRoleTarget(null);
    setRoleError(null);
  }

  async function submitRoleChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!roleTarget || actionBusy) return;
    if (!selectedRoleId) {
      setRoleError("请选择目标角色。");
      return;
    }
    if (selectedRoleId === roleTarget.roleId) {
      setRoleError("请选择与当前不同的角色。");
      return;
    }

    setActionBusy(true);
    setRoleError(null);
    try {
      await changeTenantMemberRole(tenantId, roleTarget.userId, selectedRoleId);
      await loadMembers(true);
      toast({
        tone: "success",
        title: "已调整权限",
        description: `${roleTarget.name} 的租户角色已更新。`,
      });
      setRoleTarget(null);
    } catch (error) {
      setRoleError(
        error instanceof Error ? error.message : "调整权限失败，请稍后重试。",
      );
    } finally {
      setActionBusy(false);
    }
  }

  async function handleSuspendMember(member: TenantMemberView) {
    if (actionBusy) return;
    setActionBusy(true);
    try {
      await suspendTenantMember(tenantId, member.userId);
      await loadMembers(true);
      toast({
        tone: "success",
        title: "已停用账号",
        description: `${member.name} 已在该租户内停用。`,
      });
    } catch (error) {
      toast({
        tone: "danger",
        title: "操作失败",
        description:
          error instanceof Error ? error.message : "无法停用账号，请稍后重试。",
      });
    } finally {
      setActionBusy(false);
    }
  }

  /* 收参数而不是读 `removeTarget`：确认已经在菜单项那一层完成，那一层知道自己
     作用在哪一行，不必再把它存成一份组件状态。失败时照抄同文件
     `handleSuspendMember` 的收尾（toast 报错），但要重新抛出——DS 的确认件按
     Promise 是否 rejected 决定关不关框，吞掉异常会让失败看起来像成功。 */
  async function handleRemoveMember(member: TenantMemberView) {
    if (actionBusy) return;
    setActionBusy(true);
    try {
      await removeTenantMember(tenantId, member.userId);
      await loadMembers(true);
      toast({
        tone: "success",
        title: "已移除账号",
        description: `${member.name} 已从该租户移除。`,
      });
    } catch (error) {
      toast({
        tone: "danger",
        title: "移除失败",
        description:
          error instanceof Error ? error.message : "移除账号失败，请稍后重试。",
      });
      throw error;
    } finally {
      setActionBusy(false);
    }
  }

  const memberActions: MemberActionHandlers = {
    busy: actionBusy,
    onChangeRole: openRoleDialog,
    onSuspend: handleSuspendMember,
    onRemove: handleRemoveMember,
  };

  return (
    <div className="grid min-w-0 gap-0">
      <section
        className="flex min-w-0 items-center gap-md pt-0 pb-md max-xl:flex-wrap max-lg:items-stretch"
        aria-label="账号筛选"
      >
        <ViewModeSwitch
          value={viewMode}
          onChange={setViewMode}
          ariaLabel="账号展示方式"
        />
        <span className="inline-flex min-h-control-lg items-center pl-xs text-body-md font-extrabold whitespace-nowrap text-foreground max-lg:mr-auto">
          {formatNumber(filteredMembers.length)}
        </span>
        <div
          className="flex flex-wrap items-center gap-xs"
          aria-label="账号统计"
        >
          <StatusBadge tone={"success"}>
            活跃 {formatNumber(activeCount)}
          </StatusBadge>
          <StatusBadge tone={"brand"}>
            邀请 {formatNumber(invitedCount)}
          </StatusBadge>
          <StatusBadge tone={"danger"}>
            停用 {formatNumber(suspendedCount)}
          </StatusBadge>
        </div>
        <span className="flex-1 max-lg:hidden" aria-hidden="true" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索账号、账号代码、邮箱"
          className="grow basis-media-3xl max-w-panel-sm"
          aria-label="搜索账号"
        />
        <Button variant="outline" onClick={handleReset}>
          重置
        </Button>
        <NativeSelect
          className="w-fit basis-media-xl"
          value={statusFilter}
          onChange={(event) =>
            setStatusFilter(event.target.value as MemberStatusFilter)
          }
          aria-label="账号状态"
        >
          <option value="all">{tShared("filters.allStates")}</option>
          <option value="active">{tShared("status.generic.normal")}</option>
          <option value="invited">邀请中</option>
          <option value="suspended">{tShared("actions.disable")}</option>
        </NativeSelect>
        <NativeSelect
          className="w-fit basis-media-xl"
          value={roleFilter}
          onChange={(event) => setRoleFilter(event.target.value)}
          aria-label="账号权限"
        >
          <option value="all">全部权限</option>
          {roleOptions.map((role) => (
            <option key={role} value={role}>
              {role}
            </option>
          ))}
        </NativeSelect>
      </section>

      <section className="grid min-w-0 max-w-full gap-xs" aria-label="账号清单">
        {filteredMembers.length ? (
          viewMode === "list" ? (
            <TenantMemberList
              members={filteredMembers}
              actions={memberActions}
            />
          ) : (
            <TenantMemberCards
              members={filteredMembers}
              actions={memberActions}
            />
          )
        ) : (
          <EmptyState
            title={loading ? "正在加载账号" : "没有匹配的账号"}
            description={
              loading
                ? "正在读取租户成员数据。"
                : "清空筛选条件后可查看全部账号。"
            }
            action={
              loading ? undefined : (
                <Button variant="outline" onClick={handleReset}>
                  {tShared("common.clearFilters")}
                </Button>
              )
            }
          />
        )}
      </section>

      {roleTarget ? (
        <DialogForm
          open
          title="调整成员权限"
          description={`为 ${roleTarget.name} 选择新的租户角色，保存后立即生效。`}
          submitLabel="确认调整"
          cancelLabel={tShared("actions.cancel")}
          submitting={actionBusy}
          submitDisabled={
            !selectedRoleId || selectedRoleId === roleTarget.roleId
          }
          onOpenChange={(open) => {
            if (!open) closeRoleDialog();
          }}
          onSubmit={(event) => void submitRoleChange(event)}
        >
          <Label htmlFor="vx-member-role-select">目标角色</Label>
          <NativeSelect
            id="vx-member-role-select"
            className="w-fit basis-media-xl"
            value={selectedRoleId}
            onChange={(event) => setSelectedRoleId(event.target.value)}
            aria-label="目标角色"
            autoFocus
          >
            {roleChoices.length ? (
              roleChoices.map((choice) => (
                <option key={choice.roleId} value={choice.roleId}>
                  {choice.label}
                </option>
              ))
            ) : (
              <option value="">暂无可选角色</option>
            )}
          </NativeSelect>
          {roleError ? (
            <p className="m-0 text-body-sm text-destructive-text" role="alert">
              {roleError}
            </p>
          ) : null}
        </DialogForm>
      ) : null}
    </div>
  );
}

function TenantSubscriptionsTab({
  subscriptions,
}: {
  subscriptions: TenantOperationSubscription[];
}) {
  const locale = useLocale();
  return (
    <div className="grid min-w-0 gap-lg">
      {subscriptions.map((subscription) => (
        <MetricListCard
          key={subscription.id}
          icon="star"
          title={subscription.productName}
          description={subscription.releaseName}
          tone={TENANT_SUBSCRIPTION_TONE[subscription.status]}
          badges={
            <StatusBadge tone={TENANT_SUBSCRIPTION_TONE[subscription.status]}>
              {subscriptionStatusLabel(subscription.status)}
            </StatusBadge>
          }
          metrics={[
            {
              key: "plan",
              value: subscription.planName,
              label: "发布版本",
            },
            {
              key: "seats",
              value: formatNumber(subscription.seats),
              label: "席位",
            },
            {
              key: "revenue",
              value: formatMoney(subscription.monthlyRevenue),
              label: "月收入",
            },
            {
              key: "renews",
              value: formatDate(subscription.renewsAt, locale),
              label: "续费时间",
            },
          ]}
        />
      ))}
    </div>
  );
}

/**
 * 用量条的填充色。
 *
 * `Progress` 的填充写死 `bg-primary`、没有语气 prop，所以用子元素变体改它
 * ——这正是原来 `--usage-tone` 三个修饰类在做的事，只是不再经一层自定义属性。
 */
const USAGE_TRACK_TONE: Record<TenantOperationUsageMetric["status"], string> = {
  normal: "[&>*]:bg-success",
  warning: "[&>*]:bg-warning",
  danger: "[&>*]:bg-destructive",
};

function TenantUsageTab({ usage }: { usage: TenantOperationUsageMetric[] }) {
  return (
    <div className="grid min-w-0 gap-lg">
      {usage.map((metric) => {
        const percent = usagePercent(metric);
        return (
          <article
            key={metric.code}
            className="grid min-w-0 gap-md border-b border-dashed border-primary/10 pb-lg"
          >
            <header className="flex min-w-0 items-center justify-between gap-md">
              <strong className="text-title-md font-extrabold text-foreground">
                {metric.label}
              </strong>
              <span className="text-body-sm font-semibold text-primary-text">
                {metric.trend}
              </span>
            </header>
            <div className="flex min-w-0 items-baseline justify-between gap-md">
              <b className="text-title-xl text-foreground">
                {formatNumber(metric.used)}
              </b>
              <small className="text-body-sm font-semibold text-muted-foreground">
                {metric.quota === null
                  ? "不限量"
                  : ` / ${formatNumber(metric.quota)} ${metric.unit}`}
              </small>
            </div>
            {/* 原来是手搓的轨道 + 一个按百分比改宽度的 span，语气色靠
                `--usage-tone` 三个修饰类给。DS `Progress` 的填充用位移不改宽度
                （不触发布局），语气改由调用方给填充色。 */}
            <Progress
              value={percent}
              aria-label={`${metric.label} 用量`}
              className={USAGE_TRACK_TONE[metric.status]}
            />
          </article>
        );
      })}
    </div>
  );
}

function TenantModelsTab({
  policies,
}: {
  policies: TenantOperationModelPolicy[];
}) {
  const tShared = useTranslations();
  const columns: DataTableColumn<TenantOperationModelPolicy>[] = [
    {
      id: "agent",
      header: "智能体",
      cell: (policy) => (
        <TableTitleCell
          title={policy.agentName}
          description={policySourceLabel(policy.source)}
        />
      ),
    },
    { id: "product", header: "产品", cell: (policy) => policy.productName },
    { id: "model", header: "模型", cell: (policy) => policy.modelCode },
    {
      id: "quota",
      header: "配额",
      align: "right",
      cell: (policy) =>
        `${formatNumber(policy.usedTokens)} / ${formatNumber(policy.quotaTokens)}`,
    },
    {
      id: "state",
      header: tShared("columns.state"),
      align: "center",
      cell: (policy) => (
        <StatusBadge tone={POLICY_STATE_TONE[policy.state]}>
          {modelPolicyStateLabel(policy.state)}
        </StatusBadge>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={policies}
      rowKey={(policy) => policy.id}
      aria-label="模型授权"
    />
  );
}

/** 风险档的文字色。照 `.vx-tenant-risk-text--*` 实测的前景定。 */
const RISK_TEXT_TONE: Record<string, string> = {
  normal: "text-muted-foreground",
  follow_up: "text-warning-text",
  high: "text-destructive-text",
};

function TenantRiskTab({ tenant }: { tenant: TenantOperationRecord }) {
  const locale = useLocale();
  return (
    <div className="grid min-w-0 grid-cols-1 gap-lg xl:grid-cols-3">
      <Section
        level={3}
        icon="shield-check"
        title="风险状态"
        className="min-w-0 content-start border-primary/15 xl:border-r xl:border-dashed xl:pr-lg"
      >
        <div className="flex min-w-0 flex-wrap items-baseline gap-md">
          <strong
            className={`text-title-xl font-extrabold ${RISK_TEXT_TONE[normalizeTenantRiskLevel(tenant.riskLevel)]}`}
          >
            {riskLabel(tenant.riskLevel)}
          </strong>
          <span className="text-body-sm text-muted-foreground">
            {verifiedLabel(tenant.verifiedStatus)}
          </span>
          <span className="text-body-sm text-muted-foreground">
            {tenant.ticketOpenCount} 个未结工单
          </span>
        </div>
        <p className="m-0 text-body-sm leading-relaxed text-foreground">
          {tenant.notes}
        </p>
      </Section>

      <Section
        level={3}
        icon="table"
        title="审计记录"
        className="min-w-0 xl:col-span-2"
      >
        <PanelList empty="暂无审计记录">
          {tenant.auditEvents.map((event) => (
            <PanelItem
              key={event.id}
              main={
                <TableTitleCell
                  title={event.action}
                  description={event.actor}
                />
              }
              trail={
                <span className="flex items-center gap-md">
                  <span className="whitespace-nowrap text-body-sm text-muted-foreground">
                    {formatDate(event.at, locale)}
                  </span>
                  <StatusBadge tone={AUDIT_RESULT_TONE[event.result]}>
                    {auditResultLabel(event.result)}
                  </StatusBadge>
                </span>
              }
            />
          ))}
        </PanelList>
      </Section>
    </div>
  );
}

function TenantTicketsTab({ tenant }: { tenant: TenantOperationRecord }) {
  const locale = useLocale();
  if (!tenant.tickets.length) {
    return (
      <EmptyState
        title="暂无未结工单"
        description="该租户当前没有需要平台运营跟进的工单。"
      />
    );
  }

  return (
    <PanelList>
      {tenant.tickets.map((ticket) => (
        <PanelItem
          key={ticket.id}
          main={
            <TableTitleCell
              title={ticket.title}
              description={`${ticket.id} · ${ticket.priority.toUpperCase()}`}
            />
          }
          trail={
            <span className="flex items-center gap-md">
              <StatusBadge tone={TICKET_STATUS_TONE[ticket.status]}>
                {ticketStatusLabel(ticket.status)}
              </StatusBadge>
              <span className="whitespace-nowrap text-body-sm text-muted-foreground">
                {formatDate(ticket.updatedAt, locale)}
              </span>
            </span>
          }
        />
      ))}
    </PanelList>
  );
}

export function TenantDetailPage({ tenantId }: { tenantId: string }) {
  const { toast } = useToast();
  const [tenants, setTenants] = useState<TenantOperationRecord[]>([]);
  const [activeTab, setActiveTab] = useState<TenantTabId>("info");
  const [summaryExpanded, setSummaryExpanded] = useState(true);
  const [infoEditing, setInfoEditing] = useState(false);
  const [infoDraft, setInfoDraft] = useState<TenantInfoDraft | null>(null);
  const [infoBaseline, setInfoBaseline] = useState<TenantInfoDraft | null>(
    null,
  );
  const [savingInfo, setSavingInfo] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);

    fetchTenantOperations()
      .then((records) => {
        if (active) setTenants(records);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const tenant = useMemo(
    () =>
      tenants.find(
        (item) => item.id === tenantId || item.tenantCode === tenantId,
      ),
    [tenantId, tenants],
  );

  useEffect(() => {
    if (!tenant) return;
    const nextDraft = createTenantInfoDraft(tenant);
    setInfoDraft(nextDraft);
    setInfoBaseline(nextDraft);
    setInfoEditing(false);
  }, [tenant]);

  const infoDirty = useMemo(
    () => isTenantInfoDirty(infoDraft, infoBaseline),
    [infoDraft, infoBaseline],
  );

  if (!tenant) {
    return (
      <ViewLayout className="w-full ">
        <Link
          className="inline-flex min-h-icon-xl w-fit items-center gap-xs text-body-sm font-extrabold text-primary-text no-underline"
          href="/tenants"
        >
          <Icon name="arrow-left" size="xs" fallback="placeholder" />
          返回租户列表
        </Link>
        <EmptyState
          title={loading ? "正在加载租户" : "未找到租户"}
          description={
            loading
              ? "正在读取租户详情。"
              : "该租户不存在，或当前筛选数据源尚未同步。"
          }
        />
      </ViewLayout>
    );
  }

  const visibleInfoDraft = infoDraft ?? createTenantInfoDraft(tenant);
  const currentTenantId = tenant.id;
  const showVerificationReview = tenant.verifiedStatus !== "verified";
  const subscriptionSummary = getTenantSubscriptionSummary(tenant);
  const cumulativeRevenue = getTenantCumulativeRevenue(tenant);

  function handleInfoDraftChange<K extends keyof TenantInfoDraft>(
    field: K,
    value: TenantInfoDraft[K],
  ) {
    setInfoDraft((current) => ({
      ...(current ?? visibleInfoDraft),
      [field]: value,
    }));
  }

  function handleInfoReset() {
    if (!infoBaseline) return;
    setInfoDraft(infoBaseline);
    setInfoEditing(false);
  }

  async function handleInfoSave() {
    if (savingInfo) return;

    // 仅提交 UpdateTenantInput 支持的可编辑字段：name（→ tenants.name，后端同步 displayName）
    // 与 status。租户代码/类型/简称无对应写字段，本轮不持久化（见 openIssues）。
    const payload: UpdateTenantInput = { name: visibleInfoDraft.tenantName };
    if (
      visibleInfoDraft.status === "active" ||
      visibleInfoDraft.status === "suspended" ||
      visibleInfoDraft.status === "cancelled"
    ) {
      payload.status = visibleInfoDraft.status;
    }
    // 'trial' 无 DB 值，后端会 400；此处不下发 status，保持库内原状态（见 openIssues）。

    setSavingInfo(true);
    try {
      const updated = await updateTenant(currentTenantId, payload);
      setTenants((records) =>
        records.map((record) =>
          record.id === currentTenantId ? updated : record,
        ),
      );
      const nextDraft = createTenantInfoDraft(updated);
      setInfoDraft(nextDraft);
      setInfoBaseline(nextDraft);
      setInfoEditing(false);
      toast({
        tone: "success",
        title: "已保存租户信息",
        description: `${updated.displayName} 的基础资料已更新。`,
      });
    } catch (error) {
      toast({
        tone: "danger",
        title: "保存失败",
        description:
          error instanceof Error
            ? error.message
            : "无法保存租户信息，请稍后重试。",
      });
    } finally {
      setSavingInfo(false);
    }
  }

  function handleInfoEdit() {
    setActiveTab("info");
    setInfoEditing(true);
  }

  async function handleCopyText(value: string) {
    if (!value) return;
    await navigator.clipboard?.writeText(value);
  }

  return (
    <DetailPageTemplate
      className="w-full "
      header={
        <>
          <Link
            className="inline-flex min-h-icon-xl w-fit items-center gap-xs text-body-sm font-extrabold text-primary-text no-underline"
            href="/tenants"
          >
            <Icon name="arrow-left" size="xs" fallback="placeholder" />
            返回租户列表
          </Link>

          {/* 概要卡：托起的面板 + 顶缘语气色条 + 右上角折叠钮。折叠态只收掉
              留白与读数列，身份行仍在——收起后要还能看出这是谁。 */}
          <section
            className={`relative grid min-w-0 rounded-xl border-t-2 border-primary/30 bg-card/60 px-xl ${
              summaryExpanded ? "gap-lg py-xl" : "gap-0 py-sm"
            }`}
            aria-label={`${tenant.displayName} 标题概要`}
          >
            <Button
              className="absolute top-sm right-sm z-[1]"
              variant="ghost"
              size="icon-md"
              aria-expanded={summaryExpanded}
              aria-label={summaryExpanded ? "收起标题概要" : "展开标题概要"}
              title={summaryExpanded ? "收起标题概要" : "展开标题概要"}
              onClick={() => setSummaryExpanded((expanded) => !expanded)}
            >
              <Icon
                name={summaryExpanded ? "chevron-up" : "chevron-down"}
                size="xs"
                fallback="chevron-down"
              />
            </Button>

            <header
              className={
                summaryExpanded
                  ? "grid min-w-0 grid-cols-1 gap-xl xl:grid-cols-3 xl:[&>section:not(:last-child)]:border-r xl:[&>section:not(:last-child)]:border-dashed xl:[&>section:not(:last-child)]:border-primary/15 xl:[&>section:not(:last-child)]:pr-lg"
                  : "grid min-w-0 grid-cols-1 pr-3xl"
              }
            >
              <section
                className={
                  summaryExpanded
                    ? "flex min-w-0 items-start gap-xl"
                    : "flex min-w-0 items-center gap-sm"
                }
                aria-label="租户概要"
              >
                <span
                  className={`inline-grid shrink-0 place-items-center text-primary-text ${
                    summaryExpanded ? "size-icon-xl" : "size-icon-lg"
                  }`}
                  aria-hidden="true"
                >
                  <Icon
                    name={
                      tenant.tenantType === "company" ? "buildings" : "user"
                    }
                    size={summaryExpanded ? "lg" : "sm"}
                    fallback="placeholder"
                  />
                </span>
                <div
                  className={
                    summaryExpanded
                      ? "grid min-w-0 gap-2xs"
                      : "flex min-w-0 items-center gap-sm"
                  }
                >
                  {/* 复制钮平时隐形、悬停或聚焦时显形——`group` 挂在这一行上，
                      不能挂到外层，否则整块任意位置悬停都会把它唤出来。 */}
                  <div className="group flex min-w-0 items-center gap-xs">
                    <h2
                      className={`min-w-0 truncate font-semibold text-foreground ${
                        summaryExpanded ? "text-title-xl" : "text-title-md"
                      }`}
                    >
                      {tenant.displayName}
                    </h2>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                      aria-label="复制租户名称"
                      title="复制租户名称"
                      onClick={() => void handleCopyText(tenant.displayName)}
                    >
                      <Icon name="copy" size="xs" fallback="placeholder" />
                    </Button>
                  </div>
                  <div className="group flex min-w-0 shrink-0 items-center gap-xs">
                    <p className="m-0 min-w-0 truncate text-body-sm font-extrabold text-muted-foreground">
                      {tenant.tenantCode}
                    </p>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                      aria-label="复制租户代码"
                      title="复制租户代码"
                      onClick={() => void handleCopyText(tenant.tenantCode)}
                    >
                      <Icon name="copy" size="xs" fallback="placeholder" />
                    </Button>
                  </div>
                  <div
                    className={`flex items-center gap-xs ${
                      summaryExpanded ? "flex-wrap" : "flex-nowrap"
                    }`}
                  >
                    <StatusBadge tone={TENANT_STATUS_TONE[tenant.status]}>
                      {statusLabel(tenant.status)}
                    </StatusBadge>
                    <StatusBadge
                      tone={VERIFICATION_TONE[tenant.verifiedStatus]}
                    >
                      {verifiedLabel(tenant.verifiedStatus)}
                    </StatusBadge>
                    <StatusBadge
                      tone={
                        TENANT_RISK_TONE[
                          normalizeTenantRiskLevel(tenant.riskLevel)
                        ]
                      }
                    >
                      {riskLabel(tenant.riskLevel)}
                    </StatusBadge>
                  </div>
                </div>
              </section>

              {summaryExpanded ? (
                <>
                  <section
                    className="grid min-w-0 content-center gap-md"
                    aria-label="成员和订阅概要"
                  >
                    <TenantKeyMetric
                      label="用户数量"
                      value={formatNumber(tenant.memberCount)}
                      tag={`活跃 ${formatNumber(tenant.activeMemberCount)}`}
                    />
                    <TenantKeyMetric
                      label="订阅产品"
                      value={formatNumber(tenant.subscriptionCount)}
                      tags={[
                        `智能体${formatNumber(subscriptionSummary.agentCount)}个`,
                        `平台${formatNumber(subscriptionSummary.platformCount)}个`,
                      ]}
                    />
                  </section>

                  <section
                    className="grid min-w-0 content-center gap-md"
                    aria-label="用量和收入概要"
                  >
                    <TenantKeyMetric
                      label="配额消耗"
                      value={formatNumber(tenant.tokenUsed)}
                      tag="token"
                    />
                    <TenantKeyMetric
                      label="本月收入"
                      value={formatMoney(tenant.monthlyRevenue)}
                      tag={`累计 ${formatMoney(cumulativeRevenue)}`}
                    />
                  </section>
                </>
              ) : null}
            </header>
          </section>
        </>
      }
    >
      <section
        className="grid min-w-0"
        aria-label={`${tenant.displayName} 管理详情`}
      >
        {/* 原来是手搓的分区条：`role="tablist"` 的 div 里排一串 Button，选中态靠
         * 一个 `.is-active::after` 画下划线，键盘左右键、`aria-controls`、
         * roving tabindex 一概没有。换成 DS `Tabs`（Radix）——那些无障碍行为是
         * 它的契约。代价是形态从下划线条变成胶囊组，这是 DS 的既定长相。 */}
        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as TenantTabId)}
          className="grid min-w-0 gap-lg"
        >
          <TabsList
            className="h-auto max-w-full flex-wrap justify-start"
            aria-label={`${tenant.displayName} 信息分区`}
          >
            {tenantTabs.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id} className="flex-none">
                <Icon name={tab.icon} size="xs" fallback="placeholder" />
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="info" className="min-w-0">
            <TenantInfoTab
              tenant={tenant}
              draft={visibleInfoDraft}
              editing={infoEditing}
              infoDirty={infoDirty}
              saving={savingInfo}
              showVerificationReview={showVerificationReview}
              reviewHref={`/verifications?tenantId=${encodeURIComponent(tenant.id)}`}
              onDraftChange={handleInfoDraftChange}
              onEdit={handleInfoEdit}
              onReset={handleInfoReset}
              onSave={() => void handleInfoSave()}
            />
          </TabsContent>
          <TabsContent value="members" className="min-w-0">
            <TenantMembersTab tenantId={tenant.id} />
          </TabsContent>
          <TabsContent value="subscriptions" className="min-w-0">
            <TenantSubscriptionsTab subscriptions={tenant.subscriptions} />
          </TabsContent>
          <TabsContent value="usage" className="min-w-0">
            <TenantUsageTab usage={tenant.usage} />
          </TabsContent>
          <TabsContent value="models" className="min-w-0">
            <TenantModelsTab policies={tenant.modelPolicies} />
          </TabsContent>
          <TabsContent value="risk" className="min-w-0">
            <TenantRiskTab tenant={tenant} />
          </TabsContent>
          <TabsContent value="tickets" className="min-w-0">
            <TenantTicketsTab tenant={tenant} />
          </TabsContent>
        </Tabs>
      </section>
    </DetailPageTemplate>
  );
}
