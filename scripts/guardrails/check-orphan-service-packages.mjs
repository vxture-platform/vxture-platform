#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// 孤儿服务包守卫:`services/*/*` 下的每个包,要么**有人依赖它**,要么在下面的名
// 单里带理由登记。两者都没有 → 红。
//
// ── 为什么需要 ──
// 2026-09-21:要给工单接后端时,我看到 `services/support/ticket` 在那儿、导出
// 一个完整的 `TicketService`（list/get/create/assign/reply/resolve/close/update
// /events/audit 共 12 个方法），于是把整件事规划成「把 admin-bff 的 router 接到
// 这个已有的服务上」——**规划错了**。那个包 `package.json` 里没有任何人依赖,
// 从初始导入起就没被加载过,也从没被功能提交碰过(只被全局改名扫过)。三个月里
// 它和在跑的那份实现分叉了五处:
//
//   · `:id` 是否双接受 ticket_no / uuid
//   · 写进库的 event_type 词表(comment/assigned/status_changed vs replied/…)
//   · 指派 payload 丢了 note
//   · 没有事务、没有 `for update` 行锁
//   · 只有 resolve/close 两个专用方法,不能设任意状态
//
// 还藏着一颗 @Inject 雷(esbuild 不产 emitDecoratorMetadata,漏在 service 上
// boot-smoke 照样绿,第一次调用才 500)——靠「没人加载」躲了三个月。
//
// **一个没人加载的包不会被任何东西校正,但它长得跟做完的实现一模一样。**
// 代价不是那几百行死代码,是它会让下一个人(和下一个我)按错误的前提做规划。
// `@vxture/workers` 是反例:它头注自称「占位入口」,一看就知道不是实现。
//
// ── 这道守卫检的是「有没有声明」,不是「该不该存在」 ──
// 包该留该删是产品裁定,不归守卫。守卫只保证:**孤儿状态必须是写下来的**,
// 不能是默认的。名单里每一条都得带理由,新孤儿不能悄悄冒出来。
//
// 运行:  node scripts/guardrails/check-orphan-service-packages.mjs
// 别名:  pnpm lint:orphan-services
// 退出码:有未登记的孤儿、或名单里有陈旧条目 → 1。
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));

/**
 * 已知的孤儿,连同「为什么它还在」。删掉一个包、或给它接上消费方,就把这条删掉
 * ——留着陈旧条目本身也是红,否则名单会变成下一个骗人的东西。
 */
const DECLARED_ORPHANS = new Map([
  [
    "@vxture/service-ticket",
    "早于现实的一版设计,**不是实现**。活的实现在 bff/admin-bff/src/routers/" +
      "tickets.router.ts;两者在 :id 双接受、event_type 词表、指派 payload 的 note、" +
      "事务与行锁、状态覆盖面五处分叉。客户侧工单流(console)一旦解锁,应由这个包" +
      "**采纳 router 的契约**后上岗,而不是反过来。TD-049。",
  ],
  [
    "@vxture/workers",
    "占位入口(包自己的头注就这么写),异步任务包尚未开工。保留是为了 TypeScript " +
      "与 Sonar 能识别有效输入。",
  ],
]);

/** 哪些地方算「消费方」——只认 package.json 的依赖声明,不认注释里的提及。 */
const CONSUMER_ROOTS = ["bff", "portals", "packages", "services", "tools"];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function walkPackageJsons(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".next" || entry === "dist")
      continue;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walkPackageJsons(full, out);
    else if (entry === "package.json") out.push(full);
  }
  return out;
}

// ── 1. 列出所有服务包 ────────────────────────────────────────────────────────
const servicePackages = new Map(); // name -> 相对路径
const servicesRoot = join(REPO_ROOT, "services");
let domains;
try {
  domains = readdirSync(servicesRoot);
} catch (error) {
  // 读不到就抛,不兜底成空集合——空集合会一路走到「没有孤儿」的绿。
  console.error(`✗ 读不到 ${servicesRoot}：${error.message}`);
  process.exit(1);
}
for (const domain of domains) {
  const domainDir = join(servicesRoot, domain);
  if (!statSync(domainDir).isDirectory()) continue;
  for (const pkg of readdirSync(domainDir)) {
    const manifest = join(domainDir, pkg, "package.json");
    let json;
    try {
      json = readJson(manifest);
    } catch {
      continue;
    }
    if (json.name) servicePackages.set(json.name, `services/${domain}/${pkg}`);
  }
}

// 一个都没扫到 = 遍历坏了,不是「没问题」。判据读不到要抛,不许给「通过」。
if (servicePackages.size === 0) {
  console.error(
    "✗ services/*/* 下一个包都没扫到——判据失效,不是没有孤儿(仓库里有 15 个包)。",
  );
  process.exit(1);
}

// ── 2. 数每个包被谁依赖 ──────────────────────────────────────────────────────
const consumers = new Map([...servicePackages.keys()].map((n) => [n, []]));
for (const root of CONSUMER_ROOTS) {
  for (const manifest of walkPackageJsons(join(REPO_ROOT, root), [])) {
    let json;
    try {
      json = readJson(manifest);
    } catch {
      continue;
    }
    const deps = {
      ...(json.dependencies ?? {}),
      ...(json.devDependencies ?? {}),
      ...(json.peerDependencies ?? {}),
    };
    for (const dep of Object.keys(deps)) {
      // 包依赖自己不算消费方。
      if (consumers.has(dep) && dep !== json.name) {
        consumers.get(dep).push(json.name ?? manifest);
      }
    }
  }
}

const orphans = [...consumers.entries()]
  .filter(([, who]) => who.length === 0)
  .map(([name]) => name);

console.log("══ 孤儿服务包(check-orphan-service-packages)══");
console.log(
  `  · 服务包 ${servicePackages.size} 个,其中零消费方 ${orphans.length} 个,名单登记 ${DECLARED_ORPHANS.size} 条`,
);

const problems = [];

for (const name of orphans) {
  if (!DECLARED_ORPHANS.has(name)) {
    problems.push(
      `${name}（${servicePackages.get(name)}）零消费方,且未在名单里登记。\n` +
        `      它要么该被接上,要么该被删,要么该在守卫名单里写明为什么还留着——\n` +
        `      默认的孤儿状态会让下一个人把它当成实现。`,
    );
  }
}

for (const name of DECLARED_ORPHANS.keys()) {
  if (!servicePackages.has(name)) {
    problems.push(`${name} 已不在 services/*/* 下,名单条目陈旧,请删掉。`);
  } else if (!orphans.includes(name)) {
    problems.push(
      `${name} 已经有消费方（${consumers.get(name).join(", ")}）,` +
        `不再是孤儿,名单条目陈旧,请删掉。`,
    );
  }
}

if (problems.length) {
  console.error(`\n✗ ${problems.length} 处:\n`);
  for (const p of problems) console.error(`  · ${p}`);
  process.exit(1);
}

console.log("✓ 每个服务包要么有人依赖,要么带理由登记在案。");
for (const name of orphans) {
  console.log(`  · ${name} —— ${DECLARED_ORPHANS.get(name).slice(0, 72)}…`);
}
