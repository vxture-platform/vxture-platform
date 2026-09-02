"use client";

/**
 * ProductSubscribePage — /pricing 通用订阅页。
 * @package @vxture/website
 * @layer Presentation
 * @category Marketing / Pricing
 *
 * ?product= 选定产品（默认 arda），页面三板块：
 *   1. 订阅区（**撑满一屏**，owner 2026-09-03）：一行 plan bar（产品名 + 个人/全部 + 月付/年付，
 *      两组切换常驻）+ 档位卡 + 底部「更多权益，查看详情」向下滚动指示；
 *      —— 档位卡按**三槽位**排：1 档 = 左右浅色占位、中间档位；2 档 = 前两位档位、第三位占位；
 *         3 档正好；4 档及以上全显；
 *      —— 「个人」视角 = 个人档 + 右侧团队档窄卡（点击切「全部」），「全部」= 全部档位；
 *         五档产品的「收起 / 展开」就是这一对切换，不另做机制（owner 2026-09-03）；
 *   2. 对比区：分组功能对比表，选中列整列淡高亮（id=plan-compare，滚动指示的落点）；
 *   3. 答疑区：FAQ 双列卡。
 * 全局 Header/Footer 由 (marketing) layout 提供，页面不重复。
 * 档位 CTA 深链 console /subscribe（product/intent/target_tier/cycle）。
 *
 * 2026-08-30 数据切到 website-bff `GET /api/products/:code/plans`（DB 真源）：
 * 价格/周期/席位/功能键/配额全部来自已发布的套餐版本，i18n 只剩标签与文案；
 * 产品名与类型仍取 products.catalog.items（营销文案，与 /products 同一份）。
 * 三态：加载中 = 骨架卡；请求失败 = danger Banner + 重试；产品不可见或没有
 * 已发布套餐 = 「暂未开放订阅」空态——不再拿 i18n 假价兜底。
 *
 * 2026-09-03 owner：标题后的产品下拉去掉（产品从目录卡进来，页内不再切产品）；
 * 金额小数位全页统一（priceFractionDigits：有一个带小数就全两位，否则全整数）。
 */

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
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
import { fetchProductSubscriptions } from "@/api/subscription.api";
import { useAuthStore } from "@/stores/auth.store";
import {
  availableCycles,
  buildPricingModel,
  priceFractionDigits,
  type BillingCycle,
} from "./pricing/pricing-model";
import { PricingPlanCard } from "./pricing/PricingPlanCard";
import { TiersSideCard } from "./pricing/TeamTiersGhostCard";
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

/** 三槽位基线：不足三档用浅色占位补到三列。 */
const BASE_SLOTS = 3;

/** 对比区锚点：底部滚动指示的落点。 */
const COMPARE_SECTION_ID = "plan-compare";

/** 与其余营销页一致的内容容器（--vx-container-page-xl 一档，xl 放宽到 2xl 屏） */
const CONTAINER = "mx-auto max-w-7xl px-6 lg:px-8 xl:max-w-screen-2xl";

const TOGGLE_GROUP =
  "inline-flex items-center gap-1 rounded-full border border-vx-gray-200 bg-vx-white p-1 shadow-sm dark:border-vx-gray-700 dark:bg-vx-gray-900";

/** 浅色占位卡：不足三档时补位，纯留白，不承载信息。 */
function PlanPlaceholderCard() {
  return (
    <div
      aria-hidden="true"
      className="rounded-2xl border border-dashed border-vx-gray-200 bg-vx-gray-50/70 dark:border-vx-gray-700 dark:bg-vx-gray-800/40"
    />
  );
}

export default function ProductSubscribePage() {
  const t = useTranslations("products.subscription");
  const tProducts = useTranslations("products");
  const locale = useLocale();
  const searchParams = useSearchParams();
  const productCode = searchParams.get("product") ?? DEFAULT_PRODUCT;

  // 产品名取营销目录（与 /products 卡片同一份）；?product= 指到目录外的 code 也照常
  // 取阶梯（有没有可售套餐由 BFF 说了算）。
  const catalogItems = tProducts.raw("catalog.items") as CatalogItem[];
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
        ? buildPricingModel(load.data, catalogItem?.name ?? null, locale)
        : null,
    [load, catalogItem?.name, locale],
  );
  // 全页统一小数位：按阶梯里所有会展示的金额算一次，切周期/切受众都不变。
  const fractionDigits = useMemo(
    () => (model ? priceFractionDigits(model.plans) : 0),
    [model],
  );

  // 登录租户在本产品上的当前档：定价页据此标出「当前套餐」、禁用低档、高档走升级。
  // 产品卡片的「升级」就落到这里——先看清档位与价格，再进 console 下单。
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const user = useAuthStore((state) => state.user);
  const hasSession = isAuthenticated && Boolean(user);
  const [currentTier, setCurrentTier] = useState<string | null>(null);
  useEffect(() => {
    if (!hasSession) {
      setCurrentTier(null);
      return;
    }
    let cancelled = false;
    void fetchProductSubscriptions()
      .then((list) => {
        if (cancelled) return;
        const mine = list.find((s) => s.productCode === productCode);
        setCurrentTier(mine?.subscribed ? mine.tier : null);
      })
      .catch(() => {
        if (!cancelled) setCurrentTier(null);
      });
    return () => {
      cancelled = true;
    };
  }, [hasSession, productCode]);

  const [cycle, setCycle] = useState<BillingCycle>("yearly");
  const [audience, setAudience] = useState<AudienceView>("person");
  const [selectedTier, setSelectedTier] = useState<string | null>(null);

  // 切换产品回到默认选中
  useEffect(() => {
    setSelectedTier(null);
  }, [productCode]);

  // 月付/年付两个按钮常驻；阶梯里没挂价的周期禁用。当前周期没价时落到有价的那种。
  const cycles = model ? availableCycles(model.plans) : [];
  const effectiveCycle: BillingCycle = cycles.includes(cycle)
    ? cycle
    : (cycles[0] ?? "monthly");

  const personPlans = model?.plans.filter((p) => p.audience === "person") ?? [];
  const teamPlans = model?.plans.filter((p) => p.audience !== "person") ?? [];
  // 个人/全部两个按钮常驻；个人档为空的产品「个人」禁用并强制走「全部」视角。
  const effectiveAudience: AudienceView =
    personPlans.length === 0 ? "all" : audience;
  const visiblePlans =
    effectiveAudience === "person" ? personPlans : (model?.plans ?? []);
  // 选中档：用户点选优先；不在可见档里（切产品/切受众后）回落到默认档，再回落首档。
  const activeTier = visiblePlans.some((p) => p.tier === selectedTier)
    ? selectedTier
    : (visiblePlans.find((p) => p.tier === DEFAULT_SELECTED_TIER)?.tier ??
      visiblePlans[0]?.tier ??
      null);

  // 三槽位排布（owner 2026-09-03）：
  //   1 档 → [占位, 档, 占位]；2 档 → [档, 档, 占位]；3 档正好；4 档及以上全显。
  //   五档产品：「个人」= 3 个人档 + 右侧团队档窄卡，「全部」= 5 档——收起 / 展开就是这对切换。
  const shownPlans = visiblePlans;
  const placeholderCount = Math.max(0, BASE_SLOTS - shownPlans.length);
  const leadingPlaceholders = shownPlans.length === 1 ? 1 : 0;
  const trailingPlaceholders = placeholderCount - leadingPlaceholders;
  // 右侧团队档窄卡：「个人」视角下有团队档时出现；有占位槽时放进最后一个占位槽，不另占列。
  const teamHint = effectiveAudience === "person" && teamPlans.length > 0;
  const teamHintInPlaceholder = teamHint && trailingPlaceholders > 0;
  const showSideCard = teamHint && !teamHintInPlaceholder;
  // CSS repeat() 不接受 0：分段拼接，空段直接不出现。
  const gridColumns = [
    `repeat(${shownPlans.length + placeholderCount}, minmax(15rem, 1fr))`,
    showSideCard ? "minmax(8.5rem, 10rem)" : null,
  ]
    .filter(Boolean)
    .join(" ");

  const contactHref = (subject: string) =>
    `mailto:sales@vxture.com?subject=${encodeURIComponent(subject)}`;

  const scrollToCompare = () => {
    document
      .getElementById(COMPARE_SECTION_ID)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="vx-page-surface">
      {/* ── 板块一：订阅区（撑满一屏：plan bar + 档位卡 + 底部滚动指示） ── */}
      <section className="vx-section-odd relative flex min-h-screen flex-col">
        <div
          className={`${CONTAINER} flex w-full flex-1 flex-col justify-center pb-24 pt-24`}
        >
          {load.status === "loading" ? (
            /* 首屏占位：一行 plan bar + 三张卡的骨架，撑住版式等真数据 */
            <div aria-busy="true">
              <Skeleton variant="line" width="18rem" height="2rem" />
              <div
                className="mt-8 grid gap-5"
                style={{
                  gridTemplateColumns: `repeat(${BASE_SLOTS}, minmax(15rem, 1fr))`,
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
              className="mx-auto max-w-website-xl"
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
              {/* 一行 plan bar：产品名 + 档数 + 个人/全部 + 月付/年付（两组常驻） */}
              <div className="flex flex-wrap items-center justify-between gap-6">
                <div className="flex items-center gap-3">
                  <h1 className="font-brand text-2xl font-semibold leading-tight text-vx-gray-900 dark:text-vx-white md:text-3xl">
                    {model.name}
                  </h1>
                  <span className="hidden rounded-full bg-vx-brand-50 px-3 py-1 text-xs font-semibold text-vx-brand-700 sm:inline-block dark:bg-vx-brand-950/50 dark:text-vx-brand-200">
                    {t("tierCount", { count: model.plans.length })}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  {/* 个人 / 全部 */}
                  <div
                    role="group"
                    aria-label={t("audienceGroupLabel")}
                    className={TOGGLE_GROUP}
                  >
                    {(["person", "all"] as AudienceView[]).map((view) => (
                      <Button
                        key={view}
                        variant={
                          effectiveAudience === view ? "default" : "ghost"
                        }
                        size="md"
                        aria-pressed={effectiveAudience === view}
                        disabled={view === "person" && personPlans.length === 0}
                        onClick={() => setAudience(view)}
                        className="rounded-full px-5"
                      >
                        {t(`audienceToggle.${view}`)}
                      </Button>
                    ))}
                  </div>
                  {/* 月付 / 年付 */}
                  <div
                    role="group"
                    aria-label={t("cycleGroupLabel")}
                    className={TOGGLE_GROUP}
                  >
                    {(["monthly", "yearly"] as BillingCycle[]).map((c) => (
                      <Button
                        key={c}
                        variant={effectiveCycle === c ? "default" : "ghost"}
                        size="md"
                        aria-pressed={effectiveCycle === c}
                        disabled={!cycles.includes(c)}
                        onClick={() => setCycle(c)}
                        className="rounded-full px-5"
                      >
                        {t(`cycle.${c}`)}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>

              {/* 档位卡：三槽位排布，严格一行，窄屏横向滚动。
                  负 margin + 等量 padding 给选中卡的光晕留出血，避免被滚动容器硬裁。 */}
              <div className="-mx-3 mt-8 overflow-x-auto px-3 pb-4 pt-3">
                <div
                  role="radiogroup"
                  aria-label={t("planGroupLabel")}
                  className="grid items-stretch gap-5"
                  style={{ gridTemplateColumns: gridColumns }}
                >
                  {Array.from({ length: leadingPlaceholders }, (_, i) => (
                    <PlanPlaceholderCard key={`lead-${i}`} />
                  ))}
                  {shownPlans.map((plan) => (
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
                      currentTier={currentTier}
                      fractionDigits={fractionDigits}
                    />
                  ))}
                  {Array.from({ length: trailingPlaceholders }, (_, i) =>
                    teamHintInPlaceholder && i === trailingPlaceholders - 1 ? (
                      <TiersSideCard
                        key={`trail-${i}`}
                        icon="users"
                        title={t("ghost.title")}
                        subtitle={teamPlans.map((p) => p.name).join(" · ")}
                        action={t("ghost.viewAll")}
                        onClick={() => setAudience("all")}
                      />
                    ) : (
                      <PlanPlaceholderCard key={`trail-${i}`} />
                    ),
                  )}
                  {showSideCard ? (
                    <TiersSideCard
                      icon="users"
                      title={t("ghost.title")}
                      subtitle={teamPlans.map((p) => p.name).join(" · ")}
                      action={t("ghost.viewAll")}
                      onClick={() => setAudience("all")}
                    />
                  ) : null}
                </div>
              </div>
            </>
          )}
        </div>

        {/* 底部滚动指示（参考首页 hero）：更多权益，查看详情 → 对比区 */}
        {model ? (
          <div className="absolute inset-x-0 bottom-8 z-10 flex justify-center">
            <Button
              type="button"
              variant="ghost"
              onClick={scrollToCompare}
              className="flex h-auto animate-bounce flex-col items-center gap-1 px-4 py-2 font-normal text-vx-gray-500 hover:bg-transparent hover:text-vx-brand-600 dark:text-vx-gray-300 dark:hover:text-vx-brand-200"
            >
              <span className="text-sm">{t("scrollHint")}</span>
              <Icon name="arrow-down" className="h-6 w-6" aria-hidden />
            </Button>
          </div>
        ) : null}
      </section>

      {model ? (
        <>
          {/* ── 板块二：对比区（跟随同一容器全宽；滚动指示落点，留出常驻 header） ── */}
          <section
            id={COMPARE_SECTION_ID}
            className="vx-section-even scroll-mt-16"
          >
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
