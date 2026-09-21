"use client";

/**
 * AccountDetailPage.tsx - 账号详情（身份卡 + 基本信息 / 登录历史 / 工单记录）。
 * @package @vxture/admin
 * @layer Presentation
 * @category Modules - Accounts
 *
 * 版面照**租户详情**（owner 2026-09-21：「整体参照租户详情页进行布局，标题、
 * 缩进、文字大小、按钮位置等等，体系化、一致化」）：折叠身份卡 + 主列若干
 * `Section`。两页从此共用同一套节奏，不是各画各的。
 *
 * ── 这一页的取舍：汇聚，不是把别的板块搬进来 ──
 * owner：「这里是看用户，不要把所有板块和进来，要有汇聚和重点」。所以：
 *   · 所属租户只列名字与类型，不列那个租户的成员数/收入——那是租户详情的事；
 *   · 产品权限只给**去重后的一排标 + 一个总数**，不按租户展开成矩阵；
 *   · 工单只给「未接 / 总计」与一张记录表，不把工单台的筛选整套搬来。
 *
 * ── 三段不用 tab ──
 * owner 明确：基本信息 / 登录历史 / 工单记录是**一个页面的三个 section**。
 * 三段加起来一屏多一点，tab 会把「这个人是谁」拆成三次点击。登录历史默认只
 * 展开近 10 条（服务端给 50），长表在 section 内自己收放。
 *
 * 头像块的存在理由仍是**审违规图片**：按原图画、不缩略；重置 = 删
 * `account.user_avatars` 行回落平台默认，原图不留存、不可撤回，故走 step-up
 * 且对话框标 danger。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  DataTable,
  DestructiveButton,
  DetailPageTemplate,
  EmptyState,
  Icon,
  Section,
  StatusBadge,
  TableTitleCell,
  type DataTableColumn,
  type StatusBadgeTone,
} from "@vxture/design-system";
import avatarDefault from "@vxture/design-system/assets/icons/avatar-default.png";
import {
  TICKET_STATUS_TONE,
  USER_KYC_STATUS_TONE,
  formatPrincipalNoOr,
  resolveStatusTone,
} from "@vxture-platform/shared";
import {
  accountAvatarUrl,
  fetchAccountOperation,
  resetAccountAvatar,
} from "@/api/admin-bff";
import type {
  AccountOperationDetailRecord,
  AccountOperationRecord,
  AccountTenantBinding,
} from "@/entities/console";
import { useConfirmLabels } from "@/modules/shared/destructive";
import {
  useTicketPriorityLabels,
  useTicketStatusLabels,
  useUserKycStatusLabels,
} from "@/modules/shared/enum-labels";
import { TICKET_PRIORITY_TONE } from "@/modules/shared/tenant-tone";
import { useTableLabels } from "@/modules/shared/table";
import { resolveIpLocation } from "@/shared/ip-location";
import { isStepUpCancelled, useStepUp } from "@/providers/StepUpProvider";
import { formatDateTime } from "@/modules/tenants/tenant-utils";

/* 状态口径与列表页 AccountsPage 同源（那边是模块内私有函数）。改文案要两处一起改。 */
const STATUS_LABEL: Record<AccountOperationRecord["status"], string> = {
  active: "正常",
  invited: "待激活",
  locked: "已锁定",
  disabled: "已停用",
};
const STATUS_TONE: Record<AccountOperationRecord["status"], StatusBadgeTone> = {
  active: "success",
  invited: "brand",
  locked: "warning",
  disabled: "neutral",
};

/* 主体图标三档：用户 user、个人租户 building、组织租户 buildings。 */
function tenantTypeIcon(type: AccountTenantBinding["tenantType"]) {
  return type === "company" ? "buildings" : "building-office";
}
function tenantTypeLabel(type: AccountTenantBinding["tenantType"]) {
  return type === "company" ? "组织" : "个人";
}

/**
 * 登录结果的文案。
 *
 * `session.login_attempts.result` 是**开放集**（无 CHECK，24_session.sql 写着
 * 「success / bad_credentials / locked 等」），所以**不进 enum-labels**——那个
 * 模块只收值域已成文的枚举。这里按码逐条取词条，取不到就原样回显那个码：
 * 编一个「其他」会把没登记的值藏起来，而没登记正是要看见的事。
 */
function useLoginResultLabel() {
  const t = useTranslations("enums.loginResult");
  return (result: string) => {
    switch (result) {
      case "success":
        return t("success");
      case "bad_credentials":
        return t("badCredentials");
      case "locked":
        return t("locked");
      case "expired":
        return t("expired");
      case "mfa_required":
        return t("mfaRequired");
      case "mfa_failed":
        return t("mfaFailed");
      default:
        return result;
    }
  };
}

function loginResultTone(result: string): StatusBadgeTone {
  return result === "success" ? "success" : "danger";
}

/**
 * 身份卡右两栏的读数。与租户详情的 `TenantKeyMetric` 同形——两页共用一套节奏，
 * 所以这里刻意照抄它的结构（标签在上、读数与标同基线）而不是另造一个。
 */
function AccountKeyMetric({
  label,
  value,
  tags,
}: {
  label: string;
  value: string;
  tags?: string[];
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2xs">
      <span className="truncate text-label-sm text-muted-foreground">
        {label}
      </span>
      <span className="flex min-w-0 flex-wrap items-baseline gap-xs">
        <span className="truncate text-title-md font-extrabold text-foreground">
          {value}
        </span>
        {(tags ?? []).map((item) => (
          <StatusBadge key={item} tone="neutral" icon={false}>
            {item}
          </StatusBadge>
        ))}
      </span>
    </div>
  );
}

/** 基本信息里的一行。与租户详情「基础资料」的行同形。 */
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-icon-2xl min-w-0 items-center gap-sm border-b border-dashed border-primary/10 pb-sm">
      <span className="w-media-sm shrink-0 text-body-sm text-muted-foreground">
        {label}
      </span>
      <span className="min-w-0 flex-1 text-body-sm text-foreground">
        {children}
      </span>
    </div>
  );
}

/** 登录历史默认只展开这么多条（owner 2026-09-21）。服务端给 50。 */
const LOGIN_HISTORY_PREVIEW = 10;

export function AccountDetailPage({ accountId }: { accountId: string }) {
  const locale = useLocale();
  const tShared = useTranslations();
  const router = useRouter();
  const tableLabels = useTableLabels();
  const { runWithStepUp } = useStepUp();
  const withLabels = useConfirmLabels();
  const ticketStatusLabels = useTicketStatusLabels();
  const ticketPriorityLabels = useTicketPriorityLabels();
  const kycLabels = useUserKycStatusLabels();
  const loginResultLabel = useLoginResultLabel();
  const [account, setAccount] = useState<AccountOperationDetailRecord | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [summaryExpanded, setSummaryExpanded] = useState(true);
  const [loginExpanded, setLoginExpanded] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchAccountOperation(accountId)
      .then((record) => {
        if (active) setAccount(record);
      })
      .catch(() => {
        if (active) setAccount(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [accountId]);

  const handleResetAvatar = useCallback(async () => {
    if (!account || resetting) return;
    setResetting(true);
    setError(null);
    setFeedback(null);
    try {
      await runWithStepUp(() => resetAccountAvatar(account.id), {
        danger: true,
        submitLabel: "确认重置",
      });
      // 回落默认图：清掉 hash 即可，不必重拉整条记录。
      setAccount({ ...account, avatarHash: null });
      setFeedback("头像已重置为平台默认。");
    } catch (err) {
      if (isStepUpCancelled(err)) return;
      setError(
        err instanceof Error ? err.message : "头像重置失败，请稍后重试。",
      );
    } finally {
      setResetting(false);
    }
  }, [account, resetting, runWithStepUp]);

  const loginColumns: DataTableColumn<
    AccountOperationDetailRecord["loginHistory"][number]
  >[] = useMemo(
    () => [
      {
        id: "time",
        header: "时间",
        cell: (row) => formatDateTime(row.createdAt, locale),
      },
      {
        id: "result",
        header: tShared("columns.state"),
        align: "center",
        cell: (row) => (
          <StatusBadge tone={loginResultTone(row.result)}>
            {loginResultLabel(row.result)}
          </StatusBadge>
        ),
      },
      {
        id: "method",
        header: "方式",
        align: "center",
        cell: (row) => <Badge>{row.authMethod}</Badge>,
      },
      {
        id: "ip",
        header: "来源",
        cell: (row) => (
          <TableTitleCell
            layout="stacked"
            title={row.ip || "—"}
            description={resolveIpLocation(row.ip)}
          />
        ),
      },
    ],
    [locale, loginResultLabel, tShared],
  );

  const ticketColumns: DataTableColumn<
    AccountOperationDetailRecord["tickets"][number]
  >[] = useMemo(
    () => [
      {
        id: "ticket",
        header: "工单",
        cell: (row) => (
          <TableTitleCell
            icon="chat-circle"
            title={row.title}
            description={row.ticketNo}
            onTitleClick={() =>
              router.push(`/tickets/${encodeURIComponent(row.ticketNo)}`)
            }
          />
        ),
      },
      {
        id: "status",
        header: tShared("columns.state"),
        align: "center",
        width: "xs",
        cell: (row) => (
          <StatusBadge tone={resolveStatusTone(TICKET_STATUS_TONE, row.status)}>
            {ticketStatusLabels[row.status]}
          </StatusBadge>
        ),
      },
      {
        id: "priority",
        header: "优先级",
        align: "center",
        width: "xs",
        cell: (row) => (
          <StatusBadge tone={TICKET_PRIORITY_TONE[row.priority]}>
            {ticketPriorityLabels[row.priority]}
          </StatusBadge>
        ),
      },
      {
        id: "updated",
        header: "最近更新",
        align: "center",
        width: "sm",
        cell: (row) => formatDateTime(row.updatedAt, locale),
      },
    ],
    [locale, router, tShared, ticketPriorityLabels, ticketStatusLabels],
  );

  const backLink = (
    <Link
      className="inline-flex min-h-icon-xl w-fit items-center gap-xs text-body-sm font-extrabold text-primary-text no-underline"
      href="/accounts"
    >
      <Icon name="arrow-left" size="xs" fallback="placeholder" />
      返回账号列表
    </Link>
  );

  if (!account) {
    return (
      <DetailPageTemplate className="w-full" header={backLink}>
        <EmptyState
          title={loading ? "正在加载账号" : "未找到账号"}
          description={
            loading ? "正在读取账号详情。" : "该账号不存在或已被删除。"
          }
        />
      </DetailPageTemplate>
    );
  }

  const accountCode = formatPrincipalNoOr(account.accountCode, "user", "—");
  const avatarSrc = account.avatarHash
    ? accountAvatarUrl(account.id, account.avatarHash)
    : avatarDefault.src;
  const visibleLogins = loginExpanded
    ? account.loginHistory
    : account.loginHistory.slice(0, LOGIN_HISTORY_PREVIEW);

  return (
    <DetailPageTemplate
      className="w-full"
      header={
        <>
          {backLink}

          {/* 概要卡：托起的面板 + 顶缘语气色条 + 右上角折叠钮。折叠态只收掉
              留白与读数列，身份行仍在——收起后要还能看出这是谁。
              结构与租户详情逐条对齐（owner：体系化、一致化）。 */}
          <section
            className={`relative grid min-w-0 rounded-xl border-t-2 border-primary/30 bg-card/60 px-xl ${
              summaryExpanded ? "gap-lg py-xl" : "gap-0 py-sm"
            }`}
            aria-label={`${account.displayName} 标题概要`}
          >
            <Button
              className="absolute top-sm right-sm z-[1]"
              variant="ghost"
              size="icon-md"
              aria-expanded={summaryExpanded}
              aria-label={summaryExpanded ? "收起标题概要" : "展开标题概要"}
              title={summaryExpanded ? "收起标题概要" : "展开标题概要"}
              onClick={() => setSummaryExpanded((expanded) => !expanded)}
            >
              <Icon
                name={summaryExpanded ? "chevron-up" : "chevron-down"}
                size="xs"
                fallback="chevron-down"
              />
            </Button>

            <header
              className={
                summaryExpanded
                  ? "grid min-w-0 grid-cols-1 gap-xl xl:grid-cols-3 xl:[&>section:not(:last-child)]:border-r xl:[&>section:not(:last-child)]:border-dashed xl:[&>section:not(:last-child)]:border-primary/15 xl:[&>section:not(:last-child)]:pr-lg"
                  : "grid min-w-0 grid-cols-1 pr-3xl"
              }
            >
              <section
                className={
                  summaryExpanded
                    ? "flex min-w-0 items-start gap-xl"
                    : "flex min-w-0 items-center gap-sm"
                }
                aria-label="账号概要"
              >
                {/* 区域 1：用户自己的头像，不是默认 icon。展开大图 + 底下一条
                    浅淡的「重置为默认」，收起只留小图。icon 降为 Avatar 的
                    fallback——它本来就只是头像的回落。 */}
                <div
                  className={
                    summaryExpanded
                      ? "grid shrink-0 justify-items-center gap-2xs"
                      : "grid shrink-0"
                  }
                >
                  <Avatar
                    key={account.avatarHash ?? "__default__"}
                    className={
                      summaryExpanded
                        ? "size-media-md rounded-md"
                        : "size-icon-lg rounded-md"
                    }
                  >
                    <AvatarImage
                      src={avatarSrc}
                      alt={account.displayName}
                      className="rounded-md object-cover"
                    />
                    <AvatarFallback
                      delayMs={0}
                      className="rounded-md bg-accent text-muted-foreground"
                      aria-label={account.displayName}
                    >
                      <Icon
                        name="user"
                        size={summaryExpanded ? "md" : "sm"}
                        fallback="placeholder"
                      />
                    </AvatarFallback>
                  </Avatar>
                  {summaryExpanded ? (
                    /* 浅淡靠 className：本件没有 variant——破坏性动作不该有
                       「换个温和变体」这种选项，那是件的态度。重置是不可撤回的
                       删除，必须每次都问：step-up 凭据在有效期内会被复用，不能
                       拿它兼任确认。 */
                    <DestructiveButton
                      className="text-body-sm font-normal"
                      size="sm"
                      disabled={resetting || !account.avatarHash}
                      confirm={withLabels({
                        verb: "重置",
                        target: `用户「${account.displayName}」的头像`,
                        consequence:
                          "删除用户上传的头像、回落平台默认图，原图不留存、不可撤回。若二次验证仍在有效期内，确认后将直接执行、不再要求验证码。",
                        onConfirm: handleResetAvatar,
                      })}
                    >
                      重置为默认
                    </DestructiveButton>
                  ) : null}
                </div>

                {/* 区域 2：名字 / 账号编码 / 状态标组。收起态排成一行。 */}
                <div
                  className={
                    summaryExpanded
                      ? "grid min-w-0 gap-2xs"
                      : "flex min-w-0 items-center gap-sm"
                  }
                >
                  <h2
                    className={`min-w-0 truncate font-semibold text-foreground ${
                      summaryExpanded ? "text-title-xl" : "text-title-md"
                    }`}
                  >
                    {account.displayName}
                  </h2>
                  <p className="m-0 min-w-0 shrink-0 truncate text-body-sm font-extrabold text-muted-foreground">
                    {accountCode}
                  </p>
                  <div
                    className={`flex items-center gap-xs ${
                      summaryExpanded ? "flex-wrap" : "flex-nowrap"
                    }`}
                  >
                    <StatusBadge tone={STATUS_TONE[account.status]}>
                      {STATUS_LABEL[account.status]}
                    </StatusBadge>
                    <StatusBadge
                      tone={USER_KYC_STATUS_TONE[account.verifiedStatus]}
                    >
                      {kycLabels[account.verifiedStatus]}
                    </StatusBadge>
                  </div>
                </div>
              </section>

              {summaryExpanded ? (
                <>
                  {/* 区域 3：他在哪儿、能用什么。租户只列名字与类型——那个租户
                      有多少成员、收多少钱是租户详情的事，不往这页搬。 */}
                  <section
                    className="grid min-w-0 content-center gap-md"
                    aria-label="租户与产品概要"
                  >
                    <div className="flex min-w-0 flex-col gap-2xs">
                      <span className="truncate text-label-sm text-muted-foreground">
                        所属租户
                      </span>
                      {account.tenantBindings.length ? (
                        <ul className="m-0 grid list-none gap-2xs p-0">
                          {account.tenantBindings.map((binding) => (
                            <li
                              key={binding.tenantId}
                              className="flex min-w-0 items-center gap-xs"
                            >
                              <Icon
                                name={tenantTypeIcon(binding.tenantType)}
                                size="xs"
                                fallback="placeholder"
                                aria-hidden="true"
                                className="shrink-0 text-muted-foreground"
                              />
                              <span className="min-w-0 truncate text-body-sm text-foreground">
                                {binding.tenantName}
                              </span>
                              <StatusBadge
                                tone="neutral"
                                icon={false}
                                className="shrink-0"
                              >
                                {tenantTypeLabel(binding.tenantType)}
                              </StatusBadge>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-body-sm text-muted-foreground">
                          —
                        </span>
                      )}
                    </div>
                    {/* 产品权限：**去重后**的一排标 + 一个总数。同一个产品在他
                        三个租户里各订一份，对「他能用什么」来说仍是一个。 */}
                    <AccountKeyMetric
                      label="产品权限"
                      value={`${account.productNames.length} 个`}
                      tags={account.productNames}
                    />
                  </section>

                  {/* 区域 4：他惹了多少事、最近什么时候来过。 */}
                  <section
                    className="grid min-w-0 content-center gap-md"
                    aria-label="工单与活跃概要"
                  >
                    {/* 「未接 / 总计」而不是只给未接：只看未接不知道分母，
                        3 张未接在总共 5 张和总共 500 张里是两回事。 */}
                    <AccountKeyMetric
                      label="工单数量"
                      value={`${account.ticketOpenCount} / ${account.ticketTotalCount}`}
                      tags={["未接 / 总计"]}
                    />
                    <AccountKeyMetric
                      label="最近活跃"
                      value={formatDateTime(account.lastActiveAt, locale)}
                      tags={[
                        resolveIpLocation(account.lastActiveIp),
                        `30 天 ${account.loginCount30d} 次`,
                      ]}
                    />
                  </section>
                </>
              ) : null}
            </header>
          </section>
        </>
      }
    >
      {error ? (
        <p className="text-body-sm text-destructive-text">{error}</p>
      ) : null}
      {feedback ? (
        <p className="text-body-sm text-muted-foreground">{feedback}</p>
      ) : null}

      <Section
        tone="glass"
        level={2}
        icon="user"
        title="基本信息"
        className="min-w-0"
      >
        <div className="grid min-w-0 grid-cols-1 gap-x-lg gap-y-md lg:grid-cols-2">
          <Field label="账号编码">{accountCode}</Field>
          <Field label="显示名称">{account.displayName}</Field>
          <Field label="手机号">{account.phone || "—"}</Field>
          <Field label="邮箱">{account.email || "—"}</Field>
          <Field label="主租户">
            {account.primaryTenantName ? (
              <>
                {account.primaryTenantName}（
                {formatPrincipalNoOr(account.primaryTenantCode, "tenant", "—")}
                ）
              </>
            ) : (
              "—"
            )}
          </Field>
          <Field label="租户数量">{`${account.tenantCount} 个`}</Field>
          <Field label="注册时间">
            {formatDateTime(account.registeredAt, locale)}
          </Field>
          <Field label="激活时间">
            {account.activatedAt
              ? formatDateTime(account.activatedAt, locale)
              : "—"}
          </Field>
        </div>
      </Section>

      <Section
        tone="glass"
        level={2}
        icon="key"
        title="登录历史"
        className="min-w-0"
        description="含失败尝试——查登录史正是为了看连续失败与换 IP。"
        action={
          account.loginHistory.length > LOGIN_HISTORY_PREVIEW ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLoginExpanded((expanded) => !expanded)}
            >
              {loginExpanded
                ? "收起"
                : `展开全部 ${account.loginHistory.length} 条`}
            </Button>
          ) : undefined
        }
      >
        {account.loginHistory.length ? (
          <DataTable
            labels={tableLabels}
            columns={loginColumns}
            rows={visibleLogins}
            rowKey={(row) => row.id}
            indexStart={1}
            aria-label="登录历史"
          />
        ) : (
          <EmptyState
            title="暂无登录记录"
            description="该账号还没有留下登录尝试。"
          />
        )}
      </Section>

      <Section
        tone="glass"
        level={2}
        icon="chat-circle"
        title="工单记录"
        className="min-w-0"
      >
        {account.tickets.length ? (
          <DataTable
            labels={tableLabels}
            columns={ticketColumns}
            rows={account.tickets}
            rowKey={(row) => row.ticketNo}
            indexStart={1}
            aria-label="工单记录"
          />
        ) : (
          <EmptyState title="暂无工单" description="该账号还没有提交过工单。" />
        )}
      </Section>
    </DetailPageTemplate>
  );
}
