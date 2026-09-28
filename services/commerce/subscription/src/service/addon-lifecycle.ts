/**
 * addon-lifecycle.ts — 加油包四条客户通知的**判据与形状**（2026-09-28 批 5）。
 * @package @vxture/service-subscription
 *
 * ── 为什么单独一个文件 ──
 * 「这一行算哪一档」是本批唯一真正需要被钉住的判断，而它有三处容易悄悄错：
 *   ① 拿 `quota_used` 直接比 `quota_limit`（铁律五禁裸读）——只有**不重置**的池上
 *      这个比较才成立；加油包池授予时写死 `reset_period='none'`，所以这里显式要求它，
 *      而不是「反正加油包都是 none」就省掉（哪天池的来源多一种，省掉的那一行会静默错）。
 *   ② 存储类（gauge）指标**从不进 consume**，它的 `quota_used` 永远是 0：拿一个永不变的
 *      值判「用尽」，得到的永远是「没用尽」——一条哑逻辑，还带着「我判过了」的外观。
 *      所以 gauge 只被排除在「已用尽」这一档之外，两条时间轴的通知照发。
 *   ③ 存量闸门：第一趟不许把历史上所有已过期 / 已用尽的包一次性发出去
 *      （同形的坑订阅到期扫描踩过，见 subscription.service 里那段注释）。
 *
 * 判据只在这里一处。SQL（pg-addon.repository 的 findLifecycleCandidates）只按时间窗与
 * 水位把候选收窄到有界，**不做裁定**——两处各写一遍判据，错开一点是验证不出来的。
 */
import {
  customerRecipients,
  formatNotifyDate,
  formatNotifyMoney,
  type CustomerNotifyInput,
} from "./customer-notifier";
import type {
  AddonNotifyDisplay,
  AddonPoolCandidate,
} from "../types/addon.types";

/** 加油包生命周期的三档（激活不在其中——那一档有确定的写入方，不靠巡检）。 */
export type AddonLifecycleKind = "expiring_soon" | "exhausted" | "expired";

export interface AddonLifecycleWindow {
  /** 到期前多少天开始提醒。 */
  leadDays: number;
  /** 存量闸门：终态（已过期 / 已用尽）只回看这么多天。 */
  backlogDays: number;
}

const DAY_MS = 86_400_000;

/**
 * 「已用尽」这一档成立吗。
 *
 * 两个前提缺一不可：
 *   · `reset_period === 'none'`——会重置的池上 `quota_used` 是「本周期已用」，
 *     它 ≥ 上限只说明这个周期烧完了，下一个周期会自己回来，不是「买的量没了」。
 *     周期判断的算式收在 `@vxture-platform/shared` 的 quota-period.utils（三个消费方
 *     共用一份），本函数不重写它——**只在它用不上的那一侧（不重置）作判断**。
 *   · 指标不是 gauge——存储类的水位走 usage_gauges，`quota_used` 恒 0，问它等于不问。
 *     未分类（kind 为 null，都是 status='reserved' 的占位键）不排除：它们的
 *     `quota_used` 只可能被 consume 推上去，真被推上去了就是真用尽了。
 */
export function addonPoolIsExhausted(row: {
  resetPeriod: string;
  metricKind: string | null;
  quotaLimit: string;
  quotaUsed: string;
}): boolean {
  if (row.resetPeriod !== "none") return false;
  if (row.metricKind === "gauge") return false;
  /* bigint 字符串（bytes 能到 10^12 量级）：转 number 会静默失真，用 BigInt 比。 */
  return BigInt(row.quotaUsed) >= BigInt(row.quotaLimit);
}

/**
 * 一行候选 → 这一趟该发哪一档，或者 null（什么都不发）。
 *
 * 优先级 已过期 > 已用尽 > 即将到期，各有理由：
 *   · 已过期是终态：余量作废这件事盖过「还剩几天」与「量没了」。
 *   · 已用尽盖过即将到期：量已经是 0 的包，「三天后到期」答的不是客户此刻的问题；
 *     而且两档各有自己的去重键，包真的到期时那一条照样会发。
 * 闸门：终态两档都要在回看窗口内——已过期按到期时刻算，已用尽按池上最后一次写入算
 * （消费会推进 updated_at，所以它约等于「什么时候被耗光的」）。
 */
export function classifyAddonPool(
  row: AddonPoolCandidate,
  window: AddonLifecycleWindow,
  now: Date = new Date(),
): AddonLifecycleKind | null {
  const backlogFrom = now.getTime() - window.backlogDays * DAY_MS;
  if (row.expiresAt.getTime() <= now.getTime()) {
    /* 过期太久的不发：首趟不许把历史一次性播出去。已过期的包也不再回落去看
       「用尽」——那是过时的消息。 */
    return row.expiresAt.getTime() >= backlogFrom ? "expired" : null;
  }
  if (addonPoolIsExhausted(row)) {
    return row.poolUpdatedAt.getTime() >= backlogFrom ? "exhausted" : null;
  }
  return row.expiresAt.getTime() <= now.getTime() + window.leadDays * DAY_MS
    ? "expiring_soon"
    : null;
}

/**
 * 加油包板块的地址。字面量而非 import：服务层不能依赖门户包。
 * 唯一权威在 portals/console/src/modules/commerce/addon-routes.ts
 * （ADDON_SECTION_HREF，2026-09-08 从配额页迁到费用中心）——那边搬家时这里要跟着改。
 */
const ADDON_SECTION_LINK = "/billing#quota-addons";

/**
 * 四条通知共用的形状：引用类型 addon、引用 id 走可视码、链接去费用中心的加油包板块。
 *
 * 参数名走仓里的通用词汇：`orderNo` / `endAt` / `amount`，与模板表逐字一致。
 *
 * 2026-09-28 纠正：这里曾经叫 `addonOrderNo` / `expiresAt` / `price`，理由是「单号住
 * metering.addon_purchases 不是 billing.orders，叫 `orderNo` 会让运营镜像拼出死链」。
 * 两个问题：一是模板表用的是通用词汇，而插值遇未知键**静默替换成空串**，
 * 于是四条通知全渲染成带洞的句子而不报错；二是死链那个顾虑已经不成立——
 * 镜像的 `/orders/` 分支现在按 `reference.type === "addon"` 排除，
 * **区分哪张表靠的是引用类型，不是参数名**。
 * 少给一个参数不报错，所以这一组有用例钉着渲染结果而不只钉参数表。
 */
function addonNotice(
  templateCode: CustomerNotifyInput["templateCode"],
  referenceId: string,
  d: AddonNotifyDisplay,
  params: Record<string, string | number>,
): CustomerNotifyInput {
  return {
    tenantId: d.tenantId,
    templateCode,
    reference: { type: "addon", id: referenceId },
    params: {
      packName: d.packName,
      orderNo: d.orderNo,
      endAt: formatNotifyDate(d.expiresAt),
      ...params,
    },
    /* 加油包是 workspace 级的，掏钱的常常不是租户 owner：买的人也要收到
       （dispatcher 恒定并入 owner，同一个人只落一条）。 */
    recipients: customerRecipients(d.createdByType, d.createdById),
    link: ADDON_SECTION_LINK,
  };
}

/** 开通：运营核销确认之后。一个包一辈子一次 ⇒ 去重键就是订单号。 */
export function addonActivatedNotice(
  d: AddonNotifyDisplay,
): CustomerNotifyInput {
  return addonNotice("addon.activated", d.orderNo, d, {
    amount: formatNotifyMoney(d.price, d.currency),
  });
}

/**
 * 生命周期三档。
 *
 * 去重键：
 *   · 即将到期 —— `订单号:到期日`，与订阅「即将到期」同一手法（窗口内每趟都会扫到
 *     同一批行，靠这个键收成一条；到期日被改了就该再提醒一次）。
 *     日期用 `formatNotifyDate` 而不是 UTC 切片：客户看到的日期是东八区，
 *     两边不同时区会出现「展示的日期变了而键没变」（凌晨到期的包）。
 *   · 已用尽 / 已过期 —— 就是订单号：这两件事在一个包的一生里各只发生一次。
 */
export function addonLifecycleNotice(
  kind: AddonLifecycleKind,
  row: AddonPoolCandidate,
  now: Date = new Date(),
): CustomerNotifyInput {
  if (kind === "expiring_soon") {
    const days = Math.max(
      0,
      Math.ceil((row.expiresAt.getTime() - now.getTime()) / DAY_MS),
    );
    return addonNotice(
      "addon.expiring_soon",
      `${row.orderNo}:${formatNotifyDate(row.expiresAt)}`,
      row,
      { days },
    );
  }
  return addonNotice(
    kind === "exhausted" ? "addon.exhausted" : "addon.expired",
    row.orderNo,
    row,
    {},
  );
}
