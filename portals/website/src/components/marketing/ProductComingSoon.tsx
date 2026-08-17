"use client";

/**
 * ProductComingSoon — 平台级产品详情占位（product_320 §4.5）。
 * L1/L2 产品的独立介绍页先占位；arda 走真实详情 ProductDetailPartOne。
 */

import { useTranslations } from "next-intl";
import { Button, Icon } from "@vxture/design-system";
import { Link } from "@/lib/i18n/navigation";

type CatalogItem = {
  code: string;
  name: string;
  description: string;
  value: string;
};

export default function ProductComingSoon({ code }: { code: string }) {
  const t = useTranslations("products");
  const items = t.raw("catalog.items") as CatalogItem[];
  const item = items.find((i) => i.code === code);

  return (
    <div className="vx-page-surface">
      <section className="vx-section-odd">
        <div className="mx-auto max-w-website-3xl px-6 py-24 text-center lg:px-8">
          <p className="text-sm font-semibold uppercase text-vx-brand-600 dark:text-vx-brand-300">
            {t("catalog.eyebrow")}
          </p>
          <h1 className="mt-3 font-brand text-4xl font-bold text-vx-gray-900 dark:text-vx-white md:text-5xl">
            {item?.name ?? code}
          </h1>
          {item?.description ? (
            <p className="mx-auto mt-5 max-w-website-2xl text-sm leading-6 text-vx-gray-600 dark:text-vx-gray-300">
              {item.description}
            </p>
          ) : null}
          <p className="mt-10 text-lg font-semibold text-vx-brand-600 dark:text-vx-brand-300">
            {t("catalog.comingSoonHint")}
          </p>
          <div className="mt-8 flex justify-center">
            <Button asChild variant="outline">
              <Link href="/products">
                <Icon name="arrow-left" className="h-4 w-4" />
                {t("catalog.back")}
              </Link>
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
