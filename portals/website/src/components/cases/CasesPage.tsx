/**
 * CasesPage.tsx - 案例库页面
 *
 * 功能：展示完整案例库，支持筛选和搜索
 * 文本数据：来自 cases 命名空间（messages/{locale}/cases.json）
 * 结构数据：来自 CASES_DATA（仅含 id/slug/cover/cta/publishedAt）
 *
 * @package @vxture/website
 * @layer Presentation
 * @category Components - Cases
 * @author AI-Generated
 * @date 2026-03-17
 */
"use client";

import { useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { Link } from "@/lib/i18n/navigation";
import { debugLog } from "@vxture/shared";
import { CASES_DATA } from "@/data/cases/cases.data";
import { Button, Input } from "@vxture/design-system";

// ============================================================================
// 主组件
// ============================================================================

export default function CasesPage() {
  const t = useTranslations("cases");
  const tItems = useTranslations("cases.items");

  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState<string>("");

  debugLog("Cases data:", CASES_DATA);

  // ── 筛选逻辑 ──────────────────────────────────────────────────────────────

  const filteredCases = useMemo(() => {
    return CASES_DATA.items.filter((item) => {
      // 读取当前案例的翻译文本用于搜索匹配
      const title = tItems(`${item.id}.title`);
      const description = tItems(`${item.id}.description`);
      const tags = (tItems.raw(`${item.id}.tags`) as string[]) ?? [];

      const matchesSearch =
        !searchTerm ||
        title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        description.toLowerCase().includes(searchTerm.toLowerCase()) ||
        tags.some((tag) =>
          tag.toLowerCase().includes(searchTerm.toLowerCase()),
        );

      const matchesCategory =
        selectedCategory === "all" ||
        tags.some(
          (tag) =>
            tag ===
            t(
              CASES_DATA.categories.find((c) => c.slug === selectedCategory)
                ?.nameKey ?? "",
            ),
        );

      return matchesCategory && matchesSearch;
    });
  }, [selectedCategory, searchTerm, t, tItems]);

  if (!CASES_DATA.enabled) return null;

  return (
    <section className="vx-section-odd min-h-screen">
      <div className="container mx-auto px-4 py-16">
        {/* 标题区 */}
        <div className="text-center mb-12">
          <h1 className="font-display text-4xl font-bold text-vx-gray-900 mb-4">
            {t(CASES_DATA.titleKey)}
          </h1>
          <p className="text-xl text-vx-gray-600 max-w-3xl mx-auto">
            {t(CASES_DATA.subtitleKey)}
          </p>
        </div>

        {/* 筛选与搜索 */}
        <div className="flex flex-col md:flex-row gap-6 mb-12">
          <div className="flex-1">
            <Input
              type="text"
              placeholder={t(CASES_DATA.ui.searchKey)}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full px-4 py-2 border border-vx-gray-300 rounded-lg focus:ring-2 focus:ring-vx-brand-500 focus:border-transparent"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant={selectedCategory === "all" ? "default" : "outline"}
              size="md"
              onClick={() => setSelectedCategory("all")}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                selectedCategory === "all"
                  ? "bg-vx-brand-600 text-vx-white"
                  : "bg-vx-white text-vx-gray-600 hover:bg-vx-gray-100"
              }`}
            >
              {t("filters.all")}
            </Button>
            {CASES_DATA.categories.map((category) => (
              <Button
                key={category.id}
                variant={
                  selectedCategory === category.slug ? "default" : "outline"
                }
                size="md"
                onClick={() => setSelectedCategory(category.slug)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  selectedCategory === category.slug
                    ? "bg-vx-brand-600 text-vx-white"
                    : "bg-vx-white text-vx-gray-600 hover:bg-vx-gray-100"
                }`}
              >
                {t(category.nameKey)}
              </Button>
            ))}
          </div>
        </div>

        {/* 案例列表 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {filteredCases.map((item) => {
            const title = tItems(`${item.id}.title`);
            const description = tItems(`${item.id}.description`);
            const tags = (tItems.raw(`${item.id}.tags`) as string[]) ?? [];

            return (
              <div
                key={item.id}
                className="bg-vx-white rounded-xl shadow-md overflow-hidden hover:shadow-lg transition-shadow duration-300"
              >
                <div className="relative aspect-video">
                  <Image
                    src={item.cover.url}
                    alt={title}
                    fill
                    className="object-cover"
                    sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                  />
                </div>
                <div className="p-6">
                  <h3 className="text-xl font-semibold text-vx-gray-900 mb-2">
                    {title}
                  </h3>
                  <p className="text-vx-gray-600 mb-4 line-clamp-3">
                    {description}
                  </p>
                  <div className="flex flex-wrap gap-2 mb-4">
                    {tags.slice(0, 3).map((tag, index) => (
                      <span
                        key={index}
                        className="px-3 py-1 bg-vx-brand-100 text-vx-brand-800 text-sm rounded-full"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-vx-gray-500">
                      {item.publishedAt}
                    </span>
                    <Link
                      href={item.cta.href}
                      className="text-vx-brand-600 hover:text-vx-brand-800 font-medium text-sm"
                    >
                      {t(CASES_DATA.ui.viewDetailsKey)}
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* 无结果提示 */}
        {filteredCases.length === 0 && (
          <div className="text-center py-16">
            <p className="text-vx-gray-500 text-lg">
              {t(CASES_DATA.ui.noResultsKey)}
            </p>
            <Button
              onClick={() => {
                setSelectedCategory("all");
                setSearchTerm("");
              }}
              className="mt-4"
            >
              {t(CASES_DATA.ui.clearFiltersKey)}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
