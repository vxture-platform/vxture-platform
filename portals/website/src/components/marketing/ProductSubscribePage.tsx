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
 *   2. 对比区：分组功能对比表，选中列整列淡高亮；
 *   3. 答疑区：FAQ 双列卡。
 * 全局 Header/Footer 由 (marketing) layout 提供，页面不重复。
 * 档位 CTA 深链 console /subscribe（product/intent/target_tier/cycle）。
 *
 * 2026-08-30 数据切到 website-bff `GET /api/products/:code/plans`（DB 真源）：
 * 价格/周期/席位/功能键/配额全部来自已发布的套餐版本，i18n 只剩标签与文案；
 * 产品名与类型仍取 products.catalog.items（营销文案，与 /products 同一份）。
 * 三态：加载中 = 骨架卡；请求失败 = danger Banner + 重试；产品不可见或没有
 * 已发布套餐 = 「暂未开放订阅」空态——不再拿 i18n 假价兜底。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Banner,
  Button,
  EmptyState,
  Icon,
  Skeleton,
} from "@vxture/design-system";
import { Link } from "@/lib/i18n/navigation";
import {
  fetchProductPlans,
  type ProductPlansResponse,
} from "@/api/product-plans.api";
import {
  availableCycles,
  buildPricingModel,
  type BillingCycle,
} from "./pricing/pricing-model";
import { PricingPlanCard } from "./pricing/PricingPlanCard";
import { TeamTiersGhostCard } from "./pricing/TeamTiersGhostCard";
import { PlanCompareTable } from "./pricing/PlanCompareTable";
import { PricingFaq } from "./pricing/PricingFaq";

type AudienceView = "person" | "all";

/** products.catalog.items 里本页用到的字段（与 ProductsOverviewPage 同一份文案） */
type CatalogItem = {
  code: string;
  name: string;
  type: string;
  status: "available" | "coming";
};

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; data: ProductPlansResponse };

const DEFAULT_PRODUCT = "arda";

/**
 * 默认选中档。只是进入页面时的预选（让选中态有处可落），不是「推荐/最受欢迎」
 * 的说法——那个标记没有数据支撑，2026-08-30 已随 i18n 假价一起删掉。
 * 不在当前可见档里时回落到首档。
 */
const DEFAULT_SELECTED_TIER = "pro";

/** 与其余营销页一致的内容容器（--vx-container-page-xl 一档，xl 放宽到 2xl 屏） */
const CONTAINER = "mx-auto max-w-7xl px-6 lg:px-8 xl:max-w-screen-2xl";

export default function ProductSubscribePage() {
  const t = useTranslations("products.subscription");
  const tProducts = useTranslations("products");
  const searchParams = useSearchParams();
  const productCode = searchParams.get("product") ?? DEFAULT_PRODUCT;

  // 产品下拉只列营销目录里标 available 的产品；?product= 指到别的 code 也照常
  // 取阶梯（有没有可售套餐由 BFF 说了算）。
  const catalogItems = tProducts.raw("catalog.items") as CatalogItem[];
  const pickerItems = catalogItems.filter(
    (item) => item.status === "available",
  );
  const catalogItem = catalogItems.find((item) => item.code === productCode);

  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoad({ status: "loading" });
    void fetchProductPlans(productCode)
      .then((data) => {
        if (!cancelled) setLoad({ status: "ready", data });
      })
      .catch(() => {
        if (!cancelled) setLoad({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [productCode, reloadKey]);

  const model = useMemo(
    () =>
      load.status === "ready"
        ? buildPricingModel(load.data, catalogItem?.name ?? null)
        : null,
    [load, catalogItem?.name],
  );

  const [cycle, setCycle] = useState<BillingCycle>("yearly");
  const [audience, setAudience] = useState<AudienceView>("person");
  const [selectedTier, setSelectedTier] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  // 切换产品回到默认选中
  useEffect(() => {
    setSelectedTier(null);
  }, [productCode]);
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

  // 月付/年付切换只在阶梯里两种周期都有档挂价时出现；只有一种时直接落在那一种。
  const cycles = model ? availableCycles(model.plans) : [];
  const showCycleToggle = cycles.length > 1;
  const effectiveCycle: BillingCycle = cycles.includes(cycle)
    ? cycle
    : (cycles[0] ?? "monthly");

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
  // 选中档：用户点选优先；不在可见档里（切产品/切受众后）回落到默认档，再回落首档。
  const activeTier = visiblePlans.some((p) => p.tier === selectedTier)
    ? selectedTier
    : (visiblePlans.find((p) => p.tier === DEFAULT_SELECTED_TIER)?.tier ??
      visiblePlans[0]?.tier ??
      null);
  // CSS repeat() 不接受 0：分段拼接，空段直接不出现。
  const gridColumns = [
    visiblePlans.length > 0
      ? `repeat(${visiblePlans.length}, minmax(15rem, 1fr))`
      : null,
    showGhost ? "minmax(8.5rem, 10rem)" : null,
  ]
    .filter(Boolean)
    .join(" ");

  const contactHref = (subject: string) =>
    `mailto:sales@vxture.com?subject=${encodeURIComponent(subject)}`;

  return (
    <div className="vx-page-surface">
      {/* ── 板块一：订阅区（plan bar + 档位卡） ─────────────────────────── */}
      <section className="vx-section-odd">
        <div className={`${CONTAINER} pt-24`}>
          {load.status === "loading" ? (
            /* 首屏占位：一行 plan bar + 三张卡的骨架，撑住版式等真数据 */
            <div aria-busy="true">
              <Skeleton variant="line" width="18rem" height="2rem" />
              <div
                className="mt-8 grid gap-5"
                style={{
                  gridTemplateColumns: "repeat(3, minmax(15rem, 1fr))",
                }}
              >
                {[0, 1, 2].map((i) => (
                  <Skeleton
                    key={i}
                    variant="rect"
                    height="26rem"
                    className="rounded-2xl"
                  />
                ))}
              </div>
            </div>
          ) : load.status === "error" ? (
            <Banner
              tone="danger"
              title={t("loadError")}
              action={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setReloadKey((k) => k + 1)}
                >
                  {t("retry")}
                </Button>
              }
            />
          ) : !model ? (
            /* 产品不可见 / 没有已发布套餐：如实说「暂未开放」，不拿静态价兜底 */
            <EmptyState
              icon="package"
              title={t("unavailableTitle")}
              description={t("unavailable")}
              className="mx-auto mt-12 max-w-website-xl"
              action={
                <div className="flex flex-wrap justify-center gap-3">
                  <Button asChild variant="outline">
                    <a
                      href={contactHref(
                        t("contactSubject", {
                          product: catalogItem?.name ?? productCode,
                        }),
                      )}
                    >
                      {t("contact")}
                    </a>
                  </Button>
                  <Button asChild>
                    <Link href="/products">{t("back")}</Link>
                  </Button>
                </div>
              }
            />
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
                      {t("tierCount", { count: model.plans.length })}
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
                      {pickerItems.map((item) => {
                        const active = item.code === productCode;
                        return (
                          <Link
                            key={item.code}
                            role="menuitem"
                            href={`/pricing?product=${item.code}`}
                            onClick={() => setMenuOpen(false)}
                            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition hover:bg-vx-brand-50/60 dark:hover:bg-vx-brand-950/40 ${
                              active
                                ? "bg-vx-brand-50/80 dark:bg-vx-brand-950/50"
                                : ""
                            }`}
                          >
                            <span className="min-w-0 flex-1 font-medium text-vx-text-primary">
                              {item.name}
                            </span>
                            <span className="shrink-0 text-xs text-vx-gray-400">
                              {item.type}
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
                  {showCycleToggle ? (
                    <div
                      role="group"
                      aria-label={t("cycleGroupLabel")}
                      className="inline-flex items-center gap-1 rounded-full border border-vx-gray-200 bg-vx-white p-1 shadow-sm dark:border-vx-gray-700 dark:bg-vx-gray-900"
                    >
                      {cycles.map((c) => (
                        <Button
                          key={c}
                          variant={effectiveCycle === c ? "default" : "ghost"}
                          size="md"
                          onClick={() => setCycle(c)}
                          className="rounded-full px-5"
                        >
                          {t(`cycle.${c}`)}
                        </Button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>

              {/* 档位卡：严格一行，窄屏横向滚动。
                  负 margin + 等量 padding 给选中卡的光晕留出血，避免被滚动容器硬裁。 */}
              <div className="-mx-3 mt-8 overflow-x-auto px-3 pb-10 pt-3">
                <div
                  role="radiogroup"
                  aria-label={t("planGroupLabel")}
                  className="grid items-stretch gap-5"
                  style={{ gridTemplateColumns: gridColumns }}
                >
                  {visiblePlans.map((plan) => (
                    <PricingPlanCard
                      key={plan.tier}
                      plan={plan}
                      cycle={effectiveCycle}
                      productCode={productCode}
                      contactSubject={t("contactSubject", {
                        product: model.name,
                      })}
                      selected={plan.tier === activeTier}
                      onSelect={() => setSelectedTier(plan.tier)}
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
              <PlanCompareTable model={model} selectedTier={activeTier} />
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
