"use client";

/**
 * RolesPage.tsx — 角色管理(P0 分权,2026-08-21 去 Planned 重建;2026-09-04 批 0a
 * 权限配置体系;2026-09-06 批 9 成为成员管理的二级页,与权限管理拆开)。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * 路由 `/members/roles`(旧地址 `/roles` 只剩跳转)。owner 2026-09-06:角色是平台
 * 整体定义、当前不支持租户自定义,所以它是成员管理底下的一张只读目录——**只提供
 * 查看**;同日再裁:角色管理与权限管理拆成两个二级页。
 *
 * 本页只答一个问题:**有哪些角色、各是什么定位、带多少权限点**。具体是哪些码、
 * 哪个角色有,在权限管理页(`/members/permissions`)的矩阵里逐行看;单个角色的
 * 明细在行操作的「权限详情」里。
 *
 * **呈现照治理平面既有的那两页**(owner 2026-09-06「全面参考」,
 * `portals/arche/src/modules/admin-roles/AdminRolesPage.tsx`):指标排带 help 与 tags、
 * 主辅信息一律走 DS `TableTitleCell`、系统标贴在标题后而不是单开一列、明细走对话框。
 * 不搬的是写侧那一整套(新建 / 复制 / 停用 / 删除 / 授权树 + step-up)——租户不能改
 * 平台角色,DB 层就不成立(roles 无 tenant_id)。
 *
 * 权限点的中文名读 `permissionsPage.perm.*`(权限名的权威在权限页);角色的图标、
 * 显示名与固定序走 `components/role-tag`。角色说明(roleBlurb)只有本页用,留在本页词条。
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useTableLabels } from "@/lib/table";
import {
  ActionMenu,
  Badge,
  Button,
  DataTable,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  EmptyState,
  Icon,
  MetricGrid,
  StatusBadge,
  TableTitleCell,
  ViewHeader,
  ViewLayout,
} from "@vxture/design-system";
import type { DataTableColumn, MetricGridItem } from "@vxture/design-system";
import { TENANT_PERMISSION_CODES } from "@vxture/core-utils";
import { fetchTenantRoles } from "@/api/console-bff";
import type { TenantRoleRecord } from "@/entities/console";
import { roleIcon, roleRank, useRoleLabel } from "@/components/role-tag";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import { useRouter } from "@/lib/i18n/navigation";
import { PageSection, SectionBody, SignalList } from "@/layout/shell";

/** 目录里的操作码(权威在 core-utils);角色码序与图标、显示名都归 components/role-tag。 */
const KNOWN_PERMS = new Set<string>(TENANT_PERMISSION_CODES);

/** 单个角色的权限明细。只读:租户改不了平台角色,这里没有勾选框。 */
function RolePermissionDialog({
  role,
  roleLabel,
  permLabel,
  onClose,
}: {
  role: TenantRoleRecord;
  roleLabel: string;
  permLabel: (code: string) => string;
  onClose: () => void;
}) {
  const t = useTranslations("rolesPage");
  const sorted = useMemo(
    () =>
      [...role.permissions].sort(
        (a, b) =>
          a.sort - b.sort || a.permissionCode.localeCompare(b.permissionCode),
      ),
    [role.permissions],
  );

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        width="xl"
        className="grid max-h-screen grid-rows-[auto_auto_minmax(0,1fr)] gap-md"
      >
        <header className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-md">
          <span
            className="inline-grid size-icon-2xl place-items-center rounded-full bg-primary-muted text-primary-text"
            aria-hidden="true"
          >
            <Icon
              name={roleIcon(role.roleCode)}
              size="lg"
              fallback="placeholder"
            />
          </span>
          <div>
            <DialogTitle>{roleLabel}</DialogTitle>
            <DialogDescription>{role.roleCode}</DialogDescription>
          </div>
        </header>
        <div className="flex flex-wrap items-center gap-xs">
          <StatusBadge tone="brand" icon={false}>
            {t("permDialog.countLabel", { count: sorted.length })}
          </StatusBadge>
        </div>
        <div className="grid min-h-0 gap-sm overflow-auto pr-2xs sm:grid-cols-2">
          {sorted.length ? (
            sorted.map((permission) => (
              <article
                key={permission.id}
                className="grid min-w-0 gap-2xs rounded-lg border border-primary/10 p-sm"
              >
                <strong className="truncate text-body-sm font-semibold text-foreground">
                  {permLabel(permission.permissionCode)}
                </strong>
                <code className="truncate font-mono text-body-sm text-muted-foreground">
                  {permission.permissionCode}
                </code>
              </article>
            ))
          ) : (
            <p className="m-0 text-body-sm text-muted-foreground">
              {t("permDialog.empty")}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function RolesPage() {
  const t = useTranslations("rolesPage");
  // 权限点的名字归权限管理页那份词条(见文件头)
  const tPerm = useTranslations("permissionsPage.perm");
  const tableLabels = useTableLabels();
  const router = useRouter();
  const { session } = useConsoleSession();

  const [roles, setRoles] = useState<TenantRoleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [detailRoleCode, setDetailRoleCode] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadFailed(false);
    fetchTenantRoles()
      .then((roleRows) => {
        if (active) setRoles(roleRows);
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

  const roleLabel = useRoleLabel();
  const roleBlurb = (code: string): string | null =>
    t.has(`roleBlurb.${code}`) ? t(`roleBlurb.${code}`) : null;
  /** 目录里没有的码回退成码本身:一个没见过的权限点不该让整页崩掉。 */
  const permLabel = (code: string): string =>
    KNOWN_PERMS.has(code) ? tPerm(code.replace(/\./g, "_")) : code;

  // 目录按固定序展示(owner→guest),未知码排尾;判据与权限页共用一份
  const orderedRoles = useMemo(
    () =>
      [...roles].sort((a, b) => roleRank(a.roleCode) - roleRank(b.roleCode)),
    [roles],
  );

  const systemRoles = roles.filter((r) => r.isSystem).length;
  /* owner 只能经「转让所有权」产生,不出现在成员管理的角色下拉里——「可指派」数
     必须把它减掉,否则这个数与用户在下拉里数到的对不上。 */
  const assignableRoles = roles.filter((r) => r.roleCode !== "owner").length;

  const metrics = useMemo<MetricGridItem[]>(
    () => [
      {
        id: "roles",
        icon: "shield-check",
        label: t("metrics.roles"),
        value: String(roles.length),
        help: t("metrics.rolesHelp"),
        tags: [t("metrics.rolesSystemTag", { count: systemRoles })],
      },
      {
        id: "assignable",
        icon: "user-switch",
        label: t("metrics.assignable"),
        value: String(assignableRoles),
        help: t("metrics.assignableHelp"),
        tags: [t("metrics.assignableTag")],
      },
      {
        id: "model",
        icon: "lock",
        label: t("metrics.model"),
        value: t("metrics.modelValue"),
        help: t("metrics.modelHelp"),
        tags: [t("metrics.modelHint")],
      },
    ],
    [roles.length, systemRoles, assignableRoles, t],
  );

  const roleColumns: DataTableColumn<TenantRoleRecord>[] = [
    {
      id: "role",
      header: t("directory.colRole"),
      cell: (r) => (
        <TableTitleCell
          icon={roleIcon(r.roleCode)}
          title={roleLabel(r.roleCode, r.roleName)}
          titleSuffix={
            r.isSystem ? (
              <Badge>{t("directory.system")}</Badge>
            ) : (
              <Badge variant="outline">{t("directory.custom")}</Badge>
            )
          }
          description={r.roleCode}
          {...(roleBlurb(r.roleCode)
            ? { tooltip: roleBlurb(r.roleCode) as string }
            : {})}
        />
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
      align: "center",
      cell: (r) => (
        <StatusBadge
          tone={r.permissions.length ? "brand" : "neutral"}
          icon={false}
        >
          {t("directory.permCount", { count: r.permissions.length })}
        </StatusBadge>
      ),
    },
  ];

  const detailRole =
    orderedRoles.find((r) => r.roleCode === detailRoleCode) ?? null;

  return (
    <ViewLayout>
      <ViewHeader
        icon="shield-check"
        title={t("title")}
        description={t("description")}
        action={
          <>
            <Button
              variant="outline"
              size="md"
              onClick={() => router.push("/members/permissions")}
            >
              <Icon name="key" size="xs" fallback="placeholder" />
              <span>{t("viewPermissions")}</span>
            </Button>
            <Button
              variant="outline"
              size="md"
              onClick={() => router.push("/members")}
            >
              <Icon name="arrow-left" size="xs" fallback="placeholder" />
              <span>{t("backToMembers")}</span>
            </Button>
          </>
        }
      />

      <MetricGrid
        items={metrics}
        columns={3}
        loading={loading}
        aria-label={t("metrics.groupLabel")}
      />

      <PageSection
        icon="shield-check"
        level={2}
        title={t("directory.title")}
        description={t("directory.description")}
      >
        <DataTable<TenantRoleRecord>
          labels={tableLabels}
          columns={roleColumns}
          rows={orderedRoles}
          rowKey={(r) => r.roleCode}
          loading={loading}
          indexStart={1}
          rowActions={(r) => (
            <ActionMenu
              label={t("directory.menuLabel", {
                name: roleLabel(r.roleCode, r.roleName),
              })}
              items={[
                {
                  id: "permissions",
                  label: t("directory.viewPerms"),
                  icon: "table",
                  onSelect: () => setDetailRoleCode(r.roleCode),
                },
              ]}
            />
          )}
          empty={
            <EmptyState
              title={loadFailed ? t("loadFailed") : t("directory.empty")}
            />
          }
        />
      </PageSection>

      <PageSection
        icon="info"
        level={2}
        title={t("notes.title")}
        description={t("notes.description")}
      >
        <SectionBody>
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
                title: t("notes.permTitle"),
                description: t("notes.permBody"),
              },
            ]}
          />
        </SectionBody>
      </PageSection>

      {detailRole ? (
        <RolePermissionDialog
          role={detailRole}
          roleLabel={roleLabel(detailRole.roleCode, detailRole.roleName)}
          permLabel={permLabel}
          onClose={() => setDetailRoleCode(null)}
        />
      ) : null}
    </ViewLayout>
  );
}
