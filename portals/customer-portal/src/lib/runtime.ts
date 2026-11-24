/**
 * Published runtime configuration; local design fixtures are never a production fallback.
 * @package @vxture/customer-portal
 * @layer Presentation
 * @category config
 * @author AI-Generated
 * @date 2026-11-15
 */
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { PortalBrand, WorkspaceData } from "./contracts";

/** Return whether the operator explicitly enabled local visual development. */
export async function isDesignPreview(): Promise<boolean> {
  return (
    process.env.NODE_ENV === "development" &&
    process.env.CUSTOMER_PORTAL_DESIGN_PREVIEW === "1" &&
    /^(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]+)?$/.test(
      (await headers()).get("host") ?? "",
    )
  );
}

/** Load the published public brand for the request's exact registered hostname. */
export async function loadBrand(): Promise<PortalBrand> {
  if (await isDesignPreview())
    return {
      name: "如影智能研究院",
      title: "具身智能体\n空间服务平台",
      subtitle: "连接物理空间与智能体，支撑空间感知、场景建模与协同执行。",
      brandColor: "var(--vx-color-brand-700)",
      appearance: "light",
      density: "comfortable",
      logo: null,
      favicon: null,
      background: null,
    };
  const response = await portalRequest("/api/portal");
  if (response.status === 404) notFound();
  if (!response.ok)
    throw new Error("Published portal configuration is unavailable");
  return (await response.json()) as PortalBrand;
}

/** The browser cannot supply the internal routing credential or override the request host. */
export async function portalRequest(
  path: string,
  init: RequestInit = {},
  stream = false,
): Promise<Response> {
  const incoming = await headers();
  const host = incoming.get("host") ?? "";
  if (!/^(?:a|[a-z][a-z0-9]{2,7})\.ruyin\.work$/.test(host)) notFound();
  const upstream = process.env.TENANT_BFF_URL;
  const token = process.env.TENANT_BFF_TOKEN;
  if (!upstream || !token)
    throw new Error("Customer portal backend is not configured");
  const forwarded = new Headers(init.headers);
  forwarded.set("x-customer-portal-host", host);
  forwarded.set("x-customer-portal-token", token);
  for (const key of ["cookie", "sec-fetch-site", "origin"]) {
    const value = incoming.get(key);
    if (value) forwarded.set(key, value);
  }
  const deadline = new AbortController();
  const timeout = setTimeout(() => deadline.abort(), 25000);
  try {
    return await fetch(new URL(path, upstream), {
      ...init,
      headers: forwarded,
      redirect: "manual",
      cache: "no-store",
      signal: stream
        ? AbortSignal.any([
            deadline.signal,
            ...(init.signal ? [init.signal] : []),
          ])
        : AbortSignal.timeout(25000),
    });
  } finally {
    clearTimeout(timeout);
  }
}

// ============================================================================
// Local visual walkthrough; these entries must never be used as subscription data.
// ============================================================================
export const DESIGN_WORKSPACE: WorkspaceData = {
  name: "研究员",
  workspaceName: "默认工作空间",
  apps: [
    {
      code: "karda",
      name: "企业知识服务平台",
      description: "连接研究资料与团队知识，让每一次提问都有据可循。",
      category: "知识与数据",
      href: null,
    },
    {
      code: "arda",
      name: "智能数据治理平台",
      description: "从数据接入到质量治理，构建可信、可用的数据基础。",
      category: "知识与数据",
      href: null,
    },
    {
      code: "tenderforge",
      name: "标书编写智能体",
      description: "理解需求、梳理方案，让专业表达更清晰，让工作更从容。",
      category: "专业智能体",
      href: null,
    },
  ],
};
