#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// 三个运营平台的权限隔离守卫（owner 2026-09-14）
//
// 「三个平面，包括 bff，必须严格隔离，不能有互相引用的代码，可以重复但不能耦合」。
// admin（运营）/ opera（运维）/ arche（治理）三个平台读同一张 admin.operator_permission，
// 所以耦合不报错：一个 BFF 检查另一个平台的码，编译照过、测试照绿，后果只在授权时现形
// ——在一个平台授权，顺带打开了另一个平台的门。本守卫把这件事变成 lint 期的红。
//
// 事实只有一份：deploy/database/seed/seed-catalog.mjs 里的
//   OPERATOR_PLANE_DOMAINS  域 → 平台
//   OPERATOR_PERMISSIONS    操作码目录
//   MENU_TREE               三棵树
// 判据：
//   ① 三个平台的域互不相交；目录里每个码的域都属于某个平台。
//   ② 树恰好三个根 admin.plane / opera.plane / arche.plane；节点码前缀 = 所在平台；
//      每个操作码恰好挂一次，且挂在本平台的树上。
//   ③ bff/<p>-bff/src 与 portals/<p>/src 里出现的每个码：
//      · 域属于别的平台 → 红（跨平台检查码）；
//      · 域属于本平台但目录里没有 → 红（拼错或空码）；
//      · 旧域 platform / release / notification → 红（改名后的遗留）；
//      · {plane}.plane / {plane}.menu.* 的 plane 不是本平台 → 红。
//   ④ 没有跨平台 import（bff 之间、门户之间、门户与别的平台的 bff）。
//   ⑤ 目录里每个码都要在本平台源码里有消费方；没有的必须登记在 UNCONSUMED，
//      登记了却已经有消费方也红（登记表不许过期）。
//
// 只看字符串字面量，不看注释：注释里提到别的平台的码是说明，不是耦合。
// 单测里的别家码不算耦合（「opera 的码在 admin 不放行」正要写出别家的码），
// 但单测里用到的码也不算消费方——只在测试里出现的码，线上没有人检查它。
//
// 运行：node scripts/guardrails/check-operator-planes.mjs（pnpm lint:operator-planes）
// ─────────────────────────────────────────────────────────────────────────────

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const SEED = join(ROOT, "deploy/database/seed/seed-catalog.mjs");
const PLANES = ["admin", "opera", "arche"];
const LEGACY_DOMAINS = new Set(["platform", "release", "notification"]);

/**
 * 目录里有、本平台源码里没有消费方的码。每条写清为什么留着；
 * 新增一条没有消费方的码必须来这里登记，否则红。
 */
/**
 * 2026-10-03 逐码核实（12 条共用理由的那些）。两件事要先说清楚：
 *
 * ① **原来那句理由把三种处境写成一句「或」** ——「仍经旧桥检查扁平码，或这一页尚未设门」。
 *    其中「尚未设门」会是 P0，另一种什么都不是，读者分不出自己面对的是哪一种，
 *    这句话就不可证伪。核完 12 条：**「这一页尚未设门」一条实例都没有**，那半句已删。
 *
 * ② **「没有消费方」是症状，不是病。** 这 12 条不是零散的债，它们精确地聚在
 *    仍由两个遗留扁平码把门的区域：
 *
 *      platform.tenant.manage   → 原 **27** 个 HTTP 入口
 *                                 租户 12 / 工单 10 / 账号 3 / 运营待办 1 / 全局搜索 1
 *      platform.product.manage  → **32** 个 HTTP 入口（products.router 全部，含定价）
 *
 *    **租户 12 与工单 10 已拆**（owner 2026-10-03 裁决「拆门，按细码粒度，先做租户和
 *    工单那两条」）：22 个入口改判本域细码，粗门余 **5** 个（账号 3 个读 / 待办 / 搜索）。
 *    于是 tenant:profile.read、tenant:verification.review、support:ticket.read、
 *    support:ticket.manage 四条从本登记表里删掉了 —— 它们有消费方了。
 *
 *    27 那个数是**传递算出来的**：只认「函数体里直接出现这个码」时是 19，
 *    而 approveTenantVerification / rejectTenantVerification 调的是私有
 *    reviewVerification，门写在那一层 —— 门往下传一跳就数不到了。
 *
 *    而且粗门**两头都错**，这一点是拆门时才量出来的（按 seed 的 OPERATOR_ROLE_PERMS
 *    + withMenuClosure 复算六个角色）：旧桥只从 tenant:profile.manage 合成粗码，于是
 *      · operator 只被授予 support:ticket.read，却能**写**工单（十个入口全开）；
 *      · support 角色持 ticket.read + ticket.manage 两码却拿不到粗码 ⇒ 十个入口全 403，
 *        而 withMenuClosure 恰按这两码把工单菜单放进了它的侧栏 ——
 *        **专职处理工单的角色在侧栏看得见、点进来吃 403**；auditor（只读）同形。
 *    所以「粗门」不只是放得太宽，它同时把该进的人关在外面。
 *
 *    后果说人话：拿到 platform.tenant.manage 的运营者**同时**能改租户资料、
 *    **批准/驳回实名审核**（kyc.tenant_verifications + tenancy.tenants.verification_status）、
 *    **读写全部工单**（含客户可见回复与内部备注）、读全部账号、全局搜索。
 *    目录里给实名审核与工单各留了自己的码，正因为这两道粗门而没有消费方。
 *
 *    **本仓自己写明了被违反的原则**：tenants.router 的 assertCanResetTenantBrand 上方写着
 *    「重置主体标识……故与宽口径的 platform.tenant.manage 分开设门 ——
 *    能改租户资料的人不等于能抹掉租户传的标识」。同一条推理对合规裁定与对客户说话只会更强。
 *
 *    顺带：auth.service 的 LEGACY_CAPABILITY_BRIDGE 今天**只剩两条活的**
 *    （tenant:profile.manage、product:plan.manage），所以「仍经旧桥」对多数条目并不成立 ——
 *    真正的理由是「这些路由从没按域重新设门」。
 *
 * 处置与 commerce:refund.execute 同一个取舍：**改过来要给角色授细码（迁移 + 灌存量库）**，
 * 是 owner 的决定。本轮只把理由改成真话，一道门都没动。
 */
const COARSE_TENANT_GATE =
  "**页面有门，但是粗门**（2026-10-03 核实，同日部分拆完）：这一页坐在遗留扁平码 " +
  "platform.tenant.manage 后面。那个码原先开着 27 个入口，租户 12 与工单 10 已按细码拆门" +
  "（owner 裁决「先做租户和工单那两条」），**余 5 个**：账号列表 / 账号详情 / 账号头像读（3）" +
  "＋ 运营待办（1）＋ 全局搜索（1）。本条的细码因此仍没有消费方 —— 症状在这里，病在那道粗门。" +
  "剩下这三处是 owner 明确后做的那一批";
const COARSE_PRODUCT_GATE =
  "**页面有门，但是粗门**（2026-10-03 核实）：products.router 32 个入口（含定价写入）全判" +
  "遗留扁平码 platform.product.manage，本域的细码因此没有消费方。" +
  "注：platform.pricing.manage 已退役（见 auth.service 的注释），所以这不是「旧桥还在用」";
const MANAGE_IMPLIES_READ =
  "**正常，不是债**（2026-10-03 核实）：本域只有 .manage 有消费方，而 manage 蕴含 read，" +
  "页面判 .manage 即可。读码留在目录里是给将来拆只读角色用的";
const GRANULARITY_ABSENT =
  "**这个粒度的功能不存在**（2026-10-03 核实）：配额数据是经订阅 / 账务 / 租户三个页读到的，" +
  "各走自己域的码（commerce:subscription.* / commerce:billing.*）；admin 没有独立的" +
  "「租户配额」页面或端点。不是缺门，是没有这件事";

const UNCONSUMED = {
  "tenant:quota.read": GRANULARITY_ABSENT,
  "tenant:quota.manage": GRANULARITY_ABSENT,
  "user:profile.read": COARSE_TENANT_GATE,
  "commerce:refund.execute":
    "**不是没设门，是用错了码**（2026-10-03 核实）：orders.router 的四个退款端点" +
    "（refund-audit / refund-execute / refund-create / refund-fail）都挂 @RequireStepUp，" +
    "但判的是 commerce:payment.settle —— 收款的码。同一份文件为 void 写明了相反的原则：" +
    "「与 settle 是不同的危险类别，所以挂自己的 commerce:order.void」。退款是钱出去，" +
    "目录里早就给了它自己的码，没人用。改过来要给角色授这个码（迁移 + 存量库），" +
    "是 owner 的取舍，不是顺手改的事",
  "promotion:campaign.read": MANAGE_IMPLIES_READ,
  "product:plan.read": COARSE_PRODUCT_GATE,
  "product:price.read": COARSE_PRODUCT_GATE,
  "product:price.manage": COARSE_PRODUCT_GATE,
  "content:announcement.read": MANAGE_IMPLIES_READ,
  "support:impersonate":
    "**功能根本没做**（2026-10-03 核实）：这个码只出现在 seed、本守卫与设计文档里，" +
    "admin-bff 与门户里一行实现都没有。它不是债也不是缺口，是一个还没到期的需求",
};

const failures = [];
const fail = (msg) => failures.push(msg);

// ── 从 seed 取三份字面量 ─────────────────────────────────────────────────────
const seedSrc = readFileSync(SEED, "utf8");

function literalAfter(marker) {
  const at = seedSrc.indexOf(marker);
  if (at < 0)
    throw new Error(`seed 里找不到 ${marker}——守卫读不到事实，不能放行`);
  const open = seedSrc.indexOf(
    marker.trim().endsWith("{") ? "{" : "[",
    at + marker.length - 1,
  );
  const closeCh = seedSrc[open] === "{" ? "}" : "]";
  let depth = 0;
  for (let i = open; i < seedSrc.length; i += 1) {
    const ch = seedSrc[i];
    if (ch === seedSrc[open]) depth += 1;
    else if (ch === closeCh) {
      depth -= 1;
      if (depth === 0)
        return new Function(`return ${seedSrc.slice(open, i + 1)};`)();
    }
  }
  throw new Error(`${marker} 的字面量没有闭合`);
}

const PLANE_DOMAINS = literalAfter("export const OPERATOR_PLANE_DOMAINS = {");
const CATALOG = literalAfter("const OPERATOR_PERMISSIONS = [").map(
  (row) => row[0],
);
const TREE = literalAfter("const MENU_TREE = [");

const domainPlane = new Map();
for (const plane of PLANES) {
  const domains = PLANE_DOMAINS[plane];
  if (!Array.isArray(domains) || domains.length === 0) {
    throw new Error(
      `OPERATOR_PLANE_DOMAINS.${plane} 为空——守卫读不到事实，不能放行`,
    );
  }
  for (const d of domains) {
    if (domainPlane.has(d))
      fail(`① 域 ${d} 同时属于 ${domainPlane.get(d)} 与 ${plane}`);
    domainPlane.set(d, plane);
  }
}
const codeRe = /^([a-z_]+):([a-z_]+)(\.[a-z_]+)*$/;
const planeOfCode = (code) => domainPlane.get(code.split(":")[0]);

const catalog = new Set(CATALOG);
for (const code of CATALOG) {
  if (!codeRe.test(code))
    fail(`① 目录码 ${code} 不是 domain:resource.action 形状`);
  else if (!planeOfCode(code)) fail(`① 目录码 ${code} 的域不属于任何平台`);
}

// ── ② 三棵树 ────────────────────────────────────────────────────────────────
const rootCodes = TREE.map((n) => n.code).sort();
if (
  rootCodes.join(",") !==
  PLANES.map((p) => `${p}.plane`)
    .sort()
    .join(",")
) {
  fail(
    `② 树根应恰好是 ${PLANES.map((p) => `${p}.plane`).join(" / ")}，实际 ${rootCodes.join(" / ")}`,
  );
}
const placed = new Map();
function walk(node, plane) {
  if (!node.code.startsWith(`${plane}.`))
    fail(`② 节点 ${node.code} 挂在 ${plane}.plane 下，前缀不符`);
  for (const code of node.perms ?? []) {
    if (!catalog.has(code))
      fail(`② 树上的码 ${code}（${node.code}）不在目录里`);
    if (planeOfCode(code) !== plane)
      fail(
        `② 码 ${code} 属于 ${planeOfCode(code) ?? "?"}，却挂在 ${plane} 的 ${node.code} 下`,
      );
    if (placed.has(code))
      fail(`② 码 ${code} 挂了两次：${placed.get(code)} 与 ${node.code}`);
    placed.set(code, node.code);
  }
  for (const child of node.children ?? []) walk(child, plane);
}
for (const rootNode of TREE) walk(rootNode, rootNode.code.split(".")[0]);
for (const code of CATALOG)
  if (!placed.has(code)) fail(`② 目录码 ${code} 没有挂到任何页面`);

// ── ③④⑤ 源码 ────────────────────────────────────────────────────────────────
function listFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    throw new Error(`读不到 ${relative(ROOT, dir)}——守卫看不见就不能放行`);
  }
  for (const name of entries) {
    if (name === "node_modules" || name === ".next" || name === "dist")
      continue;
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) out.push(...listFiles(abs));
    else if (/\.(ts|tsx|mts|mjs)$/.test(name)) out.push(abs);
  }
  return out;
}

/** 取出字符串字面量（跳过注释）。模板串里带 `${` 的不算一个码。 */
function stringLiterals(src) {
  const out = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === "/" && next === "/") {
      while (i < n && src[i] !== "\n") i += 1;
    } else if (ch === "/" && next === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i += 1;
      i += 2;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      let j = i + 1;
      let buf = "";
      while (j < n && src[j] !== quote) {
        if (src[j] === "\\") {
          buf += src[j + 1] ?? "";
          j += 2;
          continue;
        }
        if (quote !== "`" && src[j] === "\n") break;
        buf += src[j];
        j += 1;
      }
      if (!(quote === "`" && buf.includes("${")))
        out.push({ value: buf, index: i });
      i = j + 1;
    } else {
      i += 1;
    }
  }
  return out;
}

const lineOf = (src, index) => src.slice(0, index).split("\n").length;
const consumed = new Map(PLANES.map((p) => [p, new Set()]));
let scanned = 0;

for (const plane of PLANES) {
  const roots = [
    join(ROOT, `bff/${plane}-bff/src`),
    join(ROOT, `portals/${plane}/src`),
  ];
  const others = PLANES.filter((p) => p !== plane);
  for (const file of roots.flatMap(listFiles)) {
    scanned += 1;
    const src = readFileSync(file, "utf8");
    const rel = relative(ROOT, file).replace(/\\/g, "/");
    const isSpec = /\.(spec|test)\.(ts|tsx|mts|mjs)$/.test(file);

    for (const { value, index } of stringLiterals(src)) {
      const m = codeRe.exec(value);
      if (m) {
        const domain = m[1];
        if (LEGACY_DOMAINS.has(domain)) {
          fail(`③ ${rel}:${lineOf(src, index)}  "${value}" 是改名前的旧码`);
          continue;
        }
        const owner = domainPlane.get(domain);
        if (!owner) continue; // node:fs、测试里的 x:y 之类
        if (owner !== plane) {
          if (!isSpec) {
            fail(
              `③ ${rel}:${lineOf(src, index)}  "${value}" 属于 ${owner}，${plane} 不许检查它`,
            );
          }
        } else if (!catalog.has(value)) {
          fail(
            `③ ${rel}:${lineOf(src, index)}  "${value}" 不在目录里（拼错或空码）`,
          );
        } else if (!isSpec) {
          consumed.get(plane).add(value);
        }
        continue;
      }
      const pm = /^(admin|opera|arche)\.(plane|menu\.[a-z_]+)$/.exec(value);
      if (pm && pm[1] !== plane) {
        fail(
          `③ ${rel}:${lineOf(src, index)}  "${value}" 是 ${pm[1]} 平台的菜单码`,
        );
      }
    }

    for (const m of src.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
      const spec = m[1];
      const crossBff = others.some(
        (o) => spec.includes(`${o}-bff`) || spec === `@vxture/bff-${o}`,
      );
      const crossPortal = others.some((o) =>
        new RegExp(`(^|/)portals/${o}(/|$)`).test(spec),
      );
      if (crossBff || crossPortal) {
        fail(
          `④ ${rel}:${lineOf(src, m.index)}  import "${spec}" 跨到了别的平台`,
        );
      }
    }
  }
}

for (const code of CATALOG) {
  const plane = planeOfCode(code);
  if (!plane) continue;
  const used = consumed.get(plane).has(code);
  if (!used && !(code in UNCONSUMED)) {
    fail(
      `⑤ ${code}（${plane}）在本平台源码里没有消费方——删掉它，或登记到 UNCONSUMED 并写明理由`,
    );
  }
  if (used && code in UNCONSUMED) {
    fail(`⑤ ${code} 已有消费方，从 UNCONSUMED 里摘掉`);
  }
}
for (const code of Object.keys(UNCONSUMED)) {
  if (!catalog.has(code)) fail(`⑤ UNCONSUMED 登记的 ${code} 不在目录里`);
}

console.log("══ 运营三平台权限隔离（check-operator-planes）══");
console.log(
  `  · 目录 ${CATALOG.length} 个操作码，三棵树，扫描 ${scanned} 个源文件`,
);
for (const plane of PLANES) {
  const own = CATALOG.filter((c) => planeOfCode(c) === plane);
  console.log(
    `  · ${plane}: ${own.length} 个码，${consumed.get(plane).size} 个有消费方`,
  );
}
if (failures.length) {
  console.error(`\n✗ ${failures.length} 处违规：`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log("✓ 三个平台互不耦合");
