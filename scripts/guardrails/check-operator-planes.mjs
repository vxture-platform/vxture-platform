#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// 三个运营平台的权限隔离守卫（owner 2026-09-14）
//
// 「三个平面，包括 bff，必须严格隔离，不能有互相引用的代码，可以重复但不能耦合」。
// admin（运营）/ opera（运维）/ arche（治理）三个平台读同一张 admin.operator_permission，
// 所以耦合不报错：一个 BFF 检查另一个平台的码，编译照过、测试照绿，后果只在授权时现形
// ——在一个平台授权，顺带打开了另一个平台的门。本守卫把这件事变成 lint 期的红。
//
// 事实只有一份：deploy/database/seed/seed-catalog.mjs 里的
//   OPERATOR_PLANE_DOMAINS  域 → 平台
//   OPERATOR_PERMISSIONS    操作码目录
//   MENU_TREE               三棵树
// 判据：
//   ① 三个平台的域互不相交；目录里每个码的域都属于某个平台。
//   ② 树恰好三个根 admin.plane / opera.plane / arche.plane；节点码前缀 = 所在平台；
//      每个操作码恰好挂一次，且挂在本平台的树上。
//   ③ bff/<p>-bff/src 与 portals/<p>/src 里出现的每个码：
//      · 域属于别的平台 → 红（跨平台检查码）；
//      · 域属于本平台但目录里没有 → 红（拼错或空码）；
//      · 旧域 platform / release / notification → 红（改名后的遗留）；
//      · {plane}.plane / {plane}.menu.* 的 plane 不是本平台 → 红。
//   ④ 没有跨平台 import（bff 之间、门户之间、门户与别的平台的 bff）。
//   ⑤ 目录里每个码都要在本平台源码里有消费方；没有的必须登记在 UNCONSUMED，
//      登记了却已经有消费方也红（登记表不许过期）。
//
// 只看字符串字面量，不看注释：注释里提到别的平台的码是说明，不是耦合。
// 单测里的别家码不算耦合（「opera 的码在 admin 不放行」正要写出别家的码），
// 但单测里用到的码也不算消费方——只在测试里出现的码，线上没有人检查它。
//
// 运行：node scripts/guardrails/check-operator-planes.mjs（pnpm lint:operator-planes）
// ─────────────────────────────────────────────────────────────────────────────

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const SEED = join(ROOT, "deploy/database/seed/seed-catalog.mjs");
const PLANES = ["admin", "opera", "arche"];
const LEGACY_DOMAINS = new Set(["platform", "release", "notification"]);

/**
 * 目录里有、本平台源码里没有消费方的码。每条写清为什么留着；
 * 新增一条没有消费方的码必须来这里登记，否则红。
 */
const ADMIN_LEGACY_BRIDGE =
  "admin-bff 仍经 auth.service 的旧桥检查 platform.* 扁平码，或这一页尚未设门；" +
  "按域重新设门是 admin 平台的待办（C5），码与角色授权保留给那次改造";
const UNCONSUMED = {
  "tenant:profile.read": ADMIN_LEGACY_BRIDGE,
  "tenant:verification.review": ADMIN_LEGACY_BRIDGE,
  "tenant:quota.read": ADMIN_LEGACY_BRIDGE,
  "tenant:quota.manage": ADMIN_LEGACY_BRIDGE,
  "user:profile.read": ADMIN_LEGACY_BRIDGE,
  "commerce:refund.execute": ADMIN_LEGACY_BRIDGE,
  "promotion:campaign.read": ADMIN_LEGACY_BRIDGE,
  "product:plan.read": ADMIN_LEGACY_BRIDGE,
  "product:price.read": ADMIN_LEGACY_BRIDGE,
  "product:price.manage": ADMIN_LEGACY_BRIDGE,
  "content:announcement.read": ADMIN_LEGACY_BRIDGE,
  "support:ticket.read": ADMIN_LEGACY_BRIDGE,
  "support:ticket.manage": ADMIN_LEGACY_BRIDGE,
  "support:impersonate": ADMIN_LEGACY_BRIDGE,
};

const failures = [];
const fail = (msg) => failures.push(msg);

// ── 从 seed 取三份字面量 ─────────────────────────────────────────────────────
const seedSrc = readFileSync(SEED, "utf8");

function literalAfter(marker) {
  const at = seedSrc.indexOf(marker);
  if (at < 0) throw new Error(`seed 里找不到 ${marker}——守卫读不到事实，不能放行`);
  const open = seedSrc.indexOf(marker.trim().endsWith("{") ? "{" : "[", at + marker.length - 1);
  const closeCh = seedSrc[open] === "{" ? "}" : "]";
  let depth = 0;
  for (let i = open; i < seedSrc.length; i += 1) {
    const ch = seedSrc[i];
    if (ch === seedSrc[open]) depth += 1;
    else if (ch === closeCh) {
      depth -= 1;
      if (depth === 0) return new Function(`return ${seedSrc.slice(open, i + 1)};`)();
    }
  }
  throw new Error(`${marker} 的字面量没有闭合`);
}

const PLANE_DOMAINS = literalAfter("export const OPERATOR_PLANE_DOMAINS = {");
const CATALOG = literalAfter("const OPERATOR_PERMISSIONS = [").map((row) => row[0]);
const TREE = literalAfter("const MENU_TREE = [");

const domainPlane = new Map();
for (const plane of PLANES) {
  const domains = PLANE_DOMAINS[plane];
  if (!Array.isArray(domains) || domains.length === 0) {
    throw new Error(`OPERATOR_PLANE_DOMAINS.${plane} 为空——守卫读不到事实，不能放行`);
  }
  for (const d of domains) {
    if (domainPlane.has(d)) fail(`① 域 ${d} 同时属于 ${domainPlane.get(d)} 与 ${plane}`);
    domainPlane.set(d, plane);
  }
}
const codeRe = /^([a-z_]+):([a-z_]+)(\.[a-z_]+)*$/;
const planeOfCode = (code) => domainPlane.get(code.split(":")[0]);

const catalog = new Set(CATALOG);
for (const code of CATALOG) {
  if (!codeRe.test(code)) fail(`① 目录码 ${code} 不是 domain:resource.action 形状`);
  else if (!planeOfCode(code)) fail(`① 目录码 ${code} 的域不属于任何平台`);
}

// ── ② 三棵树 ────────────────────────────────────────────────────────────────
const rootCodes = TREE.map((n) => n.code).sort();
if (rootCodes.join(",") !== PLANES.map((p) => `${p}.plane`).sort().join(",")) {
  fail(`② 树根应恰好是 ${PLANES.map((p) => `${p}.plane`).join(" / ")}，实际 ${rootCodes.join(" / ")}`);
}
const placed = new Map();
function walk(node, plane) {
  if (!node.code.startsWith(`${plane}.`)) fail(`② 节点 ${node.code} 挂在 ${plane}.plane 下，前缀不符`);
  for (const code of node.perms ?? []) {
    if (!catalog.has(code)) fail(`② 树上的码 ${code}（${node.code}）不在目录里`);
    if (planeOfCode(code) !== plane) fail(`② 码 ${code} 属于 ${planeOfCode(code) ?? "?"}，却挂在 ${plane} 的 ${node.code} 下`);
    if (placed.has(code)) fail(`② 码 ${code} 挂了两次：${placed.get(code)} 与 ${node.code}`);
    placed.set(code, node.code);
  }
  for (const child of node.children ?? []) walk(child, plane);
}
for (const rootNode of TREE) walk(rootNode, rootNode.code.split(".")[0]);
for (const code of CATALOG) if (!placed.has(code)) fail(`② 目录码 ${code} 没有挂到任何页面`);

// ── ③④⑤ 源码 ────────────────────────────────────────────────────────────────
function listFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    throw new Error(`读不到 ${relative(ROOT, dir)}——守卫看不见就不能放行`);
  }
  for (const name of entries) {
    if (name === "node_modules" || name === ".next" || name === "dist") continue;
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) out.push(...listFiles(abs));
    else if (/\.(ts|tsx|mts|mjs)$/.test(name)) out.push(abs);
  }
  return out;
}

/** 取出字符串字面量（跳过注释）。模板串里带 `${` 的不算一个码。 */
function stringLiterals(src) {
  const out = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === "/" && next === "/") {
      while (i < n && src[i] !== "\n") i += 1;
    } else if (ch === "/" && next === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i += 1;
      i += 2;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      let j = i + 1;
      let buf = "";
      while (j < n && src[j] !== quote) {
        if (src[j] === "\\") {
          buf += src[j + 1] ?? "";
          j += 2;
          continue;
        }
        if (quote !== "`" && src[j] === "\n") break;
        buf += src[j];
        j += 1;
      }
      if (!(quote === "`" && buf.includes("${"))) out.push({ value: buf, index: i });
      i = j + 1;
    } else {
      i += 1;
    }
  }
  return out;
}

const lineOf = (src, index) => src.slice(0, index).split("\n").length;
const consumed = new Map(PLANES.map((p) => [p, new Set()]));
let scanned = 0;

for (const plane of PLANES) {
  const roots = [join(ROOT, `bff/${plane}-bff/src`), join(ROOT, `portals/${plane}/src`)];
  const others = PLANES.filter((p) => p !== plane);
  for (const file of roots.flatMap(listFiles)) {
    scanned += 1;
    const src = readFileSync(file, "utf8");
    const rel = relative(ROOT, file).replace(/\\/g, "/");
    const isSpec = /\.(spec|test)\.(ts|tsx|mts|mjs)$/.test(file);

    for (const { value, index } of stringLiterals(src)) {
      const m = codeRe.exec(value);
      if (m) {
        const domain = m[1];
        if (LEGACY_DOMAINS.has(domain)) {
          fail(`③ ${rel}:${lineOf(src, index)}  "${value}" 是改名前的旧码`);
          continue;
        }
        const owner = domainPlane.get(domain);
        if (!owner) continue; // node:fs、测试里的 x:y 之类
        if (owner !== plane) {
          if (!isSpec) {
            fail(`③ ${rel}:${lineOf(src, index)}  "${value}" 属于 ${owner}，${plane} 不许检查它`);
          }
        } else if (!catalog.has(value)) {
          fail(`③ ${rel}:${lineOf(src, index)}  "${value}" 不在目录里（拼错或空码）`);
        } else if (!isSpec) {
          consumed.get(plane).add(value);
        }
        continue;
      }
      const pm = /^(admin|opera|arche)\.(plane|menu\.[a-z_]+)$/.exec(value);
      if (pm && pm[1] !== plane) {
        fail(`③ ${rel}:${lineOf(src, index)}  "${value}" 是 ${pm[1]} 平台的菜单码`);
      }
    }

    for (const m of src.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
      const spec = m[1];
      const crossBff = others.some((o) => spec.includes(`${o}-bff`) || spec === `@vxture/bff-${o}`);
      const crossPortal = others.some((o) => new RegExp(`(^|/)portals/${o}(/|$)`).test(spec));
      if (crossBff || crossPortal) {
        fail(`④ ${rel}:${lineOf(src, m.index)}  import "${spec}" 跨到了别的平台`);
      }
    }
  }
}

for (const code of CATALOG) {
  const plane = planeOfCode(code);
  if (!plane) continue;
  const used = consumed.get(plane).has(code);
  if (!used && !(code in UNCONSUMED)) {
    fail(`⑤ ${code}（${plane}）在本平台源码里没有消费方——删掉它，或登记到 UNCONSUMED 并写明理由`);
  }
  if (used && code in UNCONSUMED) {
    fail(`⑤ ${code} 已有消费方，从 UNCONSUMED 里摘掉`);
  }
}
for (const code of Object.keys(UNCONSUMED)) {
  if (!catalog.has(code)) fail(`⑤ UNCONSUMED 登记的 ${code} 不在目录里`);
}

console.log("══ 运营三平台权限隔离（check-operator-planes）══");
console.log(`  · 目录 ${CATALOG.length} 个操作码，三棵树，扫描 ${scanned} 个源文件`);
for (const plane of PLANES) {
  const own = CATALOG.filter((c) => planeOfCode(c) === plane);
  console.log(`  · ${plane}: ${own.length} 个码，${consumed.get(plane).size} 个有消费方`);
}
if (failures.length) {
  console.error(`\n✗ ${failures.length} 处违规：`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log("✓ 三个平台互不耦合");
