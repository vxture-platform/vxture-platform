"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { CSSProperties } from "react";
import {
  ActionButton,
  ActionMenu,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogForm,
  DialogTitle,
  EmptyState,
  Icon,
  Input,
  Label,
  MetricGrid,
  NativeSelect,
  SectionHeader,
  StatusBadge,
  Textarea,
  useToast,
  ViewLayout,
  ViewModeSwitch,
} from "@vxture/design-system";
import type { IconName, ViewModeSwitchValue } from "@vxture/design-system";
import {
  createOperatorPermission,
  fetchPlatformPermissions,
  isStepUpRequiredError,
  toggleOperatorPermission,
  updateOperatorPermission,
} from "@/api/admin-bff";
import type {
  PlatformAdminPermissionRecord,
  PlatformPermissionType,
} from "@/entities/console";
import { PageHeader } from "@/modules/shared/PageHeader";
import { formatNumber, joinClasses } from "@/modules/tenants/tenant-utils";
import { useStepUp, isStepUpCancelled } from "@/providers/StepUpProvider";

type PermissionFilter = "all" | PlatformPermissionType;
type StatusFilter = "all" | "active" | "disabled";
type SourceFilter = "all" | "system" | "custom";
type PermissionDomainKey = "tenant-ops" | "platform-autonomy" | "foundation";

const EMPTY_MARK = "-";
const TENANT_OPS_WORKSPACE_CODE = "admin.workspace.tenant_ops";
const PLATFORM_AUTONOMY_WORKSPACE_CODE = "admin.workspace.platform";
const DEFAULT_DOMAIN_FILTERS: DomainFilterState = {
  query: "",
  typeFilter: "all",
  statusFilter: "all",
  sourceFilter: "all",
};

const permissionTypeMeta = {
  menu: {
    label: "菜单",
    icon: "table",
    className: "vx-admin-permission-type--menu",
  },
  button: {
    label: "按钮",
    icon: "check",
    className: "vx-admin-permission-type--button",
  },
  api: {
    label: "接口",
    icon: "api",
    className: "vx-admin-permission-type--api",
  },
} as const;

/** 查不到就退回中性档：一个没见过的类型不该让整棵权限树崩掉。 */
const UNKNOWN_PERMISSION_TYPE = {
  label: "未知类型",
  icon: "info",
  className: "",
} as const;

function permissionTypeMetaOf(type: string) {
  return (
    permissionTypeMeta[type as keyof typeof permissionTypeMeta] ??
    UNKNOWN_PERMISSION_TYPE
  );
}

function permissionStatusIndicator(permission: PlatformAdminPermissionRecord): {
  label: string;
  icon: IconName;
} {
  return permission.status
    ? { label: "启用", icon: "check" }
    : { label: "停用", icon: "x" };
}

function permissionLayerPillClass(depth: number) {
  if (depth <= 0) return "vx-admin-permission-layer-pill--root";
  if (depth === 1) return "vx-admin-permission-layer-pill--l1";
  if (depth === 2) return "vx-admin-permission-layer-pill--l2";
  return "vx-admin-permission-layer-pill--l3";
}

interface PermissionTreeNode {
  permission: PlatformAdminPermissionRecord;
  children: PermissionTreeNode[];
  depth: number;
  sequence: string;
}

interface PermissionDomainGroup {
  key: PermissionDomainKey;
  title: string;
  description: string;
  icon: IconName;
  nodes: PermissionTreeNode[];
  matchedCount: number;
  totalCount: number;
  activeCount: number;
  assignedCount: number;
  disabledCount: number;
  unassignedCount: number;
  levelCounts: {
    l1: number;
    l2: number;
    l3: number;
  };
}

interface DomainFilterState {
  query: string;
  typeFilter: PermissionFilter;
  statusFilter: StatusFilter;
  sourceFilter: SourceFilter;
}

function permissionDisplayName(permission: PlatformAdminPermissionRecord) {
  return permission.permName
    .replace(/^(BTN|API|MENU)_/, "")
    .split("_")
    .filter(Boolean)
    .map((part) => part.toLowerCase())
    .join(".");
}

function permissionSearchText(permission: PlatformAdminPermissionRecord) {
  return [
    permission.id,
    permission.parentId,
    permission.permCode,
    permission.permName,
    permission.permType,
    permission.description,
    permission.routePath,
    permission.component,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

// operator_permission 没有 is_system 列（B9-P1a），无法直接判定来源。平台预置权限
// 一律落在保留命名空间内：`admin.*` 的工作区/分组树，以及历史 `MENU_/BTN_/API_`
// 基础权限编码。落在这些命名空间之外的 permCode 只可能由 createOperatorPermission
// 新建，因此归类为自定义（custom）。
function permissionSource(
  permission: PlatformAdminPermissionRecord,
): "system" | "custom" {
  return /^(admin\.|MENU_|BTN_|API_)/.test(permission.permCode)
    ? "system"
    : "custom";
}

function permissionSourceLabel(permission: PlatformAdminPermissionRecord) {
  return permissionSource(permission) === "system" ? "系统预置" : "自定义";
}

function permissionMatchesFilters(
  permission: PlatformAdminPermissionRecord,
  filters: DomainFilterState,
) {
  const normalizedQuery = filters.query.trim().toLowerCase();
  if (
    filters.typeFilter !== "all" &&
    permission.permType !== filters.typeFilter
  )
    return false;
  if (filters.statusFilter === "active" && !permission.status) return false;
  if (filters.statusFilter === "disabled" && permission.status) return false;
  if (
    filters.sourceFilter !== "all" &&
    permissionSource(permission) !== filters.sourceFilter
  )
    return false;
  if (
    normalizedQuery &&
    !permissionSearchText(permission).includes(normalizedQuery)
  )
    return false;
  return true;
}

function permissionDepth(
  permission: PlatformAdminPermissionRecord,
  permissionById: Map<string, PlatformAdminPermissionRecord>,
) {
  let depth = 0;
  let current: PlatformAdminPermissionRecord | undefined = permission;
  const visited = new Set<string>();

  while (current?.parentId && !visited.has(current.id)) {
    visited.add(current.id);
    const parent = permissionById.get(current.parentId);
    if (!parent) break;
    depth += 1;
    current = parent;
  }

  return depth;
}

function buildPermissionTree(
  permissions: PlatformAdminPermissionRecord[],
): PermissionTreeNode[] {
  const byId = new Map<string, PermissionTreeNode>();
  for (const permission of permissions) {
    byId.set(permission.id, {
      permission,
      children: [],
      depth: 0,
      sequence: "",
    });
  }

  const roots: PermissionTreeNode[] = [];
  for (const node of byId.values()) {
    const parent = node.permission.parentId
      ? byId.get(node.permission.parentId)
      : null;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortNodes = (nodes: PermissionTreeNode[], depth: number) => {
    nodes.sort(
      (a, b) =>
        a.permission.sort - b.permission.sort ||
        a.permission.permCode.localeCompare(b.permission.permCode),
    );
    for (const node of nodes) {
      node.depth = depth;
      sortNodes(node.children, depth + 1);
    }
  };
  sortNodes(roots, 0);
  return roots;
}

function assignPermissionSequence(
  nodes: PermissionTreeNode[],
  parentParts: string[] = [],
) {
  return nodes.map((node, index) => {
    const sequenceParts = [...parentParts, String(index + 1).padStart(2, "0")];
    node.sequence = sequenceParts.join(".");
    assignPermissionSequence(node.children, sequenceParts);
    return node;
  });
}

function buildPermissionSequenceMap(
  permissions: PlatformAdminPermissionRecord[],
) {
  const sequenceMap = new Map<string, string>();
  const stableTree = assignPermissionSequence(
    stripWorkspaceRoot(buildPermissionTree(permissions)),
  );

  const walk = (node: PermissionTreeNode) => {
    sequenceMap.set(node.permission.id, node.sequence);
    node.children.forEach(walk);
  };
  stableTree.forEach(walk);

  return sequenceMap;
}

function applyPermissionSequence(
  nodes: PermissionTreeNode[],
  sequenceMap: Map<string, string>,
) {
  return nodes.map((node) => {
    node.sequence = sequenceMap.get(node.permission.id) ?? "";
    applyPermissionSequence(node.children, sequenceMap);
    return node;
  });
}

function collectPermissionIds(nodes: PermissionTreeNode[]) {
  const ids: string[] = [];
  const walk = (node: PermissionTreeNode) => {
    ids.push(node.permission.id);
    node.children.forEach(walk);
  };
  nodes.forEach(walk);
  return ids;
}

function flattenTreeNodes(nodes: PermissionTreeNode[]) {
  const flattened: PermissionTreeNode[] = [];
  const walk = (node: PermissionTreeNode) => {
    flattened.push(node);
    node.children.forEach(walk);
  };
  nodes.forEach(walk);
  return flattened;
}

function isSectionPermission(permission: PlatformAdminPermissionRecord) {
  return permission.permCode.startsWith("admin.section.");
}

function resolvePermissionDomain(
  permission: PlatformAdminPermissionRecord,
  permissionById: Map<string, PlatformAdminPermissionRecord>,
): PermissionDomainKey {
  let current: PlatformAdminPermissionRecord | undefined = permission;
  const visited = new Set<string>();

  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    if (current.permCode === TENANT_OPS_WORKSPACE_CODE) return "tenant-ops";
    if (current.permCode === PLATFORM_AUTONOMY_WORKSPACE_CODE)
      return "platform-autonomy";
    current = current.parentId
      ? permissionById.get(current.parentId)
      : undefined;
  }

  return "foundation";
}

function includeAncestorContext(
  permissions: PlatformAdminPermissionRecord[],
  permissionById: Map<string, PlatformAdminPermissionRecord>,
) {
  const contextualPermissions = new Map<
    string,
    PlatformAdminPermissionRecord
  >();

  for (const permission of permissions) {
    let current: PlatformAdminPermissionRecord | undefined = permission;
    const visited = new Set<string>();

    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      contextualPermissions.set(current.id, current);
      current = current.parentId
        ? permissionById.get(current.parentId)
        : undefined;
    }
  }

  return [...contextualPermissions.values()];
}

function stripWorkspaceRoot(nodes: PermissionTreeNode[]) {
  if (nodes.length !== 1) return nodes;

  const root = nodes[0];
  if (!root) return nodes;

  if (
    (root.permission.permCode === TENANT_OPS_WORKSPACE_CODE ||
      root.permission.permCode === PLATFORM_AUTONOMY_WORKSPACE_CODE) &&
    root.children.length
  ) {
    return root.children;
  }

  return nodes;
}

function buildPermissionDomainGroups(
  permissions: PlatformAdminPermissionRecord[],
  permissionById: Map<string, PlatformAdminPermissionRecord>,
  filtersByDomain: Record<PermissionDomainKey, DomainFilterState>,
): PermissionDomainGroup[] {
  const groupedPermissions: Record<
    PermissionDomainKey,
    PlatformAdminPermissionRecord[]
  > = {
    "tenant-ops": [],
    "platform-autonomy": [],
    foundation: [],
  };

  for (const permission of permissions) {
    groupedPermissions[
      resolvePermissionDomain(permission, permissionById)
    ].push(permission);
  }

  const groups: Array<{
    key: PermissionDomainKey;
    title: string;
    description: string;
    icon: IconName;
    permissions: PlatformAdminPermissionRecord[];
  }> = [
    {
      key: "tenant-ops",
      title: "运营管理域权限",
      description:
        "面向租户、账号、产品、订阅、交易、财务和客户服务的运营后台权限。",
      icon: "buildings",
      permissions: groupedPermissions["tenant-ops"],
    },
    {
      key: "platform-autonomy",
      title: "平台自治域权限",
      description:
        "面向平台内部身份、角色权限、平台资源、运行可靠性、安全审计和审批治理的权限。",
      icon: "shield-check",
      permissions: groupedPermissions["platform-autonomy"],
    },
    {
      key: "foundation",
      title: "基础系统权限",
      description:
        "历史系统、基础认证和兼容菜单权限，保留独立分组以免与运营域、自治域混淆。",
      icon: "key",
      permissions: groupedPermissions.foundation,
    },
  ];

  return groups
    .map((group) => {
      const sequenceMap = buildPermissionSequenceMap(group.permissions);
      const levelCounts = group.permissions.reduce(
        (counts, permission) => {
          const depth = permissionDepth(permission, permissionById);
          if (depth === 1) counts.l1 += 1;
          if (depth === 2) counts.l2 += 1;
          if (depth >= 3) counts.l3 += 1;
          return counts;
        },
        { l1: 0, l2: 0, l3: 0 },
      );
      const matchedPermissions = group.permissions.filter((permission) =>
        permissionMatchesFilters(permission, filtersByDomain[group.key]),
      );
      const permissionsWithContext = includeAncestorContext(
        matchedPermissions,
        permissionById,
      ).filter(
        (permission) =>
          resolvePermissionDomain(permission, permissionById) === group.key,
      );
      const activeCount = group.permissions.filter(
        (permission) => permission.status,
      ).length;
      const assignedCount = group.permissions.filter(
        (permission) => permission.roleCount > 0,
      ).length;

      return {
        key: group.key,
        title: group.title,
        description: group.description,
        icon: group.icon,
        nodes: applyPermissionSequence(
          stripWorkspaceRoot(buildPermissionTree(permissionsWithContext)),
          sequenceMap,
        ),
        matchedCount: matchedPermissions.length,
        totalCount: group.permissions.length,
        activeCount,
        assignedCount,
        disabledCount: group.permissions.length - activeCount,
        unassignedCount: group.permissions.length - assignedCount,
        levelCounts,
      };
    })
    .filter((group) => group.totalCount > 0);
}

interface PermissionFormState {
  permCode: string;
  permName: string;
  permType: PlatformPermissionType;
  parentId: string;
  routePath: string;
  component: string;
  icon: string;
  description: string;
  sort: string;
}

const EMPTY_PERMISSION_FORM: PermissionFormState = {
  permCode: "",
  permName: "",
  permType: "menu",
  parentId: "",
  routePath: "",
  component: "",
  icon: "",
  description: "",
  sort: "",
};

function parseSort(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function reportPermissionError(
  toast: ReturnType<typeof useToast>["toast"],
  fallbackTitle: string,
  error: unknown,
) {
  // The operator dismissed the step-up ceremony — no-op, not an error.
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

function PermissionFormDialog({
  mode,
  form,
  parentOptions,
  submitting,
  onChange,
  onClose,
  onSubmit,
}: {
  mode: "create" | "edit";
  form: PermissionFormState;
  parentOptions: PlatformAdminPermissionRecord[];
  submitting: boolean;
  onChange: (patch: Partial<PermissionFormState>) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const valid =
    form.permCode.trim().length > 0 && form.permName.trim().length > 0;

  return (
    <DialogForm
      open
      title={mode === "create" ? "新增权限" : "编辑权限"}
      description="维护平台菜单、按钮和接口权限，用于角色授权与访问控制。"
      submitLabel={mode === "create" ? "创建权限" : "保存修改"}
      submitting={submitting}
      submitDisabled={!valid}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      onSubmit={onSubmit}
    >
      <div className="vx-model-dialog__grid">
        <Label>
          权限编码
          <Input
            value={form.permCode}
            onChange={(event) => onChange({ permCode: event.target.value })}
            placeholder="如 admin.section.tenant"
            required
          />
        </Label>
        <Label>
          权限名称
          <Input
            value={form.permName}
            onChange={(event) => onChange({ permName: event.target.value })}
            placeholder="权限展示名称"
            required
          />
        </Label>
      </div>
      <div className="vx-model-dialog__grid">
        <Label>
          权限类型
          <NativeSelect
            value={form.permType}
            onChange={(event) =>
              onChange({
                permType: event.target.value as PlatformPermissionType,
              })
            }
          >
            <option value="menu">菜单</option>
            <option value="button">按钮</option>
            <option value="api">接口</option>
          </NativeSelect>
        </Label>
        <Label>
          上级权限
          <NativeSelect
            value={form.parentId}
            onChange={(event) => onChange({ parentId: event.target.value })}
          >
            <option value="">无（根权限）</option>
            {parentOptions.map((permission) => (
              <option key={permission.id} value={permission.id}>
                {permission.permCode}
              </option>
            ))}
          </NativeSelect>
        </Label>
      </div>
      <div className="vx-model-dialog__grid">
        <Label>
          路由路径
          <Input
            value={form.routePath}
            onChange={(event) => onChange({ routePath: event.target.value })}
            placeholder="如 /tenants"
          />
        </Label>
        <Label>
          组件
          <Input
            value={form.component}
            onChange={(event) => onChange({ component: event.target.value })}
            placeholder="前端组件路径"
          />
        </Label>
      </div>
      <div className="vx-model-dialog__grid">
        <Label>
          图标
          <Input
            value={form.icon}
            onChange={(event) => onChange({ icon: event.target.value })}
            placeholder="图标名称"
          />
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
          placeholder="权限用途说明"
          rows={3}
        />
      </Label>
    </DialogForm>
  );
}

function PermissionActionsMenu({
  permission,
  onOpenDetail,
  onEdit,
  onToggle,
}: {
  permission: PlatformAdminPermissionRecord;
  onOpenDetail: (permission: PlatformAdminPermissionRecord) => void;
  onEdit: (permission: PlatformAdminPermissionRecord) => void;
  onToggle: (permission: PlatformAdminPermissionRecord) => void;
}) {
  return (
    <div
      className="vx-tenant-actions"
      onClick={(event) => event.stopPropagation()}
    >
      <ActionMenu
        label={`${permissionDisplayName(permission)} 操作`}
        items={[
          {
            id: "detail",
            label: "权限详情",
            icon: "info",
            onSelect: () => onOpenDetail(permission),
          },
          {
            id: "edit",
            label: "编辑权限",
            icon: "edit",
            onSelect: () => onEdit(permission),
          },
          {
            id: "copy",
            label: "复制权限",
            icon: "copy",
            disabled: true,
          },
          {
            id: "toggle",
            label: permission.status ? "停用权限" : "启用权限",
            icon: permission.status ? "x" : "check",
            onSelect: () => onToggle(permission),
          },
        ]}
      />
    </div>
  );
}

function PermissionDetailDialog({
  permission,
  parentPermission,
  onClose,
}: {
  permission: PlatformAdminPermissionRecord;
  parentPermission: PlatformAdminPermissionRecord | null;
  onClose: () => void;
}) {
  const locale = useLocale();
  const tShared = useTranslations();
  const statusIndicator = permissionStatusIndicator(permission);

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      {/* max-w-none neutralizes DS DialogContent's default max-w-lg so the
          existing __panel width tokens drive the surface size. */}
      <DialogContent className="max-w-none vx-admin-role-permission-dialog__panel vx-admin-permission-detail-dialog">
        <header className="vx-admin-role-permission-dialog__header">
          <div>
            <DialogTitle>{permissionDisplayName(permission)}</DialogTitle>
            <DialogDescription>{permission.permCode}</DialogDescription>
          </div>
        </header>
        <div className="vx-admin-role-permission-dialog__summary">
          <Badge>{permissionTypeMetaOf(permission.permType).label}</Badge>
          <StatusBadge tone={permission.status ? "success" : "neutral"}>
            <Icon
              name={statusIndicator.icon}
              size="xs"
              fallback="placeholder"
            />
            {statusIndicator.label}
          </StatusBadge>
          <Badge>{permissionSourceLabel(permission)}</Badge>
        </div>
        <dl className="vx-admin-permission-detail-dialog__grid">
          <div>
            <dt>权限名称</dt>
            <dd>{permission.permName || EMPTY_MARK}</dd>
          </div>
          <div>
            <dt>权限 Code</dt>
            <dd>{permission.permCode}</dd>
          </div>
          <div>
            <dt>上级权限</dt>
            <dd>{parentPermission ? parentPermission.permCode : EMPTY_MARK}</dd>
          </div>
          <div>
            <dt>授权角色</dt>
            <dd>
              {formatNumber(permission.activeRoleCount)} /{" "}
              {formatNumber(permission.roleCount)}
            </dd>
          </div>
          <div>
            <dt>路径</dt>
            <dd>{permission.routePath || EMPTY_MARK}</dd>
          </div>
          <div>
            <dt>组件</dt>
            <dd>{permission.component || EMPTY_MARK}</dd>
          </div>
          <div>
            <dt>排序</dt>
            <dd>{formatNumber(permission.sort)}</dd>
          </div>
          <div>
            <dt>{tShared("columns.updatedAt")}</dt>
            <dd>
              {permission.updatedAt
                ? new Date(permission.updatedAt).toLocaleString(locale)
                : EMPTY_MARK}
            </dd>
          </div>
          <div className="vx-admin-permission-detail-dialog__wide">
            <dt>描述</dt>
            <dd>{permission.description || EMPTY_MARK}</dd>
          </div>
        </dl>
      </DialogContent>
    </Dialog>
  );
}

function PermissionDomainStats({ group }: { group: PermissionDomainGroup }) {
  return (
    <MetricGrid
      aria-label={`${group.title}统计`}
      columns={3}
      items={[
        {
          id: "total",
          help: "权限点总数，含未启用的。",
          icon: "shield-check",
          label: "权限总数",
          value: formatNumber(group.totalCount),
          tags: [
            `L1 ${formatNumber(group.levelCounts.l1)}`,
            `L2 ${formatNumber(group.levelCounts.l2)}`,
            `L3 ${formatNumber(group.levelCounts.l3)}`,
          ],
        },
        {
          id: "active",
          help: "处于启用状态的权限点。",
          icon: "check",
          label: "启用权限",
          value: formatNumber(group.activeCount),
          tags: [`停用 ${formatNumber(group.disabledCount)}`],
          tone: "success",
        },
        {
          id: "assigned",
          help: "至少被一个角色引用的权限点；未绑定的权限点不会对任何人生效。",
          icon: "key",
          label: "绑定权限",
          value: formatNumber(group.assignedCount),
          tags: [`未绑定 ${formatNumber(group.unassignedCount)}`],
          tone: "warning",
        },
      ]}
    />
  );
}

function PermissionCardGrid({
  nodes,
  onOpenDetail,
  onEdit,
  onToggle,
}: {
  nodes: PermissionTreeNode[];
  onOpenDetail: (permission: PlatformAdminPermissionRecord) => void;
  onEdit: (permission: PlatformAdminPermissionRecord) => void;
  onToggle: (permission: PlatformAdminPermissionRecord) => void;
}) {
  const tShared = useTranslations();
  const flattenedNodes = flattenTreeNodes(nodes);

  return (
    <div className="vx-admin-permission-card-grid" aria-label="权限卡片清单">
      {flattenedNodes.map(({ permission, depth }) => {
        const meta = permissionTypeMetaOf(permission.permType);
        const statusIndicator = permissionStatusIndicator(permission);

        return (
          <article
            key={permission.id}
            className={joinClasses(
              "vx-admin-permission-card",
              meta.className,
              permission.status ? "" : "vx-admin-permission-card--disabled",
            )}
            // Runtime tree depth feeds the CSS indent calc(--permission-depth);
            // a dynamic numeric value cannot be a static className.
            style={{ "--permission-depth": depth } as CSSProperties}
          >
            <header>
              <span>
                <Icon name={meta.icon} size="sm" fallback="placeholder" />
              </span>
              <div>
                <strong>{permissionDisplayName(permission)}</strong>
                <Badge>{permissionSourceLabel(permission)}</Badge>
              </div>
              <PermissionActionsMenu
                permission={permission}
                onOpenDetail={onOpenDetail}
                onEdit={onEdit}
                onToggle={onToggle}
              />
            </header>
            <span className="vx-admin-permission-card__type">
              <Badge>{meta.label}</Badge>
            </span>
            <dl>
              <div>
                <dt>{tShared("columns.state")}</dt>
                <dd>
                  <Icon
                    name={statusIndicator.icon}
                    size="xs"
                    fallback="placeholder"
                  />
                  {statusIndicator.label}
                </dd>
              </div>
              <div>
                <dt>授权角色</dt>
                <dd>
                  {formatNumber(permission.activeRoleCount)} /{" "}
                  {formatNumber(permission.roleCount)}
                </dd>
              </div>
              <div>
                <dt>层级</dt>
                <dd>{formatNumber(depth)}</dd>
              </div>
              <div>
                <dt>来源</dt>
                <dd>{permissionSourceLabel(permission)}</dd>
              </div>
            </dl>
          </article>
        );
      })}
    </div>
  );
}

function PermissionTreeNodeView({
  node,
  expandedIds,
  onToggle,
  permissionById,
  onOpenDetail,
  onEditPermission,
  onTogglePermission,
}: {
  node: PermissionTreeNode;
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
  permissionById: Map<string, PlatformAdminPermissionRecord>;
  onOpenDetail: (permission: PlatformAdminPermissionRecord) => void;
  onEditPermission: (permission: PlatformAdminPermissionRecord) => void;
  onTogglePermission: (permission: PlatformAdminPermissionRecord) => void;
}) {
  const { permission, children, depth } = node;
  const meta = permissionTypeMetaOf(permission.permType);
  const expanded = expandedIds.has(permission.id);
  const titleClassName =
    isSectionPermission(permission) || depth === 0
      ? "vx-admin-permission-tree-node__title--level-2"
      : "vx-admin-permission-tree-node__title--level-3";
  const statusIndicator = permissionStatusIndicator(permission);

  return (
    <article
      className={joinClasses(
        "vx-admin-permission-tree-node",
        meta.className,
        isSectionPermission(permission)
          ? "vx-admin-permission-tree-node--section"
          : "",
        permission.status ? "" : "vx-admin-permission-tree-node--disabled",
      )}
      // Runtime tree depth feeds the CSS indent calc(--permission-depth);
      // a dynamic numeric value cannot be a static className.
      style={{ "--permission-depth": depth } as CSSProperties}
    >
      <div className="vx-admin-permission-tree-node__detail-row">
        <span className="vx-admin-permission-tree-node__summary">
          <span>{node.sequence || formatNumber(permission.sort)}</span>
        </span>
        <span className="vx-admin-permission-tree-node__name">
          <Button
            variant="ghost"
            size="icon-md"
            className="vx-admin-permission-tree-node__toggle"
            onClick={() => onToggle(permission.id)}
            disabled={!children.length}
            aria-label={expanded ? "收起权限子级" : "展开权限子级"}
          >
            <Icon
              name={
                children.length
                  ? expanded
                    ? "chevron-down"
                    : "chevron-right"
                  : "chevron-right"
              }
              size="xs"
              fallback="chevron-right"
            />
          </Button>
          <Icon name={meta.icon} size="sm" fallback="placeholder" />
          <span
            className={joinClasses(
              "vx-admin-permission-tree-node__title",
              titleClassName,
            )}
          >
            <strong>{permissionDisplayName(permission)}</strong>
            <span className="vx-admin-permission-tree-node__title-tags">
              <Badge
                className={joinClasses(
                  "vx-tenant-pill",
                  "vx-admin-permission-layer-pill",
                  permissionLayerPillClass(depth),
                )}
              >
                {depth === 0 ? "根权限" : `L${depth}`}
              </Badge>
              {children.length ? (
                <Badge>{formatNumber(children.length)} 子级</Badge>
              ) : null}
              {isSectionPermission(permission) ? <Badge>业务分组</Badge> : null}
            </span>
          </span>
        </span>
        <span className="vx-admin-permission-tree-node__status">
          <StatusBadge tone={permission.status ? "success" : "neutral"}>
            <Icon
              name={statusIndicator.icon}
              size="xs"
              fallback="placeholder"
            />
            {statusIndicator.label}
          </StatusBadge>
        </span>
        <span className="vx-admin-permission-tree-node__type">
          <Badge>{meta.label}</Badge>
        </span>
        <span className="vx-admin-permission-tree-node__source">
          <Badge>{permissionSourceLabel(permission)}</Badge>
        </span>
        <span className="vx-admin-permission-tree-node__roles">
          <strong>
            {formatNumber(permission.activeRoleCount)} /{" "}
            {formatNumber(permission.roleCount)}
          </strong>
        </span>
        <span className="vx-admin-permission-tree-node__actions">
          <PermissionActionsMenu
            permission={permission}
            onOpenDetail={onOpenDetail}
            onEdit={onEditPermission}
            onToggle={onTogglePermission}
          />
        </span>
      </div>
      {children.length && expanded ? (
        <div className="vx-admin-permission-tree-node__children">
          {children.map((child) => (
            <PermissionTreeNodeView
              key={child.permission.id}
              node={child}
              expandedIds={expandedIds}
              onToggle={onToggle}
              permissionById={permissionById}
              onOpenDetail={onOpenDetail}
              onEditPermission={onEditPermission}
              onTogglePermission={onTogglePermission}
            />
          ))}
        </div>
      ) : null}
    </article>
  );
}

function PermissionDomainSection({
  group,
  permissionById,
  expandedIds,
  onToggle,
  onExpand,
  onCollapse,
  filters,
  onFilterChange,
  onResetFilters,
  viewMode,
  onViewModeChange,
  onCreatePermission,
  onEditPermission,
  onTogglePermission,
}: {
  group: PermissionDomainGroup;
  permissionById: Map<string, PlatformAdminPermissionRecord>;
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
  onExpand: (ids: string[]) => void;
  onCollapse: (ids: string[]) => void;
  filters: DomainFilterState;
  onFilterChange: (patch: Partial<DomainFilterState>) => void;
  onResetFilters: () => void;
  viewMode: ViewModeSwitchValue;
  onViewModeChange: (mode: ViewModeSwitchValue) => void;
  onCreatePermission: () => void;
  onEditPermission: (permission: PlatformAdminPermissionRecord) => void;
  onTogglePermission: (permission: PlatformAdminPermissionRecord) => void;
}) {
  const tShared = useTranslations();
  const domainPermissionIds = useMemo(
    () => collectPermissionIds(group.nodes),
    [group.nodes],
  );
  const [detailPermissionId, setDetailPermissionId] = useState<string | null>(
    null,
  );
  const detailPermission = detailPermissionId
    ? (permissionById.get(detailPermissionId) ?? null)
    : null;
  const detailParentPermission = detailPermission?.parentId
    ? (permissionById.get(detailPermission.parentId) ?? null)
    : null;

  return (
    <section
      className="vx-admin-permission-domain"
      /* 原先靠 `aria-labelledby` 指向标题的 h2#id。SectionHeader 不保证 id 落在
       * h2 上（透传属性去的是根元素），换成 aria-label——可访问名称一样，且不再
       * 依赖别人的 DOM 内部结构。 */
      aria-label={group.title}
    >
      <SectionHeader
        level={2}
        icon={group.icon}
        title={group.title}
        description={group.description}
      />
      <PermissionDomainStats group={group} />
      <section
        className="vx-tenant-toolbar vx-admin-permission-domain__toolbar"
        aria-label={`${group.title}筛选`}
      >
        <ViewModeSwitch
          value={viewMode}
          onChange={onViewModeChange}
          ariaLabel={`${group.title}展示方式`}
        />
        <span className="vx-tenant-view-count">
          {formatNumber(group.matchedCount)} / {formatNumber(group.totalCount)}
        </span>
        <span className="vx-tenant-toolbar__spacer" aria-hidden="true" />
        <Input
          value={filters.query}
          onChange={(event) => onFilterChange({ query: event.target.value })}
          placeholder="搜索权限 code、名称、路径、组件"
          className="vx-tenant-search"
          aria-label={`搜索${group.title}`}
        />
        <Button variant="outline" onClick={onResetFilters}>
          重置
        </Button>
        <div className="vx-tenant-filters">
          <NativeSelect
            className="vx-input vx-tenant-select"
            value={filters.typeFilter}
            onChange={(event) =>
              onFilterChange({
                typeFilter: event.target.value as PermissionFilter,
              })
            }
            aria-label={`${group.title}权限类型`}
          >
            <option value="all">{tShared("filters.allKinds")}</option>
            <option value="menu">菜单权限</option>
            <option value="button">按钮权限</option>
            <option value="api">接口权限</option>
          </NativeSelect>
          <NativeSelect
            className="vx-input vx-tenant-select"
            value={filters.statusFilter}
            onChange={(event) =>
              onFilterChange({
                statusFilter: event.target.value as StatusFilter,
              })
            }
            aria-label={`${group.title}权限状态`}
          >
            <option value="all">{tShared("filters.allStates")}</option>
            <option value="active">{tShared("actions.enable")}</option>
            <option value="disabled">{tShared("actions.disable")}</option>
          </NativeSelect>
          <NativeSelect
            className="vx-input vx-tenant-select"
            value={filters.sourceFilter}
            onChange={(event) =>
              onFilterChange({
                sourceFilter: event.target.value as SourceFilter,
              })
            }
            aria-label={`${group.title}权限来源`}
          >
            <option value="all">全部来源</option>
            <option value="system">系统预置</option>
            <option value="custom">自定义</option>
          </NativeSelect>
        </div>
        <Button variant="outline" onClick={() => onExpand(domainPermissionIds)}>
          展开
        </Button>
        <Button
          variant="outline"
          onClick={() => onCollapse(domainPermissionIds)}
        >
          收起
        </Button>
        <ActionButton
          variant="outline"
          icon="plus"
          onClick={onCreatePermission}
        >
          新增权限
        </ActionButton>
      </section>
      {group.nodes.length ? (
        viewMode === "list" ? (
          <div
            className="vx-admin-permission-tree"
            role="treegrid"
            aria-label={group.title}
          >
            <div className="vx-admin-permission-tree__header">
              <span>#</span>
              <span>权限名称</span>
              <span>{tShared("columns.state")}</span>
              <span>{tShared("columns.kind")}</span>
              <span>来源</span>
              <span>授权角色</span>
              <span>操作</span>
            </div>
            {group.nodes.map((node) => (
              <PermissionTreeNodeView
                key={node.permission.id}
                node={node}
                expandedIds={expandedIds}
                onToggle={onToggle}
                permissionById={permissionById}
                onOpenDetail={(permission) => {
                  setDetailPermissionId(permission.id);
                }}
                onEditPermission={onEditPermission}
                onTogglePermission={onTogglePermission}
              />
            ))}
          </div>
        ) : (
          <PermissionCardGrid
            nodes={group.nodes}
            onOpenDetail={(permission) => {
              setDetailPermissionId(permission.id);
            }}
            onEdit={onEditPermission}
            onToggle={onTogglePermission}
          />
        )
      ) : (
        <EmptyState
          title={`没有匹配的${group.title}`}
          description="清空当前板块筛选条件后可查看该域全部权限。"
          action={
            <ActionButton variant="outline" icon="x" onClick={onResetFilters}>
              {tShared("common.clearFilters")}
            </ActionButton>
          }
        />
      )}
      {detailPermission ? (
        <PermissionDetailDialog
          permission={detailPermission}
          parentPermission={detailParentPermission}
          onClose={() => setDetailPermissionId(null)}
        />
      ) : null}
    </section>
  );
}

export function AdminPermissionsPage() {
  const [permissions, setPermissions] = useState<
    PlatformAdminPermissionRecord[]
  >([]);
  const [filtersByDomain, setFiltersByDomain] = useState<
    Record<PermissionDomainKey, DomainFilterState>
  >({
    "tenant-ops": { ...DEFAULT_DOMAIN_FILTERS },
    "platform-autonomy": { ...DEFAULT_DOMAIN_FILTERS },
    foundation: { ...DEFAULT_DOMAIN_FILTERS },
  });
  const [viewModeByDomain, setViewModeByDomain] = useState<
    Record<PermissionDomainKey, ViewModeSwitchValue>
  >({
    "tenant-ops": "list",
    "platform-autonomy": "list",
    foundation: "list",
  });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expandedPermissionIds, setExpandedPermissionIds] = useState<
    Set<string>
  >(() => new Set());
  const [reloadKey, setReloadKey] = useState(0);
  const { toast } = useToast();
  const { runWithStepUp } = useStepUp();
  const [permDialogMode, setPermDialogMode] = useState<
    "create" | "edit" | null
  >(null);
  const [permForm, setPermForm] = useState<PermissionFormState>(
    EMPTY_PERMISSION_FORM,
  );
  const [editingPermissionId, setEditingPermissionId] = useState<string | null>(
    null,
  );
  const [permSubmitting, setPermSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    fetchPlatformPermissions()
      .then((records) => {
        if (active) setPermissions(records);
      })
      .catch((error) => {
        if (active)
          setLoadError(
            error instanceof Error ? error.message : "平台权限数据库读取失败",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reloadKey]);

  const permissionById = useMemo(
    () => new Map(permissions.map((permission) => [permission.id, permission])),
    [permissions],
  );
  const permissionDomainGroups = useMemo(
    () =>
      buildPermissionDomainGroups(permissions, permissionById, filtersByDomain),
    [filtersByDomain, permissions, permissionById],
  );

  const openCreatePermission = () => {
    setEditingPermissionId(null);
    setPermForm(EMPTY_PERMISSION_FORM);
    setPermDialogMode("create");
  };

  const openEditPermission = (permission: PlatformAdminPermissionRecord) => {
    setEditingPermissionId(permission.id);
    setPermForm({
      permCode: permission.permCode,
      permName: permission.permName,
      permType: permission.permType,
      parentId: permission.parentId ?? "",
      routePath: permission.routePath ?? "",
      component: permission.component ?? "",
      icon: permission.icon ?? "",
      description: permission.description ?? "",
      sort: String(permission.sort ?? ""),
    });
    setPermDialogMode("edit");
  };

  const togglePermission = async (
    permission: PlatformAdminPermissionRecord,
  ) => {
    try {
      await runWithStepUp(() => toggleOperatorPermission(permission.id));
      toast({
        tone: "success",
        title: permission.status ? "已停用权限" : "已启用权限",
      });
      setReloadKey((key) => key + 1);
    } catch (error) {
      reportPermissionError(toast, "权限状态更新失败", error);
    }
  };

  const submitPermissionForm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPermSubmitting(true);
    const sortValue = parseSort(permForm.sort);
    const shared = {
      permName: permForm.permName.trim(),
      ...(permForm.parentId ? { parentId: permForm.parentId } : {}),
      ...(permForm.routePath.trim()
        ? { routePath: permForm.routePath.trim() }
        : {}),
      ...(permForm.component.trim()
        ? { component: permForm.component.trim() }
        : {}),
      ...(permForm.icon.trim() ? { icon: permForm.icon.trim() } : {}),
      ...(permForm.description.trim()
        ? { description: permForm.description.trim() }
        : {}),
      ...(sortValue !== undefined ? { sort: sortValue } : {}),
    };
    try {
      if (permDialogMode === "create") {
        await runWithStepUp(() =>
          createOperatorPermission({
            permCode: permForm.permCode.trim(),
            permType: permForm.permType,
            ...shared,
          }),
        );
        toast({ tone: "success", title: "权限已创建" });
      } else if (editingPermissionId) {
        await runWithStepUp(() =>
          updateOperatorPermission(editingPermissionId, {
            permType: permForm.permType,
            ...shared,
          }),
        );
        toast({ tone: "success", title: "权限已更新" });
      }
      setPermDialogMode(null);
      setReloadKey((key) => key + 1);
    } catch (error) {
      reportPermissionError(
        toast,
        permDialogMode === "create" ? "权限创建失败" : "权限更新失败",
        error,
      );
    } finally {
      setPermSubmitting(false);
    }
  };

  const activeCount = permissions.filter(
    (permission) => permission.status,
  ).length;
  const assignedCount = permissions.filter(
    (permission) => permission.roleCount > 0,
  ).length;
  const disabledCount = permissions.length - activeCount;
  const unassignedCount = permissions.length - assignedCount;
  const permissionLevelCounts = useMemo(() => {
    return permissions.reduce(
      (counts, permission) => {
        const depth = permissionDepth(permission, permissionById);
        if (depth === 1) counts.l1 += 1;
        if (depth === 2) counts.l2 += 1;
        if (depth >= 3) counts.l3 += 1;
        return counts;
      },
      { l1: 0, l2: 0, l3: 0 },
    );
  }, [permissionById, permissions]);
  const visiblePermissionIds = useMemo(
    () =>
      permissionDomainGroups.flatMap((group) =>
        collectPermissionIds(group.nodes),
      ),
    [permissionDomainGroups],
  );

  useEffect(() => {
    setExpandedPermissionIds(new Set(visiblePermissionIds));
  }, [visiblePermissionIds]);

  function updateDomainFilters(
    domain: PermissionDomainKey,
    patch: Partial<DomainFilterState>,
  ) {
    setFiltersByDomain((current) => ({
      ...current,
      [domain]: {
        ...current[domain],
        ...patch,
      },
    }));
  }

  function resetDomainFilters(domain: PermissionDomainKey) {
    setFiltersByDomain((current) => ({
      ...current,
      [domain]: { ...DEFAULT_DOMAIN_FILTERS },
    }));
  }

  function updateDomainViewMode(
    domain: PermissionDomainKey,
    viewMode: ViewModeSwitchValue,
  ) {
    setViewModeByDomain((current) => ({
      ...current,
      [domain]: viewMode,
    }));
  }

  function togglePermissionNode(permissionId: string) {
    setExpandedPermissionIds((current) => {
      const next = new Set(current);
      if (next.has(permissionId)) {
        next.delete(permissionId);
      } else {
        next.add(permissionId);
      }
      return next;
    });
  }

  function expandPermissions(permissionIds: string[]) {
    setExpandedPermissionIds((current) => {
      const next = new Set(current);
      permissionIds.forEach((permissionId) => next.add(permissionId));
      return next;
    });
  }

  function collapsePermissions(permissionIds: string[]) {
    setExpandedPermissionIds((current) => {
      const next = new Set(current);
      permissionIds.forEach((permissionId) => next.delete(permissionId));
      return next;
    });
  }

  return (
    <ViewLayout className="vx-tenant-management-page vx-admin-permissions-page">
      <PageHeader
        icon="shield-check"
        title="权限策略"
        description="统一维护平台菜单、按钮和接口权限，用于角色授权、访问控制和平台自治治理。"
      />

      <MetricGrid
        loading={loading}
        aria-label="平台权限统计"
        columns={3}
        items={[
          {
            id: "total",
            help: "权限点总数，含未启用的。",
            icon: "shield-check",
            label: "权限总数",
            value: formatNumber(permissions.length),
            tags: [
              `L1 ${formatNumber(permissionLevelCounts.l1)}`,
              `L2 ${formatNumber(permissionLevelCounts.l2)}`,
              `L3 ${formatNumber(permissionLevelCounts.l3)}`,
            ],
          },
          {
            id: "active",
            help: "处于启用状态的权限点。",
            icon: "check",
            label: "启用权限",
            value: formatNumber(activeCount),
            tags: [`停用 ${formatNumber(disabledCount)}`],
            tone: "success",
          },
          {
            id: "assigned",
            help: "至少被一个角色引用的权限点；未绑定的权限点不会对任何人生效。",
            icon: "key",
            label: "绑定权限",
            value: formatNumber(assignedCount),
            tags: [`未绑定 ${formatNumber(unassignedCount)}`],
            tone: "warning",
          },
        ]}
      />

      <div className="vx-tenant-list-shell">
        {permissions.length ? (
          <section
            className="vx-admin-permission-structure"
            aria-label="权限结构"
          >
            <div className="vx-admin-permission-domain-stack">
              {permissionDomainGroups.map((group) => (
                <PermissionDomainSection
                  key={group.key}
                  group={group}
                  permissionById={permissionById}
                  expandedIds={expandedPermissionIds}
                  onToggle={togglePermissionNode}
                  onExpand={expandPermissions}
                  onCollapse={collapsePermissions}
                  filters={filtersByDomain[group.key]}
                  onFilterChange={(patch) =>
                    updateDomainFilters(group.key, patch)
                  }
                  onResetFilters={() => resetDomainFilters(group.key)}
                  viewMode={viewModeByDomain[group.key]}
                  onViewModeChange={(viewMode) =>
                    updateDomainViewMode(group.key, viewMode)
                  }
                  onCreatePermission={openCreatePermission}
                  onEditPermission={openEditPermission}
                  onTogglePermission={togglePermission}
                />
              ))}
            </div>
          </section>
        ) : (
          <EmptyState
            title={
              loading
                ? "正在加载平台权限"
                : loadError
                  ? "平台权限读取失败"
                  : "没有匹配的平台权限"
            }
            description={
              loading
                ? "正在读取 platform.platform_permission。"
                : (loadError ?? "当前没有可展示的平台权限。")
            }
          />
        )}
      </div>

      {permDialogMode ? (
        <PermissionFormDialog
          mode={permDialogMode}
          form={permForm}
          parentOptions={permissions}
          submitting={permSubmitting}
          onChange={(patch) => setPermForm((prev) => ({ ...prev, ...patch }))}
          onClose={() => setPermDialogMode(null)}
          onSubmit={submitPermissionForm}
        />
      ) : null}
    </ViewLayout>
  );
}
