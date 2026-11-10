/**
 * Language persistence and cross-portal navigation regressions.
 * @package @vxture/workbench
 * @layer Presentation
 * @category test
 * @author AI-Generated
 * @date 2026-11-11
 */
import { afterEach, expect, it, vi } from "vitest";
import {
  getGlobalUserPreferences,
  setGlobalLocalePreference,
  synchronizeGlobalLocale,
  createLocalePreferenceTransport,
} from "@vxture/platform-browser";
import { dailyPresentation, parseHomeCopy } from "./presentation";
import { translate } from "./messages";
import { authNavigation } from "./navigation";

// ============================================================================
// Browser preference contract
// ============================================================================
function browser(
  cookie = "NEXT_LOCALE=en-US",
  href = "https://console.vxture.com/zh-CN/billing?tab=all#total",
) {
  const events = new EventTarget();
  const writes: string[] = [];
  const storage = new Map([["locale-storage", "zh-CN"]]);
  const history = { state: { index: 1 }, replaceState: vi.fn() };
  let currentCookie = cookie;
  vi.stubGlobal("window", {
    location: new URL(href),
    history,
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
  });
  vi.stubGlobal("document", {
    get cookie() {
      return currentCookie;
    },
    set cookie(value: string) {
      writes.push(value);
      if (value.startsWith("NEXT_LOCALE=") && !value.includes("max-age=0"))
        currentCookie = value.split(";")[0]!;
    },
    visibilityState: "visible",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  return {
    writes,
    storage,
    history,
    events,
    cookie: (value: string) => {
      currentCookie = value;
    },
  };
}
afterEach(() => vi.unstubAllGlobals());

it("loads a newer account preference on another root domain without writing it back", async () => {
  browser("NEXT_LOCALE=zh-CN", "https://ruyin.work/");
  const changed = vi.fn();
  const transport = {
    read: vi.fn(async () => ({ language: "en-US" })),
    write: vi.fn(async () => undefined),
  };
  const stop = synchronizeGlobalLocale("zh-CN", changed, transport);
  await vi.waitFor(() => expect(changed).toHaveBeenLastCalledWith("en-US"));
  expect(getGlobalUserPreferences().locale).toBe("en-US");
  expect(transport.write).not.toHaveBeenCalled();
  stop();
});

it("ignores a stale account read after an explicit language choice", async () => {
  browser("NEXT_LOCALE=zh-CN");
  let resolveRead!: (value: unknown) => void;
  const read = new Promise<unknown>((resolve) => {
    resolveRead = resolve;
  });
  const transport = { read: () => read, write: vi.fn(async () => undefined) };
  const changed = vi.fn();
  const stop = synchronizeGlobalLocale("zh-CN", changed, transport);
  setGlobalLocalePreference("en-US");
  resolveRead({ language: "zh-CN" });
  await vi.waitFor(() => expect(transport.write).toHaveBeenCalledWith("en-US"));
  expect(changed).toHaveBeenLastCalledWith("en-US");
  stop();
});

it("serializes writes and preserves pending saves when the locale route remounts", async () => {
  browser("NEXT_LOCALE=zh-CN");
  let finish!: () => void;
  const first = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const transport = {
    read: vi.fn(async () => ({ language: "zh-CN" })),
    write: vi
      .fn()
      .mockImplementationOnce(() => first)
      .mockResolvedValue(undefined),
  };
  const stop = synchronizeGlobalLocale("zh-CN", vi.fn(), transport);
  setGlobalLocalePreference("en-US");
  setGlobalLocalePreference("zh-CN");
  await vi.waitFor(() => expect(transport.write).toHaveBeenCalledTimes(1));
  stop();
  const reads = transport.read.mock.calls.length;
  const stopAgain = synchronizeGlobalLocale("zh-CN", vi.fn(), transport);
  expect(transport.read).toHaveBeenCalledTimes(reads);
  finish();
  await vi.waitFor(() => expect(transport.write).toHaveBeenCalledTimes(2));
  expect(transport.write.mock.calls.map(([locale]) => locale)).toEqual([
    "en-US",
    "zh-CN",
  ]);
  stopAgain();
});

it("retains the local language when account reads fail or have no preference", async () => {
  browser("NEXT_LOCALE=en-US");
  const stop = synchronizeGlobalLocale("zh-CN", vi.fn(), {
    read: async () => {
      throw new Error("unauthenticated");
    },
    write: async () => undefined,
  });
  await Promise.resolve();
  expect(getGlobalUserPreferences().locale).toBe("en-US");
  stop();
});

it("uses the shared cookie ahead of an older portal-local preference", () => {
  browser();
  expect(getGlobalUserPreferences().locale).toBe("en-US");
});

it("uses credentialed bounded profile requests and sends only the chosen language", async () => {
  const fetcher = vi.fn(
    async () => new Response(JSON.stringify({ language: "en-US" })),
  );
  vi.stubGlobal("fetch", fetcher);
  const transport = createLocalePreferenceTransport("/auth/language", "PATCH", {
    "x-workbench-request": "1",
  });
  await transport.read();
  await transport.write("en-US");
  expect(fetcher).toHaveBeenNthCalledWith(
    1,
    "/auth/language",
    expect.objectContaining({
      method: "GET",
      credentials: "include",
      cache: "no-store",
    }),
  );
  expect(fetcher).toHaveBeenNthCalledWith(
    2,
    "/auth/language",
    expect.objectContaining({
      method: "PATCH",
      keepalive: true,
      body: '{"language":"en-US"}',
      headers: {
        "x-workbench-request": "1",
        "content-type": "application/json",
      },
    }),
  );
});

it("removes legacy host cookies and writes the shared parent-domain preference", () => {
  const state = browser();
  setGlobalLocalePreference("en-US");
  expect(
    state.writes.some(
      (value) =>
        value.startsWith("NEXT_LOCALE=;") && value.includes("max-age=0"),
    ),
  ).toBe(true);
  expect(
    state.writes.some(
      (value) =>
        value.startsWith("NEXT_LOCALE=en-US;") &&
        value.includes("domain=.vxture.com"),
    ),
  ).toBe(true);
});

it("detects a sibling portal change when this tab regains focus and cleans up listeners", () => {
  const state = browser("NEXT_LOCALE=zh-CN");
  const changed = vi.fn();
  const stop = synchronizeGlobalLocale("zh-CN", changed);
  state.cookie("NEXT_LOCALE=en-US");
  state.events.dispatchEvent(new Event("focus"));
  expect(changed).toHaveBeenLastCalledWith("en-US");
  stop();
  changed.mockClear();
  state.events.dispatchEvent(new Event("focus"));
  expect(changed).not.toHaveBeenCalled();
});

it("accepts an explicit cross-origin language hint while preserving route state", () => {
  const state = browser(
    "NEXT_LOCALE=zh-CN",
    "https://ruyin.work/apps?filter=all&vx_locale=en-US#cards",
  );
  const changed = vi.fn();
  const stop = synchronizeGlobalLocale("zh-CN", changed);
  expect(changed).toHaveBeenLastCalledWith("en-US");
  expect(state.history.replaceState).toHaveBeenCalledWith(
    { index: 1 },
    "",
    "https://ruyin.work/apps?filter=all#cards",
  );
  expect(state.writes.some((value) => value.includes("domain="))).toBe(false);
  stop();
});

it("continues switching with cookies when browser storage is blocked", () => {
  browser();
  window.localStorage.setItem = () => {
    throw new Error("Storage denied");
  };
  window.localStorage.getItem = () => {
    throw new Error("Storage denied");
  };
  expect(() => setGlobalLocalePreference("en-US")).not.toThrow();
  expect(getGlobalUserPreferences().locale).toBe("en-US");
});

// ============================================================================
// Localized interface and calendar behavior
// ============================================================================
it("localizes date, greeting and configurable default titles together", () => {
  const day = dailyPresentation(
    new Date("2026-11-11T01:00:00Z"),
    parseHomeCopy({ titles: ["从容起步，稳步向前"] }),
    "en-US",
  );
  expect(day.greeting).toBe("Good morning");
  expect(day.weekday).toBe("Wednesday");
  expect(day.title).toBe("Start with confidence, move with purpose");
  expect(day.date).not.toMatch(/[年月日]/u);
});

it("interpolates translated UI without altering product or account names", () => {
  expect(translate("en-US", "查看{0}的概要", "标书编写")).toBe(
    "View overview of 标书编写",
  );
  expect(translate("en-US", "已收藏标书编写")).toBe(
    "Added 标书编写 to favorites",
  );
  expect(translate("zh-CN", "收藏")).toBe("收藏");
});

it("only forwards supported interface languages into authentication", () => {
  expect(
    authNavigation("login", "https://ruyin.work/", { ui_locales: "en-US" }),
  ).toContain("ui_locales=en-US");
  expect(
    authNavigation("login", "https://ruyin.work/", { ui_locales: "arbitrary" }),
  ).not.toContain("ui_locales");
});
