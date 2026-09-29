"use client";

/**
 * ticket-labels.ts — 工单的状态词与时间线事件的画法，客户侧一份。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * ── 为什么收成一处 ──
 * 状态词要在三处出现（列表的状态列与筛选、详情页的徽标、顶栏抽屉的每一行），
 * 事件画法要在两处（详情页时间线、抽屉的"最后一次动静"）。admin 那边同一族
 * 映射抄成四份、其中一份漏了 `expired` 分支、把"权益自然到期"显示成"已取消"
 * ——`lint:enum-label-sprawl` 就是为那件事立的。console 这一批一开始就只写一份。
 *
 * 语气档**不在这里重定义**：取 `@vxture-platform/shared` 的
 * `TICKET_STATUS_TONE`（与 admin 侧同一份），这里只负责把值翻成人话。
 *
 * 键写成字面量（`t("open")` 而不是 `t(\`status.${x}\`)`）：动态键
 * `lint:message-usage` 扫不到，要等界面上渲染出键路径才看得见。
 */

import { useTranslations } from "next-intl";
import {
  TICKET_EVENT_COMMENT,
  TICKET_EVENT_REPLY,
  TICKET_STATUS_TONE,
  resolveStatusTone,
  type StatusTone,
  type TicketStatus,
} from "@vxture-platform/shared";
import type { IconName } from "@vxture/design-system";

/**
 * 状态 → 客户看的词。
 *
 * ── 取值与 admin 一字不差 ──
 * 客户和运营在电话里说的是同一张单，所以状态词只能有一套：这七个词照
 * `portals/admin/messages` 的 `enums.ticketStatus` 抄（待处理 / 挂起 / 处理中 /
 * 已解决 / 已关闭 / 重新打开 / 已取消）。为客户另起一套"更友好"的说法，代价是
 * 客服说「这单挂起了」而客户屏幕上写着别的词——那一分钟谁也说不清在说什么。
 *
 * ── 返回的是函数，不是表 ──
 * 因为入参是 `string`（BFF 契约里就是 string，运行时没有类型）。表用 `[status]`
 * 取值，认不出的词会取到 `undefined` 并渲染成**空徽章**；函数则原样回显那个码，
 * 客户看得见"有个我们没翻的状态"，而客服拿着那个码查得到日志。藏掉它才是错的。
 */
export function useTicketStatusLabel(): (status: string) => string {
  const t = useTranslations("tickets.status");
  const table: Record<TicketStatus, string> = {
    open: t("open"),
    pending: t("pending"),
    in_progress: t("in_progress"),
    resolved: t("resolved"),
    closed: t("closed"),
    reopened: t("reopened"),
    cancelled: t("cancelled"),
  };
  return (status) => table[status as TicketStatus] ?? status;
}

/** 语气档。认不出的值回落 neutral（`resolveStatusTone` 的既有口径）。 */
export function ticketStatusTone(status: string): StatusTone {
  return resolveStatusTone(TICKET_STATUS_TONE, status);
}

/**
 * 时间线上一条流水的三种身份。
 *
 * **判据只有 `event_type`**，与"这条给谁看"同一个判据（
 * `CUSTOMER_VISIBLE_TICKET_EVENT_TYPES`）。不看 `actor_type`：那是个代理值——
 * 同一个运营既写内部备注也写正式回复，而客户重开工单产生的 `status_changed`
 * 的 actor 是客户自己。拿它分类会把"进度变了"画成"客户说了句话"。
 * `actorName` 仍然用，但只用来写"谁"，不用来判"是什么"。
 */
export type TicketEventKind = "customer" | "operator" | "status";

export interface TicketEventPresentation {
  readonly kind: TicketEventKind;
  readonly icon: IconName;
  readonly tone: StatusTone;
  /** 这条流水是什么事（「你发的」/「我们的回复」/「进度更新」）。 */
  readonly label: string;
}

/**
 * 客户自己发言用的那个词，取自值域（`TICKET_EVENT_COMMENT`）。
 *
 * 初版这里是个本地字面量，理由写的是「`comment` 的写入方在服务端，客户端只读，
 * 加导出就有两处声明同一件事」。那个理由当时对，现在不对了：运营侧信号巡检要在
 * SQL 谓词里绑同一个词，于是它有了第三处声明——所以它现在在 shared 里有名字，
 * 这里取那一份。
 */
const CUSTOMER_EVENT = TICKET_EVENT_COMMENT;
const STATUS_EVENT = "status_changed";

/**
 * 入参是 `event_type` 一个串，不是整条流水。
 *
 * 因为判据就只有它（见上）。收整条流水的话，列表页与抽屉为了拿一个标签得先编一个
 * 假的流水对象出来（`actorName: ""`、`body: null`…），而那些假字段迟早会有人当真。
 */
export function useTicketEventPresentation(): (
  eventType: string,
) => TicketEventPresentation {
  const t = useTranslations("tickets.event");
  return (eventType) => {
    switch (eventType) {
      case CUSTOMER_EVENT:
        return {
          kind: "customer",
          icon: "user-circle",
          tone: "brand",
          label: t("mine"),
        };
      case TICKET_EVENT_REPLY:
        return {
          kind: "operator",
          icon: "headset",
          tone: "info",
          label: t("reply"),
        };
      case STATUS_EVENT:
        return {
          kind: "status",
          icon: "flag",
          tone: "neutral",
          label: t("statusChange"),
        };
      default:
        /* `event_type` 是开放集（varchar(64)，无 CHECK）。认不出的词按最弱的那一档
           画成"进展"，**不藏**——藏掉一条客户看得见的流水，页面就在说谎；而可见性
           白名单已经保证到这里的每一条都是该给他看的。 */
        return {
          kind: "status",
          icon: "info",
          tone: "neutral",
          label: t("other"),
        };
    }
  };
}
