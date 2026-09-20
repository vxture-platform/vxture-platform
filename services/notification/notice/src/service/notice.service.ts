/**
 * notice.service.ts — 运营通告读侧。
 * @package @vxture/service-notice
 * @layer Application
 * @category Service
 */

import { Inject, Injectable } from "@nestjs/common";
import { PgNoticeRepository } from "../repository/pg-notice.repository";
import type {
  ListNoticesParams,
  ListNoticesResult,
  MarkNoticeReadResult,
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
   * 读一页本平面可见的通告。
   *
   * 平面与运营者由调用方（各自的 BFF）从自身身份与会话里取，**不收请求参数**。
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
}
