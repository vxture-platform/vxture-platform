"use client";

/**
 * RolesPage.tsx — 角色与权限(P0 分权,2026-08-21 去 Planned 重建)。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * 定位 = **只读角色目录 + 权限矩阵**(data_identity_200 §6/§13 裁定:角色是
 * 全局固定目录,自定义角色属未来待办——roles 无 tenant_id,放开写在 DB 层
 * 就不成立;旧版把整套增删改控件挂着 Planned,正解是收敛成目录呈现)。
 * 治理 RBAC ≠ 业务授权(铁律):本页只解释「谁能做哪些治理动作」;成员的
 * 角色指派在成员管理页完成。capability 已按成员实际角色派生,本页由
 * tenant.role.manage 门控(owner/manager 可见)。
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Badge,
  DataTable,
  EmptyState,
  Icon,
  MetricGrid,
  StatusBadge,
  ViewHeader,
  ViewLayout,
} from "@vxture/design-system";
import type { DataTableColumn, MetricGridItem } from "@vxture/design-system";
import { fetchTenantPermissions, fetchTenantRoles } from "@/api/console-bff";
import type {
  TenantPermissionRecord,
  TenantRoleRecord,
} from "@/entities/console";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import { PageSection, SignalList } from "@/layout/shell";

/** 固定目录的 5 个角色码(seed 权威);未知码回退服务端名称。 */
const KNOWN_ROLES = ["owner", "manager", "member", "readonly", "guest"];
const KNOWN_PERMS = new Set([
  "tenant.member.manage",
  "tenant.role.assign",
  "tenant.workspace.manage",
  "tenant.billing.manage",
  "tenant.settings.manage",
  "tenant.delete",
  "workspace.member.manage",
  "workspace.role.assign",
  "workspace.settings.manage",
]);

export function RolesPage() {
  const t = useTranslations("rolesPage");
  const { session } = useConsoleSession();

  const [roles, setRoles] = useState<TenantRoleRecord[]>([]);
  const [permissions, setPermissions] = useState<TenantPermissionRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchTenantRoles(), fetchTenantPermissions()])
      .then(([roleRows, permRows]) => {
        setRoles(roleRows);
        setPermissions(permRows);
      })
      .finally(() => setLoading(false));
  }, [session.tenant?.id]);

  const roleLabel = (code: string, fallback: string): string =>
    KNOWN_ROLES.includes(code) ? t(`role.${code}`) : fallback;
  const roleBlurb = (code: string): string | null =>
    KNOWN_ROLES.includes(code) ? t(`roleBlurb.${code}`) : null;
  const permLabel = (code: string): string =>
    KNOWN_PERMS.has(code) ? t(`perm.${code.replace(/\./g, "_")}`) : code;

  // 目录按固定序展示(owner→guest),未知码排尾
  const orderedRoles = useMemo(() => {
    const rank = (c: string) => {
      const i = KNOWN_ROLES.indexOf(c);
      return i === -1 ? KNOWN_ROLES.length : i;
    };
    return [...roles].sort((a, b) => rank(a.roleCode) - rank(b.roleCode));
  }, [roles]);

  const metrics = useMemo<MetricGridItem[]>(
    () => [
      {
        id: "roles",
        icon: "shield-check",
        label: t("metrics.roles"),
        value: String(roles.length),
        trend: t("metrics.rolesHint"),
      },
      {
        id: "perms",
        icon: "key",
        label: t("metrics.perms"),
        value: String(permissions.length),
        trend: t("metrics.permsHint"),
      },
      {
        id: "model",
        icon: "lock",
        label: t("metrics.model"),
        value: t("metrics.modelValue"),
        trend: t("metrics.modelHint"),
      },
    ],
    [roles.length, permissions.length, t],
  );

  // ── ① 角色目录 ────────────────────────────────────────────────────────────
  const roleColumns: DataTableColumn<TenantRoleRecord>[] = [
    {
      id: "role",
      header: t("directory.colRole"),
      cell: (r) => (
        <span className="flex flex-col">
          <span className="text-foreground">
            {roleLabel(r.roleCode, r.roleName)}
          </span>
          <span className="font-mono text-body-sm text-muted-foreground">
            {r.roleCode}
          </span>
        </span>
      ),
    },
    {
      id: "blurb",
      header: t("directory.colBlurb"),
      cell: (r) => (
        <span className="text-body-sm text-muted-foreground">
          {roleBlurb(r.roleCode) ?? "—"}
        </span>
      ),
    },
    {
      id: "permCount",
      header: t("directory.colPermCount"),
      align: "right",
      cell: (r) => (
        <span className="tabular-nums font-medium text-foreground">
          {r.permissions.length}
        </span>
      ),
    },
    {
      id: "system",
      header: t("directory.colKind"),
      align: "center",
      cell: (r) =>
        r.isSystem ? (
          <StatusBadge tone="info">{t("directory.system")}</StatusBadge>
        ) : (
          <Badge variant="outline">{t("directory.custom")}</Badge>
        ),
    },
  ];

  // ── ② 权限矩阵(行 = 权限点,列 = 角色 ✓)─────────────────────────────────
  const grantSets = useMemo(
    () =>
      new Map(
        orderedRoles.map((r) => [
          r.roleCode,
          new Set(r.permissions.map((p) => p.permissionCode)),
        ]),
      ),
    [orderedRoles],
  );

  const matrixColumns: DataTableColumn<TenantPermissionRecord>[] = [
    {
      id: "perm",
      header: t("matrix.colPerm"),
      cell: (p) => (
        <span className="flex flex-col">
          <span className="text-foreground">{permLabel(p.permissionCode)}</span>
          <span className="font-mono text-body-sm text-muted-foreground">
            {p.permissionCode}
          </span>
        </span>
      ),
    },
    ...orderedRoles.map<DataTableColumn<TenantPermissionRecord>>((r) => ({
      id: `role-${r.roleCode}`,
      header: roleLabel(r.roleCode, r.roleName),
      align: "center",
      cell: (p) =>
        grantSets.get(r.roleCode)?.has(p.permissionCode) ? (
          <Icon name="check" size="sm" fallback="check" />
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    })),
  ];

  return (
    <ViewLayout>
      <ViewHeader
        icon="shield-check"
        title={t("title")}
        description={t("description")}
      />

      <MetricGrid
        items={metrics}
        columns={3}
        loading={loading}
        aria-label={t("metrics.groupLabel")}
      />

      {/* ① 角色目录 */}
      <PageSection
        icon="shield-check"
        level={2}
        title={t("directory.title")}
        description={t("directory.description")}
      >
        <DataTable<TenantRoleRecord>
          columns={roleColumns}
          rows={orderedRoles}
          rowKey={(r) => r.roleCode}
          loading={loading}
          indexStart={1}
          empty={<EmptyState title={t("directory.empty")} />}
        />
      </PageSection>

      {/* ② 权限矩阵 */}
      <PageSection
        icon="key"
        level={2}
        title={t("matrix.title")}
        description={t("matrix.description")}
      >
        <DataTable<TenantPermissionRecord>
          columns={matrixColumns}
          rows={permissions}
          rowKey={(p) => p.permissionCode}
          loading={loading}
          indexStart={1}
          empty={<EmptyState title={t("matrix.empty")} />}
        />
      </PageSection>

      {/* ③ 治理口径说明 */}
      <PageSection
        icon="info"
        level={2}
        title={t("notes.title")}
        description={t("notes.description")}
      >
        <SignalList
          items={[
            {
              title: t("notes.fixedTitle"),
              description: t("notes.fixedBody"),
            },
            {
              title: t("notes.assignTitle"),
              description: t("notes.assignBody"),
            },
            {
              title: t("notes.scopeTitle"),
              description: t("notes.scopeBody"),
            },
          ]}
        />
      </PageSection>
    </ViewLayout>
  );
}
