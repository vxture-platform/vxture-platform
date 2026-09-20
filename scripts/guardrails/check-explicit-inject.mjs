#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// 显式 @Inject 守卫:Nest 的每个注入参数都必须自带 @Inject(...)。
//
// ── 为什么需要 ──
// 七个 BFF 的打包走 **esbuild**,它不产 `emitDecoratorMetadata`。没有那份元数据,
// Nest 读不到构造参数的类型,靠类型推断的注入全部落空。两种症状,第二种要命:
//
//   漏在 router / controller 上 → 启动期抛 can't resolve dependencies,
//                                  boot-smoke 当场红。
//   漏在服务包自己的 service 上 → **启动期不抛**。Nest 认为这个类没有依赖,
//                                  直接 new 出一个字段全是 undefined 的壳。
//                                  boot-smoke 绿、type-check 绿、打包绿,
//                                  第一次调用才 500。
//
// 2026-09-20 实测两半都踩过:#402 补了 router 那半(boot-smoke 逮到),
// service 那半漏到生产,console 提交评价一律 500。
//
// ── 判据 ──
// 用 TypeScript 自己的解析器,不用正则:带 @Injectable / @Controller 的类,
// 构造函数的**每一个参数**都要有 @Inject 装饰器。参数为空的构造函数不算。
//
// 运行:  node scripts/guardrails/check-explicit-inject.mjs
// 别名:  pnpm lint:explicit-inject
// 退出码:存在未豁免的漏标 → 1。
// ─────────────────────────────────────────────────────────────────────────────

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const REPO_ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const ROOTS = ["bff", "services", "packages"];

/**
 * 既存豁免(2026-09-20 立守卫时的存量,逐条待查)。
 *
 * 它们**没有被判定为安全**——只是判定它们各自是否真被 esbuild 打的包加载,是另
 * 一件需要逐个追调用链的事,不在立这道守卫的范围里。名单在此明账,新增的一律红。
 *
 * 判据是「这个类会不会进某个 BFF 的 esbuild bundle」:进了就是定时炸弹,没进就
 * 只是隐患。清理时逐条回答这个问题,答完就补 @Inject 并从名单里删掉。
 */
const ALLOWLIST = new Map([
  ["services/commerce/invoice/src/service/invoice.service.ts", "存量,待查是否进 bundle"],
  ["services/commerce/payment/src/service/payment.service.ts", "存量,待查是否进 bundle"],
  // 评价包最初照抄的就是这一份——那次照抄把漏注入一起抄走了,直接造成生产 500。
  ["services/support/ticket/src/service/ticket.service.ts", "存量,console-bff 未加载过"],
  ["packages/core/api/src/client/http.client.ts", "存量,待查是否进 bundle"],
  ["packages/core/auth/src/guards/jwt-auth.guard.ts", "存量,待查是否进 bundle"],
  ["packages/core/auth/src/guards/roles.guard.ts", "存量,待查是否进 bundle"],
]);

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === "dist" || entry === ".next") continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) out.push(path);
  }
  return out;
}

function decoratorName(decorator) {
  const expr = decorator.expression;
  const callee = ts.isCallExpression(expr) ? expr.expression : expr;
  return ts.isIdentifier(callee) ? callee.text : null;
}

const files = ROOTS.flatMap((root) => walk(join(REPO_ROOT, root)));
const findings = [];
let scannedClasses = 0;
let scannedParams = 0;

for (const file of files) {
  const source = readFileSync(file, "utf8");
  // 便宜的预筛;真判据在 AST 上。
  if (!source.includes("@Injectable") && !source.includes("@Controller")) continue;

  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  // 解析不出来就抛,不当成「没问题」——守卫读不到判据时必须红,不能静默放行。
  if (!sf || !sf.statements) {
    throw new Error(`[explicit-inject] 解析失败: ${file}`);
  }

  const rel = relative(REPO_ROOT, file).split(sep).join("/");

  const visit = (node) => {
    if (ts.isClassDeclaration(node)) {
      const decorators = ts.getDecorators?.(node) ?? [];
      const isNestClass = decorators.some((d) => {
        const name = decoratorName(d);
        return name === "Injectable" || name === "Controller";
      });
      if (isNestClass) {
        for (const member of node.members) {
          if (!ts.isConstructorDeclaration(member)) continue;
          if (member.parameters.length === 0) continue;
          scannedClasses++;
          for (const param of member.parameters) {
            scannedParams++;
            const paramDecorators = ts.getDecorators?.(param) ?? [];
            const hasInject = paramDecorators.some(
              (d) => decoratorName(d) === "Inject",
            );
            if (hasInject) continue;
            const { line } = sf.getLineAndCharacterOfPosition(param.getStart(sf));
            const paramName = ts.isIdentifier(param.name)
              ? param.name.text
              : "<解构参数>";
            findings.push({
              rel,
              line: line + 1,
              className: node.name?.text ?? "<匿名类>",
              paramName,
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

console.log("══ 显式 @Inject(check-explicit-inject)══");
console.log(
  `  · 扫描 ${files.length} 个 .ts,带构造参数的 Nest 类 ${scannedClasses} 个,参数 ${scannedParams} 个`,
);

// 判据本身失效时红,而不是绿：一个类都没扫到,说明遍历或路径出了问题。
if (scannedClasses === 0) {
  console.error("✗ 一个带构造参数的 Nest 类都没扫到——判据失效,不是没问题。");
  process.exit(1);
}

const unexpected = findings.filter((f) => !ALLOWLIST.has(f.rel));
const covered = new Set(findings.filter((f) => ALLOWLIST.has(f.rel)).map((f) => f.rel));

// 名单上却已经不再违规的条目也要报：留着的豁免会掩盖后来新写的同名文件。
const stale = [...ALLOWLIST.keys()].filter((rel) => !covered.has(rel));
if (stale.length > 0) {
  console.log(`  · 豁免名单 ${ALLOWLIST.size} 条,其中 ${stale.length} 条已不再违规:`);
  for (const rel of stale) console.log(`      ${rel}  ← 已修好,请从名单里删掉`);
  console.error("✗ 豁免名单有陈旧条目。");
  process.exit(1);
}
console.log(`  · 豁免名单 ${ALLOWLIST.size} 条(存量,逐条待查)`);

if (unexpected.length === 0) {
  console.log("✓ 所有 Nest 构造参数都显式写了 @Inject。");
  process.exit(0);
}

console.error(`\n✗ ${unexpected.length} 个构造参数缺 @Inject:\n`);
for (const f of unexpected) {
  console.error(`  ${f.rel}:${f.line}  ${f.className} 的参数 ${f.paramName}`);
}
console.error(
  "\n  esbuild 不产 emitDecoratorMetadata:漏在 service 上不会启动失败,也不会被",
);
console.error("  boot-smoke 抓到,第一次调用才 500。改法:@Inject(那个类或令牌)。");
process.exit(1);
