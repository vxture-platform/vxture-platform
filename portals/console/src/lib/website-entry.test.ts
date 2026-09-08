/**
 * website-entry —— console → website 外链拼接。
 *
 * ── 这一格为什么值得测 ──
 * 这些 URL 指向**另一个部署**，链坏了本仓的构建、类型、lint 全是绿的：谁也不会
 * 报错，只有人点了才发现。2026-09-03 owner 就在线上撞见过一次（产品详情全 404，
 * 根因是 build-arg 没传 → `NEXT_PUBLIC_WEBSITE_URL` 被烘成**空字符串**，而空串
 * 不是 nullish，`??` 回退失效）。那一条现在钉在下面第一个 describe 里。
 *
 * 文档外链（2026-09-08）除了拼接本身，还多一条**跨仓约定**：`/docs/{section}`
 * 的 section 必须是 website 的 CONTENT_REGISTRY 声明过的子页，否则 404。这里只能
 * 钉住 console 这一侧发出的形状；registry 那一侧由 website 自己的
 * registry.test.ts 钉住白名单，两边共同保证链是活的。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const LOCALE = "zh-CN";

/**
 * 基址是**模块加载期**读的常量（`const WEBSITE_BASE_URL = ...` 在模块顶层），
 * 改完 env 必须重新 import 才生效——所以这里用动态 import + resetModules，
 * 而不是在文件顶部静态 import。
 */
async function load(baseUrl?: string) {
  vi.resetModules();
  if (baseUrl === undefined) delete process.env.NEXT_PUBLIC_WEBSITE_URL;
  else process.env.NEXT_PUBLIC_WEBSITE_URL = baseUrl;
  return import("./website-entry");
}

const ORIGINAL = process.env.NEXT_PUBLIC_WEBSITE_URL;

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_WEBSITE_URL;
  else process.env.NEXT_PUBLIC_WEBSITE_URL = ORIGINAL;
});

describe("基址回退", () => {
  it("**空字符串**也回退——这是 2026-09-03 那次线上 404 的根因", async () => {
    // 镜像声明了 ARG 但没传 build-arg 时，ENV 被烘成空串。空串不是 nullish，
    // 用 `??` 的话回退不触发，拼出来就是 `/zh-CN/docs/models`——相对路径，
    // 落到 console 自己域名上，必 404。
    const { buildWebsiteDocsUrl } = await load("");
    expect(buildWebsiteDocsUrl(LOCALE, "models")).toBe(
      "https://vxture.com/zh-CN/docs/models",
    );
  });

  it("未定义时回退到生产域名", async () => {
    const { buildWebsiteDocsUrl } = await load(undefined);
    expect(buildWebsiteDocsUrl(LOCALE, "models")).toBe(
      "https://vxture.com/zh-CN/docs/models",
    );
  });

  it("给了基址就用给的", async () => {
    const { buildWebsiteDocsUrl } = await load("https://staging.example.test");
    expect(buildWebsiteDocsUrl(LOCALE, "models")).toBe(
      "https://staging.example.test/zh-CN/docs/models",
    );
  });

  it("基址尾部斜杠不会拼出 `//`", async () => {
    const { buildWebsiteDocsUrl } = await load("https://vxture.com/");
    expect(buildWebsiteDocsUrl(LOCALE, "models")).toBe(
      "https://vxture.com/zh-CN/docs/models",
    );
  });
});

describe("文档链接", () => {
  it("带上当前 locale——website 的路由是 /{locale}/docs/...，漏了就 404", async () => {
    const { buildWebsiteDocsUrl } = await load("https://vxture.com");
    expect(buildWebsiteDocsUrl("en-US", "skills")).toBe(
      "https://vxture.com/en-US/docs/skills",
    );
  });

  it("section 走 encodeURIComponent", async () => {
    const { buildWebsiteDocsUrl } = await load("https://vxture.com");
    expect(buildWebsiteDocsUrl(LOCALE, "a b")).toBe(
      "https://vxture.com/zh-CN/docs/a%20b",
    );
  });

  it("导航配置里用到的 section 就是这两个", async () => {
    // 这两个名字必须与 website 的 CONTENT_REGISTRY.docs 白名单一致，否则外链 404。
    // 白名单那一侧由 website/src/lib/content/registry.test.ts 钉住。
    // 遍历 **consoleDomains**，不是 navigationSections：后者是向后兼容的扁平表，
    // 明确**不含**模型与能力域（那一域只经 consoleDomains 暴露）。初稿我读错了这一个，
    // 断言拿到空集合——正好说明这条断言是会动的，不是恒真。
    // 外壳（ConsoleAppShell）也是从 consoleDomains 派生侧栏的，读它才对得上真实渲染。
    const { consoleDomains } = await import("@/config/navigation");
    const sections = consoleDomains
      .flatMap((d) => d.sections)
      .flatMap((s) => s.items)
      .map((i) => i.docsSection)
      .filter((s): s is string => Boolean(s));
    expect(new Set(sections)).toEqual(new Set(["models", "skills"]));
  });
});
