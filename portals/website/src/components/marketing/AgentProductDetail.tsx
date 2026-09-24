"use client";

/**
 * AgentProductDetail.tsx —— L3 智能体的产品详情页，**整页由产品登记的营销内容驱动**。
 *
 * @package @vxture/website
 * @layer Presentation
 * @category Components - Marketing
 *
 * ## 它存在的理由
 *
 * owner 定的一条铁律:**接一个产品上线，不得需要平台更新代码。** L1/L2 的平台产品是例外
 * ——那几页需要单独设计，走代码级修改；而 L3 智能体会越来越多，每接一个写一页是不可持续的。
 *
 * 此前官网只有一条硬编码的出口:`DETAILED_PRODUCT = "arda"`，其余目录产品一律落「敬请
 * 期待」。**13 个智能体的营销内容早就录进库、也早就经 website-bff 送到了官网，被这一行
 * 扔掉。** 这个件把那条路打通。
 *
 * ## 为什么不需要扩 schema
 *
 * 实测 13 个 agent 产品在 `tagline` / `value` / `highlights` / `tags` / `industries`
 * 上都是 13/13（`detail` 是 0/13，长文还没人写）。现有五个字段撑得起一页，所以这一版
 * 不动 `marketing` 结构、不动 admin 的录入框——**能不扩就不扩**:schema 一扩，admin 那个
 * 「非技术人员友好」的编辑框就得跟着长出重复组编辑器，否则接新产品只是从「要改代码」
 * 变成「要写 SQL」，规则照样不成立。
 *
 * `detail` 留着位置:它有值就渲染，没有就不占地方。全站还没有 markdown 渲染器，所以按
 * 段落切分纯文本——一个能录进去的字段，胜过一个要先装依赖才能用的字段。
 *
 * ## 判族靠类型不靠点名
 *
 * 调用方用 `isAgentProduct()`，它按 `_agent` **后缀**归族（`general_agent` /
 * `industry_agent` / 将来的子型），不是一张产品码清单。新增一个子型这里一个字不用改
 * ——那正是这一页要兑现的性质。
 *
 * 排版：hero 走 CatalogHero（与 /appcenter 同一款，2026-09-24 旧 hero 壳全面退役），
 * 不自造:同域已有成稿的地方照抄，是这个仓的规矩。
 */

import { useLocale, useTranslations } from "next-intl";
import { Button, Icon } from "@vxture/design-system";
import { Link } from "@/lib/i18n/navigation";
import {
  catalogDisplayName,
  marketingForLocale,
  type ProductCatalogItem,
} from "@/api/product-catalog.api";
import { CatalogHero, catalogHeroGhostButtonClass } from "./CatalogHero";
import { productTypeKey } from "./product-catalog-view";

interface AgentProductDetailProps {
  readonly product: ProductCatalogItem;
}

export default function AgentProductDetail({
  product,
}: AgentProductDetailProps) {
  const t = useTranslations("products");
  const locale = useLocale();
  const m = marketingForLocale(product.marketing, locale);

  const name = catalogDisplayName(product, locale);
  /* eyebrow 优先用登记的 tagline（实测多是「数字员工 · 通用类」这类定位语），缺了退回
     目录类型标签——不退回产品码:那是内部标识，不该出现在营销页上。 */
  const eyebrow =
    m?.tagline?.trim() ||
    t(`catalog.types.${productTypeKey(product.productType)}`);
  /*
   * 还没上线的产品不给「预约演示」那颗按钮——它跳 `/pricing?product=`，而定价端点
   * 按 `status = 'active'` 过滤产品，落地就是一张空阶梯。判据与产品卡的 `notLive`
   * 同源（生命周期 developing 或承诺等级 preview），理由见 ProductCatalogCard。
   *
   * 换成禁用的「敬请期待」，而不是悄悄改跳别处：这一页存在的意义就是介绍一个还没
   * 上线的产品，「业务咨询」那颗按钮照旧可用，想聊的人有路可走。
   */
  const notLive =
    product.status === "developing" || product.releaseStage === "preview";
  /* 导语用登记的业务价值，退回目录 description。两者都空时不渲染这一段，而不是留一行空白。 */
  const lead = m?.value?.trim() || product.description?.trim() || "";
  const highlights = (m?.highlights ?? []).filter((x) => x.trim());
  const tags = (m?.tags ?? []).filter((x) => x.trim());
  const industries = (m?.industries ?? []).filter((x) => x.trim());
  /* 没有 markdown 渲染器，所以按空行切段。装一个依赖只为渲染一个目前 0/13 有值的字段，
     不划算;等真有人写长文再说。 */
  const detailParagraphs = (m?.detail ?? "")
    .split(/\n{2,}/)
    .map((x) => x.trim())
    .filter(Boolean);

  return (
    <div className="vx-page-surface">
      {/*
       * hero 用 /appcenter 那一款（CatalogHero）：owner 2026-09-24「完全采用 appcenter
       * 的 herosection」「点线动图效果——完全复用新款」「包括 herosection 的高度」。
       * 旧壳（.vx-hero-section ＋满强度 AnimatedHeroBg）已全面退役。
       *
       * 按钮不跟着目录页走：这一页那颗是「订阅 / 敬请期待」（按 notLive 分叉），
       * 目录页那颗是「预约演示」——语义不同，所以走 actions 口子整块替换。
       */}
      <CatalogHero
        eyebrow={eyebrow}
        title={name}
        description={lead || undefined}
        highlights={highlights}
        actions={
          <>
            {notLive ? (
              <Button size="xl" className="px-5" disabled>
                {t("catalog.actions.coming")}
              </Button>
            ) : (
              <Button asChild size="xl" className="px-5 hover:bg-vx-brand-500">
                <Link href={`/pricing?product=${product.productCode}`}>
                  {t("catalog.demoCta")}
                </Link>
              </Button>
            )}
            <Button
              asChild
              variant="ghost"
              size="xl"
              className={catalogHeroGhostButtonClass}
            >
              <Link href="/contact">{t("catalog.consultCta")}</Link>
            </Button>
          </>
        }
      />

      {detailParagraphs.length > 0 ? (
        <section className="mx-auto max-w-website-3xl px-6 py-16">
          <h2 className="font-brand text-2xl font-bold text-vx-gray-900 dark:text-vx-white">
            {t("agentDetail.detailLabel")}
          </h2>
          <div className="mt-6 space-y-4">
            {detailParagraphs.map((para) => (
              <p
                key={para.slice(0, 32)}
                className="text-sm leading-7 text-vx-gray-700 dark:text-vx-gray-200"
              >
                {para}
              </p>
            ))}
          </div>
        </section>
      ) : null}

      {industries.length > 0 || tags.length > 0 ? (
        <section className="mx-auto max-w-website-3xl px-6 pb-16">
          <div className="grid gap-8 md:grid-cols-2">
            {industries.length > 0 ? (
              <div>
                <h2 className="font-brand text-lg font-bold text-vx-gray-900 dark:text-vx-white">
                  {t("agentDetail.industriesLabel")}
                </h2>
                <div className="mt-4 flex flex-wrap gap-2">
                  {industries.map((item) => (
                    <span
                      key={item}
                      className="rounded-full border border-vx-gray-200 px-3 py-1 text-sm text-vx-gray-700 dark:border-vx-white/20 dark:text-vx-gray-200"
                    >
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            {tags.length > 0 ? (
              <div>
                <h2 className="font-brand text-lg font-bold text-vx-gray-900 dark:text-vx-white">
                  {t("agentDetail.tagsLabel")}
                </h2>
                <div className="mt-4 flex flex-wrap gap-2">
                  {tags.map((item) => (
                    <span
                      key={item}
                      className="rounded-full border border-vx-gray-200 px-3 py-1 text-sm text-vx-gray-700 dark:border-vx-white/20 dark:text-vx-gray-200"
                    >
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="mx-auto max-w-website-3xl px-6 pb-20">
        <Link
          href="/appcenter"
          className="inline-flex items-center gap-2 text-sm font-medium text-vx-brand-700 hover:text-vx-brand-500 dark:text-vx-info-200"
        >
          <Icon name="arrow-left" size="sm" aria-hidden="true" />
          {t("catalog.backAppcenter")}
        </Link>
      </section>
    </div>
  );
}
