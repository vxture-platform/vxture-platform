/**
 * seed-bulk.mjs — ④ BULK DATA seed（幂等，raw `pg`）。
 *
 * 前三份 seed 的分工：
 *   ① seed-catalog.mjs — 系统目录（RBAC、运营账号、oidc_clients、真实产品线）。可上生产。
 *   ② seed-sample.mjs  — 单个样例身份。
 *   ③ seed-demo.mjs    — **一张状态矩阵**：每个枚举至少一行，手写、可读、能对照。
 *   ④ 本文件           — **量**：每张表上百行，让分页、排序、筛选、虚拟滚动、
 *      计数卡、导出这些"只有数据多了才会露馅"的东西有东西可跑。
 *
 * 三份的取向不同，不要互相取代：demo 是"能不能看清一档长什么样"，bulk 是
 * "一百行堆在一起还成不成立"。demo 的行手写、每行有意义；本文件的行由确定性
 * 生成器铺出来，单行不必细看。
 *
 * **仅测试数据，默认拒绝在生产跑**（见 assertNotProduction）。
 *
 * 直接运行：
 *   DATABASE_URL=... node deploy/database/seed/seed-bulk.mjs
 *   pnpm db:seed:bulk
 *
 * ── 幂等 ──────────────────────────────────────────────────────────────────
 * 所有 id 落在 `00000000-0000-4000-c000-…` 段（catalog=a000、demo=b000，互不重叠），
 * 由行号确定性算出；每条 insert 带 `on conflict do nothing`。重复运行只补缺行。
 * **不用 `Math.random()`**——随机值会让每次运行都产生"新"数据，既不幂等，也无法
 * 在两次跑之间对照。所有"看起来随机"的取值都来自行号的确定性函数。
 *
 * ── 外键 ──────────────────────────────────────────────────────────────────
 * 租户、工作空间、用户、产品这些主体不由本文件造（demo/catalog 已经有了），运行时
 * 查出来轮转引用。查不到就跳过对应批次并告警——**不静默产出零行**。
 */

import { runSeed, isMain } from "./seed-lib.mjs";

// ── ID 段 ────────────────────────────────────────────────────────────────────
const uid = (n) => `00000000-0000-4000-c000-${String(n).padStart(12, "0")}`;

const ID = {
  product: (i) => uid(100000 + i),
  plan: (i) => uid(110000 + i),
  planVersion: (i) => uid(120000 + i),
  planPrice: (i) => uid(130000 + i),
  planComponent: (i) => uid(140000 + i),
  announcement: (i) => uid(200000 + i),
  featureFlag: (i) => uid(210000 + i),
  maintenance: (i) => uid(220000 + i),
  receipt: (i) => uid(230000 + i),
  transaction: (i) => uid(240000 + i),
  grant: (i) => uid(250000 + i),
  policy: (i) => uid(260000 + i),
  voucher: (i) => uid(270000 + i),
  redemption: (i) => uid(280000 + i),
  usageMonth: (i) => uid(290000 + i),
  renewal: (i) => uid(300000 + i),
  invitation: (i) => uid(310000 + i),
};

/** 每张表的目标行数。产品与套餐是**确定集**，其余按量铺。 */
const BULK = 100;

/**
 * 确定性"伪随机"：同一个 (i, salt) 永远得到同一个数。
 * 用它替代 Math.random()，让两次运行产生完全一致的数据。
 */
const pick = (arr, i, salt = 0) => arr[(i * 7 + salt * 13) % arr.length];
const spread = (i, mod, salt = 0) => (i * 31 + salt * 17) % mod;

// ── 测试产品线 ───────────────────────────────────────────────────────────────
// catalog seed 里那 6 个（arda/atlas/karda/runos/ruyin/umbra）是**真实产品线**，
// 本文件不碰。下面 12 个是编出来的测试产品，前缀统一 `demo-`，一眼可辨。
const TEST_PRODUCTS = [
  {
    code: "demo-insight",
    name: "洞察分析",
    type: "data_platform",
    desc: "多源数据接入与看板编排，面向运营的自助分析。",
  },
  {
    code: "demo-forge",
    name: "模型工坊",
    type: "model_platform",
    desc: "模型微调、评测与灰度发布的一站式工作台。",
  },
  {
    code: "demo-archive",
    name: "档案中枢",
    type: "knowledge_platform",
    desc: "非结构化文档的抽取、切分与检索增强。",
  },
  {
    code: "demo-sentry",
    name: "哨兵风控",
    type: "agent",
    desc: "交易与登录行为的实时风险判定智能体。",
  },
  {
    code: "demo-scribe",
    name: "纪要助手",
    type: "agent",
    desc: "会议录音转写、要点提炼与待办派发。",
  },
  {
    code: "demo-atlas-lite",
    name: "轻量模型网关",
    type: "model_platform",
    desc: "面向小团队的模型路由与配额管控。",
  },
  {
    code: "demo-relay",
    name: "消息中继",
    type: "external",
    desc: "对接三方 IM 与工单系统的消息通道。",
  },
  {
    code: "demo-vault",
    name: "凭据保险箱",
    type: "external",
    desc: "第三方 API 凭据的托管、轮换与审计。",
  },
  {
    code: "demo-canvas",
    name: "画布客户端",
    type: "client",
    desc: "桌面端可视化编排客户端。",
  },
  {
    code: "demo-pulse",
    name: "脉搏监测",
    type: "data_platform",
    desc: "服务健康与业务指标的统一观测面。",
  },
  {
    code: "demo-tutor",
    name: "培训教练",
    type: "agent",
    desc: "面向新员工的知识问答与考核智能体。",
  },
  {
    code: "demo-ledger",
    name: "账务对齐",
    type: "data_platform",
    desc: "多账套流水比对与差异归因。",
  },
];

/** 五档等级。每个产品（真实的 + 测试的）都补齐这五档。 */
const TIERS = [
  { tier: "free", label: "免费版", price: "0.00", cycle: "month" },
  { tier: "starter", label: "入门版", price: "199.00", cycle: "month" },
  { tier: "pro", label: "专业版", price: "999.00", cycle: "month" },
  { tier: "business", label: "商业版", price: "2999.00", cycle: "month" },
  { tier: "enterprise", label: "企业版", price: "9999.00", cycle: "year" },
];

/** 生产保护：bulk 数据进生产库是不可逆的污染，默认直接拒绝。 */
function assertNotProduction() {
  const allow = process.env.BULK_SEED_ALLOW_PRODUCTION === "true";
  if (process.env.NODE_ENV === "production" && !allow) {
    throw new Error(
      "seed-bulk 拒绝在 NODE_ENV=production 下运行（这是测试数据）。" +
        "确实需要时显式设置 BULK_SEED_ALLOW_PRODUCTION=true。",
    );
  }
}

const daysFromNow = (n) => `(now() + interval '${n} days')`;

async function seedBulk(client) {
  assertNotProduction();

  const counts = {};
  const bump = (k, n = 1) => (counts[k] = (counts[k] ?? 0) + n);
  const warn = [];

  // ── 运行时查出主体，轮转引用 ───────────────────────────────────────────────
  const tenants = (
    await client.query(
      "select id from tenancy.tenants where deleted_at is null order by created_at",
    )
  ).rows;
  const workspaces = (
    await client.query(
      "select id, tenant_id from tenancy.workspaces where deleted_at is null order by created_at",
    )
  ).rows;
  const users = (
    await client.query(
      "select id from account.users where deleted_at is null order by created_at",
    )
  ).rows;
  const operators = (
    await client.query(
      "select id from admin.operator_account order by created_at limit 5",
    )
  ).rows;
  const models = (
    await client.query("select id from model.models order by created_at")
  ).rows;
  const subs = (
    await client.query(
      "select id, tenant_id from metering.subscriptions order by created_at",
    )
  ).rows;

  if (!tenants.length || !workspaces.length || !users.length) {
    throw new Error(
      "seed-bulk 需要 tenancy.tenants / workspaces / account.users 先有数据——请先跑 seed-demo。",
    );
  }
  const operatorId = operators[0]?.id ?? null;
  const at = (arr, i) => arr[i % arr.length];

  // ── 1. 测试产品 ────────────────────────────────────────────────────────────
  for (const [i, p] of TEST_PRODUCTS.entries()) {
    await client.query(
      `insert into product.products
         (id, product_code, product_type, product_name, description, status,
          standalone_subscribable, is_customer_visible, is_workforce_visible, sort, created_at, updated_at)
       values ($1, $2, $3, $4, $5, 'active', true, true, true, $6, now(), now())
       on conflict (product_code) do nothing`,
      [ID.product(i + 1), p.code, p.type, p.name, p.desc, 100 + i],
    );
    bump("product.products");
  }

  // ── 2. 每个产品 × 五档套餐 ─────────────────────────────────────────────────
  // 真实产品线也补齐——"每个产品五档"是这次要验的形状，不区分真假。
  const allProducts = (
    await client.query(
      "select id, product_code from product.products where deleted_at is null order by product_code",
    )
  ).rows;

  let planSeq = 0;
  for (const prod of allProducts) {
    for (const t of TIERS) {
      planSeq += 1;
      const planCode = `${prod.product_code}-${t.tier}`;
      await client.query(
        `insert into product.plans
           (id, plan_code, plan_name, description, is_public, is_customer_visible,
            is_workforce_visible, status, created_at, updated_at)
         values ($1, $2, $3, $4, true, true, true, 'active', now(), now())
         on conflict (plan_code) do nothing`,
        [
          ID.plan(planSeq),
          planCode,
          `${prod.product_code} ${t.label}`,
          `${t.label}：demo 造数据`,
        ],
      );
      bump("product.plans");

      const planId = (
        await client.query(
          "select id from product.plans where plan_code = $1",
          [planCode],
        )
      ).rows[0]?.id;
      if (!planId) continue;
      // 该 plan_code 已被 catalog 占用（arda-free / arda-pro 这些是真实套餐）：
      // 它们的 plan_version 是 `is_locked`，往里加组件会被
      // `guard_locked_plan_component` 拒绝——也不该加，那是别人的数据。
      if (planId !== ID.plan(planSeq)) {
        bump("product.plans(已存在，跳过)");
        continue;
      }

      await client.query(
        `insert into product.plan_versions (id, plan_id, version_no, status, is_locked, created_at)
         values ($1, $2, 1, 'published', false, now())
         on conflict (plan_id, version_no) do nothing`,
        [ID.planVersion(planSeq), planId],
      );
      bump("product.plan_versions");

      const versionId = (
        await client.query(
          "select id from product.plan_versions where plan_id = $1 and version_no = 1",
          [planId],
        )
      ).rows[0]?.id;
      if (!versionId) continue;

      await client.query(
        `insert into product.plan_prices (id, plan_version_id, cycle_unit, cycle_count, price, currency, created_at)
         values ($1, $2, $3, 1, $4, 'CNY', now())
         on conflict (id) do nothing`,
        [ID.planPrice(planSeq), versionId, t.cycle, t.price],
      );
      bump("product.plan_prices");

      await client.query(
        `insert into product.plan_components
           (id, plan_version_id, product_id, tier, component_role, priority, sort_order, created_at)
         values ($1, $2, $3, $4, 'primary', 1, 1, now())
         on conflict (id) do nothing`,
        [ID.planComponent(planSeq), versionId, prod.id, t.tier],
      );
      bump("product.plan_components");

      await client.query(
        "update product.plans set current_version_id = $1 where id = $2 and current_version_id is null",
        [versionId, planId],
      );
    }
  }

  // ── 3. 公告 ────────────────────────────────────────────────────────────────
  // 值域取自 BFF 的 `ANNOUNCEMENT_TYPES`，不是随手编的四个词——
  // `mapAnnouncementRow` 对认不出的类型会**静默退回 `system`**，于是造错的值
  // 在界面上看起来一切正常，只是全都显示成"系统"（2026-08-06 第一版就是这么
  // 造的，50 行 release/policy 全被吞成 system）。造数据必须对着值域造。
  const ANN_TYPE = ["system", "maintenance", "marketing", "security"];
  const ANN_SEV = ["info", "warning", "critical"];
  const ANN_STATUS = ["draft", "published", "archived"];
  for (let i = 1; i <= BULK; i += 1) {
    await client.query(
      `insert into admin.announcements
         (id, announcement_type, severity, status, lang, title, content,
          is_dismissible, publish_at, expires_at, created_by, created_at, updated_at)
       values ($1, $2, $3, $4, 'zh-CN', $5, $6, true,
               ${daysFromNow(-spread(i, 90))}, ${daysFromNow(spread(i, 60, 3) + 1)}, $7, now(), now())
       on conflict (id) do nothing`,
      [
        ID.announcement(i),
        pick(ANN_TYPE, i),
        pick(ANN_SEV, i, 1),
        pick(ANN_STATUS, i, 2),
        `平台公告 #${i}：${pick(["版本发布", "计划维护", "活动推广", "安全提醒"], i)}`,
        `这是第 ${i} 条 bulk 造数据公告，用于验证列表分页与筛选。`,
        operatorId,
      ],
    );
    bump("admin.announcements");
  }

  // ── 4. 功能开关 ────────────────────────────────────────────────────────────
  const FLAG_CAT = ["billing", "identity", "model", "ui", "ops"];
  for (let i = 1; i <= BULK; i += 1) {
    await client.query(
      `insert into admin.feature_flags
         (id, flag_key, category, environment, description, is_globally_enabled,
          is_archived, rollout_percentage, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, now(), now())
       on conflict (id) do nothing`,
      [
        ID.featureFlag(i),
        `demo.flag_${String(i).padStart(3, "0")}`,
        pick(FLAG_CAT, i),
        pick(["dev", "staging", "production"], i, 1),
        `bulk 造数据开关 #${i}`,
        i % 3 === 0,
        i % 11 === 0,
        spread(i, 101, 5),
      ],
    );
    bump("admin.feature_flags");
  }

  // ── 5. 维护窗口 ────────────────────────────────────────────────────────────
  const MW_SEV = ["minor", "major", "critical"];
  const MW_STATUS = ["scheduled", "in_progress", "completed", "cancelled"];
  for (let i = 1; i <= BULK; i += 1) {
    const startOffset = spread(i, 120) - 60;
    await client.query(
      `insert into admin.maintenance_windows
         (id, severity, status, title, description, impact_description, affected_services,
          start_at, end_at, created_by, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7,
               ${daysFromNow(startOffset)}, ${daysFromNow(startOffset)} + interval '3 hours',
               $8, now(), now())
       on conflict (id) do nothing`,
      [
        ID.maintenance(i),
        pick(MW_SEV, i),
        pick(MW_STATUS, i, 1),
        `维护窗口 #${i}：${pick(["数据库升级", "网关切换", "模型节点扩容", "证书轮换"], i, 2)}`,
        `bulk 造数据维护窗口 #${i}。`,
        pick(["只读降级", "短暂不可用", "无影响", "部分接口延迟"], i, 3),
        [pick(["platform-api", "admin-bff", "gateway", "model-router"], i, 4)],
        operatorId,
      ],
    );
    bump("admin.maintenance_windows");
  }

  // ── 6. 发票台账 ────────────────────────────────────────────────────────────
  // 发票管理页读的是 `billing.invoice_receipts`（不是 billing.invoices）——
  // 这张表一直是空的，页面因此始终是空态（2026-08-06 走查确认）。
  const bills = (
    await client.query(
      "select id, tenant_id from billing.invoices order by created_at",
    )
  ).rows;
  if (!bills.length) {
    warn.push("billing.invoices 为空，跳过 invoice_receipts");
  } else {
    const RCP_TYPE = [
      "electronic_general",
      "electronic_special",
      "paper_special",
    ];
    const RCP_STATUS = [
      "applying",
      "approved",
      "issued",
      "sent",
      "rejected",
      "voided",
    ];
    for (let i = 1; i <= BULK; i += 1) {
      const bill = at(bills, i);
      const status = pick(RCP_STATUS, i, 1);
      const issued = ["issued", "sent"].includes(status);
      await client.query(
        `insert into billing.invoice_receipts
           (id, tenant_id, bill_id, invoice_no, invoice_type, invoice_tax_type, invoice_title,
            tax_no, company_info, invoice_amount, tax_amount, currency, invoice_status,
            invoice_code, express_company, express_no, issued_at, send_at,
            created_by_type, created_by_id, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'CNY', $12, $13, $14, $15,
                 ${issued ? daysFromNow(-spread(i, 30)) : "null"},
                 ${status === "sent" ? daysFromNow(-spread(i, 20)) : "null"},
                 'customer', $16, now(), now())
         on conflict (invoice_no) do nothing`,
        [
          ID.receipt(i),
          bill.tenant_id,
          bill.id,
          `DEMO-INV-${String(i).padStart(5, "0")}`,
          pick(RCP_TYPE, i),
          pick(["general", "special"], i, 2),
          `bulk 测试抬头 ${i} 有限公司`,
          `91310000MA${String(100000 + i).slice(0, 6)}X`,
          JSON.stringify({
            name: `bulk 测试抬头 ${i} 有限公司`,
            addr: "上海市浦东新区 demo 路 1 号",
          }),
          `${1000 + spread(i, 9000)}.00`,
          `${60 + spread(i, 500)}.00`,
          status,
          `0${String(3100000 + i)}`,
          status === "sent" ? pick(["顺丰", "京东", "EMS"], i, 3) : null,
          status === "sent" ? `SF${String(900000 + i)}` : null,
          at(users, i).id,
        ],
      );
      bump("billing.invoice_receipts");
    }
  }

  // ── 7. 资金流水 ────────────────────────────────────────────────────────────
  // 商业总览的「充值流水」读这张表；此前为空，那张卡永远是 ¥0.00。
  const TRADE = ["recharge", "consume", "refund", "grant", "adjust"];
  for (let i = 1; i <= BULK; i += 1) {
    const tenant = at(tenants, i);
    const amount = 100 + spread(i, 5000);
    const before = 10000 + spread(i, 50000, 2);
    const trade = pick(TRADE, i);
    const sign = ["consume", "refund"].includes(trade) ? -1 : 1;
    await client.query(
      `insert into billing.transactions
         (id, tenant_id, transaction_no, trade_type, source_method, amount, currency,
          balance_before, balance_after, trade_status, remark, actor_type, actor_id, created_at)
       values ($1, $2, $3, $4, $5, $6, 'CNY', $7, $8, $9, $10, $11, null, ${daysFromNow(-spread(i, 180))})
       on conflict (transaction_no) do nothing`,
      [
        ID.transaction(i),
        tenant.id,
        `DEMO-TXN-${String(i).padStart(5, "0")}`,
        trade,
        pick(
          ["online", "offline", "recharge_card", "credit_voucher", "operator"],
          i,
          1,
        ),
        `${amount}.00`,
        `${before}.00`,
        `${before + sign * amount}.00`,
        pick(["success", "pending", "failed"], i, 4),
        `bulk 造数据流水 #${i}`,
        pick(["system", "customer", "operator"], i, 5),
      ],
    );
    bump("billing.transactions");
  }

  // ── 8. 模型授权 / 模型策略 ─────────────────────────────────────────────────
  //
  // **这两张上不了一百行**，是结构上限不是造得不够：
  //   `uq_model_policies_model_tenant` 规定 (model_id, tenant_id) 唯一，
  //   6 个模型 × 5 个租户 = 30 条封顶（外加租户为 null 的平台级策略）。
  // 要更多只能先加模型或加租户。这里按组合铺满，`on conflict do nothing`
  // 兜住重复，不强行凑数。
  if (!models.length) {
    warn.push("model.models 为空，跳过 model_grants / model_policies");
  } else {
    const combos = models.length * tenants.length;
    for (let i = 1; i <= Math.min(BULK, combos); i += 1) {
      await client.query(
        `insert into model.model_grants
           (id, model_id, tenant_id, application_type, priority, is_active, reason,
            expires_at, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, ${i % 4 === 0 ? daysFromNow(spread(i, 200)) : "null"}, now(), now())
         on conflict do nothing`,
        [
          ID.grant(i),
          models[(i - 1) % models.length].id,
          tenants[Math.floor((i - 1) / models.length) % tenants.length].id,
          pick(["agent", "workflow", "api_client", "internal_service"], i),
          100 + spread(i, 400),
          i % 5 !== 0,
          `bulk 造数据授权 #${i}`,
        ],
      );
      bump("model.model_grants");

      await client.query(
        `insert into model.model_policies
           (id, model_id, tenant_id, name, priority, max_concurrent,
            rate_limit_rpm, rate_limit_tpm, max_context_tokens, is_active, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), now())
         on conflict do nothing`,
        [
          ID.policy(i),
          models[(i - 1) % models.length].id,
          tenants[Math.floor((i - 1) / models.length) % tenants.length].id,
          `bulk 策略 #${i}`,
          100 + spread(i, 400, 1),
          1 + spread(i, 16, 2),
          60 + spread(i, 600, 3),
          10000 + spread(i, 90000, 4),
          [8192, 16384, 32768, 128000][spread(i, 4, 5)],
          i % 7 !== 0,
        ],
      );
      bump("model.model_policies");
    }
  }

  // ── 9. 优惠券 + 核销 ───────────────────────────────────────────────────────
  const batch = (
    await client.query(
      "select id from promotion.voucher_batches order by created_at limit 1",
    )
  ).rows[0];
  if (!batch) {
    warn.push("promotion.voucher_batches 为空，跳过 vouchers / redemptions");
  } else {
    const KIND = [
      "credit_voucher",
      "recharge_card",
      "redemption",
      "discount",
      "extension",
    ];
    for (let i = 1; i <= BULK; i += 1) {
      await client.query(
        `insert into promotion.vouchers (id, batch_id, code, status, created_at)
         values ($1, $2, $3, 'redeemed', now())
         on conflict (code) do nothing`,
        [ID.voucher(i), batch.id, `DEMOBULK${String(i).padStart(6, "0")}`],
      );
      bump("promotion.vouchers");

      const ws = at(workspaces, i);
      await client.query(
        `insert into promotion.voucher_redemptions
           (id, redemption_no, voucher_id, tenant_id, workspace_id, user_id,
            kind, effect_snapshot, redeemed_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, ${daysFromNow(-spread(i, 150))})
         on conflict (id) do nothing`,
        [
          ID.redemption(i),
          // 对外编号：UUID 只走内部（DDL 56 表头）。序号取自 i，重跑同 i 得同号。
          `RDBULK${String(i).padStart(6, "0")}`,
          ID.voucher(i),
          ws.tenant_id,
          ws.id,
          at(users, i).id,
          pick(KIND, i),
          JSON.stringify({
            amount: 50 + spread(i, 500),
            note: `bulk 核销 #${i}`,
          }),
        ],
      );
      bump("promotion.voucher_redemptions");
    }
  }

  // 把核销行挂到同租户的账单明细与订阅上。
  //
  // 不挂的话整条链断在第一环：台账页的「优惠金额」走
  // `redemption.invoice_item_id → invoice_items.bill_id → invoices.discount_amount`，
  // 「关联订单」走 `subscription_id`，两列留空则整列 ¥0.00 + 「未关联订单」，
  // 而这正是这张台账要看的东西（2026-08-07 走查）。
  //
  // 按 tenant_id 关联而不是按序号：核销行由工作区推出租户，与主干种子的编号
  // 不一定同序，用 id 算术去猜会错配到别人的账单。
  await client.query(`
    update promotion.voucher_redemptions rd
       set invoice_item_id = pick.item_id,
           subscription_id = pick.sub_id
      from (
        -- distinct on 而不是 min()：Postgres 没有 min(uuid)。
        -- 排序里把 discount 明细排在前面，好让带折扣的账单优先被选中——
        -- 台账页的「优惠金额」读的正是该明细所属账单的 discount_amount。
        select distinct on (ii.tenant_id)
               ii.tenant_id,
               ii.id  as item_id,
               s.id   as sub_id
          from billing.invoice_items ii
          join metering.subscriptions s on s.tenant_id = ii.tenant_id
         order by ii.tenant_id, (ii.item_type <> 'discount'), ii.id
      ) pick
     where rd.tenant_id = pick.tenant_id
       and rd.invoice_item_id is null
       and rd.id::text like '00000000-0000-4000-c000-%'`);

  // ── 10. 用量月汇总 ─────────────────────────────────────────────────────────
  // 用量计费页读 `metering.usage_summary_months`；此前为空，页面无行可列。
  const METRICS = [
    "tokens_in",
    "tokens_out",
    "requests",
    "storage_gb",
    "seats",
  ];
  for (let i = 1; i <= BULK; i += 1) {
    const ws = at(workspaces, i);
    const prod = at(allProducts, i);
    const monthOffset = spread(i, 12);
    await client.query(
      `insert into metering.usage_summary_months
         (id, workspace_id, product_id, metric_key, period_month, total_amount, created_at, updated_at)
       values ($1, $2, $3, $4, to_char(now() - interval '${monthOffset} months', 'YYYY-MM'), $5, now(), now())
       on conflict (id) do nothing`,
      [
        ID.usageMonth(i),
        ws.id,
        prod.id,
        pick(METRICS, i),
        1000 + spread(i, 900000, 6),
      ],
    );
    bump("metering.usage_summary_months");
  }

  // ── 11. 续期任务 ───────────────────────────────────────────────────────────
  //
  // `uq_subscription_renewals_sub_cycle` 规定 (subscription_id, cycle_seq) 唯一，
  // 4 条订阅 × 25 个周期 = 100 条封顶。cycle_seq 按订阅分组递增，不用伪随机——
  // 续期周期本来就是连号的，随机取值会造出"第 7 期之后是第 3 期"这种不存在的历史。
  if (!subs.length) {
    warn.push("metering.subscriptions 为空，跳过 subscription_renewals");
  } else {
    const RSTATUS = [
      "pending",
      "processing",
      "succeeded",
      "failed",
      "dunning",
      "abandoned",
    ];
    for (let i = 1; i <= BULK; i += 1) {
      const sub = subs[(i - 1) % subs.length];
      const cycleSeq = Math.floor((i - 1) / subs.length) + 1;
      await client.query(
        `insert into metering.subscription_renewals
           (id, subscription_id, tenant_id, cycle_seq, scheduled_at, renewal_source, status,
            attempt_count, amount, created_at, updated_at)
         values ($1, $2, $3, $4, ${daysFromNow(spread(i, 60) - 30)}, $5, $6, $7, $8, now(), now())
         on conflict (id) do nothing`,
        [
          ID.renewal(i),
          sub.id,
          sub.tenant_id,
          cycleSeq,
          pick(["mandate", "balance", "manual"], i),
          pick(RSTATUS, i, 2),
          spread(i, 4),
          `${199 + spread(i, 3000)}.00`,
        ],
      );
      bump("metering.subscription_renewals");
    }
  }

  // ── 12. 邀请 ───────────────────────────────────────────────────────────────
  const role = (
    await client.query(
      "select id, scope from access.roles order by created_at limit 1",
    )
  ).rows[0];
  if (!role) {
    warn.push("access.roles 为空，跳过 invitations");
  } else {
    const ISTATUS = ["pending", "accepted", "expired", "revoked"];
    for (let i = 1; i <= BULK; i += 1) {
      const ws = at(workspaces, i);
      await client.query(
        `insert into tenancy.invitations
           (id, scope, tenant_id, workspace_id, target_type, target, role_id, role_scope,
            status, token_hash, expires_at, created_by, created_at, updated_at)
         values ($1, 'workspace', $2, $3, 'email', $4, $5, $6, $7, $8,
                 ${daysFromNow(spread(i, 30) - 10)}, $9, now(), now())
         on conflict (id) do nothing`,
        [
          ID.invitation(i),
          ws.tenant_id,
          ws.id,
          `bulk.invitee${String(i).padStart(3, "0")}@demo.test`,
          role.id,
          role.scope,
          pick(ISTATUS, i),
          `demo-token-hash-${String(i).padStart(6, "0")}`,
          at(users, i).id,
        ],
      );
      bump("tenancy.invitations");
    }
  }

  // ── 汇总 ───────────────────────────────────────────────────────────────────
  console.log("\n✓  bulk 数据就绪：");
  for (const k of Object.keys(counts).sort()) {
    console.log(`   ${String(counts[k]).padStart(5)}  ${k}`);
  }
  if (warn.length) {
    console.log("\n⚠  跳过的批次：");
    warn.forEach((w) => console.log(`   ${w}`));
  }
  console.log(
    "\n   全部 bulk 行的 id 都在 00000000-0000-4000-c000-… 段内（catalog=a000、demo=b000）。",
  );
  return counts;
}

if (isMain(import.meta.url)) {
  await runSeed("bulk", seedBulk);
}

export { seedBulk };
