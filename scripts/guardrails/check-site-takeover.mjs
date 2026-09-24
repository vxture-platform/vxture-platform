#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// check-site-takeover.mjs —— 站点接管（平台维护 / 临时门户）四处对账 + 三条性质
//
// ── 补的是哪个盲区 ──
//
// 接管机制横跨四处，彼此之间没有任何机械链路：
//
//   1. `deploy/nginx/site-takeover.defaults`   —— 哪些域登记了档位
//   2. `deploy/nginx/sites-enabled/*.conf`     —— 哪些 vhost 真的接了 `$vx_takeover`
//   3. `deploy/nginx/html/__takeover/*.html`   —— 每个档位发哪张页
//   4. `deploy/scripts/lib/site-takeover.sh`   —— 渲染出的 map 文件名
//
// 任何一处对不上，症状都**不是报错**：
//
//   · 登记了一个 vhost 没接的域 → 切档「成功」，站点一动不动。
//   · 档位有了而页没有         → 切档之后整域 404，而且是在接管已经生效之后才发现。
//   · conf.d include 的 map 文件名与渲染函数写出的对不上 → **nginx -t 直接失败**，
//     边缘拒绝 reload。2026-09-10 智能体路由表踩过同一条。
//
// ── 三条性质（不是一致性）──
//
// 一致性只能抓「两处说得不一样」，抓不到「两处一样地错」。所以另查三条性质：
//
//   E. 接管页必须**自包含**：没有任何本地子资源。接管页是在上游可能全挂时发出去的，
//      它引用的每一个 `/xxx.css` 那时都会 502。「上游挂了照样出得来」是这整套机制的
//      理由，一个本地 <img> 就能把它作废。
//   F. 状态码与 robots 要说同一件事：portal 是 200 的真内容，必须 noindex；
//      maintenance 是 503，**不能**写 noindex——503 已经说清「暂时不可用」，再叠一个
//      noindex 等于在长维护里主动要求除名。
//   H. 同一个 location 里 `if ($vx_takeover …)` 与 `try_files` 不能共存。
//
// ── H 是实测撞出来的 ──
//
// 第一版 `location = /` 写的是 `if ($vx_takeover = maintenance) { return 503; }` 加
// `try_files /__takeover/$vx_takeover.html @website;`，靠「这个档位有没有页」当开关。
// **同一个 location 里 try_files 会把那个 if 整个吃掉**：nginx -t 通过，页也发出去了，
// 只是状态码是 200 而不是 503——正好踩中上面 F 要避免的事。实测确认：把 try_files 换成
// `return 599`，同一请求立刻回 599；放回去就又变 200。所以直接禁掉这个组合。
//
// ── 它看不见什么 ──
//
// · 只读**仓内声明**，不连线上。生效中的档位在主机的 site-takeover.state 里，那是现场
//   状态，本守卫不猜它（`35-site-takeover.sh` 不带参数可以查）。
// · 不判 HTML 好不好看、文案对不对——那是 owner 的事。只判「会不会在上游挂掉时连自己
//   都发不出来」和「状态码与 robots 说的是不是同一件事」。
// · 剥注释用的是「`#` 到行尾」。nginx 引号内的 `#` 会被误剥；本仓 vhost 没有这种写法，
//   真出现了症状是多报而不是漏报。
//
// 用法：node scripts/guardrails/check-site-takeover.mjs
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import process from "node:process";

const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const read = (p) => readFileSync(resolve(root, p), "utf8");
const stripComments = (src) =>
  src
    .split("\n")
    .map((line) => line.replace(/#.*$/, ""))
    .join("\n");

const DEFAULTS = "deploy/nginx/site-takeover.defaults";
const SITES_DIR = "deploy/nginx/sites-enabled";
const PAGES_DIR = "deploy/nginx/html/__takeover";
const MAP_CONF = "deploy/nginx/conf.d/04-site-takeover.conf";
const LIB = "deploy/scripts/lib/site-takeover.sh";

const MODES = ["off", "maintenance", "portal"];

/** 判据读不到就抛，不当成「没问题」——沉默的检查会报成功。 */
function must(value, what) {
  if (value === null || value === undefined) {
    throw new Error(`${what} —— 判据读不到。形状变了就先改守卫，别让它静默通过。`);
  }
  return value;
}

const problems = [];

// ── 1. 档位登记表 ────────────────────────────────────────────────────────────
const registry = [];
for (const raw of read(DEFAULTS).split("\n")) {
  const line = raw.replace(/#.*$/, "").trim();
  if (line === "") continue;
  const parts = line.split(/\s+/);
  if (parts.length !== 2) {
    problems.push(`A: ${DEFAULTS} 这一行不是「域名 档位」两列：${raw.trim()}`);
    continue;
  }
  const [host, mode] = parts;
  if (!MODES.includes(mode)) {
    problems.push(
      `A: ${DEFAULTS} 里「${host}」的档位是「${mode}」，不在 ${MODES.join(" / ")} 之内`,
    );
    continue;
  }
  registry.push({ host, mode });
}
if (registry.length === 0) {
  throw new Error(`${DEFAULTS} 一条都没解析出来`);
}

// ── 2. vhost：谁接了 $vx_takeover ────────────────────────────────────────────
/** 剥注释后按花括号切出 location 块（块头 + 块体）。 */
function locationBlocks(src) {
  const bare = stripComments(src);
  const blocks = [];
  const re = /^[ \t]*location\s+([^\n{]*)\{/gm;
  let m;
  while ((m = re.exec(bare)) !== null) {
    let depth = 1;
    let i = re.lastIndex;
    while (i < bare.length && depth > 0) {
      if (bare[i] === "{") depth += 1;
      else if (bare[i] === "}") depth -= 1;
      i += 1;
    }
    blocks.push({ head: m[1].trim(), body: bare.slice(re.lastIndex, i) });
  }
  return blocks;
}

const vhosts = [];
for (const name of readdirSync(resolve(root, SITES_DIR)).sort()) {
  if (!name.endsWith(".conf")) continue;
  const path = `${SITES_DIR}/${name}`;
  const src = read(path);
  const bare = stripComments(src);
  const serverNames = new Set();
  for (const m of bare.matchAll(/server_name\s+([^;]+);/g)) {
    for (const token of m[1].trim().split(/\s+/)) serverNames.add(token);
  }
  vhosts.push({ path, src, bare, serverNames, wired: bare.includes("$vx_takeover") });
}

const registeredHosts = new Set(registry.map((r) => r.host));

// B. 登记了档位的域，必须有一个 vhost 真的接了开关。
for (const { host, mode } of registry) {
  const owner = vhosts.find((v) => v.serverNames.has(host));
  if (!owner) {
    problems.push(
      `B: ${DEFAULTS} 登记了「${host}」，而 ${SITES_DIR} 下没有任何 vhost 的 server_name 含它` +
        ` —— 切档会「成功」，站点一动不动`,
    );
    continue;
  }
  if (!owner.wired) {
    problems.push(
      `B: 「${host}」的 vhost（${owner.path}）里一次都没出现 $vx_takeover` +
        ` —— 登记了档位 ${mode}，而这份配置根本不读它`,
    );
  }
}

// C. 反向：接了开关的 vhost，它的域必须登记过（否则 map 走 default，永远 off）。
for (const v of vhosts) {
  if (!v.wired) continue;
  const known = [...v.serverNames].some((h) => registeredHosts.has(h));
  if (!known) {
    problems.push(
      `C: ${v.path} 接了 $vx_takeover，而它的 server_name（${[...v.serverNames].join(" / ")}）` +
        `一个都没登记在 ${DEFAULTS} —— map 会走 default，这个域永远切不出 off`,
    );
  }
}

// H. 同一个 location 里 if ($vx_takeover …) 与 try_files 不能共存（见文件头）。
for (const v of vhosts) {
  if (!v.wired) continue;
  for (const block of locationBlocks(v.src)) {
    if (!/if\s*\(\s*\$vx_takeover/.test(block.body)) continue;
    if (/\btry_files\b/.test(block.body)) {
      problems.push(
        `H: ${v.path} 的 location ${block.head} 里 if ($vx_takeover …) 与 try_files 同在。` +
          `try_files 会把那个 if 整个吃掉：nginx -t 通过、页也发得出去，只是状态码变成 200。` +
          `两档统一走 if + 内部跳转，这个 location 里别用 try_files`,
      );
    }
  }
}

// ── 3. 接管页 ────────────────────────────────────────────────────────────────
const pageFiles = existsSync(resolve(root, PAGES_DIR))
  ? readdirSync(resolve(root, PAGES_DIR))
      .filter((f) => f.endsWith(".html"))
      .sort()
  : [];
if (pageFiles.length === 0) {
  throw new Error(`${PAGES_DIR} 下一张接管页都没有`);
}
if (pageFiles.includes("off.html")) {
  problems.push(
    `D: ${PAGES_DIR}/off.html 不该存在——off 的含义是「不接管」，有这张页就意味着正常` +
      `站点会被它顶掉，而档位表上看不出任何异常`,
  );
}
for (const mode of MODES) {
  if (mode === "off") continue;
  if (!pageFiles.includes(`${mode}.html`)) {
    problems.push(`D: 档位 ${mode} 没有对应的 ${PAGES_DIR}/${mode}.html —— 切到这一档会 404`);
  }
}

// owner 2026-09-13 定：门户页上不出现这几个词（它对外是一个站，不是一段过渡）。
const PORTAL_BANNED = ["临时", "占位", "筹备", "尚未", "暂不"];
// 静态文件随请求原样下发，注释 view-source 就能读到——仓内路径 / 容器名一旦写进去，
// 比页脚那行字更直接地把内部结构送出去（2026-09-13 第一版真写过）。
const INTERNAL_LEAKS = [
  "portals/",
  "deploy/nginx",
  "/srv/",
  "vx-platform-",
  "sites-enabled",
  "middleware",
];

for (const file of pageFiles) {
  const mode = file.replace(/\.html$/, "");
  const path = `${PAGES_DIR}/${file}`;
  const html = read(path);

  if (!/<title>[^<]+<\/title>/.test(html)) {
    problems.push(`E: ${path} 没有 <title>`);
  }

  // E. 自包含：不许有指向本地路径的子资源。
  for (const m of html.matchAll(/\b(?:src|href)\s*=\s*"([^"]*)"/g)) {
    const url = m[1];
    if (url === "" || url.startsWith("#") || /^https:\/\//.test(url)) continue;
    problems.push(
      `E: ${path} 引用了本地资源「${url}」。接管页是在上游可能全挂时发出去的，本地子资源` +
        `那时会 502——这一条一破，「上游挂了照样出得来」就不成立了`,
    );
  }

  for (const leak of INTERNAL_LEAKS) {
    if (html.includes(leak)) {
      problems.push(
        `E: ${path} 里出现了「${leak}」。这份文件随请求原样下发，连注释一起——说明写进` +
          ` nginx 配置（那份不下发），不要写进页面`,
      );
    }
  }

  const hasNoindex = /<meta\s+name="robots"[^>]*noindex/i.test(html);
  if (mode === "portal") {
    if (!hasNoindex) {
      problems.push(
        `F: ${path} 是 200 的真内容，必须带 <meta name="robots" content="noindex…">，` +
          `否则接管期间它会被当成这个域的首页收录`,
      );
    }
    for (const word of PORTAL_BANNED) {
      if (html.includes(word)) {
        problems.push(
          `F: ${path} 里出现了「${word}」（owner 2026-09-13 定：门户页上不出现这类词）`,
        );
      }
    }
  }
  if (mode === "maintenance" && hasNoindex) {
    problems.push(
      `F: ${path} 带了 noindex。它随 503 发出去，503 已经说清「暂时不可用、别摘掉我」；` +
        `再叠一个 noindex 等于在长维护里主动要求除名`,
    );
  }
}

// ── 4. include 的 map 文件名必须由渲染函数产出 ───────────────────────────────
const includeLine = must(
  read(MAP_CONF).match(/include\s+\/etc\/nginx\/conf\.d\/([\w.-]+);/),
  `${MAP_CONF} 里找不到 map 的 include`,
);
const libBasename = must(
  read(LIB).match(/TAKEOVER_MAP_BASENAME="([^"]+)"/),
  `${LIB} 里找不到 TAKEOVER_MAP_BASENAME`,
);
if (includeLine[1] !== libBasename[1]) {
  problems.push(
    `G: ${MAP_CONF} include 的是「${includeLine[1]}」，而渲染函数写出的是「${libBasename[1]}」。` +
      `include 的文件不存在时 nginx -t 直接失败，边缘拒绝 reload`,
  );
}

// ── 报告 ─────────────────────────────────────────────────────────────────────
console.log("══ 站点接管对账（check-site-takeover）══");
console.log(
  `  · 登记 ${registry.length} 个域：${registry.map((r) => `${r.host}=${r.mode}`).join("  ")}`,
);
console.log(`  · 接了开关的 vhost ${vhosts.filter((v) => v.wired).length} 份`);
console.log(`  · 接管页 ${pageFiles.length} 张：${pageFiles.join(" / ")}`);

if (problems.length > 0) {
  console.log(`\n✗ ${problems.length} 处：\n`);
  for (const p of problems) console.log(`  x ${p}`);
  console.log(
    `\n机制住在四处：site-takeover.defaults（登记）、sites-enabled/*.conf（接线）、\n` +
      `html/__takeover/*.html（页）、lib/site-takeover.sh（渲染）。\n` +
      `说明见 docs/50-deployment/14-site-takeover.md。`,
  );
  process.exit(1);
}

console.log("✓ 四处一致，接管页自包含，状态码与 robots 说的是同一件事");
