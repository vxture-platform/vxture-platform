#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scan-ownership-entrypoints.mjs — A2 的分母：**入口**，不是查询点
//
// ## 为什么换单元（这比换数法更要紧）
//
// A2 两轮的分母都是「一条查询」。2026-10-02 的完备性复核指出那是错的单元，并给了两个实例
// 来证明 —— 那一轮找到的两条真缺口**都不含 `.query(`**：
//
//   · `bff/console-bff/src/routers/iam.router.ts` 的 product-seats 入口：`workspaceId` 是裸
//     路径参数，而 `assertCanManageWorkspaceMembers` 的两道判据顺序让绑定那条成了死代码；
//   · `bff/auth-bff/src/governance/governance.controller.ts` 的 members 入口：同一个 controller
//     里只有它既不取 `@CurrentUser` 也不调 `assertCan`。
//
// 两条都不是「某条 SQL 缺一个谓词」，是「**某个入口缺一道门**」。查询点看得见前者、
// 看不见后者 —— 而缺门比缺谓词更常见：谓词写在仓储里（一个地方），门写在入口上（几百个）。
//
// 所以本扫描器的单元是**入口**：一个带 HTTP 方法装饰器的处理器，它从请求里取了一个
// 归属相关的值。查询点退回去当校验面（`scan-read-scope-sites.mjs` 仍在，两份互补）。
//
// ## 为什么用 TS 的 AST，不用正则
//
// 第一版是正则写的，连着给了四个**确定的错答案**，而且每一个都不报错：
//
//   ① 门的名字按我记得的写（`assertCan\w*|require[A-Z]\w*`），于是 `atlas.router.ts` 十个
//      写入口被标成「一个门的线索都没有」—— 它们每条都有 `assertOperation(...)`；
//   ② 窗口从 HTTP 装饰器起算，而 `@RequireCapability` 常写在 `@Delete(...)` 的**上一行**，
//      于是 `console-bff/billing.router.ts` 的 deleteAddress 也被标成「没门」；
//   ③ 「声明体 = 从本声明到下一个声明」把缩进两格的**调用语句**当成了类成员声明，
//      于是 `assertAnyCapability` 的体在第一行 `assertSession(req);` 处就被截断，
//      那句 `throw new ForbiddenException` 整条看不见；
//   ④ 调用点用 `/\w+\s*\(/` 收，于是 `Promise.resolve(` 命中了某个叫 `resolve` 的声明，
//      顺着它走到一个会抛 401 的 `session`，**凭空给订单详情页判了一道门**。
//
// ④ 是最坏的一类：它不是漏报，是**假装有门**，而「有门」这一列正是用来决定先看谁的。
//
// AST 把这四类从结构上消掉：装饰器是节点不是文本（①②）、函数体是节点不是文本区间（③）、
// `Promise.resolve` 是 PropertyAccess 而 `assertSession` 是 Identifier（④）。
//
// ## 判据
//
// ① 入口 = 带 `@Get/@Post/@Put/@Patch/@Delete` 的类方法；
// ② 看它的参数装饰器：`@Param("x")` / `@Query("x")` / `@Body()` / `@CurrentUser()`；
// ③ **外部归属值** = 名字像归属或对象 id 的 `@Param`/`@Query`，或任何没写名字的
//    `@Body()` / `@Query()` / `@Param()`（整个对象，里面带什么静态看不出，按「可能带」算
//    —— 方向是多收不漏收）；
// ④ 分三档：external-id（**要逐条判的分母**）/ session-only / no-params；
// ⑤ 再给判定的人三列线索：
//      · `gateHints` —— 方法上与**类上**的门装饰器，加上方法体调到的、4 跳内走得到一句
//        401/403 的名字（`gateHintsVia` 给整条路径）。解析范围只在「本文件的声明」∪
//        「本文件 import 进来的名字」里，注入服务经构造函数参数的类型落到类上；
//      · `unresolved` —— 门可能在这后面而扫描器跟不过去的去处（跨包 import、
//        类型不在索引里的注入服务）。非空表示「看不见」，**不是**「没门」；
//      · `idInGate` —— **那个外部 id 有没有被交给任何一道门**。这一列比「有没有门」
//        要紧得多：#567 的 product-seats 入口是有门的（`assertCanManageWorkspaceMembers`），
//        只是门里两道判据的顺序让绑定那条成了死代码；而一道只收 `req` 的门**结构上
//        不可能**约束一个路径参数。`idInGate=false` 不等于有缺陷 —— 约束也可以在下游的
//        SQL 谓词里（`where id = $1 and tenant_id = $2`，本仓最常见的正解），
//        但那必须一条条看过才算判完。
//
//    **有线索 ≠ 拦得住**：`requireTenantSession` 是取值器不是校验器，`assertSession` 只答
//    「有没有人登录」。这几列只用来排先看谁，不是判定结论。
//
// ## 看不见什么（写下来，免得「清单里没有」被当成「安全」）
//
//   · Job / cron / 事件消费者：它们没有 HTTP 装饰器，本扫描器一条都看不见。
//     而平面隔离那条破口（`MARK_READ_SQL`）恰好在运营面的作业里 ——
//     「没有入口」不等于「没有面」；
//   · 「这道门拦不拦得住」：那是判定的人要答的；
//   · 中间件 / 全局 Guard：挂在 module 上的 `APP_GUARD` 既不在方法装饰器也不在类装饰器里；
//   · 跨包的门：跟不过去的那些记在 `unresolved` 里，见上。
//
// ## 2026-10-03 第三轮审查用它判了什么
//
// 客户面 139 条 external-id 全判完，**零新缺陷**。其中 55 条「拿了具名外部 id 且那个 id
// 没进任何门」—— 逐条读下来，约束都在下游：共用的门（`assertCanManageWorkspaceMembers`）、
// 共用的装载器（`loadOrderRow` / `lockPurchase`，都是 `where id = $1 and tenant_id = $2`）、
// 读回来再比（`setAutoRenew` / `getAddonOrder`）、或邀请那条按被邀请人身份穷举（默认拒绝）。
// 另有 15 条一行门都没有，全是**会话之前**的端点（注册 / 忘记密码 / oidc authorize
// 与 revoke / 登录中的 MFA 注册 / backchannel-logout）—— 那里没有会话，归属不是它们的轴。
//
// 运营面 239 条没在这一轮判：「按设计跨租户」只豁免了**租户轴**，没豁免**平面轴**，
// 那是单独一轮的事（见《多租户现状与批次》B7 的后继项）。
//
// 运行：node scripts/guardrails/scan-ownership-entrypoints.mjs
//      node scripts/guardrails/scan-ownership-entrypoints.mjs --self-test
//      node scripts/guardrails/scan-ownership-entrypoints.mjs --json
//      node scripts/guardrails/scan-ownership-entrypoints.mjs --why <名字> [文件片段]
// ─────────────────────────────────────────────────────────────────────────────

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import ts from "typescript";

const REPO_ROOT = resolvePath(fileURLToPath(new URL("../../", import.meta.url)));
const SKIP = new Set(["node_modules", "dist", ".next", "coverage", "build"]);
const OPERATOR_FACES = ["bff/admin-bff", "bff/opera-bff", "bff/arche-bff"];
const CUSTOMER_FACES = [
  "bff/console-bff",
  "bff/platform-api",
  "bff/website-bff",
  "bff/auth-bff",
];

const HTTP_VERBS = new Set(["Get", "Post", "Put", "Patch", "Delete"]);

/**
 * 门的装饰器。这份清单**是从仓里数出来的**，不是我记得的 —— 全仓类级与处理器级的
 * 非 HTTP 装饰器一共就这几种：
 *
 *     类级：Controller 104、Injectable 80、Module 19、UseGuards 9、SelfScope 9、
 *           RequireCapability 6、Catch 5、Public 4、Global 1
 *     方法级：RequireStepUp 68、RequireCapability 68、HttpCode 58、InternalRoute 13、
 *           Header 7、SelfScope 7
 *
 * 所以把 `InternalRoute` 漏掉会让 `account-admin-internal.router.ts` 三个端点显示「没门」
 * —— 它们的门是类级 `@UseGuards(InternalAuthGuard)` 加每方法的 `@InternalRoute({risk,actor})`。
 * 下面 `NON_GATE_DECORATORS` 把「已知不是门」的也写下来，于是**第七种装饰器一出现就会
 * 在报告里被点名**，而不是悄悄落进「没门」那一档。
 */
const GATE_DECORATORS = new Set([
  "RequireCapability",
  "RequireStepUp",
  "SelfScope",
  "Public",
  "UseGuards",
  "InternalRoute",
]);
const NON_GATE_DECORATORS = new Set([
  "Controller",
  "Injectable",
  "Module",
  "Catch",
  "Global",
  "HttpCode",
  "Header",
  ...HTTP_VERBS,
]);
/** 报告里点名：既不在门清单也不在非门清单里的装饰器。 */
const UNKNOWN_DECORATORS = new Map();
const DENY = new Set(["ForbiddenException", "UnauthorizedException"]);

/** 名字像「归属或某个对象的 id」的请求参数。 */
const OWNERISH =
  /^(id|.*Id|.*_id|.*No|.*_no|workspace\w*|org\w*|tenant\w*|account\w*|user\w*|subscription\w*|order\w*|notice\w*|ticket\w*)$/i;

const rel = (f) => relative(REPO_ROOT, f).replace(/\\/g, "/");

function walk(dir, out = []) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const n of names) {
    if (SKIP.has(n)) continue;
    const p = join(dir, n);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(p, out);
    else if (n.endsWith(".ts") && !/\.(spec|test)\.ts$/.test(n)) out.push(p);
  }
  return out;
}

function faceOf(r) {
  if (OPERATOR_FACES.some((f) => r.startsWith(f))) return "operator";
  if (CUSTOMER_FACES.some((f) => r.startsWith(f))) return "customer";
  return "other";
}

// ── AST 小工具 ──────────────────────────────────────────────────────────────

const decoratorsOf = (node) =>
  (ts.canHaveDecorators(node) ? ts.getDecorators(node) : undefined) ?? [];

/** 装饰器 → `{ name, args }`；`@Get("x")` 与 `@Get` 两种写法都收。 */
function readDecorator(d) {
  const e = d.expression;
  if (ts.isCallExpression(e) && ts.isIdentifier(e.expression)) {
    return {
      name: e.expression.text,
      args: e.arguments.map((a) => (ts.isStringLiteral(a) ? a.text : null)),
    };
  }
  if (ts.isIdentifier(e)) return { name: e.text, args: [] };
  return null;
}

const DENY_STATUS_ARG = new Set([
  "HttpStatus.FORBIDDEN",
  "HttpStatus.UNAUTHORIZED",
  "401",
  "403",
]);

/**
 * 这个节点里有没有**造出一个 401/403**。两种形状：
 *   · `new ForbiddenException(...)` / `new UnauthorizedException(...)`；
 *   · `new ApiError(HttpStatus.FORBIDDEN, ...)` / `new HttpException(..., 403)`。
 */
function producesDeny(node) {
  let found = false;
  const visit = (n) => {
    if (found) return;
    if (ts.isNewExpression(n) && ts.isIdentifier(n.expression)) {
      if (DENY.has(n.expression.text)) {
        found = true;
        return;
      }
      if (/(Exception|Error)$/.test(n.expression.text)) {
        for (const a of n.arguments ?? []) {
          if (DENY_STATUS_ARG.has(a.getText())) {
            found = true;
            return;
          }
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

/**
 * 这个节点（含嵌套函数）里有没有一句**抛出 401/403** 的 throw。
 *
 * 判据是「抛的东西带 401/403」，不是「写成了 `throw new XxxException`」。
 * 这一条改过一次，原因值得记下来：第一版只认 `throw new (Forbidden|Unauthorized)Exception`，
 * 而 opera-bff 与 arche-bff 一律写 `throw notEntitled(CAP)` ——
 * `notEntitled` 返回 `new ApiError(HttpStatus.FORBIDDEN, …)`。于是 opera-bff
 * **六十五个带外部 id 的写入口全被标成「一行门都没有」**，而它们每条都有
 * `assertCanManageProviders(req)` 之类。全仓 throw 的形状数过（见下），
 * 工厂函数式的一共四种（unauthenticated/notEntitled/stepUpRequired/policyDenied），
 * 所以这里解析一跳到被抛的那个工厂上，而不是再往清单里加四个名字。
 */
function throwsDeny(node, file) {
  let found = false;
  const visit = (n) => {
    if (found) return;
    if (ts.isThrowStatement(n) && n.expression) {
      const e = n.expression;
      if (ts.isNewExpression(e) && producesDeny(e)) {
        found = true;
        return;
      }
      if (ts.isCallExpression(e) && ts.isIdentifier(e.expression)) {
        const r = resolveName(file, e.expression.text);
        if (r && !r.unresolved && producesDeny(r.node)) {
          found = true;
          return;
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

/**
 * 这个节点里调到的东西，分三类：
 *
 *   · `direct`  —— `foo(...)`，按本文件作用域解析；
 *   · `member`  —— `this.foo(...)`，本类的成员；
 *   · `service` —— `this.gov.assertCan(...)`，**注入进来的服务**。
 *
 * 第三类必须单列：`governance.controller.ts` 的门正是 `this.gov.assertCan(...)`，
 * 只收前两类的话这个 controller 六个入口会全被标成「一行门都没有」——
 * 而其中五个的门就写在那一行上。注入服务的属性名要经构造函数参数的**类型**才能落到类上。
 *
 * `Promise.resolve(` / `rows.map(` 这类别人身上的方法一概不收 —— 正则版正是在这里
 * 把 `Promise.resolve` 当成了一道门，凭空给订单详情页判了门。
 */
function callsIn(node) {
  const out = [];
  const visit = (n) => {
    if (ts.isCallExpression(n)) {
      const e = n.expression;
      if (ts.isIdentifier(e)) {
        out.push({ kind: "direct", name: e.text });
      } else if (ts.isPropertyAccessExpression(e)) {
        if (e.expression.kind === ts.SyntaxKind.ThisKeyword) {
          out.push({ kind: "member", name: e.name.text });
        } else if (
          ts.isPropertyAccessExpression(e.expression) &&
          e.expression.expression.kind === ts.SyntaxKind.ThisKeyword
        ) {
          out.push({
            kind: "service",
            prop: e.expression.name.text,
            name: e.name.text,
          });
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return out;
}

/** 类里名字叫 `name` 的方法。 */
function methodOf(classNode, name) {
  for (const m of classNode.members) {
    if (
      ts.isMethodDeclaration(m) &&
      m.name &&
      ts.isIdentifier(m.name) &&
      m.name.text === name
    ) {
      return m;
    }
  }
  return null;
}

// ── 建索引：每份文件的声明与 import ────────────────────────────────────────

// 入口只在 `bff/**` 里找；但**解析范围要把 `services/` 与 `packages/` 一起收进来** ——
// 本仓的门大量住在那边：`governance.controller.ts` 七个入口的门全是
// `this.gov.assertCan(...)`，而 `GovernanceService` 在 `services/identity/organization`。
// 只索引 `bff/**` 的话，这七条会一致地显示「一行门都没有」，而其中六条的门就写在那一行上。
const ENTRY_FILES = walk(join(REPO_ROOT, "bff"));
const files = [
  ...ENTRY_FILES,
  ...walk(join(REPO_ROOT, "services")),
  ...walk(join(REPO_ROOT, "packages")),
];
const INDEX = new Map();
/** 类名 → 它的声明。注入服务靠这张表从「属性的类型」落到类上。 */
const CLASSES = new Map();

for (const file of files) {
  const sf = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const decls = new Map();
  const imports = new Map();
  /** 注入进来的属性名 → 它声明的类型名（取自构造函数参数属性与字段声明）。 */
  const propTypes = new Map();
  const visit = (node) => {
    if (ts.isClassDeclaration(node) && node.name) {
      CLASSES.set(node.name.text, { file, node });
      for (const m of node.members) {
        if (ts.isConstructorDeclaration(m)) {
          for (const p of m.parameters) {
            if (
              ts.isIdentifier(p.name) &&
              p.type &&
              ts.isTypeReferenceNode(p.type) &&
              ts.isIdentifier(p.type.typeName)
            ) {
              propTypes.set(p.name.text, p.type.typeName.text);
            }
          }
        }
        if (
          ts.isPropertyDeclaration(m) &&
          ts.isIdentifier(m.name) &&
          m.type &&
          ts.isTypeReferenceNode(m.type) &&
          ts.isIdentifier(m.type.typeName)
        ) {
          propTypes.set(m.name.text, m.type.typeName.text);
        }
      }
    }
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.importClause?.namedBindings &&
      ts.isNamedImports(node.importClause.namedBindings)
    ) {
      for (const el of node.importClause.namedBindings.elements) {
        imports.set(el.name.text, node.moduleSpecifier.text);
      }
    }
    if (ts.isFunctionDeclaration(node) && node.name) decls.set(node.name.text, node);
    if (ts.isVariableStatement(node)) {
      for (const d of node.declarationList.declarations) {
        if (ts.isIdentifier(d.name)) decls.set(d.name.text, d);
      }
    }
    if (
      (ts.isMethodDeclaration(node) || ts.isPropertyDeclaration(node)) &&
      node.name &&
      ts.isIdentifier(node.name)
    ) {
      decls.set(node.name.text, node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  INDEX.set(file, { sf, decls, imports, propTypes });
}

/** 相对 import → 文件路径（试 `.ts` 与 `/index.ts`）。 */
function resolveRelative(fromFile, spec) {
  const base = resolvePath(dirname(fromFile), spec);
  for (const cand of [`${base}.ts`, join(base, "index.ts")]) {
    if (INDEX.has(cand)) return cand;
  }
  return null;
}

/**
 * 在「本文件的声明 ∪ 本文件 import 进来的名字」里解析一个名字。
 * 范围就是这么大 —— 不做全仓同名匹配，那正是 `Promise.resolve` 那个假阳性的来路。
 */
function resolveName(file, name) {
  const idx = INDEX.get(file);
  if (!idx) return null;
  if (idx.decls.has(name)) return { file, node: idx.decls.get(name) };
  const spec = idx.imports.get(name);
  if (!spec) return null;
  if (spec.startsWith(".")) {
    const target = resolveRelative(file, spec);
    const node = target && INDEX.get(target).decls.get(name);
    return node ? { file: target, node } : { unresolved: spec };
  }
  return { unresolved: spec };
}

/**
 * 一个调用点往下最多 `depth` 跳，走不走得到一句 deny-throw。命中回整条路径。
 * 跟不过去的（跨包 import、类型不在 `bff/**` 里的注入服务）记进 `unresolved` ——
 * 那是「看不见」，**不是**「没门」，两者在报告里必须分开。
 */
function gateFrom(file, call, depth, seen, unresolved) {
  if (depth <= 0) return null;
  const label =
    call.kind === "service" ? `${call.prop}.${call.name}` : call.name;

  let target = null;
  if (call.kind === "service") {
    const typeName = INDEX.get(file)?.propTypes.get(call.prop);
    if (!typeName) {
      unresolved.push(`${label}@属性类型未声明`);
      return null;
    }
    const cls = CLASSES.get(typeName);
    if (!cls) {
      unresolved.push(`${label}@${typeName}（类不在 bff/** 里）`);
      return null;
    }
    const node = methodOf(cls.node, call.name);
    if (!node) return null;
    target = { file: cls.file, node };
  } else {
    const r = resolveName(file, call.name);
    if (!r) return null;
    if (r.unresolved) {
      unresolved.push(`${label}@${r.unresolved}`);
      return null;
    }
    target = r;
  }

  const key = `${target.file}|${label}|${target.node.pos}`;
  if (seen.has(key)) return null;
  seen.add(key);

  if (throwsDeny(target.node, target.file)) return [label];
  for (const c of callsIn(target.node)) {
    const sub = gateFrom(target.file, c, depth - 1, seen, unresolved);
    if (sub) return [label, ...sub];
  }
  return null;
}

/** 按名字问（`--why` 与自检用）。 */
function gatePath(file, name, depth = 4, seen = new Set(), unresolved = []) {
  return gateFrom(file, { kind: "direct", name }, depth, seen, unresolved);
}

// ── `--why`：问扫描器它自己怎么看这个名字 ──────────────────────────────────
// 排查「线索列全空」时第一步用它，别另写一份复现脚本 —— 两份各错各的，就分不出是谁错了。
const whyIdx = process.argv.indexOf("--why");
if (whyIdx !== -1) {
  const name = process.argv[whyIdx + 1];
  const hintFile = process.argv[whyIdx + 2];
  const cands = [...INDEX.keys()].filter(
    (f) => INDEX.get(f).decls.has(name) || INDEX.get(f).imports.has(name),
  );
  console.log(`"${name}" 出现在 ${cands.length} 份文件的作用域里`);
  for (const f of cands) {
    if (hintFile && !rel(f).includes(hintFile)) continue;
    const un = [];
    const path = gatePath(f, name, 4, new Set(), un);
    console.log(
      `  ${rel(f)}\n      gatePath → ${path ? path.join(" → ") : "null"}` +
        (un.length ? `\n      跟不过去：${[...new Set(un)].join(", ")}` : ""),
    );
  }
  process.exit(0);
}

// ── 枚举入口 ───────────────────────────────────────────────────────────────

const entries = [];

for (const file of ENTRY_FILES) {
  const { sf } = INDEX.get(file);
  const r = rel(file);
  /** 这个方法所在类的类级装饰器 —— `@UseGuards(InternalAuthGuard)` 常只写在类上。 */
  let classDecs = [];
  const visit = (node) => {
    if (ts.isClassDeclaration(node)) {
      classDecs = decoratorsOf(node).map(readDecorator).filter(Boolean);
    }
    if (ts.isMethodDeclaration(node) && node.name && ts.isIdentifier(node.name)) {
      const decs = decoratorsOf(node).map(readDecorator).filter(Boolean);
      const http = decs.find((d) => HTTP_VERBS.has(d.name));
      if (http) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        const params = [];
        let takesSession = false;
        for (const p of node.parameters) {
          for (const d of decoratorsOf(p).map(readDecorator).filter(Boolean)) {
            if (d.name === "CurrentUser") takesSession = true;
            if (d.name === "Param" || d.name === "Query" || d.name === "Body") {
              params.push({ kind: d.name, name: d.args[0] ?? "" });
            }
          }
        }
        const bodyText = node.body ? node.body.getText(sf) : "";
        if (/req\.(user|tenant|session)\b/.test(bodyText)) takesSession = true;

        const externalOwnerish = params.filter(
          (p) => p.name === "" || OWNERISH.test(p.name),
        );

        /**
         * **外部 id 有没有被交给任何一道门。**
         *
         * 「有门」不等于「门管得着这个 id」：#567 的 product-seats 入口就有
         * `assertCanManageWorkspaceMembers(req, workspaceId)` —— 门收了那个 id，
         * 只是里面两道判据的顺序让绑定那条成了死代码。而一道只收 `req` 的门
         * **结构上不可能**约束一个路径参数：它看不见那个值。
         *
         * 所以这一列把 363 条「有门」再切一刀：门的实参里出现过这个 id 的，
         * 至少有机会约束它；没出现的，约束只可能在下游的 SQL 谓词里（inbox 那样，
         * 合法），或者**根本没有**。后者就是要找的形状。
         */
        const idNames = new Set(
          node.parameters
            .filter((p) =>
              decoratorsOf(p)
                .map(readDecorator)
                .filter(Boolean)
                .some(
                  (d) =>
                    (d.name === "Param" || d.name === "Query") &&
                    (d.args[0] === undefined || OWNERISH.test(d.args[0] ?? "")),
                ),
            )
            .filter((p) => ts.isIdentifier(p.name))
            .map((p) => p.name.text),
        );
        let idInGate = false;
        if (node.body && idNames.size) {
          const visitCalls = (n) => {
            if (ts.isCallExpression(n)) {
              const argText = n.arguments.map((a) => a.getText(sf)).join(",");
              const callee = ts.isIdentifier(n.expression)
                ? { kind: "direct", name: n.expression.text }
                : ts.isPropertyAccessExpression(n.expression) &&
                    n.expression.expression.kind === ts.SyntaxKind.ThisKeyword
                  ? { kind: "member", name: n.expression.name.text }
                  : ts.isPropertyAccessExpression(n.expression) &&
                      ts.isPropertyAccessExpression(n.expression.expression) &&
                      n.expression.expression.expression.kind ===
                        ts.SyntaxKind.ThisKeyword
                    ? {
                        kind: "service",
                        prop: n.expression.expression.name.text,
                        name: n.expression.name.text,
                      }
                    : null;
              if (
                callee &&
                [...idNames].some((id) =>
                  new RegExp(`\\b${id}\\b`).test(argText),
                ) &&
                gateFrom(file, callee, 4, new Set(), [])
              ) {
                idInGate = true;
              }
            }
            ts.forEachChild(n, visitCalls);
          };
          visitCalls(node.body);
        }

        const gates = new Set([
          ...decs
            .filter((d) => GATE_DECORATORS.has(d.name))
            .map((d) => `@${d.name}`),
          ...classDecs
            .filter((d) => GATE_DECORATORS.has(d.name))
            .map((d) => `@${d.name}(类级)`),
        ]);
        for (const d of [...decs, ...classDecs]) {
          if (!GATE_DECORATORS.has(d.name) && !NON_GATE_DECORATORS.has(d.name)) {
            UNKNOWN_DECORATORS.set(
              d.name,
              (UNKNOWN_DECORATORS.get(d.name) ?? 0) + 1,
            );
          }
        }
        const via = new Set();
        const unresolved = [];
        if (node.body) {
          const seen = new Set();
          for (const c of callsIn(node.body)) {
            if (c.kind !== "service" && c.name === node.name.text) continue;
            const path = gateFrom(file, c, 4, seen, unresolved);
            if (!path) continue;
            gates.add(path[0]);
            if (path.length > 1) via.add(path.join(" → "));
          }
        }

        entries.push({
          at: `${r}:${line}`,
          face: faceOf(r),
          verb: http.name,
          route: http.args[0] ?? "",
          method: node.name.text,
          cls:
            params.length === 0
              ? "no-params"
              : externalOwnerish.length > 0
                ? "external-id"
                : "session-only",
          externalParams: externalOwnerish
            .map((p) => `@${p.kind}(${p.name})`)
            .join(" "),
          takesSession,
          idInGate,
          idNames: [...idNames].join(" "),
          gateHints: [...gates].join(" "),
          gateHintsVia: [...via].join(" "),
          unresolved: [...new Set(unresolved)].join(" "),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

entries.sort((a, b) => a.at.localeCompare(b.at));
const todo = entries.filter((e) => e.cls === "external-id");

// ── 自检 ───────────────────────────────────────────────────────────────────
if (process.argv.includes("--self-test")) {
  const find = (file, want) =>
    todo.filter((e) => e.at.startsWith(`${file}:`) && want(e));
  const inAll = (file, want) =>
    entries.filter((e) => e.at.startsWith(`${file}:`) && want(e));

  const CHECKS = [
    {
      name: "① product-seats 入口在清单里（workspaceId 是裸路径参数）",
      run: () =>
        find("bff/console-bff/src/routers/iam.router.ts", (e) =>
          e.route.includes("product-seats"),
        ),
    },
    {
      name: "② governance members 入口在清单里（同 controller 里只有它没有 assertCan）",
      run: () =>
        find(
          "bff/auth-bff/src/governance/governance.controller.ts",
          (e) => e.route.includes("members") && e.verb === "Get",
        ),
    },
    {
      name: "③ 门在私有 helper 里也要读到（announcements publish → transitionAnnouncement）",
      run: () =>
        find(
          "bff/admin-bff/src/routers/announcements.router.ts",
          (e) =>
            e.route.includes("publish") &&
            /transitionAnnouncement/.test(e.gateHints) &&
            /assertCanManageAnnouncements/.test(e.gateHintsVia),
        ),
    },
    {
      name: "④ 写在 HTTP 装饰器上一行的 @RequireCapability 要读到（billing 删抬头）",
      run: () =>
        find(
          "bff/console-bff/src/routers/billing.router.ts",
          (e) =>
            e.verb === "Delete" &&
            e.route.includes("addresses") &&
            /@RequireCapability/.test(e.gateHints),
        ),
    },
    {
      name: "⑤ 跨文件的两层门要读到（orders :orderId → assertCanReadOrders → assertAnyCapability）",
      run: () =>
        find(
          "bff/admin-bff/src/routers/orders.router.ts",
          (e) =>
            e.route === ":orderId" &&
            /assertCanReadOrders/.test(e.gateHints) &&
            /assertAnyCapability/.test(e.gateHintsVia),
        ),
    },
    {
      // 门经注入服务调出去（`this.gov.assertCan(...)`），而 `GovernanceService` 在
      // `services/identity/organization` —— 解析范围不含 `services/` 时这七条会**一致地**
      // 显示「没门」，而一致是最容易被当成「这个 controller 按设计不设门」的形状。
      name: "⑦ 注入服务上的门要读到（governance Patch 改角色 → gov.assertCan）",
      run: () =>
        find(
          "bff/auth-bff/src/governance/governance.controller.ts",
          (e) => e.verb === "Patch" && /gov\.assertCan/.test(e.gateHints),
        ),
    },
    {
      // 门只写在类上（`@UseGuards(InternalAuthGuard)`）+ 每方法一条策略声明
      // （`@InternalRoute`）。只读方法装饰器、且 `InternalRoute` 不在清单里时，
      // 这三个 S2S 端点会显示「没门」。
      name: "⑧ 类级 @UseGuards 与 @InternalRoute 要读到（account-admin-internal 停用账号）",
      run: () =>
        find(
          "bff/auth-bff/src/routers/account-admin-internal.router.ts",
          (e) =>
            e.route.includes("disable") &&
            /@UseGuards\(类级\)/.test(e.gateHints) &&
            /@InternalRoute/.test(e.gateHints),
        ),
    },
    {
      // opera/arche 两面一律 `throw notEntitled(CAP)`（返回 `new ApiError(HttpStatus.FORBIDDEN…)`），
      // 不写 `throw new ForbiddenException`。只认后者时 opera-bff 六十五个带外部 id 的
      // 写入口会**一致地**显示「没门」—— 而一致最像「这一面按设计不设门」。
      name: "⑨ 工厂式 deny 要认（opera atlas 改供应商 → assertCanManageProviders → notEntitled）",
      run: () =>
        find(
          "bff/opera-bff/src/routers/atlas.router.ts",
          (e) =>
            e.verb === "Patch" &&
            e.route.startsWith("providers/") &&
            /assertCanManageProviders/.test(e.gateHints),
        ),
    },
    {
      name: "⑥ 反例：`Promise.resolve(` 不许算成一道门（正则版就是这么凭空判出一道门的）",
      run: () =>
        inAll(
          "bff/admin-bff/src/routers/orders.router.ts",
          (e) => e.route === ":orderId" && !/(^|\s)resolve(\s|$)/.test(e.gateHints),
        ),
    },
  ];

  console.log("══ 自检：先证这个单元看得见那两条已知真缺口的入口，且不会凭空判出门 ══\n");
  console.log(
    "（①② 两条都已在 2026-10-02 #567 修掉，所以今天不是缺口了 —— 但**一个看不见它们的\n" +
      "  分母，正是漏掉它们的那个分母**。自检要的是「分母看得见」，不是「它还坏着」。\n" +
      "  ③④⑤⑥ 验的是线索列：它错了不会漏条目，但会让「先看谁」指错人。）\n",
  );
  let bad = 0;
  for (const c of CHECKS) {
    const hit = c.run();
    const ok = hit.length > 0;
    if (!ok) bad += 1;
    console.log(`${ok ? "✓" : "✗"} ${c.name}`);
    console.log(
      ok
        ? `    命中 ${hit.length} 条（${hit[0].at} ${hit[0].verb} ${hit[0].route}）`
        : "    命中 0 条  ← 这个单元看不见它，不能用",
    );
  }

  const sessionOnly = entries.filter((e) => e.cls === "session-only").length;
  const noParams = entries.filter((e) => e.cls === "no-params").length;
  const discriminates = sessionOnly + noParams > 0 && todo.length < entries.length;
  console.log(
    `\n${discriminates ? "✓" : "✗"} 清单是真子集：入口 ${entries.length} → 待判 ${todo.length}` +
      `（session-only ${sessionOnly}、no-params ${noParams}）`,
  );
  if (!discriminates) {
    console.log("    ← 它把所有入口都收了，那等于没分类");
    bad += 1;
  }

  // 装饰器词表漂移 = 这个工具**静默变瞎**的方式：新写一道门装饰器，本扫描器不认识它，
  // 于是挂着它的入口一律显示「没门」，而「一致地没门」最像「这一面按设计不设门」。
  // 所以把它做成自检的一条硬判据，而不是报告里一行提示。
  const driftOk = UNKNOWN_DECORATORS.size === 0;
  console.log(
    `\n${driftOk ? "✓" : "✗"} 装饰器词表没漂：类级与处理器级的装饰器都已归档`,
  );
  if (!driftOk) {
    for (const [k, n] of UNKNOWN_DECORATORS) {
      console.log(`    @${k}（${n} 处）不在 GATE_DECORATORS 也不在 NON_GATE_DECORATORS`);
    }
    console.log(
      "    ← 去文件头把它归档：是门就进 GATE_DECORATORS，不是门就进 NON_GATE_DECORATORS。\n" +
        "      不归档的话，挂着它的入口会被这个工具一致地报成「没门」。",
    );
    bad += 1;
  }

  const checks = CHECKS.length + 2;
  console.log(`\n── 汇总 ──\n看得见 ${checks - bad}/${checks} 项判据`);
  if (bad) {
    console.log("这个单元还不能用 —— 先让它看得见上面标 ✗ 的那几条。");
    process.exit(1);
  }
  console.log("已知缺口都在清单里，线索列不凭空判门，清单是真子集。这个单元可以用了。");
  process.exit(0);
}

if (process.argv.includes("--json")) {
  console.log(
    JSON.stringify({ total: entries.length, todo: todo.length, entries }, null, 2),
  );
  process.exit(0);
}

// ── 报告 ───────────────────────────────────────────────────────────────────

const by = (fn, src = entries) => {
  const map = new Map();
  for (const e of src) {
    const k = fn(e);
    map.set(k, (map.get(k) || 0) + 1);
  }
  return [...map].sort((a, b) => b[1] - a[1]);
};

console.log("══ 归属入口盘点（单元 = 入口，不是查询点）══\n");
console.log(
  `入口只在 bff/** 的 ${ENTRY_FILES.length} 份里找，命中 ${entries.length} 个 HTTP 入口；\n` +
    `解析门时还索引了 services/ 与 packages/，共 ${files.length} 份（本仓的门大量住在那边）。\n`,
);
console.log("── 按档");
for (const [k, n] of by((e) => e.cls)) console.log(`   ${String(n).padStart(4)}  ${k}`);
console.log("\n── 要逐条判的（external-id）按面");
for (const [k, n] of by((e) => e.face, todo)) console.log(`   ${String(n).padStart(4)}  ${k}`);

// 读的顺序按**同一份文件内部不一致**排 —— 两条真缺口都是这个形状：
// governance.controller.ts 五个处理器里四个有 assertCan，第五个没有。
// 「整份都没有」常常是按设计（登录、注册、backchannel-logout…），
// 「别人有我没有」几乎总要解释，所以它排前面。
const byFile = new Map();
for (const e of todo) {
  const f = e.at.split(":")[0];
  if (!byFile.has(f)) byFile.set(f, []);
  byFile.get(f).push(e);
}
const mixed = [];
const allBare = [];
for (const [f, es] of byFile) {
  const bare = es.filter((e) => !e.gateHints);
  if (bare.length === 0) continue;
  (bare.length === es.length ? allBare : mixed).push({ f, bare, total: es.length });
}
mixed.sort((a, b) => a.bare.length - b.bare.length || b.total - a.total);

console.log("\n── ① 同一份文件里「别人有门我没门」（这是两条真缺口的形状，先看这些）");
console.log(`   ${mixed.length} 份文件，共 ${mixed.reduce((n, x) => n + x.bare.length, 0)} 条`);
// 「跟不过去的去处」按文件去重打一行，不跟在每条后面 —— 每条后面跟会把清单淹掉
// （`pool.query@Pool` 这种每个处理器都有），而它要回答的问题是按文件问的：
// **这份文件里「没门」这个结论可不可信**。
const opaque = (es) => {
  const s = new Set();
  for (const e of es) for (const u of e.unresolved.split(" ").filter(Boolean)) s.add(u);
  return [...s];
};
for (const x of mixed) {
  console.log(`\n   ${x.f}  —— ${x.bare.length}/${x.total} 条没门`);
  for (const e of x.bare) {
    console.log(`     :${e.at.split(":")[1]}  ${e.verb} ${e.route}  ${e.externalParams}`);
  }
  const op = opaque(x.bare);
  if (op.length) console.log(`     ↳ 跟不过去的去处（门可能在这些后面）：${op.join("、")}`);
}

console.log("\n── ② 整份文件都没有门的线索（多半按设计，但要逐份说出理由）");
allBare.sort((a, b) => b.total - a.total);
console.log(`   ${allBare.length} 份文件，共 ${allBare.reduce((n, x) => n + x.total, 0)} 条`);
for (const x of allBare) console.log(`   ${String(x.total).padStart(3)} 条  ${x.f}`);

if (UNKNOWN_DECORATORS.size) {
  console.log(
    "\n── ⚠ 出现了本扫描器没分类的装饰器 —— 它可能是一道新的门，去文件头把它归档：",
  );
  for (const [k, n] of [...UNKNOWN_DECORATORS].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${String(n).padStart(4)}  @${k}`);
  }
}

const unres = todo.filter((e) => e.unresolved);
console.log(
  `\n── ③ 门可能在跨包 import 后面、扫描器跟不过去的：${unres.length} 条` +
    "（**不是**「没门」，是「看不见」）",
);

const OUT = join(REPO_ROOT, "scripts", "guardrails", "ownership-entrypoints.todo.json");
writeFileSync(
  OUT,
  `${JSON.stringify(
    {
      note:
        "本文件由 scan-ownership-entrypoints.mjs 生成，是 A2 的**入口**分母（收了外部归属值的 HTTP 入口）。" +
        "不是快照、不参与门禁。gateHints/gateHintsVia 只是线索——有线索不等于拦得住（assertSession 只答" +
        "「有没有人登录」，@RequireCapability 对路径参数一个字都不说）；unresolved 非空表示门可能在跨包" +
        "import 后面而扫描器跟不过去，那是「看不见」不是「没门」。查询点那一份在 read-scope-sites.todo.json，两份互补。",
      totalEntrypoints: entries.length,
      total: todo.length,
      sites: todo,
    },
    null,
    2,
  )}\n`,
);
console.log(`\n   → 清单已写出：${rel(OUT)}`);
console.log(
  "\n注：Job / cron / 事件消费者没有 HTTP 装饰器，本扫描器一条都看不见 —— 而平面隔离那条\n" +
    "破口（MARK_READ_SQL）恰好在运营面的作业里，所以「没有入口」不等于「没有面」。见文件头。",
);
