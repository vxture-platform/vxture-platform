import type { Metadata } from "next";
import { headers } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import {
  BootSplash,
  ThemeProvider,
  themeBootstrapScript,
} from "@vxture/design-system";
import "@vxture/design-system/styles/fonts.css";
import "./globals.css";
import { operaLocale, operaMessages } from "@/lib/intl";

/* 三平面 tab 名/head 统一(2026-09-02):默认标题=「<平面名> · Vxture」,子页标题走
   template「%s · <平面名>」。平面名 i18n(meta.plane),中英一致,与 admin/arche 同形。 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = operaLocale(await headers());
  const { plane, description } = operaMessages(locale).meta;
  return {
    title: { default: `${plane} · Vxture`, template: `%s · ${plane}` },
    description,
  };
}

/* `headers()` 让这一层变成动态渲染。opera 全站在登录闸门后，本来就没有一个页面
   是可静态化的，所以这不损失什么；换来的是语言由请求决定，而不是编译期写死。 */
export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const locale = operaLocale(await headers());
  const messages = operaMessages(locale);

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
        {/* Icons are DS React components (@phosphor-icons/react via iconRegistry);
            the legacy icon webfont links are gone with shell-template. */}
      </head>
      <body>
        {/* 启动占位在 React 根**之外**：进了根就会被水合接管，跟其余组件一样
            要等 JS，也就失去了填补空窗的意义。ThemeProvider 挂载后打上
            html[data-app-ready]，CSS 随即把它隐藏。 */}
        <BootSplash />
        {/* provider 收的是**选中的那一本**，不是两本——客户端不该为没在看的语言
            付带宽。切换走 `setGlobalLocalePreference` 写 cookie + `router.refresh()`，
            由服务端重新渲染，见 `useLocaleSwitch`。 */}
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ThemeProvider>{children}</ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
