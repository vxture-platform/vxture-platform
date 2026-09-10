"use client";

/**
 * MembersPage.tsx — 成员管理(批 2 收口;批 9 收编邀请记录与角色管理)。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * 批 9(owner 2026-09-06):租户侧最终只留「我的账号 / 租户信息 / 成员管理」三个板块,
 * 原「成员与权限」分组撤销。本页是成员管理的主页 = 成员目录(在册成员 + 待接受的
 * 邀请行,id = 邀请 id),另外两块收成它的**二级页**,入口在页头右侧:
 *   · `/members/invitations` 邀请记录 —— 发出过的全部邀请台账(持 member.manage);
 *   · `/members/roles`       角色管理 —— 平台统一定义、租户不可自定义,只读;
 *   · `/members/permissions` 权限管理 —— 权限目录与角色矩阵,同样只读。
 *
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
  Field,
  SegmentedControl,
  FieldLabel,
  FilterBar,
  Icon,
  Input,
  InputGroup,
  InputGroupAddon,
  Badge,
  InputGroupInput,
  ListCard,
  ListCardGrid,
  ListPageTemplate,
  NativeSelect,
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
  fetchSwitchableWorkspaces,
  lookupUserByNo,
  type UserLookupResult,
  resendInvitation,
  resetMemberPassword,
  revokeInvitation,
  unlinkMember,
  updateMember,
  type InviteMemberResult,
} from "@/api/console-bff";
import type { MemberRecord, TenantRoleRecord } from "@/entities/console";
import { useTranslations } from "next-intl";
import { useTableLabels } from "@/lib/table";
import { useTableSort } from "@/lib/table-sort";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import { formatTenantDisplay } from "@/features/tenant/tenant-display";
import {
  normalizePrincipalNoInput,
  principalPrefix,
  validatePrincipalNo,
} from "@/lib/principal-no";
import { hasCapability } from "@/features/permissions/can";
import { useConfirmLabels } from "@/lib/destructive";
import { useRouter } from "@/lib/i18n/navigation";
import { ListPagination } from "@/components/pagination";
import { RoleTag } from "@/components/role-tag";
import {
  LoadFailedBanner,
  LoadFailedEmpty,
} from "@/components/load/LoadFailed";
import { useDateFormat } from "@/lib/use-date-format";
import { InviteLinkDialog } from "./components/InviteLinkDialog";
import { MemberWorkspacesDialog } from "./components/MemberWorkspacesDialog";

/** 输入框里固定前置的用户号前缀。与展示端同源——改前缀时这里跟着变。 */
const USER_NO_PREFIX = principalPrefix("user");

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
  const { fmtDate, fmtTime } = useDateFormat();

  const t = useTranslations("membersPage");
  const tableLabels = useTableLabels();
  const withLabels = useConfirmLabels();
  const router = useRouter();
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
  /** 正在管谁的工作空间归属;null = 对话框不开。 */
  const [workspacesFor, setWorkspacesFor] = useState<MemberRecord | null>(null);
  const [inviteResult, setInviteResult] = useState<{
    result: InviteMemberResult;
    resent: boolean;
  } | null>(null);
  /* 邀请通道(owner 2026-09-09)。「加成员」只走邮箱(那条路径要求对方已有账号,
     按邮箱找得到人);「邀请」才有两条通道可选。 */
  /** 邀请进哪个工作空间(必选)。「加成员」不问这个。 */
  const [inviteWorkspaces, setInviteWorkspaces] = useState<
    { id: string; name: string; isDefault: boolean }[]
  >([]);
  /** 按用户号查到的人;null = 还没查。查过才允许提交,防止邀错人。 */
  const [lookup, setLookup] = useState<UserLookupResult | null>(null);
  const [lookingUp, setLookingUp] = useState(false);

  const [memberForm, setMemberForm] = useState({
    email: "",
    userNo: "",
    /** 邀请进哪个工作空间(必选,owner 2026-09-10)。 */
    workspaceId: "",
    channel: "email" as "email" | "user_no",
    roleId: "",
  });
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
      userNo: "",
      workspaceId: "",
      /* 每次开对话框都回到邮箱通道:上一次选了用户号不该粘住,
         下一个人多半是要发邮件的。 */
      channel: "email",
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

    // The backend reads `roleCode`; the role catalog sets id === roleCode.
    const roleCode = memberForm.roleId || null;

    /* 邀请的三条前置(owner 2026-09-10)。服务端也判——这里挡是为了不让人
       填完一屏才收到一句 400,不是把服务端那道省掉。 */
    if (createMode === "invite") {
      if (!memberForm.workspaceId) {
        setDialogError(t("errors.workspace_required"));
        setSubmitting(false);
        return;
      }
      if (!roleCode) {
        setDialogError(t("errors.role_required"));
        setSubmitting(false);
        return;
      }
      /* 号形先判:形不对时根本查不了,报「还没查」会把人指向错的方向。 */
      if (memberForm.channel === "user_no") {
        const problem = validatePrincipalNo(memberForm.userNo, "user");
        if (problem) {
          setDialogError(t(`dialogs.userNoError.${problem}`));
          setSubmitting(false);
          return;
        }
      }
      /* 用户号通道:**查过并确认是这个人**才让提交。这一条服务端不判(它只知道号
         存不存在),但它正是 owner 要这个查询的理由——防止邀错人。 */
      if (memberForm.channel === "user_no" && !lookup?.found) {
        setDialogError(t("errors.lookup_required"));
        setSubmitting(false);
        return;
      }
      if (memberForm.channel === "user_no" && lookup?.alreadyMember) {
        setDialogError(t("errors.already_member"));
        setSubmitting(false);
        return;
      }
    }

    try {
      if (createMode === "invite") {
        /* 按通道只给该给的那一项:两个都给会让后端的分叉判据(给了哪一个)变成
           「都给了怎么办」,那是个不必要的歧义。 */
        const result = await inviteMember(
          memberForm.channel === "user_no"
            ? {
                userNo: memberForm.userNo.trim(),
                roleCode,
                workspaceId: memberForm.workspaceId,
              }
            : {
                email: memberForm.email,
                roleCode,
                workspaceId: memberForm.workspaceId,
              },
        );
        await reloadMembers(result.member.id);
        setCreateMode(null);
        resetMemberForm();
        setInviteResult({ result, resent: false });
        /* 三种收尾各说各的:站内邀请没有邮件也没有链接,套用「邮件没发出去」
           会让人以为出了错——它恰恰是这条通道的正常结果。 */
        setMessage(
          result.deliveredInApp
            ? t("feedback.inviteSentInApp")
            : result.emailSent
              ? t("feedback.inviteSuccess")
              : t("feedback.inviteNoEmail"),
        );
      } else {
        /* 「加成员」只有邮箱一条路:它要求对方已是平台用户且按邮箱找得到。 */
        const created = await createMember({
          email: memberForm.email,
          roleCode,
        });
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
  /* 初始档给定值:console 的分页档位是 10/20/50/100(没有 DS 默认的 "auto" 自适应
     档),而 `useListPagination` 的默认初值正是 "auto"——不给,分段控件一格都选不中。 */
  /* 排序在分页之前。默认序（后端给的）在没有生效排序时原样保留。 */
  const sortAccessors = useMemo(
    () => ({
      name: (m: MemberRecord) => m.name,
    }),
    [],
  );
  const {
    sort,
    onSortChange,
    rows: sortedMembers,
  } = useTableSort(filtered, sortAccessors);
  const pager = useListPagination(sortedMembers, 20);
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
            {/* 与 DS `TableTitleCell` 的主信息同一档:`label-md` + `font-semibold`
                (默认全局字号下 14px 加粗)。本列**用不了那个件**——它的前置槽只收
                `icon?: IconName`,收不了 `UserAvatar` 这样的节点,而全平台只有这一张
                表是头像打头,不值得为一个调用点给 DS 开一个 `leading` 槽。代价是这两行
                的字号得手工跟着件走;件改了这里要跟。 */}
            <span className="truncate text-label-md font-semibold text-foreground">
              {member.name}
            </span>
            {/* 「主管理员」与角色列的「所有者」是**两件事,不要统一**(owner
                2026-09-06 裁定):角色说的是**角色定义**(这个人被授予了哪一档治理
                权限),这一枚标说的是**隶属与管理关系**(这个租户的主管理员是谁)。
                同一个人身上两个词看着像漂移,其实各答各的问题。 */}
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

  /** 卡片视图的一行文字版(卡片 meta 是一行内联文本,放不下主辅两行)。 */
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

  /**
   * 表格版:日期主、时刻辅(owner 2026-09-06)。同一列里两种含义——在册成员是
   * 加入时间,待接受的邀请是有效期至——主行各自说清是哪种,辅行只给时刻。
   */
  function memberTimelineCell(member: MemberRecord) {
    const at =
      member.status === "Invited"
        ? member.invitationExpiresAt
        : member.joinedAt;
    if (!at) return <span className="text-muted-foreground">—</span>;
    return (
      <span className="flex flex-col items-center gap-2xs">
        <span className="tabular-nums text-foreground">
          {member.status === "Invited"
            ? t("table.invitedExpires", { date: fmtDate(at) })
            : fmtDate(at)}
        </span>
        <span className="tabular-nums text-body-sm text-muted-foreground">
          {fmtTime(at)}
        </span>
      </span>
    );
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
          /* 工作空间归属(owner 2026-09-09 第 2 件的写侧)。
             Invited 行不给:人还没进来,没有可归属的东西。 */
          id: "workspaces",
          label: t("actions.manageWorkspaces"),
          icon: "stack",
          disabled: submitting || member.status === "Invited",
          ...(member.status === "Invited"
            ? { hint: t("hints.invitedNoWorkspace") }
            : {}),
          onSelect: () => setWorkspacesFor(member),
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
    <ListPagination
      page={pager.page}
      pageCount={pager.pageCount}
      total={members.length}
      filteredTotal={filtered.length}
      pageSize={pager.pageSize}
      onPageSizeChange={pager.onPageSizeChange}
      onPageChange={pager.onPageChange}
    />
  );

  // 对话框字段一律「标签在上、控件在下」(DS Field)。标签与控件不能同塞进一个
  // Label:DS Label 是横排 flex,控件占满一行会把中文标题挤到只剩一字宽、逐字换行
  // (租户信息页走查第八轮抓到的,同一写法全站一起改)。
  /* 打开「邀请」时取一次可选工作空间(只列我进得去、启用中的),并清掉上一次的
     查询结果——留着的话,换个号没查就提交会把上一个人的确认当成这一次的。 */
  useEffect(() => {
    if (createMode !== "invite") return;
    setLookup(null);
    let active = true;
    fetchSwitchableWorkspaces()
      .then((list) => {
        if (!active) return;
        setInviteWorkspaces(list);
        /* 只有一个时直接选上:那不是「替人做决定」,是没有第二个可选。 */
        if (list.length === 1) {
          setMemberForm((old) => ({ ...old, workspaceId: list[0]!.id }));
        }
      })
      .catch(() => {
        if (active) setInviteWorkspaces([]);
      });
    return () => {
      active = false;
    };
  }, [createMode, session.tenant?.id]);

  /** 按用户号查人。查到什么都记下来,由界面显示,不在这里替人判断。 */
  async function runLookup() {
    const no = memberForm.userNo.trim();
    if (!no || lookingUp) return;
    setLookingUp(true);
    setDialogError(null);
    try {
      setLookup(await lookupUserByNo(no));
    } catch (caught) {
      setLookup(null);
      setDialogError(errorText(caught, "feedback.lookupFailed"));
    } finally {
      setLookingUp(false);
    }
  }

  const workspaceSelect = (
    <Field>
      <FieldLabel htmlFor="member-workspace">
        {t("dialogs.fields.workspace")}
      </FieldLabel>
      <NativeSelect
        id="member-workspace"
        value={memberForm.workspaceId}
        onChange={(event) =>
          setMemberForm((old) => ({ ...old, workspaceId: event.target.value }))
        }
        required
      >
        <option value="">{t("dialogs.fields.workspacePlaceholder")}</option>
        {inviteWorkspaces.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
          </option>
        ))}
      </NativeSelect>
    </Field>
  );

  /* 号形问题(owner 2026-09-10:「不能静默查不到,用户也不知道问题」)。
     空串不报——那是「还没填」,不是「填错了」;进对话框就红一片没有意义。 */
  const userNoProblem =
    memberForm.userNo === ""
      ? null
      : validatePrincipalNo(memberForm.userNo, "user");

  const roleSelect = (
    <Field>
      <FieldLabel htmlFor="member-role">{t("dialogs.fields.role")}</FieldLabel>
      <NativeSelect
        id="member-role"
        value={memberForm.roleId}
        onChange={(event) =>
          setMemberForm((old) => ({ ...old, roleId: event.target.value }))
        }
      >
        {/* 邀请时**必选**(owner 2026-09-10):空选项等于替邀请人默认成 member,
            而给什么角色恰恰是邀请的实质内容。「加成员」那条路径仍允许留空。 */}
        <option value="">
          {createMode === "invite"
            ? t("dialogs.fields.rolePlaceholder")
            : t("dialogs.fields.defaultRole")}
        </option>
        {assignableRoles.map((role) => (
          <option key={role.id} value={role.id}>
            {role.roleName}
          </option>
        ))}
      </NativeSelect>
    </Field>
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
            action={
              /* 三个二级页的入口。它们是**去处**不是本页的动作,所以放页头右侧,
                 不与工具条上的新增 / 邀请挤在一起——那两个才是作用在本页目录上的。 */
              <>
                {canManageMembers ? (
                  <Button
                    variant="outline"
                    size="md"
                    onClick={() => router.push("/members/invitations")}
                  >
                    <Icon name="mail" size="xs" fallback="placeholder" />
                    <span>{t("header.viewInvitations")}</span>
                  </Button>
                ) : null}
                <Button
                  variant="outline"
                  size="md"
                  onClick={() => router.push("/members/roles")}
                >
                  <Icon name="shield-check" size="xs" fallback="placeholder" />
                  <span>{t("header.viewRoles")}</span>
                </Button>
                <Button
                  variant="outline"
                  size="md"
                  onClick={() => router.push("/members/permissions")}
                >
                  <Icon name="key" size="xs" fallback="placeholder" />
                  <span>{t("header.viewPermissions")}</span>
                </Button>
              </>
            }
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
            <InputGroup className="min-w-media-2xl grow basis-0 max-w-panel-sm">
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
                labels={tableLabels}
                /* 列对齐(owner 2026-09-06):只有姓名列左对齐——它是主列,头像 +
                   两行文字,居中会让每行的起点跟着名字长短乱跳;其余全部居中。 */
                columns={[
                  {
                    id: "name",
                    sortable: true,
                    header: t("table.columns.name"),
                    cell: (member: MemberRecord) => memberIdentity(member),
                  },
                  {
                    id: "phone",
                    header: t("table.columns.phone"),
                    align: "center",
                    cell: (member: MemberRecord) => (
                      <span className="text-muted-foreground">
                        {member.phone ?? t("table.emptyPhone")}
                      </span>
                    ),
                  },
                  {
                    id: "email",
                    header: t("table.columns.email"),
                    align: "center",
                    cell: (member: MemberRecord) => (
                      <span className="text-muted-foreground">
                        {member.email}
                      </span>
                    ),
                  },
                  {
                    id: "role",
                    header: t("table.columns.role"),
                    align: "center",
                    cell: (member: MemberRecord) => (
                      <RoleTag code={member.roleCode} fallback={member.role} />
                    ),
                  },
                  {
                    /* owner 2026-09-09:「关于用户，有两层，tenant 级、workspace 级，
                       目前只展示了一次」。这一列是第二层。

                       在工作空间成为真轴之前，两级逐行一致（三条写路径成对写），
                       画出来是同一批人的复印件——所以此前不画不是漏，是那时它没有
                       信息量。现在能建多个空间，它才开始不同。 */
                    id: "workspaces",
                    header: t("table.columns.workspaces"),
                    align: "center",
                    cell: (member: MemberRecord) =>
                      member.workspaces.length === 0 ? (
                        /* 空是**真实状态**：租户成员可以不属于任何工作空间。
                           写「未加入」而不是「—」——后者读起来像没查到。 */
                        <span className="text-body-sm text-muted-foreground">
                          {t("table.noWorkspace")}
                        </span>
                      ) : (
                        <span className="inline-flex flex-wrap items-center justify-center gap-2xs">
                          {member.workspaces.map((w) => (
                            <Badge
                              key={w.id}
                              variant={w.isDefault ? "default" : "outline"}
                            >
                              {w.name}
                            </Badge>
                          ))}
                        </span>
                      ),
                  },
                  {
                    id: "status",
                    header: t("table.columns.status"),
                    align: "center",
                    cell: (member: MemberRecord) => memberStatusBadge(member),
                  },
                  {
                    id: "joinedAt",
                    header: t("table.columns.joinedAt"),
                    align: "center",
                    cell: (member: MemberRecord) => memberTimelineCell(member),
                  },
                ]}
                rows={pagedMembers}
                {...(sort ? { sort } : {})}
                onSortChange={onSortChange}
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
          {/* 租户名摆在最前(owner 2026-09-10:防误操作)。从组织租户切来切去时,
              对话框长得一模一样——不写清楚往哪个租户加人,加错了没人会发现。 */}
          <Banner
            tone="info"
            title={t("dialogs.targetTenant", {
              tenant: formatTenantDisplay(
                session.tenant?.name,
                session.tenant?.tenantType,
              ),
            })}
          />
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
          {/* 邀请通道二选一(owner 2026-09-09)。只在「邀请」时出现——
              「加成员」那条路径要求对方已是平台用户且按邮箱找得到,没有第二条通道。 */}
          {createMode === "invite" ? (
            <Field>
              <FieldLabel htmlFor="member-channel">
                {t("dialogs.fields.channel")}
              </FieldLabel>
              <SegmentedControl<"email" | "user_no">
                ariaLabel={t("dialogs.fields.channel")}
                value={memberForm.channel}
                onChange={(next) =>
                  setMemberForm((old) => ({ ...old, channel: next }))
                }
                items={[
                  { value: "email", label: t("dialogs.channel.email") },
                  { value: "user_no", label: t("dialogs.channel.userNo") },
                ]}
              />
            </Field>
          ) : null}

          {createMode === "invite" && memberForm.channel === "user_no" ? (
            <Field>
              <FieldLabel htmlFor="member-user-no">
                {t("dialogs.fields.userNo")}
              </FieldLabel>
              {/* 输入框 + 查询按钮同一行(owner 2026-09-10 的布局)。
                  改动号码就把上一次的结果清掉——否则改了号、卡还停在旧人身上,
                  那正是「邀错人」最容易发生的一刻。 */}
              <div className="flex items-center gap-sm">
                {/* 前缀 `U-` 做成**固定前置**(owner 2026-09-10):界面上用户号一律
                    带前缀展示,不在输入框里体现的话,人会连前缀一起粘进来。
                    粘进来的也照收——`normalizePrincipalNoInput` 把前缀与空白剔掉,
                    只留数字。它**不吞非数字字符**:`1799729O56` 这种 O/0 手误要留着
                    让它查不到,静默改成另一个号比查不到糟得多。 */}
                <div className="flex flex-1 items-center gap-2xs rounded-md border border-input bg-background px-sm focus-within:ring-1 focus-within:ring-ring">
                  <span
                    className="select-none text-body-sm text-muted-foreground"
                    aria-hidden="true"
                  >
                    {USER_NO_PREFIX}
                  </span>
                  <Input
                    id="member-user-no"
                    inputMode="numeric"
                    autoComplete="off"
                    className="border-0 bg-transparent px-0 focus-visible:ring-0"
                    value={memberForm.userNo}
                    onChange={(event) => {
                      setLookup(null);
                      setMemberForm((old) => ({
                        ...old,
                        userNo: normalizePrincipalNoInput(
                          event.target.value,
                          "user",
                        ),
                      }));
                    }}
                    required
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="md"
                  disabled={
                    !memberForm.userNo || userNoProblem !== null || lookingUp
                  }
                  onClick={() => void runLookup()}
                >
                  {lookingUp
                    ? t("dialogs.actions.looking")
                    : t("dialogs.actions.lookup")}
                </Button>
              </div>
              {/* 号形不对时**替掉**那句通道说明,而不是并排显示:此刻人要解决的是
                  这一个问题,把两句话摆在一起会让重点散掉。

                  分档给文案(不是纯数字 / 位数不对 / 类别位不对)——说「请填 10 位数字」
                  对一个填了 11 位数字的人没有帮助,他要知道的是「位数不对」。 */}
              {userNoProblem ? (
                <span className="text-body-sm text-danger-text">
                  {t(`dialogs.userNoError.${userNoProblem}`)}
                </span>
              ) : (
                /* 说明放框后:这条通道与邮箱那条的行为不同(不发邮件、要对方在站内同意),
                   不说清楚的话邀请人会一直等一封不会来的邮件。 */
                <span className="text-body-sm text-muted-foreground">
                  {t("dialogs.fields.userNoHint")}
                </span>
              )}

              {/* 查到的人:**全宽、淡色底**(owner 2026-09-10 的布局)。
                  联系方式是服务端遮蔽过的——够邀请人认出是不是他要找的那个人,
                  又不至于让任何一个管理员按号把通讯录刷出来。 */}
              {lookup ? (
                lookup.found ? (
                  <div className="flex w-full flex-col gap-2xs rounded-lg bg-accent px-md py-sm">
                    <span className="flex flex-wrap items-center gap-sm">
                      <span className="text-label-md text-foreground">
                        {lookup.name ?? t("dialogs.lookup.noName")}
                      </span>
                      <span className="tabular-nums text-body-sm text-muted-foreground">
                        {lookup.userNo}
                      </span>
                      {lookup.alreadyMember ? (
                        <StatusBadge tone="warning">
                          {t("dialogs.lookup.alreadyMember")}
                        </StatusBadge>
                      ) : null}
                    </span>
                    <span className="text-body-sm text-muted-foreground">
                      {[lookup.maskedEmail, lookup.maskedPhone]
                        .filter(Boolean)
                        .join(" · ") || t("dialogs.lookup.noContact")}
                    </span>
                  </div>
                ) : (
                  <div className="w-full rounded-lg bg-accent px-md py-sm text-body-sm text-muted-foreground">
                    {t("dialogs.lookup.notFound")}
                  </div>
                )
              ) : null}
            </Field>
          ) : (
            <Field>
              <FieldLabel htmlFor="member-email">
                {t("dialogs.fields.email")}
              </FieldLabel>
              <Input
                id="member-email"
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
            </Field>
          )}
          {/* 邀请必选工作空间(owner 2026-09-10);「加成员」那条路径不问——
              它把已有账号直接拉进租户,进哪个空间沿用默认。 */}
          {createMode === "invite" ? workspaceSelect : null}
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
          <Field>
            <FieldLabel htmlFor="member-email-current">
              {t("dialogs.fields.email")}
            </FieldLabel>
            <Input id="member-email-current" value={selected.email} disabled />
          </Field>
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
          <Field>
            <FieldLabel htmlFor="member-next-password">
              {t("dialogs.fields.nextPassword")}
            </FieldLabel>
            <Input
              id="member-next-password"
              type="password"
              value={passwordForm.nextPassword}
              onChange={(event) =>
                setPasswordForm({ nextPassword: event.target.value })
              }
              minLength={6}
              required
            />
          </Field>
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

      {workspacesFor ? (
        <MemberWorkspacesDialog
          member={workspacesFor}
          onClose={() => setWorkspacesFor(null)}
          /* 归属变了,「所属工作空间」那一列要跟着变——重取成员目录。
             不就地改本地行:那一列的数据源在服务端,两处各算一遍会漂。 */
          onChanged={() => void reloadMembers()}
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
