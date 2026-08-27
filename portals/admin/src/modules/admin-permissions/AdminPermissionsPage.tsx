"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  ActionButton,
  ActionMenu,
  Badge,
  Button,
  DataTable,
  DetailList,
  DetailRow,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogForm,
  DialogTitle,
  EmptyState,
  Icon,
  Input,
  Label,
  ListCardGrid,
  MetricGrid,
  MetricListCard,
  NativeSelect,
  SectionHeader,
  StatusBadge,
  TableTitleCell,
  Textarea,
  useToast,
  ViewLayout,
  ViewModeSwitch,
} from "@vxture/design-system";
import type {
  DataTableColumn,
  IconName,
  StatusBadgeTone,
  ViewModeSwitchValue,
} from "@vxture/design-system";
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
import { formatNumber } from "@/modules/tenants/tenant-utils";
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

/* `tone` 取代原来的 `className`：那三个类只是把 `--tenant-row-tone` 设成蓝/青/琥珀
   喂给图标颜色。类型是**类目**不是严重度，用色只为在一棵深树里分得开——与角色页的
   `PERM_TYPE_TONE` 同一判断。 */
const permissionTypeMeta = {
  menu: { label: "菜单", icon: "table", tone: "brand" },
  button: { label: "按钮", icon: "check", tone: "info" },
  api: { label: "接口", icon: "api", tone: "warning" },
} as const;

/** 查不到就退回中性档：一个没见过的类型不该让整棵权限树崩掉。 */
const UNKNOWN_PERMISSION_TYPE = {
  label: "未知类型",
  icon: "info",
  tone: "neutral",
} as const;

/**
 * 层级缩进：深度 → 左边距类。
 *
 * 定长表而不是算出来的值：内联 style 承载间距会被 `ds/no-inline-design-style` 拦
 * （它只收动态变量与坐标），`pl-[Nrem]` 会被 `ds/no-app-tailwind-arbitrary-scale`
 * 拦。超出表长的深度按最深一档——树再深也不该靠缩进来读，那是 L 徽章的活。
 */
const DEPTH_INDENT = ["ps-0", "ps-md", "ps-lg", "ps-xl", "ps-2xl"] as const;

function depthIndentClass(depth: number) {
  return DEPTH_INDENT[Math.min(Math.max(depth, 0), DEPTH_INDENT.length - 1)];
}

/**
 * 当前展开状态下**可见**的节点，拍平成一维。
 *
 * 树原来是递归 DOM，展开的子节点是父节点的后代元素。拍平之后它就是一张普通表，
 * 层级由缩进与 L 徽章表达——这样表头、粘性操作列、加载骨架与空态才能交给
 * `DataTable`，而不是每处自己再画一遍。
 */
function flattenVisibleNodes(
  nodes: readonly PermissionTreeNode[],
  expandedIds: Set<string>,
  out: PermissionTreeNode[] = [],
) {
  for (const node of nodes) {
    out.push(node);
    if (node.children.length && expandedIds.has(node.permission.id)) {
      flattenVisibleNodes(node.children, expandedIds, out);
    }
  }
  return out;
}

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

/**
 * 权限树的层级记号 → 语气。照 `.vx-admin-permission-layer-pill--*` 实测的
 * 底色定：根中性、L1 品牌蓝、L2 青、L3 琥珀。层级是**序**不是严重度，
 * 用色只为在一棵深树里分出层。
 */
function permissionLayerTone(depth: number): StatusBadgeTone {
  if (depth <= 0) return "neutral";
  if (depth === 1) return "brand";
  if (depth === 2) return "info";
  return "warning";
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
      <div>
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
      <div>
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
      <div>
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
      <div>
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
      className="relative z-[1] inline-flex justify-self-end"
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
      {/* 抵消 DS DialogContent 的默认宽度，让 __panel 的宽度令牌决定面板尺寸。
          写方括号任意值而不是 `max-w-none`：DS 注册了 `--space-none: 0px`，而
          Tailwind v4 解 `max-w-<名>` 时先查 `--spacing-*`，那个关键字因此变成
          `max-width: 0`，面板被夹成 34px（实测 2026-08-27，本应 896px）。方括号
          不过主题查表，字面就是 CSS 关键字。同源的坑还有 `max-w-md`…`max-w-5xl`
          与 `leading-none`，记在 `portals/website/assets/legacy-tokens/tokens-website.css`。 */}
      <DialogContent className="max-w-[none] vx-admin-role-permission-dialog__panel">
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
        <DetailList columns={2}>
          <DetailRow label="权限名称">
            {permission.permName || EMPTY_MARK}
          </DetailRow>
          <DetailRow label="权限 Code">{permission.permCode}</DetailRow>
          <DetailRow label="上级权限">
            {parentPermission ? parentPermission.permCode : EMPTY_MARK}
          </DetailRow>
          <DetailRow label="授权角色">
            {formatNumber(permission.activeRoleCount)} /{" "}
            {formatNumber(permission.roleCount)}
          </DetailRow>
          <DetailRow label="路径">
            {permission.routePath || EMPTY_MARK}
          </DetailRow>
          <DetailRow label="组件">
            {permission.component || EMPTY_MARK}
          </DetailRow>
          <DetailRow label="排序">{formatNumber(permission.sort)}</DetailRow>
          <DetailRow label={tShared("columns.updatedAt")}>
            {permission.updatedAt
              ? new Date(permission.updatedAt).toLocaleString(locale)
              : EMPTY_MARK}
          </DetailRow>
          <DetailRow label="描述" className="sm:col-span-2">
            {permission.description || EMPTY_MARK}
          </DetailRow>
        </DetailList>
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
  const flattenedNodes = flattenTreeNodes(nodes);

  return (
    <ListCardGrid aria-label="权限卡片清单">
      {flattenedNodes.map(({ permission, depth }) => {
        const meta = permissionTypeMetaOf(permission.permType);
        const statusIndicator = permissionStatusIndicator(permission);

        return (
          <MetricListCard
            key={permission.id}
            icon={meta.icon}
            title={permissionDisplayName(permission)}
            description={permission.permCode}
            tone={permission.status ? meta.tone : "neutral"}
            /* 停用的权限整卡压暗——原来是 `.vx-admin-permission-card--disabled`
               的 `opacity: 0.66`，判据不变。 */
            className={permission.status ? "" : "opacity-70"}
            actions={
              <PermissionActionsMenu
                permission={permission}
                onOpenDetail={onOpenDetail}
                onEdit={onEdit}
                onToggle={onToggle}
              />
            }
            badges={
              <>
                <StatusBadge tone={meta.tone} icon={false}>
                  {meta.label}
                </StatusBadge>
                <StatusBadge
                  tone={permission.status ? "success" : "neutral"}
                  icon={statusIndicator.icon}
                >
                  {statusIndicator.label}
                </StatusBadge>
                <Badge>{permissionSourceLabel(permission)}</Badge>
              </>
            }
            metrics={[
              {
                key: "roles",
                value: `${formatNumber(permission.activeRoleCount)} / ${formatNumber(permission.roleCount)}`,
                label: "授权角色",
              },
              { key: "depth", value: formatNumber(depth), label: "层级" },
              {
                key: "source",
                value: permissionSourceLabel(permission),
                label: "来源",
              },
            ]}
          />
        );
      })}
    </ListCardGrid>
  );
}

/**
 * 权限树的列。
 *
 * 原来是一个**递归组件**：每个节点画一行 7 列 grid，展开的子节点作为它的后代
 * DOM 继续递归，缩进靠 `padding-left: calc(var(--permission-depth) * space-md)`，
 * 深度用内联样式喂进 CSS 变量；表头是另一个列宽相同的 grid，操作列 `position:
 * sticky` 钉右边。
 *
 * 拍平成一维行之后它就是一张普通表——表头、粘性 64px 操作列、加载骨架与空态都回到
 * `DataTable` 的契约里，不必每处再画一遍。层级由缩进 + L 徽章表达，与原来一致。
 */
function usePermissionTreeColumns({
  expandedIds,
  onToggle,
}: {
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
}): DataTableColumn<PermissionTreeNode>[] {
  const tShared = useTranslations();

  return [
    {
      id: "sequence",
      header: "#",
      align: "center",
      cell: ({ permission, sequence }) => (
        <span className="text-body-sm text-muted-foreground">
          {sequence || formatNumber(permission.sort)}
        </span>
      ),
    },
    {
      id: "name",
      header: "权限名称",
      cell: (node) => {
        const { permission, children, depth } = node;
        const meta = permissionTypeMetaOf(permission.permType);
        const expanded = expandedIds.has(permission.id);
        return (
          <span
            className={`flex min-w-0 items-center gap-sm ${depthIndentClass(depth)}`}
          >
            <Button
              variant="ghost"
              size="icon-sm"
              className="shrink-0"
              onClick={() => onToggle(permission.id)}
              disabled={!children.length}
              aria-label={expanded ? "收起权限子级" : "展开权限子级"}
            >
              <Icon
                name={
                  children.length && expanded ? "chevron-down" : "chevron-right"
                }
                size="xs"
                fallback="chevron-right"
              />
            </Button>
            <Icon
              name={meta.icon}
              size="sm"
              fallback="placeholder"
              className="shrink-0"
            />
            <TableTitleCell
              title={permissionDisplayName(permission)}
              titleSuffix={
                <>
                  <StatusBadge tone={permissionLayerTone(depth)} icon={false}>
                    {depth === 0 ? "根权限" : `L${depth}`}
                  </StatusBadge>
                  {children.length ? (
                    <Badge>{formatNumber(children.length)} 子级</Badge>
                  ) : null}
                  {isSectionPermission(permission) ? (
                    <Badge>业务分组</Badge>
                  ) : null}
                </>
              }
              description={permission.permCode}
            />
          </span>
        );
      },
    },
    {
      id: "status",
      header: tShared("columns.state"),
      align: "center",
      cell: ({ permission }) => {
        const indicator = permissionStatusIndicator(permission);
        return (
          <StatusBadge
            tone={permission.status ? "success" : "neutral"}
            icon={indicator.icon}
          >
            {indicator.label}
          </StatusBadge>
        );
      },
    },
    {
      id: "kind",
      header: tShared("columns.kind"),
      align: "center",
      cell: ({ permission }) => {
        const meta = permissionTypeMetaOf(permission.permType);
        return (
          <StatusBadge tone={meta.tone} icon={false}>
            {meta.label}
          </StatusBadge>
        );
      },
    },
    {
      id: "source",
      header: "来源",
      align: "center",
      cell: ({ permission }) => (
        <Badge>{permissionSourceLabel(permission)}</Badge>
      ),
    },
    {
      id: "roles",
      header: "授权角色",
      align: "right",
      cell: ({ permission }) =>
        `${formatNumber(permission.activeRoleCount)} / ${formatNumber(permission.roleCount)}`,
    },
  ];
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
  /* 展开状态下可见的节点，拍平成表格的行。钉在 nodes 与 expandedIds 上：
     不 memo 的话每次渲染都是一个新数组，DataTable 白白重算一遍。 */
  const visibleNodes = useMemo(
    () => flattenVisibleNodes(group.nodes, expandedIds),
    [group.nodes, expandedIds],
  );
  /* 行操作走 DataTable 的 `rowActions`（它管固定 64px 与列锁定），所以列工厂
     只要展开状态这一件事。 */
  const treeColumns = usePermissionTreeColumns({ expandedIds, onToggle });
  const detailPermission = detailPermissionId
    ? (permissionById.get(detailPermissionId) ?? null)
    : null;
  const detailParentPermission = detailPermission?.parentId
    ? (permissionById.get(detailPermission.parentId) ?? null)
    : null;

  return (
    <section
      className="grid min-w-0"
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
        className="flex min-w-0 items-center gap-md py-md max-xl:flex-wrap max-lg:items-stretch"
        aria-label={`${group.title}筛选`}
      >
        <ViewModeSwitch
          value={viewMode}
          onChange={onViewModeChange}
          ariaLabel={`${group.title}展示方式`}
        />
        <span className="inline-flex min-h-control-lg items-center pl-xs text-body-md font-extrabold whitespace-nowrap text-foreground max-lg:mr-auto">
          {formatNumber(group.matchedCount)} / {formatNumber(group.totalCount)}
        </span>
        <span className="flex-1 max-lg:hidden" aria-hidden="true" />
        <Input
          value={filters.query}
          onChange={(event) => onFilterChange({ query: event.target.value })}
          placeholder="搜索权限 code、名称、路径、组件"
          className="grow basis-media-3xl max-w-panel-sm"
          aria-label={`搜索${group.title}`}
        />
        <Button variant="outline" onClick={onResetFilters}>
          重置
        </Button>
        <>
          <NativeSelect
            className="w-fit basis-media-xl"
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
            className="w-fit basis-media-xl"
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
            className="w-fit basis-media-xl"
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
        </>
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
          <DataTable
            columns={treeColumns}
            rows={visibleNodes}
            rowKey={(node) => node.permission.id}
            aria-label={group.title}
            rowActions={(node) => (
              <PermissionActionsMenu
                permission={node.permission}
                onOpenDetail={(permission) => {
                  setDetailPermissionId(permission.id);
                }}
                onEdit={onEditPermission}
                onToggle={onTogglePermission}
              />
            )}
          />
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
    <ViewLayout className="w-full">
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

      <div className="grid min-w-0">
        {permissions.length ? (
          <section className="grid pb-md" aria-label="权限结构">
            <div className="grid gap-xl">
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
