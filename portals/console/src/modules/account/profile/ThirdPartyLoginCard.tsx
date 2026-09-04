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
 */

import { useTranslations } from "next-intl";
import {
  Button,
  DetailList,
  DetailRow,
  Section,
  StatusBadge,
} from "@vxture/design-system";
import { maskConnectedAccountId } from "./format";

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
  const empty = t("common.empty");

  return (
    <Section
      tone="raised"
      level={2}
      icon="plugs-connected"
      title={t("cards.thirdParty.title")}
      description={t("cards.thirdParty.description")}
    >
      <div className="pl-md">
        <DetailList>
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
                      {t("connectedAccounts.actions.unbind")}
                    </Button>
                  ) : integrated ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onBind(account)}
                      disabled={loading}
                    >
                      {t("connectedAccounts.actions.bind")}
                    </Button>
                  ) : (
                    <StatusBadge tone="neutral">
                      {t("connectedAccounts.status.integrating")}
                    </StatusBadge>
                  )
                }
              >
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
                {account.connected ? (
                  <>
                    <span className="font-mono text-body-sm text-muted-foreground">
                      {maskConnectedAccountId(account.accountId) ?? empty}
                    </span>
                    <span className="text-body-sm text-muted-foreground">
                      {t("connectedAccounts.connectedOn", {
                        date: formatDate(account.connectedAt),
                      })}
                    </span>
                  </>
                ) : (
                  <span className="text-body-sm text-muted-foreground">
                    {t(
                      `connectedAccounts.providers.${account.provider}.description`,
                    )}
                  </span>
                )}
              </DetailRow>
            );
          })}
        </DetailList>
      </div>
    </Section>
  );
}
