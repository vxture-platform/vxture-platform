/**
 * HTTP failure semantics and active-workspace entitlement regressions.
 * @package @vxture/workbench
 * @layer Presentation
 * @category test
 * @author AI-Generated
 * @date 2026-11-05
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadWorkData, projectApps, safeHttpUrl } from "./api";
import { authNavigation } from "./navigation";
import type { CatalogProduct, Subscription } from "./contracts";

const product: CatalogProduct = {
  code: "agent",
  name: "Agent",
  nick: "专业智能体",
  type: "industry_agent",
  description: "",
  version: "1.0.0",
  stage: "stable",
  active: true,
  maintenance: false,
  icon: null,
};
const active: Subscription = {
  code: "agent",
  status: "active",
  tier: "team",
  maintenance: false,
};
const entry = { code: "agent", href: "https://product.example/" };
afterEach(() => vi.unstubAllGlobals());

// ============================================================================
// Projection safety and RP transitions
// ============================================================================
describe("product availability", () => {
  it("does not inherit default-workspace eligibility from launch tiles", () => {
    expect(
      projectApps(
        [product],
        { status: "ready", data: [] },
        { status: "ready", data: [entry] },
      )[0]?.available,
    ).toBe(false);
    expect(
      projectApps(
        [product],
        { status: "ready", data: [active] },
        { status: "ready", data: [entry] },
      )[0]?.available,
    ).toBe(true);
  });
  it("fails closed for maintenance, missing URLs and entitlement errors", () => {
    expect(
      projectApps(
        [{ ...product, maintenance: true }],
        { status: "ready", data: [active] },
        { status: "ready", data: [entry] },
      )[0]?.available,
    ).toBe(false);
    expect(
      projectApps(
        [product],
        { status: "ready", data: [active] },
        { status: "ready", data: [] },
      )[0]?.availabilityLabel,
    ).toBe("入口暂不可用");
    expect(
      projectApps(
        [product],
        { status: "error", code: 403, message: "forbidden" },
        { status: "ready", data: [entry] },
      )[0]?.availabilityLabel,
    ).toBe("权限待确认");
  });
  it("rejects script, relative and credential-bearing destinations", () => {
    for (const value of [
      "javascript:alert(1)",
      "/local",
      "//evil.example",
      "https://user:secret@example.com",
      "data:text/html,test",
    ])
      expect(safeHttpUrl(value)).toBeNull();
    expect(safeHttpUrl("https://product.example")).toBe(
      "https://product.example/",
    );
  });
  it("keeps RP transitions same-origin and encodes scope identifiers", () => {
    const path = authNavigation(
      "switch-workspace",
      "https://work.example/apps?returnTo=https://evil.example#section",
      { workspaceId: "a/b&c", returnTo: "https://evil.example" },
    );
    const url = new URL(path, "https://work.example");
    expect(url.origin).toBe("https://work.example");
    expect(url.searchParams.get("returnTo")).toBe(
      "https://work.example/apps#section",
    );
    expect(url.searchParams.get("workspaceId")).toBe("a/b&c");
  });
});

// ============================================================================
// Real adapter lifecycle and independent failures
// ============================================================================
describe("HTTP adapter", () => {
  it("returns unauthenticated immediately without requesting private data", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetcher);
    expect(
      await loadWorkData(new AbortController().signal, true),
    ).toMatchObject({ status: "error", code: 401 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not render HTML fallback or malformed JSON as an empty catalog", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("<html>fallback</html>", { status: 200 }),
        ),
    );
    expect(
      await loadWorkData(new AbortController().signal, true),
    ).toMatchObject({ status: "error", code: 502 });
  });
  it("keeps catalog outages and permission failures distinct from empty data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string) => {
        const payloads: Record<string, unknown> = {
          "/auth/session": { status: "active" },
          "/api/me": { id: "u", name: "User" },
          "/api/tenant-context": {
            id: "t",
            name: "Organization",
            workspace: "w",
            workspaceName: "default workspace",
          },
        };
        if (path === "/api/products/catalog")
          return new Response(null, { status: 503 });
        if (path === "/api/subscription/subscribed-products")
          return new Response(null, { status: 403 });
        return Response.json(payloads[path] ?? []);
      }),
    );
    const result = await loadWorkData(new AbortController().signal, true);
    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.data.catalog).toMatchObject({ status: "error", code: 503 });
      expect(result.data.availabilityIssue).toBe("当前账号没有查看权限");
      expect(result.data.resources.status).toBe("error");
    }
  });
  it("clears the authenticated result when any independent request reports session expiry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string) => {
        if (path === "/auth/session")
          return Response.json({ status: "active" });
        if (path === "/api/me") return Response.json({ id: "u", name: "User" });
        if (path === "/api/tenant-context")
          return Response.json({
            id: "t",
            name: "Organization",
            workspace: "w",
          });
        if (path === "/api/iam/workspaces/mine")
          return new Response(null, { status: 401 });
        return Response.json([]);
      }),
    );
    expect(
      await loadWorkData(new AbortController().signal, true),
    ).toMatchObject({ status: "error", code: 401 });
  });
});
