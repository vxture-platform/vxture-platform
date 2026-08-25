/**
 * RootLayout - accounts surface root layout
 * @package @vxture/accounts
 *
 * accounts 是中立的身份面（OIDC 登录 + 将来的账户中心）。
 * 见 docs/design/identity-platform-idp.md。
 *
 * 2026-08-26 接 i18n：此前这里写着「Lean single-locale shell (no next-intl)」，
 * 而 `lang` 与 `metadata` 都是写死的中文——一个英文浏览器进来，页面标题、
 * html lang、界面文案全是中文。现在语言由 `Accept-Language` / cookie 定，
 * 判定链走 `@vxture/core-locale`，见 `@/lib/intl` 的头注。
 */
import type { Metadata } from "next";
import { headers } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { accountsLocale, accountsMessages } from "@/lib/intl";
import {
  BootSplash,
  ThemeProvider,
  themeBootstrapScript,
} from "@vxture/design-system";
import "@vxture/design-system/styles/fonts.css";
import "./globals.css";

/* 标题也要跟着语言走。写成静态 `metadata` 的话，英文会话下浏览器标签上仍然
   是「登录 · Vxture」——那是最容易漏的一处，因为它不在页面里。 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = accountsLocale(await headers());
  const m = accountsMessages(locale).metadata;
  return { title: m.title, description: m.description };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = accountsLocale(await headers());
  const messages = accountsMessages(locale);

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
      </head>
      <body>
        {/* 启动占位在 React 根**之外**：进了根就会被水合接管，跟其余组件一样
            要等 JS，也就失去了填补空窗的意义。ThemeProvider 挂载后打上
            html[data-app-ready]，CSS 随即把它隐藏。 */}
        <BootSplash />
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ThemeProvider defaultMode="system" defaultDensity="default">
            {children}
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
