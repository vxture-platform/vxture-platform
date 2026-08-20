"use client";

/**
 * PricingFaq — /pricing 答疑区（双列 details 卡）。
 * @package @vxture/website
 * @layer Presentation
 * @category Marketing / Pricing
 */

import { useTranslations } from "next-intl";
import { Icon } from "@vxture/design-system";

interface FaqItem {
  q: string;
  a: string;
}

export function PricingFaq() {
  const t = useTranslations("products.subscription.faq");
  const items = t.raw("items") as FaqItem[];

  return (
    <div className="mx-auto max-w-7xl px-6 lg:px-8 xl:max-w-screen-2xl">
      <div className="mx-auto max-w-website-2xl text-center">
        <h2 className="font-display text-2xl font-bold text-vx-gray-900 dark:text-vx-white md:text-3xl">
          {t("title")}
        </h2>
        <p className="mt-3 text-sm leading-6 text-vx-gray-600 dark:text-vx-gray-300">
          {t("description")}
        </p>
      </div>
      <div className="mt-10 grid gap-5 md:grid-cols-2">
        {items.map((item, index) => (
          <details
            key={item.q}
            open={index === 0}
            className="group self-start rounded-xl border border-vx-gray-200 bg-vx-white p-6 dark:border-vx-gray-700 dark:bg-vx-gray-900"
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-base font-semibold text-vx-text-primary [&::-webkit-details-marker]:hidden">
              {item.q}
              <Icon
                name="plus"
                className="h-4 w-4 shrink-0 text-vx-brand-600 group-open:hidden dark:text-vx-brand-300"
                aria-hidden
              />
              <Icon
                name="minus"
                className="hidden h-4 w-4 shrink-0 text-vx-brand-600 group-open:block dark:text-vx-brand-300"
                aria-hidden
              />
            </summary>
            <p className="mt-3 text-sm leading-6 text-vx-text-muted">
              {item.a}
            </p>
          </details>
        ))}
      </div>
    </div>
  );
}
