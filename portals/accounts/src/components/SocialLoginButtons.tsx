/**
 * SocialLoginButtons.tsx - social login entries on the accounts login surface.
 * @package @vxture/accounts
 *
 * Composes the design-system `AuthSocialButtons` (the console login surface
 * look): a "其他方式登录" divider over a row of independent provider cards
 * (icon + label) — no outer wrapping box. The live providers (飞书 / 钉钉) are
 * table-driven over the backend-enabled set; a click top-level-navigates to the
 * IdP social start endpoint carrying the parked login_challenge. WeChat is
 * surfaced as a disabled placeholder (微信, 还未对接) — independent of the backend
 * registry. Google is intentionally hidden (compliance + no cluster egress to
 * Google); it stays in the backend registry but is not surfaced here. Renders
 * nothing when no live provider is enabled. Brand assets are served from
 * accounts/public/brand.
 */
"use client";

import { useEffect, useState } from "react";
import {
  AuthSocialButtons,
  type AuthSocialButtonConfig,
  type AuthSocialProvider,
} from "./auth/AuthLogin";
import {
  buildSocialStartUrl,
  fetchEnabledProviders,
  type EnabledProvider,
} from "@/api/oidc";

// Live (clickable) providers — only codes listed here render from the
// backend-enabled set, each with a DS brand icon. Google is intentionally
// omitted (hidden for compliance); WeChat is appended separately below as a
// disabled placeholder, independent of the backend registry. Unknown codes are
// skipped.
const PROVIDER_LABELS: Partial<Record<AuthSocialProvider, string>> = {
  feishu: "飞书",
  dingtalk: "钉钉",
};

export function SocialLoginButtons({
  loginChallenge,
}: {
  readonly loginChallenge: string;
}) {
  const [providers, setProviders] = useState<EnabledProvider[]>([]);

  useEffect(() => {
    let active = true;
    void fetchEnabledProviders().then((list) => {
      if (active) setProviders(list);
    });
    return () => {
      active = false;
    };
  }, []);

  const liveButtons: AuthSocialButtonConfig[] = providers
    .filter((p): p is EnabledProvider & { code: AuthSocialProvider } =>
      Object.prototype.hasOwnProperty.call(PROVIDER_LABELS, p.code),
    )
    .map((p) => ({
      provider: p.code,
      label: PROVIDER_LABELS[p.code] ?? p.name,
      onClick: () =>
        window.location.assign(buildSocialStartUrl(p.code, loginChallenge)),
    }));

  // Hide the whole section until at least one live provider is available, so the
  // disabled WeChat placeholder never stands alone.
  if (liveButtons.length === 0) return null;

  // WeChat: shown but disabled until its upstream broker is wired (还未对接).
  const buttons: AuthSocialButtonConfig[] = [
    ...liveButtons,
    { provider: "wechat", label: "微信", disabled: true },
  ];

  return (
    <AuthSocialButtons providers={buttons} separatorLabel="其他方式登录" />
  );
}
