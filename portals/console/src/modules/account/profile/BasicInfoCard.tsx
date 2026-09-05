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

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  Button,
  DetailList,
  DetailRow,
  Icon,
  Input,
  Section,
  SegmentedControl,
  StatusBadge,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@vxture/design-system";
import type { LoginHistoryEntry } from "@/entities/console";
import { LoadFailedEmpty } from "@/components/load/LoadFailed";
import { formatProfileDate, parseBrowser, parseOS } from "./format";
import { RowExpand } from "./RowExpand";
import { CardRows, DETAIL_LIST_CLASS } from "./CardRows";

/** 登录历史展开后默认露出的条数,其余点「更多」再展开。 */
const HISTORY_PREVIEW_COUNT = 3;

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
  gender,
  genderEditing,
  genderDraft,
  onGenderDraftChange,
  onStartEditGender,
  onCancelEditGender,
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
  /** 称呼(性别):空串 = 未设定。 */
  readonly gender: "" | "male" | "female";
  readonly genderEditing: boolean;
  readonly genderDraft: "" | "male" | "female";
  readonly onGenderDraftChange: (next: "" | "male" | "female") => void;
  readonly onStartEditGender: () => void;
  readonly onCancelEditGender: () => void;
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

  const [historyShowAll, setHistoryShowAll] = useState(false);
  const visibleHistory = historyShowAll
    ? history.items
    : history.items.slice(0, HISTORY_PREVIEW_COUNT);
  const hiddenHistoryCount = Math.max(
    0,
    history.items.length - HISTORY_PREVIEW_COUNT,
  );

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
      <CardRows>
        <DetailList className={DETAIL_LIST_CLASS}>
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

          {/* 称呼(性别):先生 / 女士 / 未设定,同显示名的「修改 → 页底保存」模式(走查 2026-09-05) */}
          <DetailRow
            label={t("fields.gender")}
            actions={
              genderEditing ? (
                <Button variant="ghost" size="sm" onClick={onCancelEditGender}>
                  {t("actions.cancel")}
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onStartEditGender}
                  disabled={loading}
                >
                  <Icon name="edit" size="xs" fallback="placeholder" />
                  <span>{t("actions.modify")}</span>
                </Button>
              )
            }
          >
            {genderEditing ? (
              <SegmentedControl<"" | "male" | "female">
                size="md"
                ariaLabel={t("fields.gender")}
                value={genderDraft}
                onChange={onGenderDraftChange}
                items={[
                  { value: "male", label: t("gender.male") },
                  { value: "female", label: t("gender.female") },
                  { value: "", label: t("gender.unset") },
                ]}
              />
            ) : (
              // 展示态是文字、编辑态才是控件(owner 2026-09-05:禁用控件当展示看不清);
              // 行高按控件高度撑住,切换时位置不跳
              <span className="inline-flex h-control-md items-center text-body-md text-foreground">
                {loading
                  ? loadingText
                  : gender === "male"
                    ? t("gender.male")
                    : gender === "female"
                      ? t("gender.female")
                      : t("gender.unset")}
              </span>
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
                <span>{t("actions.modify")}</span>
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

        {/* 登录历史:行内下拉展开、与值列对齐;默认露 3 条,其余「更多」再展开;
            结果标靠右;窗口近 30 天(仓储层截) */}
        <RowExpand open={historyOpen} onOpenChange={onHistoryOpenChange}>
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
              {visibleHistory.map((entry, index) => (
                <li
                  key={`${entry.loginAt}-${index}`}
                  className="flex flex-wrap items-center gap-lg py-xs text-body-sm"
                >
                  {loginLine(entry)}
                  <StatusBadge
                    className="ml-auto"
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
          <div className="flex items-center justify-between gap-md pt-xs">
            <p className="text-body-sm text-muted-foreground">
              {t("login.historyWindow")}
            </p>
            {hiddenHistoryCount > 0 || historyShowAll ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setHistoryShowAll((prev) => !prev)}
                aria-expanded={historyShowAll}
              >
                <span>
                  {historyShowAll
                    ? t("login.showLess")
                    : t("login.showMore", { count: hiddenHistoryCount })}
                </span>
                <Icon
                  name={historyShowAll ? "chevron-up" : "chevron-down"}
                  size="xs"
                  fallback="placeholder"
                />
              </Button>
            ) : null}
          </div>
        </RowExpand>
      </CardRows>
    </Section>
  );
}
