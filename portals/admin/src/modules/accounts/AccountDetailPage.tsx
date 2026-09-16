"use client";

/**
 * AccountDetailPage.tsx - 账号详情（身份信息 + 头像处置）。
 * @package @vxture/admin
 * @layer Presentation
 * @category Modules - Accounts
 *
 * 范围由 owner 2026-09-16 划定：**只做身份信息 + 头像重置**。账号的生命周期动作
 * （停用/恢复/强制下线）留在列表的行动作里，不在这里重复一套。
 *
 * 头像块的存在理由是**审违规图片**：运营要看清用户传的到底是什么，所以按原图画、
 * 不缩略；重置 = 删 `account.user_avatars` 行回落平台默认，原图不留存、不可撤回，
 * 故走 step-up 且对话框标 danger。
 */

import { useEffect, useState } from "react";
import { useLocale } from "next-intl";
import Link from "next/link";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  EmptyState,
  Icon,
  StatusBadge,
  ViewLayout,
  type StatusBadgeTone,
} from "@vxture/design-system";
import avatarDefault from "@vxture/design-system/assets/icons/avatar-default.png";
import {
  accountAvatarUrl,
  fetchAccountOperation,
  resetAccountAvatar,
} from "@/api/admin-bff";
import type { AccountOperationRecord } from "@/entities/console";
import { DetailSectionHeading } from "@/modules/shared/DetailSectionHeading";
import { isStepUpCancelled, useStepUp } from "@/providers/StepUpProvider";
import { formatDateTime, joinClasses } from "@/modules/tenants/tenant-utils";

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

export function AccountDetailPage({ accountId }: { accountId: string }) {
  const locale = useLocale();
  const { runWithStepUp } = useStepUp();
  const [account, setAccount] = useState<AccountOperationRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

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

  async function handleResetAvatar() {
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
  }

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
      <ViewLayout className="w-full ">
        {backLink}
        <EmptyState
          title={loading ? "正在加载账号" : "未找到账号"}
          description={
            loading ? "正在读取账号详情。" : "该账号不存在或已被删除。"
          }
        />
      </ViewLayout>
    );
  }

  const avatarSrc = account.avatarHash
    ? accountAvatarUrl(account.id, account.avatarHash)
    : avatarDefault.src;

  return (
    <ViewLayout className="w-full ">
      {backLink}

      <section className="grid min-w-0 gap-lg">
        <header>
          <DetailSectionHeading icon="user" title="身份信息" />
        </header>

        <div className="flex min-w-0 flex-wrap items-start gap-lg">
          {/* 按原图画，不缩略——运营要看清用户传的到底是什么。 */}
          <div className="flex shrink-0 flex-col items-center gap-sm">
            <Avatar
              key={account.avatarHash ?? "__default__"}
              className="size-media-lg rounded-md"
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
                <Icon name="user" size="md" fallback="placeholder" />
              </AvatarFallback>
            </Avatar>
            <Button
              variant="outline"
              disabled={resetting || !account.avatarHash}
              onClick={() => void handleResetAvatar()}
            >
              <Icon name="refresh" size="xs" fallback="placeholder" />
              <span>重置为默认</span>
            </Button>
            {!account.avatarHash ? (
              <span className="text-body-sm text-muted-foreground">
                未上传，当前为平台默认
              </span>
            ) : null}
          </div>

          <div className="grid min-w-0 flex-1 grid-cols-1 gap-x-lg gap-y-md lg:grid-cols-2">
            <Field label="账号编码">{account.accountCode}</Field>
            <Field label="显示名称">{account.displayName}</Field>
            <Field label="邮箱">{account.email || "—"}</Field>
            <Field label="手机号">{account.phone || "—"}</Field>
            <Field label="状态">
              <StatusBadge tone={STATUS_TONE[account.status]}>
                {STATUS_LABEL[account.status]}
              </StatusBadge>
            </Field>
            <Field label="主租户">
              {account.primaryTenantName
                ? `${account.primaryTenantName}（${account.primaryTenantCode}）`
                : "—"}
            </Field>
            <Field label="注册时间">
              {formatDateTime(account.registeredAt, locale)}
            </Field>
            <Field label="最近活跃">
              {formatDateTime(account.lastActiveAt, locale)}
            </Field>
          </div>
        </div>

        {error ? (
          <p className={joinClasses("text-body-sm text-destructive-text")}>
            {error}
          </p>
        ) : null}
        {feedback ? (
          <p className="text-body-sm text-muted-foreground">{feedback}</p>
        ) : null}
      </section>
    </ViewLayout>
  );
}
