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

it("uses the shared cookie ahead of an older portal-local preference", () => {
  browser();
  expect(getGlobalUserPreferences().locale).toBe("en-US");
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
