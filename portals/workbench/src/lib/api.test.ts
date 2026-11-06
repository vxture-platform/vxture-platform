/**
 * HTTP failure semantics and active-workspace entitlement regressions.
 * @package @vxture/workbench
 * @layer Presentation
 * @category test
 * @author AI-Generated
 * @date 2026-11-05
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadWorkData,
  projectApps,
  safeHttpUrl,
  loadInbox,
  markNotificationsRead,
} from "./api";
import { authNavigation } from "./navigation";
import { homeApps } from "./presentation";
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
  it("keeps bundled-only products visible and usable without inventing a commercial tier", () => {
    const app = projectApps(
      [product],
      {
        status: "ready",
        data: [{ ...active, bundled: true, tier: null, favorite: true }],
      },
      { status: "ready", data: [entry] },
    )[0];
    expect(app).toMatchObject({ available: true, tier: null, favorite: true });
  });
  it("does not let expired primary history hide active bundled coverage", () => {
    const app = projectApps(
      [product],
      {
        status: "ready",
        data: [
          { ...active, status: "expired", tier: "free" },
          { ...active, bundled: true, tier: null },
        ],
      },
      { status: "ready", data: [entry] },
    )[0];
    expect(app).toMatchObject({
      available: true,
      tier: null,
      availabilityLabel: "可使用",
    });
  });
  it("preserves a live direct purchase's tier alongside bundled coverage", () => {
    const app = projectApps(
      [product],
      {
        status: "ready",
        data: [{ ...active, bundled: true, tier: null }, active],
      },
      { status: "ready", data: [entry] },
    )[0];
    expect(app).toMatchObject({ available: true, tier: "team" });
  });
  it("does not turn expired or maintained bundled coverage into an available product", () => {
    for (const subscription of [
      { ...active, bundled: true, tier: null, status: "expired" },
      { ...active, bundled: true, tier: null, maintenance: true },
    ]) {
      expect(
        projectApps(
          [product],
          { status: "ready", data: [subscription] },
          { status: "ready", data: [entry] },
        )[0]?.available,
      ).toBe(false);
    }
  });
  it("places the catalog business name before its brand nickname", () => {
    const app = projectApps(
      [product],
      { status: "ready", data: [active] },
      { status: "ready", data: [entry] },
    )[0];
    expect(app).toMatchObject({ name: product.name, brand: product.nick });
  });
  it("does not inherit default-workspace eligibility from launch tiles", () => {
    expect(
      projectApps(
        [product],
        { status: "ready", data: [] },
        { status: "ready", data: [entry] },
      ),
    ).toEqual([]);
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
      ),
    ).toEqual([]);
  });
  it("shows only subscribed products while retaining unavailable subscribed cards", () => {
    const apps = projectApps(
      [
        product,
        { ...product, code: "unsubscribed" },
        { ...product, code: "expired" },
      ],
      {
        status: "ready",
        data: [active, { ...active, code: "expired", status: "expired" }],
      },
      { status: "ready", data: [entry, { code: "expired", href: entry.href }] },
    );
    expect(apps.map((item) => item.code)).toEqual(["agent", "expired"]);
    expect(apps[1]).toMatchObject({
      available: false,
      availabilityLabel: "已到期",
    });
  });
  it("keeps grace-period coverage and prefers it over expired history", () => {
    const app = projectApps(
      [product],
      {
        status: "ready",
        data: [
          { ...active, status: "expired" },
          { ...active, status: "overdue" },
        ],
      },
      { status: "ready", data: [entry] },
    )[0];
    expect(app?.available).toBe(true);
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
  it("preserves bundled coverage and favorites through the HTTP response boundary", async () => {
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
          },
          "/api/products/catalog": ["agent", "favorite", "public"].map(
            (code) => ({
              productCode: code,
              productName: code,
              productType: "industry_agent",
              status: "active",
              maintenance: null,
            }),
          ),
          "/api/subscription/subscribed-products": [
            {
              productCode: "agent",
              status: "expired",
              tier: "free",
              maintenance: null,
            },
            {
              productCode: "agent",
              status: "active",
              tier: null,
              bundled: true,
              maintenance: null,
            },
            {
              productCode: "favorite",
              status: "active",
              tier: "team",
              favorite: true,
              maintenance: null,
            },
          ],
          "/api/me/apps": ["agent", "favorite", "public"].map((code) => ({
            code,
            homeUrl: `https://${code}.example/`,
          })),
        };
        return Response.json(payloads[path] ?? []);
      }),
    );
    const result = await loadWorkData(new AbortController().signal, true);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.data.catalog.status).toBe("ready");
    if (result.data.catalog.status !== "ready") return;
    expect(result.data.catalog.data).toHaveLength(2);
    expect(result.data.catalog.data[0]).toMatchObject({
      code: "agent",
      available: true,
      tier: null,
    });
    expect(homeApps(result.data.catalog.data).map((app) => app.code)).toEqual([
      "favorite",
      "agent",
    ]);
  });
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

// ============================================================================
// Inbox boundary failures must never masquerade as an empty inbox.
// ============================================================================
describe("notification adapters", () => {
  it("rejects malformed unread totals and timestamps", async () => {
    for (const payload of [
      { items: [], unreadCount: -1 },
      {
        unreadCount: 1,
        items: [{ id: "one", title: "Test", createdAt: "bad-date" }],
      },
    ]) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(JSON.stringify(payload))),
      );
      expect((await loadInbox(new AbortController().signal)).status).toBe(
        "error",
      );
    }
  });
  it("preserves server failures rather than declaring no notifications", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 503 })),
    );
    expect(await loadInbox(new AbortController().signal)).toMatchObject({
      status: "error",
      code: 503,
    });
  });
  it("uses explicit same-origin POSTs and surfaces write failures", async () => {
    const fetcher = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetcher);
    const signal = new AbortController().signal;
    await markNotificationsRead("message/id", signal);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/me/inbox/message%2Fid/read",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        headers: expect.objectContaining({ "X-Workbench-Request": "1" }),
      }),
    );
    fetcher.mockImplementation(async () => new Response("", { status: 403 }));
    await expect(markNotificationsRead(null, signal)).rejects.toThrow(
      "标记已读失败",
    );
  });
});
