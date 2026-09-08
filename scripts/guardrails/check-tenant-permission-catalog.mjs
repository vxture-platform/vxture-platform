#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// 租户权限目录一致性守卫:seed ↔ @vxture/core-utils ↔ console 导航 ↔ 迁移
//
// 权限目录有两份定义,各自不可省:seed(seed-catalog.mjs)写库,core-utils
// (tenant-permissions.ts)给前端与 BFF 引用——JS 与 TS 互不能 import。两份一旦漂移,
// 症状是「某个角色看得到菜单点进去 403」或反过来,且不报错。所以逐码比对:
//   ① 操作码集合:seed PERMISSIONS == core-utils TENANT ∪ WORKSPACE 码;
//   ② 菜单树:seed TENANT_MENU_TREE 与 core-utils TENANT_MENU_TREE 的码序、路由、
//      每页挂的操作码逐一相同;
//   ③ console 导航:navigation.ts 的每个 href 都是树里的页面路由,每个 capability
//      都是目录里的操作码;
//   ④ 存量库迁移 2026-09-10-access-console-permission-catalog.sql 提到全部菜单码
//      与操作码(它与 seed 是同一份内容的两种落库路径)。
//
// 运行:  node scripts/guardrails/check-tenant-permission-catalog.mjs
// 别名:  pnpm lint:permission-catalog
// 退出码:任一不一致 → 1。
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const read = (p) => readFileSync(resolve(REPO_ROOT, p), "utf8");

const SEED = "deploy/database/seed/seed-catalog.mjs";
const CORE = "packages/core/utils/src/tenant-permissions.ts";
const NAV = "portals/console/src/config/navigation.ts";
/* 菜单码不是只出现在最初那一份迁移里——后来新增的节点各自有自己的迁移
   （2026-09-08：tenant.menu.skills 落在 2026-09-23-tenant-menu-skills.sql）。
   原先写死一份文件名，等于假设「以后不会再加菜单」；那个假设一破，
   守卫就会对着一条完全正确的新增迁移报错。改成扫全部迁移。 */
const MIGRATION_DIR = "deploy/database/migrations";

/** 取 `const NAME = [ … ];`(或带类型标注)的数组字面量并求值——字面量里只有数据。 */
function literalArray(src, name, where) {
  const re = new RegExp(`const ${name}(?:\\s*:[^=]+)?\\s*=\\s*(\\[[\\s\\S]*?\\n\\])(?: as const)?;`);
  const m = src.match(re);
  if (!m) throw new Error(`${where}: 找不到 const ${name} = [ … ];`);
  return new Function(`return ${m[1]};`)();
}

function flatten(nodes, parent = null, out = []) {
  for (const n of nodes) {
    out.push({
      code: n.code,
      route: n.route ?? null,
      perms: [...(n.perms ?? [])],
      parent,
    });
    if (n.children) flatten(n.children, n.code, out);
  }
  return out;
}

const errors = [];
const fail = (msg) => errors.push(msg);

const seedSrc = read(SEED);
const coreSrc = read(CORE);
const navSrc = read(NAV);
const migrationSrc = readdirSync(resolve(REPO_ROOT, MIGRATION_DIR))
  .filter((f) => f.endsWith(".sql"))
  .map((f) => read(`${MIGRATION_DIR}/${f}`))
  .join(String.fromCharCode(10));

// ① 操作码集合
const seedCodes = literalArray(seedSrc, "PERMISSIONS", SEED).map((p) => p[0]);
const coreCodes = [
  ...literalArray(coreSrc, "TENANT_PERMISSION_CODES", CORE),
  ...literalArray(coreSrc, "WORKSPACE_PERMISSION_CODES", CORE),
];
for (const c of seedCodes)
  if (!coreCodes.includes(c)) fail(`seed 有而 core-utils 没有的操作码:${c}`);
for (const c of coreCodes)
  if (!seedCodes.includes(c)) fail(`core-utils 有而 seed 没有的操作码:${c}`);

// ② 菜单树
const seedTree = flatten(literalArray(seedSrc, "TENANT_MENU_TREE", SEED));
const coreTree = flatten(literalArray(coreSrc, "TENANT_MENU_TREE", CORE));
if (seedTree.length !== coreTree.length) {
  fail(`菜单节点数不同:seed ${seedTree.length} vs core-utils ${coreTree.length}`);
}
seedTree.forEach((s, i) => {
  const c = coreTree[i];
  if (!c) return;
  if (s.code !== c.code) fail(`第 ${i + 1} 个节点码不同:seed ${s.code} vs core-utils ${c.code}`);
  if (s.route !== c.route) fail(`${s.code} 路由不同:seed ${s.route} vs core-utils ${c.route}`);
  if (s.parent !== c.parent) fail(`${s.code} 父节点不同:seed ${s.parent} vs core-utils ${c.parent}`);
  if (s.perms.join() !== c.perms.join())
    fail(`${s.code} 挂的操作码不同:seed [${s.perms}] vs core-utils [${c.perms}]`);
});
const menuCodes = seedTree.map((n) => n.code);
for (const n of seedTree)
  for (const p of n.perms)
    if (!seedCodes.includes(p)) fail(`${n.code} 挂了目录里没有的操作码:${p}`);

// ②-b 操作码的归属唯一:一个码只能挂在一个页面下。
//
// perms 是**归属**(对应 DB 的 access.permissions.parent_id,一个码只有一个父),
// 不是「进这一页要什么码」的门。门是导航项的 capability 与页面的 CapabilityGate,
// 两个页面共用一个码走门,不是靠第二条挂靠关系。
//
// 为什么单加这一条:上面 ① 比的是 seed 与 core-utils **是否一样**,而 2026-09-08
// 我把同一个错误同时写进了两边——两边一样地错,一致性检查一个字都不会说。
// 这条不看两边是否一致,只看这一份**自身是否成立**:两类判据缺一不可。
{
  const owner = new Map();
  for (const n of seedTree)
    for (const p of n.perms) {
      if (owner.has(p))
        fail(`操作码 ${p} 同时挂在 ${owner.get(p)} 与 ${n.code} 下——归属只能有一个;两页共用同一个码请走门(navigation 的 capability),不要挂两次`);
      else owner.set(p, n.code);
    }
}

// ③ console 导航
const routes = new Set(seedTree.map((n) => n.route).filter(Boolean));
for (const m of navSrc.matchAll(/href:\s*"([^"]+)"/g)) {
  if (!routes.has(m[1])) fail(`navigation.ts 的 ${m[1]} 在菜单树里没有页面节点`);
}
for (const m of navSrc.matchAll(/capability:\s*"([^"]+)"/g)) {
  if (!seedCodes.includes(m[1])) fail(`navigation.ts 用了目录里没有的码:${m[1]}`);
}
for (const m of navSrc.matchAll(/capabilityAnyOf:\s*(\[[^\]]*\])/g)) {
  for (const c of m[1].matchAll(/"([^"]+)"/g))
    if (!seedCodes.includes(c[1])) fail(`navigation.ts capabilityAnyOf 用了目录里没有的码:${c[1]}`);
}

// ④ 迁移覆盖
for (const code of [...menuCodes, ...seedCodes.filter((c) => c.startsWith("tenant."))]) {
  if (!migrationSrc.includes(`'${code}'`))
    fail(`${MIGRATION_DIR} 下没有任何一份迁移提到 ${code}——新菜单节点要连着迁移一起加`);
}

console.log("══ 租户权限目录一致性(check-tenant-permission-catalog)══");
console.log(`  · 操作码 ${seedCodes.length} · 菜单节点 ${menuCodes.length} · 导航 href ${[...navSrc.matchAll(/href:\s*"/g)].length}`);
if (errors.length) {
  for (const e of errors) console.log(`  ✗ ${e}`);
  process.exit(1);
}
console.log("✓ seed / core-utils / navigation / migration 四处一致。");
