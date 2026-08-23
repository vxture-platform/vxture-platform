"use client";

/**
 * ProductTiersSection.tsx - 首页「产品体系」区块（取代原解决方案轮播）
 *
 * 四张卡并排常驻，激活的一张展开占大半宽度并展示完整内容，其余三张收窄、去色、
 * 按环形距离逐级弱化——最远的一张只剩层级编号与一张很淡的示意图，但仍可见、
 * 仍可点，点了就切换。
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
import Image from "next/image";
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

/** 层级编号：弱化态下这是唯一还读得出来的信息，故各态都放在同一位置。 */
function TierIndex({ value, className }: { value: string; className: string }) {
  return (
    <span className={`font-display text-3xl font-bold ${className}`}>
      {value}
    </span>
  );
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
  const isFaintest = distance === 2;
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
       * auto 而让卡回落到内容高度。交给 flex 的默认 align-items: stretch 拉满。 */
      className={`relative shrink-0 grow-0 cursor-pointer overflow-hidden rounded-2xl border border-vx-gray-200 transition-all duration-500 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vx-ring-strong dark:border-vx-gray-700 ${layout?.order} ${layout?.basis} ${layout?.dim}`}
    >
      {/* 弱化态：铺满的示意背景图 + 白纱，只透出编号与（次弱时）竖排名称 */}
      {!isActive ? (
        <>
          <Image
            src={tier.cover}
            alt=""
            fill
            aria-hidden="true"
            sizes="20vw"
            className="object-cover opacity-25"
          />
          <div className="absolute inset-0 bg-vx-white/80 dark:bg-vx-gray-900/80" />
          <div className="relative flex h-full flex-col items-center justify-between py-8">
            <TierIndex
              value={t(`${base}.tier`)}
              className="text-vx-gray-400 dark:text-vx-gray-500"
            />
            {!isFaintest ? (
              <span className="text-base font-semibold tracking-widest text-vx-gray-500 [writing-mode:vertical-rl] dark:text-vx-gray-400">
                {t(`${base}.name`)}
              </span>
            ) : null}
            <Icon
              name="plus"
              className="h-5 w-5 text-vx-gray-400 dark:text-vx-gray-500"
            />
          </div>
        </>
      ) : null}

      {/* 激活态：左文右图。图不铺满再压一层大面积白纱——那样等于把素材浪费掉。 */}
      {isActive ? (
        <div className="relative flex h-full">
          <div className="flex flex-1 flex-col justify-center p-10 lg:p-12">
            <div className="flex items-center gap-4">
              <span
                className={`flex h-12 w-12 items-center justify-center rounded-xl ${tier.chipClass}`}
              >
                <Icon name={tier.icon} className="h-6 w-6" />
              </span>
              <TierIndex value={t(`${base}.tier`)} className={tier.inkClass} />
            </div>

            <h3 className="font-display mt-6 text-3xl font-bold text-vx-gray-900 dark:text-vx-white">
              {t(`${base}.name`)}
            </h3>
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

          {/* 右侧图版。窄屏隐藏：留给文案的宽度已经不够，再切一块图两边都读不清。 */}
          <div className="relative hidden w-2/5 shrink-0 lg:block">
            <Image
              src={tier.cover}
              alt=""
              fill
              aria-hidden="true"
              sizes="40vw"
              className="object-cover"
            />
            {/* 左缘化开，让图与文案衔接而不是硬切一条竖线 */}
            <div className="absolute inset-0 bg-linear-to-r from-vx-white via-transparent to-transparent dark:from-vx-gray-900" />
          </div>
        </div>
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
      <div className="mx-auto flex h-full min-h-screen w-full max-w-7xl flex-col px-4 sm:px-6 lg:px-8 xl:max-w-screen-2xl">
        <div className="pt-28 text-center">
          <h2 className="font-display mb-4 text-3xl font-bold text-vx-brand-700 dark:text-vx-brand-200 lg:text-4xl">
            {t("title")}
          </h2>
          <p className="mx-auto max-w-website-4xl text-lg text-vx-gray-600 dark:text-vx-gray-300">
            {t("subtitle")}
          </p>
        </div>

        {/* 窄屏退回纵向堆叠：四列并排在手机上每列不足 80px，读不出任何东西 */}
        <div className="flex flex-1 flex-col gap-4 py-10 lg:flex-row">
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

        {t("tagline") ? (
          <div className="pb-12 text-center">
            <span className="text-sm font-medium text-vx-brand-500 dark:text-vx-brand-300">
              {t("tagline")}
            </span>
          </div>
        ) : null}
      </div>
    </section>
  );
}
