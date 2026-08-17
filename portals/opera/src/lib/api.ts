/**
 * api.ts — opera 调 opera-bff 的取数层。
 * @package @vxture/opera
 * @layer Presentation
 *
 * 一律用**相对路径**：生产由 nginx 在同一 vhost 上路由（真实域名不进仓），本地
 * 由 `next.config.js` 的 rewrite 代到 :3051。与 `SessionProvider` 调 `/auth/*`
 * 同一套约定。
 *
 * 错误不吞：BFF 的能力门返回 403、会话失效返回 401，页面要能分辨"读失败"与
 * "本来就没有"（空态三分，见 DS 的 EmptyState 用法），所以这里抛带状态码的错，
 * 不做静默兜底成空数组。
 */

/**
 * 上游返回的结构化错误体。
 *
 * 只留 message 是不够的：Atlas 的删除前置条件（`MODEL_ADMIN_HAS_DEPENDENTS`）
 * 特意在 `blockedBy` 里**点名**还有谁在引用它，因为一个只被告知「你不能」的操作者
 * 只能自己去翻是哪些东西要先清掉。把它压成一句话等于把这份好意扔了。
 */
export interface OperaApiErrorBody {
  code?: string;
  message?: string | string[];
  /** X-1：同一个请求原样重发有没有可能成功。opera-bff 侧一定有。 */
  retryable?: boolean;
  /** X-1：校验错误指向的入参名——页面据此高亮那一格，而不是只弹一句话。 */
  field?: string;
  /** MODEL_ADMIN_HAS_DEPENDENTS（409）——还在引用它的东西。 */
  blockedBy?: { type: string; id: string; label: string }[];
  /** MODEL_ADMIN_PROBE_COOLDOWN（429）——离下一次可自检还有多久。 */
  retryAfterMs?: number;
  [key: string]: unknown;
}

export class OperaApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** 解析得到的原始错误体；非 JSON 响应时为 null。 */
    readonly body: OperaApiErrorBody | null = null,
  ) {
    super(message);
    this.name = "OperaApiError";
  }

  /** 上游的稳定错误码（如 `MODEL_ADMIN_MUST_DEACTIVATE_FIRST`）。判它，不要判文案。 */
  get code(): string | undefined {
    return typeof this.body?.code === "string" ? this.body.code : undefined;
  }

  get blockedBy(): { type: string; id: string; label: string }[] {
    return Array.isArray(this.body?.blockedBy) ? this.body.blockedBy : [];
  }

  /**
   * 原样重发有没有可能成功。上游还没换封套时字段不在——那时**不假定可重试**：
   * 猜"可以"会让页面对着一个永远失败的请求转圈。
   */
  get retryable(): boolean {
    return this.body?.retryable === true;
  }

  /** 出错的那个入参名（校验类错误才有）。 */
  get field(): string | undefined {
    return typeof this.body?.field === "string" ? this.body.field : undefined;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: "include",
      cache: "no-store",
      ...init,
      headers: {
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch (error) {
    // 网络层失败（BFF 没起、被拒绝连接）——0 表示"根本没拿到响应"。
    throw new OperaApiError(
      error instanceof Error ? error.message : "Network request failed",
      0,
    );
  }

  if (!response.ok) {
    const body = await readErrorBody(response);
    throw new OperaApiError(
      errorMessageFrom(body, response),
      response.status,
      body,
    );
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/**
 * BFF 的 Nest 异常体通常是 `{ message }`；但上游产品（如 runos 的注册校验）
 * 直接把 `{ code, errors: [{path, message}] }` 当异常体抛出，Nest 不做二次
 * 包装，`message` 字段根本不存在——不认 `errors[]` 就会把校验详情吞成一句
 * "Request failed (400)"，等于白抛。两种形状都认。
 */
async function readErrorBody(
  response: Response,
): Promise<OperaApiErrorBody | null> {
  try {
    const parsed: unknown = await response.json();
    return parsed && typeof parsed === "object"
      ? (parsed as OperaApiErrorBody)
      : null;
  } catch {
    /* 非 JSON 响应——调用方只能拿到状态码与 statusText。 */
    return null;
  }
}

function errorMessageFrom(
  body: OperaApiErrorBody | null,
  response: Response,
): string {
  if (body) {
    if (typeof body.message === "string") return body.message;
    if (Array.isArray(body.message)) return body.message.join("; ");
    if (Array.isArray(body.errors)) {
      return body.errors
        .map((e) =>
          e && typeof e === "object" && "message" in e
            ? String((e as { message: unknown }).message)
            : JSON.stringify(e),
        )
        .join("; ");
    }
  }
  return response.statusText || `Request failed (${response.status})`;
}

/**
 * 被 operator step-up 闸门拒绝（HTTP 403，message `step_up_required`）。
 *
 * `product_250` v0.4：step-up 的执行位在 console——opera-bff 的
 * `OperatorStepUpGuard` 在高危写路由上抛这个，门户据此发起仪式（见
 * `StepUpProvider`），而不是把原始后端消息糊到用户脸上。
 *
 * **判码，不判文案**（product_251 X-1）。文案兜底仍留着：它是给还没换上封套的
 * 上游用的，不是给 opera-bff 用的——opera-bff 侧现在一定带
 * `AUTH_STEP_UP_REQUIRED`。等三方都换完，这行兜底就该删。
 */
export function isStepUpRequiredError(error: unknown): boolean {
  if (!(error instanceof OperaApiError) || error.status !== 403) return false;
  return (
    error.code === "AUTH_STEP_UP_REQUIRED" ||
    error.message.toLowerCase().includes("step_up")
  );
}

/**
 * 提交 TOTP 码满足 step-up 闸门。成功后 BFF 种一枚短时 cookie（TTL 300s），
 * 调用方随即重试被拒的那个写操作。
 *
 * 码错、过期、或该 operator 根本没绑 MFA，都抛 OperaApiError。
 */
export async function submitOperatorStepUpTotp(
  code: string,
): Promise<{ ok: true; expiresIn: number }> {
  return api.post<{ ok: true; expiresIn: number }>(
    "/api/operator/step-up/totp",
    { code },
  );
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "POST",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
