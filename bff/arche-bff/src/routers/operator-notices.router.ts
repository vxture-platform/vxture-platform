/**
 * operator-notices.router.ts — 运营通告的读侧（治理平面）。
 * @package @vxture/bff-arche
 * @layer Application
 * @category Router
 *
 * 发布面在 opera（owner 2026-09-20：「面向内部运营的由 opera 发布」）；arche 与
 * admin 一样**只读**。
 *
 * 可见性谓词与已读关系都在 `@vxture/service-notice`——admin 已经有一份读侧，
 * arche 接入时本该复制第二份。两份一样的 SQL 没有守卫能盯住：比对两份是否一致
 * 的检查抓不到「两边一样地错」，而改漏一处要等有人报「arche 看不到那条」才发现。
 *
 * ── 门取平面根码，不取任何业务码 ──
 * 与 admin 的读侧同一道门：**进得了本平台就看得见**。
 *
 * 初版我让它检 `ops:notice.read`，理由是「读通告是三平面共有的同一件事」——
 * `lint:operator-planes` 当场拦下：那是 opera 的码，arche 不许检查别家的码字面量
 * （三平面严格隔离，跨平台同能力各注册一个码）。论证成立与否不重要，那条规则是
 * owner 定过的，守卫是它的执行面。
 *
 * 改用根码而不是给 arche 新注册一个 `notice.read`：新码要动 seed 与迁移，而三平面
 * cutover（#121）留下的规矩是 seed 不动。何况 admin 侧本来就是根码——读通告在这两
 * 个平面都不是一项需要单独授权的能力，是进了门就有的。真要分权那天再加码。
 */

import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import {
  NoticeService,
  isNoticeId,
  type NoticePlane,
  type ListNoticesResult,
  type MarkNoticeReadResult,
} from "@vxture/service-notice";
import { PLANE_ROOT } from "../auth/plane";
import type { RequestContext } from "../types/request-context";

/** 本平面的代号，与 target_planes 里的值同一套（PLANE_ROOT 是 "arche.plane"）。 */
const PLANE_NAME = PLANE_ROOT.split(".")[0] as NoticePlane;

/** 入参兜底。`limit` 上限与 admin 同 200：再大只会把一页撑到没人读得完。 */
function clampInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

@Controller("api/operator-notices")
export class OperatorNoticesRouter {
  // 必须显式 @Inject：打包走 esbuild，它不产 emitDecoratorMetadata。
  constructor(@Inject(NoticeService) private readonly notices: NoticeService) {}

  /**
   * GET /api/operator-notices —— 本平面可见的通告。
   *
   * `scope=digest`（默认）落 owner 那条摘要规则：**当天已读 + 所有未读**。
   * `scope=all` 给二级页，去掉已读那一条谓词。
   */
  @Get()
  async listNotices(
    @Req() req: Request & RequestContext,
    @Query("scope") scopeParam?: string,
    @Query("limit") limitParam?: string,
    @Query("offset") offsetParam?: string,
  ): Promise<ListNoticesResult> {
    const operatorId = assertCanReadNotices(req);
    const digest = scopeParam !== "all";

    // 平面与运营者都不从请求取：平面是本 BFF 自己的身份，人是会话里的那个。
    return this.notices.list({
      plane: PLANE_NAME,
      operatorId,
      digest,
      limit: clampInt(limitParam, digest ? 20 : 50, 1, 200),
      offset: clampInt(offsetParam, 0, 0, 100_000),
    });
  }

  /** POST /api/operator-notices/:id/read —— 标记本人已读。幂等。 */
  @Post(":id/read")
  async markNoticeRead(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
  ): Promise<MarkNoticeReadResult> {
    const operatorId = assertCanReadNotices(req);
    if (!isNoticeId(id)) throw new BadRequestException("Invalid notice id");

    const marked = await this.notices.markRead(id, operatorId);
    // 服务层回 null = 通告不存在或已撤回。那是调用方要据以说话的结果，
    // 不是服务的故障，所以 404 在这里翻，不在包里抛。
    if (!marked) throw new NotFoundException("Notice not found");
    return marked;
  }
}

/**
 * 进得了 arche 就看得见通告——门取平面根码，见文件头。
 *
 * 回运营者 id 而不是只做断言：两个端点都要它，分成「先断言再自己取一遍」会给
 * 「断言过了但 id 是 undefined」留一条缝。
 */
function assertCanReadNotices(req: Request & RequestContext): string {
  if (!req.operator) {
    throw new UnauthorizedException("No active session");
  }
  if (!req.capabilities?.includes(PLANE_ROOT)) {
    throw new ForbiddenException(`Missing ${PLANE_ROOT} capability`);
  }
  return req.operator.id;
}
