/**
 * @vxture/service-ticket —— 工单的服务层。
 *
 * ⚠️ **这不是在跑的那份实现。** 本包零消费方，从初始导入起没被加载过，
 * 也从没被功能提交碰过（只被全局改名与文档编号扫过）。
 *
 * 活的实现在 `bff/admin-bff/src/routers/tickets.router.ts`。
 *
 * 三个月里两者已经分叉了五处，每一处都是 router 那份更对：
 *
 *   | 面            | router（在跑）                      | 本包                        |
 *   |----------------|------------------------------------|----------------------------|
 *   | `:id`          | 双接受 ticket_no / uuid             | 只认一种                    |
 *   | 回复事件       | `comment`，payload `{body}`        | `replied`，`{content,…}`  |
 *   | 指派 payload   | `{assignee_id, assignee_name, note}` | 丢了 `note`                |
 *   | 状态变更       | 任意七值 + `{from,to,note}` + 派生时间戳 | 只有 resolve/close    |
 *   | 写入        | 事务 + `for update` 行锁           | 无事务，两次独立写          |
 *
 * 所以**别把 router 接到这个包上**：那不是搬家，是拿一份没被现实校正过的
 * 设计去覆盖一条在跑的写路径，会改掉写进库的 event_type 词表、丢掉 note、
 * 丢掉事务与行锁。反过来才对：客户侧工单流（console）一旦解锁，由**本包采纳
 * router 的契约**后上岗，那时才真有第二个消费方。
 *
 * 客户侧现在卡在哪：`console-bff/src/routers/review.router.ts` 写着「工单入口
 * 暂不开通」——缺的是工单到产品的关联（`support.tickets` 上没有 product_id），
 * 不是服务层。
 *
 * 这个孤儿状态由 `lint:orphan-services` 盯着（名单里登记着理由），接上消费方
 * 或删包时记得同时摘掉那条登记。详情见 TD-049。
 */

export { TicketModule } from "./module/ticket.module";
export { TicketService } from "./service/ticket.service";
export type {
  TicketRecord,
  TicketEventRecord,
  AuditLogRecord,
  ListTicketsParams,
  ListTicketsResult,
  CreateTicketInput,
  UpdateTicketInput,
  AddTicketEventInput,
  AppendAuditLogInput,
} from "./types/ticket.types";
