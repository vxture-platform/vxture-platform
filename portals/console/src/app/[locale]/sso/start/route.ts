/**
 * route.ts - 跨应用 SSO 启动入口
 * @package  @vxture/console
 * @layer    Presentation
 * @category Route
 * @description
 *   复用跨 Portal ctx 协议，从 Console 登录态生成 auth-bff crossdomain token，
 *   再安全回跳到业务应用 callback。
 *
 * @author AI-Generated
 * @date 2026-05-28
 */

import { NextResponse, type NextRequest } from "next/server";
import {
  decodePortalContext,
  type PortalNavContext,
} from "@vxture-platform/shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type CrossDomainTokenResponse = {
  readonly token?: unknown;
};

type SsoAppPolicy = {
  readonly allowedOrigins: readonly string[];
  readonly targetDomain: string;
};

// ============================================================================
// 策略配置
// ============================================================================

const SSO_POLICIES: Record<string, SsoAppPolicy> = {
  ruyin: {
    allowedOrigins: ["https://vpn.ruyin.ai"],
    targetDomain: "ruyin.ai",
  },
};

const DEV_ALLOWED_ORIGINS = new Set([
  "http://localhost:3000",
  "http://localhost:3110",
  // 外部 ruyin.ai 网站本地 SSO callback/origin，区别于 Vxture 内的 Ruyin Agent UI。
  "http://localhost:3220",
  "http://localhost:8081",
]);

const HTTP_STATUS = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
} as const;

// ============================================================================
// Route Handler
// ============================================================================

/**
 * 处理跨应用 SSO 启动请求。
 *
 * @param request - Next.js 请求对象
 * @returns 带 token 的业务应用回跳响应
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const ctx = decodePortalContext(request.nextUrl.search);
  if (!ctx) {
    return ssoError("Missing or invalid ctx", HTTP_STATUS.BAD_REQUEST);
  }

  const target = parseAllowedReturnTo(ctx);
  if (!target) {
    return ssoError("returnTo is not allowed", HTTP_STATUS.FORBIDDEN);
  }

  const token = await requestCrossDomainToken(request, target.targetDomain);
  if (!token) {
    return ssoError(
      "Unable to create crossdomain token",
      HTTP_STATUS.UNAUTHORIZED,
    );
  }

  const returnTo = target.url;
  returnTo.searchParams.set("token", token);
  if (ctx.state) {
    returnTo.searchParams.set("state", ctx.state);
  }

  return NextResponse.redirect(returnTo);
}

// ============================================================================
// 校验与上游调用
// ============================================================================

function parseAllowedReturnTo(
  ctx: PortalNavContext,
): { url: URL; targetDomain: string } | null {
  let returnTo: URL;
  try {
    returnTo = new URL(ctx.returnTo);
  } catch {
    return null;
  }

  if (returnTo.protocol !== "https:" && returnTo.protocol !== "http:") {
    return null;
  }

  const policy = SSO_POLICIES[ctx.from];
  if (policy && policy.allowedOrigins.includes(returnTo.origin)) {
    return { url: returnTo, targetDomain: policy.targetDomain };
  }

  if (
    process.env.NODE_ENV !== "production" &&
    DEV_ALLOWED_ORIGINS.has(returnTo.origin)
  ) {
    return { url: returnTo, targetDomain: "ruyin.ai" };
  }

  return null;
}

async function requestCrossDomainToken(
  request: NextRequest,
  targetDomain: string,
): Promise<string | null> {
  const tokenUrl = new URL(`${authBffUrl()}/auth/crossdomain/token`);
  tokenUrl.searchParams.set("targetDomain", targetDomain);

  const response = await fetch(tokenUrl, {
    method: "GET",
    headers: forwardCookieHeader(request),
    cache: "no-store",
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response
    .json()
    .catch(() => ({}))) as CrossDomainTokenResponse;
  return typeof payload.token === "string" && payload.token
    ? payload.token
    : null;
}

function authBffUrl(): string {
  const authBffUrl = (
    process.env.NEXT_PUBLIC_AUTH_BFF_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    "http://localhost:3081"
  ).replace(/\/+$/, "");
  const usesDirectAuthBff =
    Boolean(process.env.NEXT_PUBLIC_AUTH_BFF_URL?.trim()) ||
    !process.env.NEXT_PUBLIC_API_URL?.trim();
  const authApiPrefix = (
    process.env.NEXT_PUBLIC_AUTH_API_PREFIX ??
    (usesDirectAuthBff ? "" : "/auth-api")
  ).replace(/\/+$/, "");

  return `${authBffUrl}${authApiPrefix}`;
}

function forwardCookieHeader(request: NextRequest): HeadersInit {
  const cookie = request.headers.get("cookie");
  return cookie ? { Cookie: cookie } : {};
}

function ssoError(message: string, status: number): NextResponse {
  return new NextResponse(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
