"use client";

/**
 * RolesPage.tsx — 角色与权限(P0 分权,2026-08-21 去 Planned 重建;2026-09-04 批 0a
 * 权限配置体系:矩阵改按目录树呈现)。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * 定位 = **只读角色目录 + 权限矩阵**(data_identity_200 §6/§13 裁定:角色是
 * 全局固定目录,自定义角色属未来待办——roles 无 tenant_id,放开写在 DB 层
 * 就不成立;旧版把整套增删改控件挂着 Planned,正解是收敛成目录呈现)。
 * 矩阵的行 = 权限目录(access.permissions)的树:板块 → 页面 → 操作码,与侧栏
 * 信息架构同构;没有操作码的页面标「成员均可见」。列 = 五个角色 ✓。
 * 治理 RBAC ≠ 业务授权(铁律):本页只解释「谁能做哪些治理动作」;成员的
 * 角色指派在成员管理页完成。本页由 tenant.member.read 门控。
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
import {
  TENANT_PERMISSION_CODES,
  TENANT_ROLE_CODES,
  WORKSPACE_PERMISSION_CODES,
} from "@vxture/core-utils";
import { fetchTenantPermissions, fetchTenantRoles } from "@/api/console-bff";
import { consoleDomains } from "@/config/navigation";
import type {
  TenantPermissionRecord,
  TenantRoleRecord,
} from "@/entities/console";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import { PageSection, SignalList } from "@/layout/shell";

/** 固定目录的 5 个角色码与目录里的操作码(权威在 core-utils);未知码回退服务端名称。 */
const KNOWN_ROLES: readonly string[] = TENANT_ROLE_CODES;
const KNOWN_PERMS = new Set<string>([
  ...TENANT_PERMISSION_CODES,
  ...WORKSPACE_PERMISSION_CODES,
]);

/** 页面路由 → 侧栏词条键(与导航同一份标签,不再为角色页另写一套名字)。 */
const PAGE_LABEL_KEY: Readonly<Record<string, string>> = Object.fromEntries(
  consoleDomains.flatMap((d) =>
    d.sections.flatMap((s) => s.items.map((it) => [it.href, it.labelKey])),
  ),
);
/** 板块菜单码 → 侧栏分组词条键(tenant.menu.account_tenant → accountTenant)。 */
function sectionKeyOf(code: string): string {
  return code
    .replace(/^tenant\.menu\./, "")
    .replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

interface MatrixRow {
  key: string;
  kind: "section" | "page" | "perm" | "group";
  code: string;
  label: string;
  depth: number;
  /** 页面没有操作码:任何成员可见。 */
  openToAll?: boolean;
}

export function RolesPage() {
  const t = useTranslations("rolesPage");
  const tSidebar = useTranslations("sidebar");
  const { session } = useConsoleSession();

  const [roles, setRoles] = useState<TenantRoleRecord[]>([]);
  const [permissions, setPermissions] = useState<TenantPermissionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadFailed(false);
    Promise.all([fetchTenantRoles(), fetchTenantPermissions()])
      .then(([roleRows, permRows]) => {
        if (!active) return;
        setRoles(roleRows);
        setPermissions(permRows);
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

  // ── 目录树 → 矩阵行(板块 → 页面 → 操作码;没挂页面的操作码归「其他」)────────
  const { rows: matrixRows, permCount } = useMemo(() => {
    const byParent = new Map<string | null, TenantPermissionRecord[]>();
    for (const p of permissions) {
      const list = byParent.get(p.parentCode) ?? [];
      list.push(p);
      byParent.set(p.parentCode, list);
    }
    const bySort = (a: TenantPermissionRecord, b: TenantPermissionRecord) =>
      a.sort - b.sort || a.permissionCode.localeCompare(b.permissionCode);
    const roots = [...(byParent.get(null) ?? [])].sort(bySort);
    const rows: MatrixRow[] = [];
    let count = 0;

    const pushPerm = (p: TenantPermissionRecord, depth: number) => {
      count += 1;
      rows.push({
        key: p.permissionCode,
        kind: "perm",
        code: p.permissionCode,
        label: permLabel(p.permissionCode),
        depth,
      });
    };

    for (const section of roots.filter((r) => r.permissionType === "menu")) {
      const sectionKey = `sections.${sectionKeyOf(section.permissionCode)}`;
      rows.push({
        key: section.permissionCode,
        kind: "section",
        code: section.permissionCode,
        label: tSidebar.has(sectionKey)
          ? tSidebar(sectionKey)
          : section.permissionName,
        depth: 0,
      });
      const pages = [...(byParent.get(section.permissionCode) ?? [])].sort(
        bySort,
      );
      for (const page of pages) {
        const perms = [...(byParent.get(page.permissionCode) ?? [])]
          .filter((p) => p.permissionType === "api")
          .sort(bySort);
        const labelKey = page.routePath
          ? PAGE_LABEL_KEY[page.routePath]
          : undefined;
        rows.push({
          key: page.permissionCode,
          kind: "page",
          code: page.permissionCode,
          label: labelKey ? tSidebar(`items.${labelKey}`) : page.permissionName,
          depth: 1,
          openToAll: perms.length === 0,
        });
        for (const p of perms) pushPerm(p, 2);
      }
    }

    const orphans = roots.filter((r) => r.permissionType === "api");
    if (orphans.length > 0) {
      rows.push({
        key: "__other__",
        kind: "group",
        code: "",
        label: t("matrix.groupOther"),
        depth: 0,
      });
      for (const p of orphans) pushPerm(p, 1);
    }
    return { rows, permCount: count };
    // permLabel / tSidebar 随 t 变;t 随 locale 变。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permissions, t, tSidebar]);

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
        value: String(permCount),
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
    [roles.length, permCount, t],
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

  // ── ② 权限矩阵(行 = 目录树,列 = 角色 ✓)──────────────────────────────────
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

  const INDENT = ["", "pl-lg", "pl-2xl"] as const;
  const matrixColumns: DataTableColumn<MatrixRow>[] = [
    {
      id: "perm",
      header: t("matrix.colPerm"),
      cell: (row) => (
        <span className={`flex flex-col ${INDENT[row.depth] ?? INDENT[2]}`}>
          <span
            className={
              row.kind === "perm"
                ? "text-foreground"
                : "font-medium text-foreground"
            }
          >
            {row.label}
            {row.openToAll ? (
              <span className="ml-sm">
                <Badge variant="outline">{t("matrix.openToAll")}</Badge>
              </span>
            ) : null}
          </span>
          {row.kind === "perm" ? (
            <span className="font-mono text-body-sm text-muted-foreground">
              {row.code}
            </span>
          ) : null}
        </span>
      ),
    },
    ...orderedRoles.map<DataTableColumn<MatrixRow>>((r) => ({
      id: `role-${r.roleCode}`,
      header: roleLabel(r.roleCode, r.roleName),
      align: "center",
      cell: (row) =>
        row.kind !== "perm" ? null : grantSets
            .get(r.roleCode)
            ?.has(row.code) ? (
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
          empty={
            <EmptyState
              title={loadFailed ? t("loadFailed") : t("directory.empty")}
            />
          }
        />
      </PageSection>

      {/* ② 权限矩阵 */}
      <PageSection
        icon="key"
        level={2}
        title={t("matrix.title")}
        description={t("matrix.description")}
      >
        <DataTable<MatrixRow>
          columns={matrixColumns}
          rows={matrixRows}
          rowKey={(row) => row.key}
          loading={loading}
          empty={
            <EmptyState
              title={loadFailed ? t("loadFailed") : t("matrix.empty")}
            />
          }
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
