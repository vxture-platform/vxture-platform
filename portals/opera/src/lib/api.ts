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

export class OperaApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "OperaApiError";
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
    throw new OperaApiError(await readErrorMessage(response), response.status);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** BFF 的 Nest 异常体是 `{ message }`；拿不到就退回状态文本。 */
async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === "string") return body.message;
    if (Array.isArray(body.message)) return body.message.join("; ");
  } catch {
    /* 非 JSON 响应，走下面的兜底 */
  }
  return response.statusText || `Request failed (${response.status})`;
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
};
