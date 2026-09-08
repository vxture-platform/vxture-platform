/**
 * registry.test.ts — 内容区段注册表与 legal 加载器。
 *
 * ── 为什么这块值得测 ──
 * 注册表漏一项**不报错、不影响构建**：那条路由直接 404，而 404 看起来像
 * 「这个页面还没做」，不像「配置漏了」。registry.ts 自己的注释就记着一次：
 * 「docs 之前只在页脚有链接、从未注册 → /docs 一直是 404（2026-08-23 审计发现）」
 * ——是靠人工审计撞见的，不是靠任何自动判据。
 *
 * legal 加载器同理：policy key 白名单少一个，那份法务文档就打不开，
 * 而页脚的链接还在，点进去是 404。
 *
 * 这个门户此前一个测试都没有；这是第一批。
 */
import { describe, expect, it } from "vitest";
import { CONTENT_REGISTRY, isContentSection } from "./registry";
import { legalLoader, legalStaticParams } from "./loaders/legal.loader";

/** loader 收 locale，但**路由判定与语言无关**——同一条路径在任何语言下都该是
    同一个结论。下面所有用例固定用它，另有一条专门验语言不改变判定。 */
const LOCALE = "zh-CN";

describe("CONTENT_REGISTRY", () => {
  it("页脚会链到的区段都已注册（漏一个就是一条静默 404）", () => {
    // 这几项都在页脚出现过；docs 正是 2026-08-23 审计撞见的那一个。
    for (const key of [
      "legal",
      "blog",
      "docs",
      "faq",
      "support",
      "insights",
      "careers",
      "certifications",
      "changelog",
    ]) {
      expect(isContentSection(key), `${key} 未注册`).toBe(true);
    }
  });

  it("每个已注册区段都真有 loader（占位也算，但不能是空）", () => {
    for (const [key, cfg] of Object.entries(CONTENT_REGISTRY)) {
      expect(typeof cfg.loader, `${key} 的 loader`).toBe("function");
    }
  });

  it("contact 刻意不在注册表里——它有自己的真实页面，留着会撞路由", () => {
    // 反例保护：把 contact 加回来会让 catch-all 把 /contact 预渲染成占位页，
    // 真实页面反而打不开。这条断言是为了让那次回退被看见。
    expect(isContentSection("contact")).toBe(false);
  });

  it("没注册的名字不认（isContentSection 不能恒真）", () => {
    expect(isContentSection("definitely-not-a-section")).toBe(false);
  });
});

describe("legalLoader", () => {
  it("/legal → 政策列表", async () => {
    await expect(legalLoader([], LOCALE)).resolves.toMatchObject({
      type: "legal-index",
      layout: "legal",
    });
  });

  it("六份政策都能打开（白名单少一个 = 页脚链接点进去 404）", async () => {
    for (const key of [
      "terms",
      "privacy",
      "copyright",
      "brand",
      "cookies",
      "refund",
    ]) {
      await expect(legalLoader([key], LOCALE), key).resolves.toMatchObject({
        type: "legal-detail",
        policyKey: key,
      });
    }
  });

  it("不认识的 policy → null（由路由层转 404，不是渲染一个空详情页）", async () => {
    await expect(legalLoader(["not-a-policy"], LOCALE)).resolves.toBeNull();
  });

  it("多段子路径 → null（/legal/terms/extra 不该落到详情页）", async () => {
    await expect(legalLoader(["terms", "extra"], LOCALE)).resolves.toBeNull();
  });
});

describe("legalStaticParams", () => {
  it("列表页 + 六份政策，共 7 条静态路径", () => {
    const params = legalStaticParams();
    expect(params).toHaveLength(7);
    expect(params[0]).toEqual([]);
  });

  it("静态路径与 loader 认的白名单一致——两边各改一处就会不一致", async () => {
    // 不一致的后果：静态生成了某条路径，loader 却返回 null（构建期就报错），
    // 或反过来 loader 认但没预生成（dynamicParams=false 下直接 404）。
    for (const p of legalStaticParams().slice(1)) {
      await expect(legalLoader(p, LOCALE), p.join("/")).resolves.not.toBeNull();
    }
  });
});

describe("locale 与路由判定无关", () => {
  it("同一条路径在中英文下得到同一个结论", async () => {
    // 若哪天 loader 按语言分叉，英文站会出现「中文能打开、英文 404」这种坏法
    // ——而它只在切到英文时才现形。
    for (const slug of [[], ["terms"], ["not-a-policy"]]) {
      const zh = await legalLoader(slug, "zh-CN");
      const en = await legalLoader(slug, "en-US");
      expect(en, slug.join("/") || "(index)").toEqual(zh);
    }
  });
});

describe("docs 子页 —— 外链不能落到 404", () => {
  const docs = CONTENT_REGISTRY.docs.loader;

  it("/docs 根路径仍是占位页", async () => {
    await expect(docs([], LOCALE)).resolves.toMatchObject({ type: "stub" });
  });

  it("console 侧栏外链的两个子页都不 404", async () => {
    // 这两条是 console「模型服务 / 技能工具」右侧外链的落点（owner 2026-09-08）。
    // 指向 404 的外链比没有外链更糟：让人以为文档丢了，而不是还没写。
    for (const page of ["models", "skills"]) {
      await expect(docs([page], LOCALE), page).resolves.toMatchObject({
        type: "stub",
      });
    }
  });

  it("没声明的子页仍然 404（白名单，不是全放行）", async () => {
    // 全放行会让 /docs/随便什么 都渲染成占位页：搜索引擎收录一堆不存在的路径，
    // 打错字也看不出来。
    await expect(docs(["not-declared"], LOCALE)).resolves.toBeNull();
  });

  it("更深的路径 404", async () => {
    await expect(docs(["models", "extra"], LOCALE)).resolves.toBeNull();
  });

  it("静态路径与 loader 认的白名单一致", async () => {
    // 签名允许返回 Promise（别的区段确实要读文件系统），await 一下才通用。
    const params = (await CONTENT_REGISTRY.docs.staticParams?.()) ?? [];
    expect(params).toHaveLength(3);
    for (const p of params) {
      await expect(
        docs(p, LOCALE),
        p.join("/") || "(root)",
      ).resolves.not.toBeNull();
    }
  });
});
