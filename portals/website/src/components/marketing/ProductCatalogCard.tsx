"use client";

/**
 * ProductCatalogCard.tsx - 产品目录卡（/products 产品矩阵 与 /appcenter 智能体广场共用）
 *
 * 2026-09-02 之前两页各画一份几乎相同的卡，动作区已经漂移：已订阅态的「升级」直跳
 * console 结账页（系统替客户挑"下一档"，客户没看过价格与功能；顶档也照样显示），
 * 「进入工作台」跳的是 console 首页而不是产品本身。owner 要求两页的布局 / 逻辑 /
 * 按钮 / 跳转目标 / 卡片信息完全一致——所以收成一个组件，两页只负责喂数据与文案。
 *
 * 动作区裁定（按「是否已上线」× 订阅态）：
 *   还没上线                → 「敬请期待」禁用（生命周期 developing 或承诺等级 preview）；
 *   未登录 / 未订阅        → 「订阅」（官网 /pricing?product=，先看价再登录）；「联系我们」已从卡上去掉，
 *                           hero 统一给「预约演示 / 业务咨询」（owner 2026-09-03）；
 *                           右上角按 marketing.recommend 画 1–3 枚推荐奖章（最靠外的位置，其余徽标前移让位）；
 *   已订阅                → 「升级」（同一个 /pricing：登录后该页会标出当前档、只放行更高档；
 *                           只在 canUpgrade 时出现）+ 「进入」。
 *
 * 「进入」的目标是**产品本身**（product_webhooks.home_url，如 vxtpl.vxture.com），
 * 不是 console：console 是订阅管理台，从一个产品的卡片点进去落到管理台是错的落点
 * （owner 2026-09-02：「我从产品进入，为什么是工作台，不是产品本身」）。产品没登记
 * 入口就如实禁用「入口即将开放」，不偷偷改跳别处。
 * 徽标：还没上线的给一枚灰「预览版」；否则 承诺等级（正式版 / 公测版 / 停售中）
 * + 已订阅时「已开通」+ 档位。
 *
 * 所有指向产品站的链接 target=_blank + rel=noopener noreferrer（营销页不走掉）。
 *
 * @package @vxture/website
 * @layer Presentation
 * @category Components - Marketing
 */

import { useWebsiteDateFormat } from "@/lib/date-format";
import { Button, Icon } from "@vxture/design-system";
import type { IconName } from "@vxture/design-system";
import { Link } from "@/lib/i18n/navigation";
import type { ProductSubscriptionState } from "@/api/subscription.api";

/** 卡片数据（两页各自从目录 + marketing jsonb 算好后传入）。 */
export interface ProductCatalogCardModel {
  code: string;
  name: string;
  /**
   * 第一行那句话：两页统一先取 marketing.tagline（Ln 定位就写在它开头），没录才回落到
   * 类型词条（/products 用 catalog.types，/appcenter 用 agents.kinds）。
   * 2026-09-24 之前 /products 只用静态词条，运营设的 Ln 在那一页不显示。
   */
  typeLabel: string;
  icon: IconName;
  description: string;
  /** 业务价值（marketing.value）；无则不画。 */
  value: string | null;
  /** 能力亮点（marketing.highlights）。 */
  highlights: string[];
  /** 承诺等级轴：stable / beta / preview / sunset。只管徽标，不管能不能订。 */
  releaseStage: string;
  /**
   * 生命周期轴：`active` 已上线 / `developing` 开发中（信息已登记、东西还没建好）。
   * 「能不能订」认这一根——理由见下面 `notLive` 处的注释。
   */
  status: "active" | "developing";
  version: string | null;
  /** 对外发布时间（ISO）；底部「v x.y.z at 日期」用，无则只显示版本。 */
  releasedAt: string | null;
  /** 预期发布日期（marketing.expectedReleaseAt，运营手填）；开发中的卡底部「预期发布：日期」。 */
  expectedReleaseAt: string | null;
  /** 推荐度 0–3（marketing.recommend）：未订阅时右上角按数量画奖章。 */
  recommend: number;
  /**
   * 订阅入口三态（owner 2026-09-22）：public 有公开可买的档 / invite 只有邀请档 /
   * none 一档都没有。
   *
   * 这颗按钮原先只按成熟度 × 订阅态决定，**不知道有没有公开可买的档**——把一个产品
   * 的档全改成邀请订阅之后，卡上照样写「订阅」，点进去落到「暂未开放订阅」。入口与
   * 落地页各说各话，而错的是入口在承诺一件做不到的事。
   */
  subscribeAccess: "public" | "invite" | "none";
}

/** 卡片文案——两页各自的命名空间里键名相同，形状在这里定死。 */
export interface ProductCatalogCardLabels {
  valueLabel: string;
  badges: {
    stable: string;
    beta: string;
    active: string;
    preview: string;
    sunset: string;
  };
  /** 推荐度奖章的无障碍名（{count} 枚）。 */
  recommended: string;
  /** 底部版本行「v {version} at {date}」。 */
  versionAt: string;
  /** 开发中的底部行「预期发布：{date}」。 */
  expectedRelease: string;
  actions: {
    subscribe: string;
    /** 只有邀请档时按钮的字样（落地页会讲清怎么拿到邀请）。 */
    inviteSubscribe: string;
    /** 一档都没有时的禁用按钮字样 + 悬停原因。 */
    notForSale: string;
    upgrade: string;
    /** 「进入」——目标是产品自己的站点（home_url）。 */
    enter: string;
    /** 产品未登记入口时的禁用态文案。 */
    noEntry: string;
    detail: string;
    coming: string;
  };
}

export function ProductCatalogCard({
  product,
  subscription,
  labels,
}: {
  product: ProductCatalogCardModel;
  /** 登录租户在该产品上的代表订阅态；未登录 / 未订阅为 undefined。 */
  subscription: ProductSubscriptionState | undefined;
  labels: ProductCatalogCardLabels;
}) {
  /*
   * 「还没上线」——卡片上所有「不可订」的呈现都由它决定（灰徽标、不给奖章、底部改写
   * 「预期发布」、动作区给禁用的「敬请期待」）。
   *
   * 两根轴都算，而**生命周期那一根是真判据**：
   *
   *   · `status === "developing"` 东西还没建好。定价/套餐端点（website-bff 的
   *     product-plans）按 `status = 'active'` 过滤产品，所以这种产品的定价页是空的
   *     ——卡上若给「订阅」，客户点进去落到一张空阶梯。**入口承诺一件做不到的事**，
   *     与 owner 2026-09-22 定 `subscribeAccess` 时说的是同一个毛病。
   *   · `releaseStage === "preview"` 承诺等级最低那一档。2026-10-29 由旧名改来；在
   *     生命周期轴接进官网之前（2026-09-24），它一直**替**那根轴干这件事。保留它是
   *     因为存量数据里「还没上线」就记在这儿。
   *
   * 为什么不只留 `preview` 一条：那要靠两根轴永远一致，而没有任何机械约束保证它们
   * 一致。它们一分叉，症状就是上面那颗假按钮。
   *
   * 反过来，灰徽标的字面（`badges.preview`「预览版」）仍借用承诺等级那个词。这是有
   * 意的：一个还没上线的产品，其承诺等级本就该登记为 `preview`（admin 侧 2026-09-24
   * 起允许把它降回去，正是为了让这条订正做得到）。与按钮的区别在后果——两轴分叉时
   * 按钮会把人带进死路，徽标只是措辞偏了一格。
   */
  const notLive =
    product.status === "developing" || product.releaseStage === "preview";
  const subscribed = !notLive && subscription?.subscribed === true;
  const tierLabel =
    subscribed && subscription?.tier
      ? subscription.tier.charAt(0).toUpperCase() + subscription.tier.slice(1)
      : null;
  /* 按值取徽标。此前是 beta / 其它 二选一，加了 sunset 之后那种写法会把「停售中」
     显示成「正式版」——错得静默，而停售恰恰是最该让人看见的一档。 */
  const stageBadge =
    product.releaseStage === "beta"
      ? labels.badges.beta
      : product.releaseStage === "sunset"
        ? labels.badges.sunset
        : labels.badges.stable;
  const productHomeUrl = subscription?.homeUrl ?? null;
  const pricingHref = `/pricing?product=${product.code}`;
  // 推荐度奖章只给「可订、未订阅」的产品——已开通的不用再推，开发中的还不能订。
  const medals = !notLive && !subscribed ? product.recommend : 0;
  // 底部左侧一行（owner 2026-09-03）：
  //   上线（ga/beta）→ 「v 1.2.3 at 2026/9/12」，版本与发布时间取目录真列，自动；
  //   开发中           → 「预期发布：2026/9/30」，日期由运营在营销内容里手填（marketing.expectedReleaseAt）。
  // 日期按 locale 数字格式（zh 不补零：2026/9/12）。
  /* 形态收在 lib/date-format:输出与此前逐字相同(按 locale 数字格式、不补零),
     只是不再各组件各搓一个 Intl——豁免按组件增长会让 §1 那条判据一路失效。 */
  const { numericDate: formatDate } = useWebsiteDateFormat();
  const versionLine = notLive
    ? product.expectedReleaseAt
      ? labels.expectedRelease.replace(
          "{date}",
          formatDate(product.expectedReleaseAt),
        )
      : null
    : product.version
      ? product.releasedAt
        ? labels.versionAt
            .replace("{version}", product.version)
            .replace("{date}", formatDate(product.releasedAt))
        : `v ${product.version}`
      : null;

  return (
    <article className="vx-agent-marketplace-card flex flex-col rounded-lg border border-vx-gray-200 bg-vx-white p-5 shadow-sm transition hover:border-vx-brand-200 hover:shadow-md dark:border-vx-gray-800 dark:bg-vx-gray-900 dark:hover:border-vx-brand-500/30">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-vx-brand-50 text-vx-brand-600 dark:bg-vx-brand-950/50 dark:text-vx-brand-200">
            <Icon name={product.icon} className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs font-semibold text-vx-brand-600 dark:text-vx-brand-300">
              {product.typeLabel}
            </p>
            <h3 className="mt-1 text-lg font-semibold text-vx-gray-900 dark:text-vx-white">
              {product.name}
            </h3>
          </div>
        </div>
        {notLive ? (
          <span className="shrink-0 rounded-full border border-vx-gray-200 bg-vx-gray-50 px-2.5 py-1 text-xs font-medium text-vx-gray-500 dark:border-vx-gray-700 dark:bg-vx-gray-800/60 dark:text-vx-gray-400">
            {labels.badges.preview}
          </span>
        ) : (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
            <span className="rounded-full border border-vx-info-100 bg-vx-info-50 px-2.5 py-1 text-xs font-medium text-vx-info-700 dark:border-vx-info-400/20 dark:bg-vx-brand-950/30 dark:text-vx-info-200">
              {stageBadge}
            </span>
            {subscribed ? (
              <span className="rounded-full border border-vx-success-200 bg-vx-success-50 px-2.5 py-1 text-xs font-medium text-vx-success-600 dark:border-vx-success-300/30 dark:bg-vx-success-900/30 dark:text-vx-success-300">
                {labels.badges.active}
              </span>
            ) : null}
            {tierLabel ? (
              <span className="rounded-full border border-vx-brand-200 bg-vx-brand-50 px-2.5 py-1 text-xs font-semibold text-vx-brand-700 dark:border-vx-brand-400/30 dark:bg-vx-brand-950/40 dark:text-vx-brand-200">
                {tierLabel}
              </span>
            ) : null}
            {/* 推荐度奖章：右上角最靠外（最优位），其余徽标整体前移让位。 */}
            {medals > 0 ? (
              <span
                role="img"
                aria-label={labels.recommended.replace(
                  "{count}",
                  String(medals),
                )}
                title={labels.recommended.replace("{count}", String(medals))}
                className="inline-flex items-center gap-0.5 rounded-full border border-vx-warning-200 bg-vx-warning-50 px-2 py-1 text-vx-warning-600 dark:border-vx-warning-300/30 dark:bg-vx-warning-900/30 dark:text-vx-warning-300"
              >
                {Array.from({ length: medals }, (_, i) => (
                  <Icon
                    key={i}
                    name="medal"
                    className="h-3.5 w-3.5"
                    aria-hidden
                  />
                ))}
              </span>
            ) : null}
          </div>
        )}
      </div>

      {product.description ? (
        <p className="mt-5 text-sm leading-6 text-vx-gray-600 dark:text-vx-gray-300">
          {product.description}
        </p>
      ) : null}
      {/* 业务价值来自 DB marketing；没录入就不画空框 */}
      {product.value ? (
        <div className="mt-5 rounded-md border border-vx-brand-100 bg-vx-brand-50/50 p-4 dark:border-vx-brand-400/15 dark:bg-vx-brand-950/20">
          <p className="text-xs font-semibold text-vx-brand-600 dark:text-vx-brand-300">
            {labels.valueLabel}
          </p>
          <p className="mt-2 text-sm leading-6 text-vx-gray-700 dark:text-vx-gray-200">
            {product.value}
          </p>
        </div>
      ) : null}
      {/* 能力亮点（marketing.highlights）——有就以标签排布 */}
      {product.highlights.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {product.highlights.map((h) => (
            <span
              key={h}
              className="rounded-full bg-vx-gray-100 px-2.5 py-0.5 text-xs font-normal text-vx-gray-600 dark:bg-vx-gray-800 dark:text-vx-gray-300"
            >
              {h}
            </span>
          ))}
        </div>
      ) : null}

      {/* 底部一行（owner 2026-09-03）：左 = 「v 1.2.3 at 2026/9/12」；
          右 = 产品介绍 · {订阅 | 升级} · 进入，按订阅态显示。 */}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-5">
        <span className="text-xs font-normal tabular-nums text-vx-gray-400 dark:text-vx-gray-500">
          {versionLine}
        </span>
        <div className="flex items-center gap-2">
          <Link
            href={`/products/${product.code}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-10 items-center px-1 text-xs font-normal text-vx-gray-400 underline-offset-4 transition hover:text-vx-gray-600 hover:underline dark:text-vx-gray-500 dark:hover:text-vx-gray-300"
          >
            {labels.actions.detail}
          </Link>
          {notLive ? (
            <Button variant="outline" size="md" disabled className="h-10">
              {labels.actions.coming}
            </Button>
          ) : subscribed ? (
            <>
              {subscription?.canUpgrade ? (
                <Button asChild variant="outline">
                  <Link href={pricingHref} target="_blank">
                    {labels.actions.upgrade}
                  </Link>
                </Button>
              ) : null}
              {productHomeUrl ? (
                <Button asChild>
                  <a
                    href={productHomeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {labels.actions.enter}
                  </a>
                </Button>
              ) : (
                <Button disabled title={labels.actions.noEntry}>
                  {labels.actions.noEntry}
                </Button>
              )}
            </>
          ) : (
            <>
              {/* 未订阅：先去官网定价页看价格 + 功能，登录后置。
                  「联系我们」不再放卡上——hero 已统一给「预约演示 / 业务咨询」（owner 2026-09-03）。

                  三态各给各的落点：能自助买的去定价页；只有邀请档的仍去同一页——
                  那页会讲清「此产品为邀请订阅」与怎么拿到邀请，所以不是假动作；
                  一档都没有的给禁用按钮 + 悬停写明原因，而不是把人送进一个空页面。 */}
              {product.subscribeAccess === "none" ? (
                <Button disabled title={labels.actions.notForSale}>
                  {labels.actions.notForSale}
                </Button>
              ) : (
                <Button
                  asChild
                  variant={
                    product.subscribeAccess === "invite" ? "outline" : "default"
                  }
                >
                  <Link href={pricingHref} target="_blank">
                    {product.subscribeAccess === "invite"
                      ? labels.actions.inviteSubscribe
                      : labels.actions.subscribe}
                  </Link>
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </article>
  );
}
