"use client";

/**
 * hubCards.tsx — 产品订阅总览页的两类产品卡（product_330 定稿）。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * 严格 DS 组合件拼装，无自造样式层（owner 2026-08-20 评审）：
 * 卡体 = Card（veil 底纹由 surface 档自带）；卡底行 = CardFooter
 * （自带虚线 hairline + mt-auto 下对齐）；进度 = Progress；徽章 = Badge /
 * StatusBadge。概览统计不在本文件——页面直接用 DS MetricGrid（同 /billing）。
 *
 * 1) SubscriptionProductCard：「我的订阅」卡。★ = 收藏（排序优先）；操作区
 *    规则（owner 2026-09-03 P0）：「管理」撤掉（它只是跳回本页）；free/starter
 *    追加「升级」——外链官网 /pricing 先看档位与价格再下单，不再直落 console
 *    结账页；剩余 ≤5 天或已过期追加续订（主按钮）；自动续费状态正向显示
 *    （开 / 到期不续），free 档与普通订阅一样可开可关；「最新版 vX.Y.Z」纯文本——平台只有一套最新实例，版本恒为
 *    当前发布号（products.release_version），随产品更新自动跟进，展示它是
 *    为了传达「持续创新」，不随订阅冻结。
 *    订阅动作由详情页承接。
 */

import { useLocale, useTranslations } from "next-intl";
import {
  ActionMenu,
  Badge,
  Button,
  Card,
  CardContent,
  CardFooter,
  Icon,
  Progress,
  StatusBadge,
  cn,
} from "@vxture/design-system";
import type { ActionMenuItem, IconName } from "@vxture/design-system";
import { Link } from "@/lib/i18n/navigation";
import {
  buildWebsitePricingUrl,
  buildWebsiteProductUrl,
} from "@/lib/website-entry";
import type { SubscribedProduct } from "@/api/console-bff";
import { useConfirmLabels } from "@/lib/destructive";
import {
  SUB_STATUS_TONES,
  TIER_AUDIENCE,
  cyclePercent,
  daysLeft,
  productInitials,
  type PlanAudience,
} from "./hubModel";
import { useDateFormat } from "@/lib/use-date-format";

const AUDIENCE_ICON: Record<PlanAudience, IconName> = {
  person: "user",
  team: "users",
  private: "buildings",
};

/** 到期临界：剩余 ≤5 天出续订主按钮（owner 定稿）。 */
const RENEW_THRESHOLD_DAYS = 5;

// ============================================================================
// 收藏 ★
// ============================================================================

function FavoriteStar({
  active,
  busy,
  onToggle,
  labelOn,
  labelOff,
}: {
  active: boolean;
  busy: boolean;
  onToggle: () => void;
  labelOn: string;
  labelOff: string;
}) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      disabled={busy}
      aria-pressed={active}
      aria-label={active ? labelOn : labelOff}
      onClick={onToggle}
      className={cn(
        "shrink-0",
        active ? "text-warning-text" : "text-muted-foreground",
      )}
    >
      <Icon name="star" size="sm" />
    </Button>
  );
}

/** 产品字母牌（icon_url 未接入前的缺省底板，规格同 CyclePicker 的 icon 底板）。 */
function ProductGlyph({
  name,
  code,
}: {
  name: string | null;
  code: string | null;
}) {
  return (
    <span
      aria-hidden="true"
      className="flex size-control-md shrink-0 items-center justify-center rounded-lg bg-primary-muted-hover text-label-sm font-semibold text-primary-hover"
    >
      {productInitials(name, code)}
    </span>
  );
}

// ============================================================================
// 「我的订阅」产品卡
// ============================================================================

export function SubscriptionProductCard({
  item,
  favoriteBusy,
  onToggleFavorite,
  onSetAutoRenew,
  onUnsubscribe,
  canManage = true,
}: {
  item: SubscribedProduct;
  favoriteBusy: boolean;
  onToggleFavorite: (productCode: string, next: boolean) => void;
  /** 到期不续 / 恢复续费(P0 自助;仅永久订阅(无 end_at)不适用,free 同普通订阅) */
  onSetAutoRenew: (item: SubscribedProduct, enabled: boolean) => void;
  /** 立即退订(危操作,父页出确认弹窗) */
  /**
   * 退订的落锤。**返回 Promise**：确认由本件的菜单项承担（DS 的 `confirm`），
   * 而"成功才关框、失败不关"要靠这个 Promise 的结局来判。
   *
   * 契约是 2026-08-25 从 `(item) => void` 改过来的：此前确认框在父组件里，
   * 于是"退订会怎样"这句话和触发它的菜单项分居两处。责任归位之后，父组件只
   * 负责"做这件事"，不再负责"问一句"。
   */
  onUnsubscribe: (item: SubscribedProduct) => Promise<void>;
  /** tenant.billing.manage:无码时不出续费开关与退订菜单(与 BFF 守卫同码)。 */
  canManage?: boolean;
}) {
  const { fmtDate } = useDateFormat();

  const t = useTranslations("subscriptionHub");
  const withLabels = useConfirmLabels();
  const locale = useLocale();

  const audience = item.tier ? TIER_AUDIENCE[item.tier] : undefined;
  const left = daysLeft(item.endAt);
  const expired = item.status === "expired";
  const percent = cyclePercent(item.startAt, item.endAt);
  const nearExpiry = !expired && left != null && left <= RENEW_THRESHOLD_DAYS;
  const showUpgrade =
    !expired && (item.tier === "free" || item.tier === "starter");
  const showRenew = expired || nearExpiry;
  const productCode = item.productCode ?? "";
  // 续费开关适用面:有界周期、未终态。free 档与普通订阅一样按周期到期、可开可关
  // （owner 2026-09-03 决策 5）；此前按 kind==='paid' 判，而 free 订单入库 kind 写死
  // 'paid'，两个判据打架，free 卡永远显示「到期不续」却又不给开关。
  const renewToggleable = !expired && item.endAt !== null;
  const optedOut = !item.autoRenew && item.endAt !== null && !expired;
  const autoRenewOn = item.autoRenew && item.endAt !== null && !expired;

  const menuItems: ActionMenuItem[] = [
    optedOut
      ? {
          id: "renew-on",
          label: t("card.autoRenewOn"),
          disabled: !renewToggleable,
          onSelect: () => onSetAutoRenew(item, true),
        }
      : {
          id: "renew-off",
          label: t("card.autoRenewOff"),
          disabled: !renewToggleable,
          ...(renewToggleable ? {} : { hint: t("card.autoRenewNa") }),
          onSelect: () => onSetAutoRenew(item, false),
        },
    {
      id: "unsubscribe",
      label: t("card.unsubscribe"),
      danger: true,
      disabled: expired,
      confirm: withLabels({
        verb: t("card.unsubscribeVerb"),
        target: item.productName ?? "",
        consequence: t("card.unsubscribeConsequence"),
        cancelLabel: t("card.unsubscribeKeep"),
        onConfirm: () => onUnsubscribe(item),
      }),
    },
  ];

  return (
    <Card surface="base" className="gap-md py-lg">
      <CardContent className="flex flex-1 flex-col gap-md">
        {/* ── 标题区 + 状态区 ────────────────────────────────────────────
            owner 2026-09-09:服务状态**放右上角**,不与特性徽章混在一起。
            混在一起时「服务中」和「专业版」「按年」长得一样重,而它们回答的是
            完全不同的问题——一个是「这东西现在还给不给我用」,另外几个是
            「它是什么」。放右上角是因为那是卡片上视线第二个到的位置
            （第一个是名字）。★ 紧随其后:它是操作,比状态轻一档。 */}
        <div className="flex items-start gap-md">
          <ProductGlyph name={item.productName} code={item.productCode} />
          <span className="min-w-0 flex-1">
            {/* 右侧控件与**主标题同一行盒**。
                此前它们是两行标题块的兄弟节点,靠 `items-center` 对齐——于是对到的是
                「名字 + 副名」两行的中线,看起来比标题低半行(owner 2026-09-09 指出)。
                加偏移量能盖住,但换个字号或副名换行就又歪了。放进同一个 flex 行里,
                「同高」就成了结构决定的,不是调出来的。
                星是 icon-sm 按钮、比一行文字高,所以这一行用 items-center:
                标题对到按钮中线,两者视觉上齐平。 */}
            <span className="flex items-center gap-sm">
              <span className="min-w-0 flex-1 truncate text-label-md text-foreground">
                {item.productName ?? item.planName}
              </span>
              <StatusBadge tone={SUB_STATUS_TONES[item.status] ?? "neutral"}>
                {t(`subStatus.${item.status}`)}
              </StatusBadge>
              <FavoriteStar
                active={item.favorite}
                busy={favoriteBusy || !productCode}
                onToggle={() => onToggleFavorite(productCode, !item.favorite)}
                labelOn={t("favorite.remove")}
                labelOff={t("favorite.add")}
              />
            </span>
            <span className="block truncate text-body-sm text-muted-foreground">
              {item.productNick ?? item.planName}
            </span>
          </span>
        </div>

        {/* ── 信息区:它是什么(档位 / 受众·席位 / 周期)──────────────────
            这一行现在只剩「是什么」,状态已经移走。 */}
        <div className="flex flex-wrap items-center gap-xs">
          {item.tier ? (
            <Badge variant="secondary">{t(`tier.${item.tier}`)}</Badge>
          ) : null}
          {audience ? (
            <Badge variant="outline" className="gap-2xs">
              <Icon name={AUDIENCE_ICON[audience]} size="xs" aria-hidden />
              {item.seats != null
                ? t(`audienceSeats.${audience}`, { seats: item.seats })
                : t(`audience.${audience}`)}
            </Badge>
          ) : null}
          {/* 周期就是周期:¥0 档同样是按月/按年的订阅,把这一格换成「免费」是错两次
              ——既不是周期,又把一个短期验证价说成了产品形态(owner 2026-09-07)。 */}
          <Badge variant="outline">
            {item.cycleUnit === "year" ? t("cycle.year") : t("cycle.month")}
          </Badge>
        </div>

        {/* ── 权益区:这份订阅给到什么时候 ──────────────────────────────
            进度条走 DS 的 Progress,填充是 `bg-primary`(品牌色,当前就是蓝)——
            不需要为「蓝色进度线」再造一个档,也不在注释里记具体色值。 */}
        <div className="flex flex-col gap-2xs">
          <div className="flex items-baseline justify-between gap-sm text-body-sm">
            <span className="text-muted-foreground tabular-nums">
              {item.endAt
                ? `${fmtDate(item.startAt)} ~ ${fmtDate(item.endAt)}`
                : t("term.perpetual")}
            </span>
            <span
              className={cn(
                "tabular-nums",
                nearExpiry || expired
                  ? "font-medium text-warning-text"
                  : "text-muted-foreground",
              )}
            >
              {expired
                ? t("term.expired")
                : left != null
                  ? t("term.daysLeft", { days: left })
                  : ""}
            </span>
          </div>
          {percent != null && !expired ? <Progress value={percent} /> : null}
        </div>
      </CardContent>

      {/* 卡底行：DS CardFooter 自带虚线分隔 + 下对齐 */}
      <CardFooter className="justify-between gap-md text-body-sm">
        <span className="flex min-w-0 items-center gap-md">
          {productCode ? (
            <a
              href={buildWebsiteProductUrl(locale, productCode)}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 text-primary-text hover:underline"
            >
              {t("card.productDetail")}
            </a>
          ) : null}
          <span className="min-w-0 truncate text-muted-foreground tabular-nums">
            {item.releaseVersion
              ? t("card.version", { version: item.releaseVersion })
              : ""}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-xs">
          {/* 自动续费正向显示：开 = 中性徽章；到期不续 = 警示徽章 */}
          {autoRenewOn ? (
            <StatusBadge tone="neutral">
              {t("card.autoRenewOnBadge")}
            </StatusBadge>
          ) : optedOut ? (
            <StatusBadge tone="warning">{t("card.optedOut")}</StatusBadge>
          ) : null}
          {/* 「升级」外链官网定价页：先看档位与价格，再进 console 下单（与官网卡片同一裁定） */}
          {showUpgrade && productCode ? (
            <Button asChild variant="outline" size="sm">
              <a
                href={buildWebsitePricingUrl(locale, productCode)}
                target="_blank"
                rel="noreferrer"
              >
                {t("card.upgrade")}
              </a>
            </Button>
          ) : null}
          {showRenew ? (
            <Button asChild size="sm">
              <Link href={`/subscribe?product=${productCode}&intent=renew`}>
                {t("card.renew")}
              </Link>
            </Button>
          ) : null}
          {canManage ? (
            <ActionMenu label={t("card.moreActions")} items={menuItems} />
          ) : null}
        </span>
      </CardFooter>
    </Card>
  );
}

// ============================================================================
// 「新品推荐」卡
// ============================================================================
