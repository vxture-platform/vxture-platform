#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// BFF 路由访问策略守卫:每条路由必须声明 @Public / @SelfScope / @RequireCapability
//
// identity/060 §7:「新增路由必须声明权限 code 或明确标注 @Public()」。console-bff
// 的全局 CapabilityGuard 对漏标路由一律 403(fail-closed),但那是运行时才炸;这里在
// lint 期把漏标的处理函数报出来,连同它所在的文件与行号。
//
// 判据:每个 @Get/@Post/@Put/@Patch/@Delete(…) 所在的连续装饰器块里含任一策略装饰器,
// 或者该 controller 的 @Controller(…) 装饰器块里含类级策略(方法级覆盖类级)。
//
// 运行:  node scripts/guardrails/check-bff-route-policies.mjs
// 别名:  pnpm lint:route-policies
// 退出码:存在漏标 → 1。
// ─────────────────────────────────────────────────────────────────────────────

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));
// 目前只有 console-bff 走装饰器策略;admin-bff 仍是处理函数内 assertAnyCapability。
const ROUTER_DIRS = ["bff/console-bff/src/routers"];

const HTTP_DECORATOR = /^\s*@(Get|Post|Put|Patch|Delete|All|Head|Options)\(/;
const POLICY_DECORATOR = /^\s*@(Public|SelfScope|RequireCapability)\(/;
const ANY_DECORATOR = /^\s*@\w+\(/;
const CONTROLLER = /^\s*@Controller\(/;

function decoratorBlock(lines, index) {
  let start = index;
  while (start - 1 >= 0 && ANY_DECORATOR.test(lines[start - 1])) start -= 1;
  let end = index;
  while (end + 1 < lines.length && ANY_DECORATOR.test(lines[end + 1])) end += 1;
  return lines.slice(start, end + 1);
}

const findings = [];
let routes = 0;

for (const dir of ROUTER_DIRS) {
  const abs = join(REPO_ROOT, dir);
  for (const file of readdirSync(abs).filter((f) => f.endsWith(".router.ts"))) {
    const lines = readFileSync(join(abs, file), "utf8").split("\n");
    const classHasPolicy = lines.some(
      (line, i) => CONTROLLER.test(line) && decoratorBlock(lines, i).some((l) => POLICY_DECORATOR.test(l)),
    );
    lines.forEach((line, i) => {
      if (!HTTP_DECORATOR.test(line)) return;
      routes += 1;
      const block = decoratorBlock(lines, i);
      if (classHasPolicy || block.some((l) => POLICY_DECORATOR.test(l))) return;
      findings.push(`${dir}/${file}:${i + 1}  ${line.trim()}`);
    });
  }
}

console.log(`══ BFF 路由访问策略(check-bff-route-policies)══`);
console.log(`  · 扫描 ${routes} 条路由`);
if (findings.length) {
  console.log(`  ✗ ${findings.length} 条路由没有声明访问策略:`);
  for (const f of findings) console.log(`    - ${f}`);
  process.exit(1);
}
console.log("✓ 每条路由都声明了 @Public / @SelfScope / @RequireCapability。");
