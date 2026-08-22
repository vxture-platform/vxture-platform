"use client";

/**
 * ProductComingSoonPages.tsx - 产品中心下两个待建设页
 *
 * 如影工作台与行业级场景都还没有内容，但导航里必须有落点——挂空链接或让它们
 * 不可点，用户点完什么都没发生，比给一个说明状态的页面更糟。
 *
 * 两页共用 ComingSoonPage 模板，只有文案与图标不同。
 *
 * @package @vxture/website
 * @layer Presentation
 * @category Components - Marketing
 * @author AI-Generated
 * @date 2026-08-22
 */

import { useTranslations } from "next-intl";
import ComingSoonPage from "./ComingSoonPage";

/** 如影工作台：桌面端工作台，不是后台管理。 */
export function WorkbenchComingSoon() {
  const t = useTranslations("products.comingSoon");

  return (
    <ComingSoonPage
      icon="desktop"
      accent="sky"
      eyebrow={t("eyebrow")}
      title={t("workbench.name")}
      subtitle={t("subtitle")}
      description={t("workbench.description")}
      primaryAction={{ href: "/contact", label: t("action") }}
      backAction={{ href: "/", label: t("back") }}
    />
  );
}

/** 行业级场景：按行业作业场景打包的成套产品。 */
export function IndustryScenariosComingSoon() {
  const t = useTranslations("products.comingSoon");

  return (
    <ComingSoonPage
      icon="buildings"
      accent="amber"
      eyebrow={t("eyebrow")}
      title={t("industryScenarios.name")}
      subtitle={t("subtitle")}
      description={t("industryScenarios.description")}
      primaryAction={{ href: "/contact", label: t("action") }}
      backAction={{ href: "/", label: t("back") }}
    />
  );
}
