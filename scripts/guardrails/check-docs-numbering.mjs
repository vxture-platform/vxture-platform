#!/usr/bin/env node
/**
 * check-docs-numbering.mjs - docs/ 编号铁律护栏。
 * @package  @vxture/repo
 * @layer    Infrastructure
 * @category guardrail
 * @description
 *   固化 docs/10-standards/docs-taxonomy.md 的元规则：编号=正式文件、无编号=临时(待删)。
 *   扫 docs/ 下每个 .md，非索引/非白名单且不匹配任一合法编号形态者 → 违规。
 *   迁移期默认 report 模式(列违规=工作单，exit 0)；迁移完成后 `--strict` 转硬门接 CI。
 *
 * @author AI-Generated
 * @date 2026-07-16
 */

import { readdirSync, statSync } from "node:fs";
import { join, relative, basename } from "node:path";

const DOCS_ROOT = "docs";
const STRICT = process.argv.includes("--strict");

// 非 docs 正文的根级白名单（配置/入口类）。仅 docs/ 根一级生效，不按 basename 全局匹配
// （2026-07-22 采纳 karda 回函 F5：收窄前的写法在任意层级放行嵌套 README.md）。
const ROOT_WHITELIST = new Set(["README.md"]);

// 合法「已编号」文件形态（其一即可）：
//   00-index.md / NN-slug.md      —— 目录内序列(十位跳，00 留给索引；2–3 位)
//   {prefix}_{NNN}_slug.md        —— 带 NNN 段的域/序列文档({kind}_{domain}_{NNN}，或
//                                    product kind 省略 domain 段的 product_{NNN}；
//                                    已有 arda_/data_ 等 {prefix}_{NNN} 序列同样视为已编号)
//   ADR-NNN* / TD-NNN*            —— 类型寄存器
const NUMBERED_FILE = [
  /^\d{2,3}-.+\.md$/u, // NN(N)-slug.md（含 00-index.md）
  /^[a-z][a-z0-9-]*(_[a-z][a-z0-9-]*)?_\d{3}[_.-].*\.md$/u, // {prefix}(_{domain})?_{NNN}_slug
  /^(ADR|TD)-\d{3}.*\.md$/u, // 寄存器
];

// 合法「已编号」子目录形态：NN(N)-name/（序列子目录 / 产品层级编码，见 070 §2/§6）。
const NUMBERED_DIR = /^\d{2,3}-[a-z][a-z0-9-]*$/u;

// 子目录具名例外表（070 §2：键控子目录——目录名本身是稳定外部键，编号只会制造虚假顺序感）。
// 新增前先在 070-docs-taxonomy.md §2 登记，再加进本表。路径相对 docs/。
const DIR_EXEMPTIONS = new Set([
  "30-design/decisions", // 键=ADR 号，070 §4 钉死
  "30-design/db/schemas", // 键=表名
  "50-deployment/rebuild", // 治理规范 §1 钉死
  "60-operations/audit", // 键=审计主题
  "60-operations/audit/rules", // 键=规则名
  "30-design/inputs", // 键=owner 原稿留档，永久性 staging，不进编号体系
  "40-implementation/packages", // 键=包名（及其全部子目录）
  "20-specs/000-platform/admin", // 键=产品面名
  "20-specs/000-platform/console",
  "20-specs/000-platform/website",
  "20-specs/000-platform/opera", // 键=产品面名（能力控制台,product_250 批C）
  // 历史遗留（070 §2）：本应是序列子目录、理应编号，但既有引用面过宽，维持现状不追溯改名。
  // 本表随时间收缩，新建同层级目录一律编号，不得再加入本组。
  "30-design/architecture",
  "30-design/commerce",
  "30-design/db",
  "30-design/identity",
  "30-design/platform",
  "40-implementation/ai",
  "40-implementation/development",
]);

function isExemptDir(relPath) {
  if (DIR_EXEMPTIONS.has(relPath)) return true;
  // packages/ 下任意深度子目录（agents/agent-template 等）均随父例外，键=包名/子包名。
  return relPath.startsWith("40-implementation/packages/");
}

function walk(dir, relDir = "") {
  const files = [];
  const dirViolations = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = relDir ? `${relDir}/${name}` : name;
    if (statSync(full).isDirectory()) {
      const isTopDecade = relDir === "" && /^\d{2}-[a-z][a-z0-9-]*$/u.test(name);
      if (!isTopDecade && !NUMBERED_DIR.test(name) && !isExemptDir(rel)) {
        dirViolations.push(full);
      }
      const sub = walk(full, rel);
      files.push(...sub.files);
      dirViolations.push(...sub.dirViolations);
    } else if (name.endsWith(".md")) {
      files.push({ full, relDir });
    }
  }
  return { files, dirViolations };
}

function isNumbered({ full, relDir }) {
  const name = basename(full);
  if (relDir === "" && ROOT_WHITELIST.has(name)) return true;
  return NUMBERED_FILE.some((re) => re.test(name));
}

let walked;
try {
  walked = walk(DOCS_ROOT);
} catch {
  console.log(`[docs-numbering] no ${DOCS_ROOT}/ — skip`);
  process.exit(0);
}

const { files, dirViolations } = walked;

const fileViolations = files
  .filter((f) => !isNumbered(f))
  .map((f) => relative(".", f.full).replaceAll("\\", "/"))
  .sort();

const dirViolationPaths = dirViolations
  .map((d) => relative(".", d).replaceAll("\\", "/"))
  .sort();

const totalViolations = fileViolations.length + dirViolationPaths.length;

if (totalViolations === 0) {
  console.log(`[docs-numbering] OK — ${files.length} docs, all numbered/classified.`);
  process.exit(0);
}

if (fileViolations.length > 0) {
  console.log(
    `[docs-numbering] ${fileViolations.length} 未编号 .md（= 临时/待删或待编号，见 docs/10-standards/070-docs-taxonomy.md）:`,
  );
  for (const v of fileViolations) console.log(`  ${v}`);
}
if (dirViolationPaths.length > 0) {
  console.log(
    `[docs-numbering] ${dirViolationPaths.length} 未分类子目录（须编号或登记进 DIR_EXEMPTIONS，见 070 §2）:`,
  );
  for (const v of dirViolationPaths) console.log(`  ${v}`);
}

if (STRICT) {
  console.error(
    `\n[docs-numbering] STRICT: 未编号文件/未分类子目录即违规——编号(NN-/域文档/ADR-·TD-)、登记例外或删除。`,
  );
  process.exit(1);
}
console.log(`\n[docs-numbering] report 模式（迁移期，不阻断）。迁移完成后 --strict 接 CI。`);
process.exit(0);
