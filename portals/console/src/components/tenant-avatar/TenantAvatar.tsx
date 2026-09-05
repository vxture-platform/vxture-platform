"use client";

/**
 * TenantAvatar — 租户头像,全站一个形状。
 * @package @vxture/console
 * @layer Application
 * @category Component
 *
 * 走查(owner 2026-09-05,第八轮):此前三处三个样子——账号信息页所在租户列表画
 * 首字母牌、租户信息页身份卡画方角图标块、顶栏租户面板画圆形图标。现在收成一件:
 * 有标识画图,没有(或图挂了)回落到「建筑 / 用户」图标块;**方角**,区别于人像的圆。
 * 尺寸由使用处按位置给(列表行 sm、面板头 md、身份卡 lg),形状与回落规则不给改。
 * 顶栏租户条上的 icon 固定不绑定头像(owner:暂时固定)。
 */

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Icon,
  cn,
  type IconName,
} from "@vxture/design-system";

export type TenantAvatarSize = "sm" | "md" | "lg";

const SIZE_CLASS: Record<TenantAvatarSize, string> = {
  /** 列表行(账号页所在租户)。 */
  sm: "size-icon-lg",
  /** 面板头部标识块(顶栏租户面板,与 DS ShellPanelHeader 同档)。 */
  md: "size-media-sm",
  /** 详情页身份卡(租户信息页)。 */
  lg: "size-media-md",
};

const ICON_SIZE: Record<TenantAvatarSize, "xs" | "sm" | "md"> = {
  sm: "xs",
  md: "sm",
  lg: "md",
};

/** 类型图标:组织 = 建筑,个人 = 用户。三处共用,别各写各的。 */
export function tenantTypeIcon(
  tenantType: "personal" | "organization" | null | undefined,
): IconName {
  return tenantType === "organization" ? "building-library" : "user";
}

/** 方角 + 弱化底色:三处头像块共用的外观类(顶栏面板走 DS 头部件,也套这一组)。 */
export const TENANT_AVATAR_SHAPE_CLASS = "rounded-md";
export const TENANT_AVATAR_FALLBACK_CLASS =
  "rounded-md bg-accent text-muted-foreground";

export function TenantAvatar({
  src,
  tenantType,
  size = "md",
  alt,
  className,
}: {
  /** 版本化的标识 URL;null = 无标识,画类型图标。 */
  readonly src: string | null;
  readonly tenantType: "personal" | "organization" | null | undefined;
  readonly size?: TenantAvatarSize;
  /** 无障碍名(通常是租户名);不给则整块对读屏隐藏(旁边已有名字时)。 */
  readonly alt?: string;
  readonly className?: string;
}) {
  return (
    // key on src:标识换 / 清空时强制重挂,否则 Radix 留着上一次的「已加载」状态,
    // 回落块再也不显示(与 DS UserAvatar 同一处理)。
    <Avatar
      key={src ?? "__default__"}
      className={cn(SIZE_CLASS[size], TENANT_AVATAR_SHAPE_CLASS, className)}
    >
      {src ? (
        <AvatarImage
          src={src}
          alt={alt ?? ""}
          className={cn(TENANT_AVATAR_SHAPE_CLASS, "object-cover")}
        />
      ) : null}
      <AvatarFallback
        delayMs={0}
        className={TENANT_AVATAR_FALLBACK_CLASS}
        {...(alt ? { "aria-label": alt } : { "aria-hidden": true })}
      >
        <Icon
          name={tenantTypeIcon(tenantType)}
          size={ICON_SIZE[size]}
          fallback="placeholder"
        />
      </AvatarFallback>
    </Avatar>
  );
}
