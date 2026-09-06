"use client";

/**
 * RoleTag.tsx — 治理角色的统一显示件:图标 + 角色名的贴标。
 * @package @vxture/console
 * @layer Presentation
 * @category Components
 *
 * owner 2026-09-06:「角色显示模式采用 tag 模式,需要 icon + rolename」。
 *
 * **这个设计本来就有**,在账号信息页身份卡的租户行里(`profile/IdentityHeader.tsx`):
 * `StatusBadge` + 按角色码取的图标 + 角色名。问题是它是那个文件的私有常量,别处各写
 * 各的——邀请记录与成员表是纯文本,接受邀请页有 tag 没图标、语气还不一样,角色管理页
 * 五个角色共用一个图标。角色名更是**四份一模一样的副本**(profilePage / rolesPage /
 * invitationsPage / acceptInvitationPage),迟早飘。
 *
 * 所以收成一处:图标表与角色名各一份权威,显示走同一个件。角色名提到顶层 `role.*`
 * 命名空间——它有四个消费方,不该挂在某一页名下(与 `table.*`、`pagination.*` 同一
 * 处理)。角色说明(roleBlurb)只有角色管理页用,仍留在那一页的词条里。
 *
 * 图标五个角色各一个(owner 2026-09-06:「成员、只读成员、访客 icon 一样的,能否有
 * 可区别 icon」——身份卡原来那份把这三个都画成 user,等于图标对五分之三的角色不表意)。
 * 判据是**这个角色能做什么**,不是它排第几:所有者 medal(唯一、最高)、管理者
 * shield-check(治理)、成员 user(常规的人)、只读成员 eye(只能看)、访客 user-circle
 * (也是人,但是外部的另一类)。前三个沿用身份卡原有语义,只补后两个。
 * 语气统一一档:角色是**类目不是严重度**,分档用色会让人以为 guest 比 member「更危险」
 * ——区分交给图标与名字(与权限页对权限类型的同一判断)。
 *
 * 业务件不进 DS:角色是产品概念,DS 零业务含义。
 */

import { useTranslations } from "next-intl";
import { Icon, StatusBadge } from "@vxture/design-system";
import type { IconName } from "@vxture/design-system";
import { TENANT_ROLE_CODES } from "@vxture/core-utils";

/** 角色码 → 图标(权威一份,承自身份卡)。 */
export const ROLE_ICON: Readonly<Record<string, IconName>> = {
  owner: "medal",
  manager: "shield-check",
  member: "user",
  readonly: "eye",
  guest: "user-circle",
};

const KNOWN_ROLES = new Set<string>(TENANT_ROLE_CODES);

/** 目录外的码回退成 `user`:一个没见过的角色不该让整行没图标。 */
export function roleIcon(code: string | null | undefined): IconName {
  return (code && ROLE_ICON[code]) || "user";
}

/**
 * 角色码 → 显示名。目录里没有的码回退到调用方给的服务端名,再回退到码本身
 * ——服务端名是库里的中文,只在目录外的码上兜底,不作首选(它不随语言变)。
 */
export function useRoleLabel() {
  const t = useTranslations("role");
  return (
    code: string | null | undefined,
    fallback?: string | null,
  ): string => {
    if (code && KNOWN_ROLES.has(code)) return t(code);
    return fallback?.trim() || code || "—";
  };
}

/**
 * 固定展示序 owner→guest 的名次;目录外的码排尾。
 *
 * 放这里而不是各页各写:角色管理页与权限管理页必须同序——一页按 owner→guest 排、
 * 另一页按别的排,同一份目录看起来就是两份。
 */
export function roleRank(code: string): number {
  const i = TENANT_ROLE_CODES.indexOf(
    code as (typeof TENANT_ROLE_CODES)[number],
  );
  return i === -1 ? TENANT_ROLE_CODES.length : i;
}

export interface RoleTagProps {
  /** 角色码(`owner` / `manager` / …)。 */
  readonly code: string | null | undefined;
  /** 码不在目录里时的兜底名,通常是服务端返回的角色名。 */
  readonly fallback?: string | null;
}

/** 一枚角色贴标:图标 + 角色名。 */
export function RoleTag({ code, fallback }: RoleTagProps) {
  const label = useRoleLabel();
  return (
    <StatusBadge tone="info" icon={roleIcon(code)}>
      {label(code, fallback)}
    </StatusBadge>
  );
}

/**
 * 表头用的轻量版:图标 + 名,不套贴标。
 *
 * 权限矩阵有五个角色列,表头塞五枚贴标会把表头行撑成两倍高、且贴标在表头里读起来
 * 像可点的东西。表头本来就是标签,给它图标就够了。
 */
export function RoleHeaderLabel({ code, fallback }: RoleTagProps) {
  const label = useRoleLabel();
  return (
    <span className="inline-flex items-center gap-2xs">
      <Icon
        name={roleIcon(code)}
        size="xs"
        fallback="placeholder"
        className="shrink-0 text-muted-foreground"
      />
      <span>{label(code, fallback)}</span>
    </span>
  );
}
