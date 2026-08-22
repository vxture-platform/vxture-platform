import { notFound } from "next/navigation";
import { EmergencySolutionPage } from "@/components/marketing";
import { IndustryDetailComingSoon } from "@/components/marketing/solutions";
import { findIndustryBySlug } from "@/data/solutions/solutions.data";

interface IndustrySolutionRouteProps {
  params: { industry: string };
}

export default function IndustrySolutionRoute({
  params,
}: IndustrySolutionRouteProps) {
  const industry = findIndustryBySlug(params.industry);
  if (!industry) notFound();

  // 只有应急已有成稿详情；其余走共用的「详情页正在编写」页而不是 404。
  if (industry.slug === "emergency") return <EmergencySolutionPage />;
  return <IndustryDetailComingSoon industry={industry} />;
}
