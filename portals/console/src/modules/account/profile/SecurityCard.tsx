"use client";

/**
 * SecurityCard — 安全设置:密码 / 账号密码登录开关 / 二次验证(规划中)/ 活跃会话。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * 活跃会话行尾「管理会话」行内下拉展开,行上直接下线;只看会话,不放历史。
 */

import { useTranslations } from "next-intl";
import {
  Button,
  DetailList,
  DetailRow,
  Icon,
  Section,
  Switch,
} from "@vxture/design-system";
import type { AuthSessionRecord } from "@/entities/console";
import { PlannedBadge } from "@/components/planned";
import { LoadFailedEmpty } from "@/components/load/LoadFailed";
import { formatProfileDate, parseBrowser, parseOS } from "./format";
import { RowExpand } from "./RowExpand";
import { CardRows, DETAIL_LIST_CLASS } from "./CardRows";

export interface SessionsState {
  items: AuthSessionRecord[];
  loading: boolean;
  failed: boolean;
  loaded: boolean;
}

export function SecurityCard({
  loading,
  hasPassword,
  onChangePassword,
  loginEnabled,
  onToggleLogin,
  toggling,
  sessions,
  sessionsOpen,
  onSessionsOpenChange,
  onRevoke,
  revoking,
  locale,
}: {
  readonly loading: boolean;
  readonly hasPassword: boolean;
  readonly onChangePassword: () => void;
  readonly loginEnabled: boolean;
  readonly onToggleLogin: (next: boolean) => void;
  readonly toggling: boolean;
  readonly sessions: SessionsState;
  readonly sessionsOpen: boolean;
  readonly onSessionsOpenChange: (open: boolean) => void;
  readonly onRevoke: (sid: string) => void;
  readonly revoking: string | null;
  readonly locale: string;
}) {
  const t = useTranslations("profilePage");
  const empty = t("common.empty");
  const loadingText = t("common.loading");

  return (
    <Section
      tone="raised"
      level={2}
      icon="shield-check"
      title={t("cards.security.title")}
      description={t("cards.security.description")}
    >
      <CardRows>
        <DetailList className={DETAIL_LIST_CLASS}>
          <DetailRow
            label={t("fields.password")}
            actions={
              <Button variant="ghost" size="sm" onClick={onChangePassword}>
                <Icon name="key" size="xs" fallback="placeholder" />
                <span>
                  {hasPassword
                    ? t("actions.changePassword")
                    : t("actions.setPassword")}
                </span>
              </Button>
            }
          >
            {loading
              ? loadingText
              : hasPassword
                ? t("security.passwordSet")
                : t("security.passwordNotSet")}
          </DetailRow>

          <DetailRow label={t("security.accountLogin")}>
            <Switch
              checked={loginEnabled}
              disabled={loading || toggling}
              onCheckedChange={onToggleLogin}
              aria-label={t("security.accountLogin")}
            />
            <span className="text-body-sm text-muted-foreground">
              {t("security.accountLoginHint")}
            </span>
          </DetailRow>

          <DetailRow
            label={t("security.twoFactor")}
            actions={
              <Button variant="ghost" size="sm" disabled>
                {t("security.twoFactorEnable")}
              </Button>
            }
          >
            <PlannedBadge />
            <span className="text-body-sm text-muted-foreground">
              {t("security.twoFactorHint")}
            </span>
          </DetailRow>

          <DetailRow
            label={t("security.sessions")}
            actions={
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onSessionsOpenChange(!sessionsOpen)}
                aria-expanded={sessionsOpen}
              >
                <span>{t("security.manageSessions")}</span>
                <Icon
                  name={sessionsOpen ? "chevron-up" : "chevron-down"}
                  size="xs"
                  fallback="placeholder"
                />
              </Button>
            }
          >
            {sessions.loaded
              ? t("security.sessionsCount", { count: sessions.items.length })
              : sessions.loading
                ? loadingText
                : t("security.sessionsUnknown")}
          </DetailRow>
        </DetailList>

        {/* 活跃会话:行内下拉展开、与值列对齐;只看会话,不放历史 */}
        <RowExpand open={sessionsOpen} onOpenChange={onSessionsOpenChange}>
          {sessions.failed ? (
            <LoadFailedEmpty />
          ) : sessions.loading || !sessions.loaded ? (
            <p className="py-sm text-body-sm text-muted-foreground">
              {loadingText}
            </p>
          ) : sessions.items.length === 0 ? (
            <p className="py-sm text-body-sm text-muted-foreground">
              {t("security.sessionsEmpty")}
            </p>
          ) : (
            <ul className="flex flex-col [&>*+*]:border-t [&>*+*]:border-dashed [&>*+*]:border-primary/10 dark:[&>*+*]:border-primary/20">
              {sessions.items.map((s) => {
                const os = parseOS(s.userAgent);
                const browser = parseBrowser(s.userAgent);
                return (
                  <li
                    key={s.sid}
                    className="flex flex-wrap items-center gap-lg py-xs text-body-sm"
                  >
                    <span className="text-foreground">
                      {[os, browser].filter(Boolean).join(" · ") || empty}
                    </span>
                    <span className="text-muted-foreground">
                      {s.ipAddress || empty}
                    </span>
                    <span className="text-muted-foreground">
                      {s.authMethod}
                    </span>
                    <span className="text-muted-foreground">
                      {t("security.lastActive", {
                        time: formatProfileDate(s.lastActiveAt, locale, empty),
                      })}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-auto"
                      onClick={() => onRevoke(s.sid)}
                      disabled={revoking === s.sid}
                    >
                      <Icon name="sign-out" size="xs" fallback="placeholder" />
                      <span>{t("security.revoke")}</span>
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </RowExpand>
      </CardRows>
    </Section>
  );
}
