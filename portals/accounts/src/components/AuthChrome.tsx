/**
 * AuthChrome.tsx - accounts 自己的认证页眉 / 页脚 / 视觉面板文案。
 * @package @vxture/accounts
 *
 * 这一层存在的理由是 DS 的缺省值不该也不能替 accounts 作答，而 accounts 的六个
 * 认证面（登录 / 绑手机 / 找回 / 重置 / 运营重置 / 运营 MFA）此前一个都没传，
 * 于是三处缺省值一路默认到了生产：
 *
 * 1. **品牌标是碎图标。** `AuthChromeHeader` 原先默认 `/brand/vxture-logo-white.png`，
 *    accounts 的 `public/brand/` 下没有这个文件（website 有）。默认值已从 DS
 *    撤掉；图形标在这里补（`/brand/vxture-logo-icon.svg`，织环标本身是彩色的，
 *    文件名里的 "white" 骗人——浅底上完全可见）。
 * 2. **页脚署名写着「© 2026 Brand.」。** 那是 DS 的中性占位。
 * 3. **法务链接三条全 404。** 缺省是 `/legal/*` 相对路径，落在
 *    accounts.vxture.com 上，而法务页在门户站。必须写成绝对地址。
 *
 * 前两条是"没人传就露占位"，第三条更隐蔽：链接**看起来**是好的，点下去才是
 * 404，而登录页上没人会去点它们——直到有人真的要看隐私政策的那一天。
 *
 * 年份取当年而不是写死：这是客户端组件，服务端与客户端同一时刻取到同一年，
 * 不会有水合差异；写死的年份则会在跨年那一夜集体过期。
 */
"use client";

import type { ReactNode } from "react";
import {
  AuthChromeFooter,
  AuthChromeHeader,
  AuthLoginTemplate,
  AuthResultPanel,
  type AuthResultTone,
  type AuthVisualConfig,
} from "./auth/AuthLogin";

// 页眉字标缺省 Vxture Studio（owner 2026-08-18 判），调用方可传别的
//（比如按 OIDC client 展示接入方名称）。
export const AUTH_BRAND_LABEL = "Vxture Studio";
export const AUTH_BRAND_LOGO = "/brand/vxture-logo-icon.svg";
// 版权主体是权利人，与页眉字标各自独立（owner 2026-08-18 判）。
export const AUTH_COPYRIGHT_OWNER = "Vxture Studio";

// 门户站地址。构建期注入（见 next.config.js 的 env 直通）；缺失时退化成相对
// 路径——那是 404，但至少不会拼出一个 `undefined/legal/terms` 的坏链接。
const WEBSITE_URL = (process.env.NEXT_PUBLIC_WEBSITE_URL ?? "").replace(
  /\/+$/,
  "",
);

function websiteHref(path: string) {
  return WEBSITE_URL ? `${WEBSITE_URL}${path}` : path;
}

/** 页眉 = logo + 名称。名称缺省 Vxture Studio，可传（接入方品牌一类）。 */
export function AccountsAuthHeader({
  brandLabel = AUTH_BRAND_LABEL,
  brandLogoSrc = AUTH_BRAND_LOGO,
}: {
  readonly brandLabel?: ReactNode;
  readonly brandLogoSrc?: string;
} = {}) {
  return (
    <AuthChromeHeader
      brandHref={websiteHref("/")}
      brandLogoSrc={brandLogoSrc}
      brandLabel={brandLabel}
    />
  );
}

export function AccountsAuthFooter() {
  return (
    <AuthChromeFooter
      copyright={`© ${new Date().getFullYear()} ${AUTH_COPYRIGHT_OWNER}. All rights reserved.`}
      links={[
        { href: websiteHref("/legal/terms"), label: "服务条款" },
        { href: websiteHref("/legal/privacy"), label: "隐私政策" },
        { href: websiteHref("/legal/cookies"), label: "Cookie 使用政策" },
      ]}
    />
  );
}

/**
 * 死路屏：链接失效、会话无效、已登出。
 *
 * 这五处（绑定会话无效 / 两个重置链接无效 / 登出后 / 跳转中）此前各写一个
 * `<main className="vx-accounts-notice"><h1>…</h1><p>…</p></main>`——而那条类名
 * 的内边距引用的是本仓未定义的 `--vx-space-*`，整条声明被浏览器丢掉。于是它们
 * 是五屏顶着页面左上角、没有任何版式的裸文字。
 *
 * 它们和成功屏是同一件事的两面，所以走同一个 `AuthResultPanel`，只换语气。
 */
export function AccountsNotice({
  tone = "danger",
  title,
  description,
  action,
}: {
  readonly tone?: AuthResultTone;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly action?: ReactNode;
}) {
  return (
    <AuthLoginTemplate
      header={<AccountsAuthHeader />}
      footer={<AccountsAuthFooter />}
      layout="single"
      useLoginLayout={false}
    >
      <AuthResultPanel
        tone={tone}
        title={title}
        description={description}
        action={action}
      />
    </AuthLoginTemplate>
  );
}

/**
 * 左侧视觉面板的文案。
 *
 * **不放任何可核实的数字。** 这里原先是 DS 的缺省值 `40ms / 99.97% / 12B+` 和
 * "All systems operational"——四条都是杜撰的，却以事实的口吻挂在每一个来登录
 * 的人眼前，且没有任何数据源能对上。要挂指标就得有指标的来源；在有来源之前，
 * 这一块讲产品做什么，不讲它跑多快。
 */
export const ACCOUNTS_AUTH_VISUAL: AuthVisualConfig = {
  title: "把智能装进每一件事",
  description:
    "在一个工作台里编排模型、管理凭据与配额、把 AI 能力接进你自己的产品。",
};
