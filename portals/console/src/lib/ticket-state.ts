/**
 * ticket-state.ts — 工单七个状态各自「客户此刻还能做什么」。
 * @package @vxture/console
 * @layer Application
 * @category Lib
 *
 * ── 为什么这三个集合要单独成文，而不是各页写个 `status === "closed"` ──
 * 客户侧有三处要问同一件事：抽屉列哪几张（未结）、详情页回复框开不开、
 * 列表页默认筛选停在哪一档。三处各写一遍的后果不是不一致那么轻——`resolved`
 * 是**可逆**的（客户回一句就接着处理），漏掉它的那一处会把一张还能救的单画成
 * 已经结束，而客户唯一的动作就是回那一句。
 *
 * 判据只有一个：**状态**。不看是谁最后说话、不看有没有回复过、不看优先级。
 *
 * 值域是 `@vxture-platform/shared` 的 `TICKET_STATUSES`（七值，镜像
 * `chk_tickets_status`）。这里不重列那七个字面量，只按用途把它们分组，
 * 数组用 `satisfies readonly TicketStatus[]` 钉住"分组里不许有值域外的词"。
 *
 * ── 判定函数收 `string`，不收 `TicketStatus` ──
 * 传进来的值来自 BFF 的响应（那边的契约里 `status` 就是 `string`），运行时没有
 * 类型。函数签名写窄只是让调用点多一次断言，挡不住任何东西；写 `string` 并让
 * "认不出的词"落进**保守**的那一档（不可回复），才是真的处理了这件事。
 *
 * ── 同一套分组在 BFF 侧也有一份 ──
 * `bff/console-bff/src/routers/tickets.router.ts` 的 `REPLYABLE_TICKET_STATUSES`
 * 是同一组值（它的注释也指回这里）：那一侧要拿它拦请求（回复一张已结束的单 409，
 * 重新打开一张还活着的单也 409），BFF 不能 import 门户的 lib。两份一致靠的是
 * 同一个判据只有一句话可写——**收进 `@shared` 是 follow-up**，值域包今天只有
 * 七个值、没有这个分组。
 */

import { TICKET_STATUSES, type TicketStatus } from "@vxture-platform/shared";

/**
 * 未结：还在我们手上、客户有理由盯着的那几张。
 *
 * 与 admin 侧「未结数」同一组值（`TenantOperationRecord.ticketOpenCount` 的口径
 * 就是 open/pending/in_progress/reopened）。顶栏抽屉列的正是这一组——owner 第 5 条
 * 裁决：「列**未关闭**的工单 + 各自最后一次动静」。
 *
 * `resolved` **不在**这里：它已经收尾了，抽屉里再摆着会让"我还有几张单没办完"
 * 这个读数永远下不去。它仍然可回复（见下），那是两件不同的事。
 */
export const OPEN_TICKET_STATUSES = [
  "open",
  "pending",
  "in_progress",
  "reopened",
] as const satisfies readonly TicketStatus[];

/**
 * 还能接着说话的：回复框开着。
 *
 * 未结那四个，**加上 `resolved`**。加它的理由是客户收到的话就是这么写的：
 * 「已标记为处理完成…如果问题还在，在那里回复一句，我们接着处理」
 * （`services/notification/dispatch` 的 `ticket.resolved` 正文）。通知这么许诺
 * 而页面把框关掉，就是当面失信——而且客户没有第二条路可走。
 */
export const REPLYABLE_TICKET_STATUSES = [
  ...OPEN_TICKET_STATUSES,
  "resolved",
] as const satisfies readonly TicketStatus[];

export function isOpenTicket(status: string): boolean {
  return (OPEN_TICKET_STATUSES as readonly string[]).includes(status);
}

export function canReplyToTicket(status: string): boolean {
  return (REPLYABLE_TICKET_STATUSES as readonly string[]).includes(status);
}

/**
 * 终态：客户在这张单上没有话可说了（`closed` / `cancelled`）。
 *
 * 定义成"不可回复"的补集而不是再列两个字面量：将来值域多一个词，它自动落进
 * 这一边——而这一边是**保守**的那一边（多画一句说明，不是多开一个能写字的框）。
 * 反过来写成白名单的话，新词默认可回复，而那个方向的错会让客户对着一张不再
 * 处理的单说话，没人回。
 */
export function isTicketFinished(status: string): boolean {
  return !canReplyToTicket(status);
}

/**
 * 终态那几个值，**算出来的**，供测试与界面枚举用。
 *
 * 不手写 `["closed", "cancelled"]`：手写的那份将来会与 `isTicketFinished` 的
 * 补集定义打架，而两份判据里总有一份是没人维护的那份。值域加了第八个词，这里
 * 立刻多一项，`ticket-state.test.ts` 会指出它没被任何一组认领过。
 */
export const FINISHED_TICKET_STATUSES: readonly TicketStatus[] =
  TICKET_STATUSES.filter(isTicketFinished);
