/**
 * Offline IP lookup boundary and resource regressions.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-09
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  exists: true,
  search: vi.fn<() => string | Promise<string>>(
    () => "中国|广东省|深圳市|电信|CN",
  ),
  close: vi.fn(),
  open: vi.fn(),
}));
vi.mock("node:fs", async (original) => ({
  ...(await original<typeof import("node:fs")>()),
  existsSync: () => state.exists,
}));
vi.mock("ip2region.js", async (original) => ({
  ...(await original<typeof import("ip2region.js")>()),
  newWithFileOnly: (...args: unknown[]) => {
    return state.open(...args) ?? { search: state.search, close: state.close };
  },
}));
import { IpGeolocationService } from "./ip-geolocation.service";

// ============================================================================
// Location behavior and resource bounds
// ============================================================================

beforeEach(() => {
  vi.clearAllMocks();
  state.exists = true;
  state.search.mockReset().mockReturnValue("中国|广东省|深圳市|电信|CN");
  state.open.mockReset();
});

describe("offline activity location", () => {
  it("projects only country, region, city and ISO country code", async () => {
    const service = new IpGeolocationService();
    expect(await service.locate("113.118.113.77")).toEqual({
      kind: "public",
      country: "中国",
      region: "广东省",
      city: "深圳市",
      countryCode: "CN",
    });
    expect(state.search).toHaveBeenCalledWith("113.118.113.77");
    service.onModuleDestroy();
    expect(state.close).toHaveBeenCalledOnce();
  });

  it.each([
    "10.0.0.1",
    "127.0.0.1",
    "192.168.1.2",
    "172.16.2.1",
    "169.254.1.1",
    "100.64.1.1",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:192.168.1.1",
  ])("classifies private IP %s without querying the database", async (ip) => {
    expect((await new IpGeolocationService().locate(ip)).kind).toBe("private");
    expect(state.open).not.toHaveBeenCalled();
  });

  it.each([
    null,
    "",
    "not-an-ip",
    "https://example.com",
    "203.0.113.28",
    "192.0.2.2",
    "198.51.100.3",
    "198.18.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::",
    "2001:db8::1",
    "ff02::1",
  ])("returns unknown for invalid or reserved IP %s", async (ip) => {
    expect((await new IpGeolocationService().locate(ip)).kind).toBe("unknown");
    expect(state.open).not.toHaveBeenCalled();
  });

  it("normalizes mapped IPv4 and IPv6 and opens at most one handle per family", async () => {
    const service = new IpGeolocationService();
    await service.locate("::ffff:113.118.113.77");
    await service.locate("113.118.113.77");
    state.search.mockReturnValue("United States|California|San Jose|xTom|US");
    expect(await service.locate("2604:a840:3::a04d")).toMatchObject({
      city: "San Jose",
      countryCode: "US",
    });
    await service.locate("2604:a840:0003:0000:0000:0000:0000:a04d");
    expect(state.open).toHaveBeenCalledTimes(2);
    expect(state.search).toHaveBeenCalledTimes(2);
    service.onModuleDestroy();
    expect(state.close).toHaveBeenCalledTimes(2);
  });

  it("bounds the cache at 512 entries", async () => {
    const service = new IpGeolocationService();
    for (let index = 0; index < 513; index++)
      await service.locate(`11.0.${Math.floor(index / 256)}.${index % 256}`);
    expect(state.search).toHaveBeenCalledTimes(513);
    await service.locate("11.0.0.0");
    expect(state.search).toHaveBeenCalledTimes(514);
    expect(state.open).toHaveBeenCalledOnce();
  });

  it("handles missing databases without repeated open attempts", async () => {
    state.exists = false;
    const service = new IpGeolocationService();
    expect((await service.locate("1.1.1.1")).kind).toBe("unknown");
    expect((await service.locate("8.8.8.8")).kind).toBe("unknown");
    expect(state.open).not.toHaveBeenCalled();
  });

  it("falls back when the database is unreadable", async () => {
    state.open.mockImplementation(() => {
      throw new Error("unreadable");
    });
    expect((await new IpGeolocationService().locate("1.1.1.1")).kind).toBe(
      "unknown",
    );
  });

  it.each(["", "0|0|0|0|0"])(
    "does not manufacture a location from empty result %s",
    async (result) => {
      state.search.mockReturnValue(result);
      expect((await new IpGeolocationService().locate("1.1.1.1")).kind).toBe(
        "unknown",
      );
    },
  );

  it("preserves partial locations without inventing a city", async () => {
    state.search.mockReturnValue("Australia|0|0|0|AU");
    expect(await new IpGeolocationService().locate("1.1.1.1")).toMatchObject({
      country: "Australia",
      region: null,
      city: null,
      countryCode: "AU",
    });
  });

  it("awaits the upstream asynchronous query result", async () => {
    state.search.mockResolvedValue("中国|广东省|深圳市|电信|CN");
    expect(
      await new IpGeolocationService().locate("113.118.113.77"),
    ).toMatchObject({ city: "深圳市" });
  });

  it("absorbs asynchronous query rejection", async () => {
    state.search.mockRejectedValue(new Error("read failed"));
    expect((await new IpGeolocationService().locate("1.1.1.1")).kind).toBe(
      "unknown",
    );
  });

  it("queries the pinned real IPv4 and IPv6 databases when prepared", async (context) => {
    const actual =
      await vi.importActual<typeof import("ip2region.js")>("ip2region.js");
    const fs = await vi.importActual<typeof import("node:fs")>("node:fs");
    const { join } = await import("node:path");
    const directory = [
      join(process.cwd(), "dist/assets/ip-geolocation"),
      join(process.cwd(), "bff/auth-bff/dist/assets/ip-geolocation"),
    ].find((path) => fs.existsSync(join(path, "ip2region_v6.xdb")));
    if (!directory) return context.skip();
    state.open.mockImplementation((version: unknown) => {
      const family = version === actual.IPv4 ? 4 : 6;
      return actual.newWithFileOnly(
        family === 4 ? actual.IPv4 : actual.IPv6,
        join(directory, `ip2region_v${family}.xdb`),
      );
    });
    const service = new IpGeolocationService();
    try {
      expect(await service.locate("113.118.113.77")).toMatchObject({
        city: "深圳市",
        countryCode: "CN",
      });
      expect(await service.locate("2604:a840:3::a04d")).toMatchObject({
        city: "San Jose",
        countryCode: "US",
      });
    } finally {
      service.onModuleDestroy();
    }
  });

  it("returns unknown after query failure", async () => {
    state.search.mockImplementation(() => {
      throw new Error("corrupt data");
    });
    expect((await new IpGeolocationService().locate("1.1.1.1")).kind).toBe(
      "unknown",
    );
  });
});
