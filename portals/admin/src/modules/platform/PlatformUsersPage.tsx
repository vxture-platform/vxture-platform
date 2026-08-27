"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ActionButton,
  ActionMenu,
  Badge,
  Button,
  DataTable,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogForm,
  DialogHeader,
  DialogTitle,
  EmptyState,
  FilterBar,
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
import {
  changePlatformAdminRole,
  createPlatformAdmin,
  disablePlatformAdmin,
  enablePlatformAdmin,
  fetchCurrentUser,
  fetchPlatformAdmins,
  fetchPlatformRoles,
  forcePlatformAdminLogout,
  isStepUpRequiredError,
  resetPlatformAdminMfa,
  resetPlatformAdminPassword,
  updatePlatformAdmin,
  type PlatformAdminMetadataInput,
} from "@/api/admin-bff";
import type {
  PlatformAdminRecord,
  PlatformRoleRecord,
} from "@/entities/console";
import { PageHeader } from "@/modules/shared/PageHeader";
import { type PageSize } from "@/modules/shared/PageSizePicker";
import { useLocale, useTranslations } from "next-intl";
import { formatDate, formatNumber } from "@/modules/tenants/tenant-utils";
import { useStepUp, isStepUpCancelled } from "@/providers/StepUpProvider";

type ViewMode = "list" | "cards";
type PlatformAdminStatusCode = PlatformAdminRecord["statusCode"];
type StatusFilter = "all" | PlatformAdminStatusCode;
type UserTypeFilter = "all" | "system" | "normal";
const EMPTY_MARK = "-";

function platformRoleDisplayName(
  admin: PlatformAdminRecord,
  t: ReturnType<typeof useTranslations>,
) {
  /* 同 AdminRolesPage：键来自库的伴生 `_key` 列，托底用库自己的英文名。 */
  return t.has(admin.roleNameI18nKey)
    ? t(admin.roleNameI18nKey)
    : admin.roleNameEn;
}

function platformRoleStatusLabel(admin: PlatformAdminRecord) {
  if (admin.roleStatusCode === "active") return "启用";
  if (admin.roleStatusCode === "archived") return "归档";
  return "停用";
}

function platformRoleStatusTone(admin: PlatformAdminRecord): StatusBadgeTone {
  if (admin.roleStatusCode === "active") return "success";
  if (admin.roleStatusCode === "archived") return "warning";
  return "neutral";
}

function platformAdminStatusCode(
  admin: PlatformAdminRecord,
): PlatformAdminStatusCode {
  const statusCode = admin.statusCode;
  if (
    statusCode === "active" ||
    statusCode === "disabled" ||
    statusCode === "locked" ||
    statusCode === "pending" ||
    statusCode === "suspended"
  ) {
    return statusCode;
  }
  return admin.status ? "active" : "disabled";
}

function platformAdminSearchText(admin: PlatformAdminRecord) {
  return [
    admin.id,
    admin.username,
    admin.displayName,
    admin.email,
    admin.phone,
    admin.roleCode,
    admin.roleNameI18nKey,
    admin.roleNameEn,
    admin.lastLoginIp,
    admin.remark,
    platformAdminStatusCode(admin),
    platformAdminStatusLabel(admin),
    admin.isSystem ? "system 系统用户" : "normal 普通用户",
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function platformAdminStatusLabel(admin: PlatformAdminRecord) {
  const labels: Record<PlatformAdminStatusCode, string> = {
    active: "启用",
    disabled: "停用",
    locked: "锁定",
    pending: "待激活",
    suspended: "暂停",
  };
  return labels[platformAdminStatusCode(admin)];
}

function platformAdminStatusIcon(admin: PlatformAdminRecord) {
  const statusCode = platformAdminStatusCode(admin);
  if (statusCode === "active") return "check";
  if (statusCode === "pending") return "clock";
  return "x";
}

/** 平台用户态 → 语气。pending 是蓝（brand）：待激活不是异常，只是还没开始。 */
function platformAdminStatusTone(admin: PlatformAdminRecord): StatusBadgeTone {
  const statusCode = platformAdminStatusCode(admin);
  if (statusCode === "active") return "success";
  if (statusCode === "pending") return "brand";
  if (statusCode === "locked" || statusCode === "suspended") return "warning";
  return "neutral";
}

function PlatformUserActionsMenu({
  admin,
  onView,
  onChangeRole,
  onEditMetadata,
  onToggleStatus,
  onForceLogout,
  onResetMfa,
  onResetPassword,
}: {
  admin: PlatformAdminRecord;
  onView: (admin: PlatformAdminRecord) => void;
  onChangeRole: (admin: PlatformAdminRecord) => void;
  onEditMetadata: (admin: PlatformAdminRecord) => void;
  onToggleStatus: (admin: PlatformAdminRecord) => void;
  onForceLogout: (admin: PlatformAdminRecord) => void;
  onResetMfa: (admin: PlatformAdminRecord) => void;
  onResetPassword: (admin: PlatformAdminRecord) => void;
}) {
  const tShared = useTranslations();
  // TD-017 分级模型：canManage=false（目标 rank ≥ 自身）时管理项禁用；
  // 后端三层门控无论如何都会拒绝，这里只是显示层一致性。
  const managed = admin.canManage !== false;
  return (
    <div
      className="relative z-[1] inline-flex justify-self-end"
      onClick={(event) => event.stopPropagation()}
    >
      <ActionMenu
        label={`${admin.displayName} 操作`}
        items={[
          {
            id: "profile",
            label: tShared("actions.viewDetail"),
            icon: "user",
            onSelect: () => onView(admin),
          },
          {
            id: "role",
            label: "调整角色",
            icon: "shield-check",
            disabled: !managed,
            onSelect: () => onChangeRole(admin),
          },
          {
            id: "metadata",
            label: "编辑资料",
            icon: "edit",
            disabled: !managed,
            onSelect: () => onEditMetadata(admin),
          },
          {
            id: "toggle-status",
            label:
              platformAdminStatusCode(admin) === "active"
                ? "停用用户"
                : "启用用户",
            icon: platformAdminStatusCode(admin) === "active" ? "x" : "check",
            // B9-P1b-α：经 IdP 委托停用/启用（+ 停用即吊销会话）。
            disabled: !managed,
            onSelect: () => onToggleStatus(admin),
          },
          {
            id: "force-logout",
            label: "强制下线",
            icon: "clock",
            // B9-P1b-α：经 IdP 委托吊销该用户全部会话。
            disabled: !managed,
            onSelect: () => onForceLogout(admin),
          },
          {
            id: "mfa-reset",
            label: "重置 MFA",
            icon: "shield-check",
            // B9-P1b-α：经 IdP 委托清除已登记的第二因子（保留策略，下次登录重登记）+ 吊销会话。
            disabled: !managed,
            onSelect: () => onResetMfa(admin),
          },
          {
            id: "reset-password",
            label: "重置密码",
            icon: "key",
            // B9-P1b-β/TD-017：经 IdP 生成一次性重置链接并带外投递至目标本人邮箱，发起方不接触链接。
            disabled: !managed,
            onSelect: () => onResetPassword(admin),
          },
        ]}
      />
    </div>
  );
}

/**
 * 状态标走 `StatusBadge`，语气由 `platformAdminStatusTone` / `platformRoleStatusTone` 给。
 */
function usePlatformUserColumns(
  t: ReturnType<typeof useTranslations>,
): DataTableColumn<PlatformAdminRecord>[] {
  const locale = useLocale();
  const tShared = useTranslations();
  return [
    {
      id: "user",
      header: "用户",
      cell: (admin) => (
        <TableTitleCell
          icon="user"
          title={admin.displayName || admin.username}
          titleSuffix={admin.isSystem ? <Badge>系统</Badge> : null}
          description={admin.username ? `@${admin.username}` : EMPTY_MARK}
        />
      ),
    },
    {
      id: "status",
      header: tShared("columns.state"),
      align: "center",
      cell: (admin) => (
        <StatusBadge
          tone={platformAdminStatusTone(admin)}
          icon={platformAdminStatusIcon(admin)}
        >
          {platformAdminStatusLabel(admin)}
        </StatusBadge>
      ),
    },
    {
      id: "role",
      header: "角色",
      align: "center",
      cell: (admin) => (
        <TableTitleCell
          title={platformRoleDisplayName(admin, t)}
          titleSuffix={
            <StatusBadge tone={platformRoleStatusTone(admin)}>
              {platformRoleStatusLabel(admin)}
            </StatusBadge>
          }
        />
      ),
    },
    {
      id: "login",
      header: "最后登录",
      cell: (admin) => (
        <TableTitleCell
          title={
            admin.lastLoginAt
              ? formatDate(admin.lastLoginAt, locale)
              : EMPTY_MARK
          }
          description={admin.lastLoginIp || EMPTY_MARK}
        />
      ),
    },
    {
      id: "contact",
      header: "联系方式",
      cell: (admin) => (
        <TableTitleCell
          title={admin.email || EMPTY_MARK}
          description={admin.phone || EMPTY_MARK}
        />
      ),
    },
  ];
}

function PlatformUsersCards({
  admins,
  t,
}: {
  admins: PlatformAdminRecord[];
  t: ReturnType<typeof useTranslations>;
}) {
  const locale = useLocale();
  return (
    <ListCardGrid aria-label="平台用户卡片">
      {admins.map((admin) => (
        <MetricListCard
          key={admin.id}
          icon="user"
          title={admin.displayName || admin.username}
          description={admin.username ? `@${admin.username}` : EMPTY_MARK}
          tone={platformAdminStatusTone(admin)}
          actions={
            <StatusBadge
              tone={platformAdminStatusTone(admin)}
              icon={platformAdminStatusIcon(admin)}
            >
              {platformAdminStatusLabel(admin)}
            </StatusBadge>
          }
          badges={
            <>
              <Badge>{platformRoleDisplayName(admin, t)}</Badge>
              <StatusBadge tone={platformRoleStatusTone(admin)}>
                {platformRoleStatusLabel(admin)}
              </StatusBadge>
              {admin.isSystem ? <Badge>系统</Badge> : null}
            </>
          }
          metrics={[
            {
              key: "lastLogin",
              value: admin.lastLoginAt
                ? formatDate(admin.lastLoginAt, locale)
                : EMPTY_MARK,
              label: "最后登录",
            },
            {
              key: "loginIp",
              value: admin.lastLoginIp || EMPTY_MARK,
              label: "登录 IP",
            },
            {
              key: "contact",
              value: admin.email || admin.phone || EMPTY_MARK,
              label: "联系方式",
            },
          ]}
          footer={
            <>
              <span>{admin.remark || EMPTY_MARK}</span>
              <strong>{admin.phone || EMPTY_MARK}</strong>
            </>
          }
        />
      ))}
    </ListCardGrid>
  );
}

interface MetadataFormState {
  displayName: string;
  email: string;
  phone: string;
  remark: string;
  sort: string;
}

function parseSort(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function PlatformUserDetailDialog({
  admin,
  roleLabel,
  onClose,
}: {
  admin: PlatformAdminRecord;
  roleLabel: string;
  onClose: () => void;
}) {
  const locale = useLocale();
  const tShared = useTranslations();
  return (
    /* 这是只读详情，不是表单：DialogForm 现在固定渲染「取消 + 提交」两个按钮，
     * 原来的 `footer` 逃生口随之取消。只读浮层直接用 Dialog 原语组装。 */
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-panel-md">
        <DialogHeader>
          <DialogTitle>{admin.displayName || admin.username}</DialogTitle>
          {admin.username ? (
            <DialogDescription>{`@${admin.username}`}</DialogDescription>
          ) : null}
        </DialogHeader>
        <dl className="grid grid-cols-1 gap-x-md gap-y-sm sm:grid-cols-2 ">
          <div>
            <dt>显示名</dt>
            <dd>{admin.displayName || EMPTY_MARK}</dd>
          </div>
          <div>
            <dt>用户名</dt>
            <dd>{admin.username || EMPTY_MARK}</dd>
          </div>
          <div>
            <dt>角色</dt>
            <dd>{roleLabel}</dd>
          </div>
          <div>
            <dt>{tShared("columns.state")}</dt>
            <dd>{platformAdminStatusLabel(admin)}</dd>
          </div>
          <div>
            <dt>邮箱</dt>
            <dd>{admin.email || EMPTY_MARK}</dd>
          </div>
          <div>
            <dt>手机</dt>
            <dd>{admin.phone || EMPTY_MARK}</dd>
          </div>
          <div>
            <dt>最后登录</dt>
            <dd>
              {admin.lastLoginAt
                ? formatDate(admin.lastLoginAt, locale)
                : EMPTY_MARK}
            </dd>
          </div>
          <div>
            <dt>登录 IP</dt>
            <dd>{admin.lastLoginIp || EMPTY_MARK}</dd>
          </div>
          <div>
            <dt>排序</dt>
            <dd>{formatNumber(admin.sort)}</dd>
          </div>
          <div>
            <dt>创建时间</dt>
            <dd>
              {admin.createdAt
                ? formatDate(admin.createdAt, locale)
                : EMPTY_MARK}
            </dd>
          </div>
          <div className="sm:col-span-2 ">
            <dt>备注</dt>
            <dd>{admin.remark || EMPTY_MARK}</dd>
          </div>
        </dl>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PlatformUserRoleDialog({
  admin,
  roles,
  value,
  submitting,
  onChange,
  onClose,
  onSubmit,
}: {
  admin: PlatformAdminRecord;
  roles: PlatformRoleRecord[];
  value: string;
  submitting: boolean;
  onChange: (roleId: string) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <DialogForm
      open
      title="调整角色"
      description={`为 ${admin.displayName || admin.username} 分配平台角色。`}
      submitLabel="保存角色"
      submitting={submitting}
      submitDisabled={!value || value === admin.roleId}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      onSubmit={onSubmit}
    >
      <Label>
        平台角色
        <NativeSelect
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          {roles.length === 0 ? (
            <option value="">未加载到可用角色</option>
          ) : null}
          {roles.map((role) => (
            <option key={role.id} value={role.id}>
              {role.nameEn || role.roleCode}
            </option>
          ))}
        </NativeSelect>
      </Label>
    </DialogForm>
  );
}

interface CreateAdminFormState {
  username: string;
  displayName: string;
  email: string;
  phone: string;
  roleId: string;
}

function PlatformUserCreateDialog({
  roles,
  form,
  submitting,
  onChange,
  onClose,
  onSubmit,
}: {
  roles: PlatformRoleRecord[];
  form: CreateAdminFormState;
  submitting: boolean;
  onChange: (patch: Partial<CreateAdminFormState>) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const tShared = useTranslations();
  const canSubmit =
    form.username.trim() &&
    form.displayName.trim() &&
    form.email.trim() &&
    form.roleId;
  return (
    <DialogForm
      open
      title="新建运营用户"
      description="创建后系统会向该邮箱发送初始设置密码邮件，运营方不接触明文密码或链接。"
      submitLabel={tShared("actions.create")}
      submitting={submitting}
      submitDisabled={!canSubmit}
      onOpenChange={(open) => {
        if (!open && !submitting) onClose();
      }}
      onSubmit={onSubmit}
    >
      <Label>
        用户名
        <Input
          value={form.username}
          onChange={(e) => onChange({ username: e.target.value })}
          autoComplete="off"
        />
      </Label>
      <Label>
        显示名
        <Input
          value={form.displayName}
          onChange={(e) => onChange({ displayName: e.target.value })}
        />
      </Label>
      <Label>
        邮箱（初始设置密码邮件将发送至此）
        <Input
          type="email"
          value={form.email}
          onChange={(e) => onChange({ email: e.target.value })}
          autoComplete="off"
        />
      </Label>
      <Label>
        手机号（可选）
        <Input
          value={form.phone}
          onChange={(e) => onChange({ phone: e.target.value })}
          autoComplete="off"
        />
      </Label>
      <Label>
        平台角色
        <NativeSelect
          value={form.roleId}
          onChange={(e) => onChange({ roleId: e.target.value })}
        >
          <option value="">选择角色</option>
          {roles.map((role) => (
            <option key={role.id} value={role.id}>
              {role.nameEn || role.roleCode}
            </option>
          ))}
        </NativeSelect>
      </Label>
    </DialogForm>
  );
}

function PlatformUserMetadataDialog({
  admin,
  form,
  submitting,
  onChange,
  onClose,
  onSubmit,
}: {
  admin: PlatformAdminRecord;
  form: MetadataFormState;
  submitting: boolean;
  onChange: (patch: Partial<MetadataFormState>) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <DialogForm
      open
      title="编辑资料"
      description={`维护 ${admin.displayName || admin.username} 的展示信息与联系方式。`}
      submitLabel="保存资料"
      submitting={submitting}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      onSubmit={onSubmit}
    >
      <div>
        <Label>
          显示名
          <Input
            value={form.displayName}
            maxLength={128}
            onChange={(event) => onChange({ displayName: event.target.value })}
            placeholder="显示名"
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
      <div>
        <Label>
          邮箱
          <Input
            type="email"
            value={form.email}
            onChange={(event) => onChange({ email: event.target.value })}
            placeholder="邮箱地址"
          />
        </Label>
        <Label>
          手机
          <Input
            value={form.phone}
            onChange={(event) => onChange({ phone: event.target.value })}
            placeholder="手机号"
          />
        </Label>
      </div>
      <Label>
        备注
        <Textarea
          value={form.remark}
          onChange={(event) => onChange({ remark: event.target.value })}
          placeholder="内部备注"
          rows={3}
        />
      </Label>
    </DialogForm>
  );
}

export function PlatformUsersPage() {
  const tShared = useTranslations();
  const t = useTranslations();
  const { toast } = useToast();
  const { runWithStepUp } = useStepUp();
  const [resetInfo, setResetInfo] = useState<{
    deliveredTo: string;
    minutes: number;
  } | null>(null);
  const [admins, setAdmins] = useState<PlatformAdminRecord[]>([]);
  const [roles, setRoles] = useState<PlatformRoleRecord[]>([]);
  const [actorRank, setActorRank] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [typeFilter, setTypeFilter] = useState<UserTypeFilter>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(20);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [detailAdminId, setDetailAdminId] = useState<string | null>(null);
  const [roleAdminId, setRoleAdminId] = useState<string | null>(null);
  const [roleValue, setRoleValue] = useState("");
  const [metadataAdminId, setMetadataAdminId] = useState<string | null>(null);
  const [metadataForm, setMetadataForm] = useState<MetadataFormState>({
    displayName: "",
    email: "",
    phone: "",
    remark: "",
    sort: "",
  });
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreateAdminFormState>({
    username: "",
    displayName: "",
    email: "",
    phone: "",
    roleId: "",
  });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    fetchPlatformAdmins()
      .then((records) => {
        if (active) setAdmins(records);
      })
      .catch((error) => {
        if (active)
          setLoadError(
            error instanceof Error ? error.message : "平台用户数据库读取失败",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    fetchPlatformRoles()
      .then((records) => {
        if (active) setRoles(records);
      })
      .catch(() => {
        // 角色下拉为可选增强，读取失败时保持空列表，不阻塞用户列表。
      });
    // TD-017：取当前操作者 rank，用于角色下拉过滤（只可授予低于自身层级的角色）。
    fetchCurrentUser()
      .then((user) => {
        if (active) setActorRank(user?.roleRank ?? null);
      })
      .catch(() => {
        // rank 读取失败时不过滤（后端双 rank 门控仍会拒绝越级授予）。
      });
    return () => {
      active = false;
    };
  }, []);

  // 可授予角色 = rank 严格低于自身（TD-017 双 rank 门控的显示层一致性）。
  const assignableRoles =
    actorRank == null ? roles : roles.filter((role) => role.rank < actorRank);

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

  const platformUserColumns = usePlatformUserColumns(t);

  const filteredAdmins = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return admins.filter((admin) => {
      if (
        statusFilter !== "all" &&
        platformAdminStatusCode(admin) !== statusFilter
      )
        return false;
      if (typeFilter === "system" && !admin.isSystem) return false;
      if (typeFilter === "normal" && admin.isSystem) return false;
      if (
        normalizedQuery &&
        !platformAdminSearchText(admin).includes(normalizedQuery)
      )
        return false;
      return true;
    });
  }, [admins, query, statusFilter, typeFilter]);

  const enabledCount = admins.filter(
    (admin) => platformAdminStatusCode(admin) === "active",
  ).length;
  const systemCount = admins.filter((admin) => admin.isSystem).length;
  const disabledCount = admins.filter(
    (admin) => platformAdminStatusCode(admin) === "disabled",
  ).length;
  const lockedCount = admins.filter(
    (admin) => platformAdminStatusCode(admin) === "locked",
  ).length;
  const pendingCount = admins.filter(
    (admin) => platformAdminStatusCode(admin) === "pending",
  ).length;
  const suspendedCount = admins.filter(
    (admin) => platformAdminStatusCode(admin) === "suspended",
  ).length;
  const otherUserCount =
    disabledCount + lockedCount + pendingCount + suspendedCount;
  const pageCount = Math.max(1, Math.ceil(filteredAdmins.length / pageSize));
  const clampedCurrentPage = Math.min(currentPage, pageCount);
  const visibleAdmins = filteredAdmins.slice(
    (clampedCurrentPage - 1) * pageSize,
    clampedCurrentPage * pageSize,
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [pageSize, query, statusFilter, typeFilter, viewMode]);

  function resetFilters() {
    setQuery("");
    setStatusFilter("all");
    setTypeFilter("all");
  }

  const detailAdmin = detailAdminId
    ? (admins.find((admin) => admin.id === detailAdminId) ?? null)
    : null;
  const roleAdmin = roleAdminId
    ? (admins.find((admin) => admin.id === roleAdminId) ?? null)
    : null;
  const metadataAdmin = metadataAdminId
    ? (admins.find((admin) => admin.id === metadataAdminId) ?? null)
    : null;

  function openRoleDialog(admin: PlatformAdminRecord) {
    setRoleValue(admin.roleId);
    setRoleAdminId(admin.id);
  }

  function openCreateDialog() {
    setCreateForm({
      username: "",
      displayName: "",
      email: "",
      phone: "",
      roleId: "",
    });
    setCreateOpen(true);
  }

  function openMetadataDialog(admin: PlatformAdminRecord) {
    setMetadataForm({
      displayName: admin.displayName ?? "",
      email: admin.email ?? "",
      phone: admin.phone ?? "",
      remark: admin.remark ?? "",
      sort: String(admin.sort ?? ""),
    });
    setMetadataAdminId(admin.id);
  }

  async function submitRoleChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!roleAdmin || !roleValue || roleValue === roleAdmin.roleId) return;
    setSubmitting(true);
    try {
      const updated = await runWithStepUp(() =>
        changePlatformAdminRole(roleAdmin.id, roleValue),
      );
      setAdmins((current) =>
        current.map((admin) => (admin.id === updated.id ? updated : admin)),
      );
      setRoleAdminId(null);
      toast({ tone: "success", title: "已调整角色" });
    } catch (error) {
      reportError("角色调整失败", error);
    } finally {
      setSubmitting(false);
    }
  }

  // B9-P1b-α：停用/启用经 IdP 委托（停用即吊销全部会话），返回刷新后的记录就地更新。
  async function handleToggleStatus(admin: PlatformAdminRecord) {
    const disabling = platformAdminStatusCode(admin) === "active";
    try {
      const updated = await runWithStepUp(() =>
        disabling
          ? disablePlatformAdmin(admin.id)
          : enablePlatformAdmin(admin.id),
      );
      setAdmins((current) =>
        current.map((row) => (row.id === updated.id ? updated : row)),
      );
      toast({
        tone: "success",
        title: disabling ? "已停用用户" : "已启用用户",
      });
    } catch (error) {
      reportError(disabling ? "停用用户失败" : "启用用户失败", error);
    }
  }

  async function handleForceLogout(admin: PlatformAdminRecord) {
    try {
      const result = await runWithStepUp(() =>
        forcePlatformAdminLogout(admin.id),
      );
      toast({
        tone: "success",
        title: "已强制下线",
        description: `已吊销 ${result.revoked} 个会话。`,
      });
    } catch (error) {
      reportError("强制下线失败", error);
    }
  }

  async function handleResetMfa(admin: PlatformAdminRecord) {
    try {
      const result = await runWithStepUp(() => resetPlatformAdminMfa(admin.id));
      toast({
        tone: "success",
        title: "已重置 MFA",
        description: `已清除第二因子并吊销 ${result.revoked} 个会话，用户下次登录需重新登记。`,
      });
    } catch (error) {
      reportError("重置 MFA 失败", error);
    }
  }

  async function handleResetPassword(admin: PlatformAdminRecord) {
    try {
      const result = await runWithStepUp(() =>
        resetPlatformAdminPassword(admin.id),
      );
      setResetInfo({
        deliveredTo: result.deliveredTo,
        minutes: Math.max(1, Math.round(result.expiresIn / 60)),
      });
    } catch (error) {
      reportError("发送重置邮件失败", error);
    }
  }

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const username = createForm.username.trim();
    const displayName = createForm.displayName.trim();
    const email = createForm.email.trim();
    const phone = createForm.phone.trim();
    const roleId = createForm.roleId;
    if (!username || !displayName || !email || !roleId) return;
    setSubmitting(true);
    try {
      const result = await runWithStepUp(() =>
        createPlatformAdmin({
          username,
          displayName,
          email,
          ...(phone ? { phone } : {}),
          roleId,
        }),
      );
      setAdmins((current) => [...current, result.record]);
      setCreateOpen(false);
      toast({
        tone: "success",
        title: "已创建用户",
        description: `初始设置密码邮件已发送至 ${result.deliveredTo}。`,
      });
    } catch (error) {
      reportError("创建用户失败", error);
    } finally {
      setSubmitting(false);
    }
  }

  async function submitMetadata(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!metadataAdmin) return;
    const displayName = metadataForm.displayName.trim();
    const email = metadataForm.email.trim();
    const phone = metadataForm.phone.trim();
    const remark = metadataForm.remark.trim();
    const sort = parseSort(metadataForm.sort);
    const payload: PlatformAdminMetadataInput = {
      ...(displayName ? { displayName } : {}),
      ...(email ? { email } : {}),
      ...(phone ? { phone } : {}),
      ...(remark ? { remark } : {}),
      ...(sort !== undefined ? { sort } : {}),
    };
    setSubmitting(true);
    try {
      const updated = await runWithStepUp(() =>
        updatePlatformAdmin(metadataAdmin.id, payload),
      );
      setAdmins((current) =>
        current.map((admin) => (admin.id === updated.id ? updated : admin)),
      );
      setMetadataAdminId(null);
      toast({ tone: "success", title: "资料已更新" });
    } catch (error) {
      reportError("资料更新失败", error);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <ListPageTemplate
        className="w-full "
        header={
          <PageHeader
            icon="user"
            eyebrow="身份权限"
            title="平台用户"
            description="管理平台内部管理员、运营人员和运维人员；平台用户不归属于任何租户。"
          />
        }
        summary={
          <>
            {" "}
            <MetricGrid
              loading={loading}
              aria-label="平台用户统计"
              columns={3}
              items={[
                {
                  id: "total",
                  help: "平台管理员账号总数，含停用与锁定的。",
                  icon: "user",
                  label: "用户总数",
                  value: formatNumber(admins.length),
                  tags: [`系统用户 ${formatNumber(systemCount)}人`],
                  // 身份类图标原本走 `--identity-icon` 修饰去色：这张是基数不是状态。
                  tone: "neutral",
                },
                {
                  id: "enabled",
                  help: "状态为启用、可登录的管理员。",
                  icon: "check",
                  label: "启用用户",
                  value: formatNumber(enabledCount),
                  tags: ["可登录"],
                  tone: "success",
                },
                {
                  id: "other",
                  help: "停用、锁定、待激活、暂停之和。",
                  icon: "x",
                  label: "其他用户",
                  value: formatNumber(otherUserCount),
                  tags: [
                    ...(disabledCount
                      ? [`停用 ${formatNumber(disabledCount)}`]
                      : []),
                    ...(lockedCount
                      ? [`锁定 ${formatNumber(lockedCount)}`]
                      : []),
                    ...(pendingCount
                      ? [`待激活 ${formatNumber(pendingCount)}`]
                      : []),
                    ...(suspendedCount
                      ? [`暂停 ${formatNumber(suspendedCount)}`]
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
            count={formatNumber(filteredAdmins.length)}
            aria-label="平台用户筛选"
            search={
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索用户名、显示名、邮箱、手机、角色"
                className="grow basis-media-3xl max-w-panel-sm"
                aria-label="搜索平台用户"
              />
            }
            onReset={resetFilters}
            actions={
              <>
                <ActionButton
                  variant="outline"
                  icon="plus"
                  onClick={openCreateDialog}
                >
                  新建用户
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
                aria-label="用户状态"
              >
                <option value="all">{tShared("filters.allStates")}</option>
                <option value="active">{tShared("actions.enable")}</option>
                <option value="disabled">{tShared("actions.disable")}</option>
                <option value="locked">锁定</option>
                <option value="pending">待激活</option>
                <option value="suspended">{tShared("actions.pause")}</option>
              </NativeSelect>
              <NativeSelect
                className="w-fit basis-media-xl"
                value={typeFilter}
                onChange={(event) =>
                  setTypeFilter(event.target.value as UserTypeFilter)
                }
                aria-label="用户类型"
              >
                <option value="all">{tShared("filters.allKinds")}</option>
                <option value="system">系统用户</option>
                <option value="normal">普通用户</option>
              </NativeSelect>
            </>
          </FilterBar>
        }
        table={
          <section
            className="grid min-w-0 max-w-full gap-xs"
            aria-label="平台用户清单"
          >
            {/* 列表态的加载由 DataTable 出骨架行，卡片态没有骨架，仍留这行提示。 */}
            {loading && viewMode === "cards" ? (
              <header className="flex min-h-0 items-center justify-end gap-sm text-body-sm font-normal text-muted-foreground">
                <span>{tShared("common.loading")}</span>
              </header>
            ) : null}

            {viewMode === "list" ? (
              <DataTable
                columns={platformUserColumns}
                rows={visibleAdmins}
                rowKey={(admin) => admin.id}
                loading={loading}
                indexStart={(clampedCurrentPage - 1) * pageSize + 1}
                selectedKeys={[...selectedIds]}
                onSelectionChange={(keys) => setSelectedIds(new Set(keys))}
                rowActions={(admin) => (
                  <PlatformUserActionsMenu
                    admin={admin}
                    onView={(target) => setDetailAdminId(target.id)}
                    onChangeRole={openRoleDialog}
                    onEditMetadata={openMetadataDialog}
                    onToggleStatus={handleToggleStatus}
                    onForceLogout={handleForceLogout}
                    onResetMfa={handleResetMfa}
                    onResetPassword={handleResetPassword}
                  />
                )}
                empty={
                  <EmptyState
                    title={
                      loadError ? "平台用户读取失败" : "没有匹配的平台用户"
                    }
                    description={
                      loadError ?? "清空筛选条件后可查看全部平台用户。"
                    }
                    action={
                      <ActionButton
                        variant="outline"
                        icon="x"
                        onClick={resetFilters}
                      >
                        {tShared("common.clearFilters")}
                      </ActionButton>
                    }
                  />
                }
              />
            ) : filteredAdmins.length ? (
              <PlatformUsersCards admins={visibleAdmins} t={t} />
            ) : (
              <EmptyState
                title={
                  loading
                    ? "正在加载平台用户"
                    : loadError
                      ? "平台用户读取失败"
                      : "没有匹配的平台用户"
                }
                description={
                  loading
                    ? "正在读取平台用户账号。"
                    : (loadError ?? "清空筛选条件后可查看全部平台用户。")
                }
                action={
                  <ActionButton
                    variant="outline"
                    icon="x"
                    onClick={resetFilters}
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
            currentPage={clampedCurrentPage}
            pageCount={pageCount}
            total={filteredAdmins.length}
            pageSize={pageSize}
            onPageSizeChange={setPageSize}
            onPageChange={(page) =>
              setCurrentPage(Math.min(Math.max(page, 1), pageCount))
            }
          />
        }
      />
      {detailAdmin ? (
        <PlatformUserDetailDialog
          admin={detailAdmin}
          roleLabel={platformRoleDisplayName(detailAdmin, t)}
          onClose={() => setDetailAdminId(null)}
        />
      ) : null}
      {createOpen ? (
        <PlatformUserCreateDialog
          roles={assignableRoles}
          form={createForm}
          submitting={submitting}
          onChange={(patch) =>
            setCreateForm((current) => ({ ...current, ...patch }))
          }
          onClose={() => setCreateOpen(false)}
          onSubmit={(event) => void submitCreate(event)}
        />
      ) : null}
      {roleAdmin ? (
        <PlatformUserRoleDialog
          admin={roleAdmin}
          roles={assignableRoles}
          value={roleValue}
          submitting={submitting}
          onChange={setRoleValue}
          onClose={() => {
            if (!submitting) setRoleAdminId(null);
          }}
          onSubmit={(event) => void submitRoleChange(event)}
        />
      ) : null}
      {metadataAdmin ? (
        <PlatformUserMetadataDialog
          admin={metadataAdmin}
          form={metadataForm}
          submitting={submitting}
          onChange={(patch) =>
            setMetadataForm((current) => ({ ...current, ...patch }))
          }
          onClose={() => {
            if (!submitting) setMetadataAdminId(null);
          }}
          onSubmit={(event) => void submitMetadata(event)}
        />
      ) : null}
      {resetInfo ? (
        <DialogForm
          open
          title="重置链接已发送"
          // TD-017 带外投递：链接只发给目标本人邮箱，发起方不接触链接/明文。
          description={`一次性重置链接已发送至 ${resetInfo.deliveredTo}（${resetInfo.minutes} 分钟内有效，用后失效）。用户点击邮件内链接自行设置新密码；该用户会话已被吊销。`}
          submitLabel="知道了"
          onOpenChange={(open) => {
            if (!open) setResetInfo(null);
          }}
          onSubmit={(event) => {
            event.preventDefault();
            setResetInfo(null);
          }}
        />
      ) : null}
    </>
  );
}
