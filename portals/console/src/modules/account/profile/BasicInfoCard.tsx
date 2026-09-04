"use client";

/**
 * BasicInfoCard — 基本信息(五行):显示名称 / 账号 / 手机 / 邮箱 / 最近登录。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * 显示名称默认只读灰,点「修改」激活为输入框,随页底保存;账号行按登录开关显示
 * 可登录 / 禁止登录(禁止时 tooltip 说明);最近登录行尾「登录历史」行内下拉展开。
 */

import { useTranslations } from "next-intl";
import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  DetailList,
  DetailRow,
  Icon,
  Input,
  Section,
  StatusBadge,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@vxture/design-system";
import type { LoginHistoryEntry } from "@/entities/console";
import { LoadFailedEmpty } from "@/components/load/LoadFailed";
import { formatProfileDate, parseBrowser, parseOS } from "./format";

export interface LoginHistoryState {
  items: LoginHistoryEntry[];
  loading: boolean;
  failed: boolean;
}

export function BasicInfoCard({
  loading,
  displayName,
  nameEditing,
  nameDraft,
  onNameDraftChange,
  onStartEditName,
  onCancelEditName,
  username,
  loginEnabled,
  usernameChangeable,
  usernameNextChangeLabel,
  onEditUsername,
  phone,
  phoneVerified,
  hasPhone,
  onChangePhone,
  onVerifyPhone,
  email,
  emailVerified,
  hasEmail,
  onChangeEmail,
  onVerifyEmail,
  lastLogin,
  history,
  historyOpen,
  onHistoryOpenChange,
  locale,
}: {
  readonly loading: boolean;
  readonly displayName: string;
  readonly nameEditing: boolean;
  readonly nameDraft: string;
  readonly onNameDraftChange: (next: string) => void;
  readonly onStartEditName: () => void;
  readonly onCancelEditName: () => void;
  readonly username: string;
  readonly loginEnabled: boolean;
  readonly usernameChangeable: boolean;
  readonly usernameNextChangeLabel: string;
  readonly onEditUsername: () => void;
  readonly phone: string;
  readonly phoneVerified: boolean;
  readonly hasPhone: boolean;
  readonly onChangePhone: () => void;
  readonly onVerifyPhone: () => void;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly hasEmail: boolean;
  readonly onChangeEmail: () => void;
  readonly onVerifyEmail: () => void;
  readonly lastLogin: LoginHistoryEntry | null;
  readonly history: LoginHistoryState;
  readonly historyOpen: boolean;
  readonly onHistoryOpenChange: (open: boolean) => void;
  readonly locale: string;
}) {
  const t = useTranslations("profilePage");
  const empty = t("common.empty");
  const loadingText = t("common.loading");

  const verifiedBadge = (verified: boolean) => (
    <StatusBadge tone={verified ? "success" : "warning"}>
      {verified ? t("verified.verified") : t("verified.unverified")}
    </StatusBadge>
  );

  const loginLine = (entry: LoginHistoryEntry) => {
    const os = parseOS(entry.userAgent);
    const browser = parseBrowser(entry.userAgent);
    return (
      <>
        <span className="text-foreground">
          {formatProfileDate(entry.loginAt, locale, empty)}
        </span>
        <span className="text-muted-foreground">
          {entry.ipAddress || empty}
        </span>
        {entry.countryCode ? (
          <span className="text-muted-foreground">{entry.countryCode}</span>
        ) : null}
        <span className="text-muted-foreground">
          {[os, browser].filter(Boolean).join(" · ") || empty}
        </span>
      </>
    );
  };

  return (
    <Section
      tone="raised"
      level={2}
      icon="user-circle"
      title={t("cards.basic.title")}
      description={t("cards.basic.description")}
    >
      <div className="pl-md">
        <DetailList>
          <DetailRow
            label={t("fields.displayName")}
            actions={
              nameEditing ? (
                <Button variant="ghost" size="sm" onClick={onCancelEditName}>
                  {t("actions.cancel")}
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onStartEditName}
                  disabled={loading}
                >
                  <Icon name="edit" size="xs" fallback="placeholder" />
                  <span>{t("actions.modify")}</span>
                </Button>
              )
            }
          >
            {nameEditing ? (
              <Input
                className="w-full max-w-panel-sm"
                value={nameDraft}
                onChange={(event) => onNameDraftChange(event.target.value)}
                autoComplete="name"
                autoFocus
              />
            ) : (
              <Input
                className="w-full max-w-panel-sm"
                value={loading ? loadingText : displayName}
                readOnly
                disabled
              />
            )}
          </DetailRow>

          <DetailRow
            label={t("fields.username")}
            actions={
              <Button
                variant="ghost"
                size="sm"
                onClick={onEditUsername}
                disabled={loading || !usernameChangeable}
              >
                <Icon name="edit" size="xs" fallback="placeholder" />
                <span>{t("actions.changeUsername")}</span>
              </Button>
            }
          >
            <span className="font-mono">
              {loading ? loadingText : username}
            </span>
            {!loading ? (
              loginEnabled ? (
                <StatusBadge tone="success">
                  {t("security.canLogin")}
                </StatusBadge>
              ) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <StatusBadge tone="danger">
                        {t("security.cannotLogin")}
                      </StatusBadge>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    {t("security.cannotLoginTip")}
                  </TooltipContent>
                </Tooltip>
              )
            ) : null}
            {!loading && !usernameChangeable ? (
              <StatusBadge tone="neutral">
                {t("username.cooldownHint", { date: usernameNextChangeLabel })}
              </StatusBadge>
            ) : null}
          </DetailRow>

          <DetailRow
            label={t("fields.phone")}
            actions={
              <>
                {!loading && hasPhone && !phoneVerified ? (
                  <Button variant="ghost" size="sm" onClick={onVerifyPhone}>
                    <Icon
                      name="shield-check"
                      size="xs"
                      fallback="placeholder"
                    />
                    <span>{t("actions.verify")}</span>
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onChangePhone}
                  disabled={loading}
                >
                  <Icon name="phone" size="xs" fallback="placeholder" />
                  <span>{t("actions.change")}</span>
                </Button>
              </>
            }
          >
            {loading ? loadingText : phone}
            {!loading && hasPhone ? verifiedBadge(phoneVerified) : null}
          </DetailRow>

          <DetailRow
            label={t("fields.email")}
            actions={
              <>
                {!loading && hasEmail && !emailVerified ? (
                  <Button variant="ghost" size="sm" onClick={onVerifyEmail}>
                    <Icon
                      name="shield-check"
                      size="xs"
                      fallback="placeholder"
                    />
                    <span>{t("actions.verify")}</span>
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onChangeEmail}
                  disabled={loading}
                >
                  <Icon name="mail" size="xs" fallback="placeholder" />
                  <span>{t("actions.change")}</span>
                </Button>
              </>
            }
          >
            {loading ? loadingText : email}
            {!loading && hasEmail ? verifiedBadge(emailVerified) : null}
          </DetailRow>

          <DetailRow
            label={t("fields.lastLogin")}
            actions={
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onHistoryOpenChange(!historyOpen)}
                aria-expanded={historyOpen}
              >
                <span>{t("login.history")}</span>
                <Icon
                  name={historyOpen ? "chevron-up" : "chevron-down"}
                  size="xs"
                  fallback="placeholder"
                />
              </Button>
            }
          >
            {loading ? (
              loadingText
            ) : lastLogin ? (
              <span className="flex flex-wrap items-center gap-md">
                {loginLine(lastLogin)}
              </span>
            ) : (
              empty
            )}
          </DetailRow>
        </DetailList>

        {/* 登录历史:行内下拉展开,只看历史 */}
        <Collapsible open={historyOpen} onOpenChange={onHistoryOpenChange}>
          <CollapsibleTrigger asChild>
            <span hidden />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="ml-media-md mt-xs rounded-md bg-muted/40 px-md py-xs">
              {history.failed ? (
                <LoadFailedEmpty />
              ) : history.loading ? (
                <p className="py-sm text-body-sm text-muted-foreground">
                  {loadingText}
                </p>
              ) : history.items.length === 0 ? (
                <p className="py-sm text-body-sm text-muted-foreground">
                  {t("login.historyEmpty")}
                </p>
              ) : (
                <ul className="flex flex-col [&>*+*]:border-t [&>*+*]:border-dashed [&>*+*]:border-primary/10 dark:[&>*+*]:border-primary/20">
                  {history.items.map((entry, index) => (
                    <li
                      key={`${entry.loginAt}-${index}`}
                      className="flex flex-wrap items-center gap-md py-xs text-body-sm"
                    >
                      {loginLine(entry)}
                      <StatusBadge
                        tone={entry.result === "success" ? "success" : "danger"}
                      >
                        {entry.result === "success"
                          ? t("login.success")
                          : t("login.failed")}
                      </StatusBadge>
                    </li>
                  ))}
                </ul>
              )}
              <p className="pt-xs text-body-sm text-muted-foreground">
                {t("login.historyWindow")}
              </p>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </Section>
  );
}
