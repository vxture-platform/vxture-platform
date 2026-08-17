/**
 * maintenance-windows.spec.ts —— in_progress 下锁定字段的判定（product_251 B-1）。
 *
 * 这份测试的由来值得写下来：`affectedServices` 原本**按顺序**比，联调（2026-08-16）
 * 当场证伪——送 `['beta','alpha']` 而库里是 `['alpha','beta']` 会被 409 拒，而运营者
 * 一个服务都没改。守卫脚本对这种逻辑回退是瞎的，所以钉在这里。
 */
import { HttpException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { assertLiveEditable } from "./maintenance-windows.router";

const ROW = {
  severity: "minor" as const,
  title: "网关切换",
  affected_services: ["alpha", "beta"],
  start_at: new Date("2026-08-16T20:00:00Z"),
};

const BASE = {
  title: "网关切换",
  severity: "minor" as const,
  startAt: "2026-08-16T20:00:00Z",
  affectedServices: ["alpha", "beta"],
};

const lockedFields = (body: Record<string, unknown>): string | null => {
  try {
    assertLiveEditable(body as never, ROW);
    return null;
  } catch (error) {
    return error instanceof HttpException
      ? String((error.getResponse() as { message: string }).message)
      : String(error);
  }
};

describe("只拦「要改」，不拦「提到了」", () => {
  /* 控制台在 live 模式下把那几个输入框设为 disabled，**但仍然提交原值**。
     把「送了原值」也拦掉，等于让人在界面上根本存不下描述。 */
  it("原封不动送回全部锁定字段 —— 放行", () => {
    expect(lockedFields(BASE)).toBeNull();
  });

  it("什么都不送 —— 放行", () => {
    expect(lockedFields({})).toBeNull();
  });

  it("只改描述类字段 —— 放行（那是允许追记的）", () => {
    expect(
      lockedFields({
        ...BASE,
        description: "追记一段",
        impactDescription: "无",
      }),
    ).toBeNull();
  });
});

describe("真改了才拒，且点名", () => {
  it("改标题", () => {
    expect(lockedFields({ ...BASE, title: "别的" })).toContain("title");
  });

  it("改严重度", () => {
    expect(lockedFields({ ...BASE, severity: "critical" })).toContain(
      "severity",
    );
  });

  it("改开始时间", () => {
    expect(
      lockedFields({ ...BASE, startAt: "2026-08-16T21:00:00Z" }),
    ).toContain("startAt");
  });

  it("多个一起改时逐个点名", () => {
    const msg = lockedFields({ ...BASE, title: "别的", severity: "major" });
    expect(msg).toContain("title");
    expect(msg).toContain("severity");
  });

  /* 格式都不对的值肯定不是库里那个——不能因为解析失败就当"没改"放行。 */
  it("startAt 是垃圾值也算改了", () => {
    expect(lockedFields({ ...BASE, startAt: "not-a-date" })).toContain(
      "startAt",
    );
  });
});

describe("affectedServices 按集合比 —— 联调证伪过按序比", () => {
  it("换序 —— 放行（先后不承载语义）", () => {
    expect(
      lockedFields({ ...BASE, affectedServices: ["beta", "alpha"] }),
    ).toBeNull();
  });

  it("重复项 —— 放行（集合去重后相同）", () => {
    expect(
      lockedFields({ ...BASE, affectedServices: ["beta", "alpha", "beta"] }),
    ).toBeNull();
  });

  it("首尾空格 —— 放行（比的是 trim 后的值）", () => {
    expect(
      lockedFields({ ...BASE, affectedServices: [" alpha ", "beta"] }),
    ).toBeNull();
  });

  it("换了一个服务 —— 拒", () => {
    expect(
      lockedFields({ ...BASE, affectedServices: ["alpha", "gamma"] }),
    ).toContain("affectedServices");
  });

  it("少一个 —— 拒", () => {
    expect(lockedFields({ ...BASE, affectedServices: ["alpha"] })).toContain(
      "affectedServices",
    );
  });

  it("清空 —— 拒", () => {
    expect(lockedFields({ ...BASE, affectedServices: [] })).toContain(
      "affectedServices",
    );
  });
});
