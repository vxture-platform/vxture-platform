/**
 * all-exceptions.filter.ts — 保证**每一个**出口都是 X-1 封套。
 * @package @vxture/bff-opera
 * @layer BFF
 *
 * 只把 78 处 throw 改掉是不够的：Nest 自己也会造错误（路由不存在的 404、请求体
 * 不是合法 JSON 的 400），那些点我一行代码都碰不到。"封套齐全"如果只在我写的
 * 分支上成立，消费方仍然要写两套解析——所以形状的保证放在出口，语义的来源放在
 * 抛出点。
 *
 * 三条通路：
 *   1. `ApiError` —— 已经是封套，原样出。
 *   2. 上游透传（`HttpException` 且响应体自带 `code`）—— **不覆盖上游的码**，
 *      只补 `retryable`。atlas 的 `MODEL_ADMIN_HAS_DEPENDENTS` 那种码带着
 *      `blockedBy` 明细，重写成本地码等于把它扔了。
 *   3. 其余 —— 按状态码兜一个通用码。兜底码出现在日志里就是一处漏改，见下。
 */
import {
  ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Request, Response } from "express";
import type { Pool } from "pg";
import { insertDeniedAuditLog, shouldAuditDenial } from "../audit/denied-audit";
import { defaultRetryable, type ErrorEnvelope } from "../errors/api-error";
import type { RequestContext } from "../types/request-context";

/**
 * 状态码 → 兜底 code。这些码**不该**出现在正常流程里：它们意味着某处还在抛裸
 * 的 Nest 异常，或者是框架自己抛的。前者是漏改，后者无法避免——所以兜底而不是
 * 报警，但保留可辨识性（比如 `UNCLASSIFIED_` 前缀一眼能 grep 出来）。
 */
const FALLBACK_CODES: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: "UNCLASSIFIED_BAD_REQUEST",
  [HttpStatus.UNAUTHORIZED]: "UNCLASSIFIED_UNAUTHENTICATED",
  [HttpStatus.FORBIDDEN]: "UNCLASSIFIED_FORBIDDEN",
  [HttpStatus.NOT_FOUND]: "UNCLASSIFIED_NOT_FOUND",
  [HttpStatus.CONFLICT]: "UNCLASSIFIED_CONFLICT",
  [HttpStatus.TOO_MANY_REQUESTS]: "UNCLASSIFIED_RATE_LIMITED",
  [HttpStatus.BAD_GATEWAY]: "UPSTREAM_UNAVAILABLE",
  [HttpStatus.SERVICE_UNAVAILABLE]: "SERVICE_UNAVAILABLE",
  [HttpStatus.GATEWAY_TIMEOUT]: "UPSTREAM_TIMEOUT",
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger("OperaBffException");

  /**
   * 写 `outcome='denied'` 用的池子（product_251 X-3）。
   *
   * **不走构造器 DI**：池子由 `OperaBffPoolsModule` 的 useFactory 提供，而全局
   * provider 注入 useFactory provider 会在 bootstrap 时把 Nest 的实例加载器锁死
   * （静默挂起、无报错——这条坑 `step-up.guard.ts` 头部有完整记录）。这里改由
   * `main.ts` 在 app 建好之后 `app.get()` 取出来传进来：那时容器已经就绪，绕开
   * 整个问题，也不需要 ModuleRef 懒解析。
   *
   * 可空：`BOOT_SMOKE` 与单测里没有池子，那时只出封套、不留痕。
   */
  constructor(private readonly rwPool?: Pool) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & RequestContext>();

    const isHttp = exception instanceof HttpException;
    const status = isHttp
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    /* 5xx 与非 HttpException 必须留下真实栈：不然故障只剩一句 "Internal server
       error"，连是哪一行抛的都看不到。 */
    if (!isHttp || status >= 500) {
      const detail =
        exception instanceof Error
          ? (exception.stack ?? exception.message)
          : String(exception);
      this.logger.error(
        `${req.method} ${req.originalUrl} → ${status}\n${detail}`,
      );
    }

    const body = isHttp
      ? envelopeFromHttp(exception, status)
      : {
          code: "INTERNAL_ERROR",
          message: "Internal error",
          retryable: false,
          statusCode: status,
        };

    res.status(status).json(body);

    /* X-3：被拒的写操作也要留痕。**在响应之后**——留痕慢一点无所谓，让调用方多等
       一个数据库往返才不行。口径与理由见 `audit/denied-audit.ts` 文件头。 */
    if (this.rwPool && shouldAuditDenial(req, status)) {
      const code = typeof body.code === "string" ? body.code : undefined;
      void insertDeniedAuditLog(this.rwPool, req, code).catch((error) => {
        /* 吞掉：响应已经发出去了，这里再抛只会变成一个未捕获的 rejection。
           但**必须留下日志**——静默丢审计比不记审计更糟，因为你会以为记着。 */
        this.logger.error(
          `denied-audit 写入失败 ${req.method} ${req.originalUrl}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
    }
  }
}

function envelopeFromHttp(
  exception: HttpException,
  status: number,
): ErrorEnvelope | Record<string, unknown> {
  const body = exception.getResponse();

  if (typeof body === "string") {
    return fallbackEnvelope(body, status);
  }

  const record = body as Record<string, unknown>;
  const code = typeof record["code"] === "string" ? record["code"] : undefined;

  if (!code) {
    return {
      ...record,
      ...fallbackEnvelope(messageOf(record, exception.message), status),
    };
  }

  /* 上游透传：`code` 已经是上游的稳定码，`blockedBy` / `retryAfterMs` 这类明细
     也一并留着——控制台正是靠它们把"你不能删"变成"先去清掉这三个"。 */
  return {
    ...record,
    code,
    message: messageOf(record, exception.message),
    retryable:
      typeof record["retryable"] === "boolean"
        ? record["retryable"]
        : defaultRetryable(status),
    statusCode: status,
  };
}

function fallbackEnvelope(message: string, status: number): ErrorEnvelope {
  return {
    code: FALLBACK_CODES[status] ?? "INTERNAL_ERROR",
    message,
    retryable: defaultRetryable(status),
    statusCode: status,
  };
}

/** Nest 的校验管道会把 message 塞成数组；封套里 `message` 是单个字符串。 */
function messageOf(record: Record<string, unknown>, fallback: string): string {
  const raw = record["message"];
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) return raw.map((m) => String(m)).join("; ");
  return fallback;
}
