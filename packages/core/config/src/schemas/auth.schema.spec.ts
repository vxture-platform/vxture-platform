import { describe, expect, it } from "vitest";

import { authSchema } from "./auth.schema";

// 这一层是 guard 的 spec 看不见的：`config.module.ts` 按域 `domain.schema.parse(env)`，
// zod 会**剥掉 schema 里没声明的键**。一个在 env 里存在、schema 里没有的键，到
// `config.auth.<KEY>` 永远是 undefined——「做了没接」的典型形状，而 guard 的单测注入的是
// 手搓的 config 对象，根本不经过这一步。所以键能不能穿过 parse 要在这里单独证。

const BASE = {
  JWT_SECRET: "spec-jwt-secret-value-at-least-32-chars",
  JWT_REFRESH_SECRET: "spec-jwt-refresh-secret-different-32-chars",
};

describe("authSchema · 两把内部口令各自穿过域 parse", () => {
  it("IDP_INTERNAL_TOKEN 给了就原样到达", () => {
    const parsed = authSchema.parse({ ...BASE, IDP_INTERNAL_TOKEN: "idp-x" });
    expect(parsed.IDP_INTERNAL_TOKEN).toBe("idp-x");
  });

  it("AUTH_INTERNAL_TOKEN 给了就原样到达（产品面那把，本批不动）", () => {
    const parsed = authSchema.parse({ ...BASE, AUTH_INTERNAL_TOKEN: "auth-y" });
    expect(parsed.AUTH_INTERNAL_TOKEN).toBe("auth-y");
  });

  it("两把都给时互不串台", () => {
    const parsed = authSchema.parse({
      ...BASE,
      AUTH_INTERNAL_TOKEN: "auth-y",
      IDP_INTERNAL_TOKEN: "idp-x",
    });
    expect(parsed.AUTH_INTERNAL_TOKEN).toBe("auth-y");
    expect(parsed.IDP_INTERNAL_TOKEN).toBe("idp-x");
  });

  it("不给就是 undefined —— 没有默认值，也不从另一把回落", () => {
    const onlyAuth = authSchema.parse({
      ...BASE,
      AUTH_INTERNAL_TOKEN: "auth-y",
    });
    expect(onlyAuth.IDP_INTERNAL_TOKEN).toBeUndefined();

    const onlyIdp = authSchema.parse({ ...BASE, IDP_INTERNAL_TOKEN: "idp-x" });
    expect(onlyIdp.AUTH_INTERNAL_TOKEN).toBeUndefined();

    const neither = authSchema.parse(BASE);
    expect(neither.AUTH_INTERNAL_TOKEN).toBeUndefined();
    expect(neither.IDP_INTERNAL_TOKEN).toBeUndefined();
  });

  it("空串不是值：min(1) 拒绝（stripEmptyEnvValues 在 parse 前把 KEY= 当未设）", () => {
    expect(() =>
      authSchema.parse({ ...BASE, IDP_INTERNAL_TOKEN: "" }),
    ).toThrow();
  });

  it("反例：schema 里没有的键被 parse 剥掉 —— 这就是本文件在看的那一层", () => {
    // 若这一条不成立，上面「给了就到达」的断言就证明不了任何事：随便什么键都会穿过去。
    const parsed = authSchema.parse({
      ...BASE,
      NOT_DECLARED_INTERNAL_TOKEN: "ghost",
    }) as Record<string, unknown>;
    expect(parsed["NOT_DECLARED_INTERNAL_TOKEN"]).toBeUndefined();
    expect("NOT_DECLARED_INTERNAL_TOKEN" in parsed).toBe(false);
  });
});
