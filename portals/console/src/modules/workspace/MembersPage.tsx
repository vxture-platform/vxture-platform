"use client";

/**
 * MembersPage.tsx — 成员管理(批 2 收口)。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * 目录 = 在册成员(活跃 / 已禁用)+ 待接受的邀请(Invited 行,id = 邀请 id)。
 * 动作门与 BFF 守卫同一套码(批 0a):邀请 / 添加 / 停用 / 恢复 / 重置 / 解除 =
 * member.manage,改角色 = role.assign。owner 与本人的行在这里就把停用 / 解除 /
 * 改角色关掉(带提示),BFF 再拒一遍——两边都拒,页面这边只是不让人白点。
 *
 * 「新增成员」= 把已有账号按邮箱加进来;账号不存在时引导改走邀请。
 * 「邀请成员」= 发邮件 + 一次性链接(InviteLinkDialog 兜底复制)。
 */

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ActionMenu,
  Banner,
  BulkActionBar,
  Button,
  DataTable,
  DialogForm,
  EmptyState,
  FilterBar,
  Icon,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Label,
  ListCard,
  ListCardGrid,
  ListPageTemplate,
  NativeSelect,
  Pagination,
  StatusBadge,
  type ActionMenuItem,
  type FilterBarView,
  type StatusBadgeTone,
  useListPagination,
  UserAvatar,
  ViewHeader,
} from "@vxture/design-system";
import {
  ConsoleBffError,
  createMember,
  disableMember,
  enableMember,
  fetchMembers,
  fetchTenantRoles,
  inviteMember,
  memberErrorCode,
  resendInvitation,
  resetMemberPassword,
  revokeInvitation,
  unlinkMember,
  updateMember,
  type InviteMemberResult,
} from "@/api/console-bff";
import type { MemberRecord, TenantRoleRecord } from "@/entities/console";
import { useTranslations } from "next-intl";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import { hasCapability } from "@/features/permissions/can";
import { useConfirmLabels } from "@/lib/destructive";
import {
  LoadFailedBanner,
  LoadFailedEmpty,
} from "@/components/load/LoadFailed";
import { fmtDate } from "@/modules/commerce/components/hubModel";
import { InviteLinkDialog } from "./components/InviteLinkDialog";

type MemberStatusFilter = "all" | "active" | "invited" | "suspended";

/* Business status → DS severity tone (the mapping lives on the product side). */
const statusToneMap: Record<MemberRecord["status"], StatusBadgeTone> = {
  Active: "success",
  Invited: "info",
  Suspended: "danger",
};

function memberUsername(member: MemberRecord) {
  return (
    member.username?.trim() || member.email.split("@")[0] || member.accountId
  );
}

function memberSearchText(member: MemberRecord) {
  return [
    member.name,
    memberUsername(member),
    member.email,
    member.phone,
    member.role,
    member.team,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function MembersPage() {
  const t = useTranslations("membersPage");
  const withLabels = useConfirmLabels();
  const { session } = useConsoleSession();
  const [members, setMembers] = useState<MemberRecord[]>([]);
  const [roles, setRoles] = useState<TenantRoleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /* 对话框内的错误单独一条:页面横幅在对话框背后,用户看不见。 */
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [createHint, setCreateHint] = useState<"account_not_found" | null>(
    null,
  );
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<MemberStatusFilter>("all");
  const [view, setView] = useState<FilterBarView>("list");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createMode, setCreateMode] = useState<"create" | "invite" | null>(
    null,
  );
  const [editOpen, setEditOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [bulkUnlinkOpen, setBulkUnlinkOpen] = useState(false);
  const [inviteResult, setInviteResult] = useState<{
    result: InviteMemberResult;
    resent: boolean;
  } | null>(null);
  const [memberForm, setMemberForm] = useState({ email: "", roleId: "" });
  const [passwordForm, setPasswordForm] = useState({ nextPassword: "" });

  useEffect(() => {
    let active = true;

    setLoading(true);
    setLoadFailed(false);
    Promise.all([fetchMembers(), fetchTenantRoles()])
      .then(([records, roleRecords]) => {
        if (!active) return;
        setMembers(records);
        setRoles(roleRecords.filter((role) => role.status === "active"));
        setSelectedIds(new Set());
        setSelectedId(null);
      })
      .catch(() => {
        if (active) setLoadFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [session.tenant?.id, session.tenant?.mode, reloadKey]);

  /** 错误文案:先按 BFF 原因码,再用它带回的 message,最后才是页面兜底。 */
  function errorText(caught: unknown, fallbackKey: string): string {
    const code = memberErrorCode(caught);
    if (code) return t(`errors.${code}`);
    return caught instanceof ConsoleBffError && caught.message
      ? caught.message
      : t(fallbackKey);
  }

  function resetFeedback() {
    setMessage(null);
    setError(null);
    setDialogError(null);
    setCreateHint(null);
  }

  function resetMemberForm(member?: MemberRecord | null) {
    setMemberForm({
      email: member?.email ?? "",
      roleId: member?.roleId ?? "",
    });
  }

  function openCreateDialog(mode: "create" | "invite") {
    resetMemberForm();
    resetFeedback();
    setCreateMode(mode);
  }

  function openEditDialog(member: MemberRecord) {
    setSelectedId(member.id);
    resetMemberForm(member);
    resetFeedback();
    setEditOpen(true);
  }

  function openResetDialog(member: MemberRecord) {
    setSelectedId(member.id);
    setPasswordForm({ nextPassword: "" });
    resetFeedback();
    setResetOpen(true);
  }

  async function reloadMembers(nextSelectedId?: string | null) {
    const records = await fetchMembers();
    setMembers(records);
    setSelectedIds(new Set());
    setSelectedId(nextSelectedId ?? null);
  }

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!createMode) return;

    setSubmitting(true);
    resetFeedback();

    const payload = {
      email: memberForm.email,
      // The backend reads `roleCode`; the role catalog sets id === roleCode.
      roleCode: memberForm.roleId || null,
    };

    try {
      if (createMode === "invite") {
        const result = await inviteMember(payload);
        await reloadMembers(result.member.id);
        setCreateMode(null);
        resetMemberForm();
        setInviteResult({ result, resent: false });
        setMessage(
          result.emailSent
            ? t("feedback.inviteSuccess")
            : t("feedback.inviteNoEmail"),
        );
      } else {
        const created = await createMember(payload);
        await reloadMembers(created.id);
        setCreateMode(null);
        resetMemberForm();
        setMessage(t("feedback.createSuccess"));
      }
    } catch (caught) {
      const code = memberErrorCode(caught);
      if (createMode === "create" && code === "account_not_found") {
        setCreateHint("account_not_found");
      }
      setDialogError(
        errorText(
          caught,
          createMode === "invite"
            ? "feedback.inviteError"
            : "feedback.createError",
        ),
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;

    setSubmitting(true);
    resetFeedback();

    try {
      const updated = await updateMember(selected.id, {
        roleCode: memberForm.roleId || null,
      });
      await reloadMembers(updated.id);
      setEditOpen(false);
      setMessage(t("feedback.updateSuccess"));
    } catch (caught) {
      setDialogError(errorText(caught, "feedback.updateError"));
    } finally {
      setSubmitting(false);
    }
  }

  async function submitResetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;

    if (passwordForm.nextPassword.length < 6) {
      setDialogError(t("feedback.resetPasswordLength"));
      return;
    }

    setSubmitting(true);
    resetFeedback();

    try {
      await resetMemberPassword(selected.id, {
        nextPassword: passwordForm.nextPassword,
      });
      setResetOpen(false);
      setPasswordForm({ nextPassword: "" });
      setMessage(t("feedback.resetPasswordSuccess", { name: selected.name }));
    } catch (caught) {
      setDialogError(errorText(caught, "feedback.resetPasswordError"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleMemberStatus(member: MemberRecord) {
    const suspend = member.status !== "Suspended";
    setSubmitting(true);
    resetFeedback();

    try {
      const updated = suspend
        ? await disableMember(member.id)
        : await enableMember(member.id);
      await reloadMembers(updated.id);
      setMessage(
        suspend ? t("feedback.memberDisabled") : t("feedback.memberEnabled"),
      );
    } catch (caught) {
      setError(
        errorText(
          caught,
          suspend
            ? "feedback.memberDisableError"
            : "feedback.memberEnableError",
        ),
      );
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * 解除一名成员与本工作区的关联。
   *
   * 收参数而不是读 `selected`:确认由菜单项承担(DS 的 `confirm`),那一项知道
   * 自己作用在哪一行。失败重新抛出,否则确认件会把失败当成成功关掉框。
   */
  async function handleUnlinkMember(member: MemberRecord) {
    setSubmitting(true);
    resetFeedback();

    try {
      await unlinkMember(member.id);
      await reloadMembers();
      setMessage(t("feedback.unlinkSuccess"));
    } catch (caught) {
      setError(errorText(caught, "feedback.unlinkError"));
      throw caught;
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResendInvite(member: MemberRecord) {
    setSubmitting(true);
    resetFeedback();
    try {
      const result = await resendInvitation(member.id);
      await reloadMembers(member.id);
      setInviteResult({ result, resent: true });
      setMessage(
        result.emailSent
          ? t("feedback.inviteResent")
          : t("feedback.inviteNoEmail"),
      );
    } catch (caught) {
      setError(errorText(caught, "feedback.resendError"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRevokeInvite(member: MemberRecord) {
    setSubmitting(true);
    resetFeedback();
    try {
      await revokeInvitation(member.id);
      await reloadMembers();
      setMessage(t("feedback.inviteRevoked"));
    } catch (caught) {
      setError(errorText(caught, "feedback.revokeError"));
      throw caught;
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * 批量动作用 allSettled:一条失败不该让已成功的几条看起来也失败。owner、本人、
   * 待接受的邀请行不在目标里(BFF 会拒,页面先跳过并说明)。
   */
  async function runBulk(
    targets: MemberRecord[],
    skipped: number,
    act: (member: MemberRecord) => Promise<unknown>,
    successKey: string,
    errorKey: string,
  ) {
    if (!targets.length) {
      if (skipped > 0) setError(t("feedback.bulkSkipped"));
      return;
    }
    setSubmitting(true);
    resetFeedback();
    try {
      const results = await Promise.allSettled(targets.map(act));
      const failed = results.filter((r) => r.status === "rejected").length;
      await reloadMembers();
      setBulkUnlinkOpen(false);
      const done = targets.length - failed;
      if (failed === 0) {
        setMessage(t(successKey, { count: done }));
      } else if (done === 0) {
        setError(t(errorKey));
      } else {
        setError(t("feedback.bulkPartial", { done, failed }));
      }
      if (skipped > 0 && failed === 0) setError(t("feedback.bulkSkipped"));
    } finally {
      setSubmitting(false);
    }
  }

  function isProtectedRow(member: MemberRecord) {
    return member.isPrimaryOwner || member.id === session.user?.id;
  }

  function bulkTargets(predicate: (member: MemberRecord) => boolean) {
    const picked = members.filter(
      (member) => selectedIds.has(member.id) && predicate(member),
    );
    const eligible = picked.filter((member) => !isProtectedRow(member));
    return { targets: eligible, skipped: picked.length - eligible.length };
  }

  function handleBulkStatus(next: "suspend" | "restore") {
    const { targets, skipped } = bulkTargets((member) =>
      next === "suspend"
        ? member.status === "Active"
        : member.status === "Suspended",
    );
    return runBulk(
      targets,
      skipped,
      (member) =>
        next === "suspend" ? disableMember(member.id) : enableMember(member.id),
      next === "suspend" ? "feedback.bulkDisabled" : "feedback.bulkEnabled",
      next === "suspend"
        ? "feedback.bulkDisableError"
        : "feedback.bulkEnableError",
    );
  }

  function handleBulkUnlink() {
    const { targets, skipped } = bulkTargets(
      (member) => member.status !== "Invited",
    );
    return runBulk(
      targets,
      skipped,
      (member) => unlinkMember(member.id),
      "feedback.bulkUnlinkSuccess",
      "feedback.bulkUnlinkError",
    );
  }

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return members.filter((member) => {
      const matchesQuery =
        !normalizedQuery || memberSearchText(member).includes(normalizedQuery);
      const matchesStatus =
        status === "all" || member.status.toLowerCase() === status;
      return matchesQuery && matchesStatus;
    });
  }, [members, query, status]);

  const statusCounts = useMemo(
    () => ({
      active: members.filter((member) => member.status === "Active").length,
      invited: members.filter((member) => member.status === "Invited").length,
      suspended: members.filter((member) => member.status === "Suspended")
        .length,
    }),
    [members],
  );

  const selected = members.find((member) => member.id === selectedId) ?? null;
  const pager = useListPagination(filtered);
  const pagedMembers = pager.pageRows;
  const selectedCount = members.filter((member) =>
    selectedIds.has(member.id),
  ).length;
  const canManageMembers = hasCapability(
    session.capabilities,
    "tenant.member.manage",
  );
  const canAssignRoles = hasCapability(
    session.capabilities,
    "tenant.role.assign",
  );
  const memberActionVisibility = {
    bulk: selectedCount > 0 && canManageMembers,
    invite: canManageMembers,
    create: canManageMembers,
  };
  /* owner 只能经「转让所有权」产生;下拉里不给 owner 选项。 */
  const assignableRoles = roles.filter((role) => role.roleCode !== "owner");

  const statusFilters = [
    { value: "all", label: t("filters.all") },
    { value: "active", label: t("filters.active") },
    { value: "invited", label: t("filters.invited") },
    { value: "suspended", label: t("filters.suspended") },
  ] as const;

  const countTitle = t("table.countHint", {
    total: members.length,
    active: statusCounts.active,
    invited: statusCounts.invited,
    suspended: statusCounts.suspended,
  });

  /** Row identity cell: avatar + name (with owner / self mark) + username. */
  function memberIdentity(member: MemberRecord) {
    const username = memberUsername(member);
    const detailTitle = t("table.memberTitle", {
      name: member.name,
      username,
      phone: member.phone ?? t("table.emptyPhone"),
      email: member.email,
      role: member.role,
      team: member.team,
      status: t(`status.${member.status}`),
    });

    return (
      <span className="flex min-w-0 items-center gap-sm" title={detailTitle}>
        <UserAvatar
          src={member.avatarUrl?.trim() || null}
          alt={t("table.avatarAlt", { name: member.name })}
        />
        <span className="flex min-w-0 flex-col gap-2xs">
          <span className="flex items-center gap-xs">
            <span className="truncate text-label-md text-foreground">
              {member.name}
            </span>
            {member.isPrimaryOwner ? (
              <StatusBadge tone="brand">{t("table.primaryOwner")}</StatusBadge>
            ) : null}
            {member.id === session.user?.id ? (
              <StatusBadge tone="neutral">{t("table.selfTag")}</StatusBadge>
            ) : null}
          </span>
          <span className="truncate text-body-sm text-muted-foreground">
            {username}
          </span>
        </span>
      </span>
    );
  }

  function memberStatusBadge(member: MemberRecord) {
    return (
      <StatusBadge
        tone={statusToneMap[member.status]}
        dot
        title={t("table.statusTitle", {
          status: t(`status.${member.status}`),
        })}
      >
        {t(`status.${member.status}`)}
      </StatusBadge>
    );
  }

  function memberTimeline(member: MemberRecord) {
    if (member.status === "Invited") {
      return member.invitationExpiresAt
        ? t("table.invitedExpires", {
            date: fmtDate(member.invitationExpiresAt),
          })
        : "—";
    }
    return fmtDate(member.joinedAt);
  }

  /** 待接受邀请行的菜单:重发 / 撤销,没有编辑 / 重置 / 解除。 */
  function invitedMenuItems(member: MemberRecord): ActionMenuItem[] {
    return [
      {
        id: "resend",
        label: t("actions.resendInvite"),
        icon: "mail",
        disabled: submitting,
        onSelect: () => void handleResendInvite(member),
      },
      {
        id: "revoke",
        label: t("actions.revokeInvite"),
        icon: "x",
        danger: true,
        disabled: submitting,
        confirm: withLabels({
          verb: t("dialogs.revokeInvite.verb"),
          target: member.email,
          consequence: t("dialogs.revokeInvite.consequence"),
          cancelLabel: t("dialogs.revokeInvite.keep"),
          onConfirm: () => handleRevokeInvite(member),
        }),
      },
    ];
  }

  function memberMenuItems(member: MemberRecord): ActionMenuItem[] {
    const isOwner = member.isPrimaryOwner;
    const isSelf = member.id === session.user?.id;
    const protectedHint = isOwner
      ? t("hints.ownerProtected")
      : isSelf
        ? t("hints.selfProtected")
        : null;
    const roleHint = isOwner
      ? t("hints.ownerRoleLocked")
      : isSelf
        ? t("hints.selfProtected")
        : null;
    const items: ActionMenuItem[] = [];
    if (canAssignRoles) {
      items.push({
        id: "edit",
        label: t("actions.edit"),
        icon: "edit",
        disabled: roleHint !== null,
        ...(roleHint ? { hint: roleHint } : {}),
        onSelect: () => openEditDialog(member),
      });
    }
    if (canManageMembers) {
      items.push(
        {
          id: "toggle-status",
          label:
            member.status === "Suspended"
              ? t("actions.enableMember")
              : t("actions.disableMember"),
          icon: "shield-check",
          disabled: submitting || protectedHint !== null,
          ...(protectedHint ? { hint: protectedHint } : {}),
          onSelect: () => void handleToggleMemberStatus(member),
        },
        {
          id: "reset-password",
          label: t("actions.resetPassword"),
          icon: "key",
          onSelect: () => openResetDialog(member),
        },
        {
          id: "unlink",
          label: t("actions.unlink"),
          icon: "user-switch",
          disabled: submitting || protectedHint !== null,
          ...(protectedHint ? { hint: protectedHint } : {}),
          danger: true,
          confirm: withLabels({
            verb: t("dialogs.unlink.verb"),
            target: member.name,
            consequence: t("dialogs.unlink.consequence"),
            onConfirm: () => handleUnlinkMember(member),
          }),
        },
      );
    }
    return items;
  }

  function memberMenu(member: MemberRecord) {
    if (member.status === "Invited") {
      if (!canManageMembers) return null;
      return (
        <ActionMenu
          label={t("actions.menuLabel", { name: member.email })}
          items={invitedMenuItems(member)}
        />
      );
    }
    if (!canManageMembers && !canAssignRoles) return null;
    return (
      <ActionMenu
        label={t("actions.menuLabel", { name: member.name })}
        items={memberMenuItems(member)}
      />
    );
  }

  const resetFiltersAction = (
    <Button
      size="md"
      variant="outline"
      onClick={() => {
        setQuery("");
        setStatus("all");
        pager.resetPage();
      }}
    >
      <Icon name="x" size="xs" fallback="placeholder" />
      <span>{t("empty.resetFilters")}</span>
    </Button>
  );

  const pagination = (
    <Pagination
      className="w-full"
      page={pager.page}
      pageCount={pager.pageCount}
      total={members.length}
      filteredTotal={filtered.length}
      pageSize={pager.pageSize}
      onPageSizeChange={pager.onPageSizeChange}
      onPageChange={pager.onPageChange}
      previousLabel={t("pagination.previous")}
      nextLabel={t("pagination.next")}
    />
  );

  const roleSelect = (
    <Label>
      {t("dialogs.fields.role")}
      <NativeSelect
        value={memberForm.roleId}
        onChange={(event) =>
          setMemberForm((old) => ({ ...old, roleId: event.target.value }))
        }
      >
        <option value="">{t("dialogs.fields.defaultRole")}</option>
        {assignableRoles.map((role) => (
          <option key={role.id} value={role.id}>
            {role.roleName}
          </option>
        ))}
      </NativeSelect>
    </Label>
  );

  const emptyState = loadFailed ? (
    <LoadFailedEmpty />
  ) : (
    <EmptyState
      title={loading ? t("empty.loadingTitle") : t("empty.title")}
      description={
        loading ? t("empty.loadingDescription") : t("empty.description")
      }
      action={resetFiltersAction}
    />
  );

  return (
    <>
      <ListPageTemplate
        header={
          <ViewHeader
            icon="users"
            title={t("header.title")}
            description={t("header.description")}
          />
        }
        filters={
          <FilterBar
            view={view}
            onViewChange={setView}
            count={
              <span title={countTitle}>
                {t("table.toolbarTitle", { count: filtered.length })}
              </span>
            }
            actions={
              <>
                {memberActionVisibility.invite ? (
                  <Button
                    size="md"
                    variant="outline"
                    onClick={() => openCreateDialog("invite")}
                  >
                    <Icon name="mail" size="xs" fallback="placeholder" />
                    <span>{t("header.inviteMember")}</span>
                  </Button>
                ) : null}
                {memberActionVisibility.create ? (
                  <Button size="md" onClick={() => openCreateDialog("create")}>
                    <Icon name="plus" size="xs" fallback="placeholder" />
                    <span>{t("header.addMember")}</span>
                  </Button>
                ) : null}
              </>
            }
          >
            <InputGroup className="grow basis-media-3xl max-w-panel-sm">
              <InputGroupAddon>
                <Icon name="search" size="sm" aria-hidden="true" />
              </InputGroupAddon>
              <InputGroupInput
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  pager.resetPage();
                }}
                placeholder={t("table.searchPlaceholder")}
                aria-label={t("table.searchAriaLabel")}
              />
            </InputGroup>
            <NativeSelect
              wrapperClassName="w-fit"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value as MemberStatusFilter);
                pager.resetPage();
              }}
              aria-label={t("table.filterAriaLabel")}
            >
              {statusFilters.map((filter) => (
                <option key={filter.value} value={filter.value}>
                  {filter.label}
                </option>
              ))}
            </NativeSelect>
          </FilterBar>
        }
        bulkBar={
          memberActionVisibility.bulk ? (
            <BulkActionBar
              count={selectedCount}
              noun={t("bulk.noun")}
              onClear={() => setSelectedIds(new Set())}
              actions={[
                {
                  id: "disable",
                  label: t("bulk.disable"),
                  icon: "shield-check",
                  disabled: submitting,
                  onSelect: () => void handleBulkStatus("suspend"),
                },
                {
                  id: "enable",
                  label: t("bulk.enable"),
                  icon: "check",
                  disabled: submitting,
                  onSelect: () => void handleBulkStatus("restore"),
                },
                {
                  id: "unlink",
                  label: t("bulk.unlink"),
                  icon: "user-switch",
                  disabled: submitting,
                  onSelect: () => setBulkUnlinkOpen(true),
                },
              ]}
            />
          ) : null
        }
        table={
          <div className="flex flex-col gap-md">
            {loadFailed ? (
              <LoadFailedBanner
                onRetry={() => setReloadKey((k) => k + 1)}
                retrying={loading}
              />
            ) : null}
            {message ? <Banner tone="success" title={message} /> : null}
            {error ? <Banner tone="danger" title={error} /> : null}
            {view === "list" ? (
              <DataTable
                columns={[
                  {
                    id: "name",
                    header: t("table.columns.name"),
                    cell: (member: MemberRecord) => memberIdentity(member),
                  },
                  {
                    id: "phone",
                    header: t("table.columns.phone"),
                    cell: (member: MemberRecord) => (
                      <span className="text-muted-foreground">
                        {member.phone ?? t("table.emptyPhone")}
                      </span>
                    ),
                  },
                  {
                    id: "email",
                    header: t("table.columns.email"),
                    cell: (member: MemberRecord) => (
                      <span className="text-muted-foreground">
                        {member.email}
                      </span>
                    ),
                  },
                  {
                    id: "role",
                    header: t("table.columns.role"),
                    cell: (member: MemberRecord) => member.role,
                  },
                  {
                    id: "status",
                    header: t("table.columns.status"),
                    cell: (member: MemberRecord) => memberStatusBadge(member),
                  },
                  {
                    id: "joinedAt",
                    header: t("table.columns.joinedAt"),
                    cell: (member: MemberRecord) => (
                      <span className="tabular-nums text-muted-foreground">
                        {memberTimeline(member)}
                      </span>
                    ),
                  },
                ]}
                rows={pagedMembers}
                rowKey={(member: MemberRecord) => member.id}
                loading={loading}
                selectedKeys={[...selectedIds]}
                onSelectionChange={(keys) => setSelectedIds(new Set(keys))}
                indexStart={pager.indexStart}
                rowActions={(member: MemberRecord) => memberMenu(member)}
                empty={emptyState}
                footer={pagination}
              />
            ) : (
              <div className="flex flex-col gap-sm">
                <ListCardGrid>
                  {pagedMembers.map((member) => (
                    <ListCard
                      key={member.id}
                      icon={member.status === "Invited" ? "mail" : "user"}
                      title={member.name}
                      description={memberUsername(member)}
                      status={memberStatusBadge(member)}
                      actions={memberMenu(member)}
                      meta={
                        <span>
                          {member.email} · {member.role} ·{" "}
                          {memberTimeline(member)}
                        </span>
                      }
                    />
                  ))}
                </ListCardGrid>
                {pagination}
              </div>
            )}
          </div>
        }
      />

      {createMode ? (
        <DialogForm
          open
          title={
            createMode === "invite"
              ? t("dialogs.invite.title")
              : t("dialogs.create.title")
          }
          description={
            createMode === "invite"
              ? t("dialogs.invite.description")
              : t("dialogs.create.description")
          }
          submitLabel={
            createMode === "invite"
              ? t("dialogs.actions.sendInvite")
              : t("dialogs.actions.create")
          }
          cancelLabel={t("dialogs.actions.cancel")}
          submitting={submitting}
          onOpenChange={(open) => {
            if (!open) setCreateMode(null);
          }}
          onSubmit={(event) => void submitCreate(event)}
        >
          {dialogError ? <Banner tone="danger" title={dialogError} /> : null}
          {createHint === "account_not_found" ? (
            <div>
              <Button
                type="button"
                size="md"
                variant="outline"
                onClick={() => {
                  setDialogError(null);
                  setCreateHint(null);
                  setCreateMode("invite");
                }}
              >
                <Icon name="mail" size="xs" fallback="placeholder" />
                <span>{t("dialogs.create.switchToInvite")}</span>
              </Button>
            </div>
          ) : null}
          <Label>
            {t("dialogs.fields.email")}
            <Input
              type="email"
              value={memberForm.email}
              onChange={(event) =>
                setMemberForm((old) => ({ ...old, email: event.target.value }))
              }
              required
            />
          </Label>
          {roleSelect}
        </DialogForm>
      ) : null}

      {editOpen && selected ? (
        <DialogForm
          open
          title={t("dialogs.edit.title")}
          submitLabel={t("dialogs.actions.save")}
          cancelLabel={t("dialogs.actions.cancel")}
          submitting={submitting}
          onOpenChange={(open) => {
            if (!open) setEditOpen(false);
          }}
          onSubmit={(event) => void submitEdit(event)}
        >
          {dialogError ? <Banner tone="danger" title={dialogError} /> : null}
          <Label>
            {t("dialogs.fields.email")}
            <Input value={selected.email} disabled />
          </Label>
          {roleSelect}
        </DialogForm>
      ) : null}

      {resetOpen && selected ? (
        <DialogForm
          open
          title={t("dialogs.reset.title")}
          description={t("dialogs.reset.description", {
            name: selected.name,
          })}
          submitLabel={t("dialogs.actions.resetPassword")}
          cancelLabel={t("dialogs.actions.cancel")}
          submitting={submitting}
          onOpenChange={(open) => {
            if (!open) setResetOpen(false);
          }}
          onSubmit={(event) => void submitResetPassword(event)}
        >
          {dialogError ? <Banner tone="danger" title={dialogError} /> : null}
          <Label>
            {t("dialogs.fields.nextPassword")}
            <Input
              type="password"
              value={passwordForm.nextPassword}
              onChange={(event) =>
                setPasswordForm({ nextPassword: event.target.value })
              }
              minLength={6}
              required
            />
          </Label>
        </DialogForm>
      ) : null}

      {bulkUnlinkOpen ? (
        <DialogForm
          open
          title={t("dialogs.bulkUnlink.title")}
          description={t("dialogs.bulkUnlink.description", {
            count: selectedCount,
          })}
          submitLabel={t("dialogs.actions.unlink")}
          danger
          cancelLabel={t("dialogs.actions.cancel")}
          submitting={submitting}
          onOpenChange={(open) => {
            if (!open) setBulkUnlinkOpen(false);
          }}
          onSubmit={(event) => {
            event.preventDefault();
            void handleBulkUnlink();
          }}
        />
      ) : null}

      <InviteLinkDialog
        result={inviteResult?.result ?? null}
        resent={inviteResult?.resent ?? false}
        onClose={() => setInviteResult(null)}
      />
    </>
  );
}
