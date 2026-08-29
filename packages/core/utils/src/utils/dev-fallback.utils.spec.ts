import { afterEach, describe, expect, it, vi } from "vitest";
import { chooseDevFallback } from "./dev-fallback.utils";

/**
 * 「dev 回退」选择器的完整矩阵。三个消费方（service-account / service-organization /
 * service-mail）各自的 spec 只钉自己的接线（模块名、缺的配置、回退实现），规则本身在
 * 这里证一次。
 */
const real = { kind: "real" };
const fallback = { kind: "fallback" };

const choose = (configured: boolean, warn = vi.fn()) =>
  chooseDevFallback({
    scope: "DemoModule",
    configured,
    real,
    fallback,
    fallbackName: "DemoFallback",
    missing: "DEMO_URL 为空",
    warn,
  });

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("chooseDevFallback", () => {
  it("配置齐 → 真实现，任何环境都不告警", () => {
    for (const env of ["production", "development", "test"]) {
      vi.stubEnv("NODE_ENV", env);
      const warn = vi.fn();
      expect(choose(true, warn)).toBe(real);
      expect(warn).not.toHaveBeenCalled();
    }
  });

  it("生产 + 配置缺 → 抛错，点名模块、缺的配置与被拒绝的假实现；不告警", () => {
    vi.stubEnv("NODE_ENV", "production");
    const warn = vi.fn();
    expect(() => choose(false, warn)).toThrow(
      /DemoModule.*DEMO_URL 为空.*DemoFallback/,
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(["development", "test"])(
    "NODE_ENV=%s + 配置缺 → 假实现，并告警一次（点名假实现）",
    (env) => {
      vi.stubEnv("NODE_ENV", env);
      const warn = vi.fn();
      expect(choose(false, warn)).toBe(fallback);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toMatch(/DemoFallback/);
    },
  );

  it("NODE_ENV 未设置按 development 处理（core-utils getNodeEnv 的既有约定）", () => {
    vi.stubEnv("NODE_ENV", "");
    expect(choose(false)).toBe(fallback);
  });
});
