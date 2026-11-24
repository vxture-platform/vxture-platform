/**
 * Session aggregation must distinguish unavailable facts from anonymous identity.
 * @package @vxture/console
 * @layer Presentation
 * @category test
 * @author AI-Generated
 * @date 2026-11-24
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { restoreSession } from "./console-bff";

afterEach(() => vi.unstubAllGlobals());

describe("current Cookie session aggregation", () => {
  it.each([
    "/auth/session",
    "/api/me",
    "/api/tenant-context",
    "/api/tenant-context/options",
    "/api/capabilities",
  ])(
    "rejects an unavailable %s instead of returning an empty identity",
    async (failed) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string) => {
          const path = new URL(input).pathname;
          return path === failed
            ? new Response(null, { status: 503 })
            : Response.json(path === "/api/me" ? { id: "current" } : []);
        }),
      );
      await expect(restoreSession()).rejects.toThrow();
    },
  );

  it("uses one bounded signal for the probe and all view reads", async () => {
    const signals: AbortSignal[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init: RequestInit) => {
        signals.push(init.signal as AbortSignal);
        return Response.json(
          new URL(input).pathname === "/api/me" ? { id: "current" } : [],
        );
      }),
    );
    expect((await restoreSession()).isAuthenticated).toBe(true);
    expect(signals).toHaveLength(5);
    expect(new Set(signals).size).toBe(1);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
  });

  it("returns anonymous only for a confirmed absent session", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetch);
    expect((await restoreSession()).isAuthenticated).toBe(false);
    expect(fetch).toHaveBeenCalledOnce();
  });
});
