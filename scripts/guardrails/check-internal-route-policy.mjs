#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// check-internal-route-policy.mjs — 内部口令（IDP_INTERNAL_TOKEN）路径的准入面对账
//
// ## 补的是哪个盲区
//
// 共享口令只证明「调用方持有平台口令」，不证明它是谁。auth-bff 的 `InternalAuthGuard`
// 用它护着运营者账号管理与客户账号管理——其中 8 条路由的「代为操作的运营者」曾经是**请求体
// 自报**的，rank 门比的也是那个自报值。guard 自己的注释写明了这件事（它当初接受 S2S
// bearer，后来撤掉，理由正是「任何机密客户端声明一个高 rank 运营者的 id 就能给自己开门」）。
// 撤掉了 bearer，共享口令那条路没撤。
//
// 2026-10-04 PR C 之后那 8 条 + 客户账号的 3 条改成 `token-bound`：类级 `ActorBindingGuard`
// 要求 `x-vxture-actor-token` 里那张运营者自己的会话 access token。于是本守卫多了一半要核：
// **声明说绑了，门上真有那道 guard 吗**——声明与门是两处，只改一处不报错。
//
// 这个面有多大、新增一条内部路由会不会自动加入——代码里看不出来，也没有任何东西拦。
// 运行时那一半已经由 `internal-route-policy.ts` 的 deny-by-default 堵上（没声明就 403）；
// 本守卫补静态那一半：
//   ① 漏标在 lint 期就报，不等运行时 403；
//   ② **类级 `@InternalRoute` 报错**——运行时只读方法级，写在 `@Controller` 上是个
//      静默失效的陷阱（看起来声明了，实际整个 controller 全是 deny）；
//   ③ `why` 非空（它是写给复核的人的，空着等于没声明）；
//   ④ 把整个面连同 `actor: "declared-unbound"` 的条数钉进快照——**那一档不许无声增长**
//      （PR C 后为 0；再出现一条就是在给共享口令开一扇无绑定的新门）；
//   ⑤ `actor: "token-bound"` 的路由所在 controller 的类级 `@UseGuards(…)` 里必须有
//      `ActorBindingGuard`——否则声明是谎话；反过来，挂着 `ActorBindingGuard` 的 controller
//      不许再有 `declared-unbound`——门上已经绑了，声明却说没绑，快照会把半径报大；
//   ⑥ `actor` 只认四个值（none / proven / token-bound / declared-unbound）；陌生值在这里就红，
//      不等 tsc（CI 里本守卫跑在装依赖之前）；
//   ⑦ 挂着 `ActorBindingGuard` 的 controller 清单进快照，少一个即红（摘门不许无声）；
//   ⑧ 两道门的**顺序**：`ActorBindingGuard` 必须与 `InternalAuthGuard` 写在**同一个**类级
//      `@UseGuards(…)` 里、且排在它之后。反过来写，CI 照绿、运行时却是绑定门先跑：没口令的
//      调用方能从 `actor_token_invalid` / `actor_token_mismatch` 的差别里探出一张偷来的票有没有
//      活会话，还会在认证之前触发 Redis 会话查询。分写成两个 `@UseGuards` 也不行——Nest 把
//      多个装饰器的 guard 数组按装饰器**求值序**（自下而上）拼起来，下面那个先跑，不是阅读序
//      （本机对 @nestjs/common 实跑过：`@UseGuards(A)` 在上、`@UseGuards(B)` 在下 → `[B, A]`）。
//      此前这条只靠 `*.actor-binding.spec.ts` 的真 HTTP 钉着，8 条路由的运营账号 router 没有
//      那份 spec；现在静态也钉（自检 (ix)–(xi)），两份 spec 各走一遍真 HTTP。
//
// ## 判据
//
// 扫 `bff/auth-bff/src/routers/*.router.ts`，只看类级带 `@UseGuards(InternalAuthGuard…)`
// 的 controller。自上而下走：遇到 `@InternalRoute({…})` 记成待定声明，遇到 HTTP 装饰器
// 就把待定声明配给它，遇到方法签名则清掉待定（于是「声明了但后面不是路由」也会被报）。
//
// ## 本守卫看不见什么
//
//   · 动态注册的路由（`app.use` / 手搓 router），本仓这条路径上没有，但它扫不出来；
//   · `@UseGuards(…)` 写在**方法**上的情形（本仓都是类级）；
//   · 多行 `@UseGuards(` 它解析不了——但这**不是**静默盲区：类级块匹配不到 `InternalAuthGuard`，
//     整个 controller 被跳过，其路由从面上消失，快照当场报「准入面减少」（自检 (xii) 用真
//     router 证明信号会动）；
//   · 声明与实现是否相符——`actor: "none"` 的路由真的不读主体、`ActorBindingGuard` 真的
//     在比 sub，这些靠 spec 与人看；机器只对账「声明存在、门在、面没变」；
//   · 另一条路径（platform-api 的 `PlatformAuthGuard` 双接受）不在范围内，那边有
//     `scopeToS2sCaller` 管 bearer 一侧。
//
// 运行：node scripts/guardrails/check-internal-route-policy.mjs
//      node scripts/guardrails/check-internal-route-policy.mjs --update     （重算快照）
//      node scripts/guardrails/check-internal-route-policy.mjs --self-test  （合成夹具：每条反例都要红）
// 退出码：漏标 / 类级声明 / why 空 / actor 陌生值 / 声明与门不符 / 两道门顺序反了 / 面与快照不符 → 1
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
const SELF_TEST = process.argv.includes("--self-test");

const HTTP_DECORATOR =
  /^\s*@(Get|Post|Put|Patch|Delete|All|Head|Options)\(\s*(?:"([^"]*)")?/;
const INTERNAL_ROUTE_OPEN = /^\s*@InternalRoute\(\{/;
const CONTROLLER = /^\s*@Controller\(/;
const USE_GUARDS_INTERNAL = /^\s*@UseGuards\([^)]*\bInternalAuthGuard\b/;
const USE_GUARDS_ACTOR = /^\s*@UseGuards\([^)]*\bActorBindingGuard\b/;
const USE_GUARDS_LIST = /^\s*@UseGuards\(([^)]*)\)/;
// 方法签名：`async foo(` 或 `foo(`，缩进两格，不是装饰器也不是注释
const METHOD_SIG = /^ {2}(?:async\s+)?[A-Za-z_$][\w$]*\s*\(/;

/** 与 `internal-route-policy.ts` 的 `InternalRouteActor` 逐字相同。 */
const ACTOR_VALUES = new Set([
  "none",
  "proven",
  "token-bound",
  "declared-unbound",
]);

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

/**
 * ⑧ 类级 @UseGuards 里两道门的顺序。合规返回 null，否则返回一句 finding 文案。
 * 只看带 ActorBindingGuard 的那一行：它必须同时含 InternalAuthGuard，且 InternalAuthGuard 在前。
 */
function guardOrderFinding(classBlock) {
  for (const line of classBlock) {
    const m = line.match(USE_GUARDS_LIST);
    if (!m) continue;
    const list = m[1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const actorIdx = list.indexOf("ActorBindingGuard");
    if (actorIdx < 0) continue;
    const internalIdx = list.indexOf("InternalAuthGuard");
    if (internalIdx < 0) {
      return "ActorBindingGuard 单独写在另一个 @UseGuards 里 —— 两道门必须写在同一个 @UseGuards(InternalAuthGuard, ActorBindingGuard) 里、口令在前：Nest 按装饰器求值序（自下而上）拼 guard 数组，分写时下面那个先跑，不是阅读序";
    }
    if (actorIdx < internalIdx) {
      return "@UseGuards 里 ActorBindingGuard 排在 InternalAuthGuard 前面 —— 顺序反了：没口令的调用方会先撞到绑定门，能从 actor_token_invalid / actor_token_mismatch 的差别里探出一张票有没有活会话，还会在认证前查 Redis；写成 @UseGuards(InternalAuthGuard, ActorBindingGuard)";
    }
  }
  return null;
}

/**
 * 对一组 router 源码求判。纯函数：自检靠合成源码喂反例。
 * @param {Map<string, string>} sources 文件名（basename）→ 源码
 * @returns {{ findings: string[]; surface: string[]; bound: string[]; scannedControllers: number; scannedRoutes: number }}
 */
export function scan(sources) {
  const findings = [];
  const surface = [];
  const bound = [];
  let scannedControllers = 0;
  let scannedRoutes = 0;

  for (const file of [...sources.keys()].sort()) {
    const rel = `bff/auth-bff/src/routers/${file}`;
    const lines = sources.get(file).split("\n");

    // 类级装饰器块里有没有 InternalAuthGuard（本守卫只管这条路径）
    const controllerIdx = lines.findIndex((l) => CONTROLLER.test(l));
    if (controllerIdx < 0) continue;
    const classBlock = lines.slice(
      Math.max(0, controllerIdx - 4),
      controllerIdx + 5,
    );
    if (!classBlock.some((l) => USE_GUARDS_INTERNAL.test(l))) continue;
    scannedControllers += 1;
    const hasActorGuard = classBlock.some((l) => USE_GUARDS_ACTOR.test(l));
    if (hasActorGuard) {
      bound.push(file);
      // ⑧ 门在，但顺序 / 写法要对。门在就算 bound（快照那一半不翻面），顺序错单独一条红。
      const order = guardOrderFinding(classBlock);
      if (order) findings.push(`${rel}:${controllerIdx + 1}  ${order}`);
    }

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
            `${rel}:${i + 1}  ${line.trim()} 没有 @InternalRoute 声明 —— 内部口令路径是 deny-by-default，这条路由运行时会 403`,
          );
          return;
        }
        const { risk, actor, why } = pending;
        if (!risk || !actor) {
          findings.push(`${rel}:${pendingLine + 1}  @InternalRoute 缺 risk 或 actor`);
        } else if (!ACTOR_VALUES.has(actor)) {
          // ⑥ 陌生值：tsc 也会红，但本守卫在 CI 里跑在装依赖之前
          findings.push(
            `${rel}:${pendingLine + 1}  @InternalRoute 的 actor="${actor}" 不是四档之一（${[...ACTOR_VALUES].join(" / ")}）`,
          );
        } else if (!why || !why.trim()) {
          findings.push(
            `${rel}:${pendingLine + 1}  @InternalRoute 的 why 为空 —— 它是写给复核的人的`,
          );
        } else {
          // ⑤ 声明与门要对得上
          if (actor === "token-bound" && !hasActorGuard) {
            findings.push(
              `${rel}:${pendingLine + 1}  actor="token-bound" 但这个 controller 的类级 @UseGuards 里没有 ActorBindingGuard —— 声明说绑了，门上没有；要么挂上 guard，要么改回 declared-unbound 并说明`,
            );
          }
          if (actor === "declared-unbound" && hasActorGuard) {
            findings.push(
              `${rel}:${pendingLine + 1}  actor="declared-unbound" 但这个 controller 挂着 ActorBindingGuard —— 门上已经绑了，声明却说没绑（快照会把半径报大）；改成 token-bound`,
            );
          }
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
  bound.sort();
  return { findings, surface, bound, scannedControllers, scannedRoutes };
}

/** 真仓的 router 源码。 */
function readRouters() {
  const sources = new Map();
  for (const f of readdirSync(ROUTER_DIR).filter((n) => n.endsWith(".router.ts")).sort()) {
    sources.set(f, readFileSync(join(ROUTER_DIR, f), "utf8"));
  }
  return sources;
}

/** 面与快照比对；返回新增 / 减少 / 计数变化的 findings。 */
export function diffSnapshot(actual, expected) {
  const findings = [];
  const a = new Set(actual.surface);
  const b = new Set(expected.surface ?? []);
  const added = [...a].filter((x) => !b.has(x));
  const removed = [...b].filter((x) => !a.has(x));
  for (const x of added) {
    findings.push(
      `准入面新增：${x}\n      → 这是在给共享口令开新门。确认它必须走内部口令（而不是 token exchange），再跑 --update 并在 PR 里说明`,
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
  // ⑦ 门的清单：少一个即红；多一个也要签字（多了意味着某个 controller 的面刚被绑定，快照该跟上）
  const boundNow = new Set(actual.actorBoundControllers);
  const boundThen = new Set(expected.actorBoundControllers ?? []);
  for (const f of boundThen) {
    if (!boundNow.has(f)) {
      findings.push(
        `${f} 的类级 @UseGuards 里不再有 ActorBindingGuard —— 摘门不许无声；若有意，先改声明再 --update 并说明`,
      );
    }
  }
  for (const f of boundNow) {
    if (!boundThen.has(f)) {
      findings.push(
        `${f} 新挂了 ActorBindingGuard 而快照里没有 —— 跑 --update 把它登记进 actorBoundControllers`,
      );
    }
  }
  return findings;
}

function toSnapshot(result) {
  const unbound = result.surface.filter((s) => s.includes("actor=declared-unbound"));
  return {
    note: "本文件由 check-internal-route-policy.mjs --update 生成，不要手改。它钉住的是「内部口令能进哪些路由」这个面；declaredUnbound 那一档曾是共享口令的真实半径（PR C 之后为 0，再出现即红）；actorBoundControllers 是挂着 ActorBindingGuard 的 controller，摘门不许无声。",
    routes: result.surface.length,
    declaredUnbound: unbound.length,
    actorBoundControllers: result.bound,
    surface: result.surface,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

if (SELF_TEST) {
  let bad = 0;
  const say = (ok, msg) => {
    if (!ok) bad += 1;
    console.log(`${ok ? "✓" : "✗"} ${msg}`);
  };
  const real = readRouters();
  const realResult = scan(real);
  const redWith = (sources, needle) =>
    scan(sources).findings.some((f) => f.includes(needle));
  const mutate = (edits) => {
    const m = new Map(real);
    for (const [k, v] of Object.entries(edits)) {
      if (v === null) m.delete(k);
      else m.set(k, v);
    }
    return m;
  };
  /** 一份最小的、带两道 guard 的 controller 源码，`decl` 是方法级声明块。 */
  const controller = (guards, decl) =>
    [
      'import { Controller, Post, UseGuards } from "@nestjs/common";',
      '@Controller("internal/zz")',
      `@UseGuards(${guards})`,
      "export class ZzRouter {",
      // 真 router 在 @Controller 与第一条声明之间有构造函数；类级块的窗口是 @Controller ±4/+5 行，
      // 夹具太短会让方法级声明落进那个窗口、被判成「类级声明」——那是夹具的错，不是判据的。
      "  constructor(",
      "    @Inject(Zz) private readonly zz: Zz,",
      "  ) {}",
      "",
      decl,
      '  @Post(":id/zap")',
      "  async zap(): Promise<void> {}",
      "}",
      "",
    ].join("\n");
  const decl = (actor) =>
    `  @InternalRoute({\n    risk: "admin-action",\n    actor: "${actor}",\n    why: "自检夹具",\n  })`;

  console.log("══ 自检：声明与门两头都看得见，并且会对每一条反例说话 ══\n");

  say(realResult.findings.length === 0, `真仓扫描 → 无 finding（${real.size} 个 router 文件）`);
  say(
    realResult.bound.length === 2 &&
      realResult.bound.includes("account-admin-internal.router.ts") &&
      realResult.bound.includes("operator-admin-internal.router.ts"),
    "真仓里挂 ActorBindingGuard 的正是两个账号 router（不是 0 个、不是全部）",
  );
  say(
    toSnapshot(realResult).declaredUnbound === 0 &&
      realResult.surface.filter((s) => s.includes("actor=token-bound")).length === 11,
    "真仓 declaredUnbound = 0、token-bound = 11（8 条运营账号 + 3 条客户账号）",
  );

  // (i) 反例：声明 token-bound，门上没有 ActorBindingGuard
  say(
    redWith(
      mutate({ "zz.router.ts": controller("InternalAuthGuard", decl("token-bound")) }),
      "没有 ActorBindingGuard",
    ),
    "(i) 声明 token-bound 而类级 @UseGuards 只有 InternalAuthGuard → 红",
  );

  // (ii) 反例：门上有 ActorBindingGuard，声明却写 declared-unbound
  say(
    redWith(
      mutate({
        "zz.router.ts": controller("InternalAuthGuard, ActorBindingGuard", decl("declared-unbound")),
      }),
      "挂着 ActorBindingGuard",
    ),
    "(ii) 挂着 ActorBindingGuard 的 controller 里写 declared-unbound → 红",
  );

  // (iii) 反例：陌生的 actor 值（含已撤的 declared-ignored）
  say(
    redWith(
      mutate({ "zz.router.ts": controller("InternalAuthGuard", decl("declared-ignored")) }),
      "不是四档之一",
    ),
    "(iii) actor=declared-ignored（已撤的档）→ 红「不是四档之一」",
  );

  // (iv) 正例：合成一个合法的 declared-unbound（无 ActorBindingGuard）→ 不红，但 declaredUnbound 从 0 变 1
  {
    const m = mutate({ "zz.router.ts": controller("InternalAuthGuard", decl("declared-unbound")) });
    const r = scan(m);
    say(
      r.findings.length === 0 && toSnapshot(r).declaredUnbound === 1,
      "(iv) 合成一条合法的 declared-unbound → 扫描本身不红，declaredUnbound 0 → 1（信号会动）",
    );
    // 它与真快照比对要红：这就是「那一档不许无声增长」
    const snap = toSnapshot(realResult);
    const d = diffSnapshot(toSnapshot(r), snap);
    say(
      d.some((f) => f.includes("准入面新增")),
      "(iv′) 同一条与快照比对 → 红「准入面新增」",
    );
  }

  // (v) 反例：把真仓某个 router 的 ActorBindingGuard 摘掉 → 该文件的 token-bound 全红 + 快照比对红
  {
    const file = "account-admin-internal.router.ts";
    const src = real.get(file).replace(
      "@UseGuards(InternalAuthGuard, ActorBindingGuard)",
      "@UseGuards(InternalAuthGuard)",
    );
    const m = mutate({ [file]: src });
    const r = scan(m);
    const guardGone = !r.bound.includes(file);
    const declRed = r.findings.filter((f) => f.includes(file) && f.includes("没有 ActorBindingGuard")).length === 3;
    const snapRed = diffSnapshot(toSnapshot(r), toSnapshot(realResult)).some((f) =>
      f.includes("不再有 ActorBindingGuard"),
    );
    say(
      guardGone && declRed && snapRed,
      "(v) 从真仓 account-admin-internal 摘掉 ActorBindingGuard → 三条 token-bound 声明各红一次 + 快照「摘门」红",
    );
  }

  // (vi) 反例：一个新 controller 挂了 ActorBindingGuard 但快照没登记 → 比对红
  {
    const m = mutate({
      "zz.router.ts": controller("InternalAuthGuard, ActorBindingGuard", decl("token-bound")),
    });
    const r = scan(m);
    const d = diffSnapshot(toSnapshot(r), toSnapshot(realResult));
    say(
      r.findings.length === 0 && d.some((f) => f.includes("新挂了 ActorBindingGuard")),
      "(vi) 新 controller 合法地挂上 ActorBindingGuard → 扫描不红，快照比对红「新挂了」",
    );
  }

  // (vii) 既有判据没被挤掉：漏标 / 类级声明 / why 空仍红
  say(
    redWith(
      mutate({
        "zz.router.ts": controller("InternalAuthGuard", "  // no declaration"),
      }),
      "没有 @InternalRoute 声明",
    ) &&
      redWith(
        mutate({
          "zz.router.ts": controller(
            "InternalAuthGuard",
            `  @InternalRoute({\n    risk: "admin-action",\n    actor: "none",\n    why: "   ",\n  })`,
          ),
        }),
        "why 为空",
      ),
    "(vii) 漏标仍红、why 空仍红（新判据没有挤掉旧判据）",
  );

  // (ix) 反例：两道门顺序反了（合成 controller）→ 红「顺序反了」；门仍算 bound（快照那一半不翻面）
  {
    const m = mutate({
      "zz.router.ts": controller("ActorBindingGuard, InternalAuthGuard", decl("token-bound")),
    });
    const r = scan(m);
    say(
      r.findings.some((f) => f.includes("zz.router.ts") && f.includes("顺序反了")) &&
        !r.findings.some((f) => f.includes("没有 ActorBindingGuard")) &&
        r.bound.includes("zz.router.ts"),
      "(ix) @UseGuards(ActorBindingGuard, InternalAuthGuard) → 红「顺序反了」，且只红这一条（门仍算在）",
    );
  }

  // (x) 反例：真仓 8 条路由的运营账号 router 顺序反了 → 恰好一条红；它此前没有任何可执行的门序判据
  {
    const file = "operator-admin-internal.router.ts";
    const src = real.get(file).replace(
      "@UseGuards(InternalAuthGuard, ActorBindingGuard)",
      "@UseGuards(ActorBindingGuard, InternalAuthGuard)",
    );
    const r = scan(mutate({ [file]: src }));
    const mine = r.findings.filter((f) => f.includes(file));
    say(
      src !== real.get(file) &&
        mine.length === 1 &&
        mine[0].includes("顺序反了") &&
        r.bound.includes(file),
      "(x) 把真仓 operator-admin-internal 的两道门调换 → 恰好一条红（顺序），门仍算在、其余不翻面",
    );
  }

  // (xi) 反例：ActorBindingGuard 单独写在第二个 @UseGuards 里（阅读序对、执行序反）→ 红
  {
    const src = controller("InternalAuthGuard", decl("token-bound")).replace(
      "@UseGuards(InternalAuthGuard)",
      "@UseGuards(InternalAuthGuard)\n@UseGuards(ActorBindingGuard)",
    );
    say(
      redWith(mutate({ "zz.router.ts": src }), "单独写在另一个 @UseGuards"),
      "(xi) 两道门分写成两个 @UseGuards → 红「单独写在另一个 @UseGuards」",
    );
  }

  // (xii) 多行 @UseGuards 不是静默盲区：controller 被跳过 → 面变小 → 快照比对红「准入面减少」
  {
    const file = "operator-admin-internal.router.ts";
    const src = real.get(file).replace(
      "@UseGuards(InternalAuthGuard, ActorBindingGuard)",
      "@UseGuards(\n  InternalAuthGuard,\n  ActorBindingGuard,\n)",
    );
    const r = scan(mutate({ [file]: src }));
    const d = diffSnapshot(toSnapshot(r), toSnapshot(realResult));
    say(
      r.scannedControllers === realResult.scannedControllers - 1 &&
        d.filter((f) => f.includes("准入面减少")).length === 8 &&
        d.some((f) => f.includes("不再有 ActorBindingGuard")),
      "(xii) 多行 @UseGuards → 该 controller 被跳过，快照比对红「准入面减少」×8 +「摘门」（声明的盲区会出声）",
    );
  }

  // (viii) 复原 → 真仓再评一次仍无 finding，且与入库快照一致
  {
    let expected = null;
    try {
      expected = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
    } catch {
      expected = null;
    }
    const d = expected ? diffSnapshot(toSnapshot(realResult), expected) : ["快照缺失"];
    say(
      scan(real).findings.length === 0 && d.length === 0,
      "(viii) 复原后真仓无 finding，且与入库快照一致",
    );
  }

  const total = 15;
  console.log(`\n── 汇总 ──\n看得见 ${total - bad}/${total} 项判据`);
  if (bad) {
    console.log("这条判据还不能用 —— 先让它看得见上面标 ✗ 的那几条。");
    process.exit(1);
  }
  console.log("反例都会红、正例都绿、真仓绿。这条判据可以用了。");
  process.exit(0);
}

const sources = readRouters();
const result = scan(sources);
const findings = [...result.findings];
const actual = toSnapshot(result);

console.log("══ 内部口令路径准入面（check-internal-route-policy）══");
console.log(
  `  · 扫 ${sources.size} 个 router 文件、${result.scannedControllers} 个挂 InternalAuthGuard 的 controller、${result.scannedRoutes} 条路由`,
);
console.log(
  `  · 声明完整 ${result.surface.length} 条，其中自报且无绑定主体（declared-unbound）${actual.declaredUnbound} 条；挂 ActorBindingGuard 的 controller：${result.bound.join(", ") || "无"}`,
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
  findings.push(...diffSnapshot(actual, expected));
}

if (findings.length) {
  console.log("");
  for (const f of findings) console.log(`  ERROR ${f}`);
  console.log("\n── 汇总 ──");
  console.log(`error: ${findings.length}`);
  process.exit(1);
}
console.log("✓ 准入面与快照一致，每条路由都有声明，声明与门相符、门的顺序对。");
console.log("\n── 汇总 ──");
console.log("error: 0");
