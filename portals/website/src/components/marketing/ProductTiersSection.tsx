"use client";

/**
 * ProductTiersSection.tsx - 首页「产品体系」区块（取代原解决方案轮播）
 *
 * 四张卡并排常驻，激活的一张展开占 9/12 并展示完整内容（图铺满整卡作背景，
 * 横向渐变蒙版让左侧文案可读、右侧图清晰）；其余三张**同宽**收到最窄一档，
 * 去色并按环形距离分级降透明度，各自保留图标与竖排名称。相邻卡以负外边距
 * 略微叠压，激活卡压在两侧之上。全部保持可见可点，点了就切换。
 *
 * 两个关键取舍：
 *
 * 1. **槽位用 CSS `order`，不重排数组**。要让激活卡居中就得改视觉次序；若改数组
 *    次序，React 会搬动 DOM 节点，宽度过渡随之跳变。`order` 只改视觉排布、节点
 *    不动，`flex-basis` 的过渡才是连续的。
 *
 * 2. **环形取位**。激活卡恒定落在第 2 槽，左右各有弱化卡（前一个 · 激活 ·
 *    后一个 · 最远），因此不会出现「激活在一侧、未激活全堆另一侧」。
 *
 * 排布规则本身在 data 层（TIER_RING_LAYOUT），此处只负责渲染。
 *
 * @package @vxture/website
 * @layer Presentation
 * @category Components - Home
 * @author AI-Generated
 * @date 2026-08-23
 */

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Icon } from "@vxture/design-system";
import { Link } from "@/lib/i18n/navigation";
import {
  PRODUCT_TIERS,
  TIER_RING_LAYOUT,
  tierRingDistance,
  type ProductTier,
} from "@/data/home/home.product-tiers.data";

interface ProductTiersSectionProps {
  readonly id: string;
  readonly name?: string;
}

function TierCard({
  tier,
  index,
  active,
  onActivate,
}: {
  tier: ProductTier;
  index: number;
  active: number;
  onActivate: (index: number) => void;
}) {
  const t = useTranslations("home.productTiers");
  const base = `items.${tier.id}`;
  const distance = tierRingDistance(index, active);
  const layout = TIER_RING_LAYOUT[distance] ?? TIER_RING_LAYOUT[0];
  const isActive = distance === 0;
  const keywords = t.raw(`${base}.keywords`) as string[];

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={isActive}
      aria-label={`${t(`${base}.name`)} — ${t("ui.activate")}`}
      onClick={() => onActivate(index)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onActivate(index);
        }
      }}
      /* 不写 h-full：父行的高度由 flex-1 撑出、自身高度为 auto，h-full 会解析成
       * auto 而让卡回落到内容高度。交给 flex 的默认 align-items: stretch 拉满。
       * -mr-5：让相邻卡略微叠压，层级由 layout.z 决定（激活卡压在两侧之上）。
       * 激活卡 grow：吸收负外边距让出的余量，整行仍然填满。 */
      className={`relative -mr-5 shrink-0 cursor-pointer overflow-hidden rounded-2xl border border-vx-gray-200 shadow-sm transition-all duration-500 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vx-ring-strong dark:border-vx-gray-700 ${
        isActive ? "grow" : "grow-0"
      } ${layout?.order} ${layout?.basis} ${layout?.dim} ${layout?.z}`}
    >
      {/* 弱化态：示意背景图 + 白纱，三张同宽，只用透明度分级；每张都给图标与名称 */}
      {!isActive ? (
        <>
          <div
            className="absolute inset-0 bg-cover bg-center opacity-25"
            style={{ backgroundImage: `url(${tier.cover})` }}
            aria-hidden="true"
          />
          <div className="absolute inset-0 bg-vx-white/80 dark:bg-vx-gray-900/80" />
          {/* 内距刻意对齐激活态（同为 p-10 / lg:p-12），图标因此落在同一水平线，
           * 切换时不会纵向跳动。 */}
          <div className="relative flex h-full flex-col items-center p-10 lg:p-12">
            <span
              className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${tier.chipClass}`}
            >
              <Icon name={tier.icon} className="h-6 w-6" />
            </span>
            <span className="flex flex-1 items-center text-base font-semibold tracking-widest text-vx-gray-500 [writing-mode:vertical-rl] dark:text-vx-gray-400">
              {t(`${base}.name`)}
            </span>
            <Icon
              name="plus"
              className="h-5 w-5 shrink-0 text-vx-gray-400 dark:text-vx-gray-500"
            />
          </div>
        </>
      ) : null}

      {/* 激活态：图铺满整卡作背景，横向渐变蒙版——左侧压到近乎实色保证文案可读，
       * 右侧完全透出让图看得清。文案居顶而非垂直居中。 */}
      {isActive ? (
        <>
          {/* 走 CSS 背景而不是 next/image：`<Image fill>` 放在这张卡里**完全不
           * 参与绘制**——元素有布局（1675×594、complete、opacity 1），但连给它
           * 加的 outline 都画不出来；同一张图换成 CSS background 立刻正常。
           * 卡上那串 transition-all / z / grow / overflow-hidden 里应有触发条件，
           * 但代价与收益不成正比：这是纯装饰底图，放弃 next/image 的响应式
           * srcset 换取「画得出来」是划算的。图本身仍是构建期就存在的静态资源。 */}
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url(${tier.cover})` }}
            aria-hidden="true"
          />
          {/* 左端不压成实色：`from-vx-white`（不透明）会把文案区的底图彻底盖掉，
           * 整张卡左半边变成一块白板。留 10% 让图透出来，文字仍是深色压在
           * ~90% 白上，对比度绰绰有余。 */}
          <div className="absolute inset-0 bg-linear-to-r from-vx-white/92 from-38% via-vx-white/62 via-70% to-transparent dark:from-vx-gray-900/92 dark:via-vx-gray-900/62" />

          <div className="relative flex h-full">
            <div className="flex max-w-website-2xl flex-col justify-start p-10 lg:p-12">
              <div className="flex items-center gap-4">
                <span
                  className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${tier.chipClass}`}
                >
                  <Icon name={tier.icon} className="h-6 w-6" />
                </span>
                <h3 className="font-display text-3xl font-bold text-vx-gray-900 dark:text-vx-white">
                  {t(`${base}.name`)}
                </h3>
              </div>
              <p className={`mt-2 text-base font-semibold ${tier.inkClass}`}>
                {t(`${base}.summary`)}
              </p>
              <p className="mt-4 text-sm leading-7 text-vx-gray-600 dark:text-vx-gray-300">
                {t(`${base}.description`)}
              </p>

              <div className="mt-6 flex flex-wrap gap-2">
                {keywords.map((keyword) => (
                  <Badge
                    key={keyword}
                    variant="secondary"
                    className="px-3 py-1.5"
                  >
                    {keyword}
                  </Badge>
                ))}
              </div>

              <div className="mt-8">
                {/* 卡本身是切换控件，按钮要阻止冒泡，否则点链接会同时触发切换 */}
                <Button
                  asChild
                  size="lg"
                  className="px-5"
                  onClick={(event) => event.stopPropagation()}
                >
                  <Link href={tier.href}>
                    {t(`${base}.action`)}
                    <Icon name="arrow-right" className="h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

export default function ProductTiersSection({
  id,
  name = "ProductTiers",
}: ProductTiersSectionProps) {
  const t = useTranslations("home.productTiers");
  const [active, setActive] = useState(0);
  const onActivate = useCallback((index: number) => setActive(index), []);

  return (
    <section
      id={id}
      data-name={name}
      className="vx-section-even snap-section flex min-h-screen flex-col"
    >
      {/* 栏宽与首页其余 section 一致。曾试过放宽到满幅，激活卡会占到视口 87%，
       * 过头了——现在靠压窄未激活卡（定宽 96px）把余量让给激活卡，而不是靠撑破
       * 整页栏宽。 */}
      <div className="mx-auto flex h-full min-h-screen w-full max-w-7xl flex-col px-4 sm:px-6 lg:px-8 xl:max-w-screen-2xl">
        <div className="pt-28 text-center">
          <h2 className="font-display mb-4 text-3xl font-bold text-vx-brand-700 dark:text-vx-brand-200 lg:text-4xl">
            {t("title")}
          </h2>
          <p className="mx-auto max-w-website-4xl text-lg text-vx-gray-600 dark:text-vx-gray-300">
            {t("subtitle")}
          </p>
        </div>

        {/* 窄屏退回纵向堆叠：四列并排在手机上每列不足 80px，读不出任何东西。
         * 横向不设 gap——卡间距由各卡的负外边距给出叠压效果。 */}
        <div className="flex flex-1 flex-col gap-4 py-10 lg:flex-row lg:gap-0 lg:pr-5">
          {PRODUCT_TIERS.map((tier, index) => (
            <TierCard
              key={tier.id}
              tier={tier}
              index={index}
              active={active}
              onActivate={onActivate}
            />
          ))}
        </div>

        {/* 底部 tagline：两侧横线的写法与首页其余 section 一致 */}
        {t("tagline") ? (
          <div className="pb-12 text-center">
            <div className="inline-flex items-center space-x-2">
              <div className="h-0.5 w-8 bg-linear-to-r from-transparent to-vx-brand-200 dark:to-vx-brand-600"></div>
              <span className="text-sm font-medium text-vx-brand-500 dark:text-vx-brand-300">
                {t("tagline")}
              </span>
              <div className="h-0.5 w-8 bg-linear-to-l from-transparent to-vx-brand-200 dark:to-vx-brand-600"></div>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
