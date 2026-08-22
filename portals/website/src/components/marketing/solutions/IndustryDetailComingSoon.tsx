"use client";

/**
 * IndustryDetailComingSoon.tsx - 尚未成稿的行业详情页
 *
 * Keeps every 查看详情 on the overview page live: an industry without a written
 * detail page lands here instead of a 404, and the consult CTA still points at
 * /contact like every other one.
 *
 * 形状由共享的 ComingSoonPage 模板给出——全站待建设页只有一种长相。
 *
 * @package @vxture/website
 * @layer Presentation
 * @category Components - Solutions
 * @author AI-Generated
 * @date 2026-08-22
 */

import { useTranslations } from "next-intl";
import ComingSoonPage from "../ComingSoonPage";
import type { SolutionIndustry } from "@/data/solutions/solutions.data";

export default function IndustryDetailComingSoon({
  industry,
}: {
  industry: SolutionIndustry;
}) {
  const t = useTranslations("solutions");

  return (
    <ComingSoonPage
      icon={industry.icon}
      accent={industry.accent}
      eyebrow={t("detail.comingSoon.eyebrow")}
      title={t(`industries.${industry.id}.name`)}
      subtitle={t("detail.comingSoon.title")}
      description={t("detail.comingSoon.description")}
      primaryAction={{ href: "/contact", label: t("detail.comingSoon.action") }}
      backAction={{ href: "/solutions", label: t("detail.back") }}
    />
  );
}
