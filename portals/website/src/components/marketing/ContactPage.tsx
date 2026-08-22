"use client";

/**
 * ContactPage.tsx - /contact 联系我们
 *
 * 整页只干一件事：把两类事情的联系方式说清楚。左卡面向客户用户（售前售后），
 * 右卡面向合作伙伴（生态合作）。无 hero、无页面级标题、无背景装饰——定位靠
 * 两张卡自己说清楚。
 *
 * 版面：单个 section 撑满一屏（顶到顶，含被 fixed header 覆盖的那段），两张卡
 * 在其中松散垂直居中；footer 在屏外。
 *
 * Composed from design-system components (Card / Badge / Icon) plus token-backed
 * utility classes — no page-level CSS rules.
 *
 * @package @vxture/website
 * @layer Presentation
 * @category Components - Marketing
 * @author AI-Generated
 * @date 2026-08-22
 */

import { useTranslations } from "next-intl";
import { Badge, Card, Icon } from "@vxture/design-system";
import {
  COMPANY_CONTACT,
  CONTACT_CHANNELS,
  type ContactChannel,
} from "@/data/company/contact.data";

/** 一行联系方式：图标 + 可点的值。不再嵌套卡片。 */
function ContactLine({
  icon,
  label,
  value,
  href,
  inkClass,
}: {
  icon: IconLine;
  label: string;
  value: string;
  href: string;
  inkClass: string;
}) {
  return (
    <div className="flex items-center gap-4">
      <Icon name={icon} className={`h-5 w-5 shrink-0 ${inkClass}`} />
      <span className="w-10 shrink-0 text-xs text-vx-gray-500 dark:text-vx-gray-400">
        {label}
      </span>
      <a
        href={href}
        className="text-base font-semibold text-vx-gray-900 transition-colors hover:text-vx-brand-600 dark:text-vx-white dark:hover:text-vx-brand-300"
      >
        {value}
      </a>
    </div>
  );
}

type IconLine = "mail" | "phone";

function ContactChannelCard({ channel }: { channel: ContactChannel }) {
  const t = useTranslations("company.contact");
  const base = `channels.${channel.id}`;
  const keywords = t.raw(`${base}.keywords`) as string[];
  const email =
    channel.email === "service"
      ? COMPANY_CONTACT.service_email
      : COMPANY_CONTACT.partner_email;

  return (
    <Card
      surface="strong"
      className="relative flex h-full flex-col overflow-hidden p-10 lg:p-12"
    >
      {/* 角落水印：往里收，四周留白，不贴边裁切。 */}
      <span
        className={`pointer-events-none absolute right-10 top-10 ${channel.artClass}`}
        aria-hidden="true"
      >
        <Icon name={channel.artIcon} className="h-28 w-28" />
      </span>

      {/* 头部：大图标 + 两行（小标题 / 大 slogan），图标高度覆盖两行 */}
      <div className="relative flex items-center gap-6">
        <span
          className={`flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl ${channel.chipClass}`}
        >
          <Icon name={channel.icon} className="h-10 w-10" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-vx-gray-500 dark:text-vx-gray-400">
            {t(`${base}.label`)}
          </p>
          <p className="font-display mt-1 text-2xl font-bold leading-snug text-vx-gray-900 dark:text-vx-white">
            {t(`${base}.slogan`)}
          </p>
        </div>
      </div>

      {/* 合作 / 服务模式关键词 */}
      <div className="relative mt-10 flex flex-wrap gap-2">
        {keywords.map((keyword) => (
          <Badge key={keyword} variant="secondary" className="px-3 py-1.5">
            {keyword}
          </Badge>
        ))}
      </div>

      {/* 联系方式：两行直接展开 */}
      <div className="relative mt-auto space-y-4 pt-12">
        <ContactLine
          icon="mail"
          label={t("contact.emailLabel")}
          value={email}
          href={`mailto:${email}`}
          inkClass={channel.inkClass}
        />
        <ContactLine
          icon="phone"
          label={t("contact.phoneLabel")}
          value={COMPANY_CONTACT.contact_phone}
          href={`tel:${COMPANY_CONTACT.contact_phone.replace(/-/g, "")}`}
          inkClass={channel.inkClass}
        />
      </div>
    </Card>
  );
}

export default function ContactPage() {
  return (
    <div className="vx-page-surface">
      {/* pt-16 让内容避开 fixed header；min-h-screen 使本节顶到顶撑满一屏。 */}
      <section className="flex min-h-screen items-center px-4 pb-20 pt-32 sm:px-6 lg:px-8">
        <div className="mx-auto grid w-full max-w-7xl gap-6 lg:grid-cols-2 xl:max-w-screen-2xl">
          {CONTACT_CHANNELS.map((channel) => (
            <ContactChannelCard key={channel.id} channel={channel} />
          ))}
        </div>
      </section>
    </div>
  );
}
