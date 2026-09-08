/**
 * tenant-display.test.ts — 对外的租户标签。
 *
 * ── 为什么这块值得测 ──
 * 这个函数现在被**三处**共用：header 品牌第二段（owner 2026-09-08 加的 `{tenant}`）、
 * TenantPanel 的切换按钮、切换器里的每一项。三处必须逐字一致——同一个租户在同一屏上
 * 长出两种写法，比只显示一处更糟，而且**不报错**。
 *
 * 更要紧的是它存在的理由（owner 2026-07-06 定）：个人自建租户按用户名命名，
 * 而这个人自己创建的团队很可能同名。不带类型后缀，切换器里就会出现两条一模一样的
 * 「yanhaoguo」，**选错了不会有任何提示**——直到发现自己在错误的租户下建了东西。
 */
import { describe, expect, it } from "vitest";
import { formatTenantDisplay } from "./tenant-display";

describe("formatTenantDisplay", () => {
  it("名字 + 类型后缀，类型首字母大写", () => {
    expect(formatTenantDisplay("StoneSmoker", "personal")).toBe(
      "StoneSmoker Personal",
    );
    expect(formatTenantDisplay("Acme", "organization")).toBe(
      "Acme Organization",
    );
  });

  it("同名不同类型必须能分辨——这就是加后缀的全部理由", () => {
    const a = formatTenantDisplay("yanhaoguo", "personal");
    const b = formatTenantDisplay("yanhaoguo", "organization");
    expect(a).not.toBe(b);
  });

  it("没有类型时只给名字（不补一个假的后缀）", () => {
    expect(formatTenantDisplay("Acme", null)).toBe("Acme");
    expect(formatTenantDisplay("Acme", "")).toBe("Acme");
    expect(formatTenantDisplay("Acme", "   ")).toBe("Acme");
  });

  it("没有名字就返回空串，交给调用方兜底", () => {
    // 返回空串而不是「未命名」一类的词：兜底文案属于调用方（TenantPanel 用
    // t("tenantOrg")、品牌那段用 undefined 表示先不画 tag），这里不替它决定。
    for (const v of [null, undefined, "", "   "]) {
      expect(formatTenantDisplay(v, "personal")).toBe("");
    }
  });

  it("名字两端空白被裁掉（否则品牌那段会多出一个空格）", () => {
    expect(formatTenantDisplay("  Acme  ", "organization")).toBe(
      "Acme Organization",
    );
  });

  it("中文租户名照常带后缀", () => {
    expect(formatTenantDisplay("玄真科技", "organization")).toBe(
      "玄真科技 Organization",
    );
  });

  it("类型是未知取值时原样带出（不吞掉，也不猜）", () => {
    // 将来多一种租户类型时，这里应当显示出来让人发现，而不是悄悄当成没有类型。
    expect(formatTenantDisplay("Acme", "reseller")).toBe("Acme Reseller");
  });
});
