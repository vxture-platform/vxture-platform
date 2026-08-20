"use client";

/**
 * ProductSubscribePage — /pricing 通用订阅页（v5 定稿结构）。
 * @package @vxture/website
 * @layer Presentation
 * @category Marketing / Pricing
 *
 * ?product= 选定产品（默认 arda），页面三板块：
 *   1. 订阅区：一行 plan bar（产品名下拉 + 个人/全部 + 月付/年付）+ 档位卡
 *      —— 卡片严格一行永不换行（窄屏横向滚动），1fr 等分撑满容器；
 *      「个人」视角 = 个人档 + 团队档占位卡，「全部」= 全部档位；
 *   2. 对比区：分组功能对比表，推荐列整列淡高亮；
 *   3. 答疑区：FAQ 双列卡。
 * 全局 Header/Footer 由 (marketing) layout 提供，页面不重复。
 * 数据经 getPricingModel 适配（本轮 i18n，下一步切套餐目录 API 时单点替换）。
 * 档位 CTA 深链 console /subscribe（product/intent/target_tier/cycle）。
 */

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Icon } from "@vxture/design-system";
import { Link } from "@/lib/i18n/navigation";
import {
  getPricingModel,
  type BillingCycle,
  type RawSubscribableProduct,
} from "./pricing/pricing-model";
import { PricingPlanCard } from "./pricing/PricingPlanCard";
import { TeamTiersGhostCard } from "./pricing/TeamTiersGhostCard";
import { PlanCompareTable } from "./pricing/PlanCompareTable";
import { PricingFaq } from "./pricing/PricingFaq";

type AudienceView = "person" | "all";

const DEFAULT_PRODUCT = "arda";

/** 与其余营销页一致的内容容器（--vx-container-page-xl 一档，xl 放宽到 2xl 屏） */
const CONTAINER = "mx-auto max-w-7xl px-6 lg:px-8 xl:max-w-screen-2xl";

export default function ProductSubscribePage() {
  const t = useTranslations("products.subscription");
  const searchParams = useSearchParams();
  const productCode = searchParams.get("product") ?? DEFAULT_PRODUCT;
  const rawProducts = t.raw("products") as Record<
    string,
    RawSubscribableProduct
  >;
  const model = getPricingModel(rawProducts, productCode);

  const [cycle, setCycle] = useState<BillingCycle>("yearly");
  const [audience, setAudience] = useState<AudienceView>("person");
  const [menuOpen, setMenuOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  // 产品下拉：点击外部关闭
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (event: MouseEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

  const personPlans = model?.plans.filter((p) => p.audience === "person") ?? [];
  const teamPlans = model?.plans.filter((p) => p.audience !== "person") ?? [];
  // 任一受众分组为空时「个人/全部」切换没有意义：隐藏切换,
  // 且个人档为空的产品强制走「全部」视角（避免空 repeat() 栅格）。
  const showAudienceToggle = personPlans.length > 0 && teamPlans.length > 0;
  const effectiveAudience: AudienceView =
    personPlans.length === 0 ? "all" : audience;
  const visiblePlans =
    effectiveAudience === "person" ? personPlans : (model?.plans ?? []);
  const showGhost = effectiveAudience === "person" && teamPlans.length > 0;
  // CSS repeat() 不接受 0：分段拼接，空段直接不出现。
  const gridColumns = [
    visiblePlans.length > 0
      ? `repeat(${visiblePlans.length}, minmax(15rem, 1fr))`
      : null,
    showGhost ? "minmax(8.5rem, 10rem)" : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="vx-page-surface">
      {/* ── 板块一：订阅区（plan bar + 档位卡） ─────────────────────────── */}
      <section className="vx-section-odd">
        <div className={`${CONTAINER} pt-24`}>
          {!model ? (
            <div className="mx-auto mt-12 max-w-website-xl rounded-lg border border-vx-gray-200 bg-vx-white p-8 text-center dark:border-vx-gray-800 dark:bg-vx-gray-900">
              <p className="text-sm leading-6 text-vx-gray-600 dark:text-vx-gray-300">
                {t("unavailable")}
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <Button asChild variant="outline">
                  <a
                    href={`mailto:sales@vxture.com?subject=${encodeURIComponent(
                      `${productCode} ${t("contact")}`,
                    )}`}
                  >
                    {t("contact")}
                  </a>
                </Button>
                <Button asChild>
                  <Link href="/products">{t("back")}</Link>
                </Button>
              </div>
            </div>
          ) : (
            <>
              {/* 一行 plan bar：产品名下拉 + 个人/全部 + 月付/年付 */}
              <div className="flex flex-wrap items-center justify-between gap-6">
                <div className="relative" ref={pickerRef}>
                  <Button
                    type="button"
                    variant="ghost"
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    aria-label={t("switchProduct")}
                    onClick={() => setMenuOpen((open) => !open)}
                    className="-ml-3 flex h-auto items-center gap-3 rounded-xl px-3 py-1.5 transition hover:bg-vx-brand-50/60 dark:hover:bg-vx-brand-950/40"
                  >
                    <h1 className="font-brand text-2xl font-semibold leading-tight text-vx-gray-900 dark:text-vx-white md:text-3xl">
                      {model.name}
                    </h1>
                    <span className="hidden rounded-full bg-vx-brand-50 px-3 py-1 text-xs font-semibold text-vx-brand-700 sm:inline-block dark:bg-vx-brand-950/50 dark:text-vx-brand-200">
                      {t("kindTiers", {
                        kind: model.kind,
                        count: model.plans.length,
                      })}
                    </span>
                    <Icon
                      name="chevron-down"
                      className={`h-4 w-4 text-vx-gray-400 transition-transform ${
                        menuOpen ? "rotate-180" : ""
                      }`}
                      aria-hidden
                    />
                  </Button>
                  {menuOpen ? (
                    <div
                      role="menu"
                      className="absolute left-0 top-full z-40 mt-2 min-w-72 rounded-xl border border-vx-gray-200 bg-vx-white p-1.5 shadow-lg dark:border-vx-gray-700 dark:bg-vx-gray-900"
                    >
                      {Object.keys(rawProducts).map((code) => {
                        const option = getPricingModel(rawProducts, code);
                        if (!option) return null;
                        const active = code === productCode;
                        return (
                          <Link
                            key={code}
                            role="menuitem"
                            href={`/pricing?product=${code}`}
                            onClick={() => setMenuOpen(false)}
                            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition hover:bg-vx-brand-50/60 dark:hover:bg-vx-brand-950/40 ${
                              active
                                ? "bg-vx-brand-50/80 dark:bg-vx-brand-950/50"
                                : ""
                            }`}
                          >
                            <span className="min-w-0 flex-1 font-medium text-vx-text-primary">
                              {option.name}
                            </span>
                            <span className="shrink-0 text-xs text-vx-gray-400">
                              {t("kindTiers", {
                                kind: option.kind,
                                count: option.plans.length,
                              })}
                            </span>
                            {active ? (
                              <Icon
                                name="check"
                                className="h-4 w-4 shrink-0 text-vx-brand-600 dark:text-vx-brand-300"
                                aria-hidden
                              />
                            ) : null}
                          </Link>
                        );
                      })}
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  {/* 个人 / 全部 */}
                  {showAudienceToggle ? (
                    <div
                      role="group"
                      aria-label={t("audienceGroupLabel")}
                      className="inline-flex items-center gap-1 rounded-full border border-vx-gray-200 bg-vx-white p-1 shadow-sm dark:border-vx-gray-700 dark:bg-vx-gray-900"
                    >
                      {(["person", "all"] as AudienceView[]).map((view) => (
                        <Button
                          key={view}
                          variant={
                            effectiveAudience === view ? "default" : "ghost"
                          }
                          size="md"
                          onClick={() => setAudience(view)}
                          className="rounded-full px-5"
                        >
                          {t(`audienceToggle.${view}`)}
                        </Button>
                      ))}
                    </div>
                  ) : null}
                  {/* 月付 / 年付 */}
                  <div
                    role="group"
                    aria-label={t("cycleGroupLabel")}
                    className="inline-flex items-center gap-1 rounded-full border border-vx-gray-200 bg-vx-white p-1 shadow-sm dark:border-vx-gray-700 dark:bg-vx-gray-900"
                  >
                    {(["monthly", "yearly"] as BillingCycle[]).map((c) => (
                      <Button
                        key={c}
                        variant={cycle === c ? "default" : "ghost"}
                        size="md"
                        onClick={() => setCycle(c)}
                        className="rounded-full px-5"
                      >
                        {t(`cycle.${c}`)}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>

              {/* 档位卡：严格一行，窄屏横向滚动 */}
              <div className="mt-10 overflow-x-auto pb-2">
                <div
                  className="grid items-stretch gap-5"
                  style={{ gridTemplateColumns: gridColumns }}
                >
                  {visiblePlans.map((plan) => (
                    <PricingPlanCard
                      key={plan.tier}
                      plan={plan}
                      cycle={cycle}
                      productCode={productCode}
                      contactSubject={model.contactSubject}
                    />
                  ))}
                  {showGhost ? (
                    <TeamTiersGhostCard
                      teamPlans={teamPlans}
                      onViewAll={() => setAudience("all")}
                    />
                  ) : null}
                </div>
              </div>
            </>
          )}
        </div>
      </section>

      {model ? (
        <>
          {/* ── 板块二：对比区（跟随同一容器全宽） ───────────────────────── */}
          <section className="vx-section-even">
            <div className={CONTAINER}>
              <div className="mx-auto max-w-website-2xl text-center">
                <h2 className="font-display text-2xl font-bold text-vx-gray-900 dark:text-vx-white md:text-3xl">
                  {t("compare.title")}
                </h2>
                <p className="mt-3 text-sm leading-6 text-vx-gray-600 dark:text-vx-gray-300">
                  {t("compare.description")}
                </p>
              </div>
              <PlanCompareTable
                model={model}
                featureHeader={t("compare.feature")}
              />
            </div>
          </section>

          {/* ── 板块三：答疑区 ───────────────────────────────────────────── */}
          <section className="vx-section-odd">
            <PricingFaq />
          </section>
        </>
      ) : null}
    </div>
  );
}
