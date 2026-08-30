#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// i18n 铺开进度的**棘轮**：硬编码中文串只许变少，不许变多
//
// 机制层已经统一（五个门户都在 next-intl 上），但铺开是个跨多次会话的活——
// 6000 多条串、150 多个文件。这种长跑最典型的失败方式不是「做得慢」，是
// **一边抽一边加**：这周抽掉两百条，下周新页面又写进去三百条，半年后总数
// 没动，而每个人都觉得自己在推进。
//
// 所以这里不设目标、只设棘轮：每个门户记一个当前数，**超过就报错**。抽完一批
// 就把数字调下去，那一步是提交的一部分，改不改得动一目了然。
//
// ## 判据：代码位置，不是文件
//
// 这个仓的注释全是中文，按「含中文的文件数」统计会被污染得毫无意义（opera
// 58/58 个文件都含中文，但那大半是注释）。所以先把注释挖空（保持行号），再数
// 三类：双引号/反引号字面量、以及 JSX 文本节点。
//
// 会有少量误判——比如 `RISK_LEVEL_META` 里 `label: "read"` 那种技术标识不该翻译，
// 但它本来就不含中文，不进统计。真正的误判是「注释里带引号的中文被算进代码」，
// 挖空注释已经处理掉了。宁可略高估，不可低估：低估会让棘轮松掉。
//
// 运行：  node scripts/guardrails/check-i18n-coverage.mjs
// 别名：  pnpm lint:i18n-coverage
// 退出码：任一门户超过基线 → 1。
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const PORTALS_DIR = join(REPO_ROOT, 'portals');

/**
 * 每个门户当前的硬编码中文串数。**这是棘轮，只许调小。**
 *
 * 抽完一批之后把数字改成新的实测值，和代码改动在同一个提交里。调大它需要一个
 * 理由，而写下那个理由的时候多半会发现不该调大。
 *
 * 2026-08-26 基线（i18n 基座落地时实测）：
 *   console / website 已基本抽完；admin 与 opera 是主战场；accounts 抽了一条竖切。
 * 2026-08-26 opera 2106 → 1826：抽掉跨文件重复的通用词汇（列表页外壳、通用动作、
 *   列头、状态词）一批 280 处 / 22 个文件。
 * 2026-08-26 admin 4125 → 3844：同一套共享命名空间的扫描，281 处 / 43 个文件。
 *   两个门户的 `common` / `columns` / `filters` / `actions` / `status.generic` 形状
 *   刻意一致——同一个词在两边该是同一个键。
 * 2026-08-26 第二轮扫中低频重复：opera 1826 → 1795（31 处），admin 3844 → 3799
 *   （45 处）。剩下的跨文件重复主要是三类，都不该机械扫：导航标签（结构归
 *   `opera-navigation-design.md` 裁）、领域名词（要先有词表）、以及宿主不是组件
 *   的那些（模块级常量表 / 普通函数，要先做结构改造）。
 * 2026-08-26 admin 3799 → 3756：五个「状态 → 中文」的顶层函数删掉，改成词条查表
 *   （映射本来就是恒等，函数没有任何判断可言）。
 * 2026-08-26 admin 3756 → 3668：PlatformGovernanceListPage 的四套治理域配置搬进
 *   词条，图标与语气留在代码里（同 opera `status.ts` 的判据）。
 * 2026-08-27 admin 3668 → 3660：视觉验证时抓到的混合语言（`还没有${objectLabel}`
 *   在英文下渲染成「还没有Secret」），连同两处同形的一起抽掉。
 * 2026-08-27 admin 3660 → 3666：**真新增，不是口径问题。** 技能、公告、服务
 *   套餐三页的手搓卡片换 `MetricListCard` 时，它的 `metrics` 契约要求**每个读数
 *   带一个标签**，而原来那排 meta 是一串裸值（「分类」v1.2「123 次调用」混在
 *   一行）。于是多出七个标签词：分类 / 版本 / 调用次数 / 发布范围 / 发布时间 /
 *   未发布 / 基础套餐。这是真的多写了文案，基线往上调；它们该进词条，归入
 *   i18n 那条线的待办。
 *
 * 2026-08-27 admin 3662 → 3660：TenantDetailPage 换 DS 件时又抵回去了：多处
 *   `<small>注册激活</small>` 这类不带插值的 JSX 文本节点（本来就被数到）变成了
 *   `label` 属性串，一进一出持平；而几个重复的标题段被 DS 件合并后真的少了。
 *
 * 2026-08-27 admin 3660 → 3662：同一个口径问题第三次出现。五个手搓模态换
 *   `DialogForm` 时，两处副标题从 `<p>{bill.billNo} · 当前应收{" "}{fmt(…)}</p>`
 *   变成了 `description` 的模板串。**串一直都在**，只是之前没被数到。
 *
 *   根因是本文件的盲点：`JSX_TEXT` 的 `[^<>{}
]*` 在碰到插值时就断了，
 *   所以「带插值的 JSX 文本节点」一律漏数。把它补上会一次性抬高五个门户的
 *   基线，属于 i18n 那条线的活，不该搭在 CSS 改造里做——先如实记在这里。
 *
 * 2026-08-27 admin 3661 → 3660：卡片换 `MetricListCard` 后又自己抵回来了——
 *   `__metrics` 里的 `<small>配额消耗</small>` 这类 JSX 文本节点变成了 `label`
 *   属性串，而它们本来就被 `JSX_TEXT` 数到过，一进一出刚好抵掉下面那一条。
 *
 * 2026-08-27 admin 3660 → 3661（已被上一条抵消）：**计数口径变了，不是多写了一条。** CommerceOverviewPage
 *   的「个订阅」原本是 `<small>{formatNumber(n)} 个订阅</small>`——JSX 文本节点里
 *   带插值时 `JSX_TEXT` 的 `[^<>{}
]*` 匆匆跑掉，一直没被数到；手搜网格换成
 *   `TableTitleCell` 后它成了 `description` 的模板串，于是被 `LITERAL` 数到了。
 *   这正是本文件开头说的「宁可略高估」：高估修正一次，比为了压住数字把代码写回
 *   正则看不见的形状好。
 *
 * 2026-08-29 opera 1795 → 1818：`model/services` 页新增「低谷定价」一节
 *   （TD-047 / atlas#47：provider 的 `config.pricing.offPeak` 此前在界面上无处可设）。
 *   **没有走 `t()`，是有意的。** 这一页 280 条硬编码中文一条都还没抽，是本门户里
 *   最大的一处；只把新增的这一节抽出去，得到的是一页半中英——而那正是 2026-08-27
 *   视觉走查在 admin 上抓到的缺陷（局部抽取造出的混合语言）。抽要连整页抽，
 *   那是 i18n 那条线的活，不该搭在一个补配置入口的改动里做。
 *
 * 2026-08-29 admin 3666 → 3510：**不是这次改小的，是基线一直没跟上。**
 *   实测 3510，基线停在 3666，中间那 156 条的余量意味着棘轮这段时间根本没在咬——
 *   admin 可以悄悄多写 156 条硬编码而不被拦。本文件的全部作用就是不让它悄悄涨，
 *   所以余量本身就是缺陷。趁这次实测把它收到实数。
 *
 * 2026-08-29 accounts 263 → 264：登录表单在人机验证降级时多了一句
 *   「人机验证未完成（<code>），提交可能被拒绝」（B0 度量，见 70-workplan/90）。
 *   这一页（OidcLoginForm）本就全是硬编码中文、一条没抽，只抽这一句会造出半中英；
 *   抽要整页抽，那是 i18n 那条线的活。这句是把此前被吞掉的错误码放到用户眼前，
 *   不放就得继续靠猜。
 *
 * 2026-08-30 opera 1818 → 1819：`ops/health` 服务状态页清单改以 product.products
 *   为主表（opera/40-product-registry.md），于是多出一个产品级的中性态「未接入」
 *   （目录里有、没有任何 OIDC 客户端），以及探测点抽屉里对应的说明段。
 *   **没有走 `t()`，是有意的**：这一页全部文案都是硬编码中文、一条没抽，只抽新加的
 *   这几句会造出半中英（同 08-29 `model/services` 那条的判据）。同一个词四处出现的
 *   收成一个常量（与页内既有的 `LIVENESS_LABELS` 同一做法），所以净增只有 1。
 *
 * 2026-08-31 admin 3510 → 3488：摘掉四个永远为空的菜单项（40-menu.md 1.2.0）连带
 *   删除审批中心 / 平台密钥两页与它们共用的治理列表页，那三个文件的硬编码中文随文件
 *   一起消失。实测收到实数，余量不留。
 *
 * 2026-08-31 admin 3488 → 3266：产品板块去 mock（TD-029）重写了解决方案 / 服务套餐
 *   四页与模型授权页，文案整页抽进 `productCatalog` / `productSolutionsPage` /
 *   `productSolutionDetailPage` / `servicePlansPage` / `servicePlanDetailPage` 五个
 *   命名空间（zh-CN / en-US 同步）。棘轮随之收紧到实数（与上一条同日合入，数字
 *   是两处改动叠加后的实测）。
 *
 * 2026-08-30 website 54 → 40：官网上线前去 mock。删掉的 `StatsSection`（「10+ 企业
 *   客户 / 98.0% 满意度 / 2000+ 用户」，硬编码且无处渲染）带走了全部 14 条；/pricing
 *   改读 `GET /api/products/:code/plans` 后新增的三态文案与配额/功能词典全部走 `t()`，
 *   一条没进代码。
 *
 * 2026-08-31 admin 3266 → 3234：技能市场页改读 Runos 能力目录时整页重写，文案抽进
 *   `skillsPage` 命名空间（zh-CN / en-US 同步），空桩时代的硬编码随页一起消失。
 *
 * 2026-08-31 admin 3234 → 3225（rebase 后实测；分支上原为 3510 → 3501）：首页与外壳去 mock。首页摘掉"待接入 / 暂无数据"补位行、
 *   Token 调用量前三卡、周期系数拼出来的"版本更新 N 次"，少了几条硬编码；外壳的
 *   通知抽屉（原先两条写死的演示通知）改读投递台账、设置抽屉改读主题/密度状态，
 *   新增文案全走 `t()`（drawer.notifications.empty/channels/statuses），
 *   零新增硬编码。棘轮随实数收紧。
 *
 * 2026-08-31 admin 3225 → 3226：订阅详情的方案归属改从 product.solution_plans 实算，
 *   来源枚举多了 "solution" 一档，对应标签「方案关联」是唯一新增的一条硬编码
 *   （与同一函数里既有的两条并列，抽 t() 应当三条一起抽，留给该页整体 i18n 时做）。
 *
 * 2026-08-30 opera 1819 → 1822：`settings` 页从一张凭空写出来的表单（五个字面量默认
 *   值、保存按钮 disabled、opera-bff 没有任何配置表与端点）改成只读的事实页：说明没有
 *   可配项，把服务状态探测（间隔 / 两类端点 / 策略）与上游模块挂载这几条由代码与规格
 *   定下的事实按出处列出。表单的 18 条换成事实页的 22 条；外壳去掉没有通知源的
 *   「告警通知」钮（−1），一进一出净增 3。**没有走 `t()`，是有意的**：外壳与这一页
 *   都是硬编码中文、一条没抽，只抽这几句会造出半中英（同 08-29 / 08-30 两条的判据）。
 *
 * 2026-08-30 console 32 → 30：去 mock 那批删掉了零引用的 `TenantPlaceholderPage`
 *   （它的「规划内容」标题与说明是仅剩的两条硬编码）。应用中心重写与不可用态
 *   全部走 `t()`，没有新增。
 *
 * 2026-08-31 opera 1822 → 1868：产品退役闸门与「未登记产品的授权」报表
 *   （`opera/40-product-registry.md` §2 / §6）。产品目录页多出退役被拒的两条 Banner
 *   （409 带条数与样本、502 说明检查没做成）与对应 toast；权益配置页多出一整节报表
 *   （标题、说明、两条读取失败的 Banner、四列表头、行动作与确认文案、两种空态）和
 *   目录外产品码的详情兜底 Banner；`lifecycle.ts` 退役后果句加了前置说明。
 *   **没有走 `t()`，是有意的**：这两页全部文案都是硬编码中文、一条没抽（权益配置页
 *   124 条是本门户第三多的），只抽新加的这一节会造出半中英（同 08-29 / 08-30 的判据）。
 *
 * 2026-08-31 opera 1868 → 1871：`ops/health` 服务状态页加第三个中性态「不适用」
 *   （`opera/20-service-monitor.md` §4）：client 型产品（回调是 loopback）不探测，
 *   存活 / 就绪两列各一条词条，外加明细「客户端产品，无服务面」。与同页既有的
 *   「未接入」「未配置」一样硬编码——本页词条表 `LIVENESS_LABELS` / `READINESS_LABELS`
 *   整表都是字面量，单抽三条会造出半中英（同 08-30 的判据）。
 */
const BASELINE = {
  console: 30,
  website: 40,
  admin: 3226,
  opera: 1871,
  accounts: 264,
};

const CJK = '[\u4e00-\u9fff]';
const LITERAL = new RegExp(`"[^"\\n]*${CJK}[^"\\n]*"|\`[^\`\\n]*${CJK}[^\`\\n]*\``, 'g');
const JSX_TEXT = new RegExp(`>\\s*[^<>{}\\n]*${CJK}[^<>{}\\n]*?\\s*<`, 'g');

/** 挖空注释但保持行号——只数代码位置的中文。 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.next', 'dist'].includes(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (['.ts', '.tsx'].includes(extname(entry.name))) out.push(full);
  }
  return out;
}

function countPortal(name) {
  const src = join(PORTALS_DIR, name, 'src');
  if (!existsSync(src)) return null;
  let total = 0;
  const worst = [];
  for (const file of walk(src)) {
    const code = stripComments(readFileSync(file, 'utf8'));
    const n =
      (code.match(LITERAL) ?? []).length + (code.match(JSX_TEXT) ?? []).length;
    if (n) {
      total += n;
      worst.push({ n, file: file.slice(src.length + 1).replace(/\\/g, '/') });
    }
  }
  worst.sort((a, b) => b.n - a.n);
  return { total, files: worst.length, worst: worst.slice(0, 3) };
}

const findings = [];
const rows = [];

for (const [portal, baseline] of Object.entries(BASELINE)) {
  const r = countPortal(portal);
  if (!r) {
    findings.push(`${portal}: 门户目录不存在——BASELINE 里的条目该删了。`);
    continue;
  }
  rows.push({ portal, ...r, baseline });
  if (r.total > baseline) {
    findings.push(
      `${portal}: 硬编码中文 ${r.total} 条，超过基线 ${baseline}（多了 ${r.total - baseline}）。\n` +
        `         新写的界面文案要走 \`t()\`，不要直接写进代码。若这一批确实只增不减\n` +
        `         （比如整页新增且暂缓翻译），把 BASELINE.${portal} 改成 ${r.total} 并说明理由。\n` +
        `         串最多的文件：` +
        r.worst.map((w) => `${w.file}(${w.n})`).join('、'),
    );
  }
}

// 反向：抽完了没调数字。不报错，但要说出来——否则棘轮会松着不知道。
const stale = rows.filter((r) => r.total < r.baseline);

console.log('══ i18n 铺开棘轮（check-i18n-coverage）══');
for (const r of rows) {
  const delta = r.total - r.baseline;
  const mark = delta > 0 ? '✗' : delta < 0 ? '↓' : '·';
  console.log(
    `  ${mark} ${r.portal.padEnd(9)} ${String(r.total).padStart(5)} / ${String(r.baseline).padEnd(5)}` +
      `  (${r.files} 个文件)`,
  );
}

if (stale.length) {
  console.log('');
  for (const r of stale) {
    console.log(
      `  提示 ${r.portal}: 已降到 ${r.total}，基线还写着 ${r.baseline}——把 BASELINE 调下去，` +
        `棘轮才咬得住新增的那部分。`,
    );
  }
}

if (findings.length === 0) {
  console.log('✓ 未发现问题（没有门户超过基线）。');
} else {
  console.log('');
  for (const f of findings) console.log(`  ERROR  ${f}`);
  console.log('');
}

console.log('── 汇总 ──');
console.log(`error: ${findings.length}`);
process.exit(findings.length > 0 ? 1 : 0);
