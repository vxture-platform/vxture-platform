#!/usr/bin/env node

/**
 * check-audit-actions.mjs — 审计动作码：UI 目录 == BFF 实写集合。
 *
 * ── 补的是哪个盲区 ──
 * 两边各自维护一份动作码清单，谁也不认识谁。不一致**不报错、不影响构建**，只在界面上
 * 现形，而且现形的样子是「看起来正常」：
 *
 *  · **UI 多**（列了 BFF 从不写的码）→ 那个筛选项永远返回空列表。而空列表看起来像
 *    「这段时间没发生过」，不像「这个筛选项是假的」。
 *  · **UI 少**（BFF 写了 UI 不认识的码）→ 日志行显示成原始码 `tenant.owner.transfer`，
 *    且筛选下拉里根本没有。转让所有权、注销租户这两条恰恰是这一页最该被看见的。
 *
 * 2026-09-08 首次清点：BFF 实写 37 个、UI 认 18 个，差 19 个。**人工核对不出来**——
 * 我自己第一遍用 `action: "..."` 双引号匹配去扫，把模板串写法的
 * （`` action: `subscription.${action}` ``）整批漏掉，据此报出「5 个假筛选项」的
 * 错误结论。判据必须覆盖三种写法，见下。
 *
 * ── 三种写法都要认 ──
 *   action: "tenant.member.invite"                    字面量
 *   action: `subscription.${action}`                  模板串（值域来自同文件的 VALID）
 *   action: body.enabled ? "a.on" : "a.off"           三元
 * 后两种无法静态求值，用**显式登记**兜底（DYNAMIC）：登记项必须能在源码里找到佐证，
 * 否则守卫自己报错——不给「登记了就算数」的后门。
 *
 * 用法：node scripts/guardrails/check-audit-actions.mjs
 */

import { readFileSync, readdirSync } from "node:fs";
import process from "node:process";
import assert from "node:assert/strict";
import ts from "typescript";

const ROOT = process.cwd();
const ROUTERS = `${ROOT}/bff/console-bff/src/routers`;
const PAGE = `${ROOT}/portals/console/src/modules/settings/AuditLogsPage.tsx`;
const MSGS = `${ROOT}/portals/console/messages/zh-CN.json`;

/**
 * 动态写法的登记表：`证据片段` → 该处实际会写出的动作码。
 * 证据片段必须在对应源文件里出现，否则视为登记过期。
 */
const DYNAMIC = [
  {
    file: "subscription.router.ts",
    evidence: "action: `subscription.${action}`",
    codes: ["subscription.pause", "subscription.resume", "subscription.cancel"],
  },
  {
    file: "subscription.router.ts",
    evidence: '? "subscription.auto_renew_on"',
    codes: ["subscription.auto_renew_on", "subscription.auto_renew_off"],
  },
];

// ============================================================================
// Historical actions require evidence that their former entry points are retired.
// ============================================================================
const RETIRED = [
  {
    code: "account.deletion.request",
    file: "me.router.ts",
    method: "requestAccountDeletion",
    route: "deletion",
  },
  {
    code: "account.deletion.cancel",
    file: "me.router.ts",
    method: "cancelAccountDeletion",
    route: "deletion/cancel",
  },
];

/** Reject live handlers, stale route evidence and historical catalogue drift. */
function historicalProblems(writtenActions, historicalActions, readRouter) {
  const errors = [];
  const registered = new Set(RETIRED.map((entry) => entry.code));
  for (const code of historicalActions) {
    if (!registered.has(code))
      errors.push(`Unregistered historical action: ${code}`);
  }
  for (const entry of RETIRED) {
    if (!historicalActions.has(entry.code))
      errors.push(`Historical action missing from UI: ${entry.code}`);
    if (writtenActions.has(entry.code))
      errors.push(`Historical action has an active writer: ${entry.code}`);
    const source = ts.createSourceFile(
      entry.file,
      readRouter(entry.file),
      ts.ScriptTarget.Latest,
      true,
    );
    const methods = [];
    function collect(node) {
      if (
        ts.isMethodDeclaration(node) &&
        node.name.getText(source) === entry.method
      )
        methods.push(node);
      ts.forEachChild(node, collect);
    }
    collect(source);
    const method = methods.length === 1 ? methods[0] : undefined;
    const post =
      method &&
      (ts.getDecorators(method) ?? []).some((decorator) => {
        const expression = decorator.expression;
        return (
          ts.isCallExpression(expression) &&
          expression.expression.getText(source) === "Post" &&
          expression.arguments.length === 1 &&
          ts.isStringLiteral(expression.arguments[0]) &&
          expression.arguments[0].text === entry.route
        );
      });
    const statements = method?.body?.statements;
    const last = statements?.[statements.length - 1];
    const gone =
      last &&
      ts.isThrowStatement(last) &&
      ts.isNewExpression(last.expression) &&
      last.expression.expression.getText(source) === "GoneException" &&
      last.expression.arguments?.length === 1 &&
      ts.isObjectLiteralExpression(last.expression.arguments[0])
        ? last.expression.arguments[0]
        : undefined;
    const properties = new Map(
      (gone?.properties ?? []).flatMap((property) =>
        ts.isPropertyAssignment(property) &&
        ts.isStringLiteral(property.initializer)
          ? [[property.name.getText(source), property.initializer.text]]
          : [],
      ),
    );
    // A retired handler can only reject requests. Calls, assignments, returns and
    // other statements would allow a side effect before the final 410 response.
    function rejectionOnly(node) {
      if (ts.isBlock(node)) return node.statements.every(rejectionOnly);
      if (ts.isIfStatement(node))
        return (
          sideEffectFree(node.expression) &&
          rejectionOnly(node.thenStatement) &&
          (!node.elseStatement || rejectionOnly(node.elseStatement))
        );
      return (
        ts.isThrowStatement(node) &&
        ts.isNewExpression(node.expression) &&
        [
          "GoneException",
          "UnauthorizedException",
          "BadRequestException",
        ].includes(node.expression.expression.getText(source)) &&
        (node.expression.arguments ?? []).every(sideEffectFree)
      );
    }
    function sideEffectFree(node) {
      if (
        ts.isCallExpression(node) ||
        ts.isNewExpression(node) ||
        ts.isAwaitExpression(node) ||
        ts.isDeleteExpression(node) ||
        ts.isPostfixUnaryExpression(node) ||
        (ts.isPrefixUnaryExpression(node) &&
          [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(
            node.operator,
          )) ||
        (ts.isBinaryExpression(node) &&
          node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
          node.operatorToken.kind <= ts.SyntaxKind.LastAssignment)
      )
        return false;
      let safe = true;
      ts.forEachChild(node, (child) => {
        if (!sideEffectFree(child)) safe = false;
      });
      return safe;
    }
    if (
      !post ||
      !statements?.every(rejectionOnly) ||
      properties.get("code") !== "account_center_required" ||
      properties.get("path") !== "/account"
    )
      errors.push(
        `Retirement evidence missing or handler is live: ${entry.file}:${entry.method}`,
      );
  }
  return errors;
}

if (process.argv.includes("--self-test")) {
  const historical = new Set(RETIRED.map((entry) => entry.code));
  const fixture = RETIRED.map(
    (entry) =>
      `class Router { @Post("${entry.route}") async ${entry.method}() {
      if (!req.user) throw new UnauthorizedException("No active session");
      throw new GoneException({code: "account_center_required", path: "/account"});
    } }`,
  ).join("\n");
  const check = (source, active = new Set(), history = historical) =>
    historicalProblems(active, history, () => source);
  assert.deepEqual(check(fixture), []);
  for (const source of [
    fixture.replace("new GoneException", "new Error"),
    fixture.replace('@Post("deletion")', '@Post("other")'),
    fixture.replace('path: "/account"', 'path: "/other"'),
    fixture.replace(
      "throw new GoneException",
      "await writeAudit(); throw new GoneException",
    ),
    fixture.replace("if (!req.user)", "if (writeAudit())"),
    fixture.replace("if (!req.user)", "if (req.user = null)"),
  ])
    assert.ok(check(source).length > 0);
  assert.ok(check(fixture, new Set([RETIRED[0].code])).length > 0);
  assert.ok(check(fixture, new Set(), new Set()).length > 0);
  assert.ok(
    check(fixture, new Set(), new Set([...historical, "unregistered"])).length >
      0,
  );
  console.log("Audit action retirement self-test passed (9 rejection cases).");
  process.exit(0);
}

// ============================================================================
// Reconcile active writes, historical records and translated catalogue entries.
// ============================================================================
const problems = [];
const written = new Set();

const files = readdirSync(ROUTERS).filter((f) => f.endsWith(".router.ts"));
if (files.length === 0) {
  console.error("扫不到 console-bff 的 router —— 判据失效，拒绝给出通过结论");
  process.exit(1);
}

for (const f of files) {
  const src = readFileSync(`${ROUTERS}/${f}`, "utf8");
  for (const m of src.matchAll(/action: "([a-z_.]+)"/g)) written.add(m[1]);
}

for (const d of DYNAMIC) {
  const src = readFileSync(`${ROUTERS}/${d.file}`, "utf8");
  if (!src.includes(d.evidence)) {
    problems.push(
      `动态登记已过期：${d.file} 里找不到证据片段 \`${d.evidence}\`——` +
        `那几个码（${d.codes.join(" / ")}）现在还写不写？`,
    );
    continue;
  }
  for (const c of d.codes) written.add(c);
}

const pageSrc = readFileSync(PAGE, "utf8");
const setBlock = pageSrc.match(
  /const KNOWN_ACTIONS = new Set\(\[([\s\S]*?)\]\);/,
);
if (!setBlock) {
  console.error("在 AuditLogsPage 里找不到 KNOWN_ACTIONS —— 判据失效");
  process.exit(1);
}
const ui = new Set([...setBlock[1].matchAll(/"([a-z_.]+)"/g)].map((m) => m[1]));
const historicalBlock = pageSrc.match(
  /const HISTORICAL_ACTIONS = new Set\(\[([\s\S]*?)\]\);/,
);
if (!historicalBlock) {
  console.error("Historical action catalogue missing from AuditLogsPage");
  process.exit(1);
}
const historical = new Set(
  [...historicalBlock[1].matchAll(/"([a-z_.]+)"/g)].map((m) => m[1]),
);
problems.push(
  ...historicalProblems(written, historical, (file) =>
    readFileSync(`${ROUTERS}/${file}`, "utf8"),
  ),
);

const labels = JSON.parse(readFileSync(MSGS, "utf8")).auditPage?.action ?? {};

const missing = [...written].filter((a) => !ui.has(a)).sort();
const extra = [...ui].filter((a) => !written.has(a)).sort();
const unlabelled = [...new Set([...written, ...historical])]
  .filter((a) => !(a.replace(/\./g, "_") in labels))
  .sort();

if (missing.length)
  problems.push(
    `UI 少 ${missing.length} 个（日志会显示成原始码、且筛不到）：\n    ` +
      missing.join("\n    "),
  );
if (extra.length)
  problems.push(
    `UI 多 ${extra.length} 个（筛选项永远空列表）：\n    ` +
      extra.join("\n    "),
  );
if (unlabelled.length)
  problems.push(
    `缺中文文案 ${unlabelled.length} 个（auditPage.action.*）：\n    ` +
      unlabelled.join("\n    "),
  );

console.log("══ 审计动作码一致性检查（check-audit-actions）══");
console.log(
  `BFF 实写 ${written.size} 个（含 ${DYNAMIC.reduce((n, d) => n + d.codes.length, 0)} 个动态写法）、UI 目录 ${ui.size} 个、历史动作 ${historical.size} 个、文案 ${Object.keys(labels).length} 条。\n`,
);

if (problems.length > 0) {
  for (const p of problems) console.error("  ✗ " + p);
  console.error(`\n── 汇总 ──\nerror: ${problems.length}`);
  process.exit(1);
}

console.log("✓ UI 目录、BFF 实写集合、动作文案三者一致。");
console.log("\n── 汇总 ──\nerror: 0");
