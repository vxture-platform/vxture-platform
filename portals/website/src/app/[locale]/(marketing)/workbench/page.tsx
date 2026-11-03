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
    // The public product URL must not inherit the legacy localhost metadata base.
    metadataBase: new URL(
      process.env.NEXT_PUBLIC_WEBSITE_URL || "https://vxture.com",
    ),
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
