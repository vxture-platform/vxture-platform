/**
 * click-through.ts — 「点进一条通告」这件事的唯一定义。
 * @package @vxture/opera
 * @layer Presentation
 *
 * ── 为什么点进去就算已读 ──
 * 表上那一列与外壳上那个角标数的是**已读**，不是**已办**。点进去看了一眼，就是读过
 * 了；办没办完是另一根轴，由通告指向的那张单子自己回答（订单页、维护窗口页），再
 * 往上由待办那条线回答（`@vxture/service-ops-todos`）——不由这里的已读位代答。
 *
 * 不代点的代价是实测出来的：前三批刻意把信号做全（业务事件巡检、运营动作巡检、维护
 * 窗口、产品生命周期、作业心跳、webhook 死信都往本平面播），于是**一屏几十条**。如果
 * 只有那两颗显式按钮（「知道了」/「全部标记已读」）能清角标，那么按「去看看」一条条
 * 办下去的人**永远清不掉角标**：它长期停在两位数，然后谁也不再看它——一个永远不归零
 * 的角标等于没有角标。admin 的通知抽屉 2026-09-28 正是按这条判据改的，本平面与它同一
 * 条口径：两边都说自己在这一点上对齐，那就得真的对齐。
 *
 * ── 两个面共用这一份 ──
 * 「需要处理」那一块（`NeedsActionPanel`）与下面那张表（`app/(shell)/ops/notices`）各有
 * 一个点进去的入口。行为写在这里**一份**：各写一遍的话，两处会在「标不标」「先标还是
 * 先跳」「标失败怎么办」这三件事上分头漂移，而屏幕上看不出来。
 *
 * ── 三条不变式 ──
 *   ① 标在跳**之前**发出，但跳**不等**它：跳转是运营者按下的那一下，标已读只是它的
 *      附带结果；让附带结果挡住人要去的地方是把因果颠倒了。跳走之后这一段就卸载了，
 *      所以「跳完再标」等于不标。
 *   ② 能不能标由 `markReadBlocker` 一处判，行操作那颗菜单项与这里同读一份。
 *   ③ 角标只认 `@/lib/notice-unread` 那个订阅点，不另起一套。
 */

import { notifyNoticesChanged } from "@/lib/notice-unread";

/**
 * 点进去这件事需要知道的那几个字段，两个面的行类型都满足。
 *
 * 刻意只收这四个：收整行的话，这一份就跟着列表面或收件面的形状走，而它们本来就不同形。
 */
export interface ClickThroughNotice {
  readonly id: string;
  /** 本平面内的相对落地页；null = 这条没有可去的地方。 */
  readonly link: string | null;
  /** 本人读过的时刻；null = 未读。 */
  readonly readAt: string | null;
  /**
   * 这条投不投放到本平面。收件面（`/api/operator-notices/inbox`）回的那些**按定义**
   * 都投到本平面，所以那一份没有这个字段——缺省按 true 读。
   */
  readonly onThisPlane?: boolean;
}

/**
 * 「这条标不了已读」的理由，null = 标得了。
 *
 * 返回理由而不是一个布尔：行操作要按理由给不同的 hint，只回布尔的话那两句话就得
 * 在调用点再判一遍同样的条件——同一个判据长两处，改一处不报错。
 */
export type MarkReadBlocker = "offPlane" | "alreadyRead" | null;

/** 取值与 `operatorNoticesPage.rowActions.markRead*` 那两句 hint 一一对应。 */
export function markReadBlocker(notice: ClickThroughNotice): MarkReadBlocker {
  // 缺字段 = 收件面那一份 = 按定义投到本平面，所以只有显式的 false 才是「不在本平面」。
  if (notice.onThisPlane === false) return "offPlane";
  if (notice.readAt !== null) return "alreadyRead";
  return null;
}

/** 唯一一份「这条还能不能标已读」。行操作的禁用条件与点进去时标不标同读这一份。 */
export function canMarkNoticeRead(notice: ClickThroughNotice): boolean {
  return markReadBlocker(notice) === null;
}

export interface OpenNoticeDeps {
  /**
   * 发「标这一条已读」那个请求。**只发请求**：角标由本模块敲订阅点重取，这一页的两张
   * 列表不必重取（人已经跳走，那一段马上卸载）。
   *
   * 允许它抛、也允许它拒——见 `openNotice` 的不变式 ①，标不上也照跳。报不报由注入的
   * 那一份自己定（只有它知道有没有 toast）。
   */
  readonly markRead: (noticeId: string) => void | Promise<unknown>;
  /** 跳到落地页。`link` 已经判过非空。 */
  readonly navigate: (link: string) => void;
}

/**
 * 点进一条通告：先标已读，再跳。
 *
 * 没有落地页的那些整个不动——调用方也别给它画控件（跳回原地的假动作比灰按钮更糟）。
 */
export function openNotice(
  notice: ClickThroughNotice,
  deps: OpenNoticeDeps,
): void {
  const link = notice.link;
  if (!link) return;
  if (canMarkNoticeRead(notice)) {
    void markThenRefreshBadge(notice.id, deps.markRead);
  }
  deps.navigate(link);
}

/**
 * 标一条，然后请角标去重取。
 *
 * `markRead` 在第一个 `await` 之前**同步**被调到，所以「先标后跳」这个次序由调用点的
 * 语句顺序保证，而不是靠等它回来。
 */
async function markThenRefreshBadge(
  noticeId: string,
  markRead: OpenNoticeDeps["markRead"],
): Promise<void> {
  try {
    await markRead(noticeId);
  } catch {
    // 标不上就不标，不拦跳转（不变式 ①）。
  } finally {
    /* 成败都敲：这个订阅点说的只是「去把真数重读一遍」，而重读不会报出一个假的数
       ——标失败时它报回来的就是那条还没读，正是实情。 */
    notifyNoticesChanged();
  }
}
