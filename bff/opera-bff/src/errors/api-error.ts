/**
 * api-error.ts — 结构化错误封套（product_251 X-1）。
 * @package @vxture/bff-opera
 * @layer BFF
 *
 * 封套四件套：`code`（SCREAMING_SNAKE，带模块前缀）· `message` · `retryable`
 * （**必有**）· 可选 `field`。承载位置随传输，字段名不随传输变——opera-bff 只有
 * HTTP 一种传输，所以就是响应体。
 *
 * 为什么值得单独立一层：审计（`30-l1-consistency-audit.md` X-1）实测 platform
 * 管理面**一个 code 都没有**，78 处全是裸字符串。消费方要按错误分支处理时只能匹配
 * 文案——文案一改就断，而文案是最经常改的东西。
 *
 * 与上游的关系：atlas / runos 的错误体**本来就带 code**（`parseAtlasError` /
 * `parseRunosError`），透传时不许覆盖它们的码，只补 `retryable`——见
 * `AllExceptionsFilter`。
 */
import { HttpException, HttpStatus } from "@nestjs/common";

/**
 * 拒绝词表（X-1）——三方共用，**不带模块前缀**：它们是词表本身，不属于任何模块。
 *
 * `APPROVAL_REQUIRED` 是一条出路，不是一个错误：消费方看到它应该去发起审批，
 * 而不是把它当失败上报。opera-bff 目前没有需要人工批准的写路径，故未使用；
 * 列在这里是为了别人加的时候不去另造一个 `NEED_APPROVAL`。
 */
export const REJECTION_CODES = [
  "NOT_ENTITLED",
  "POLICY_DENIED",
  "APPROVAL_REQUIRED",
  "QUOTA_EXCEEDED",
] as const;

export type RejectionCode = (typeof REJECTION_CODES)[number];

/** 出现在响应体里的形状。`statusCode` 保留是为了不动既有客户端的读法。 */
export interface ErrorEnvelope {
  code: string;
  message: string;
  retryable: boolean;
  /** 校验类错误指向具体入参，控制台据此高亮那一格，而不是弹一句话。 */
  field?: string;
  statusCode: number;
}

/**
 * `retryable` 的默认判法：**同一个请求原样重发有没有可能成功**。
 *
 * 429 与 502/503/504 是"现在不行、待会儿可能行"；4xx 其余是"这么发永远不行"；
 * 500 归 false——未知故障下让调用方自动重试，只会把一个故障放大成一片。
 */
export function defaultRetryable(status: number): boolean {
  return (
    status === HttpStatus.TOO_MANY_REQUESTS ||
    status === HttpStatus.BAD_GATEWAY ||
    status === HttpStatus.SERVICE_UNAVAILABLE ||
    status === HttpStatus.GATEWAY_TIMEOUT
  );
}

export class ApiError extends HttpException {
  constructor(
    status: number,
    code: string,
    message: string,
    options: { retryable?: boolean; field?: string } = {},
  ) {
    const envelope: ErrorEnvelope = {
      code,
      message,
      retryable: options.retryable ?? defaultRetryable(status),
      ...(options.field ? { field: options.field } : {}),
      statusCode: status,
    };
    super(envelope, status);
  }
}

/* ── 构造帮手 ────────────────────────────────────────────────────────────
   一律要求显式给 code：没有 `badRequest(message)` 这种重载，否则第一个赶时间的
   人就会用它，X-1 又退回原状。 */

/** 入参形状不对。`field` 基本都该给——这是 `field` 存在的理由。 */
export function invalidRequest(
  code: string,
  message: string,
  field?: string,
): ApiError {
  return new ApiError(HttpStatus.BAD_REQUEST, code, message, {
    ...(field ? { field } : {}),
  });
}

/** 没有有效会话 / 主体不可信。 */
export function unauthenticated(code: string, message: string): ApiError {
  return new ApiError(HttpStatus.UNAUTHORIZED, code, message);
}

/**
 * 身份成立但没有这项授权——这就是词表里的 `NOT_ENTITLED`，不要另造码。
 * 消息里带上缺的那个能力名：运营者拿它去找管理员，比"权限不足"有用。
 */
export function notEntitled(capability: string): ApiError {
  return new ApiError(
    HttpStatus.FORBIDDEN,
    "NOT_ENTITLED" satisfies RejectionCode,
    `Missing ${capability} capability`,
  );
}

/** 策略层拒绝（非授权缺失）。 */
export function policyDenied(message: string): ApiError {
  return new ApiError(
    HttpStatus.FORBIDDEN,
    "POLICY_DENIED" satisfies RejectionCode,
    message,
  );
}

/**
 * 高危写路由要求一枚新鲜的 step-up 凭证。
 *
 * 不用 `APPROVAL_REQUIRED`：那条是"要另一个人来批"，这条是"你自己再证明一次是
 * 你"——同一个主体，不需要第二个人。`retryable: true` 是真的：走完仪式把原请求
 * 原样重发就会成功，这是四条拒绝码之外少数几个真正有出路的拒绝。
 *
 * message 保持 `step_up_required` 不变：门户的 `isStepUpRequiredError` 在改判
 * `code` 之前还认它，两边不能同时换。
 */
export function stepUpRequired(): ApiError {
  return new ApiError(
    HttpStatus.FORBIDDEN,
    "AUTH_STEP_UP_REQUIRED",
    "step_up_required",
    { retryable: true },
  );
}

export function notFound(code: string, message: string): ApiError {
  return new ApiError(HttpStatus.NOT_FOUND, code, message);
}

export function conflict(code: string, message: string): ApiError {
  return new ApiError(HttpStatus.CONFLICT, code, message);
}

/** 上游进程没应答（连接层失败），与"上游回了个错"不是一回事——后者原样透传。 */
export function upstreamUnavailable(code: string, message: string): ApiError {
  return new ApiError(HttpStatus.BAD_GATEWAY, code, message, {
    retryable: true,
  });
}

/**
 * 上游**答了，但答的形状不符合契约**——与"没应答"和"回了个错"都不是一回事。
 *
 * 这个帮手是 2026-08-23 那批缺陷的直接产物：门户此前对上游少给的字段一律做降级
 * （缺 `resolution` 就当"未知"、缺 `modelCount` 就换一套删除文案），于是**契约破了
 * 没有任何人知道**，只是界面悄悄换了一种说法。降级读起来像正常，而它正是那类缺陷
 * 能活很久的原因。
 *
 * 现在的立场：契约里必有的字段缺了就是故障，**在这一层拦下并点名是哪个字段**，而不是
 * 让每个页面各自编一套"没有也行"的表现。502 而不是 500：故障不在本方。
 * `retryable: false`——同一个请求原样重发不会让上游长出那个字段来。
 */
export function upstreamContractViolation(
  code: string,
  message: string,
  field?: string,
): ApiError {
  return new ApiError(HttpStatus.BAD_GATEWAY, code, message, {
    retryable: false,
    ...(field ? { field } : {}),
  });
}

/**
 * 本方出了故障（不是调用方的错）。
 *
 * 值得单列一个帮手：这类点很容易被随手写成 400，而一个 400 会让运营者以为是自己
 * 填错了，然后反复改输入——一个永远改不好的输入。分类错的错误码比没有码更误导。
 */
export function internalError(code: string, message: string): ApiError {
  return new ApiError(HttpStatus.INTERNAL_SERVER_ERROR, code, message);
}

/** 依赖的本地服务暂时不可用（如 step-up 后端）。 */
export function serviceUnavailable(code: string, message: string): ApiError {
  return new ApiError(HttpStatus.SERVICE_UNAVAILABLE, code, message, {
    retryable: true,
  });
}
