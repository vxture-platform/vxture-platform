"use client";

/**
 * ThirdPartyLoginCard — 三方登录(开放式登录:用 Google / 飞书 / 钉钉 / 微信 账号
 * 直接登录 Vxture,与组织无关)。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * 两个维度分开(owner 2026-09-04):值列只表**绑定状态**(已绑定 / 未绑定),动作列表
 * **接入状态**——平台尚未接入的,动作列显示「对接中」、无按钮;已接入且未绑定的给
 * 「绑定」;已绑定的可解绑。哪家接入了是配置,不是代码(INTEGRATED_PROVIDERS)。
 *
 * 值列三块(徽标 / 绑定状态 / 说明)用 gap-lg 排开;已绑定的也保留「用 X 账号登录」
 * 这句说明,不再露绑定的号——那串打码 id 对用户没有意义(owner 走查)。
 */

import { useTranslations } from "next-intl";
import {
  Button,
  DetailList,
  DetailRow,
  Icon,
  Section,
  StatusBadge,
} from "@vxture/design-system";
import { CardRows, DETAIL_LIST_CLASS } from "./CardRows";

export type ThirdPartyProvider = "google" | "feishu" | "dingtalk" | "wechat";

export interface ThirdPartyAccount {
  provider: ThirdPartyProvider;
  connected: boolean;
  accountId: string | null;
  connectedAt: string | null;
}

export const PROVIDER_ORDER: ThirdPartyProvider[] = [
  "google",
  "feishu",
  "dingtalk",
  "wechat",
];

/** Official brand marks served from the console `/brand/` public directory. */
const PROVIDER_LOGO_SRC: Record<ThirdPartyProvider, string> = {
  google: "/brand/google-logo-icon.svg",
  feishu: "/brand/feishu-logo-icon.svg",
  dingtalk: "/brand/dingtalk-logo-icon.svg",
  wechat: "/brand/wechat_logo_icon.svg",
};

/**
 * 已接入的开放式登录。目前一家都没接(2026-09-04),全部显示「对接中」;接入一家
 * 就把它加进来——绑定入口随之出现,不用改别处。
 */
const INTEGRATED_PROVIDERS: ReadonlySet<ThirdPartyProvider> = new Set();

export function ThirdPartyLoginCard({
  accounts,
  loading,
  onUnbind,
  onBind,
  formatDate,
}: {
  readonly accounts: readonly ThirdPartyAccount[];
  readonly loading: boolean;
  readonly onUnbind: (account: ThirdPartyAccount) => void;
  readonly onBind: (account: ThirdPartyAccount) => void;
  readonly formatDate: (iso: string | null) => string;
}) {
  const t = useTranslations("profilePage");

  return (
    <Section
      tone="raised"
      level={2}
      icon="plugs-connected"
      title={t("cards.thirdParty.title")}
      description={t("cards.thirdParty.description")}
    >
      <CardRows>
        <DetailList className={DETAIL_LIST_CLASS}>
          {accounts.map((account) => {
            const name = t(
              `connectedAccounts.providers.${account.provider}.name`,
            );
            const integrated = INTEGRATED_PROVIDERS.has(account.provider);
            return (
              <DetailRow
                key={account.provider}
                label={name}
                actions={
                  account.connected ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onUnbind(account)}
                      disabled={loading}
                    >
                      <Icon name="x" size="xs" fallback="placeholder" />
                      <span>{t("connectedAccounts.actions.unbind")}</span>
                    </Button>
                  ) : integrated ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onBind(account)}
                      disabled={loading}
                    >
                      <Icon name="link" size="xs" fallback="placeholder" />
                      <span>{t("connectedAccounts.actions.bind")}</span>
                    </Button>
                  ) : (
                    <StatusBadge tone="neutral">
                      {t("connectedAccounts.status.integrating")}
                    </StatusBadge>
                  )
                }
              >
                <span className="flex flex-wrap items-center gap-lg">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={PROVIDER_LOGO_SRC[account.provider]}
                    alt=""
                    width={20}
                    height={20}
                    aria-hidden="true"
                  />
                  <StatusBadge tone={account.connected ? "success" : "neutral"}>
                    {account.connected
                      ? t("connectedAccounts.status.connected")
                      : t("connectedAccounts.status.disconnected")}
                  </StatusBadge>
                  <span className="text-body-sm text-muted-foreground">
                    {t(
                      `connectedAccounts.providers.${account.provider}.description`,
                    )}
                  </span>
                  {account.connected && account.connectedAt ? (
                    <span className="text-body-sm text-muted-foreground">
                      {t("connectedAccounts.connectedOn", {
                        date: formatDate(account.connectedAt),
                      })}
                    </span>
                  ) : null}
                </span>
              </DetailRow>
            );
          })}
        </DetailList>
      </CardRows>
    </Section>
  );
}
