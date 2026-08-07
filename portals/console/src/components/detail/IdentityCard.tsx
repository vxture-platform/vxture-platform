/**
 * IdentityCard — 详情页顶部的紧凑身份卡：头像 / 名称 + 状态标 / 次要标识 / 操作。
 *
 * 原实现是 .vx-account-profile-compact-card 一族遗留类名，在 ProfilePage、
 * TenantInfoPage、OrganizationPage 各拷了一份，三份已经开始漂移（Organization
 * 那份没有状态标簇，头像按钮用的还是另一套类名）。这里收成一件，三页共用。
 *
 * 不进 DS：DS 组合件的收录门槛是「先在 console / admin / opera 各自被重写过」
 * （composite/index.ts 的收录说明）。这个形状目前只有 console 用，等 admin 侧
 * 也长出来再谈提升，现在提上去就是拿设想当实据。
 *
 * 头像插槽收的是「头像本身」而不是整个按钮：各页放的东西不同（个人页是
 * UserAvatar，组织页是 logo 图），但「可点击上传 + 右下角编辑角标」这个交互
 * affordance 必须一致——所以按钮外壳与角标由本件拥有，页面只管往里塞图像。
 * 不传 onAvatarClick 就退化成纯展示，不套按钮。
 */

import type { ReactNode } from "react";
import { Button, Icon } from "@vxture/design-system";

export interface IdentityCardProps {
  /** 头像/徽标本身（UserAvatar、logo img 等），外面的按钮壳由本件提供。 */
  readonly avatar: ReactNode;
  /** 头像按钮的无障碍名；给了 onAvatarClick 时必填。 */
  readonly avatarLabel?: string;
  /** 不传则头像是纯展示，不渲染按钮与编辑角标。 */
  readonly onAvatarClick?: () => void;
  readonly avatarDisabled?: boolean;
  readonly name: ReactNode;
  /** 状态标簇，通常是若干 StatusBadge。 */
  readonly tags?: ReactNode;
  /** 次要标识行，如用户编号 / 租户编号。 */
  readonly meta?: ReactNode;
  readonly actions?: ReactNode;
}

export function IdentityCard({
  avatar,
  avatarLabel,
  onAvatarClick,
  avatarDisabled = false,
  name,
  tags,
  meta,
  actions,
}: IdentityCardProps) {
  return (
    <div className="flex flex-wrap items-center gap-lg rounded-md border border-primary/10 bg-card/58 p-lg dark:border-primary/20">
      {onAvatarClick ? (
        <Button
          variant="ghost"
          size="icon-md"
          className="relative size-media-md shrink-0 rounded-full p-0"
          aria-label={avatarLabel}
          title={avatarLabel}
          onClick={onAvatarClick}
          disabled={avatarDisabled}
        >
          {avatar}
          <span
            className="absolute right-0 bottom-0 inline-flex size-icon-lg items-center justify-center rounded-full bg-card text-muted-foreground ring-1 ring-primary/10 dark:ring-primary/20"
            aria-hidden="true"
          >
            <Icon name="edit" size="xs" fallback="placeholder" />
          </span>
        </Button>
      ) : (
        <span className="size-media-md shrink-0">{avatar}</span>
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-2xs">
        <span className="flex flex-wrap items-center gap-sm">
          <strong className="text-title-md text-foreground">{name}</strong>
          {tags ? (
            <span className="flex flex-wrap items-center gap-2xs">{tags}</span>
          ) : null}
        </span>
        {meta ? (
          <span className="text-body-sm text-muted-foreground">{meta}</span>
        ) : null}
      </div>

      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-sm">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
