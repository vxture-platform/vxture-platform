/**
 * rejection-warn.ts — 内部面守卫拒绝时的限速 warn（与 `InternalAuthGuard.warnInvalid` 同一套规矩）。
 * @package @vxture/bff-auth
 *
 * 401 路径上的唯一可观测物。规矩照抄 `internal-auth.guard.ts`：每个来源 IP 每分钟至多一条、
 * 带路由名、**不带被呈交的值**（那可能是口令、也可能是一张还活着的会话票）；表撑到上限整表清空，
 * 防止被人用随机源地址把 Map 撑大。`InternalAuthGuard` 自己那份暂未改调这里——那个文件在
 * 另一条线（PR B）上正被改，先不碰，后续收口。
 */
import type { ExecutionContext, Logger } from "@nestjs/common";
import type { Request } from "express";

/** 同一个来源 IP 的 warn 至多每分钟一条。 */
export const REJECTION_WARN_INTERVAL_MS = 60_000;
/** 限速表的上限：超过就整表清空。 */
const REJECTION_WARN_MAX_ENTRIES = 4096;

export class RateLimitedWarn {
  /** ip → 上一次打 warn 的时刻（ms）。 */
  private readonly warnedAt = new Map<string, number>();

  constructor(private readonly logger: Logger) {}

  /** `message` 由调用方拼好（码 + 路由名）；这里只补 remote 并限速。 */
  emit(req: Request, message: string): void {
    const ip = req.ip ?? req.socket?.remoteAddress ?? "unknown";
    const now = Date.now();
    const last = this.warnedAt.get(ip);
    if (last !== undefined && now - last < REJECTION_WARN_INTERVAL_MS) {
      return;
    }
    if (this.warnedAt.size >= REJECTION_WARN_MAX_ENTRIES) {
      this.warnedAt.clear();
    }
    this.warnedAt.set(ip, now);
    this.logger.warn(`${message} remote=${ip}`);
  }
}

export function routeLabel(context: ExecutionContext): string {
  const cls = context.getClass?.()?.name ?? "UnknownRouter";
  const handler = context.getHandler?.()?.name ?? "unknownHandler";
  return `${cls}.${handler}`;
}
