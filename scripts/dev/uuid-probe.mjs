#!/usr/bin/env node
/**
 * uuid-probe.mjs — 逐页扫运营台界面上有没有 UUID 露出来。
 *
 * ## 为什么必须是运行时，不能是静态扫描
 *
 * owner 铁律：**任何界面不展示 UUID**——文字、悬停提示、读屏标签、导出的 CSV 都算。
 * 铁律原文自己写着这条的验收方式：「静态 grep 分不清同名字段在这张表是编码还是
 * UUID」。实测也是这样：admin 的 title/aria-label/placeholder 共五百多处，绝大多数
 * 是中文说明，静态扫必然大面积误报——**而误报的守卫会被关掉，连带真问题一起放过**。
 *
 * 所以页面这一半只能渲染完再看。CSV 那一半反过来：它在点击那一刻才由 Blob 生成，
 * DOM 里从不存在，这个探针一行都照不到，只能静态守
 * （scripts/guardrails/check-visible-code-display.mjs 干那个）。两半各用各的手段。
 *
 * ## 为什么在 scripts/dev 而不是 scripts/guardrails
 *
 * guardrails 下那三十多条都是 `pnpm lint:*` 调用的纯静态脚本，CI 里无人值守地跑。
 * 这个探针要**浏览器 + 登录态**：运营台三个平台都在 IdP 后面，而机器身份怎么拿到
 * 只读会话是一件比探针本身还大的事（没解决之前，接进 CI 只会得到一条永远失败、
 * 然后被关掉的检查）。所以它现在是**人工在本地跑的工具**，和 fixtures.mjs 同性质。
 *
 * ## 用法
 *
 *   node scripts/dev/uuid-probe.mjs --base https://<运营台域名> --routes admin
 *   pnpm probe:uuid -- --base https://<运营台域名> --routes admin
 *
 * 它只**打印**要扫的路由清单与扫描脚本，不自己开浏览器——本机没有无头浏览器的
 * 统一约定，而 Claude in Chrome 已经能带着人的登录态执行页内脚本。所以这里出清单
 * 与脚本，扫描在浏览器里跑，两边不重复造轮子。
 *
 * ## 判据
 *
 * 命中 = 文本节点、`[title]`、`[aria-label]`、`[alt]`、`[placeholder]` 里出现
 * UUID 正则。全零 UUID 单独列出——它在 Atlas 是「平台自检」哨兵，不一定是缺陷。
 */
import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const portal = arg("routes", "admin");
const base = arg("base");

/** 从 app 目录推出静态路由；带 [param] 的另列，它们要真实参数才打得开。 */
function routesOf(name) {
  const appDir = resolve(ROOT, "portals", name, "src/app");
  const out = { static: [], dynamic: [] };
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry === "page.tsx") {
        const rel = full
          .slice(appDir.length)
          .split("\\")
          .join("/")
          .replace("/page.tsx", "")
          .replace(/\/\([^)]+\)/g, "")
          .replace("/[locale]", "");
        const path = rel === "" ? "/" : rel;
        if (path.includes("[")) out.dynamic.push(path);
        else out.static.push(path);
      }
    }
  };
  walk(appDir);
  out.static.sort();
  out.dynamic.sort();
  return out;
}

const routes = routesOf(portal);

console.log(`══ UUID 上屏探针：${portal} ══`);
console.log(`静态路由 ${routes.static.length} 条、动态路由 ${routes.dynamic.length} 条\n`);
for (const r of routes.static) console.log(`  ${base ? base + r : r}`);
if (routes.dynamic.length) {
  console.log(`\n动态路由（要从列表页现取真实参数，用假 id 会撞 404 —— 而「没扫到」和「扫过没问题」在报告里长得一模一样）：`);
  for (const r of routes.dynamic) console.log(`  ${r}`);
}

console.log(`\n── 在浏览器控制台里对每一页跑这段 ──\n`);
console.log(String.raw`
(() => {
  const RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
  const ZERO = "00000000-0000-0000-0000-000000000000";
  const hits = [];
  const push = (where, text) => {
    for (const m of String(text).match(RE) || []) {
      hits.push({ where, uuid: m, sentinel: m.toLowerCase() === ZERO });
    }
  };
  const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    if (n.nodeValue && n.nodeValue.trim()) push("文本", n.nodeValue);
  }
  for (const attr of ["title", "aria-label", "alt", "placeholder"]) {
    for (const el of document.querySelectorAll("[" + attr + "]")) {
      push(attr, el.getAttribute(attr));
    }
  }
  return JSON.stringify({
    页面: location.pathname,
    命中数: hits.filter(h => !h.sentinel).length,
    哨兵数: hits.filter(h => h.sentinel).length,
    明细: hits.filter(h => !h.sentinel).slice(0, 20),
  }, null, 1);
})()
`);
