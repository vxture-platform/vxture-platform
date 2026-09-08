/**
 * navigation-access.test.ts — 侧栏三级授权过滤链。
 *
 * ── 为什么这块值得测 ──
 * 授权判错**两个方向都不报错**：
 *   · 判宽了 → 没有权限的人在侧栏看见入口，点进去才被 BFF 挡（403）。看起来像
 *     「功能坏了」，实际是这里漏了一道门。
 *   · 判窄了 → 有权限的人看不见入口，功能等于不存在，而且**没有任何报错**，
 *     只会以「这个功能在哪」的形式变成一次支持工单。
 * 两种都不会在构建、类型或 lint 里现形。
 *
 * 链条是三级：域级 `capabilityAnyOf` → 屏级 `item.capability` → 租户类型。
 * 每一级各测「放行 / 拦截」两面，另加空域丢弃与边界取值。
 */
import { describe, expect, it } from "vitest";
import {
  findActiveDomain,
  selectVisibleDomains,
  type NavAccessContext,
} from "./navigation-access";
import type { ConsoleDomain, NavigationItem } from "@/config/navigation";
import type { Capability } from "@/entities/console";

const cap = (s: string) => s as Capability;

/** 补齐 NavigationItem 的必填项——测试关心的只是 capability / tenantTypes。 */
function item(
  over: Partial<NavigationItem> & { href: string },
): NavigationItem {
  return {
    labelKey: "x",
    icon: "receipt",
    descriptionKey: "x.desc",
    ...over,
  };
}

function domain(over: Partial<ConsoleDomain> = {}): ConsoleDomain {
  return {
    id: "billing",
    labelKey: "billing",
    icon: "receipt",
    sections: [
      {
        titleKey: "money",
        items: [item({ href: "/billing", labelKey: "billing.label" })],
      },
    ],
    ...over,
  };
}

function ctx(over: Partial<NavAccessContext> = {}): NavAccessContext {
  return { capabilities: [], ...over };
}

describe("selectVisibleDomains — 域级门（capabilityAnyOf）", () => {
  const gated = domain({ capabilityAnyOf: [cap("billing.read")] });

  it("持有其中任一能力 → 整域放行", () => {
    const out = selectVisibleDomains(
      [gated],
      ctx({ capabilities: [cap("billing.read")] }),
    );
    expect(out).toHaveLength(1);
  });

  it("不持有 → 整域不出现（不是出现一个空壳）", () => {
    const out = selectVisibleDomains(
      [gated],
      ctx({ capabilities: [cap("order.read")] }),
    );
    expect(out).toHaveLength(0);
  });

  it("域没有声明 capabilityAnyOf → 不限制（空 = 不设门，不是禁止）", () => {
    // 这一条是反例保护：若把「未声明」误当成「禁止」，整个侧栏会对所有人空掉，
    // 而那看起来像会话坏了，不像权限配置问题。
    const out = selectVisibleDomains([domain()], ctx());
    expect(out).toHaveLength(1);
  });
});

describe("selectVisibleDomains — 屏级门（item.capability）", () => {
  const twoItems = domain({
    sections: [
      {
        titleKey: "money",
        items: [
          item({ href: "/billing", capability: cap("billing.read") }),
          item({
            href: "/quotas",
            icon: "gauge",
            capability: cap("quota.read"),
          }),
        ],
      },
    ],
  });

  it("只保留持有能力的那几条", () => {
    const out = selectVisibleDomains(
      [twoItems],
      ctx({ capabilities: [cap("billing.read")] }),
    );
    expect(out[0]?.sections[0]?.items.map((i) => i.href)).toEqual(["/billing"]);
  });

  it("`.manage` 蕴含同资源 `.read`——与 BFF 守卫同一套规则", () => {
    // 前端若自己写 includes 就会漏掉这层蕴含，表现为：能改的人看不见入口。
    const out = selectVisibleDomains(
      [twoItems],
      ctx({ capabilities: [cap("billing.manage")] }),
    );
    expect(out[0]?.sections[0]?.items.map((i) => i.href)).toEqual(["/billing"]);
  });

  it("一条都不剩的 section 被丢掉，随之整域也不出现", () => {
    const out = selectVisibleDomains(
      [twoItems],
      ctx({ capabilities: [cap("order.read")] }),
    );
    expect(out).toHaveLength(0);
  });
});

describe("selectVisibleDomains — 租户类型门", () => {
  const orgOnly = domain({
    sections: [
      {
        titleKey: "team",
        items: [
          item({
            href: "/members",
            icon: "users",
            tenantTypes: ["organization"],
          }),
        ],
      },
    ],
  });

  it("类型匹配 → 放行", () => {
    const out = selectVisibleDomains(
      [orgOnly],
      ctx({ tenantType: "organization" }),
    );
    expect(out).toHaveLength(1);
  });

  it("类型不匹配 → 拦掉", () => {
    const out = selectVisibleDomains(
      [orgOnly],
      ctx({ tenantType: "personal" }),
    );
    expect(out).toHaveLength(0);
  });

  it("声明了 tenantTypes 但上下文没有类型 → 拦掉（未知不等于放行）", () => {
    // 会话还没解析出租户类型时短暂放行，会让个人租户闪一下组织才有的入口。
    expect(selectVisibleDomains([orgOnly], ctx())).toHaveLength(0);
  });

  it("没声明 tenantTypes → 不受类型限制", () => {
    expect(
      selectVisibleDomains([domain()], ctx({ tenantType: "personal" })),
    ).toHaveLength(1);
  });
});

describe("findActiveDomain", () => {
  const visible = selectVisibleDomains([domain()], ctx());

  it("按 href 精确命中所属域", () => {
    expect(findActiveDomain(visible, "/billing")?.id).toBe("billing");
  });

  it("不在任何域里的路由 → undefined（不要瞎认一个）", () => {
    expect(findActiveDomain(visible, "/nowhere")).toBeUndefined();
  });
});
