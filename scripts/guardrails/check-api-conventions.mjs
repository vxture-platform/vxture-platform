#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// 管理面 API 口径 linter（product_251 D-3）
//
// 规范自己写着：「写死在文档里的符合性是快照，会烂。**能自动校验的条款就不要靠人记**」。
// 本脚本就是那句话的落实——它校验的是 platform 管理面里**纯文本模式可判**的那几条：
//
//   ① X-1  不许再出现裸的 Nest 异常（`throw new BadRequestException("…")`）
//   ② X-1  错误码必须 SCREAMING_SNAKE；拒绝类必须取统一词表，不得另造
//   ③ X-3  审计 DTO 的字段名必须是规范那一套，且不得回退到旧名
//   ④ B-3  platform 自有 DTO 的「算不算数」字段必须叫 state，不叫 status
//
// **判不了的不假装能判**：B-1 的动词语义（PUT 是不是真全量替换）、B-2 的写入结果
// 可分辨，都要读懂业务才能判——那两条靠评审，见
// docs/20-specs/000-platform/opera/30-management-api.md。
//
// 范围只含 platform 自己拥有的对象。atlas.router.ts / runos.router.ts 是**代理层**，
// 动词与形状镜像上游，改它们等于让代理与被代理者对不上——故整体豁免，见 EXEMPT。
//
// 运行：  node scripts/guardrails/check-api-conventions.mjs
// 别名：  pnpm lint:api-conventions
// 退出码：存在违规 → 1。
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const BFF_SRC = join(REPO_ROOT, "bff", "opera-bff", "src");
const rel = (f) => f.slice(REPO_ROOT.length + 1).replace(/\\/g, "/");

/**
 * 代理层：形状镜像上游，不受本仓口径约束。
 * 上游各自的收敛进度见 docs/80-liaison/00-index.md（atlas#202-206 / runos#117-121）。
 */
const EXEMPT = new Set([
  "bff/opera-bff/src/routers/atlas.router.ts",
  "bff/opera-bff/src/routers/runos.router.ts",
]);

/** 拒绝词表（X-1）——三方共用，不带模块前缀。 */
const REJECTION_CODES = new Set([
  "NOT_ENTITLED",
  "POLICY_DENIED",
  "APPROVAL_REQUIRED",
  "QUOTA_EXCEEDED",
]);

/** 出口过滤器的兜底码：它们是「漏改的信号」，本身合法。 */
const FALLBACK_CODES =
  /^(UNCLASSIFIED_[A-Z_]+|UPSTREAM_(UNAVAILABLE|TIMEOUT)|SERVICE_UNAVAILABLE|INTERNAL_ERROR)$/;

/** X-3 审计记录的必备字段与作废旧名。 */
const AUDIT_REQUIRED = [
  "eventId",
  "occurredAt",
  "actorId",
  "actorConsole",
  "objectType",
  "objectId",
  "action",
  "outcome",
];
const AUDIT_RETIRED = {
  time: "occurredAt",
  actor: "actorName（显示名）/ actorId（主体）",
  result: "outcome",
  resourceType: "objectType",
  resourceId: "objectId",
};

const failures = [];
const fail = (file, line, rule, msg) =>
  failures.push({ file, line, rule, msg });

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith(".ts") && !name.endsWith(".spec.ts")) out.push(full);
  }
  return out;
}

const files = walk(BFF_SRC).filter((f) => !EXEMPT.has(rel(f)));

// ── ① 裸 Nest 异常 ──────────────────────────────────────────────────────────
// 出口过滤器保证了形状，但形状不等于语义：一个兜底码只说明「这里出错了」，
// 说不出是哪一件事。码要在抛出点给，所以抛出点不许再用裸异常。
const BARE_THROW =
  /throw\s+new\s+(BadRequest|Unauthorized|Forbidden|NotFound|Conflict|BadGateway|ServiceUnavailable|InternalServerError|Http)Exception\b/;

for (const file of files) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((text, i) => {
    if (BARE_THROW.test(text)) {
      fail(
        rel(file),
        i + 1,
        "X-1",
        "裸 Nest 异常——改用 errors/api-error.ts 的构造帮手，把 code 与 retryable 给出来",
      );
    }
  });
}

// ── ② 错误码形状 ────────────────────────────────────────────────────────────
// 只扫构造帮手的第一个字符串实参——那个位置按定义就是 code。
const CODE_CALL =
  /\b(invalidRequest|unauthenticated|policyDenied|notFound|conflict|internalError|upstreamUnavailable|serviceUnavailable)\(\s*"([^"]*)"/g;

for (const file of files) {
  const src = readFileSync(file, "utf8");
  const lines = src.split(/\r?\n/);
  for (const m of src.matchAll(CODE_CALL)) {
    const code = m[2];
    const line = src.slice(0, m.index).split(/\r?\n/).length;
    if (!/^[A-Z][A-Z0-9_]*$/.test(code)) {
      fail(rel(file), line, "X-1", `错误码 "${code}" 不是 SCREAMING_SNAKE`);
      continue;
    }
    // 拒绝类语义必须走词表：自造一个 *_DENIED / *_NOT_ENTITLED 就是在分叉。
    if (
      !REJECTION_CODES.has(code) &&
      /(_DENIED|_NOT_ENTITLED|_QUOTA_EXCEEDED)$/.test(code)
    ) {
      fail(
        rel(file),
        line,
        "X-1",
        `"${code}" 像是自造的拒绝码——拒绝一律取词表：${[...REJECTION_CODES].join(" / ")}`,
      );
    }
    if (FALLBACK_CODES.test(code) && !rel(file).includes("filters/")) {
      fail(
        rel(file),
        line,
        "X-1",
        `"${code}" 是出口过滤器的兜底码，不该在业务代码里主动抛`,
      );
    }
  }
  void lines;
}

// ── ③ 审计 DTO 字段名 ───────────────────────────────────────────────────────
const AUDIT_DTO = join(BFF_SRC, "routers", "audit-log-view.router.ts");
{
  const src = readFileSync(AUDIT_DTO, "utf8");
  const iface = src.match(
    /export interface AuditLogEntry \{([\s\S]*?)\n\}/,
  )?.[1];
  if (!iface) {
    fail(rel(AUDIT_DTO), 0, "X-3", "找不到 AuditLogEntry 接口——本检测器需要它");
  } else {
    const fields = new Set(
      [...iface.matchAll(/^\s*([a-zA-Z][a-zA-Z0-9]*)\??\s*:/gm)].map(
        (m) => m[1],
      ),
    );
    for (const need of AUDIT_REQUIRED) {
      if (!fields.has(need)) {
        fail(rel(AUDIT_DTO), 0, "X-3", `审计记录缺必备字段 \`${need}\``);
      }
    }
    for (const [old, now] of Object.entries(AUDIT_RETIRED)) {
      if (fields.has(old)) {
        fail(rel(AUDIT_DTO), 0, "X-3", `\`${old}\` 已作废——改用 \`${now}\``);
      }
    }
  }
}

// ── ④ platform 自有 DTO 不得暴露 status ────────────────────────────────────
// 只看 `export interface`/`export type` 块里的字段：DB 行类型（`interface XxxRow`）
// 用 status 是对的——列名不改，改的只是接口层，这个区分是本条的全部意义。
const OWNED_ROUTERS = [
  "product-catalog.router.ts",
  "oidc-client.router.ts",
  "maintenance-windows.router.ts",
  "tenancy-directory.router.ts",
];

for (const name of OWNED_ROUTERS) {
  const file = join(BFF_SRC, "routers", name);
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(/export interface (\w+) \{([\s\S]*?)\n\}/g)) {
    const [, typeName, body] = m;
    if (/^\s*status\??\s*:/m.test(body)) {
      const line = src.slice(0, m.index).split(/\r?\n/).length;
      fail(
        rel(file),
        line,
        "B-3",
        `出参类型 \`${typeName}\` 暴露了 \`status\`——「算不算数」统一叫 \`state\`（DB 列不改，只改接口层）`,
      );
    }
  }
}

// ── ⑤ 手写错误响应也要带封套 ────────────────────────────────────────────────
// 出口过滤器只兜得住「抛出去」的错误。中间件与 OIDC 回调**自己写响应**——它们在
// 过滤器之前，或者根本不走异常通道。这一类正是本检测器第一版漏掉、靠 curl 一个
// 不存在的路由才发现的（`operator-auth.middleware.ts` 回的是
// `{ code: "UNAUTHORIZED", message }`：有 code 但没 retryable，而且码还与 router
// 层的 `AUTH_NO_SESSION` 是同一件事的两种写法）。
const MANUAL_ERROR_RESPONSE = /\.status\(\s*(\d{3})\s*\)\s*\.json\(\s*\{/g;

for (const file of files) {
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(MANUAL_ERROR_RESPONSE)) {
    const status = Number(m[1]);
    if (status < 400) continue;

    // 从 `{` 起做括号配平，取出对象字面量。
    let depth = 0;
    let end = m.index + m[0].length - 1;
    for (let i = end; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    const literal = src.slice(m.index, end + 1);
    const line = src.slice(0, m.index).split(/\r?\n/).length;

    for (const key of ["code", "message", "retryable"]) {
      if (!new RegExp(`\\b${key}\\s*:`).test(literal)) {
        fail(
          rel(file),
          line,
          "X-1",
          `手写的 ${status} 响应缺 \`${key}\`——过滤器兜不到自己写响应的地方，封套要就地补齐`,
        );
      }
    }
  }
}

// ── 报告 ────────────────────────────────────────────────────────────────────
if (failures.length === 0) {
  console.log(
    `✓ 管理面 API 口径：${files.length} 个文件全部符合（X-1 / X-3 / B-3 的可机器判定部分）`,
  );
  console.log(
    "  注：B-1 动词语义与 B-2 写入结果可分辨判不了，靠评审——见 docs/20-specs/000-platform/opera/30-management-api.md",
  );
  process.exit(0);
}

console.error(`✗ 管理面 API 口径：${failures.length} 处违规\n`);
for (const f of failures) {
  console.error(`  [${f.rule}] ${f.file}${f.line ? `:${f.line}` : ""}`);
  console.error(`         ${f.msg}`);
}
console.error(
  "\n口径见 docs/20-specs/000-platform/opera/30-management-api.md；规范见 product_251。",
);
process.exit(1);
