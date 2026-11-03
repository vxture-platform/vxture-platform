/**
 * Independent RUYIN desktop product route and localized search metadata.
 * @package @vxture/website
 * @layer Presentation
 * @category Pages - Marketing
 * @author AI-Generated
 * @date 2026-11-03
 */
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { WorkbenchProductPage } from "@/components/marketing";

/** @param props Localized route parameters. @returns Product-specific search and sharing copy. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale,
    namespace: "products.workbench.meta",
  });
  return {
    title: t("title"),
    description: t("description"),
    alternates: {
      canonical: `/${locale}/workbench`,
      languages: { "zh-CN": "/zh-CN/workbench", "en-US": "/en-US/workbench" },
    },
    openGraph: {
      title: t("title"),
      description: t("description"),
      url: `/${locale}/workbench`,
    },
  };
}

export default function WorkbenchRoute() {
  return <WorkbenchProductPage />;
}
