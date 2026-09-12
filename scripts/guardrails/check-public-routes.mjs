#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// `@Public()` 不能挂在 AuthMiddleware 覆盖的前缀下
//
// ## 为什么要这条守卫
//
// NestJS 的 **middleware 读不到路由元数据**——它没有 `ExecutionContext`，跑在
// guard 之前。`@Public()` 是给 guard 看的，`AuthMiddleware` 看不见。
//
// 所以一个挂在 `api/*` 下的 `@Public()` 控制器，装饰器是**静默失效**的：代码里
// 明明白白写着「这个端点公开」，而线上它永远回 401。没有编译错误，没有启动告警，
// 没有测试失败——因为单元测试直接 `new Router().method()`，根本不经过 middleware。
//
// 这不是假想。2026-09-12 桌面端会话链路就栽在它的镜像形态上：ruyin 把三条公开
// 端点都拼成了 `/api/auth/*`，请求落进 `api/*` 被 middleware 挡下，回 401。而
// 401 的字面意思是「凭据错了」，于是轮询当场放弃、登录根本起不来——**症状指向
// 认证，病因却在路由前缀**。两侧的测试全绿，因为它们和实现共用同一个写错的常量。
//
// 那次错在消费方，这条守卫守的是同一条不变式在**平台侧**的那一半：今天四个
// `@Public()` 控制器都在 `api/*` 之外，是对的；而没有任何东西让它保持对。谁哪天
// 把一个公开端点挪进 `api/`，或者在 `api/` 下的控制器里加一个 `@Public()` 方法，
// 都会得到一个**看起来实现了、实际永远 401** 的端点。
//
// ## 判据
//
// 对每个 BFF：
//   1. 从 `app.module.ts` 取 `AuthMiddleware` 的 `forRoutes({ path: … })` 覆盖面；
//      没有 apply 就跳过（那个 BFF 不受管）。
//   2. 找出所有带 `@Public()` 的控制器（类级或方法级——两者都只对 guard 生效）。
//   3. 控制器路径落在覆盖面下 → 报错。
//
// 解析不到就**抛**：读不到不等于没有。apply 了 AuthMiddleware 却取不到 forRoutes
// 路径，只可能是挂载形状变了，那正是该有人来看一眼的时候。
//
// ## 这条守卫不管什么
//
// 它只查**静态挂载形状**。它不保证消费方拼对了路径——那一半在仓外，本仓看不见。
// 真正拦住消费方的是两件事：会话端点的路径集中在一处，以及客户端把公开端点上的
// 401 判读成「请求没打到它身上」而不是「凭据错了」。
//
// 运行：  node scripts/guardrails/check-public-routes.mjs
// 别名：  pnpm lint:public-routes
// 退出码：有违反 → 1。
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const BFF_ROOT = resolve(REPO_ROOT, "bff");

/** 递归收集 .ts（跳过 spec/test 与产物目录）。 */
function collectTs(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...collectTs(full));
    else if (
      name.endsWith(".ts") &&
      !name.endsWith(".spec.ts") &&
      !name.endsWith(".test.ts")
    )
      out.push(full);
  }
  return out;
}

/**
 * 鉴权 middleware 覆盖的路径模式。
 *
 * 匹配 `AuthMiddleware` 与 `OperatorAuthMiddleware`（opera/arche 用后者，同一类东西）。
 * 没 apply → `null`（不受管，跳过）。apply 了但取不到 forRoutes 路径 → 抛。
 *
 * `forRoutes` 在本仓有**两种**写法，两种都要认：
 *   · `.forRoutes({ path: "api/*path", method: RequestMethod.ALL })`  — console/admin
 *   · `.forRoutes("api/*")`                                          — opera/arche
 * 第一版只认了前者，于是在 arche-bff 上抛了。抛得对——读不到就该抛，而不是当成
 * 「没挂」放行：那样三个 BFF 会静默不受检。
 */
function middlewareCoverage(moduleSrc, label) {
  /* `\w*` 是必须的：opera/arche 挂的是 `OperatorAuthMiddleware`。第一版写了
     `\bAuthMiddleware\b`，而 `Operator|Auth` 之间不是词边界——于是那两个 BFF 连同
     auth-bff 一起被当成「没挂」静默跳过，而守卫 exit=0 一片绿。**这正是本守卫要防的
     那种失效，发生在守卫自己身上**：判据读不到时给出的是「通过」而不是「抛」。
     只看退出码是看不出来的，得看它到底检了哪几个。 */
  const APPLY = /\.apply\([^)]*\w*AuthMiddleware\b[^;]*?;/s;
  if (!APPLY.test(moduleSrc)) return null;

  const chain = APPLY.exec(moduleSrc)[0];
  const paths = [
    ...[...chain.matchAll(/path:\s*"([^"]+)"/g)].map((m) => m[1]),
    ...[...chain.matchAll(/forRoutes\(\s*"([^"]+)"/g)].map((m) => m[1]),
  ];
  if (paths.length === 0) {
    throw new Error(
      `${label}: 鉴权 middleware 的 forRoutes 里取不到任何路径。\n` +
        `  取到的链：${chain.replace(/\s+/g, " ").slice(0, 160)}\n` +
        `  若改成了 forRoutes(SomeController) 之类的形状，请同步改本守卫的判据；不要让它静默放行。`,
    );
  }
  return paths;
}

/**
 * 路径模式 → 字面前缀。本仓三种写法都要落到同一个 `api/`：
 *   `api/*path`（console/admin）· `api/*`（opera/arche）· `api/(.*)`（website）
 *
 * 在第一个通配符处截断。第一版只截 `*`，于是 website 的 `api/(.*)` 留下了
 * `api/(.`——一个永远匹配不上任何控制器路径的前缀，等于那个 BFF 不受检。
 * 截不出非空前缀就抛：认不出的模式不能当成「覆盖面为空」。
 */
function patternToPrefix(pattern, label) {
  const cut = pattern.search(/[*(:?[]/);
  const head = (cut === -1 ? pattern : pattern.slice(0, cut)).replace(
    /^\/+/,
    "",
  );
  if (!head.endsWith("/")) {
    throw new Error(
      `${label}: 路径模式 "${pattern}" 截不出一个以 / 结尾的字面前缀（得到 "${head}"）。` +
        `请同步改本守卫的判据，不要让它按一个错前缀去比。`,
    );
  }
  return head;
}

/** 文件里带 `@Public()` 的控制器路径；`@Controller()` 无参记作 ""（根）。 */
function publicControllers(src) {
  if (!/@Public\(\)/.test(src)) return [];
  const m = /@Controller\(\s*("([^"]*)")?\s*\)/.exec(src);
  if (!m) return [];
  return [{ path: (m[2] ?? "").replace(/^\/+/, "") }];
}

const violations = [];
const checked = [];

for (const bff of readdirSync(BFF_ROOT)) {
  const moduleFile = join(BFF_ROOT, bff, "src", "app.module.ts");
  let moduleSrc;
  try {
    moduleSrc = readFileSync(moduleFile, "utf8");
  } catch {
    continue;
  }

  const patterns = middlewareCoverage(moduleSrc, bff);
  if (!patterns) {
    checked.push(`${bff}: 未挂 AuthMiddleware，跳过`);
    continue;
  }
  const prefixes = patterns.map((p) => patternToPrefix(p, bff));
  if (prefixes.length === 0) {
    /* 覆盖面是全站根。那样任何 `@Public()` 都失效——这本身就该报出来。 */
    throw new Error(
      `${bff}: AuthMiddleware 覆盖到根路径（${patterns.join(", ")}），` +
        `那会让所有 @Public() 失效。这要么是配置错了，要么是本守卫的判据该改了。`,
    );
  }

  let publicCount = 0;
  for (const file of collectTs(join(BFF_ROOT, bff, "src"))) {
    const src = readFileSync(file, "utf8");
    for (const ctrl of publicControllers(src)) {
      publicCount += 1;
      const hit = prefixes.find((p) => `${ctrl.path}/`.startsWith(p));
      if (hit) {
        violations.push({
          file: relative(REPO_ROOT, file).replace(/\\/g, "/"),
          ctrl: `/${ctrl.path}`,
          prefix: `/${hit}`,
        });
      }
    }
  }
  checked.push(
    `${bff}: 受管前缀 ${prefixes.map((p) => `/${p}`).join(", ")}；@Public() 控制器 ${publicCount} 个`,
  );
}

console.log("══ @Public() 挂载面（check-public-routes）══");
for (const line of checked) console.log(`  ${line}`);

if (violations.length) {
  console.error("");
  for (const v of violations) {
    console.error(
      `✗ ${v.file}\n` +
        `  @Public() 控制器挂在 ${v.ctrl}，落在 AuthMiddleware 覆盖的 ${v.prefix} 下。\n` +
        `  middleware 读不到 @Public()——这个端点会永远回 401，而代码看起来是对的。\n` +
        `  修法：把它挪到 ${v.prefix} 之外（RP 端点族在 /auth/*），不要给 middleware 加白名单。`,
    );
  }
  console.error(`\n── 汇总 ──\nerror: ${violations.length}`);
  process.exit(1);
}

console.log("\n✓ 没有 @Public() 落在受管前缀下。");
console.log("\n── 汇总 ──\nerror: 0");
