"use client";

/**
 * ContactPage.tsx - /contact 联系我们
 *
 * Two panels at container width — 售前售后 and 生态合作 — over a hero band, with
 * the company facts closing the page. Contact values come from
 * data/company/contact.data.ts so the footer and this page cannot drift apart.
 *
 * Composed entirely from design-system components (Card / EntryCard / Badge /
 * Button / Icon) plus token-backed utility classes. No page-level CSS rules:
 * per-panel accent is a utility class picked in the data layer, and the corner
 * watermark is an absolutely positioned `Icon`, not a hand-written rule.
 *
 * @package @vxture/website
 * @layer Presentation
 * @category Components - Marketing
 * @author AI-Generated
 * @date 2026-08-22
 */

import { useTranslations } from "next-intl";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  EntryCard,
  Icon,
} from "@vxture/design-system";
import {
  COMPANY_CONTACT,
  CONTACT_CHANNELS,
  CONTACT_FACTS,
  type ContactChannel,
} from "@/data/company/contact.data";
import SolutionsHeroPattern from "./solutions/SolutionsHeroPattern";

function ContactChannelCard({ channel }: { channel: ContactChannel }) {
  const t = useTranslations("company.contact");
  const base = `channels.${channel.id}`;
  const items = t.raw(`${base}.items`) as string[];
  const email =
    channel.email === "service"
      ? COMPANY_CONTACT.service_email
      : COMPANY_CONTACT.partner_email;

  return (
    <Card surface="strong" className="relative h-full overflow-hidden">
      {/* 右上角图标水印：参考 console 卡片的背景图结构，用工具类摆位，不写规则。 */}
      <span
        className={`pointer-events-none absolute -right-6 -top-6 ${channel.artClass}`}
        aria-hidden="true"
      >
        <Icon name={channel.artIcon} className="h-40 w-40" />
      </span>

      <CardHeader className="relative">
        <Badge variant="secondary" className="w-max gap-2">
          <Icon name={channel.icon} className="h-4 w-4" />
          {t(`${base}.label`)}
        </Badge>
        <CardTitle className="font-display mt-4 text-2xl font-bold">
          {t(`${base}.title`)}
        </CardTitle>
      </CardHeader>

      <CardContent className="relative space-y-6">
        <p className="text-sm leading-7 text-vx-gray-600 dark:text-vx-gray-300">
          {t(`${base}.description`)}
        </p>

        <ul className="space-y-3">
          {items.map((item) => (
            <li
              key={item}
              className="flex gap-3 text-sm leading-6 text-vx-gray-600 dark:text-vx-gray-300"
            >
              <Icon
                name="check"
                className={`mt-1 h-4 w-4 shrink-0 ${channel.inkClass}`}
              />
              <span>{item}</span>
            </li>
          ))}
        </ul>

        <div className="space-y-3">
          <EntryCard
            icon="mail"
            title={email}
            meta={t(`${base}.emailLabel`)}
            href={`mailto:${email}`}
          />
          {channel.showPhone ? (
            <EntryCard
              icon="phone"
              title={COMPANY_CONTACT.contact_phone}
              meta={t(`${base}.phoneLabel`)}
              href={`tel:${COMPANY_CONTACT.contact_phone.replace(/-/g, "")}`}
            />
          ) : null}
        </div>

        {channel.id === "ecosystem" ? (
          <p className="text-xs leading-5 text-vx-gray-500 dark:text-vx-gray-400">
            {t(`${base}.note`)}
          </p>
        ) : null}
      </CardContent>

      <CardFooter className="relative">
        <Button asChild size="lg" className="px-5">
          <a href={`mailto:${email}`}>{t(`${base}.action`)}</a>
        </Button>
      </CardFooter>
    </Card>
  );
}

export default function ContactPage() {
  const t = useTranslations("company.contact");

  return (
    <div className="vx-page-surface">
      {/* Hero —— 复用解决方案页那套渐变/网格/图案分层 */}
      <section className="vx-solutions-hero flex items-center pb-16 pt-28">
        <div className="vx-solutions-grid-layer" aria-hidden="true" />
        <div
          className="vx-solutions-hero-pattern hidden lg:block"
          aria-hidden="true"
        >
          <SolutionsHeroPattern />
        </div>

        <div className="relative mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 xl:max-w-screen-2xl">
          <div className="max-w-website-4xl">
            <p className="vx-website-hero-eyebrow text-sm font-semibold uppercase text-vx-brand-600 dark:text-vx-info-200">
              {t("hero.eyebrow")}
            </p>
            <h1 className="font-brand mt-4 text-4xl font-bold leading-tight text-vx-gray-900 dark:text-vx-white md:text-5xl">
              {t("hero.title")}
            </h1>
            <p className="mt-6 max-w-website-3xl text-base leading-7 text-vx-gray-700 dark:text-vx-gray-200">
              {t("hero.description")}
            </p>
          </div>
        </div>

        <div className="vx-solutions-hero-fade" aria-hidden="true" />
      </section>

      {/* 两个板块 */}
      <section className="vx-section-odd">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 xl:max-w-screen-2xl">
          <div className="grid gap-6 lg:grid-cols-2">
            {CONTACT_CHANNELS.map((channel) => (
              <ContactChannelCard key={channel.id} channel={channel} />
            ))}
          </div>
        </div>
      </section>

      {/* 公司信息 */}
      <section className="vx-section-even">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 xl:max-w-screen-2xl">
          <h2 className="font-display text-2xl font-bold text-vx-gray-900 dark:text-vx-white">
            {t("facts.title")}
          </h2>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {CONTACT_FACTS.map((fact) => (
              <Card key={fact.id} className="relative overflow-hidden">
                <span
                  className="pointer-events-none absolute -right-4 -top-4 text-vx-brand-500/10"
                  aria-hidden="true"
                >
                  <Icon name={fact.artIcon} className="h-24 w-24" />
                </span>
                <CardContent className="relative">
                  <span className="flex h-10 w-10 items-center justify-center rounded-md bg-vx-brand-50 text-vx-brand-600 dark:bg-vx-brand-950/50 dark:text-vx-brand-200">
                    <Icon name={fact.icon} className="h-5 w-5" />
                  </span>
                  <p className="mt-4 text-xs text-vx-gray-500 dark:text-vx-gray-400">
                    {t(`facts.${fact.id}.label`)}
                  </p>
                  <p className="mt-1 text-sm font-semibold leading-6 text-vx-gray-900 dark:text-vx-white">
                    {t(`facts.${fact.id}.value`)}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
