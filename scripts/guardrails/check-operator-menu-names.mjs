#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// 运营菜单权限节点的显示名 ↔ 侧栏上屏的名字，必须一致。
//
// ── 为什么需要 ──
// 2026-09-21 owner：「权限是独立配置的，其他板块引用」。既然别处引用它，它就得
// 和别处对得上。实测漂了 5 条：
//
//   admin.menu.tenant_profile      权限树「租户信息」   侧栏「租户管理」
//   admin.menu.account_system      权限树「账号体系」   侧栏「账号管理」
//   admin.menu.product_capability  权限树「产品能力」   侧栏「产品目录」
//   admin.menu.plan_version        权限树「套餐版本」   侧栏「产品套餐」
//   admin.menu.model_gateway       权限树「模型计价与策略」 侧栏「模型计价策略」
//
// 漂的机制：权限树是 arche「权限配置」页**直接画 perm_name**（没有 i18n 中转），
// 而 admin 侧栏画的是 `messages/*.json` 的词条。页面改名时只改了词条，
// `seed-catalog.mjs` 留在原地——而且 menu 层的 upsert 刻意不覆盖 perm_name，
// 所以连重新 seed 都救不回来。后果是配角色的人看到的页面名，和运营在侧栏看到的
// 不是一个词。
//
// ── 判据取 route，不取名字 ──
// seed 的 `route` ↔ navigation.ts 的 `href`。名字正是这里对不上的那样东西，
// 拿它当连接键等于假设结论。
//
// ── 三家的上屏名来自不同地方 ──
//   admin        走 i18n：messages/zh-CN.json 的 `navigation.items.<id>.label`
//                （navigation.ts 里的 `label` 只是兜底，**不上屏**——
//                 2026-09-18 那次「账号体系→平台用户」只改了它，于是改名没发生）
//   opera/arche  没有 i18n 导航，navigation.ts 的 `label` 就是上屏名
//
// 运行:  node scripts/guardrails/check-operator-menu-names.mjs
// 别名:  pnpm lint:operator-menu-names
// 退出码:发现不一致 → 1；一条都没扫到 → 1（判据失效不是「没问题」）。
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const SEED = join(REPO_ROOT, "deploy/database/seed/seed-catalog.mjs");

/** 各平面：菜单码前缀、导航配置、上屏名从哪来。 */
const PLANES = [
  { plane: "admin", prefix: "admin.menu.", portal: "admin", i18n: true },
  { plane: "opera", prefix: "opera.menu.", portal: "opera", i18n: false },
  { plane: "arche", prefix: "arche.menu.", portal: "arche", i18n: false },
];

function read(path) {
  if (!existsSync(path)) {
    console.error(`✗ 找不到 ${path}——判据失效，不是「没问题」。`);
    process.exit(1);
  }
  return readFileSync(path, "utf8");
}

/** seed 里带 route 的菜单节点：{code, name, route}。没有 route 的是分组，本守卫不覆盖。 */
function seedMenuNodes(src, prefix) {
  const out = [];
  const re = new RegExp(
    `code:\\s*"(${prefix.replace(/\./g, "\\.")}[a-z_]+)",\\s*\\n\\s*name:\\s*"([^"]+)",\\s*\\n\\s*route:\\s*"([^"]+)"`,
    "g",
  );
  let m;
  while ((m = re.exec(src))) out.push({ code: m[1], name: m[2], route: m[3] });
  return out;
}

/** navigation.ts 的叶子项：{id, href, label}。按对象块切，块内取三者。 */
function navItems(src) {
  const out = [];
  for (const block of src.split(/\n\s{4,8}\{\n/)) {
    if (!block.includes("href:")) continue;
    /* 不要求前导换行：块从 `{` 之后切开，`id:` 可能就是块的第一行。
       少了这一条，取不到 id 的块会走进下面的「读不到」分支。 */
    const id = block.match(/(?:^|\n)\s*id:\s*"([A-Za-z0-9]+)"/);
    const href = block.match(/(?:^|\n)\s*href:\s*"([^"]+)"/);
    const label = block.match(/(?:^|\n)\s*label:\s*"([^"]+)"/);
    if (href && label) {
      out.push({ id: id?.[1] ?? null, href: href[1], label: label[1] });
    }
  }
  return out;
}

const seedSrc = read(SEED);
const problems = [];
let checked = 0;
let skippedNoRoute = 0;

for (const { plane, prefix, portal, i18n } of PLANES) {
  const navPath = join(REPO_ROOT, `portals/${portal}/src/config/navigation.ts`);
  const nodes = seedMenuNodes(seedSrc, prefix);
  if (!nodes.length) continue;

  const items = navItems(read(navPath));
  const byHref = new Map(items.map((i) => [i.href, i]));

  let messages = null;
  if (i18n) {
    messages = JSON.parse(
      read(join(REPO_ROOT, `portals/${portal}/messages/zh-CN.json`)),
    );
  }

  for (const node of nodes) {
    const item = byHref.get(node.route);
    /* 权限树里有、侧栏里没有的页面是允许的（纯菜单叶子、或还没上线的页）。
       本守卫只管「两边都有时名字一致」，不管覆盖面。 */
    if (!item) {
      skippedNoRoute += 1;
      continue;
    }
    /* admin 的上屏名**只**在词条里。取不到就抛——退回 navigation.ts 的 `label`
       是拿一个不上屏的值来比，会凭空造出不一致。本守卫初版就这么误报了两条：
       servicePlans / commerceOverview 的词条其实对得上，只是 id 没抓到。 */
    let rendered;
    if (i18n) {
      rendered = messages?.navigation?.items?.[item.id ?? ""]?.label;
      if (!rendered) {
        console.error(
          `✗ ${node.code}: 取不到上屏名（id=${item.id ?? "?"}）。判据读不到就是失效，` +
            `不退回 navigation.ts 的 label——那个值不上屏。`,
        );
        process.exit(1);
      }
    } else {
      rendered = item.label;
    }
    checked += 1;
    if (rendered !== node.name) {
      problems.push(
        `${node.code}  权限树「${node.name}」 ≠ 侧栏「${rendered}」  (${node.route})`,
      );
    }
  }
}

console.log("══ 运营菜单显示名(check-operator-menu-names)══");
console.log(
  `  · 对上 ${checked} 个页面节点（按 route 连接），跳过 ${skippedNoRoute} 个侧栏里没有的`,
);

// 一条都没对上 = 抓取坏了，不是「没问题」。
if (checked === 0) {
  console.error(
    "✗ 一个菜单节点都没对上——判据失效（seed 里有二十多个带 route 的）。",
  );
  process.exit(1);
}

if (problems.length) {
  console.error(`\n✗ ${problems.length} 处名字对不上：`);
  for (const p of problems) console.error(`  · ${p}`);
  console.error(
    `\n  改 seed-catalog.mjs 的 name，并配一条迁移更新存量库\n` +
      `  （menu 层的 upsert 刻意不覆盖 perm_name，重新 seed 救不回来）。\n` +
      `  admin 的上屏名在 messages/*.json，不是 navigation.ts 的 label。`,
  );
  process.exit(1);
}

console.log("✓ 权限树与侧栏的页面名逐一对上。");
