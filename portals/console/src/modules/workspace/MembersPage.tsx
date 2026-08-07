"use client";

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
  type FilterBarView,
  type StatusBadgeTone,
  useListPagination,
  UserAvatar,
  ViewHeader,
} from "@vxture/design-system";
import {
  createMember,
  disableMember,
  fetchMembers,
  fetchTenantRoles,
  inviteMember,
  resetMemberPassword,
  unlinkMember,
  updateMember,
} from "@/api/console-bff";
import type { MemberRecord, TenantRoleRecord } from "@/entities/console";
import { useTranslations } from "next-intl";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";

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
  const { session } = useConsoleSession();
  const [members, setMembers] = useState<MemberRecord[]>([]);
  const [roles, setRoles] = useState<TenantRoleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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
  const [unlinkOpen, setUnlinkOpen] = useState(false);
  const [bulkUnlinkOpen, setBulkUnlinkOpen] = useState(false);
  const [memberForm, setMemberForm] = useState({
    email: "",
    nickname: "",
    remark: "",
    roleId: "",
  });
  const [passwordForm, setPasswordForm] = useState({
    nextPassword: "",
  });

  useEffect(() => {
    let active = true;

    setLoading(true);
    Promise.all([fetchMembers(), fetchTenantRoles()])
      .then(([records, roleRecords]) => {
        if (!active) {
          return;
        }

        setMembers(records);
        setRoles(roleRecords.filter((role) => role.status === "active"));
        setSelectedIds(new Set());
        setSelectedId(null);
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [session.tenant?.id, session.tenant?.mode]);

  function resetFeedback() {
    setMessage(null);
    setError(null);
  }

  function resetMemberForm(member?: MemberRecord | null) {
    setMemberForm({
      email: member?.email ?? "",
      nickname: member?.name ?? "",
      remark: member?.team === "Workspace" ? "" : (member?.team ?? ""),
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

  function openUnlinkDialog(member: MemberRecord) {
    setSelectedId(member.id);
    resetFeedback();
    setUnlinkOpen(true);
  }

  async function reloadMembers(nextSelectedId?: string | null) {
    const records = await fetchMembers();
    setMembers(records);
    setSelectedIds(new Set());
    setSelectedId(nextSelectedId ?? null);
  }

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!createMode) {
      return;
    }

    setSubmitting(true);
    resetFeedback();

    try {
      const payload = {
        email: memberForm.email,
        nickname: memberForm.nickname,
        remark: memberForm.remark,
        // The backend reads `roleCode`, not `roleId` — sending only the latter
        // silently landed every invite as plain `member` while reporting
        // success. The role catalog sets id === roleCode, so this is the same
        // value under the name the server actually looks at.
        roleCode: memberForm.roleId || null,
      };

      const created =
        createMode === "invite"
          ? await inviteMember(payload)
          : await createMember(payload);

      await reloadMembers(created.id);
      setCreateMode(null);
      resetMemberForm();
      setMessage(
        t(
          createMode === "invite"
            ? "feedback.inviteSuccess"
            : "feedback.createSuccess",
        ),
      );
    } catch {
      setError(
        t(
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
    if (!selected) {
      return;
    }

    setSubmitting(true);
    resetFeedback();

    try {
      const updated = await updateMember(selected.id, {
        nickname: memberForm.nickname,
        remark: memberForm.remark,
        // See submitCreate: the backend only reads `roleCode`.
        roleCode: memberForm.roleId || null,
      });
      await reloadMembers(updated.id);
      setEditOpen(false);
      setMessage(t("feedback.updateSuccess"));
    } catch {
      setError(t("feedback.updateError"));
    } finally {
      setSubmitting(false);
    }
  }

  async function submitResetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) {
      return;
    }

    if (passwordForm.nextPassword.length < 6) {
      setError(t("feedback.resetPasswordLength"));
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
    } catch {
      setError(t("feedback.resetPasswordError"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleMemberStatus(member: MemberRecord) {
    const nextStatus = member.status === "Suspended" ? "active" : "banned";
    setSubmitting(true);
    resetFeedback();

    try {
      const updated =
        nextStatus === "banned"
          ? await disableMember(member.id)
          : await updateMember(member.id, { status: nextStatus });
      await reloadMembers(updated.id);
      setMessage(
        nextStatus === "banned"
          ? t("feedback.memberDisabled")
          : t("feedback.memberEnabled"),
      );
    } catch {
      setError(
        nextStatus === "banned"
          ? t("feedback.memberDisableError")
          : t("feedback.memberEnableError"),
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUnlinkMember() {
    if (!selected) {
      return;
    }

    setSubmitting(true);
    resetFeedback();

    try {
      await unlinkMember(selected.id);
      await reloadMembers();
      setUnlinkOpen(false);
      setMessage(t("feedback.unlinkSuccess"));
    } catch {
      setError(t("feedback.unlinkError"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleBulkStatus(nextStatus: "active" | "banned") {
    const targets = members.filter(
      (member) =>
        selectedIds.has(member.id) &&
        (nextStatus === "banned"
          ? member.status !== "Suspended"
          : member.status === "Suspended"),
    );
    if (!targets.length) {
      return;
    }

    setSubmitting(true);
    resetFeedback();

    try {
      await Promise.all(
        targets.map((member) =>
          nextStatus === "banned"
            ? disableMember(member.id)
            : updateMember(member.id, { status: nextStatus }),
        ),
      );
      await reloadMembers();
      setMessage(
        nextStatus === "banned"
          ? t("feedback.bulkDisabled", { count: targets.length })
          : t("feedback.bulkEnabled", { count: targets.length }),
      );
    } catch {
      setError(
        nextStatus === "banned"
          ? t("feedback.bulkDisableError")
          : t("feedback.bulkEnableError"),
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleBulkUnlink() {
    const targets = members.filter((member) => selectedIds.has(member.id));
    if (!targets.length) {
      return;
    }

    setSubmitting(true);
    resetFeedback();

    try {
      await Promise.all(targets.map((member) => unlinkMember(member.id)));
      await reloadMembers();
      setBulkUnlinkOpen(false);
      setMessage(t("feedback.bulkUnlinkSuccess", { count: targets.length }));
    } catch {
      setError(t("feedback.bulkUnlinkError"));
    } finally {
      setSubmitting(false);
    }
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
  const selectedMembers = members.filter((member) =>
    selectedIds.has(member.id),
  );
  const selectedCount = selectedMembers.length;
  /* hasSelectedActive / hasSelectedSuspended used to gate the bulk
   * disable/enable buttons. Both buttons are hard-disabled until the backend
   * grows a real suspend (the current endpoint hard-deletes), so the gates
   * have no reader — reinstate them together with the buttons. */
  const memberActionVisibility = {
    bulk: selectedCount > 0,
    invite: true,
    create: true,
  };

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

  /** Row identity cell: avatar + name (with owner mark) + username. */
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

  function memberMenu(member: MemberRecord) {
    return (
      <ActionMenu
        label={t("actions.menuLabel", { name: member.name })}
        items={[
          {
            id: "edit",
            label: t("actions.edit"),
            icon: "edit",
            onSelect: () => openEditDialog(member),
          },
          {
            id: "toggle-status",
            label:
              member.status === "Suspended"
                ? t("actions.enableMember")
                : member.status === "Invited"
                  ? t("actions.disableInvite")
                  : t("actions.disableMember"),
            icon: "shield-check",
            /* Disabled until the backend has a real suspend: today
             * POST /members/:id/disable calls removeMember() — it HARD DELETES
             * the member and then returns null, so the router 404s and the UI
             * shows a failure while the person is already gone. Enabling is
             * blocked by the same handler pair, so the whole toggle is off. */
            disabled: true,
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
            disabled: submitting,
            danger: true,
            onSelect: () => openUnlinkDialog(member),
          },
        ]}
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
              noun="人"
              onClear={() => setSelectedIds(new Set())}
              actions={[
                /* Both disabled for the same reason as the per-row toggle:
                 * the disable endpoint hard-deletes members. Bulk made it
                 * worse — one click could remove an entire selection. */
                {
                  id: "disable",
                  label: t("bulk.disable"),
                  icon: "shield-check",
                  disabled: true,
                  onSelect: () => void handleBulkStatus("banned"),
                },
                {
                  id: "enable",
                  label: t("bulk.enable"),
                  icon: "check",
                  disabled: true,
                  onSelect: () => void handleBulkStatus("active"),
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
                    id: "lastActive",
                    header: t("table.columns.lastActive"),
                    cell: (member: MemberRecord) => (
                      <span className="text-muted-foreground">
                        {member.lastActive}
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
                empty={
                  <EmptyState
                    title={loading ? t("empty.loadingTitle") : t("empty.title")}
                    description={
                      loading
                        ? t("empty.loadingDescription")
                        : t("empty.description")
                    }
                    action={resetFiltersAction}
                  />
                }
                footer={pagination}
              />
            ) : (
              <div className="flex flex-col gap-sm">
                <ListCardGrid>
                  {pagedMembers.map((member) => (
                    <ListCard
                      key={member.id}
                      icon="user"
                      title={member.name}
                      description={memberUsername(member)}
                      onTitleClick={() => openEditDialog(member)}
                      status={memberStatusBadge(member)}
                      actions={memberMenu(member)}
                      meta={
                        <span>
                          {member.email} · {member.role} · {member.lastActive}
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
          <Label>
            {t("dialogs.fields.email")}
            <Input
              type="email"
              value={memberForm.email}
              onChange={(event) =>
                setMemberForm((old) => ({
                  ...old,
                  email: event.target.value,
                }))
              }
              required
            />
          </Label>
          <Label>
            {t("dialogs.fields.nickname")}
            <Input
              value={memberForm.nickname}
              onChange={(event) =>
                setMemberForm((old) => ({
                  ...old,
                  nickname: event.target.value,
                }))
              }
            />
          </Label>
          <Label>
            {t("dialogs.fields.teamRemark")}
            <Input
              value={memberForm.remark}
              onChange={(event) =>
                setMemberForm((old) => ({
                  ...old,
                  remark: event.target.value,
                }))
              }
            />
          </Label>
          <Label>
            {t("dialogs.fields.role")}
            <NativeSelect
              value={memberForm.roleId}
              onChange={(event) =>
                setMemberForm((old) => ({
                  ...old,
                  roleId: event.target.value,
                }))
              }
            >
              <option value="">{t("dialogs.fields.defaultRole")}</option>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.roleName}
                </option>
              ))}
            </NativeSelect>
          </Label>
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
          <Label>
            {t("dialogs.fields.email")}
            <Input value={selected.email} disabled />
          </Label>
          <Label>
            {t("dialogs.fields.nickname")}
            <Input
              value={memberForm.nickname}
              onChange={(event) =>
                setMemberForm((old) => ({
                  ...old,
                  nickname: event.target.value,
                }))
              }
            />
          </Label>
          <Label>
            {t("dialogs.fields.teamRemark")}
            <Input
              value={memberForm.remark}
              onChange={(event) =>
                setMemberForm((old) => ({
                  ...old,
                  remark: event.target.value,
                }))
              }
            />
          </Label>
          <Label>
            {t("dialogs.fields.role")}
            <NativeSelect
              value={memberForm.roleId}
              onChange={(event) =>
                setMemberForm((old) => ({
                  ...old,
                  roleId: event.target.value,
                }))
              }
            >
              <option value="">{t("dialogs.fields.defaultRole")}</option>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.roleName}
                </option>
              ))}
            </NativeSelect>
          </Label>
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

      {unlinkOpen && selected ? (
        <DialogForm
          open
          title={t("dialogs.unlink.title")}
          description={t("dialogs.unlink.description", {
            name: selected.name,
          })}
          submitLabel={t("dialogs.actions.unlink")}
          danger
          cancelLabel={t("dialogs.actions.cancel")}
          submitting={submitting}
          onOpenChange={(open) => {
            if (!open) setUnlinkOpen(false);
          }}
          onSubmit={(event) => {
            event.preventDefault();
            void handleUnlinkMember();
          }}
        />
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
    </>
  );
}
