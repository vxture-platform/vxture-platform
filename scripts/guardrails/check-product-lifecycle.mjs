#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// check-product-lifecycle.mjs —— 产品生命周期状态机的**四处**对账
//
// ── 补的是哪个盲区 ──
//
// 产品状态机写在四个地方，而它们之间没有任何机械链路：
//
//   1. `@vxture-platform/shared` 的 `PRODUCT_STATUSES`   —— 有哪几个状态（值域）
//   2. opera-bff 的 `STATE_TRANSITIONS`                  —— 哪条边走得通（真约束）
//   3. opera 门户的 `PRODUCT_STATE_META`                 —— 每个状态怎么显示
//   4. opera 门户的 `PRODUCT_ACTIONS`                    —— 运营**点得到**哪些边
//
// `lifecycle.ts` 的文件头注一直写着「这三处必须一致，改一处就要改另外两处」——
// 它自己漏数了：本文件里其实有两份（状态表与动作表）。
//
// 2026-09-24 接 `developing` 时就栽在第 4 处：值域、BFF、状态表都改了，动作表没改。
// 后果不是「少一个按钮」：
//
//   · 没有任何动作的 `to` 是 `developing` ⇒ 运营**进不去**这一档；
//   · `launch` 的 `from` 只有 `draft` ⇒ 就算进去了也**出不来**。
//
// 当时差一步就把 13 个产品改成 `developing`，那会造出 13 个卡死在无出边状态里的
// 产品——而 type-check、全部单测、以及另外 64 条守卫**全绿**。是去界面上点开那个
// 菜单才看见的（[[feedback_copy_both_halves_and_open_the_page]]：合并前要真打开一次）。
//
// ── 判据（四条，都是双向）──
//
//   A. BFF 的状态集 == @shared 的值域         （多一个 / 少一个都算）
//   B. 门户状态表的键 == @shared 的值域
//   C. 动作表给得出的边 == BFF 允许的边       ← 2026-09-24 漏的就是这一条
//   D. 每个非终态都至少有一条出边能被点到     （进得去也要出得来）
//
// ── 它看不见什么 ──
//
// · 只读**源码里的声明**，不读库。`chk_products_status` 与 @shared 的对账归
//   `lint:catalog-domains`（那一条比的是 DDL↔TS），两条各管一段。
// · 不判边的**语义**对不对（「active → developing 该不该存在」是产品决定）。它只保证
//   四处说的是同一件事——两边一样地错它抓不到（[[feedback_consistency_vs_invariant]]），
//   所以判据 D 另外查一条性质：非终态必须有出口。
// · 动作的 `requiresChecklist` / `destructive` 这些修饰不在对账范围内。
//
// 用法：node scripts/guardrails/check-product-lifecycle.mjs  (pnpm lint:product-lifecycle)
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import process from "node:process";

const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const read = (p) => readFileSync(resolve(root, p), "utf8");

const SHARED = "packages/shared/shared/src/constants/catalog-domains.constants.ts";
const BFF = "bff/opera-bff/src/routers/product-catalog.router.ts";
const PORTAL = "portals/opera/src/features/product/lifecycle.ts";

/** 判据读不到就抛，不当成「没问题」——沉默的检查会报成功。 */
function must(value, what) {
  if (value === null || value === undefined) {
    throw new Error(`${what} —— 判据读不到。形状变了就先改守卫，别让它静默通过。`);
  }
  return value;
}

/** `export const PRODUCT_STATUSES = ["a", "b"] as const;` */
function sharedStatuses() {
  const src = read(SHARED);
  const m = must(
    src.match(/export const PRODUCT_STATUSES\s*=\s*\[(.*?)\]\s*as const/s),
    `${SHARED} 里找不到 PRODUCT_STATUSES`,
  );
  const out = [...m[1].matchAll(/"(\w+)"/g)].map((x) => x[1]);
  if (out.length === 0) throw new Error(`${SHARED} 的 PRODUCT_STATUSES 解析出 0 个值`);
  return out;
}

/** `const STATE_TRANSITIONS: Record<...> = { draft: ["a","b"], ... };` */
function bffTransitions() {
  const src = read(BFF);
  const m = must(
    src.match(/const STATE_TRANSITIONS[^=]*=\s*\{(.*?)\n\};/s),
    `${BFF} 里找不到 STATE_TRANSITIONS`,
  );
  const out = new Map();
  for (const line of m[1].split("\n")) {
    const mm = line.match(/^\s*(\w+):\s*\[(.*?)\],?\s*$/);
    if (mm) out.set(mm[1], new Set([...mm[2].matchAll(/"(\w+)"/g)].map((x) => x[1])));
  }
  if (out.size === 0) throw new Error(`${BFF} 的 STATE_TRANSITIONS 解析出 0 条`);
  return out;
}

/** `const PRODUCT_STATE_META: Record<...> = { draft: { label: ... }, ... }` */
function portalStateMeta() {
  const src = read(PORTAL);
  const m = must(
    src.match(/export const PRODUCT_STATE_META[^=]*=\s*\{(.*?)\n\};/s),
    `${PORTAL} 里找不到 PRODUCT_STATE_META`,
  );
  const out = [...m[1].matchAll(/^\s{2}(\w+):\s*\{/gm)].map((x) => x[1]);
  if (out.length === 0) throw new Error(`${PORTAL} 的 PRODUCT_STATE_META 解析出 0 个状态`);
  return out;
}

/** `export const PRODUCT_ACTIONS: readonly ProductAction[] = [ {id, from:[...], to}, ... ]` */
function portalActions() {
  const src = read(PORTAL);
  const m = must(
    src.match(/export const PRODUCT_ACTIONS[^=]*=\s*\[(.*?)\n\];/s),
    `${PORTAL} 里找不到 PRODUCT_ACTIONS`,
  );
  const acts = [
    ...m[1].matchAll(/id:\s*"(\w+)"[\s\S]*?from:\s*\[(.*?)\][\s\S]*?to:\s*"(\w+)"/g),
  ].map(([, id, from, to]) => ({
    id,
    from: [...from.matchAll(/"(\w+)"/g)].map((x) => x[1]),
    to,
  }));
  if (acts.length === 0) throw new Error(`${PORTAL} 的 PRODUCT_ACTIONS 解析出 0 条动作`);
  return acts;
}

const statuses = sharedStatuses();
const transitions = bffTransitions();
const meta = portalStateMeta();
const actions = portalActions();

/** 动作表推出来的边：state → Set(到哪些状态)。 */
const reachable = new Map();
for (const a of actions) {
  for (const f of a.from) {
    if (!reachable.has(f)) reachable.set(f, new Set());
    reachable.get(f).add(a.to);
  }
}

console.log("══ 产品生命周期四处对账（check-product-lifecycle）══");
console.log(`  · 值域 ${statuses.length} 个：${statuses.join(" / ")}`);
console.log(`  · BFF 边 ${[...transitions.values()].reduce((n, s) => n + s.size, 0)} 条`);
console.log(`  · 门户动作 ${actions.length} 个：${actions.map((a) => a.label ?? a.id).join(" / ")}`);

const problems = [];
const set = (a) => new Set(a);
const diff = (a, b) => [...a].filter((x) => !b.has(x)).sort();

// ── A. BFF 的状态集 == 值域 ───────────────────────────────────────────────
const dom = set(statuses);
const bffStates = set(transitions.keys());
for (const x of diff(bffStates, dom)) {
  problems.push(`A: BFF 的 STATE_TRANSITIONS 有 "${x}"，而 @shared 的值域里没有`);
}
for (const x of diff(dom, bffStates)) {
  problems.push(
    `A: 值域里有 "${x}"，而 BFF 的 STATE_TRANSITIONS 没登记它 —— 这个状态没有任何出边，` +
      `进去就出不来（终态请显式写成空数组，让「没出边」是一个声明而不是一次遗漏）`,
  );
}

// ── B. 门户状态表 == 值域 ─────────────────────────────────────────────────
const metaStates = set(meta);
for (const x of diff(metaStates, dom)) {
  problems.push(`B: 门户 PRODUCT_STATE_META 有 "${x}"，而 @shared 的值域里没有`);
}
for (const x of diff(dom, metaStates)) {
  problems.push(
    `B: 值域里有 "${x}"，而门户 PRODUCT_STATE_META 没有它 —— 界面会落到兜底分支，` +
      `把状态码原样显示给运营`,
  );
}

// ── C. 动作表给得出的边 == BFF 允许的边 ───────────────────────────────────
for (const [from, allowed] of transitions) {
  const offered = reachable.get(from) ?? new Set();
  for (const x of diff(offered, allowed)) {
    problems.push(
      `C: 门户有动作 ${from} → "${x}"，而 BFF 的 STATE_TRANSITIONS 不允许这条边 ` +
        `—— 点下去会 409，是个假动作`,
    );
  }
  for (const x of diff(allowed, offered)) {
    problems.push(
      `C: BFF 允许 ${from} → "${x}"，而门户 PRODUCT_ACTIONS 里没有任何动作给得出它 ` +
        `—— 这条边只有直连 BFF 才走得到，运营在界面上够不着`,
    );
  }
}

// ── D. 非终态必须有出口 ───────────────────────────────────────────────────
// C 是「两处一样」，这一条查的是**性质**：两处一样地把某个状态做成死胡同，C 抓不到。
for (const st of statuses) {
  const allowed = transitions.get(st);
  if (!allowed || allowed.size > 0) {
    const offered = reachable.get(st) ?? new Set();
    if (allowed && allowed.size > 0 && offered.size === 0) {
      problems.push(
        `D: "${st}" 在 BFF 上有出边，但门户一个动作都给不出 —— 产品会卡死在这一档`,
      );
    }
  }
}

if (problems.length > 0) {
  console.log(`\n✗ ${problems.length} 处：\n`);
  for (const p of problems) console.log(`  x ${p}`);
  console.log(
    `\n状态机住在四处：@shared 的值域、BFF 的 STATE_TRANSITIONS、门户的 PRODUCT_STATE_META\n` +
      `与 PRODUCT_ACTIONS。改一处要对着另外三处过一遍，别凭记忆。\n` +
      `设计权威在 portals/opera/docs/opera-navigation-design.md §6.4。`,
  );
  process.exit(1);
}

console.log(
  `✓ 四处一致（${statuses.length} 个状态、${actions.length} 个动作，每个非终态都有够得着的出口）`,
);
