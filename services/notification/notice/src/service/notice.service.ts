/**
 * notice.service.ts — 运营通告读侧 + 系统来源写路。
 * @package @vxture/service-notice
 * @layer Application
 * @category Service
 */

import { Inject, Injectable } from "@nestjs/common";
import { PgNoticeRepository } from "../repository/pg-notice.repository";
import type {
  CreateSystemNoticeInput,
  CreateSystemNoticeResult,
  ListNoticesParams,
  ListNoticesResult,
  MarkNoticeReadResult,
  NoticePlane,
} from "../types/notice.types";

/** 一条 uuid 的形状。标记已读前先挡，免得把一个明显不是 id 的串送进库。 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isNoticeId(value: string): boolean {
  return UUID_RE.test(value);
}

@Injectable()
export class NoticeService {
  // 必须显式 @Inject——见 PgNoticeRepository 的同一条注释。2026-09-20 的评价
  // 500 正是服务包自己这一处漏了：boot-smoke 绿，第一次调用才炸。
  constructor(
    @Inject(PgNoticeRepository) private readonly repository: PgNoticeRepository,
  ) {}

  /**
   * 读一页本平面可见的通告，连同三档的计数汇总。
   *
   * 平面与运营者由调用方（各自的 BFF）从自身身份与会话里取，**不收请求参数**。
   * 筛选（严重度 / 来源 / 只看未读 / 关键词）反过来**只能**来自请求——它们是「这个人
   * 此刻想少看几行」，不是「这个人能看见哪一份」。两类入参混成一个袋子，就会出现
   * 一个能读别人平面的探测面。
   */
  async list(params: ListNoticesParams): Promise<ListNoticesResult> {
    return this.repository.list(params);
  }

  /**
   * 标记本人已读。幂等——「我又看了一次」不是错误，只把时间刷新。
   *
   * 回 null 表示通告不存在或已撤回；调用方翻成 404。这里不抛：不存在是调用方要
   * 据以说话的**结果**，不是本服务的故障。
   */
  async markRead(
    noticeId: string,
    operatorId: string,
  ): Promise<MarkNoticeReadResult | null> {
    return this.repository.markRead(noticeId, operatorId);
  }

  /**
   * 把本平面此刻可见且未读的通告一次全部记上，回真的记上了几条。
   *
   * 幂等：再按一次回 0，不抛——「已经全读过了」不是错误。作用域与铃铛角标同一个
   * （见 `MARK_ALL_READ_SQL`），所以按完角标必然归零；筛选**不参与**，那一层归页面。
   */
  async markAllRead(plane: NoticePlane, operatorId: string): Promise<number> {
    return this.repository.markAllRead(plane, operatorId);
  }

  /**
   * 写一条系统来源通告（客户事件的运营镜像等）。
   *
   * 同一去重锚已有未撤回的一条 → `inserted: false`，不抛：事件侧重放不是错误，
   * 是这条写路存在的理由之一。人工发布不走这里——那条路在 opera 自己的发布面。
   */
  async createSystemNotice(
    input: CreateSystemNoticeInput,
  ): Promise<CreateSystemNoticeResult> {
    return this.repository.createSystemNotice(input);
  }
}
