"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ActionMenu,
  Banner,
  BulkActionBar,
  Button,
  Checkbox,
  DataTable,
  DialogForm,
  EmptyState,
  FieldLabel,
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
  TableTitleCell,
  type FilterBarView,
  useListPagination,
  ViewHeader,
} from "@vxture/design-system";
import {
  createTenantRole,
  deleteTenantRole,
  fetchTenantPermissions,
  fetchTenantRoles,
  updateTenantRole,
} from "@/api/console-bff";
import type {
  TenantPermissionRecord,
  TenantRoleRecord,
} from "@/entities/console";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import { PlannedBadge, PlannedNotice } from "@/components/planned";
import { useTranslations } from "next-intl";

type RoleFilter = "all" | "active" | "disabled" | "system" | "custom";
type Feedback = {
  tone: "success" | "error";
  key: string;
  values?: Record<string, number | string>;
} | null;

function rolePermissionSummary(role: TenantRoleRecord) {
  return role.permissions
    .map((permission) => permission.permissionCode)
    .join(", ");
}

function roleSearchText(role: TenantRoleRecord) {
  return [
    role.roleName,
    role.roleCode,
    role.description,
    role.status,
    role.isSystem ? "system" : "custom",
    rolePermissionSummary(role),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function RolesPage() {
  const t = useTranslations("rolesPage");
  const { session } = useConsoleSession();
  const [roles, setRoles] = useState<TenantRoleRecord[]>([]);
  const [permissions, setPermissions] = useState<TenantPermissionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<RoleFilter>("all");
  const [view, setView] = useState<FilterBarView>("list");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialogMode, setDialogMode] = useState<"create" | "edit" | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [form, setForm] = useState({
    roleCode: "",
    roleName: "",
    description: "",
    status: "active" as "active" | "disabled",
    permissionIds: [] as string[],
  });

  const currentTenantId =
    session.tenant?.mode === "tenant" ? session.tenant.id : undefined;

  useEffect(() => {
    let active = true;
    setLoading(true);

    Promise.all([fetchTenantRoles(), fetchTenantPermissions()])
      .then(([roleRecords, permissionRecords]) => {
        if (!active) {
          return;
        }

        setRoles(roleRecords);
        setPermissions(permissionRecords);
        setSelectedIds(new Set());
        setSelectedId(null);
        setFeedback(null);
      })
      .catch(() => {
        if (active) {
          setFeedback({ tone: "error", key: "loadError" });
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [currentTenantId]);

  function resetFeedback() {
    setFeedback(null);
  }

  function resetForm(role?: TenantRoleRecord | null) {
    setForm({
      roleCode: role?.roleCode ?? "",
      roleName: role?.roleName ?? "",
      description: role?.description ?? "",
      status: role?.status ?? "active",
      permissionIds: role?.permissions.map((permission) => permission.id) ?? [],
    });
  }

  function openCreateDialog() {
    resetForm();
    resetFeedback();
    setDialogMode("create");
  }

  function openEditDialog(role: TenantRoleRecord) {
    setSelectedId(role.id);
    resetForm(role);
    resetFeedback();
    setDialogMode("edit");
  }

  function openDeleteDialog(role: TenantRoleRecord) {
    if (role.isSystem) {
      return;
    }

    setSelectedId(role.id);
    resetFeedback();
    setDeleteOpen(true);
  }

  async function reloadRoles(nextSelectedId?: string | null) {
    const roleRecords = await fetchTenantRoles();
    setRoles(roleRecords);
    setSelectedIds(new Set());
    setSelectedId(nextSelectedId ?? null);
  }

  async function submitRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    resetFeedback();

    try {
      if (dialogMode === "create") {
        const created = await createTenantRole({
          roleCode: form.roleCode,
          roleName: form.roleName,
          description: form.description,
          permissionIds: form.permissionIds,
        });
        await reloadRoles(created.id);
        setFeedback({ tone: "success", key: "createSuccess" });
      } else if (dialogMode === "edit" && selected) {
        const updated = await updateTenantRole(selected.id, {
          roleName: form.roleName,
          description: form.description,
          status: form.status,
          permissionIds: form.permissionIds,
        });
        await reloadRoles(updated.id);
        setFeedback({ tone: "success", key: "updateSuccess" });
      }

      setDialogMode(null);
    } catch {
      setFeedback({
        tone: "error",
        key: dialogMode === "create" ? "createError" : "updateError",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleRoleStatus(role: TenantRoleRecord) {
    const nextStatus = role.status === "active" ? "disabled" : "active";
    setSubmitting(true);
    resetFeedback();

    try {
      const updated = await updateTenantRole(role.id, { status: nextStatus });
      await reloadRoles(updated.id);
      setFeedback({
        tone: "success",
        key: nextStatus === "active" ? "enableSuccess" : "disableSuccess",
      });
    } catch {
      setFeedback({
        tone: "error",
        key: nextStatus === "active" ? "enableError" : "disableError",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteRole() {
    if (!selected || selected.isSystem) {
      return;
    }

    setSubmitting(true);
    resetFeedback();

    try {
      await deleteTenantRole(selected.id);
      await reloadRoles();
      setDeleteOpen(false);
      setFeedback({ tone: "success", key: "deleteSuccess" });
    } catch {
      setFeedback({ tone: "error", key: "deleteError" });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleBulkStatus(nextStatus: "active" | "disabled") {
    const targets = roles.filter(
      (role) => selectedIds.has(role.id) && role.status !== nextStatus,
    );
    if (!targets.length) {
      return;
    }

    setSubmitting(true);
    resetFeedback();

    try {
      await Promise.all(
        targets.map((role) =>
          updateTenantRole(role.id, { status: nextStatus }),
        ),
      );
      await reloadRoles();
      setFeedback({
        tone: "success",
        key: nextStatus === "active" ? "bulkEnabled" : "bulkDisabled",
        values: { count: targets.length },
      });
    } catch {
      setFeedback({
        tone: "error",
        key: nextStatus === "active" ? "bulkEnableError" : "bulkDisableError",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleBulkDeleteRoles() {
    const targets = roles.filter(
      (role) => selectedIds.has(role.id) && !role.isSystem,
    );
    if (!targets.length) {
      return;
    }

    setSubmitting(true);
    resetFeedback();

    try {
      await Promise.all(targets.map((role) => deleteTenantRole(role.id)));
      await reloadRoles();
      setBulkDeleteOpen(false);
      setFeedback({
        tone: "success",
        key: "bulkDeleted",
        values: { count: targets.length },
      });
    } catch {
      setFeedback({ tone: "error", key: "bulkDeleteError" });
    } finally {
      setSubmitting(false);
    }
  }

  function togglePermission(permissionId: string) {
    setForm((current) => ({
      ...current,
      permissionIds: current.permissionIds.includes(permissionId)
        ? current.permissionIds.filter((item) => item !== permissionId)
        : [...current.permissionIds, permissionId],
    }));
  }

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return roles.filter((role) => {
      const matchesQuery =
        !normalizedQuery || roleSearchText(role).includes(normalizedQuery);
      const matchesFilter =
        filter === "all" ||
        role.status === filter ||
        (filter === "system" && role.isSystem) ||
        (filter === "custom" && !role.isSystem);
      return matchesQuery && matchesFilter;
    });
  }, [filter, query, roles]);

  const roleCounts = useMemo(
    () => ({
      active: roles.filter((role) => role.status === "active").length,
      disabled: roles.filter((role) => role.status === "disabled").length,
      system: roles.filter((role) => role.isSystem).length,
      custom: roles.filter((role) => !role.isSystem).length,
    }),
    [roles],
  );

  const pager = useListPagination(filtered);
  const pagedRoles = pager.pageRows;

  const selected = roles.find((role) => role.id === selectedId) ?? null;
  const selectedRoles = roles.filter((role) => selectedIds.has(role.id));
  const selectedCount = selectedRoles.length;
  const selectedKeys = useMemo(() => [...selectedIds], [selectedIds]);
  const hasSelectedActive = selectedRoles.some(
    (role) => role.status === "active",
  );
  const hasSelectedDisabled = selectedRoles.some(
    (role) => role.status === "disabled",
  );
  const hasSelectedCustom = selectedRoles.some((role) => !role.isSystem);
  const bulkDeleteCount = selectedRoles.filter((role) => !role.isSystem).length;
  const countTitle = t("toolbar.countHint", {
    total: roles.length,
    active: roleCounts.active,
    disabled: roleCounts.disabled,
    system: roleCounts.system,
    custom: roleCounts.custom,
  });

  const roleFilters = [
    { value: "all", label: t("filters.all") },
    { value: "active", label: t("filters.active") },
    { value: "disabled", label: t("filters.disabled") },
    { value: "system", label: t("filters.system") },
    { value: "custom", label: t("filters.custom") },
  ] as const;

  const canCreateRole = true;

  /* Reads work; every write is rejected by the backend with
   * CUSTOM_ROLES_UNSUPPORTED (HTTP 400). The write affordances stay visible so
   * the intended capability remains legible, but they are inert until the
   * platform supports tenant-defined roles. */
  const writesPlanned = true;

  /* Row action menu: shared by the table rows and the card view. */
  function roleMenu(role: TenantRoleRecord) {
    return (
      <ActionMenu
        label={t("actions.menuLabel", { name: role.roleName })}
        items={[
          {
            id: "edit",
            label: t("actions.edit"),
            icon: "edit",
            disabled: writesPlanned || submitting,
            onSelect: () => openEditDialog(role),
          },
          {
            id: "toggle-status",
            label:
              role.status === "active"
                ? t("actions.disable")
                : t("actions.enable"),
            icon: "shield-check",
            disabled: writesPlanned || submitting,
            onSelect: () => void handleToggleRoleStatus(role),
          },
          ...(!role.isSystem
            ? [
                {
                  id: "delete",
                  label: t("actions.delete"),
                  icon: "trash" as const,
                  disabled: writesPlanned || submitting,
                  danger: true,
                  onSelect: () => openDeleteDialog(role),
                },
              ]
            : []),
        ]}
      />
    );
  }

  function roleStatusBadge(role: TenantRoleRecord) {
    const label =
      role.status === "active" ? t("status.active") : t("status.disabled");
    return (
      <StatusBadge
        tone={role.status === "active" ? "success" : "neutral"}
        dot
        title={label}
      >
        {label}
      </StatusBadge>
    );
  }

  const resetFiltersAction = (
    <Button
      size="md"
      variant="outline"
      onClick={() => {
        setQuery("");
        setFilter("all");
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
      total={roles.length}
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
          <div className="flex flex-col gap-md">
            <ViewHeader
              icon="shield-check"
              title={t("header.title")}
              description={t("header.description")}
              secondary={<PlannedBadge />}
            />
            <PlannedNotice />
            {feedback ? (
              <Banner
                tone={feedback.tone === "success" ? "success" : "danger"}
                title={t(`feedback.${feedback.key}`, feedback.values)}
              />
            ) : null}
          </div>
        }
        filters={
          <FilterBar
            view={view}
            onViewChange={setView}
            count={
              <span title={countTitle}>
                {t("toolbar.count", { count: filtered.length })}
              </span>
            }
            actions={
              canCreateRole ? (
                <Button
                  size="md"
                  disabled={writesPlanned}
                  onClick={openCreateDialog}
                >
                  <Icon name="plus" size="xs" fallback="placeholder" />
                  <span>{t("header.create")}</span>
                </Button>
              ) : null
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
                placeholder={t("toolbar.searchPlaceholder")}
                aria-label={t("toolbar.searchAriaLabel")}
              />
            </InputGroup>
            <NativeSelect
              wrapperClassName="w-fit"
              value={filter}
              aria-label={t("toolbar.filterAriaLabel")}
              onChange={(event) => {
                setFilter(event.target.value as RoleFilter);
                pager.resetPage();
              }}
            >
              {roleFilters.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </NativeSelect>
          </FilterBar>
        }
        bulkBar={
          <BulkActionBar
            count={selectedCount}
            noun="个角色"
            onClear={() => setSelectedIds(new Set())}
            actions={[
              {
                id: "disable",
                label: t("bulk.disable"),
                icon: "shield-check",
                disabled: writesPlanned || submitting || !hasSelectedActive,
                onSelect: () => void handleBulkStatus("disabled"),
              },
              {
                id: "enable",
                label: t("bulk.enable"),
                icon: "check",
                disabled: writesPlanned || submitting || !hasSelectedDisabled,
                onSelect: () => void handleBulkStatus("active"),
              },
              {
                id: "delete",
                label: t("bulk.delete"),
                icon: "trash",
                disabled: writesPlanned || submitting || !hasSelectedCustom,
                danger: true,
                onSelect: () => setBulkDeleteOpen(true),
              },
            ]}
          />
        }
        table={
          view === "list" ? (
            <DataTable
              columns={[
                {
                  id: "name",
                  header: t("list.columns.name"),
                  cell: (role) => (
                    <span
                      className="block"
                      title={t("list.roleTitle", {
                        name: role.roleName,
                        code: role.roleCode,
                        status:
                          role.status === "active"
                            ? t("status.active")
                            : t("status.disabled"),
                        type: role.isSystem
                          ? t("type.system")
                          : t("type.custom"),
                        permissions: role.permissions.length,
                      })}
                    >
                      <TableTitleCell
                        icon={role.isSystem ? "shield-check" : "users"}
                        title={role.roleName}
                        description={
                          role.description || t("list.noDescription")
                        }
                        onTitleClick={() => openEditDialog(role)}
                      />
                    </span>
                  ),
                },
                {
                  id: "code",
                  header: t("list.columns.code"),
                  cell: (role) => (
                    <span
                      className="text-muted-foreground"
                      title={role.roleCode}
                    >
                      {role.roleCode}
                    </span>
                  ),
                },
                {
                  id: "status",
                  header: t("list.columns.status"),
                  cell: (role) => roleStatusBadge(role),
                },
                {
                  id: "type",
                  header: t("list.columns.type"),
                  cell: (role) => (
                    <span className="text-muted-foreground">
                      {role.isSystem ? t("type.system") : t("type.custom")}
                    </span>
                  ),
                },
                {
                  id: "permissions",
                  header: t("list.columns.permissions"),
                  align: "right",
                  cell: (role) => (
                    <span
                      title={
                        rolePermissionSummary(role) || t("list.noPermissions")
                      }
                    >
                      {t("list.permissionCount", {
                        count: role.permissions.length,
                      })}
                    </span>
                  ),
                },
              ]}
              rows={pagedRoles}
              rowKey={(role) => role.id}
              loading={loading}
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
              selectedKeys={selectedKeys}
              onSelectionChange={(keys) => setSelectedIds(new Set(keys))}
              indexStart={pager.indexStart}
              rowActions={roleMenu}
              footer={pagination}
            />
          ) : (
            <div className="flex flex-col gap-sm">
              <ListCardGrid>
                {pagedRoles.map((role) => (
                  <ListCard
                    key={role.id}
                    icon={role.isSystem ? "shield-check" : "users"}
                    title={role.roleName}
                    description={role.description || t("list.noDescription")}
                    onTitleClick={() => openEditDialog(role)}
                    status={roleStatusBadge(role)}
                    actions={roleMenu(role)}
                    meta={
                      <span
                        title={
                          rolePermissionSummary(role) || t("list.noPermissions")
                        }
                      >
                        {role.roleCode} ·{" "}
                        {role.isSystem ? t("type.system") : t("type.custom")} ·{" "}
                        {t("list.permissionCount", {
                          count: role.permissions.length,
                        })}
                      </span>
                    }
                  />
                ))}
              </ListCardGrid>
              {pagination}
            </div>
          )
        }
      />

      {dialogMode ? (
        <DialogForm
          open
          title={
            dialogMode === "create"
              ? t("dialog.createTitle")
              : t("dialog.editTitle")
          }
          submitLabel={
            dialogMode === "create" ? t("dialog.create") : t("dialog.save")
          }
          cancelLabel={t("dialog.cancel")}
          submitDisabled={writesPlanned}
          submitting={submitting}
          onOpenChange={(open) => {
            if (!open) setDialogMode(null);
          }}
          onSubmit={(event) => void submitRole(event)}
        >
          <Label>
            {t("dialog.fields.code")}
            <Input
              value={form.roleCode}
              disabled={dialogMode === "edit"}
              onChange={(event) =>
                setForm((old) => ({ ...old, roleCode: event.target.value }))
              }
              required
            />
          </Label>
          <Label>
            {t("dialog.fields.name")}
            <Input
              value={form.roleName}
              onChange={(event) =>
                setForm((old) => ({ ...old, roleName: event.target.value }))
              }
              required
            />
          </Label>
          <Label>
            {t("dialog.fields.description")}
            <Input
              value={form.description}
              onChange={(event) =>
                setForm((old) => ({
                  ...old,
                  description: event.target.value,
                }))
              }
            />
          </Label>
          <Label>
            {t("dialog.fields.status")}
            <NativeSelect
              value={form.status}
              onChange={(event) =>
                setForm((old) => ({
                  ...old,
                  status: event.target.value as "active" | "disabled",
                }))
              }
            >
              <option value="active">{t("status.active")}</option>
              <option value="disabled">{t("status.disabled")}</option>
            </NativeSelect>
          </Label>
          {/* Permission multi-select: one checkbox per permission, each label
                bound via htmlFor so the whole row stays keyboard reachable. */}
          <div className="flex flex-col gap-sm">
            <div className="flex flex-col gap-2xs">
              <span className="text-label-md">
                {t("dialog.permissionsTitle")}
              </span>
              <span className="text-body-sm text-muted-foreground">
                {t("dialog.permissionsDescription")}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-sm">
              {permissions.map((permission) => (
                <div key={permission.id} className="flex items-center gap-xs">
                  <Checkbox
                    id={`role-permission-${permission.id}`}
                    checked={form.permissionIds.includes(permission.id)}
                    onCheckedChange={() => togglePermission(permission.id)}
                  />
                  <FieldLabel
                    htmlFor={`role-permission-${permission.id}`}
                    className="text-body-sm"
                    title={permission.description ?? permission.permissionName}
                  >
                    {permission.permissionCode}
                  </FieldLabel>
                </div>
              ))}
            </div>
          </div>
        </DialogForm>
      ) : null}

      {deleteOpen && selected ? (
        <DialogForm
          open
          title={t("dialog.deleteTitle")}
          description={t("dialog.deleteDescription", {
            name: selected.roleName,
          })}
          submitLabel={t("dialog.delete")}
          danger
          submitDisabled={writesPlanned}
          cancelLabel={t("dialog.cancel")}
          submitting={submitting}
          onOpenChange={(open) => {
            if (!open) setDeleteOpen(false);
          }}
          onSubmit={(event) => {
            event.preventDefault();
            void handleDeleteRole();
          }}
        />
      ) : null}

      {bulkDeleteOpen ? (
        <DialogForm
          open
          title={t("dialog.bulkDeleteTitle")}
          description={t("dialog.bulkDeleteDescription", {
            count: bulkDeleteCount,
          })}
          submitLabel={t("dialog.delete")}
          danger
          submitDisabled={writesPlanned || !bulkDeleteCount}
          cancelLabel={t("dialog.cancel")}
          submitting={submitting}
          onOpenChange={(open) => {
            if (!open) setBulkDeleteOpen(false);
          }}
          onSubmit={(event) => {
            event.preventDefault();
            void handleBulkDeleteRoles();
          }}
        />
      ) : null}
    </>
  );
}
