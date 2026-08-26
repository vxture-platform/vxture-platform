"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { FormEvent, ReactNode } from "react";
import Link from "next/link";
import {
  ActionMenu,
  Badge,
  Button,
  DetailPageTemplate,
  DialogForm,
  EmptyState,
  Icon,
  Input,
  NativeSelect,
  StatusBadge,
  useToast,
  ViewLayout,
  ViewModeSwitch,
} from "@vxture/design-system";
import type { IconName } from "@vxture/design-system";
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

  return (
    <div className="vx-tenant-key-metric">
      <span>{label}</span>
      <p>
        <strong className={danger ? "is-danger" : undefined}>{value}</strong>
        {visibleTags.map((item) => (
          <em key={item}>{item}</em>
        ))}
      </p>
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
      className={
        className
          ? `vx-tenant-config-item ${className}`
          : "vx-tenant-config-item"
      }
    >
      <span>{label}</span>
      <div className="vx-tenant-config-item__value">{children}</div>
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
    <div className="vx-tenant-tab-grid vx-tenant-tab-grid--info">
      <section className="vx-tenant-block">
        <header>
          <DetailSectionHeading icon="buildings" title="基础资料" />
          <div className="vx-tenant-block__actions" aria-label="基础资料操作">
            {editing ? (
              <>
                {infoDirty ? (
                  <span className="vx-tenant-unsaved">有未保存修改</span>
                ) : null}
                <Button variant="outline" disabled={saving} onClick={onReset}>
                  {tShared("actions.discard")}
                </Button>
                <Button
                  className={infoDirty ? "vx-tenant-save-alert" : undefined}
                  disabled={!infoDirty || saving}
                  onClick={onSave}
                >
                  {saving ? "保存中..." : "保存"}
                </Button>
              </>
            ) : (
              <>
                {showVerificationReview ? (
                  <Link className="vx-tenant-review-action" href={reviewHref}>
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
        <div className="vx-tenant-config-stack">
          <div className="vx-tenant-config-row vx-tenant-config-row--three">
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

          <div className="vx-tenant-config-row vx-tenant-config-row--three">
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

          <div className="vx-tenant-config-row vx-tenant-config-row--three">
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

      <section className="vx-tenant-block">
        <header>
          <DetailSectionHeading icon="user-switch" title="主管理员" />
        </header>
        <div className="vx-tenant-config-row vx-tenant-config-row--contact">
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
          <div className="vx-tenant-admin-actions">
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

      <section className="vx-tenant-block vx-tenant-block--wide">
        <header>
          <DetailSectionHeading icon="info" title="运营备注" />
        </header>
        <p className="vx-tenant-note">{tenant.notes}</p>
        <div className="vx-tenant-tags">
          {tenant.tags.map((tag) => (
            <span key={tag}>{tag}</span>
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
      className="relative z-[1] inline-flex justify-self-end vx-tenant-member-actions"
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

function TenantMemberIdentity({ member }: { member: TenantOperationMember }) {
  return (
    <span className="vx-tenant-member-row__identity">
      <Icon
        name={member.role.toLowerCase() === "owner" ? "shield-check" : "user"}
        size="sm"
        fallback="placeholder"
      />
      <span className="vx-tenant-member-row__name">
        <strong>{member.name}</strong>
        <small>{getMemberAccountCode(member)}</small>
        <small>{member.email}</small>
      </span>
    </span>
  );
}

function TenantMemberStatus({ member }: { member: TenantOperationMember }) {
  const locale = useLocale();
  const statusTimeValue = getMemberStatusTime(member);
  const statusTime = formatDate(statusTimeValue, locale);

  return (
    <span className="vx-tenant-member-row__status">
      <StatusBadge tone={MEMBER_STATUS_TONE[member.status]}>
        {memberStatusLabel(member.status)}
      </StatusBadge>
      <small
        title={`注册激活时间 ${statusTime}`}
        aria-label={`注册激活时间 ${statusTime}`}
      >
        {statusTime}
      </small>
    </span>
  );
}

function TenantMemberActiveAt({ member }: { member: TenantOperationMember }) {
  const locale = useLocale();
  const location = resolveIpLocation(member.lastActiveIp);

  return (
    <span>
      <strong>{formatDate(member.lastActiveAt, locale)}</strong>
      <small
        title={
          member.lastActiveIp ? `登录 IP ${member.lastActiveIp}` : "暂无登录 IP"
        }
      >
        {location}
      </small>
    </span>
  );
}

function TenantMemberList({
  members,
  actions,
}: {
  members: TenantMemberView[];
  actions: MemberActionHandlers;
}) {
  const tShared = useTranslations();
  return (
    <div className="vx-tenant-member-list" role="region" aria-label="账号列表">
      <div className="vx-tenant-member-list__header">
        <span>#</span>
        <span>账号</span>
        <span>权限</span>
        <span>{tShared("columns.state")}</span>
        <span>最近活跃</span>
        <span>操作</span>
      </div>
      {members.map((member, index) => (
        <div
          key={member.id}
          className={joinClasses(
            "vx-tenant-member-row",
            `vx-tenant-member-row--${member.status}`,
          )}
        >
          <span className="vx-tenant-member-row__index">
            {formatNumber(index + 1)}
          </span>
          <TenantMemberIdentity member={member} />
          <span className="vx-tenant-member-row__permission">
            <Badge>{member.role}</Badge>
          </span>
          <TenantMemberStatus member={member} />
          <TenantMemberActiveAt member={member} />
          <MemberActionsMenu member={member} actions={actions} />
        </div>
      ))}
    </div>
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
    <div className="vx-tenant-member-cards" aria-label="账号卡片">
      {members.map((member) => {
        const location = resolveIpLocation(member.lastActiveIp);
        const statusTime = formatDate(getMemberStatusTime(member), locale);

        return (
          <article
            key={member.id}
            className={joinClasses(
              "vx-tenant-member-card",
              `vx-tenant-member-row--${member.status}`,
            )}
          >
            <header>
              <Icon
                name={
                  member.role.toLowerCase() === "owner"
                    ? "shield-check"
                    : "user"
                }
                size="lg"
                fallback="placeholder"
              />
              <div className="vx-tenant-member-row__name">
                <strong>{member.name}</strong>
                <small>{getMemberAccountCode(member)}</small>
                <small>{member.email}</small>
              </div>
              <MemberActionsMenu member={member} actions={actions} />
            </header>
            <div className="vx-tenant-member-card__badges">
              <Badge>{member.role}</Badge>
              <StatusBadge tone={MEMBER_STATUS_TONE[member.status]}>
                {memberStatusLabel(member.status)}
              </StatusBadge>
            </div>
            <div className="vx-tenant-member-card__metrics">
              <span>
                <strong>{statusTime}</strong>
                <small title={`注册激活时间 ${statusTime}`}>注册激活</small>
              </span>
              <span>
                <strong>{formatDate(member.lastActiveAt, locale)}</strong>
                <small
                  title={
                    member.lastActiveIp
                      ? `登录 IP ${member.lastActiveIp}`
                      : "暂无登录 IP"
                  }
                >
                  {location}
                </small>
              </span>
            </div>
          </article>
        );
      })}
    </div>
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
    <div className="grid min-w-0 vx-tenant-member-shell">
      <section
        className="vx-tenant-toolbar vx-tenant-member-toolbar"
        aria-label="账号筛选"
      >
        <ViewModeSwitch
          value={viewMode}
          onChange={setViewMode}
          ariaLabel="账号展示方式"
        />
        <span className="inline-flex min-h-control-lg items-center pl-xs text-body-md font-extrabold whitespace-nowrap text-foreground max-[60rem]:mr-auto">
          {formatNumber(filteredMembers.length)}
        </span>
        <div className="vx-tenant-member-summary" aria-label="账号统计">
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
        <span className="flex-1 max-[60rem]:hidden" aria-hidden="true" />
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

      <section
        className="grid min-w-0 max-w-full gap-xs vx-tenant-member-directory"
        aria-label="账号清单"
      >
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
          <label className="vx-tenant-member-role-field">
            <span>目标角色</span>
            <NativeSelect
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
          </label>
          {roleError ? (
            <p className="vx-tenant-member-action-error" role="alert">
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
    <div className="vx-tenant-subscriptions">
      {subscriptions.map((subscription) => (
        <article
          key={subscription.id}
          className={`vx-tenant-subscription vx-tenant-subscription--${subscription.status}`}
        >
          <header>
            <div>
              <strong>{subscription.productName}</strong>
              <span>{subscription.releaseName}</span>
            </div>
            <StatusBadge tone={TENANT_SUBSCRIPTION_TONE[subscription.status]}>
              {subscriptionStatusLabel(subscription.status)}
            </StatusBadge>
          </header>
          <div className="vx-tenant-subscription__metrics">
            <TenantKeyMetric label="发布版本" value={subscription.planName} />
            <TenantKeyMetric
              label="席位"
              value={formatNumber(subscription.seats)}
            />
            <TenantKeyMetric
              label="月收入"
              value={formatMoney(subscription.monthlyRevenue)}
            />
            <TenantKeyMetric
              label="续费时间"
              value={formatDate(subscription.renewsAt, locale)}
            />
          </div>
        </article>
      ))}
    </div>
  );
}

function TenantUsageTab({ usage }: { usage: TenantOperationUsageMetric[] }) {
  return (
    <div className="vx-tenant-usage-list">
      {usage.map((metric) => {
        const percent = usagePercent(metric);
        return (
          <article
            key={metric.code}
            className={`vx-tenant-usage vx-tenant-usage--${metric.status}`}
          >
            <header>
              <strong>{metric.label}</strong>
              <span>{metric.trend}</span>
            </header>
            <div className="vx-tenant-usage__numbers">
              <b>{formatNumber(metric.used)}</b>
              <small>
                {metric.quota === null
                  ? "不限量"
                  : ` / ${formatNumber(metric.quota)} ${metric.unit}`}
              </small>
            </div>
            <div className="vx-tenant-usage__bar" aria-hidden="true">
              <span style={{ width: `${percent}%` }} />
            </div>
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
  return (
    <div className="vx-tenant-table vx-tenant-table--models">
      <div className="vx-tenant-table__header">
        <span>智能体</span>
        <span>产品</span>
        <span>模型</span>
        <span>配额</span>
        <span>{tShared("columns.state")}</span>
      </div>
      {policies.map((policy) => (
        <div key={policy.id} className="vx-tenant-table__row">
          <span>
            <strong>{policy.agentName}</strong>
            <small>{policySourceLabel(policy.source)}</small>
          </span>
          <span>{policy.productName}</span>
          <span>{policy.modelCode}</span>
          <span>
            {formatNumber(policy.usedTokens)} /{" "}
            {formatNumber(policy.quotaTokens)}
          </span>
          <span>
            <StatusBadge tone={POLICY_STATE_TONE[policy.state]}>
              {modelPolicyStateLabel(policy.state)}
            </StatusBadge>
          </span>
        </div>
      ))}
    </div>
  );
}

function TenantRiskTab({ tenant }: { tenant: TenantOperationRecord }) {
  const locale = useLocale();
  return (
    <div className="vx-tenant-tab-grid vx-tenant-tab-grid--risk">
      <section className="vx-tenant-risk-panel">
        <header>
          <Icon name="shield-check" size="sm" fallback="placeholder" />
          <h3>风险状态</h3>
        </header>
        <div className="vx-tenant-risk-panel__level">
          <strong className={`vx-tenant-risk-text--${tenant.riskLevel}`}>
            {riskLabel(tenant.riskLevel)}
          </strong>
          <span>{verifiedLabel(tenant.verifiedStatus)}</span>
          <span>{tenant.ticketOpenCount} 个未结工单</span>
        </div>
        <p>{tenant.notes}</p>
      </section>

      <section className="vx-tenant-audit-list">
        <header>
          <Icon name="table" size="sm" fallback="placeholder" />
          <h3>审计记录</h3>
        </header>
        {tenant.auditEvents.map((event) => (
          <div
            key={event.id}
            className={`vx-tenant-audit-list__item vx-tenant-audit-list__item--${event.result}`}
          >
            <span>
              <strong>{event.action}</strong>
              <small>{event.actor}</small>
            </span>
            <em>{formatDate(event.at, locale)}</em>
            <StatusBadge tone={AUDIT_RESULT_TONE[event.result]}>
              {auditResultLabel(event.result)}
            </StatusBadge>
          </div>
        ))}
      </section>
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
    <div className="vx-tenant-ticket-list">
      {tenant.tickets.map((ticket) => (
        <article
          key={ticket.id}
          className={`vx-tenant-ticket vx-tenant-ticket--${ticket.status}`}
        >
          <span>
            <strong>{ticket.title}</strong>
            <small>
              {ticket.id} · {ticket.priority.toUpperCase()}
            </small>
          </span>
          <StatusBadge tone={TICKET_STATUS_TONE[ticket.status]}>
            {ticketStatusLabel(ticket.status)}
          </StatusBadge>
          <em>{formatDate(ticket.updatedAt, locale)}</em>
        </article>
      ))}
    </div>
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
      <ViewLayout className="vx-tenant-management-page">
        <Link className="vx-tenant-back-link" href="/tenants">
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
      className="vx-tenant-management-page"
      header={
        <>
          <Link className="vx-tenant-back-link" href="/tenants">
            <Icon name="arrow-left" size="xs" fallback="placeholder" />
            返回租户列表
          </Link>

          <section
            className={
              summaryExpanded
                ? "vx-tenant-detail-summary"
                : "vx-tenant-detail-summary vx-tenant-detail-summary--collapsed"
            }
            aria-label={`${tenant.displayName} 标题概要`}
          >
            <Button
              className="vx-tenant-detail-summary__toggle"
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

            <header className="vx-tenant-detail__header">
              <section
                className="vx-tenant-detail__identity"
                aria-label="租户概要"
              >
                <span className="vx-tenant-detail__icon" aria-hidden="true">
                  <Icon
                    name={
                      tenant.tenantType === "company" ? "buildings" : "user"
                    }
                    size="lg"
                    fallback="placeholder"
                  />
                </span>
                <div className="vx-tenant-detail__title">
                  <div className="vx-tenant-title-line vx-tenant-title-line--name">
                    <h2>{tenant.displayName}</h2>
                    <Button
                      variant="ghost"
                      size="icon-md"
                      className="vx-tenant-title-copy"
                      aria-label="复制租户名称"
                      title="复制租户名称"
                      onClick={() => void handleCopyText(tenant.displayName)}
                    >
                      <Icon name="copy" size="xs" fallback="placeholder" />
                    </Button>
                  </div>
                  <div className="vx-tenant-title-line vx-tenant-title-line--code">
                    <p>{tenant.tenantCode}</p>
                    <Button
                      variant="ghost"
                      size="icon-md"
                      className="vx-tenant-title-copy"
                      aria-label="复制租户代码"
                      title="复制租户代码"
                      onClick={() => void handleCopyText(tenant.tenantCode)}
                    >
                      <Icon name="copy" size="xs" fallback="placeholder" />
                    </Button>
                  </div>
                  <div>
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
                    className="vx-tenant-detail__metric-column"
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
                    className="vx-tenant-detail__metric-column"
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
        className="vx-tenant-detail"
        aria-label={`${tenant.displayName} 管理详情`}
      >
        <div className="vx-tenant-detail__form">
          <div className="vx-tenant-detail__toolbar">
            <div
              className="vx-tenant-tabs"
              role="tablist"
              aria-label={`${tenant.displayName} 信息分区`}
            >
              {tenantTabs.map((tab) => (
                <Button
                  key={tab.id}
                  variant={activeTab === tab.id ? "secondary" : "ghost"}
                  size="md"
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  className={activeTab === tab.id ? "is-active" : undefined}
                  onClick={() => setActiveTab(tab.id)}
                >
                  <Icon name={tab.icon} size="xs" fallback="placeholder" />
                  {tab.label}
                </Button>
              ))}
            </div>
          </div>

          <section className="vx-tenant-tab-panel" role="tabpanel">
            {activeTab === "info" ? (
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
            ) : null}
            {activeTab === "members" ? (
              <TenantMembersTab tenantId={tenant.id} />
            ) : null}
            {activeTab === "subscriptions" ? (
              <TenantSubscriptionsTab subscriptions={tenant.subscriptions} />
            ) : null}
            {activeTab === "usage" ? (
              <TenantUsageTab usage={tenant.usage} />
            ) : null}
            {activeTab === "models" ? (
              <TenantModelsTab policies={tenant.modelPolicies} />
            ) : null}
            {activeTab === "risk" ? <TenantRiskTab tenant={tenant} /> : null}
            {activeTab === "tickets" ? (
              <TenantTicketsTab tenant={tenant} />
            ) : null}
          </section>
        </div>
      </section>
    </DetailPageTemplate>
  );
}
