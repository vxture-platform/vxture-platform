"use client";

/**
 * WelcomeCard.tsx — 概览页第一块：你是谁、在哪。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * owner 2026-09-09：概览的第一块是**欢迎信息**——当前用户的概要，**只显示不编辑**。
 *
 * ── 为什么是它打头，而不是「你有哪些产品」──
 * 我起初把产品放第一块，owner 指出思路狭隘：人落到这一页，先要知道「我是谁、
 * 现在在哪个租户/工作空间」，然后才是「要我做什么」「我有什么」。身份确认在前，
 * 是因为这是个**多租户**平台——同一个人可能在几个租户里，进错了地方做的每件事
 * 都是错的。
 *
 * ── 只显示不编辑 ──
 * 这里一个输入框、一个「编辑」按钮都不放。改资料在「我的账号」，切租户在顶栏的
 * TenantPanel。概览页放编辑入口会让它变成第二个设置页，而两处能改同一个东西
 * 就一定会有一处先过期。
 */

import { useTranslations } from "next-intl";
import { Card, CardContent, Icon, StatusBadge } from "@vxture/design-system";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import { formatTenantDisplay } from "@/features/tenant/tenant-display";
import { TenantAvatar } from "@/components/tenant-avatar/TenantAvatar";

/** 按当前小时给一句问候。纯展示，不做时区推断——用浏览器本地时间就够了。 */
function greetingKey(hour: number): "morning" | "afternoon" | "evening" {
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

export function WelcomeCard() {
  const t = useTranslations("dashboard.welcome");
  const { session } = useConsoleSession();
  const user = session.user;
  const tenant = session.tenant;

  const name = user?.displayName || user?.name || user?.username || "";
  const tenantName = formatTenantDisplay(tenant?.name, tenant?.tenantType);

  /* 一行式的「事实条」：租户、工作空间、角色。每一条都是**当前上下文**，
     不是可点的入口——点进去的路都在侧栏与顶栏，这里只回答「我在哪」。
     取不到的那条整条不画，不占一格写「—」：那会让人以为有东西没加载出来。 */
  const facts: {
    icon: "buildings" | "stack" | "shield-check";
    label: string;
    value: string;
  }[] = [];
  if (tenantName) {
    facts.push({ icon: "buildings", label: t("tenant"), value: tenantName });
  }
  if (tenant?.workspaceName) {
    facts.push({
      icon: "stack",
      label: t("workspace"),
      value: tenant.workspaceName,
    });
  }
  if (user?.roleLabel) {
    facts.push({
      icon: "shield-check",
      label: t("role"),
      value: user.roleLabel,
    });
  }

  return (
    <Card surface="base" className="py-lg">
      <CardContent className="flex flex-col gap-md sm:flex-row sm:items-center sm:gap-lg">
        {/* TenantAvatar 收的是 src + tenantType，不是整个 tenant——照它的签名传。 */}
        <TenantAvatar
          src={
            tenant?.logoHash ? `/api/tenant/logo?v=${tenant.logoHash}` : null
          }
          tenantType={tenant?.tenantType ?? null}
          size="lg"
          {...(tenantName ? { alt: tenantName } : {})}
        />

        <div className="flex min-w-0 flex-1 flex-col gap-2xs">
          <span className="text-title-md text-foreground">
            {name
              ? t(`greeting.${greetingKey(new Date().getHours())}`, { name })
              : t("greetingAnonymous")}
          </span>
          <span className="text-body-sm text-muted-foreground">
            {t("subtitle")}
          </span>
        </div>

        {facts.length > 0 ? (
          <div className="flex flex-wrap items-center gap-md sm:justify-end">
            {facts.map((f) => (
              <span key={f.label} className="flex items-center gap-2xs">
                <Icon
                  name={f.icon}
                  size="xs"
                  className="text-muted-foreground"
                  aria-hidden
                />
                <span className="text-body-sm text-muted-foreground">
                  {f.label}
                </span>
                <span className="text-body-sm font-medium text-foreground">
                  {f.value}
                </span>
              </span>
            ))}
          </div>
        ) : null}

        {/* 账号处于删除保留期时要说一句：这是个有时限、可撤销的状态，
            藏起来的话人会在 30 天后突然失去账号。 */}
        {user?.accountStatus === "deleting" ? (
          <StatusBadge tone="warning">{t("deleting")}</StatusBadge>
        ) : null}
      </CardContent>
    </Card>
  );
}
