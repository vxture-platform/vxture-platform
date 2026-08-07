/**
 * [slug]/page.tsx - 每个大类一页。
 * @package @vxture/design-preview
 *
 * 六个路由段全部来自 `SECTIONS`，不各写一个文件——大类增减只动那一份清单。
 */

import { notFound } from "next/navigation";
import { SectionPage } from "@/preview/SectionPage";
import { SECTIONS, sectionBySlug } from "@/preview/sections";

export function generateStaticParams() {
  return SECTIONS.map((s) => ({ slug: s.slug }));
}

export default async function Page({
  params,
}: {
  readonly params: Promise<{ readonly slug: string }>;
}) {
  const { slug } = await params;
  if (!sectionBySlug(slug)) notFound();
  return <SectionPage slug={slug} />;
}
