#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// check-internal-route-policy.mjs — 旧凭据（AUTH_INTERNAL_TOKEN）路径的准入面对账
//
// ## 补的是哪个盲区
//
// 共享口令只证明「调用方持有平台口令」，不证明它是谁。auth-bff 的 `InternalAuthGuard`
// 用它护着运营者账号管理与客户账号管理——其中 8 条路由的「代为操作的运营者」是**请求体
// 自报**的，rank 门比的也是那个自报值。guard 自己的注释写明了这件事（它当初接受 S2S
// bearer，后来撤掉，理由正是「任何机密客户端声明一个高 rank 运营者的 id 就能给自己开门」）。
// 撤掉了 bearer，共享口令那条路没撤。
//
// 这个面有多大、新增一条内部路由会不会自动加入——代码里看不出来，也没有任何东西拦。
// 运行时那一半已经由 `internal-route-policy.ts` 的 deny-by-default 堵上（没声明就 403）；
// 本守卫补静态那一半：
//   ① 漏标在 lint 期就报，不等运行时 403；
//   ② **类级 `@InternalRoute` 报错**——运行时只读方法级，写在 `@Controller` 上是个
//      静默失效的陷阱（看起来声明了，实际整个 controller 全是 deny）；
//   ③ `why` 非空（它是写给复核的人的，空着等于没声明）；
//   ④ 把整个面连同 `actor: "declared-unbound"` 的条数钉进快照——**那一档不许无声增长**。
//
// ## 判据
//
// 扫 `bff/auth-bff/src/routers/*.router.ts`，只看类级带 `@UseGuards(InternalAuthGuard)`
// 的 controller。自上而下走：遇到 `@InternalRoute({…})` 记成待定声明，遇到 HTTP 装饰器
// 就把待定声明配给它，遇到方法签名则清掉待定（于是「声明了但后面不是路由」也会被报）。
//
// ## 本守卫看不见什么
//
//   · 动态注册的路由（`app.use` / 手搓 router），本仓这条路径上没有，但它扫不出来；
//   · `@UseGuards(InternalAuthGuard)` 写在**方法**上的情形（本仓都是类级）；
//   · 声明与实现是否相符——`actor: "none"` 的路由真的不读主体，这件事靠人看，
//     机器只对账「声明存在且面没变」。
//   · 另一条路径（platform-api 的 `PlatformAuthGuard` 双接受）不在范围内，那边有
//     `scopeToS2sCaller` 管 bearer 一侧。
//
// 运行：node scripts/guardrails/check-internal-route-policy.mjs
//      node scripts/guardrails/check-internal-route-policy.mjs --update   （重算快照）
// 退出码：漏标 / 类级声明 / why 空 / 面与快照不符 → 1
// ─────────────────────────────────────────────────────────────────────────────

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const REPO_ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const ROUTER_DIR = join(REPO_ROOT, "bff", "auth-bff", "src", "routers");
const SNAPSHOT = join(
  REPO_ROOT,
  "scripts",
  "guardrails",
  "internal-route-policy.snapshot.json",
);
const UPDATE = process.argv.includes("--update");

const HTTP_DECORATOR =
  /^\s*@(Get|Post|Put|Patch|Delete|All|Head|Options)\(\s*(?:"([^"]*)")?/;
const INTERNAL_ROUTE_OPEN = /^\s*@InternalRoute\(\{/;
const CONTROLLER = /^\s*@Controller\(/;
const USE_GUARDS_INTERNAL = /^\s*@UseGuards\([^)]*\bInternalAuthGuard\b/;
// 方法签名：`async foo(` 或 `foo(`，缩进两格，不是装饰器也不是注释
const METHOD_SIG = /^ {2}(?:async\s+)?[A-Za-z_$][\w$]*\s*\(/;

const findings = [];
const surface = [];

/** 从 `@InternalRoute({ … })` 块里取 risk / actor / why。 */
function parsePolicy(lines, start) {
  let depth = 0;
  const buf = [];
  for (let i = start; i < lines.length; i += 1) {
    buf.push(lines[i]);
    for (const ch of lines[i]) {
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
    }
    if (depth <= 0 && i > start) break;
    if (depth <= 0 && lines[i].includes("}")) break;
  }
  const text = buf.join("\n");
  const pick = (key) => {
    const m = text.match(new RegExp(`${key}\\s*:\\s*"([^"]*)"`));
    return m ? m[1] : null;
  };
  return {
    risk: pick("risk"),
    actor: pick("actor"),
    why: pick("why"),
    endLine: start + buf.length - 1,
  };
}

const files = readdirSync(ROUTER_DIR)
  .filter((f) => f.endsWith(".router.ts"))
  .sort();

let scannedControllers = 0;
let scannedRoutes = 0;

for (const file of files) {
  const rel = `bff/auth-bff/src/routers/${file}`;
  const lines = readFileSync(join(ROUTER_DIR, file), "utf8").split("\n");

  // 类级装饰器块里有没有 InternalAuthGuard（本守卫只管这条路径）
  const controllerIdx = lines.findIndex((l) => CONTROLLER.test(l));
  if (controllerIdx < 0) continue;
  const classBlock = lines.slice(
    Math.max(0, controllerIdx - 4),
    controllerIdx + 5,
  );
  if (!classBlock.some((l) => USE_GUARDS_INTERNAL.test(l))) continue;
  scannedControllers += 1;

  // ② 类级 @InternalRoute 是静默失效的陷阱
  if (classBlock.some((l) => INTERNAL_ROUTE_OPEN.test(l))) {
    findings.push(
      `${rel}:${controllerIdx + 1}  @InternalRoute 写在 controller 上 —— 运行时只读方法级，这是静默失效，请逐条挪到方法上`,
    );
  }

  let pending = null;
  let pendingLine = 0;
  let skipUntil = -1;

  lines.forEach((line, i) => {
    if (i <= skipUntil) return;

    if (INTERNAL_ROUTE_OPEN.test(line)) {
      if (pending) {
        findings.push(
          `${rel}:${pendingLine + 1}  @InternalRoute 后面不是路由（被下一个 @InternalRoute 顶掉了）`,
        );
      }
      const parsed = parsePolicy(lines, i);
      pending = parsed;
      pendingLine = i;
      skipUntil = parsed.endLine;
      return;
    }

    const http = line.match(HTTP_DECORATOR);
    if (http) {
      scannedRoutes += 1;
      if (!pending) {
        findings.push(
          `${rel}:${i + 1}  ${line.trim()} 没有 @InternalRoute 声明 —— 旧凭据路径是 deny-by-default，这条路由运行时会 403`,
        );
        return;
      }
      const { risk, actor, why } = pending;
      if (!risk || !actor) {
        findings.push(`${rel}:${pendingLine + 1}  @InternalRoute 缺 risk 或 actor`);
      } else if (!why || !why.trim()) {
        findings.push(
          `${rel}:${pendingLine + 1}  @InternalRoute 的 why 为空 —— 它是写给复核的人的`,
        );
      } else {
        surface.push(
          `${file} ${http[1].toUpperCase()} ${http[2] ?? ""} risk=${risk} actor=${actor}`,
        );
      }
      pending = null;
      return;
    }

    if (pending && METHOD_SIG.test(line)) {
      findings.push(
        `${rel}:${pendingLine + 1}  @InternalRoute 后面不是路由（直接到了方法签名）`,
      );
      pending = null;
    }
  });

  if (pending) {
    findings.push(`${rel}:${pendingLine + 1}  @InternalRoute 后面没有路由`);
  }
}

surface.sort();
const unbound = surface.filter((s) => s.includes("actor=declared-unbound"));
const actual = {
  note: "本文件由 check-internal-route-policy.mjs --update 生成，不要手改。它钉住的是「旧凭据能进哪些路由」这个面；declaredUnbound 那一档是共享口令的真实半径，增长必须是有意的。",
  routes: surface.length,
  declaredUnbound: unbound.length,
  surface,
};

console.log("══ 旧凭据路径准入面（check-internal-route-policy）══");
console.log(
  `  · 扫 ${files.length} 个 router 文件、${scannedControllers} 个挂 InternalAuthGuard 的 controller、${scannedRoutes} 条路由`,
);
console.log(
  `  · 声明完整 ${surface.length} 条，其中自报且无绑定主体（declared-unbound）${unbound.length} 条`,
);

if (UPDATE) {
  writeFileSync(SNAPSHOT, `${JSON.stringify(actual, null, 2)}\n`, "utf8");
  console.log(`  · 快照已重算：scripts/guardrails/internal-route-policy.snapshot.json`);
}

let expected = null;
try {
  expected = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
} catch {
  if (!UPDATE) {
    findings.push(
      "快照缺失或不可解析 —— 先跑 `node scripts/guardrails/check-internal-route-policy.mjs --update` 并把它入库",
    );
  }
}

if (expected && !UPDATE) {
  const a = new Set(actual.surface);
  const b = new Set(expected.surface ?? []);
  const added = [...a].filter((x) => !b.has(x));
  const removed = [...b].filter((x) => !a.has(x));
  for (const x of added) {
    findings.push(
      `准入面新增：${x}\n      → 这是在给共享口令开新门。确认它必须走旧凭据（而不是 token exchange），再跑 --update 并在 PR 里说明`,
    );
  }
  for (const x of removed) {
    findings.push(
      `准入面减少：${x}\n      → 收窄是好事，但快照要跟着改：跑 --update`,
    );
  }
  if (
    !added.length &&
    !removed.length &&
    expected.declaredUnbound !== actual.declaredUnbound
  ) {
    findings.push(
      `declared-unbound 条数从 ${expected.declaredUnbound} 变成 ${actual.declaredUnbound}（面没变，是某条路由改了 actor）—— 跑 --update 并说明理由`,
    );
  }
}

if (findings.length) {
  console.log("");
  for (const f of findings) console.log(`  ERROR ${f}`);
  console.log("\n── 汇总 ──");
  console.log(`error: ${findings.length}`);
  process.exit(1);
}
console.log("✓ 准入面与快照一致，每条路由都有声明。");
console.log("\n── 汇总 ──");
console.log("error: 0");
