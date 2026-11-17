/**
 * Distinguish confirmed session denial from unavailable verification.
 * @package @vxture/website
 * @layer Presentation
 * @category test
 * @author AI-Generated
 * @date 2026-11-17
 */
import { afterEach, expect, it, vi } from "vitest";
import { hasActiveSession } from "./auth.api";
afterEach(() => vi.unstubAllGlobals());
it.each([
  [200, true],
  [401, false],
  [403, false],
  [429, null],
  [500, null],
  [503, null],
])(
  "maps status %s to %s without loading projections",
  async (status, expected) => {
    const fetcher = vi.fn(async () => new Response(null, { status }));
    vi.stubGlobal("fetch", fetcher);
    expect(await hasActiveSession()).toBe(expected);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining("/auth/session"),
      expect.objectContaining({
        credentials: "include",
        cache: "no-store",
        signal: expect.any(AbortSignal),
      }),
    );
  },
);
it("treats network failure as unknown rather than a logout", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new TypeError("offline");
    }),
  );
  expect(await hasActiveSession()).toBe(null);
});
