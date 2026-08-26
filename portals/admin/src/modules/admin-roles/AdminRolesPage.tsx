"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { CSSProperties } from "react";
import {
  ActionButton,
  ActionMenu,
  Badge,
  Button,
  Checkbox,
  DataTable,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogForm,
  DialogTitle,
  EmptyState,
  FilterBar,
  Icon,
  Input,
  Label,
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
  copyOperatorRole,
  createOperatorRole,
  deleteOperatorRole,
  fetchPlatformPermissions,
  fetchPlatformRoles,
  isStepUpRequiredError,
  replacePlatformRolePermissions,
  toggleOperatorRoleStatus,
  updateOperatorRole,
  type OperatorRoleCopyInput,
  type OperatorRoleCreateInput,
  type OperatorRoleUpdateInput,
} from "@/api/admin-bff";
import type {
  PlatformAdminPermissionRecord,
  PlatformPermissionType,
  PlatformRoleRecord,
} from "@/entities/console";
import { useLocale, useTranslations } from "next-intl";
import { PageHeader } from "@/modules/shared/PageHeader";
import { type PageSize } from "@/modules/shared/PageSizePicker";
import { formatDate, formatNumber } from "@/modules/tenants/tenant-utils";
import { useStepUp, isStepUpCancelled } from "@/providers/StepUpProvider";
import { useConfirmLabels } from "@/modules/shared/destructive";

/**
 * 权限类型 → 语气。照 `.vx-admin-role-pill--*` 实测的底色定：菜单品牌蓝、
 * 按钮青、接口琥珀。三者是**类目**不是严重度，用色只为在一棵树里一眼分开。
 */
const PERM_TYPE_TONE: Record<string, StatusBadgeTone> = {
  menu: "brand",
  button: "info",
  api: "warning",
};

type ViewMode = "list" | "cards";
type PlatformRoleStatusCode = PlatformRoleRecord["statusCode"];
type StatusFilter = "all" | PlatformRoleStatusCode;
type RoleKindFilter = "all" | "system" | "custom";
type PermissionFilter = "all" | PlatformPermissionType | "empty";
type RoleStatusTone = "normal" | "closed" | "attention";

const EMPTY_MARK = "-";

interface PermissionTreeNode {
  permission: PlatformAdminPermissionRecord;
  children: PermissionTreeNode[];
  depth: number;
}

function roleDisplayName(
  role: PlatformRoleRecord,
  t: ReturnType<typeof useTranslations>,
) {
  /* 键来自库里的伴生 `name_key` 列（data_platform §3.2.5，`check-i18n-keys` 在守
     它「必须存在」），但目录表里新加的角色可能还没进 messages——所以托底是
     真需要的，用库自己的 `name_en` 兜。`t.has()` 先问一句，缺了不抛。 */
  const fallback = role.nameEn || role.roleCode || EMPTY_MARK;
  return t.has(role.nameI18nKey) ? t(role.nameI18nKey) : fallback;
}

function roleDescription(
  role: PlatformRoleRecord,
  t: ReturnType<typeof useTranslations>,
) {
  if (!role.descriptionI18nKey) return role.description || "";
  return t.has(role.descriptionI18nKey)
    ? t(role.descriptionI18nKey)
    : role.description || "";
}

function roleStatusCode(role: PlatformRoleRecord): PlatformRoleStatusCode {
  const statusCode = role.statusCode;
  if (
    statusCode === "active" ||
    statusCode === "disabled" ||
    statusCode === "archived"
  ) {
    return statusCode;
  }
  return role.status ? "active" : "disabled";
}

function permissionDisplayName(value: string) {
  return value
    .replace(/^(BTN|API|MENU)_/, "")
    .split("_")
    .filter(Boolean)
    .map((part) => part.toLowerCase())
    .join(".");
}

function roleStatusIndicator(role: PlatformRoleRecord): {
  tone: RoleStatusTone;
  label: string;
  icon: IconName;
} {
  const statusCode = roleStatusCode(role);
  if (statusCode === "active")
    return { tone: "normal", label: "启用", icon: "check" };
  if (statusCode === "archived")
    return { tone: "attention", label: "归档", icon: "info" };
  return { tone: "closed", label: "停用", icon: "x" };
}

/** 角色态 → 语气。archived 借的是"关注"黄，不是灰：归档角色仍可能挂着人。 */
function roleStatusTone(role: PlatformRoleRecord): StatusBadgeTone {
  const statusCode = roleStatusCode(role);
  if (statusCode === "active") return "success";
  if (statusCode === "archived") return "warning";
  return "neutral";
}

function roleSearchText(role: PlatformRoleRecord) {
  return [
    role.id,
    role.roleCode,
    role.nameI18nKey,
    role.nameEn,
    role.descriptionI18nKey,
    role.description,
    role.isSystem ? "system 系统角色" : "custom 自定义角色",
    roleStatusCode(role),
    roleStatusIndicator(role).label,
    ...role.permissions.map(
      (permission) =>
        `${permission.permCode} ${permission.permName} ${permission.permType} ${permission.description}`,
    ),
  ]
    .join(" ")
    .toLowerCase();
}

function roleMatchesPermission(
  role: PlatformRoleRecord,
  filter: PermissionFilter,
) {
  if (filter === "all") return true;
  if (filter === "empty") return role.permissionCount === 0;
  return role.permissions.some((permission) => permission.permType === filter);
}

function permissionLabel(permission: PlatformAdminPermissionRecord) {
  return permission.permName || permissionDisplayName(permission.permCode);
}

function buildPermissionTree(permissions: PlatformAdminPermissionRecord[]) {
  const nodeById = new Map<string, PermissionTreeNode>();
  for (const permission of permissions) {
    nodeById.set(permission.id, { permission, children: [], depth: 0 });
  }

  const roots: PermissionTreeNode[] = [];
  for (const node of nodeById.values()) {
    const parent = node.permission.parentId
      ? nodeById.get(node.permission.parentId)
      : null;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortNodes = (nodes: PermissionTreeNode[], depth = 0) => {
    nodes.sort(
      (left, right) =>
        left.permission.sort - right.permission.sort ||
        left.permission.permCode.localeCompare(right.permission.permCode),
    );
    nodes.forEach((node) => {
      node.depth = depth;
      sortNodes(node.children, depth + 1);
    });
  };
  sortNodes(roots);
  return roots;
}

function collectDescendantPermissionIds(node: PermissionTreeNode) {
  const ids: string[] = [];
  const walk = (current: PermissionTreeNode) => {
    ids.push(current.permission.id);
    current.children.forEach(walk);
  };
  walk(node);
  return ids;
}

function collectAncestorPermissionIds(
  permission: PlatformAdminPermissionRecord,
  permissionById: Map<string, PlatformAdminPermissionRecord>,
) {
  const ids: string[] = [];
  let current: PlatformAdminPermissionRecord | undefined = permission;
  const visited = new Set<string>();

  while (current?.parentId && !visited.has(current.id)) {
    visited.add(current.id);
    const parent = permissionById.get(current.parentId);
    if (!parent) break;
    ids.push(parent.id);
    current = parent;
  }

  return ids;
}

function AdminRoleActionsMenu({
  role,
  roleLabel,
  onOpenPermissions,
  onOpenAuthorization,
  onEdit,
  onCopy,
  onToggle,
  onDelete,
}: {
  role: PlatformRoleRecord;
  roleLabel: string;
  onOpenPermissions: (role: PlatformRoleRecord) => void;
  onOpenAuthorization: (role: PlatformRoleRecord) => void;
  onEdit: (role: PlatformRoleRecord) => void;
  onCopy: (role: PlatformRoleRecord) => void;
  onToggle: (role: PlatformRoleRecord) => void;
  onDelete: (role: PlatformRoleRecord) => Promise<void>;
}) {
  const withLabels = useConfirmLabels();
  // 系统预置角色的编辑/停用/删除受后端保护（返回 403），前端一并置灰；
  // 复制系统角色以派生自定义角色仍然允许。
  const managed = !role.isSystem;
  return (
    <div
      className="relative z-[1] inline-flex justify-self-end"
      onClick={(event) => event.stopPropagation()}
    >
      <ActionMenu
        label={`${roleLabel} 操作`}
        items={[
          {
            id: "authorization",
            label: "角色授权",
            icon: "key",
            onSelect: () => onOpenAuthorization(role),
          },
          {
            id: "permissions",
            label: "权限详情",
            icon: "table",
            onSelect: () => onOpenPermissions(role),
          },
          {
            id: "edit",
            label: "编辑角色",
            icon: "edit",
            disabled: !managed,
            onSelect: () => onEdit(role),
          },
          {
            id: "copy",
            label: "复制角色",
            icon: "copy",
            onSelect: () => onCopy(role),
          },
          {
            id: "toggle",
            label: roleStatusCode(role) === "active" ? "停用角色" : "启用角色",
            icon: roleStatusCode(role) === "active" ? "x" : "check",
            disabled: !managed,
            onSelect: () => onToggle(role),
          },
          {
            id: "delete",
            label: "删除角色",
            icon: "trash",
            danger: true,
            disabled: !managed,
            confirm: withLabels({
              verb: "删除",
              target: `角色「${roleLabel}」`,
              /* 持有人数从 `adminCount` 来，不是措辞——「还有 3 名操作员持有」
                 比「请先确认没人在用」有用得多。后端不因有持有人而拒绝删除，
                 所以它是后果的一部分，不是 precondition（那一栏是闩，不是提醒）。 */
              consequence:
                (role.adminCount > 0
                  ? `当前有 ${role.adminCount} 名操作员持有该角色（其中 ${role.activeAdminCount} 名在用），删除后他们立刻失去它带来的全部权限。`
                  : "当前没有操作员持有该角色。") +
                "角色删除后不可恢复。这一步还要再过一次 step-up 二次验证。",
              /* 内置角色不可删，此前只体现在 `disabled` 上。 */
              preconditions: [
                { label: "这是可管理的自定义角色", met: managed },
              ],
              onConfirm: () => onDelete(role),
            }),
          },
        ]}
      />
    </div>
  );
}

function AdminRolePermissionDialog({
  role,
  roleLabel,
  onClose,
}: {
  role: PlatformRoleRecord;
  roleLabel: string;
  onClose: () => void;
}) {
  const permissionsByType = useMemo(() => {
    const groups: Record<
      PlatformPermissionType,
      PlatformRoleRecord["permissions"]
    > = {
      menu: [],
      button: [],
      api: [],
    };
    for (const permission of role.permissions) {
      groups[permission.permType]?.push(permission);
    }
    return groups;
  }, [role.permissions]);

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      {/* 抵消 DS DialogContent 的默认宽度，让 __panel 的宽度令牌决定面板尺寸。
          写方括号任意值而不是 `max-w-none`：DS 注册了 `--space-none: 0px`，而
          Tailwind v4 解 `max-w-<名>` 时先查 `--spacing-*`，那个关键字因此变成
          `max-width: 0`，面板被夹成 34px（实测 2026-08-27，本应 896px）。方括号
          不过主题查表，字面就是 CSS 关键字。同源的坑还有 `max-w-md`…`max-w-5xl`
          与 `leading-none`，记在 `portals/website/assets/legacy-tokens/tokens-website.css`。 */}
      <DialogContent className="max-w-[none] vx-admin-role-permission-dialog__panel">
        <header>
          <span
            className="vx-admin-role-permission-dialog__icon"
            aria-hidden="true"
          >
            <Icon name="role" size="lg" fallback="placeholder" />
          </span>
          <div>
            <DialogTitle>{roleLabel}</DialogTitle>
            <DialogDescription>{role.roleCode}</DialogDescription>
          </div>
        </header>
        <div className="vx-admin-role-permission-dialog__summary">
          <StatusBadge tone="brand" icon={false}>
            菜单 {formatNumber(role.menuPermissionCount)}
          </StatusBadge>
          <StatusBadge tone="info" icon={false}>
            按钮 {formatNumber(role.buttonPermissionCount)}
          </StatusBadge>
          <StatusBadge tone="warning" icon={false}>
            接口 {formatNumber(role.apiPermissionCount)}
          </StatusBadge>
        </div>
        <div className="vx-admin-role-permission-dialog__body">
          {(["menu", "button", "api"] as const).map((type) => (
            <section
              key={type}
              className="vx-admin-role-permission-dialog__group"
            >
              <h3>
                {type === "menu"
                  ? "菜单权限"
                  : type === "button"
                    ? "按钮权限"
                    : "接口权限"}
              </h3>
              {permissionsByType[type].length ? (
                <div className="vx-admin-role-permission-dialog__list">
                  {permissionsByType[type].map((permission) => (
                    <article key={permission.id}>
                      <strong>
                        {permissionDisplayName(
                          permission.permName || permission.permCode,
                        )}
                      </strong>
                      <code>{permission.permCode}</code>
                      {permission.description ? (
                        <small>{permission.description}</small>
                      ) : null}
                    </article>
                  ))}
                </div>
              ) : (
                <p className="vx-admin-role-permission-dialog__empty">-</p>
              )}
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PermissionAuthorizationNode({
  node,
  selectedIds,
  permissionById,
  onToggle,
}: {
  node: PermissionTreeNode;
  selectedIds: Set<string>;
  permissionById: Map<string, PlatformAdminPermissionRecord>;
  onToggle: (node: PermissionTreeNode, checked: boolean) => void;
}) {
  const tShared = useTranslations();
  const descendantIds = useMemo(
    () => collectDescendantPermissionIds(node),
    [node],
  );
  const selectedDescendantCount = descendantIds.filter((permissionId) =>
    selectedIds.has(permissionId),
  ).length;
  const checked = selectedIds.has(node.permission.id);
  const indeterminate =
    selectedDescendantCount > 0 &&
    selectedDescendantCount < descendantIds.length;
  const parent = node.permission.parentId
    ? permissionById.get(node.permission.parentId)
    : null;

  return (
    <article
      className="vx-admin-role-auth-node"
      // Dynamic tree depth drives the CSS indent (calc on --permission-depth);
      // a runtime numeric value cannot be expressed as a static className.
      style={{ "--permission-depth": node.depth } as CSSProperties}
    >
      <label>
        <Checkbox
          className="vx-model-select-checkbox"
          checked={indeterminate ? "indeterminate" : checked}
          disabled={!node.permission.status}
          onCheckedChange={(nextChecked) =>
            onToggle(node, nextChecked === true)
          }
        />
        <span className="vx-admin-role-auth-node__main">
          <strong>{permissionLabel(node.permission)}</strong>
          <span>
            <StatusBadge
              tone={
                PERM_TYPE_TONE[node.permission.permType.toLowerCase()] ??
                "neutral"
              }
              icon={false}
            >
              {node.permission.permType === "menu"
                ? "菜单"
                : node.permission.permType === "button"
                  ? "按钮"
                  : "接口"}
            </StatusBadge>
            <Badge>{node.depth === 0 ? "根权限" : `L${node.depth}`}</Badge>
            {!node.permission.status ? (
              <StatusBadge tone="neutral">
                {tShared("actions.disable")}
              </StatusBadge>
            ) : null}
          </span>
          <small>
            {parent
              ? parent.permName || parent.permCode
              : node.permission.permCode}
          </small>
        </span>
      </label>
      {node.children.length ? (
        <div className="vx-admin-role-auth-node__children">
          {node.children.map((child) => (
            <PermissionAuthorizationNode
              key={child.permission.id}
              node={child}
              selectedIds={selectedIds}
              permissionById={permissionById}
              onToggle={onToggle}
            />
          ))}
        </div>
      ) : null}
    </article>
  );
}

function AdminRoleAuthorizationDialog({
  role,
  roleLabel,
  permissions,
  saving,
  error,
  onClose,
  onSave,
}: {
  role: PlatformRoleRecord;
  roleLabel: string;
  permissions: PlatformAdminPermissionRecord[];
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (permissionIds: string[]) => void;
}) {
  const tShared = useTranslations();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(role.permissions.map((permission) => permission.id)),
  );
  const [query, setQuery] = useState("");
  const permissionById = useMemo(
    () => new Map(permissions.map((permission) => [permission.id, permission])),
    [permissions],
  );
  const permissionTree = useMemo(
    () => buildPermissionTree(permissions),
    [permissions],
  );
  const normalizedQuery = query.trim().toLowerCase();
  const visibleTree = useMemo(() => {
    if (!normalizedQuery) return permissionTree;

    const matches = (permission: PlatformAdminPermissionRecord) => {
      return [
        permission.permCode,
        permission.permName,
        permission.description,
        permission.routePath,
        permission.component,
        permission.permType,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    };

    const filterNode = (
      node: PermissionTreeNode,
    ): PermissionTreeNode | null => {
      const children = node.children
        .map(filterNode)
        .filter((child): child is PermissionTreeNode => Boolean(child));
      if (matches(node.permission) || children.length) {
        return { ...node, children };
      }
      return null;
    };

    return permissionTree
      .map(filterNode)
      .filter((node): node is PermissionTreeNode => Boolean(node));
  }, [normalizedQuery, permissionTree]);

  const selectedPermissions = permissions.filter((permission) =>
    selectedIds.has(permission.id),
  );
  const selectedMenuCount = selectedPermissions.filter(
    (permission) => permission.permType === "menu",
  ).length;
  const selectedButtonCount = selectedPermissions.filter(
    (permission) => permission.permType === "button",
  ).length;
  const selectedApiCount = selectedPermissions.filter(
    (permission) => permission.permType === "api",
  ).length;
  const changed =
    role.permissions.length !== selectedIds.size ||
    role.permissions.some((permission) => !selectedIds.has(permission.id));

  function toggleNode(node: PermissionTreeNode, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(node.permission.id);
        collectAncestorPermissionIds(node.permission, permissionById).forEach(
          (permissionId) => next.add(permissionId),
        );
      } else {
        collectDescendantPermissionIds(node).forEach((permissionId) =>
          next.delete(permissionId),
        );
      }
      return next;
    });
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        // Guard every close path (Esc, overlay click, close button) while saving.
        if (!next && !saving) onClose();
      }}
    >
      {/* 让 __auth-dialog__panel 的宽度令牌决定这块宽面板；共享的 __panel 类保留原视觉。
          写方括号任意值而不是 `max-w-none`：DS 注册了 `--space-none: 0px`，而
          Tailwind v4 解 `max-w-<名>` 时先查 `--spacing-*`，那个关键字因此变成
          `max-width: 0`，面板被夹成 34px（实测 2026-08-27，本应 896px）。方括号
          不过主题查表，字面就是 CSS 关键字。同源的坑还有 `max-w-md`…`max-w-5xl`
          与 `leading-none`，记在 `portals/website/assets/legacy-tokens/tokens-website.css`。 */}
      <DialogContent className="max-w-[none] vx-admin-role-permission-dialog__panel vx-admin-role-auth-dialog__panel">
        <header>
          <span
            className="vx-admin-role-permission-dialog__icon"
            aria-hidden="true"
          >
            <Icon name="key" size="lg" fallback="placeholder" />
          </span>
          <div>
            <DialogTitle>角色授权</DialogTitle>
            <DialogDescription>
              {roleLabel} / {role.roleCode}
            </DialogDescription>
          </div>
        </header>
        <div className="vx-admin-role-permission-dialog__summary">
          <StatusBadge tone="brand" icon={false}>
            菜单 {formatNumber(selectedMenuCount)}
          </StatusBadge>
          <StatusBadge tone="info" icon={false}>
            按钮 {formatNumber(selectedButtonCount)}
          </StatusBadge>
          <StatusBadge tone="warning" icon={false}>
            接口 {formatNumber(selectedApiCount)}
          </StatusBadge>
          <Badge>合计 {formatNumber(selectedIds.size)}</Badge>
        </div>
        <section
          className="vx-admin-role-auth-dialog__toolbar"
          aria-label="授权筛选"
        >
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索权限 code、名称、路径"
            aria-label="搜索权限"
          />
          <Button
            variant="outline"
            disabled={saving}
            onClick={() =>
              setSelectedIds(
                new Set(role.permissions.map((permission) => permission.id)),
              )
            }
          >
            还原
          </Button>
        </section>
        {error ? (
          <p className="vx-admin-role-auth-dialog__error">{error}</p>
        ) : null}
        <div
          className="vx-admin-role-auth-dialog__tree"
          role="tree"
          aria-label={`${roleLabel} 权限授权树`}
        >
          {visibleTree.length ? (
            visibleTree.map((node) => (
              <PermissionAuthorizationNode
                key={node.permission.id}
                node={node}
                selectedIds={selectedIds}
                permissionById={permissionById}
                onToggle={toggleNode}
              />
            ))
          ) : (
            <p className="vx-admin-role-permission-dialog__empty">
              没有匹配的权限
            </p>
          )}
        </div>
        <footer className="vx-admin-role-auth-dialog__footer">
          <Button variant="outline" disabled={saving} onClick={onClose}>
            {tShared("actions.cancel")}
          </Button>
          <ActionButton
            icon="check"
            disabled={saving || !changed}
            onClick={() => onSave([...selectedIds])}
          >
            {saving ? "保存中" : "保存授权"}
          </ActionButton>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

function PermissionTags({ role }: { role: PlatformRoleRecord }) {
  return (
    <span className="vx-admin-role-permission-tags">
      <StatusBadge tone="brand" icon={false}>
        菜单 {formatNumber(role.menuPermissionCount)}
      </StatusBadge>
      <StatusBadge tone="info" icon={false}>
        按钮 {formatNumber(role.buttonPermissionCount)}
      </StatusBadge>
      <StatusBadge tone="warning" icon={false}>
        接口 {formatNumber(role.apiPermissionCount)}
      </StatusBadge>
    </span>
  );
}

/**
 * 状态标走 `StatusBadge`，语气由 `roleStatusTone` 给。
 */
function useAdminRoleColumns(
  roleLabels: Map<string, string>,
  t: ReturnType<typeof useTranslations>,
): DataTableColumn<PlatformRoleRecord>[] {
  const locale = useLocale();
  const tShared = useTranslations();
  const labelOf = (role: PlatformRoleRecord) =>
    roleLabels.get(role.id) ?? role.nameEn ?? role.roleCode ?? EMPTY_MARK;

  return [
    {
      id: "role",
      header: "角色",
      cell: (role) => (
        <TableTitleCell
          {...(roleDescription(role, t)
            ? { tooltip: roleDescription(role, t) }
            : {})}
          icon="role"
          title={labelOf(role)}
          titleSuffix={role.isSystem ? <Badge>系统</Badge> : null}
          description={role.roleCode}
        />
      ),
    },
    {
      id: "status",
      header: tShared("columns.state"),
      align: "center",
      cell: (role) => {
        const indicator = roleStatusIndicator(role);
        return (
          <StatusBadge tone={roleStatusTone(role)} icon={indicator.icon}>
            {indicator.label}
          </StatusBadge>
        );
      },
    },
    {
      id: "admins",
      header: "成员",
      align: "center",
      cell: (role) => (
        <TableTitleCell
          title={`${formatNumber(role.activeAdminCount)} / ${formatNumber(role.adminCount)}`}
          description="启用 / 全部"
        />
      ),
    },
    {
      id: "permissions",
      header: "权限",
      cell: (role) => <PermissionTags role={role} />,
    },
    {
      id: "createdBy",
      header: "创建人",
      cell: (role) => (
        <TableTitleCell
          title={role.createdByName || EMPTY_MARK}
          description={formatDate(role.createdAt, locale)}
        />
      ),
    },
  ];
}

function AdminRoleCards({
  roles,
  roleLabels,
  t,
  onOpenPermissions,
  onOpenAuthorization,
  onEdit,
  onCopy,
  onToggle,
  onDelete,
}: {
  roles: PlatformRoleRecord[];
  roleLabels: Map<string, string>;
  t: ReturnType<typeof useTranslations>;
  onOpenPermissions: (role: PlatformRoleRecord) => void;
  onOpenAuthorization: (role: PlatformRoleRecord) => void;
  onEdit: (role: PlatformRoleRecord) => void;
  onCopy: (role: PlatformRoleRecord) => void;
  onToggle: (role: PlatformRoleRecord) => void;
  onDelete: (role: PlatformRoleRecord) => Promise<void>;
}) {
  const locale = useLocale();
  const tShared = useTranslations();
  return (
    <ListCardGrid aria-label="平台角色卡片">
      {roles.map((role) => (
        <MetricListCard
          key={role.id}
          icon="role"
          /* 角色说明原来挂在 header 与一段重复的 `<p>` 上当 `title` 提示；那段
             `<p>` 的正文其实就是 `roleCode`（与副标题同一件事），所以只留提示。 */
          title={
            <span title={roleDescription(role, t) || undefined}>
              {roleLabels.get(role.id) ??
                role.nameEn ??
                role.roleCode ??
                EMPTY_MARK}
            </span>
          }
          description={role.roleCode}
          tone={roleStatusTone(role)}
          actions={
            <AdminRoleActionsMenu
              role={role}
              roleLabel={
                roleLabels.get(role.id) ??
                role.nameEn ??
                role.roleCode ??
                EMPTY_MARK
              }
              onOpenPermissions={onOpenPermissions}
              onOpenAuthorization={onOpenAuthorization}
              onEdit={onEdit}
              onCopy={onCopy}
              onToggle={onToggle}
              onDelete={onDelete}
            />
          }
          badges={
            <>
              <StatusBadge tone={roleStatusTone(role)}>
                {roleStatusIndicator(role).label}
              </StatusBadge>
              {role.isSystem ? <Badge>系统</Badge> : null}
            </>
          }
          note={<PermissionTags role={role} />}
          metrics={[
            {
              key: "permissions",
              value: formatNumber(role.permissionCount),
              label: "权限",
            },
            {
              key: "members",
              value: formatNumber(role.adminCount),
              label: "成员",
            },
            {
              key: "createdAt",
              value: formatDate(role.createdAt, locale),
              label: tShared("actions.create"),
            },
          ]}
          footer={
            <>
              <span>权限 {formatNumber(role.permissionCount)} 项</span>
              <strong>{role.createdByName || EMPTY_MARK}</strong>
            </>
          }
        />
      ))}
    </ListCardGrid>
  );
}

type RoleMfaLevel = "disabled" | "optional" | "required";

interface RoleFormState {
  roleCode: string;
  nameEn: string;
  description: string;
  mfaMinLevel: "" | RoleMfaLevel;
  sort: string;
}

const EMPTY_ROLE_FORM: RoleFormState = {
  roleCode: "",
  nameEn: "",
  description: "",
  mfaMinLevel: "optional",
  sort: "",
};

function parseSort(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function AdminRoleFormDialog({
  mode,
  form,
  submitting,
  onChange,
  onClose,
  onSubmit,
}: {
  mode: "create" | "edit";
  form: RoleFormState;
  submitting: boolean;
  onChange: (patch: Partial<RoleFormState>) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const valid =
    mode === "create"
      ? form.roleCode.trim().length > 0 && form.nameEn.trim().length > 0
      : form.nameEn.trim().length > 0;

  return (
    <DialogForm
      open
      title={mode === "create" ? "新建角色" : "编辑角色"}
      description={
        mode === "create"
          ? "创建平台自定义角色，保存后可继续配置权限授权。"
          : "更新角色名称、描述与安全等级；角色编码不可修改。"
      }
      submitLabel={mode === "create" ? "创建角色" : "保存修改"}
      submitting={submitting}
      submitDisabled={!valid}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      onSubmit={onSubmit}
    >
      <div className="vx-model-dialog__grid">
        <Label>
          角色编码
          <Input
            value={form.roleCode}
            onChange={(event) => onChange({ roleCode: event.target.value })}
            placeholder="如 platform_ops"
            disabled={mode === "edit"}
            required={mode === "create"}
          />
        </Label>
        <Label>
          英文名称
          <Input
            value={form.nameEn}
            onChange={(event) => onChange({ nameEn: event.target.value })}
            placeholder="如 Platform Operations"
            required
          />
        </Label>
      </div>
      <div className="vx-model-dialog__grid">
        <Label>
          MFA 最低等级
          <NativeSelect
            value={form.mfaMinLevel}
            onChange={(event) =>
              onChange({
                mfaMinLevel: event.target.value as RoleFormState["mfaMinLevel"],
              })
            }
          >
            <option value="">保持默认</option>
            <option value="disabled">关闭</option>
            <option value="optional">可选</option>
            <option value="required">必需</option>
          </NativeSelect>
        </Label>
        <Label>
          排序
          <Input
            type="number"
            value={form.sort}
            onChange={(event) => onChange({ sort: event.target.value })}
            placeholder="排序值"
          />
        </Label>
      </div>
      <Label>
        描述
        <Textarea
          value={form.description}
          onChange={(event) => onChange({ description: event.target.value })}
          placeholder="角色用途说明"
          rows={3}
        />
      </Label>
    </DialogForm>
  );
}

function AdminRoleCopyDialog({
  source,
  form,
  submitting,
  onChange,
  onClose,
  onSubmit,
}: {
  source: PlatformRoleRecord;
  form: RoleFormState;
  submitting: boolean;
  onChange: (patch: Partial<RoleFormState>) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <DialogForm
      open
      title="复制角色"
      description={`基于「${source.nameEn || source.roleCode}」派生新的自定义角色，并沿用其权限集合。`}
      submitLabel="复制角色"
      submitting={submitting}
      submitDisabled={form.roleCode.trim().length === 0}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      onSubmit={onSubmit}
    >
      <Label>
        新角色编码
        <Input
          value={form.roleCode}
          onChange={(event) => onChange({ roleCode: event.target.value })}
          placeholder="如 platform_ops_copy"
          required
        />
      </Label>
      <Label>
        英文名称
        <Input
          value={form.nameEn}
          onChange={(event) => onChange({ nameEn: event.target.value })}
          placeholder="新角色英文名称"
        />
      </Label>
      <Label>
        描述
        <Textarea
          value={form.description}
          onChange={(event) => onChange({ description: event.target.value })}
          placeholder="角色用途说明"
          rows={3}
        />
      </Label>
    </DialogForm>
  );
}

export function AdminRolesPage() {
  const tShared = useTranslations();
  const t = useTranslations();
  const { toast } = useToast();
  const { runWithStepUp } = useStepUp();
  const [roles, setRoles] = useState<PlatformRoleRecord[]>([]);
  const [permissions, setPermissions] = useState<
    PlatformAdminPermissionRecord[]
  >([]);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [selectedRoleIds, setSelectedRoleIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [roleKindFilter, setRoleKindFilter] = useState<RoleKindFilter>("all");
  const [permissionFilter, setPermissionFilter] =
    useState<PermissionFilter>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(20);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [permissionDialogRoleId, setPermissionDialogRoleId] = useState<
    string | null
  >(null);
  const [authorizationRoleId, setAuthorizationRoleId] = useState<string | null>(
    null,
  );
  const [authorizationSaving, setAuthorizationSaving] = useState(false);
  const [authorizationError, setAuthorizationError] = useState<string | null>(
    null,
  );
  const [roleDialog, setRoleDialog] = useState<{
    mode: "create" | "edit";
    roleId: string | null;
  } | null>(null);
  const [copyRoleId, setCopyRoleId] = useState<string | null>(null);
  const [roleForm, setRoleForm] = useState<RoleFormState>(EMPTY_ROLE_FORM);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);

    Promise.all([fetchPlatformRoles(), fetchPlatformPermissions()])
      .then(([roleRecords, permissionRecords]) => {
        if (!active) return;
        setRoles(roleRecords);
        setPermissions(permissionRecords);
      })
      .catch((error) => {
        if (active)
          setLoadError(
            error instanceof Error
              ? error.message
              : "平台角色权限数据库读取失败",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const roleLabels = useMemo(() => {
    return new Map(roles.map((role) => [role.id, roleDisplayName(role, t)]));
  }, [roles, t]);

  const adminRoleColumns = useAdminRoleColumns(roleLabels, t);

  const filteredRoles = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return roles.filter((role) => {
      if (statusFilter !== "all" && roleStatusCode(role) !== statusFilter)
        return false;
      if (roleKindFilter === "system" && !role.isSystem) return false;
      if (roleKindFilter === "custom" && role.isSystem) return false;
      if (!roleMatchesPermission(role, permissionFilter)) return false;
      if (
        normalizedQuery &&
        !`${roleSearchText(role)} ${roleLabels.get(role.id) ?? ""}`
          .toLowerCase()
          .includes(normalizedQuery)
      )
        return false;
      return true;
    });
  }, [
    permissionFilter,
    query,
    roleKindFilter,
    roleLabels,
    roles,
    statusFilter,
  ]);

  const pageCount = Math.max(1, Math.ceil(filteredRoles.length / pageSize));
  const visibleRoles = filteredRoles.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  const permissionDialogRole = permissionDialogRoleId
    ? (roles.find((role) => role.id === permissionDialogRoleId) ?? null)
    : null;
  const authorizationRole = authorizationRoleId
    ? (roles.find((role) => role.id === authorizationRoleId) ?? null)
    : null;
  const enabledRoles = roles.filter(
    (role) => roleStatusCode(role) === "active",
  ).length;
  const systemRoles = roles.filter((role) => role.isSystem).length;
  const disabledRoles = roles.filter(
    (role) => roleStatusCode(role) === "disabled",
  ).length;
  const archivedRoles = roles.filter(
    (role) => roleStatusCode(role) === "archived",
  ).length;
  const otherRoleCount = disabledRoles + archivedRoles;

  useEffect(() => {
    setCurrentPage(1);
  }, [
    pageSize,
    permissionFilter,
    query,
    roleKindFilter,
    statusFilter,
    viewMode,
  ]);

  function handleReset() {
    setQuery("");
    setStatusFilter("all");
    setRoleKindFilter("all");
    setPermissionFilter("all");
  }

  async function saveRoleAuthorization(permissionIds: string[]) {
    if (!authorizationRole) return;

    setAuthorizationSaving(true);
    setAuthorizationError(null);
    try {
      const updatedRole = await runWithStepUp(() =>
        replacePlatformRolePermissions(authorizationRole.id, permissionIds),
      );
      setRoles((current) =>
        current.map((role) =>
          role.id === updatedRole.id ? updatedRole : role,
        ),
      );
      setAuthorizationRoleId(null);
    } catch (error) {
      // Operator dismissed the step-up prompt — leave the dialog as-is.
      if (isStepUpCancelled(error)) return;
      setAuthorizationError(
        error instanceof Error ? error.message : "角色授权保存失败",
      );
    } finally {
      setAuthorizationSaving(false);
    }
  }

  const copyRole = copyRoleId
    ? (roles.find((role) => role.id === copyRoleId) ?? null)
    : null;

  function reportError(fallbackTitle: string, error: unknown) {
    if (isStepUpCancelled(error)) return;
    if (isStepUpRequiredError(error)) {
      toast({
        tone: "warning",
        title: "需二次验证",
        description: "二次验证未完成或已过期，请重试该操作。",
      });
      return;
    }
    toast({
      tone: "danger",
      title: fallbackTitle,
      ...(error instanceof Error && error.message
        ? { description: error.message }
        : {}),
    });
  }

  function patchRoleForm(patch: Partial<RoleFormState>) {
    setRoleForm((current) => ({ ...current, ...patch }));
  }

  function openCreateRole() {
    setRoleForm(EMPTY_ROLE_FORM);
    setRoleDialog({ mode: "create", roleId: null });
  }

  function openEditRole(role: PlatformRoleRecord) {
    setRoleForm({
      roleCode: role.roleCode,
      nameEn: role.nameEn ?? "",
      description: role.description ?? "",
      // PlatformRoleRecord 未暴露 mfaMinLevel，编辑默认「保持默认」不覆盖后端值。
      mfaMinLevel: "",
      sort: String(role.sort ?? ""),
    });
    setRoleDialog({ mode: "edit", roleId: role.id });
  }

  function openCopyRole(role: PlatformRoleRecord) {
    setRoleForm({
      roleCode: `${role.roleCode}_copy`,
      nameEn: role.nameEn ?? "",
      description: role.description ?? "",
      mfaMinLevel: "",
      sort: "",
    });
    setCopyRoleId(role.id);
  }

  async function submitRoleForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!roleDialog) return;
    const nameEn = roleForm.nameEn.trim();
    const description = roleForm.description.trim();
    const sort = parseSort(roleForm.sort);
    const mfaMinLevel = roleForm.mfaMinLevel || undefined;

    setSubmitting(true);
    try {
      if (roleDialog.mode === "create") {
        const roleCode = roleForm.roleCode.trim();
        if (!roleCode || !nameEn) return;
        const payload: OperatorRoleCreateInput = {
          roleCode,
          nameEn,
          ...(description ? { description } : {}),
          ...(mfaMinLevel ? { mfaMinLevel } : {}),
          ...(sort !== undefined ? { sort } : {}),
        };
        const created = await runWithStepUp(() => createOperatorRole(payload));
        setRoles((current) => [created, ...current]);
        toast({ tone: "success", title: "角色已创建" });
      } else if (roleDialog.roleId) {
        if (!nameEn) return;
        const roleId = roleDialog.roleId;
        const payload: OperatorRoleUpdateInput = {
          nameEn,
          ...(description ? { description } : {}),
          ...(mfaMinLevel ? { mfaMinLevel } : {}),
          ...(sort !== undefined ? { sort } : {}),
        };
        const updated = await runWithStepUp(() =>
          updateOperatorRole(roleId, payload),
        );
        setRoles((current) =>
          current.map((role) => (role.id === updated.id ? updated : role)),
        );
        toast({ tone: "success", title: "角色已更新" });
      }
      setRoleDialog(null);
    } catch (error) {
      reportError("角色保存失败", error);
    } finally {
      setSubmitting(false);
    }
  }

  async function submitCopyRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!copyRole) return;
    const roleCode = roleForm.roleCode.trim();
    if (!roleCode) return;
    const nameEn = roleForm.nameEn.trim();
    const description = roleForm.description.trim();
    const payload: OperatorRoleCopyInput = {
      roleCode,
      ...(nameEn ? { nameEn } : {}),
      ...(description ? { description } : {}),
    };

    setSubmitting(true);
    try {
      const created = await runWithStepUp(() =>
        copyOperatorRole(copyRole.id, payload),
      );
      setRoles((current) => [created, ...current]);
      setCopyRoleId(null);
      toast({ tone: "success", title: "角色已复制" });
    } catch (error) {
      reportError("角色复制失败", error);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleRole(role: PlatformRoleRecord) {
    if (submitting) return;
    setSubmitting(true);
    try {
      const updated = await runWithStepUp(() =>
        toggleOperatorRoleStatus(role.id),
      );
      setRoles((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      toast({
        tone: "success",
        title:
          roleStatusCode(updated) === "active" ? "角色已启用" : "角色已停用",
      });
    } catch (error) {
      reportError("角色状态更新失败", error);
    } finally {
      setSubmitting(false);
    }
  }

  /* 收参数而不是读 `pendingDeleteRole`：确认在菜单项那一层完成，那一层知道自己
     作用在哪一个角色，不必再把它存成一份组件状态、也不必让删除的文案和落锤分居
     四百行。失败时重新抛出——DS 的确认件按 Promise 是否 rejected 决定关不关框，
     原来的 catch 只 `reportError` 不抛，会让失败看起来像成功。 */
  async function handleDeleteRole(target: PlatformRoleRecord) {
    setSubmitting(true);
    try {
      await runWithStepUp(() => deleteOperatorRole(target.id));
      setRoles((current) => current.filter((role) => role.id !== target.id));
      setSelectedRoleIds((current) => {
        const next = new Set(current);
        next.delete(target.id);
        return next;
      });
      toast({ tone: "success", title: "角色已删除" });
    } catch (error) {
      reportError("角色删除失败", error);
      throw error;
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <ListPageTemplate
        className="vx-tenant-management-page vx-admin-roles-page"
        header={
          <PageHeader
            icon="role"
            title="平台角色"
            description="管理平台用户角色、权限集合和授权覆盖；不参与租户成员角色流转。"
          />
        }
        summary={
          <>
            {" "}
            <MetricGrid
              loading={loading}
              aria-label="平台角色统计"
              columns={3}
              items={[
                {
                  id: "total",
                  help: "角色总数，含停用与归档的。",
                  icon: "role",
                  label: "角色总数",
                  value: formatNumber(roles.length),
                  tags: [`系统预置 ${formatNumber(systemRoles)}`],
                },
                {
                  id: "enabled",
                  help: "状态为启用、可被授予的角色。",
                  icon: "check",
                  label: "启用角色",
                  value: formatNumber(enabledRoles),
                  tags: ["可授权"],
                  tone: "success",
                },
                {
                  id: "other",
                  help: "停用与归档角色之和。",
                  icon: "x",
                  label: "其他角色",
                  value: formatNumber(otherRoleCount),
                  tags: [
                    ...(disabledRoles
                      ? [`停用 ${formatNumber(disabledRoles)}`]
                      : []),
                    ...(archivedRoles
                      ? [`归档 ${formatNumber(archivedRoles)}`]
                      : []),
                  ],
                  tone: "danger",
                },
              ]}
            />
          </>
        }
        filters={
          <FilterBar
            view={viewMode}
            onViewChange={setViewMode}
            cardsDisabledReason={tShared("common.cardsRetired")}
            count={formatNumber(filteredRoles.length)}
            aria-label="平台角色筛选"
            search={
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索角色、权限、描述"
                className="grow basis-media-3xl max-w-panel-sm"
                aria-label="搜索平台角色"
              />
            }
            onReset={handleReset}
            actions={
              <>
                <ActionButton
                  variant="outline"
                  icon="plus"
                  onClick={openCreateRole}
                >
                  新建角色
                </ActionButton>
              </>
            }
          >
            <>
              <NativeSelect
                className="w-fit basis-media-xl"
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value as StatusFilter)
                }
                aria-label="角色状态"
              >
                <option value="all">{tShared("filters.allStates")}</option>
                <option value="active">{tShared("actions.enable")}</option>
                <option value="disabled">{tShared("actions.disable")}</option>
                <option value="archived">{tShared("actions.archive")}</option>
              </NativeSelect>
              <NativeSelect
                className="w-fit basis-media-xl"
                value={roleKindFilter}
                onChange={(event) =>
                  setRoleKindFilter(event.target.value as RoleKindFilter)
                }
                aria-label="角色类型"
              >
                <option value="all">{tShared("filters.allKinds")}</option>
                <option value="system">系统角色</option>
                <option value="custom">自定义角色</option>
              </NativeSelect>
              <NativeSelect
                className="w-fit basis-media-xl"
                value={permissionFilter}
                onChange={(event) =>
                  setPermissionFilter(event.target.value as PermissionFilter)
                }
                aria-label="权限类型"
              >
                <option value="all">全部权限</option>
                <option value="menu">菜单</option>
                <option value="button">按钮</option>
                <option value="api">接口</option>
                <option value="empty">未授权</option>
              </NativeSelect>
            </>
          </FilterBar>
        }
        table={
          <section
            className="grid min-w-0 max-w-full gap-xs"
            aria-label="平台角色清单"
          >
            {/* 列表态的加载由 DataTable 出骨架行，卡片态没有骨架，仍留这行提示。 */}
            {loading && viewMode === "cards" ? (
              <header className="flex min-h-0 items-center justify-end gap-sm text-body-sm font-normal text-muted-foreground">
                <span>{tShared("common.loading")}</span>
              </header>
            ) : null}

            {viewMode === "list" ? (
              <DataTable
                columns={adminRoleColumns}
                rows={visibleRoles}
                rowKey={(role) => role.id}
                loading={loading}
                indexStart={
                  (Math.min(currentPage, pageCount) - 1) * pageSize + 1
                }
                selectedKeys={[...selectedRoleIds]}
                onSelectionChange={(keys) => setSelectedRoleIds(new Set(keys))}
                rowActions={(role) => (
                  <AdminRoleActionsMenu
                    role={role}
                    roleLabel={
                      roleLabels.get(role.id) ??
                      role.nameEn ??
                      role.roleCode ??
                      EMPTY_MARK
                    }
                    onOpenPermissions={(target) =>
                      setPermissionDialogRoleId(target.id)
                    }
                    onOpenAuthorization={(target) => {
                      setAuthorizationError(null);
                      setAuthorizationRoleId(target.id);
                    }}
                    onEdit={openEditRole}
                    onCopy={openCopyRole}
                    onToggle={(target) => void handleToggleRole(target)}
                    onDelete={handleDeleteRole}
                  />
                )}
                empty={
                  <EmptyState
                    title={
                      loadError ? "平台角色读取失败" : "没有匹配的平台角色"
                    }
                    description={
                      loadError ?? "清空筛选条件后可查看全部平台角色。"
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
                }
              />
            ) : visibleRoles.length ? (
              <AdminRoleCards
                roles={visibleRoles}
                roleLabels={roleLabels}
                t={t}
                onOpenPermissions={(role) => setPermissionDialogRoleId(role.id)}
                onOpenAuthorization={(role) => {
                  setAuthorizationError(null);
                  setAuthorizationRoleId(role.id);
                }}
                onEdit={openEditRole}
                onCopy={openCopyRole}
                onToggle={(role) => void handleToggleRole(role)}
                onDelete={handleDeleteRole}
              />
            ) : (
              <EmptyState
                title={loading ? "正在加载平台角色" : "没有匹配的平台角色"}
                description={
                  loading
                    ? "正在从 platform.platform_role 读取平台角色。"
                    : (loadError ?? "清空筛选条件后可查看全部平台角色。")
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
            total={filteredRoles.length}
            pageSize={pageSize}
            onPageSizeChange={setPageSize}
            onPageChange={(page) =>
              setCurrentPage(Math.min(Math.max(page, 1), pageCount))
            }
          />
        }
      />
      {permissionDialogRole ? (
        <AdminRolePermissionDialog
          role={permissionDialogRole}
          roleLabel={
            roleLabels.get(permissionDialogRole.id) ??
            permissionDialogRole.nameEn ??
            permissionDialogRole.roleCode ??
            EMPTY_MARK
          }
          onClose={() => setPermissionDialogRoleId(null)}
        />
      ) : null}
      {authorizationRole ? (
        <AdminRoleAuthorizationDialog
          role={authorizationRole}
          roleLabel={
            roleLabels.get(authorizationRole.id) ??
            authorizationRole.nameEn ??
            authorizationRole.roleCode ??
            EMPTY_MARK
          }
          permissions={permissions}
          saving={authorizationSaving}
          error={authorizationError}
          onClose={() => {
            if (!authorizationSaving) setAuthorizationRoleId(null);
          }}
          onSave={saveRoleAuthorization}
        />
      ) : null}
      {roleDialog ? (
        <AdminRoleFormDialog
          mode={roleDialog.mode}
          form={roleForm}
          submitting={submitting}
          onChange={patchRoleForm}
          onClose={() => {
            if (!submitting) setRoleDialog(null);
          }}
          onSubmit={(event) => void submitRoleForm(event)}
        />
      ) : null}
      {copyRole ? (
        <AdminRoleCopyDialog
          source={copyRole}
          form={roleForm}
          submitting={submitting}
          onChange={patchRoleForm}
          onClose={() => {
            if (!submitting) setCopyRoleId(null);
          }}
          onSubmit={(event) => void submitCopyRole(event)}
        />
      ) : null}
    </>
  );
}
