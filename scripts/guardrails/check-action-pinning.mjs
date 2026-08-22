#!/usr/bin/env node

/**
 * check-action-pinning.mjs — 第三方 GitHub Action 必须 SHA-pin;官方 action 不得版本漂移。
 *
 * ── 补的是哪个盲区 ──
 * 治理标准早就写过「不用第三方 action(免 license/供应链顾虑)」——但那条applied 在
 * osv-scanner 上,一个**不持任何凭据**的扫描器;而真正持有全部生产凭据的
 * appleboy/*(SSH 私钥)、docker/*(registry 口令)、tailscale/*(入内网)当时建在
 * **浮动 tag** 上。风险被写下来了,却用在了低价值的那一侧(platform#188 点破)。
 *
 * 浮动 tag 的含义是「维护者今天推什么、我们明天就跑什么」。对一个会拿到 SSH 私钥的
 * action 来说,那等于把凭据交给一个可变引用——而且这种事**不会报错**,它只是在某天
 * 悄悄换了行为。
 *
 * 两条规则:
 *   1. 非 `actions/*` 的第三方 action → 必须 pin 到 40 位 commit SHA
 *   2. `actions/*` 官方件可用 major tag,但**同一仓内不得并存两个 major** ——
 *      版本漂移会让「我们到底跑的哪一版」在不同 job 里有不同答案
 *
 * 用法:node scripts/guardrails/check-action-pinning.mjs
 */

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const SCAN_DIRS = [".github/workflows", ".github/actions"];

/** `uses: owner/repo@ref`（忽略 `./` 开头的本地复合动作——它们就在本仓，无供应链面）。 */
const USES_RE = /^\s*(?:-\s*)?uses:\s*([^\s@'"]+)@([^\s'"#]+)/;
const SHA_RE = /^[0-9a-f]{40}$/;

function walk(dir, out = []) {
  const abs = path.join(ROOT, dir);
  if (!existsSync(abs)) return out;
  for (const name of readdirSync(abs)) {
    const rel = path.join(dir, name);
    if (statSync(path.join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (/\.ya?ml$/.test(name)) out.push(rel);
  }
  return out;
}

const errors = [];
/** `actions/checkout` → Set<major>，用于查同仓并存多个 major。 */
const officialMajors = new Map();

for (const file of SCAN_DIRS.flatMap((d) => walk(d))) {
  const text = readFileSync(path.join(ROOT, file), "utf8");
  text.split(/\r?\n/).forEach((line, idx) => {
    const m = USES_RE.exec(line);
    if (!m) return;
    const [, action, ref] = m;
    if (action.startsWith("./")) return; // 本地复合动作

    if (action.startsWith("actions/")) {
      const major = /^v(\d+)/.exec(ref)?.[1] ?? ref;
      if (!officialMajors.has(action)) officialMajors.set(action, new Map());
      officialMajors.get(action).set(major, `${file}:${idx + 1}`);
      return;
    }

    if (!SHA_RE.test(ref)) {
      errors.push(
        `${file}:${idx + 1}  ${action}@${ref}\n` +
          `    第三方 action 必须 pin 到完整 commit SHA。浮动 tag 意味着「维护者今天推什么、\n` +
          `    我们明天就跑什么」——对持凭据的 action 而言那是把私钥交给一个可变引用。\n` +
          `    取 SHA：gh api repos/${action}/commits/${ref} -q .sha`,
      );
    }
  });
}

for (const [action, majors] of officialMajors) {
  if (majors.size <= 1) continue;
  const where = [...majors.entries()]
    .map(([v, loc]) => `v${v} @ ${loc}`)
    .join("；");
  errors.push(
    `${action} 同仓并存 ${majors.size} 个 major：${where}\n` +
      `    版本漂移会让「我们到底跑的哪一版」在不同 job 里有不同答案，升级与排障都要各查一遍。`,
  );
}

if (errors.length === 0) {
  const pinned = SCAN_DIRS.flatMap((d) => walk(d)).length;
  console.log(
    `Action pin 检查通过（扫 ${pinned} 个 workflow/action 文件；` +
      `第三方全部 SHA-pin，actions/* 各只一个 major）。`,
  );
  process.exit(0);
}

console.error("── Action pin 违规 ──\n");
for (const e of errors) console.error(`✗ ${e}\n`);
console.error(`error: ${errors.length}`);
console.error("规矩见 docs/10-standards/140-repo-governance-standard.md（回应 platform#188）。");
process.exit(1);
