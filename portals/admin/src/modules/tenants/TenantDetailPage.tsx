"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useTableLabels } from "@/modules/shared/table";
import { exportRowsToCsv } from "@/lib/exportCsv";
import type { CsvColumn } from "@/lib/exportCsv";
import { useSubscriptionStatusLabels } from "@/modules/shared/enum-labels";
import type { FormEvent, ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ActionButton,
  ActionMenu,
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  DataTable,
  DestructiveButton,
  DetailList,
  DetailPageTemplate,
  DetailRow,
  DialogForm,
  EmptyState,
  FilterBar,
  Icon,
  Input,
  MetricGrid,
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
  Textarea,
  TabsContent,
  TabsList,
  TabsTrigger,
  useToast,
  ViewLayout,
} from "@vxture/design-system";
import type { DataTableColumn, IconName } from "@vxture/design-system";
import {
  changeTenantMemberRole,
  fetchTenantMembers,
  fetchTenantOperation,
  resetTenantLogo,
  tenantLogoUrl,
  removeTenantMember,
  suspendTenantMember,
  updateTenant,
  updateTenantOperatorNotes,
  type UpdateTenantInput,
} from "@/api/admin-bff";
import type {
  TenantMemberRecord,
  TenantOperationDetailRecord,
  TenantOperationMember,
  TenantOperationRecord,
  TenantOperationAuditEvent,
  TenantOperationSubscription,
  TenantOperationUsageMetric,
} from "@/entities/console";
import {
  AUDIT_RESULT_TONE,
  MEMBER_STATUS_TONE,
  TICKET_STATUS_TONE,
} from "@/modules/shared/tenant-tone";
import { SUBSCRIPTION_OPERATION_TONE } from "@/modules/shared/status-tone";
import { DetailSectionHeading } from "@/modules/shared/DetailSectionHeading";
import { isStepUpCancelled, useStepUp } from "@/providers/StepUpProvider";
import tenantDefaultLogo from "@vxture/design-system/assets/icons/tenant-default.png";
import { resolveIpLocation } from "@/shared/ip-location";
import {
  auditResultLabel,
  formatDate,
  formatDateTime,
  formatMoney,
  formatNumber,
  joinClasses,
  memberStatusLabel,
  normalizeTenantRiskLevel,
  riskLabel,
  statusLabel,
  subscriptionCycleLabel,
  subscriptionKindLabel,
  TENANT_RISK_TONE,
  TENANT_STATUS_TONE,
  ticketStatusLabel,
  typeLabel,
  usagePercent,
  VERIFICATION_TONE,
  verifiedLabel,
} from "./tenant-utils";
import { useConfirmLabels } from "@/modules/shared/destructive";

// 「模型授权」页签 2026-08-30 删除：模型用量归 Atlas，平台库没有这份数据，
// 那一页从来只渲染过空表——一个永远为空的页签比没有页签更误导。
type TenantTabId =
  | "info"
  | "members"
  | "subscriptions"
  | "usage"
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
    accountCode: record.account,
    name: record.name,
    email: record.email,
    role: record.roleName || record.roleCode || "成员",
    roleCode: record.roleCode,
    roleId: record.roleId,
    // TenantMemberRecord.status = active | suspended | removed（removed 已在拉取时过滤）。
    status: record.status === "suspended" ? "suspended" : "active",
    joinedAt: record.createdAt,
    // 2026-08-30 起 /members 带 session.auth_sessions 的最近活动；没有会话就是 null，
    // 此前这里拿 updatedAt 冒充「最近活跃」。
    lastActiveAt: record.lastActiveAt,
    lastActiveIp: record.lastActiveIp,
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
  { id: "risk", label: "风控审计", icon: "table" },
  // 「工单服务」而不是「工单备注」（owner 2026-09-21）：这一页列的是工单，
  // 备注是旁边一小块，拿它当板块名会把主角说成配角。
  { id: "tickets", label: "工单服务", icon: "chat-circle" },
];

/** 地址栏里的 `?tab=` 只认这六个；别的一律当没写，回到默认页。 */
const TENANT_TAB_IDS = new Set<string>(tenantTabs.map((tab) => tab.id));

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

/*
 * 这里原来有三段派生：按产品名里有没有「agent / 智能体」猜「智能体 vs 平台」订阅数、
 * 用「月收入 × 开通月数」造「累计收入」。2026-08-30 删掉——前者是字符串猜测，
 * 后者是编出来的钱；累计收入现在由 BFF 从 billing.payments 实付合计给（totalRevenue）。
 */

function getMemberAccountCode(member: TenantOperationMember) {
  return member.accountCode || "-";
}

/** 订阅金额是每期实付；币种不是人民币时不套人民币格式。 */
function formatSubscriptionAmount(
  subscription: Pick<TenantOperationSubscription, "payAmount" | "currency">,
) {
  if (subscription.payAmount === null) return "-";
  return subscription.currency === "CNY"
    ? formatMoney(subscription.payAmount)
    : `${formatNumber(subscription.payAmount)} ${subscription.currency}`;
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
  verificationReviewState,
  reviewHref,
  onDraftChange,
  onEdit,
  onReset,
  onSave,
  operatorNotes,
  notesDraft,
  notesEditing,
  notesSaving,
  onNotesEdit,
  onNotesChange,
  onNotesCancel,
  onNotesSave,
}: {
  tenant: TenantOperationRecord;
  operatorNotes: TenantOperationDetailRecord["operatorNotes"];
  notesDraft: string;
  notesEditing: boolean;
  notesSaving: boolean;
  onNotesEdit: () => void;
  onNotesChange: (value: string) => void;
  onNotesCancel: () => void;
  onNotesSave: () => void;
  draft: TenantInfoDraft;
  editing: boolean;
  infoDirty: boolean;
  saving: boolean;
  /** hidden = 已认证；enabled = 待审核；disabled = 其余（按钮在但点不动）。 */
  verificationReviewState: "hidden" | "enabled" | "disabled";
  reviewHref: string;
  onDraftChange: <K extends keyof TenantInfoDraft>(
    field: K,
    value: TenantInfoDraft[K],
  ) => void;
  onEdit: () => void;
  onReset: () => void;
  onSave: () => void;
}) {
  const locale = useLocale();
  const tShared = useTranslations();
  return (
    <div className="grid min-w-0 grid-cols-1 gap-lg">
      {/* 卡片模式 + 贯通的标题分隔线（owner 2026-09-21，参照 console /tenant）。
          操作走 Section 自己的 `action` 槽——此前我把 SectionHeader 塞进一个
          flex 行当子元素，它的宽度收缩到文字宽，那条 `border-b` 跟着只剩
          一小截，按钮也被挤到线**旁边**而不是线上方。 */}
      <Section
        tone="glass"
        level={2}
        icon="buildings"
        title="基础资料"
        className="min-w-0"
        action={
          <div
            className="flex min-w-0 flex-wrap items-center justify-end gap-xs"
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
                {/* 认证审核三态（owner 2026-09-21）：
                      已认证 → 不显示（无事可做）
                      待审核 → 出现且可点
                      其余   → 出现但禁用（告诉运营「这里有这件事，只是现在无待审」）
                    禁用态用 Button 不用 Link：禁用的链接不是一回事，点下去照跳。 */}
                {verificationReviewState ===
                "hidden" ? null : verificationReviewState === "enabled" ? (
                  <Button asChild variant="outline">
                    <Link href={reviewHref}>
                      <Icon name="medal" size="xs" fallback="placeholder" />
                      <span>认证审核</span>
                    </Link>
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    disabled
                    title="当前没有待审核的认证申请"
                  >
                    <Icon name="medal" size="xs" fallback="placeholder" />
                    <span>认证审核</span>
                  </Button>
                )}
                <Button variant="outline" onClick={onEdit}>
                  <Icon name="edit" size="xs" fallback="placeholder" />
                  <span>修改</span>
                </Button>
              </>
            )}
          </div>
        }
      >
        <div className="grid min-w-0 gap-md">
          <div className="grid min-w-0 grid-cols-1 gap-x-lg gap-y-md lg:grid-cols-3">
            {/* 租户代码删于 2026-09-21（owner：「身份卡显示一次即可」）。
                它本来就不可编辑，却画成了输入框——一次性一并清掉。 */}
            <TenantConfigItem label={tShared("columns.tenantName")}>
              {editing ? (
                <Input
                  value={draft.tenantName}
                  onChange={(event) =>
                    onDraftChange("tenantName", event.target.value)
                  }
                />
              ) : (
                <span className="flex min-w-0 flex-wrap items-center gap-xs">
                  <TenantConfigValue>{draft.tenantName}</TenantConfigValue>
                  {/* 标明这一栏是**认证名**（tenancy.tenants.name，跟着 KYC 走），
                      与旁边的简称不是同一列——两者长得像，不标就会被当成重复。 */}
                  <Badge variant="outline" className="shrink-0">
                    认证名
                  </Badge>
                </span>
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
                  wrapperClassName="w-fit basis-media-xl"
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
                  wrapperClassName="w-fit basis-media-xl"
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
            {/* 活跃状态（owner 2026-09-21 line2）。给的是**事实**不是判定：
                直接报最近一次会话的日期，没有就说「无活动记录」。
                没做成「活跃 / 沉默」两档：那要一个阀值（多少天算沉默），而那是
                业务规则，我编一个出来就会被当成平台口径。要分档请给阀值。 */}
            <TenantConfigItem label="活跃状态">
              <TenantConfigValue>
                {tenant.lastActiveAt
                  ? formatDate(tenant.lastActiveAt, locale)
                  : "无活动记录"}
              </TenantConfigValue>
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
            {/* 「组织规模」只在组织租户出现（owner 2026-09-21）。
                个人租户填不出也用不上，留着只会多一格「—」。 */}
            {tenant.tenantType === "company" ? (
              <TenantConfigItem label="组织规模">
                <TenantConfigValue>{tenant.scale}</TenantConfigValue>
              </TenantConfigItem>
            ) : null}
          </div>
        </div>
      </Section>

      <Section
        tone="glass"
        level={2}
        icon="user-switch"
        title="主管理员"
        className="min-w-0"
        action={
          <div
            className="flex min-w-0 flex-wrap items-center justify-end gap-xs"
            aria-label="主管理员操作"
          >
            {/* 两颗都暂缓激活（owner 2026-09-21）。禁用不是懒，是后端真没有路径：
                `owner_user_id` 既不在 PUT /api/tenants/:id 的字段里，也不在 98 列锁的
                UPDATE 授权里；转移 owner 还要踩个人租户的唯一性约束
                uq_tenants_one_personal_per_owner。
                title 把原因写在悬停上——一颗不说话的灰按钮比没有按钮更让人猜。 */}
            <Button
              variant="outline"
              disabled
              title="转移主管理员尚无后端路径（owner_user_id 不可写）"
            >
              <Icon name="user-switch" size="xs" fallback="placeholder" />
              <span>修改主管理员</span>
            </Button>
            <Button
              variant="outline"
              disabled
              title="重置密码须经 IdP 内部端点，不在本平台直写库"
            >
              <Icon name="key" size="xs" fallback="placeholder" />
              <span>重置密码</span>
            </Button>
          </div>
        }
      >
        {/* 列数跟基础资料对齐（owner：「一行三列对齐显示，完全整齐」）。
            缩进不再手加：换成 Section 后卡自带内边距，再叠 ml 会双计。 */}
        <div className="grid min-w-0 gap-md">
          <div className="grid min-w-0 grid-cols-1 gap-x-lg gap-y-md lg:grid-cols-3">
            <TenantConfigItem label="姓名">
              <TenantConfigValue>
                {tenant.ownerName}
                {tenant.tenantType === "individual" ? (
                  <Badge>owner</Badge>
                ) : null}
              </TenantConfigValue>
            </TenantConfigItem>
            <TenantConfigItem label="Mail">
              <TenantConfigValue>{tenant.ownerEmail}</TenantConfigValue>
            </TenantConfigItem>
            <TenantConfigItem label="Phone">
              <TenantConfigValue>{tenant.contactPhone}</TenantConfigValue>
            </TenantConfigItem>
          </div>
        </div>
      </Section>

      <Section
        tone="glass"
        level={2}
        icon="info"
        title="运营备注"
        className="col-span-full min-w-0"
        action={
          <div className="inline-flex items-center gap-sm">
            {notesEditing ? (
              <>
                <Button
                  variant="ghost"
                  onClick={onNotesCancel}
                  disabled={notesSaving}
                >
                  放弃
                </Button>
                <Button
                  onClick={onNotesSave}
                  disabled={notesSaving || notesDraft === operatorNotes.body}
                >
                  {notesSaving ? "保存中..." : "保存"}
                </Button>
              </>
            ) : (
              <Button variant="outline" onClick={onNotesEdit}>
                <Icon name="edit" size="xs" fallback="placeholder" />
                <span>{operatorNotes.body ? "修改" : "添加"}</span>
              </Button>
            )}
          </div>
        }
      >
        <div className="grid min-w-0 gap-sm">
          {notesEditing ? (
            <Textarea
              aria-label="运营备注"
              value={notesDraft}
              onChange={(event) => onNotesChange(event.target.value)}
              rows={4}
              maxLength={4000}
              placeholder="只有运营看得到。记下这个租户的特殊情况、沟通结论、需要交接的事…"
            />
          ) : (
            <p className="m-0 text-body-sm leading-relaxed whitespace-pre-wrap text-foreground">
              {operatorNotes.body || "—"}
            </p>
          )}
          {/* 「有操作人员和信息记录」（owner）。逐次的编辑历史在风控审计里
            （tenant.operator_notes.update，带 before/after），不在这里再列一遍。 */}
          {operatorNotes.updatedAt ? (
            <p className="m-0 text-body-sm text-muted-foreground">
              {operatorNotes.updatedBy ?? "未知"} 于{" "}
              {formatDateTime(operatorNotes.updatedAt, locale)} 更新
            </p>
          ) : null}
        </div>
        {/* 原来这里显示的是 `tenant.notes`——那是**租户自己写的简介**
            （tenant_profiles.description），库里根本没有运营备注这一列。
            同一段文字贴着两个含义相反的标签，运营以为那是自己人写的。
            原来下面还挂一排 `tenant.tags`：契约里那个数组从来是空的（已于
            2026-08-30 随字段一起删）。 */}
      </Section>
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
      // 副题是加入时间（membership.created_at）；卡片视图同一读数带「加入时间」标签。
      cell: (member) => (
        <span className="inline-flex flex-col items-center gap-2xs">
          {
            <StatusBadge tone={MEMBER_STATUS_TONE[member.status]}>
              {memberStatusLabel(member.status)}
            </StatusBadge>
          }
          <span className="text-body-sm text-muted-foreground">
            {formatDate(member.joinedAt, locale)}
          </span>
        </span>
      ),
    },
    {
      id: "lastActive",
      header: "最近活跃",
      align: "center",
      cell: (member) => (
        <TableTitleCell
          layout="stacked"
          tooltip={
            member.lastActiveIp
              ? `登录 IP ${member.lastActiveIp}`
              : "暂无登录 IP"
          }
          title={formatDate(member.lastActiveAt, locale)}
          description={resolveIpLocation(member.lastActiveIp)}
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
  const tableLabels = useTableLabels();
  const columns = useTenantMemberColumns();
  return (
    <DataTable
      labels={tableLabels}
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
        const joinedAt = formatDate(member.joinedAt, locale);

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
              { key: "joined", value: joinedAt, label: "加入时间" },
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
  // 「邀请中」计数原来也在这里：成员值域里从没有 invited（受邀未加入的人在
  // invitations 表，不是成员），那枚标永远显示 0（2026-08-30 删）。
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
      {/* 走 DS FilterBar 而不是手搓一排（owner 2026-09-21：搜索/筛选字号偏大）。
          根因不是没引用 token：DS 的 Input / NativeSelect 默认
          `text-body-lg md:text-body-md`——`body-lg` 在小屏是防 iOS 聚焦缩放的惯用法，
          对**表单字段**是对的。而 FilterBar 把子控件再降一档（见它第 49~51 行的
          `[&_[data-slot=input]]:…text-body-sm`）：筛选栏是工具条，不是表单。
          手搓的 flex 行拿不到那份契约，所以字大一号。用件而不是手工补字号——
          手工补的下一次还会漏。槽位顺序是件的契约，调用方改不了。 */}
      <FilterBar
        view={viewMode}
        onViewChange={setViewMode}
        aria-label="账号筛选"
        count={formatNumber(filteredMembers.length)}
        search={
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索账号、账号代码、邮箱"
            className="min-w-media-2xl grow basis-0 max-w-panel-sm"
            aria-label="搜索账号"
          />
        }
        onReset={handleReset}
        actions={
          <div
            className="flex flex-wrap items-center gap-xs"
            aria-label="账号统计"
          >
            <StatusBadge tone="success">
              活跃 {formatNumber(activeCount)}
            </StatusBadge>
            <StatusBadge tone="danger">
              停用 {formatNumber(suspendedCount)}
            </StatusBadge>
          </div>
        }
      >
        <NativeSelect
          wrapperClassName="w-fit basis-media-xl"
          value={statusFilter}
          onChange={(event) =>
            setStatusFilter(event.target.value as MemberStatusFilter)
          }
          aria-label="账号状态"
        >
          <option value="all">{tShared("filters.allStates")}</option>
          <option value="active">{tShared("status.generic.normal")}</option>
          <option value="suspended">{tShared("actions.disable")}</option>
        </NativeSelect>
        <NativeSelect
          wrapperClassName="w-fit basis-media-xl"
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
      </FilterBar>

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
            wrapperClassName="w-fit basis-media-xl"
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

/**
 * 订阅页签。每张卡一条 metering.subscriptions：标题是套餐 primary 组件的产品名，
 * 副题是购买单号（可视码；试用 / 免费 / 运营开通没有单号，退而显示开通方式）。
 * 读数全是库里的字段——每期实付、周期、到期——不再折算「月收入」，也没有「席位」
 * 「发布版本」（库里没有这两样，旧契约那两栏是占位）。
 */
/**
 * 订阅周期已走完多少（0~100）。
 *
 * console 那张卡的「图形化」就是这条：一眼看出这份订阅走到哪了，比两个日期直观。
 * 不限期（endsAt 为 null）没有分母，返回 null——**不画成满格**，「不知道」和
 * 「用完了」是两回事（同配额水位条那条注释）。
 */
function subscriptionTermPercent(
  startedAt: string,
  endsAt: string | null,
): number | null {
  if (!endsAt) return null;
  const start = new Date(startedAt).getTime();
  const end = new Date(endsAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return null;
  }
  const elapsed = Date.now() - start;
  return Math.min(
    100,
    Math.max(0, Math.round((elapsed / (end - start)) * 100)),
  );
}

/** 距到期还有几天；已过期为负数，不限期为 null。 */
function subscriptionDaysLeft(endsAt: string | null): number | null {
  if (!endsAt) return null;
  const end = new Date(endsAt).getTime();
  if (!Number.isFinite(end)) return null;
  return Math.ceil((end - Date.now()) / 86_400_000);
}

/**
 * 订阅卡（运营侧）。版面照 console 的 `/subscription`（owner 2026-09-21 S4-1），
 * 但装的是运营要看的东西。
 *
 * ── 与 console 那张卡的分工 ──
 * console 给客户看「我买了什么、还剩多久」；这里给运营看「这份订阅是怎么来的、
 * 钱怎么收、下一次什么时候动」。所以多了订单号、每期实付、续费方式与下次续费。
 *
 * ── 操作为什么只有三条跳转 ──
 * 续费 / 暂停 / 恢复 / 取消四个生命周期动作在**订阅详情页**上已经有了，连同它们
 * 各自的可用条件与禁用原因。按 owner 定的原则「重复的按钮和功能应该是跳转性的，
 * 不能重复构建页面」，这里跳过去，不在租户页把那四颗按钮连同判定逻辑再抄一遍。
 */
function TenantSubscriptionCard({
  subscription,
}: {
  subscription: TenantOperationSubscription;
}) {
  const locale = useLocale();
  const tShared = useTranslations();
  const router = useRouter();
  const subscriptionStatusLabels = useSubscriptionStatusLabels();

  const planLabel = subscription.planName
    ? `${subscription.planName}${
        subscription.planVersion ? ` v${subscription.planVersion}` : ""
      }`
    : tShared("common.noPlanLinked");
  const title = subscription.productNames.length
    ? subscription.productNames.join(" / ")
    : planLabel;

  const percent = subscriptionTermPercent(
    subscription.startedAt,
    subscription.endsAt,
  );
  const daysLeft = subscriptionDaysLeft(subscription.endsAt);
  const expired = daysLeft != null && daysLeft < 0;
  const nearExpiry = daysLeft != null && daysLeft >= 0 && daysLeft <= 30;

  return (
    <Card surface="base" className="gap-md">
      <CardHeader className="gap-sm">
        {/* 标题与状态标同一行盒——console 那张卡踩过：两者当兄弟节点靠
            items-center 对齐，对到的是两行标题块的中线，看着低半行。 */}
        <span className="flex min-w-0 items-center gap-sm">
          <Icon
            name="star"
            size="sm"
            fallback="placeholder"
            className="shrink-0 text-primary-text"
          />
          <span className="min-w-0 flex-1 truncate text-label-md text-foreground">
            {title}
          </span>
          <StatusBadge tone={SUBSCRIPTION_OPERATION_TONE[subscription.status]}>
            {subscriptionStatusLabels[subscription.status]}
          </StatusBadge>
          <ActionMenu
            label={`${title} 订阅操作`}
            items={[
              {
                /* ActionMenu 没有 href（查过 design-ui 的 props），跳转走 onSelect。 */
                id: "detail",
                label: "订阅详情",
                icon: "arrow-right",
                /* 续费 / 暂停 / 恢复 / 取消都在那一页，连同各自的禁用原因。 */
                ...(subscription.orderNo
                  ? {
                      onSelect: () =>
                        router.push(
                          `/subscriptions/${encodeURIComponent(subscription.orderNo!)}`,
                        ),
                    }
                  : {
                      disabled: true,
                      hint: "运营开通 / 试用的订阅没有订单号，详情页路由走的是它",
                    }),
              },
              {
                id: "order",
                label: "查看订单",
                icon: "table",
                ...(subscription.orderNo
                  ? {
                      onSelect: () =>
                        router.push(
                          `/orders/${encodeURIComponent(subscription.orderNo!)}`,
                        ),
                    }
                  : {
                      disabled: true,
                      hint: "这份订阅不是买来的，没有订单",
                    }),
              },
            ]}
          />
        </span>
        <span className="block truncate text-body-sm text-muted-foreground">
          {planLabel}
        </span>
      </CardHeader>

      <CardContent className="grid min-w-0 gap-md">
        {/* ── 它是什么：来源 / 周期 / 续费方式 ─────────────────────────── */}
        <div className="flex flex-wrap items-center gap-xs">
          <Badge variant="secondary">
            {subscriptionKindLabel(subscription.kind)}
          </Badge>
          {/* 周期就是周期：¥0 档同样是按月/按年的订阅，不把这一格换成「免费」。 */}
          <Badge variant="outline">
            {subscriptionCycleLabel(subscription)}
          </Badge>
          <Badge variant="outline">
            {subscription.autoRenew ? "自动续费" : "手动续费"}
          </Badge>
        </div>

        {/* ── 走到哪了：图形化那一条 ──────────────────────────────────── */}
        {percent == null ? (
          <p className="m-0 text-body-sm text-muted-foreground">
            开通 {formatDate(subscription.startedAt, locale)}
            {" · "}不限期
          </p>
        ) : (
          <div className="flex flex-col gap-2xs">
            <div className="flex items-baseline justify-between gap-sm text-body-sm">
              <span className="text-muted-foreground tabular-nums">
                {formatDate(subscription.startedAt, locale)} ~{" "}
                {formatDate(subscription.endsAt!, locale)}
              </span>
              <span
                className={
                  expired || nearExpiry
                    ? "font-medium text-warning-text tabular-nums"
                    : "text-muted-foreground tabular-nums"
                }
              >
                {expired
                  ? `已过期 ${Math.abs(daysLeft!)} 天`
                  : `剩余 ${daysLeft} 天`}
              </span>
            </div>
            <Progress
              value={percent}
              aria-label={`${title} 周期进度`}
              className={expired ? "[&>*]:bg-destructive" : undefined}
            />
          </div>
        )}

        {/* ── 运营要看的参数（owner S4-2）───────────────────────────────
            订单号放第一个：它是「这份订阅怎么来的」的唯一线索，也是对账起点。 */}
        <DetailList>
          <DetailRow label="订单号">
            {subscription.orderNo ? (
              <Button asChild variant="ghost" size="sm">
                <Link
                  href={`/orders/${encodeURIComponent(subscription.orderNo)}`}
                >
                  {subscription.orderNo}
                </Link>
              </Button>
            ) : (
              /* 读不到显示「—」不显示 0，也不编一个假单号。 */
              "—"
            )}
          </DetailRow>
          <DetailRow label="每期实付">
            {formatSubscriptionAmount(subscription)}
          </DetailRow>
          <DetailRow label="下次续费">
            {subscription.nextRenewalAt
              ? formatDate(subscription.nextRenewalAt, locale)
              : "—"}
          </DetailRow>
        </DetailList>
      </CardContent>
    </Card>
  );
}

function TenantSubscriptionsTab({
  subscriptions,
}: {
  subscriptions: TenantOperationSubscription[];
}) {
  if (!subscriptions.length) {
    return (
      <EmptyState title="暂无订阅" description="该租户名下没有订阅记录。" />
    );
  }

  /* 一行两张：卡里有进度条与三行参数，挤到三列会把日期区间压到换行。 */
  return (
    <div className="grid min-w-0 gap-lg xl:grid-cols-2">
      {subscriptions.map((subscription) => (
        <TenantSubscriptionCard
          key={subscription.id}
          subscription={subscription}
        />
      ))}
    </div>
  );
}

/**
 * 配额水位条的填充色。
 *
 * `Progress` 的填充写死 `bg-primary`、没有语气 prop，所以用子元素变体改它
 * ——这正是原来 `--usage-tone` 三个修饰类在做的事，只是不再经一层自定义属性。
 * 语气按百分比在展示层定（≥100 满、≥80 临界）：契约里不再带一个派生的 status。
 */
const USAGE_TRACK_TONE = {
  normal: "[&>*]:bg-success",
  warning: "[&>*]:bg-warning",
  danger: "[&>*]:bg-destructive",
} as const;

function usageTrackTone(percent: number): keyof typeof USAGE_TRACK_TONE {
  if (percent >= 100) return "danger";
  if (percent >= 80) return "warning";
  return "normal";
}

/**
 * 配额用量页签。每行一个 metric_key，两组读数来自两张表、两种时间窗，所以分开摆：
 * 主读数是配额池水位（quota_pools，按订阅锚定周期推进），右上角是本自然月的
 * 用量汇总（usage_summary_months）。没有池就没有水位条——「不知道」不画成满格。
 */
function TenantUsageTab({ usage }: { usage: TenantOperationUsageMetric[] }) {
  if (!usage.length) {
    return (
      <EmptyState
        title="暂无用量与配额"
        description="该租户的工作空间本月没有用量汇总，也没有生效中的配额池。"
      />
    );
  }

  /* 汇总（owner S5-1）。三个数各自回答一件事：
       计量项   —— 这个租户一共在用几种资源
       已配池   —— 其中几种真的设了上限（其余是「用多少算多少」）
       临界     —— 有几种已经到 80% 以上
     「临界」取 80% 与水位条的 warning 同一道线（usageTrackTone），不另立一个
     阈值——两处用不同的线会让「卡片说临界、条子还是绿的」这种事发生。 */
  const pooled = usage.filter((metric) => metric.quotaLimit !== null);
  const tight = pooled.filter((metric) => {
    const percent = usagePercent(metric);
    return percent !== null && percent >= 80;
  });

  return (
    <div className="grid min-w-0 gap-xl">
      <MetricGrid
        aria-label="配额与用量汇总"
        columns={3}
        items={[
          {
            id: "metrics",
            icon: "graph",
            label: "计量项",
            value: formatNumber(usage.length),
            help: "该租户本月有用量汇总、或有配额池的资源种类数。",
          },
          {
            id: "pooled",
            icon: "shield-check",
            label: "已配额",
            value: `${formatNumber(pooled.length)} / ${formatNumber(usage.length)}`,
            tags: ["其余不限量"],
            help: "设了配额池上限的资源种类；没有池的按用量计，不受限。",
          },
          {
            id: "tight",
            icon: "warning",
            label: "临界",
            value: formatNumber(tight.length),
            tags: ["水位 ≥ 80%"],
            tone: tight.length ? "warning" : "success",
            help: "配额水位达到 80% 以上的资源种类，与下方水位条同一条线。",
          },
        ]}
      />

      {/* 一项一张卡（owner S5-2）。此前是一排 <article> 靠虚线分隔——信息一样，
          但卡有边界，扫起来快得多。一行两张：卡里有水位条与两组读数。 */}
      <div className="grid min-w-0 gap-lg xl:grid-cols-2">
        {usage.map((metric) => {
          const percent = usagePercent(metric);
          const unit = metric.unit ?? "";
          return (
            <Card key={metric.metricKey} surface="base" className="gap-md">
              <CardHeader className="gap-2xs">
                <span className="flex min-w-0 items-center gap-sm">
                  <Icon
                    name="graph"
                    size="sm"
                    fallback="placeholder"
                    className="shrink-0 text-primary-text"
                  />
                  <span className="min-w-0 flex-1 truncate text-label-md text-foreground">
                    {metric.metricKey}
                  </span>
                  {percent !== null && percent >= 80 ? (
                    <StatusBadge tone={percent >= 100 ? "danger" : "warning"}>
                      {percent >= 100 ? "已用尽" : "临界"}
                    </StatusBadge>
                  ) : null}
                </span>
                <span className="block text-body-sm text-muted-foreground">
                  本月用量 {formatNumber(metric.monthUsage)} {unit}
                </span>
              </CardHeader>
              <CardContent className="grid min-w-0 gap-sm">
                <div className="flex min-w-0 items-baseline justify-between gap-md">
                  <b className="text-title-xl text-foreground tabular-nums">
                    {metric.quotaUsed === null
                      ? "—"
                      : formatNumber(metric.quotaUsed)}
                  </b>
                  <small className="text-body-sm font-semibold text-muted-foreground tabular-nums">
                    {metric.quotaLimit === null
                      ? "未配置配额池"
                      : `/ ${formatNumber(metric.quotaLimit)} ${unit}`}
                  </small>
                </div>
                {/* 没有池就没有水位条——「不知道」不画成满格。 */}
                {percent === null ? null : (
                  <Progress
                    value={percent}
                    aria-label={`${metric.metricKey} 配额水位`}
                    className={USAGE_TRACK_TONE[usageTrackTone(percent)]}
                  />
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

/** 风险档的文字色。照 `.vx-tenant-risk-text--*` 实测的前景定。 */
const RISK_TEXT_TONE: Record<string, string> = {
  normal: "text-muted-foreground",
  follow_up: "text-warning-text",
  high: "text-destructive-text",
};

/* 审计导出的列。时间给到秒：同一天几十条，只给日期对不了账。 */
const AUDIT_CSV_COLUMNS: readonly CsvColumn<TenantOperationAuditEvent>[] = [
  { label: "动作", value: (event) => event.action },
  { label: "操作人", value: (event) => event.actor },
  { label: "结果", value: (event) => auditResultLabel(event.result) },
  { label: "时间", value: (event) => event.at },
];

function TenantRiskTab({ tenant }: { tenant: TenantOperationDetailRecord }) {
  const locale = useLocale();
  const tShared = useTranslations();
  const tableLabels = useTableLabels();
  const [selectedAudit, setSelectedAudit] = useState<readonly string[]>([]);

  const riskLevel = normalizeTenantRiskLevel(tenant.riskLevel);

  /* 单栏（owner S6）。此前是 xl:grid-cols-3：左边「风险状态」只有三个短读数，
     右边审计记录挤在两列里——左侧空一半、右侧横向不够用。风险状态收成一行
     摆在标题下，把整幅宽度让给表格。 */
  return (
    <div className="grid min-w-0 gap-xl">
      <section className="grid min-w-0 gap-md">
        <DetailSectionHeading icon="shield-check" title="风控审计" />
        <div className="flex min-w-0 flex-wrap items-baseline gap-lg">
          <span className="flex items-baseline gap-sm">
            <span className="text-body-sm text-muted-foreground">风险等级</span>
            <b
              className={`text-title-xl font-extrabold ${RISK_TEXT_TONE[riskLevel]}`}
            >
              {riskLabel(tenant.riskLevel)}
            </b>
          </span>
          <span className="flex items-baseline gap-sm">
            <span className="text-body-sm text-muted-foreground">认证状态</span>
            <StatusBadge tone={VERIFICATION_TONE[tenant.verifiedStatus]}>
              {verifiedLabel(tenant.verifiedStatus)}
            </StatusBadge>
          </span>
          <span className="flex items-baseline gap-sm">
            <span className="text-body-sm text-muted-foreground">最近活跃</span>
            <b className="text-body-md text-foreground">
              {tenant.lastActiveAt
                ? formatDate(tenant.lastActiveAt, locale)
                : "无活动记录"}
            </b>
          </span>
        </div>
      </section>

      {/* 导出条：选择列得有用处。
          审计行**没有真的逐行动作**——它只有动作名 / 操作人显示名 / 时间 /
          结果四个字段，没有可跳的目标。按 owner 定的「不能是死的按钮」，宁可
          不给操作列，也不编一个跳回本页的假动作。真正有用的是把选中的
          几条导出去对账。 */}
      <div className="flex min-w-0 items-center justify-end gap-sm">
        <ActionButton
          icon="arrow-down"
          variant={selectedAudit.length > 0 ? "default" : "outline"}
          disabled={selectedAudit.length === 0}
          onClick={() =>
            exportRowsToCsv(
              `tenant-${tenant.tenantCode}-audit`,
              AUDIT_CSV_COLUMNS,
              tenant.auditEvents.filter((event) =>
                selectedAudit.includes(event.id),
              ),
            )
          }
        >
          {tShared("common.export")}
        </ActionButton>
      </div>

      {/* 表格走平台规范（owner S6）：选择列 + 序号列 + … + 操作列。
          此前是 PanelList，没有序号也没有操作列，与全站其他台账不同形。 */}
      <DataTable
        labels={tableLabels}
        columns={[
          {
            id: "action",
            header: "动作",
            cell: (event) => (
              <TableTitleCell
                icon="table"
                title={event.action}
                description={event.actor}
              />
            ),
          },
          {
            id: "result",
            header: tShared("columns.state"),
            align: "center",
            cell: (event) => (
              <StatusBadge tone={AUDIT_RESULT_TONE[event.result]}>
                {auditResultLabel(event.result)}
              </StatusBadge>
            ),
          },
          {
            id: "at",
            header: tShared("columns.occurredAt"),
            cell: (event) => (
              <TableTitleCell
                layout="stacked"
                /* 台账类到秒：同一天可能几十条，只显示日期分不出先后。 */
                title={formatDate(event.at, locale)}
                description={formatDateTime(event.at, locale)}
              />
            ),
          },
        ]}
        rows={tenant.auditEvents}
        rowKey={(event) => event.id}
        indexStart={1}
        selectedKeys={selectedAudit}
        onSelectionChange={setSelectedAudit}
        empty={
          <EmptyState
            title="暂无审计记录"
            description="这个租户名下还没有审计事件。"
          />
        }
      />
    </div>
  );
}

function TenantTicketsTab({ tenant }: { tenant: TenantOperationDetailRecord }) {
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
  const withLabels = useConfirmLabels();
  const locale = useLocale();
  // 详情走 GET /api/tenants/:id：明细数组（订阅 / 用量 / 审计 / 工单）只有这条路由
  // 才带。此前这一页拉整张列表再 find 一条，列表投影里那些数组永远是空占位。
  const [tenant, setTenant] = useState<TenantOperationDetailRecord | null>(
    null,
  );
  /* 板块与编辑态都能由地址栏带进来（2026-09-21）。
     列表页的行操作要的是「直接进成员 / 订阅 / 配额」，而不是在列表里另搭一套
     面板——重复的按钮与功能应该是跳转性的，不能重复构建页面（owner 定下的原则）。
     只读初值：进来之后用户自己切 tab 不再回写地址栏，否则后退键会变成「逐个
     tab 倒放」。 */
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState<TenantTabId>(
    tabParam && TENANT_TAB_IDS.has(tabParam)
      ? (tabParam as TenantTabId)
      : "info",
  );
  const [summaryExpanded, setSummaryExpanded] = useState(true);
  const [infoEditing, setInfoEditing] = useState(false);
  /* 工作空间选择器。现在只记录选了哪个，还没有消费方——下方各 tab
     按空间筛数据是下一步。先把选择器与「有没有工作空间」这件事做对。

     初值空串，等详情回来再落到**默认空间**（owner 2026-09-21：「默认就是
     一个，不要显示全部」）。不能在这里直接取 tenant——渲染第一轮它还是 null。 */
  const [activeWorkspace, setActiveWorkspace] = useState("");
  const [notesEditing, setNotesEditing] = useState(false);
  const [notesDraft, setNotesDraft] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);
  /* `?edit=1` 只能在资料拉回来之后才能生效（编辑态靠 infoDraft），
     所以不能当初值写，得等一个 effect。只生效一次。 */
  const wantsEdit = searchParams.get("edit") === "1";
  const editApplied = useRef(false);
  const [infoDraft, setInfoDraft] = useState<TenantInfoDraft | null>(null);
  const [infoBaseline, setInfoBaseline] = useState<TenantInfoDraft | null>(
    null,
  );
  const [savingInfo, setSavingInfo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [resettingLogo, setResettingLogo] = useState(false);
  const { runWithStepUp } = useStepUp();

  useEffect(() => {
    let active = true;
    setLoading(true);

    fetchTenantOperation(tenantId)
      .then((record) => {
        if (active) setTenant(record);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [tenantId]);

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

  /* 落到默认空间。BFF 已按 is_default desc 排序，所以第一项就是它；
     若一个都没标默认，取最早建的那个。只在还没选过时生效，否则会把
     用户刚切的空间推回去。 */
  useEffect(() => {
    if (activeWorkspace || !tenant?.workspaces.length) return;
    setActiveWorkspace(tenant.workspaces[0]!.id);
  }, [activeWorkspace, tenant]);

  /* `?edit=1`（列表页的「编辑资料」跳过来）。放在 effect 而不是初值：
     编辑态靠 infoDraft，而那东西要等详情拉回来才有。editApplied 只让它生效一次：
     否则用户点了「放弃」之后，下一次重渲染会把他又推回编辑态。 */
  useEffect(() => {
    if (!wantsEdit || editApplied.current || !infoDraft) return;
    editApplied.current = true;
    setActiveTab("info");
    setInfoEditing(true);
  }, [wantsEdit, infoDraft]);

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
  /* 三态而不是两态（owner 2026-09-21）。此前是
     `verifiedStatus !== "verified"`——unverified / rejected 与 pending 一起出现且可点，
     点过去却没有待审的申请。 */
  const verificationReviewState =
    tenant.verifiedStatus === "verified"
      ? ("hidden" as const)
      : tenant.verifiedStatus === "pending"
        ? ("enabled" as const)
        : ("disabled" as const);

  function handleInfoDraftChange<K extends keyof TenantInfoDraft>(
    field: K,
    value: TenantInfoDraft[K],
  ) {
    setInfoDraft((current) => ({
      ...(current ?? visibleInfoDraft),
      [field]: value,
    }));
  }

  /* 重置租户标识：删 tenant_logos 行回落平台默认。原图不留存、不可撤回，
     所以走 step-up 且对话框标 danger。成功后只清 hash，不必重拉整条记录。 */
  async function handleResetLogo() {
    if (!tenant || resettingLogo) return;
    setResettingLogo(true);
    try {
      await runWithStepUp(() => resetTenantLogo(tenant.id), {
        danger: true,
        submitLabel: "确认重置",
      });
      setTenant({ ...tenant, logoHash: null });
    } catch (error) {
      if (isStepUpCancelled(error)) return;
      throw error;
    } finally {
      setResettingLogo(false);
    }
  }

  function handleInfoReset() {
    if (!infoBaseline) return;
    setInfoDraft(infoBaseline);
    setInfoEditing(false);
  }

  async function handleInfoSave() {
    if (savingInfo) return;

    /* 名称与简称是**两列**，各自下发（2026-09-21）。
       此前这里只送 name，注释写着「简称无对应写字段，本轮不持久化」——
       于是运营在简称框里改完、点保存、拿到 200，值原样弹回，没有任何提示。
       现在 BFF 收下 displayName 并落 tenancy.tenants.display_name。
       租户代码/类型仍无写路径，但它们本来就不该在这里改。 */
    const payload: UpdateTenantInput = {
      name: visibleInfoDraft.tenantName,
      displayName: visibleInfoDraft.displayName,
    };
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
      setTenant(updated);
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

  function handleNotesEdit() {
    // 进编辑态时才拿当前值初始化草稿：平时不跟着 tenant 重算，
    // 否则别处刷新会把正在敲的字抹掉。
    setNotesDraft(tenant?.operatorNotes.body ?? "");
    setNotesEditing(true);
  }

  async function handleNotesSave() {
    if (!tenant || savingNotes) return;
    setSavingNotes(true);
    try {
      const updated = await updateTenantOperatorNotes(tenant.id, notesDraft);
      setTenant(updated);
      setNotesEditing(false);
      toast({
        tone: "success",
        title: "已保存运营备注",
        description: `${updated.displayName} 的备注已更新。`,
      });
    } catch (error) {
      toast({
        tone: "danger",
        title: "保存备注失败",
        description: error instanceof Error ? error.message : "请稍后重试。",
      });
    } finally {
      setSavingNotes(false);
    }
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
            aria-label={`${tenant.tenantName} 标题概要`}
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
                {/* 区域 1：租户自己的标识，不是默认 icon（owner 2026-09-21）。
                    展开大图 + 底下一条浅淡的「重置为默认」，收起只留小图。
                    icon 降为 Avatar 的 fallback——它本来就只是 logo 的回落。 */}
                <div
                  className={
                    summaryExpanded
                      ? "grid shrink-0 justify-items-center gap-2xs"
                      : "grid shrink-0"
                  }
                >
                  <Avatar
                    key={tenant.logoHash ?? "__default__"}
                    className={
                      summaryExpanded
                        ? "size-media-md rounded-md"
                        : "size-icon-lg rounded-md"
                    }
                  >
                    <AvatarImage
                      src={
                        tenant.logoHash
                          ? tenantLogoUrl(tenant.id, tenant.logoHash)
                          : tenantDefaultLogo.src
                      }
                      alt={tenant.tenantName}
                      className="rounded-md object-cover"
                    />
                    <AvatarFallback
                      delayMs={0}
                      className="rounded-md bg-accent text-muted-foreground"
                      aria-label={tenant.tenantName}
                    >
                      <Icon
                        name={
                          tenant.tenantType === "company"
                            ? "buildings"
                            : "building-office"
                        }
                        size={summaryExpanded ? "md" : "sm"}
                        fallback="placeholder"
                      />
                    </AvatarFallback>
                  </Avatar>
                  {summaryExpanded ? (
                    /* 浅淡模式（owner）：ghost + 弱化色。仍然是 DestructiveButton——
                       重置是不可撤回的删除，确认框不能因为样式变淡就省掉。 */
                    <DestructiveButton
                      /* 浅淡靠 className：本件没有 variant（查过 design-ui 的 props）——
                         破坏性动作不该有「换个温和变体」这种选项，那是件的态度。 */
                      className="text-body-sm font-normal"
                      size="sm"
                      disabled={resettingLogo || !tenant.logoHash}
                      confirm={withLabels({
                        verb: "重置",
                        target: `租户「${tenant.tenantName}」的标识`,
                        consequence:
                          "删除租户上传的标识、回落平台默认图，原图不留存、不可撤回。若二次验证仍在有效期内，确认后将直接执行、不再要求验证码。",
                        onConfirm: handleResetLogo,
                      })}
                    >
                      重置为默认
                    </DestructiveButton>
                  ) : null}
                </div>
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
                      {/* 全称（owner 2026-09-21）。简称在「基础资料」里单列一格；
                          这里是管理平台的身份行，要能拿去对合同与发票。 */}
                      {tenant.tenantName}
                    </h2>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                      aria-label="复制租户名称"
                      title="复制租户名称"
                      onClick={() => void handleCopyText(tenant.tenantName)}
                    >
                      <Icon name="copy" size="xs" fallback="placeholder" />
                    </Button>
                    {/* 类型跟在名字后面（owner）：它是这个主体是什么，不是它处于
                        什么状态——所以不进下面那一排 StatusBadge。素 Badge 同行业那一条。 */}
                    <Badge variant="outline" className="shrink-0">
                      {typeLabel(tenant.tenantType)}
                    </Badge>
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
                    {/* owner 的行 3 只列了租户状态与认证状态。风险标不删，改成
                        **非正常才出现**：一枚写着「正常」的标是噪音，而非正常那一枚
                        正是这张卡最该一眼看到的东西。 */}
                    {normalizeTenantRiskLevel(tenant.riskLevel) !== "normal" ? (
                      <StatusBadge
                        tone={
                          TENANT_RISK_TONE[
                            normalizeTenantRiskLevel(tenant.riskLevel)
                          ]
                        }
                      >
                        {riskLabel(tenant.riskLevel)}
                      </StatusBadge>
                    ) : null}
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
                      tags={[
                        `活跃 ${formatNumber(tenant.activeMemberCount)}`,
                        `管理员 ${formatNumber(tenant.adminCount)}`,
                      ]}
                    />
                    <TenantKeyMetric
                      label="订阅产品"
                      value={formatNumber(tenant.subscriptionCount)}
                      tag={`产品 ${formatNumber(tenant.productCount)} 个`}
                    />
                  </section>

                  {/* 「配额消耗 N token」那格 2026-08-30 拆了：token 用量在 Atlas，
                      平台库没有，原来那格永远是 0。换成未结工单——support.tickets
                      真有的数。 */}
                  <section
                    className="grid min-w-0 content-center gap-md"
                    aria-label="收入和工单概要"
                  >
                    <TenantKeyMetric
                      label="本月收入"
                      value={formatMoney(tenant.monthlyRevenue)}
                      tag={`累计 ${formatMoney(tenant.totalRevenue)}`}
                    />
                    {/* 最近活跃只在真有会话记录时挂标；null 就不挂，不用占位词冒充。 */}
                    {/* 「未结 / 总计」而不是只给未结（owner 2026-09-21）：只看未结
                        不知道分母，3 张未结在总共 5 张和总共 500 张里是两回事。 */}
                    <TenantKeyMetric
                      label="工单数量"
                      value={`${formatNumber(tenant.ticketOpenCount)} / ${formatNumber(tenant.ticketTotalCount)}`}
                      tags={[
                        "未结 / 总计",
                        ...(tenant.lastActiveAt
                          ? [
                              `最近活跃 ${formatDate(tenant.lastActiveAt, locale)}`,
                            ]
                          : []),
                      ]}
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
        aria-label={`${tenant.tenantName} 管理详情`}
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
          {/* 一行两栏（owner 2026-09-21）：左侧主选择区，右侧辅助操作区。
              此前 TabsList 占满整行，右边那片空白没有用处。
              窄屏堆成两行（flex-wrap），不把下拉挤成竖排。 */}
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-md">
            <TabsList
              className="h-auto max-w-full flex-wrap justify-start"
              aria-label={`${tenant.tenantName} 信息分区`}
            >
              {tenantTabs.map((tab) => (
                <TabsTrigger key={tab.id} value={tab.id} className="flex-none">
                  <Icon name={tab.icon} size="xs" fallback="placeholder" />
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>

            {/* 直属租户（没有工作空间）整个隐藏，不画一个只有「全部」的空下拉
                ——owner：「没有工作区直属租户的，这个选择隐藏」。
                工作空间目前只是个**选择器**：下方各 tab 还没按空间分段，先把选择
                与可见性做对，按空间筛数据是下一步。 */}
            {tenant.workspaces.length > 0 ? (
              <NativeSelect
                /* 宽度：owner 2026-09-21 实看「字完全遮挡」。
                   原来是 `w-fit basis-media-xl`：两个尺寸打架（width 与 flex-basis
                   同时给了主轴），而 media-xl 只有 24×spacing，装不下
                   「默认工作空间（默认）」这种名字。
                   改成只给下限：内容短就 128px，长了自己擑开，shrink-0 保底。 */
                wrapperClassName="shrink-0 min-w-media-2xl"
                value={activeWorkspace}
                onChange={(event) => setActiveWorkspace(event.target.value)}
                aria-label="工作空间"
              >
                {/* 没有「全部」这一项（owner 2026-09-21）：绝大多数租户只有一个
                    空间，多出一个「全部」只是让人多选一次。默认落在默认空间上。 */}
                {tenant.workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.name}
                    {workspace.isDefault ? "（默认）" : ""}
                  </option>
                ))}
              </NativeSelect>
            ) : null}
          </div>

          <TabsContent value="info" className="min-w-0">
            <TenantInfoTab
              tenant={tenant}
              draft={visibleInfoDraft}
              editing={infoEditing}
              infoDirty={infoDirty}
              saving={savingInfo}
              verificationReviewState={verificationReviewState}
              reviewHref={`/verifications?tenantId=${encodeURIComponent(tenant.id)}`}
              onDraftChange={handleInfoDraftChange}
              onEdit={handleInfoEdit}
              onReset={handleInfoReset}
              onSave={() => void handleInfoSave()}
              operatorNotes={tenant.operatorNotes}
              notesDraft={notesDraft}
              notesEditing={notesEditing}
              notesSaving={savingNotes}
              onNotesEdit={handleNotesEdit}
              onNotesChange={setNotesDraft}
              onNotesCancel={() => setNotesEditing(false)}
              onNotesSave={() => void handleNotesSave()}
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
