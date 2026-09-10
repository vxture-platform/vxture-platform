#!/usr/bin/env node

/**
 * render-agent-map.mjs — 从产品登记渲染智能体的边缘路由表。
 *
 * 读 `product.product_webhooks.edge_upstream`，产出 nginx 的 map 数据行：
 *
 *     tenderforge.vxture.com 100.x.y.z:4050;
 *     yucer.vxture.com       100.x.y.z:4060;
 *
 * 这份文件被 `snippets/agent-upstream.conf` 里的 `map $host $vx_agent_upstream`
 * include。接一个智能体 = 运营者在 opera 产品目录里填「边缘上游」，然后跑一次同步。
 * 仓里不保存任何一行具体映射。
 *
 * ── 域名从哪来 ──
 * `{product_code}.vxture.com` 缺省规则（13-infra-allocation-registry §4#1）。
 * 异 apex 的产品（anlan.ai / xuanzhen.ai）不走这条兜底——它们的证书与本域通配证书
 * 无关，需要各自的 vhost。所以本脚本只渲染 `.vxture.com` 下的。
 *
 * ── 失败时怎么办：保留上一版，不写空表 ──
 * 读不到库就写出一个空表，后果是**所有已接入的智能体一起 444**——把一次读库失败
 * 放大成一次全线故障。所以：
 *   · 目标文件已存在 → 保留它，告警，退出码 0（同步流程继续，nginx 用旧表照常服务）；
 *   · 目标文件不存在（首次） → 写一个空表，让 `nginx -t` 能过（include 的文件必须存在），
 *     并告警。此时本来也没有任何智能体在服务。
 * 两种情况都**不中断部署**：边缘同步脚本还要渲其余十几份 vhost，为了一张可选的
 * 路由表把整条边缘同步掐掉，代价远大于收益。
 *
 * 用法：node render-agent-map.mjs <输出路径>
 * 环境：DATABASE_URL（与 seed 同一份 .env）
 */

import { writeFileSync, existsSync } from "node:fs";
import process from "node:process";

const OUT = process.argv[2];
if (!OUT) {
  console.error("用法：node render-agent-map.mjs <输出路径>");
  process.exit(2);
}

/** 读不到库时的处置：保留上一版；没有上一版就写空表。两种都不中断部署。 */
function degrade(why) {
  if (existsSync(OUT)) {
    console.warn(`  ⚠ 智能体路由表未能刷新（${why}）——保留上一版：${OUT}`);
    console.warn("    已接入的智能体照常服务；新登记的这次不会生效。");
  } else {
    writeFileSync(OUT, "# 渲染失败，空表占位（见告警）\n", "utf8");
    console.warn(`  ⚠ 智能体路由表渲染失败（${why}）——写出空表占位：${OUT}`);
    console.warn("    include 的文件必须存在，否则 nginx -t 直接失败。");
  }
  process.exit(0);
}

const url = process.env.DATABASE_URL;
if (!url) degrade("DATABASE_URL 未设置");

/*
 * 用 `createRequire` 而不是 `await import("pg")`。
 *
 * 这不是风格选择:部署时 pg 装在 `/tmp/vxture-db/node_modules` 并靠 `NODE_PATH`
 * 指过去(与 seed 同一手法),而 **NODE_PATH 是 CJS 的机制,ESM 的 import() 不认它**。
 * 用 import() 的话,渲染器在生产上会**每次都走降级分支**——而降级是退出码 0 + 一句
 * 告警,部署照常绿,边缘永远没有任何一个智能体被渲进去。
 * 本地按容器的形态跑过才发现:直接 `node` 跑一次,报的就是「pg 模块不可用」。
 */
const { createRequire } = await import("node:module");
const require_ = createRequire(import.meta.url);
let Client;
try {
  ({ Client } = require_("pg"));
} catch {
  degrade("pg 模块不可用");
}

const client = new Client({ connectionString: url });
let rows;
try {
  await client.connect();
  /* 只取**已登记边缘上游**且产品未软删的行。status 不筛：一个停用的产品
     仍然可能需要边缘可达（运营者正在排障），停不停用是产品目录的语义，
     不是路由的语义——真要断路由，把 edge_upstream 清空就是了。 */
  const r = await client.query(
    `select p.product_code, w.edge_upstream
       from product.product_webhooks w
       join product.products p on p.id = w.product_id
      where w.edge_upstream is not null
        and w.edge_upstream <> ''
        and p.deleted_at is null
      order by p.product_code`,
  );
  rows = r.rows;
} catch (e) {
  await client.end().catch(() => undefined);
  degrade(`读库失败：${e.message}`);
} finally {
  await client.end().catch(() => undefined);
}

/* 形状再校验一次。库上有 CHECK，但这份产物直接进 nginx 配置——
   一个带空格或分号的值会让 nginx -t 失败，而那时人已经离开登记现场了。
   这里拒绝掉并点名是哪一行，比让 nginx 报一句语法错有用得多。 */
const SHAPE = /^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?:[0-9]{1,5}$/;
const lines = [];
const rejected = [];
for (const { product_code: code, edge_upstream: up } of rows) {
  if (!SHAPE.test(up)) {
    rejected.push(`${code} → ${JSON.stringify(up)}`);
    continue;
  }
  lines.push(`${code}.vxture.com ${up};`);
}

if (rejected.length) {
  console.warn(`  ⚠ ${rejected.length} 条边缘上游形状不合法，已跳过：`);
  for (const r of rejected) console.warn(`      ${r}`);
}

const body = [
  "# 由 deploy/nginx/render-agent-map.mjs 从产品登记生成——**不要手改**。",
  "# 改动入口：opera → 产品目录 → 该产品 → 边缘上游。",
  `# 生成于 ${new Date().toISOString()}，共 ${lines.length} 条。`,
  ...lines,
  "",
].join("\n");

writeFileSync(OUT, body, "utf8");
console.log(`  渲染智能体路由表 → ${OUT}（${lines.length} 条）`);
for (const l of lines) console.log(`      ${l}`);
