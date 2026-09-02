import type { Metadata } from "next";
import type { ReactNode } from "react";
import { cookies, headers } from "next/headers";
import type { Theme } from "@vxture-platform/shared";
// 常量走 `/server` 入口(vxture-platform#356)。它们的家是 @vxture/design-tokens,
// 而伞包主入口首行是 "use client" —— 从 server component 里 `THEME_CONSTANTS.X`
// 这样**点进去**,RSC 运行时会拦下:「You cannot dot into a client module from a
// server component. You can only pass the imported name through.」
// 整名传递(如 themeBootstrapScript)不受影响,所以它留在主入口那组也没错;
// 但取值必须从 server-safe 子集拿。
import { BootSplash, themeBootstrapScript } from "@vxture/design-system";
import {
  PREFERENCE_CONSTANTS,
  THEME_CONSTANTS,
} from "@vxture/design-system/server";
import type { Density } from "@vxture/design-system";
import { ConsoleAppProviders } from "@/providers/ConsoleAppProviders";
import { NextIntlClientProvider } from "next-intl";
import { adminLocale, adminMessages } from "@/lib/intl";
import "@vxture/design-system/styles/fonts.css";
import "./globals.css";

/* 三平面 tab 名/head 统一(2026-09-02):默认标题=「<平面名> · Vxture」,子页标题走
   template「%s · <平面名>」。平面名 i18n(meta.plane),中英一致,与 opera/arche 同形。
   locale 判定链复用 layout 用的 adminLocale(headers)。 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = adminLocale(await headers());
  const { plane, description } = adminMessages(locale).meta;
  return {
    title: { default: `${plane} · Vxture`, template: `%s · ${plane}` },
    description,
  };
}

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const cookieStore = await cookies();
  /* locale 的判定链（cookie → Cookie 头 → Accept-Language → 默认）走
     `@vxture/core-locale`，全平台一份。此前这里只看 cookie 一项，于是一个从未
     选过语言的英文浏览器进来看到的是中文。 */
  const locale = adminLocale(await headers());
  const initialTheme = (cookieStore.get(THEME_CONSTANTS.COOKIE_KEY)?.value ??
    THEME_CONSTANTS.DEFAULT_THEME) as Theme;
  const densityCookie = cookieStore.get(
    PREFERENCE_CONSTANTS.DENSITY_COOKIE_KEY,
  )?.value;
  const initialDensity: Density =
    densityCookie === "compact" || densityCookie === "comfortable"
      ? densityCookie
      : "default";
  const messages = adminMessages(locale);

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
        {/* Phosphor icon font — admin templates design uses `ph ph-*` classes. */}
        <link
          rel="stylesheet"
          href="https://unpkg.com/@phosphor-icons/web@2.1.1/src/regular/style.css"
        />
        <link
          rel="stylesheet"
          href="https://unpkg.com/@phosphor-icons/web@2.1.1/src/bold/style.css"
        />
        <link
          rel="stylesheet"
          href="https://unpkg.com/@phosphor-icons/web@2.1.1/src/fill/style.css"
        />
      </head>
      <body>
        {/* 启动占位在 React 根**之外**：进了根就会被水合接管，跟其余组件一样
            要等 JS，也就失去了填补空窗的意义。ThemeProvider 挂载后打上
            html[data-app-ready]，CSS 随即把它隐藏。 */}
        <BootSplash />
        {/* provider 收的是**选中的那一本**，不是两本——客户端不该为没在看的
            语言付带宽。

            `getMessageFallback` **不能挂在这里**：它是个函数，而这是从 server
            component 传给 client component，跨 RSC 边界传函数会直接抛
            「Functions cannot be passed directly to Client Components」——admin
            的每一页都 500。它的家在 `src/i18n/request.ts`。 */}
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ConsoleAppProviders
            initialTheme={initialTheme}
            initialDensity={initialDensity}
          >
            {children}
          </ConsoleAppProviders>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
