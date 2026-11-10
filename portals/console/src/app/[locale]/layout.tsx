/**
 * LocaleLayout - 国际化布局
 *
 * 职责：验证 locale、提供 NextIntlClientProvider、加载翻译消息。
 *
 * @package @vxture/console
 * @layer Presentation
 * @category Pages
 * @author AI-Generated
 * @date 2026-05-05
 */

import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { LocaleSync } from "@/components/LocaleSync";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { routing } from "@/lib/i18n/routing";

type Props = {
  children: ReactNode;
  params: Promise<{ locale: string }>;
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params;

  if (!(routing.locales as readonly string[]).includes(locale)) {
    notFound();
  }

  setRequestLocale(locale);

  const messages = await getMessages();

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <LocaleSync />
      {children}
    </NextIntlClientProvider>
  );
}
