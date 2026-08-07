/**
 * seed-demo.mjs — ③ DEMO DATA seed（幂等，raw `pg`）。
 *
 * 给本地/联调环境铺一套**能把界面跑满**的业务数据：租户、订阅、账单、收款、
 * 配额、风控与合规事件、工单、通知流水、优惠券。目标不是"有几行数据"，而是
 * **每个状态枚举至少有一行落在上面**——列表页的筛选、状态色、空态、异常标记
 * 只有在有对应数据时才验得动。
 *
 * 与另外两份 seed 的分工：
 *   ① seed-catalog.mjs — 系统目录（RBAC、运营账号、oidc_clients、产品/套餐/模型
 *      目录）。可用于生产。**本文件不重复造产品与套餐**，只按 plan_code 引用它
 *      已经建好的已发布版本；缺哪个套餐就跳过对应租户并告警。
 *   ② seed-sample.mjs  — 单个样例身份（zhangsan + 个人租户 + 默认工作空间）。
 *   ③ 本文件          — 多租户业务数据矩阵。
 *
 * **仅测试数据，默认拒绝在生产跑**（见 assertNotProduction）。
 *
 * 直接运行：
 *   DATABASE_URL=... node deploy/database/seed/seed-demo.mjs
 *   pnpm db:seed:demo
 *
 * 幂等做法：所有 id 都是本文件写死的固定 UUID（`…-b000-…` 段，与 catalog 的
 * `…-a000-…` 段不重叠），每条 insert 都带 `on conflict do nothing`。重复运行
 * 只会补齐缺失的行，不会翻倍，也不会覆盖你在界面上手工改过的数据——**这一点是
 * 刻意的**：调试时经常要手动把某张单子改成另一个状态，再跑一次 seed 不该把它
 * 打回原样。要回到出厂状态就先删掉 demo 数据（见文件末尾的清理 SQL）。
 */

import { runSeed, isMain } from './seed-lib.mjs';

// ── 固定 UUID 段（幂等的基础）────────────────────────────────────────────────
// 全部 demo 行都落在 `00000000-0000-4000-b000-…` 下，一眼可辨、也方便整段清理。
const uid = (n) => `00000000-0000-4000-b000-${String(n).padStart(12, '0')}`;

const ID = {
  user: (i) => uid(1000 + i),
  tenant: (i) => uid(2000 + i),
  workspace: (i) => uid(3000 + i),
  tenantMem: (i) => uid(4000 + i),
  wsMem: (i) => uid(5000 + i),
  kyc: (i) => uid(6000 + i),
  subscription: (i) => uid(7000 + i),
  quotaPool: (i) => uid(8000 + i),
  invoice: (i) => uid(9000 + i),
  invoiceItem: (i) => uid(10000 + i),
  payment: (i) => uid(11000 + i),
  subHistory: (i) => uid(12000 + i),
  risk: (i) => uid(13000 + i),
  compliance: (i) => uid(14000 + i),
  ticket: (i) => uid(15000 + i),
  ticketComment: (i) => uid(16000 + i),
  notification: (i) => uid(17000 + i),
  voucherBatch: (i) => uid(18000 + i),
  voucher: (i) => uid(18100 + i),
  // 枚举覆盖行另开段，不与"每租户一条"的段位重叠
  coverInvoice: (i) => uid(19000 + i),
  coverPayment: (i) => uid(19100 + i),
};

/**
 * 租户矩阵。四行刻意铺开不同的**组合**，而不是四个相似的健康租户：
 *
 *   #1 acme    企业 · 已认证 · 年付 Pro     · 账单已付   · 无风险
 *   #2 globex  企业 · 认证待审 · 月付 Business · 账单逾期 · 高风险 + 合规事件
 *   #3 initech 企业 · 认证被拒 · 已取消订阅  · 账单作废   · 跟进级风险
 *   #4 wangwu  个人 · 未认证   · 免费版      · 无账单     · 无风险
 *
 * 这样"逾期""作废""被拒""个人租户无账单"这些平时最难造的分支都各有一行。
 */
const TENANTS = [
  {
    i: 1,
    account: 'demo_acme',
    name: '示例科技（Acme）',
    email: 'ops@acme.demo',
    phone: '+8613900000001',
    ownerName: '陈立',
    type: 'organization',
    status: 'active',
    verification: 'verified',
    verificationType: 'enterprise',
    industry: '互联网',
    scale: '100-499',
    planCode: 'arda-pro',
    sub: {
      kind: 'paid',
      status: 'active',
      cycleUnit: 'year',
      cycleCount: 1,
      autoRenew: true,
      activation: 'online_purchase',
      amount: '11988.00',
      startMonthsAgo: 5,
      endMonthsAhead: 7,
    },
    bill: { status: 'paid', amount: '11988.00', discount: '1200.00', paid: true, source: 'online' },
  },
  {
    i: 2,
    account: 'demo_globex',
    name: '环宇数据（Globex）',
    email: 'finance@globex.demo',
    phone: '+8613900000002',
    ownerName: '赵敏',
    type: 'organization',
    status: 'active',
    verification: 'pending',
    verificationType: 'enterprise',
    industry: '金融',
    scale: '500+',
    planCode: 'arda-business',
    sub: {
      kind: 'paid',
      status: 'overdue',
      cycleUnit: 'month',
      cycleCount: 1,
      autoRenew: true,
      activation: 'offline_purchase',
      amount: '2999.00',
      startMonthsAgo: 3,
      endMonthsAhead: -1, // 已过期未续 → 逾期
    },
    bill: { status: 'overdue', amount: '2999.00', discount: '0.00', paid: false, source: 'offline' },
  },
  {
    i: 3,
    account: 'demo_initech',
    name: '英特科（Initech）',
    email: 'admin@initech.demo',
    phone: '+8613900000003',
    ownerName: '孙浩',
    type: 'organization',
    status: 'suspended',
    verification: 'rejected',
    verificationType: 'enterprise',
    industry: '制造',
    scale: '20-99',
    planCode: 'arda-starter',
    sub: {
      kind: 'paid',
      status: 'cancelled',
      cycleUnit: 'month',
      cycleCount: 1,
      autoRenew: false,
      activation: 'offline_purchase',
      amount: '599.00',
      startMonthsAgo: 8,
      endMonthsAhead: -4,
    },
    bill: { status: 'cancelled', amount: '599.00', discount: '0.00', paid: false, source: 'offline' },
  },
  {
    i: 4,
    account: 'demo_wangwu',
    name: '王五',
    email: 'wangwu@vxture.demo',
    phone: '+8613900000004',
    ownerName: '王五',
    type: 'personal',
    status: 'active',
    verification: 'unverified',
    verificationType: 'individual',
    industry: '个人开发者',
    scale: '1-19',
    planCode: 'arda-free',
    sub: {
      kind: 'free',
      status: 'active',
      cycleUnit: 'perpetual',
      cycleCount: 1,
      autoRenew: false,
      activation: 'free',
      amount: '0.00',
      startMonthsAgo: 2,
      endMonthsAhead: null, // perpetual 必须 end_at 为空（chk_subscriptions_perpetual_open）
    },
    bill: null,
  },
];

/** 生产保护：demo 数据进生产库是不可逆的污染，默认直接拒绝。 */
function assertNotProduction() {
  const allow = process.env.DEMO_SEED_ALLOW_PRODUCTION === 'true';
  if (process.env.NODE_ENV === 'production' && !allow) {
    throw new Error(
      'seed-demo 拒绝在 NODE_ENV=production 下运行（这是测试数据）。' +
        '确实需要时显式设置 DEMO_SEED_ALLOW_PRODUCTION=true。',
    );
  }
}

/**
 * `n` 个月前/后的 SQL 表达式片段，避免在 JS 里算日期又要处理时区。
 * **必须带外层括号**：调用点会接 `::date`，而 `now() + interval 'x'::date`
 * 里的类型转换会绑到 interval 上（`cannot cast type interval to date`），
 * 不是绑到整个加法表达式。
 */
const monthsFromNow = (n) => `(now() + interval '${n} months')`;

export async function seedDemo(client) {
  assertNotProduction();

  // ── 0. 前置：治理角色（成员关系的复合外键目标）与套餐版本 ──────────────────
  const roleRows = await client.query(
    `select id, scope from access.roles where role_code = 'owner' and scope in ('tenant','workspace')`,
  );
  const tenantOwnerRoleId = roleRows.rows.find((r) => r.scope === 'tenant')?.id;
  const wsOwnerRoleId = roleRows.rows.find((r) => r.scope === 'workspace')?.id;
  if (!tenantOwnerRoleId || !wsOwnerRoleId) {
    throw new Error(
      'access.roles 里找不到 owner 角色 —— 先跑 seed-catalog.mjs。' +
        '成员关系带 (role_id, role_scope) → access.roles(id, scope) 的复合外键。',
    );
  }

  /* 套餐版本按 plan_code 查**已发布**版本。目录归 seed-catalog 管，这里只引用：
     同一份套餐在两处各建一遍必然分叉，而分叉出来的那份不会有人去改。 */
  const planRows = await client.query(`
    select p.plan_code, v.id as version_id
    from product.plans p
    join product.plan_versions v on v.plan_id = p.id and v.status = 'published'
    where p.deleted_at is null
  `);
  const planVersionByCode = new Map(
    planRows.rows.map((r) => [r.plan_code, r.version_id]),
  );

  const ardaRes = await client.query(
    `select id from product.products where product_code = 'arda' limit 1`,
  );
  const ardaProductId = ardaRes.rows[0]?.id;
  if (!ardaProductId) {
    throw new Error("product.products 里找不到 'arda' —— 先跑 seed-catalog.mjs。");
  }

  const stats = {};
  const bump = (k, n = 1) => (stats[k] = (stats[k] ?? 0) + n);

  // ── 1. 用户 + 资料 + 积分 ──────────────────────────────────────────────────
  /* 刻意**不写 credential.user_credentials**：这些是演示账号，仓库里不该带任何
     可登录的口令。需要真人登录时用 seed-sample 的 zhangsan（口令走运行时密钥）。 */
  for (const t of TENANTS) {
    await client.query(
      `insert into account.users
         (id, account, email, email_verified_at, phone, phone_verified_at, status, created_at, updated_at)
       values ($1, $2, $3, now(), $4, now(), 'active', now(), now())
       on conflict (account) do nothing`,
      [ID.user(t.i), t.account, t.email, t.phone],
    );
    await client.query(
      `insert into account.user_profiles
         (user_id, display_name, gender, bio, language, timezone, theme, created_at, updated_at)
       values ($1, $2, 'unknown', 'Demo 数据，供本地联调使用。', 'zh-CN', 'Asia/Shanghai', 'system', now(), now())
       on conflict (user_id) do nothing`,
      [ID.user(t.i), t.ownerName],
    );
    await client.query(
      `insert into loyalty.user_points (user_id, total_points, updated_at)
       values ($1, $2, now()) on conflict (user_id) do nothing`,
      [ID.user(t.i), t.i * 120],
    );
    bump('account.users');
  }

  // ── 2. 租户 + 资料 + 联系人 + 工作空间 + 成员关系 ──────────────────────────
  for (const t of TENANTS) {
    await client.query(
      `insert into tenancy.tenants
         (id, name, type, owner_user_id, status, verification_status, verification_type, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, ${monthsFromNow(-t.sub.startMonthsAgo - 1)}, now())
       on conflict (id) do nothing`,
      [ID.tenant(t.i), t.name, t.type, ID.user(t.i), t.status, t.verification, t.verificationType],
    );
    await client.query(
      `insert into tenancy.tenant_profiles
         (tenant_id, description, industry, scale, country_code, timezone, language, currency, is_billing_recipient, created_at, updated_at)
       values ($1, $2, $3, $4, 'CN', 'Asia/Shanghai', 'zh-CN', 'CNY', true, now(), now())
       on conflict (tenant_id) do nothing`,
      [ID.tenant(t.i), `${t.name} · Demo 租户`, t.industry, t.scale],
    );
    // 唯一键是 (tenant_id, contact_type, email)，所以这里按自然键幂等。
    await client.query(
      `insert into tenancy.tenant_contacts
         (tenant_id, contact_type, name, title, email, phone, user_id, created_at, updated_at)
       values ($1, 'primary', $2, '管理员', $3, $4, $5, now(), now())
       on conflict (tenant_id, contact_type, email) do nothing`,
      [ID.tenant(t.i), t.ownerName, t.email, t.phone, ID.user(t.i)],
    );
    await client.query(
      `insert into tenancy.workspaces (id, tenant_id, name, is_default, status, created_at, updated_at)
       values ($1, $2, '默认工作空间', true, 'active', now(), now())
       on conflict (id) do nothing`,
      [ID.workspace(t.i), ID.tenant(t.i)],
    );
    // 租户成员必须先于工作空间成员：后者有 (tenant_id,user_id) → 前者的复合外键。
    await client.query(
      `insert into tenancy.tenant_memberships
         (id, tenant_id, user_id, role_id, role_scope, status, created_at, updated_at)
       values ($1, $2, $3, $4, 'tenant', 'active', now(), now())
       on conflict (tenant_id, user_id) do nothing`,
      [ID.tenantMem(t.i), ID.tenant(t.i), ID.user(t.i), tenantOwnerRoleId],
    );
    await client.query(
      `insert into tenancy.workspace_memberships
         (id, workspace_id, tenant_id, user_id, role_id, role_scope, status, created_at, updated_at)
       values ($1, $2, $3, $4, $5, 'workspace', 'active', now(), now())
       on conflict (workspace_id, user_id) do nothing`,
      [ID.wsMem(t.i), ID.workspace(t.i), ID.tenant(t.i), ID.user(t.i), wsOwnerRoleId],
    );
    bump('tenancy.tenants');
  }

  // ── 3. 实名认证记录（四种状态各一）────────────────────────────────────────
  for (const t of TENANTS) {
    const reviewed = t.verification === 'verified' || t.verification === 'rejected';
    await client.query(
      `insert into kyc.tenant_verifications
         (id, tenant_id, verification_type, business_license_no, legal_person_name,
          status, reviewed_at, reject_reason, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, ${reviewed ? 'now()' : 'null'}, $7, ${monthsFromNow(-t.sub.startMonthsAgo)}, now())
       on conflict (id) do nothing`,
      [
        ID.kyc(t.i),
        ID.tenant(t.i),
        t.verificationType,
        t.type === 'organization' ? `91310000DEMO${t.i}00X` : null,
        t.ownerName,
        t.verification,
        t.verification === 'rejected' ? '营业执照影像模糊，请重新上传。' : null,
      ],
    );
    bump('kyc.tenant_verifications');
  }

  // ── 4. 订阅 + 变更历史 + 配额池 ────────────────────────────────────────────
  const skippedPlans = [];
  for (const t of TENANTS) {
    const planVersionId = planVersionByCode.get(t.planCode);
    if (!planVersionId) {
      // 目录里没有这个已发布版本 → 跳过订阅链路，但租户本身仍然建好。
      skippedPlans.push(`${t.account} → ${t.planCode}`);
      continue;
    }
    const s = t.sub;
    const endExpr = s.endMonthsAhead === null ? 'null' : monthsFromNow(s.endMonthsAhead);
    await client.query(
      `insert into metering.subscriptions
         (id, tenant_id, workspace_id, plan_version_id, subscription_kind, cycle_unit, cycle_count,
          start_at, end_at, status, auto_renew, activation_method, order_no, pay_amount, currency,
          created_by_type, created_by_id, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7,
               ${monthsFromNow(-s.startMonthsAgo)}, ${endExpr}, $8, $9, $10, $11, $12, 'CNY',
               $13, $14, ${monthsFromNow(-s.startMonthsAgo)}, now())
       on conflict (id) do nothing`,
      [
        ID.subscription(t.i), ID.tenant(t.i), ID.workspace(t.i), planVersionId,
        s.kind, s.cycleUnit, s.cycleCount, s.status, s.autoRenew, s.activation,
        `DEMO-ORD-${String(t.i).padStart(4, '0')}`, s.amount,
        s.activation === 'offline_purchase' ? 'operator' : 'customer',
        s.activation === 'offline_purchase' ? null : ID.user(t.i),
      ],
    );
    bump('metering.subscriptions');

    // 开通一条历史；已取消的再补一条取消历史，让"变更记录"页面有两种事件。
    await client.query(
      `insert into metering.subscription_histories
         (id, tenant_id, subscription_id, change_type, to_plan_version_id, to_status, actor_type, actor_id, remark, created_at)
       values ($1, $2, $3, 'create', $4, $5, $6, $7, '开通订阅（demo）', ${monthsFromNow(-s.startMonthsAgo)})
       on conflict (id) do nothing`,
      [
        ID.subHistory(t.i), ID.tenant(t.i), ID.subscription(t.i), planVersionId, s.status,
        s.activation === 'offline_purchase' ? 'operator' : 'customer',
        s.activation === 'offline_purchase' ? null : ID.user(t.i),
      ],
    );
    if (s.status === 'cancelled') {
      await client.query(
        `insert into metering.subscription_histories
           (id, tenant_id, subscription_id, change_type, to_status, actor_type, remark, created_at)
         values ($1, $2, $3, 'cancel', 'cancelled', 'operator', '客户申请退订（demo）', ${monthsFromNow(s.endMonthsAhead)})
         on conflict (id) do nothing`,
        [ID.subHistory(100 + t.i), ID.tenant(t.i), ID.subscription(t.i)],
      );
    }
    bump('metering.subscription_histories');

    /* 配额池：每个订阅两条（AI 额度按月重置 + API 调用不重置），用量各不相同，
       这样"用尽/过半/未用"三种进度条都能看到。 */
    const pools = [
      { n: t.i * 2 - 1, metric: 'ai.credit', limit: 500 * t.i, used: Math.round(500 * t.i * (t.i === 2 ? 0.98 : 0.35)), reset: 'month' },
      { n: t.i * 2, metric: 'service.api.call', limit: 200000, used: t.i === 4 ? 0 : 20000 * t.i, reset: 'none' },
    ];
    for (const p of pools) {
      const periodCols =
        p.reset === 'none'
          ? { anchor: 'null', start: 'null' }
          : { anchor: `date_trunc('month', now())`, start: `date_trunc('month', now())` };
      await client.query(
        `insert into metering.quota_pools
           (id, workspace_id, subscription_id, product_id, metric_key, quota_limit, quota_used,
            component_role, pool_source, reset_period, period_anchor, current_period_start,
            status, effective_at, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, 'primary', 'subscription', $8,
                 ${periodCols.anchor}, ${periodCols.start}, 'active', now(), now(), now())
         on conflict (id) do nothing`,
        [ID.quotaPool(p.n), ID.workspace(t.i), ID.subscription(t.i), ardaProductId,
         p.metric, p.limit, p.used, p.reset],
      );
      bump('metering.quota_pools');
    }
  }
  if (skippedPlans.length) {
    console.warn(
      `⚠  以下套餐在目录里没有已发布版本，对应订阅已跳过：${skippedPlans.join('、')}。` +
        '（先跑 seed-catalog.mjs，或把套餐版本发布出来。）',
    );
  }

  // ── 5. 账单 + 明细 + 收款 ──────────────────────────────────────────────────
  for (const t of TENANTS) {
    if (!t.bill || !planVersionByCode.get(t.planCode)) continue;
    const b = t.bill;
    const payable = (Number(b.amount) - Number(b.discount)).toFixed(2);
    await client.query(
      `insert into billing.invoices
         (id, tenant_id, bill_no, subscription_id, bill_cycle, cycle_start_date, cycle_end_date,
          total_amount, discount_amount, payable_amount, paid_amount, currency,
          bill_status, bill_type, paid_at, payment_method, transaction_no,
          created_by_type, created_by_id, operate_remark, created_at, updated_at)
       values ($1, $2, $3, $4, $5, ${monthsFromNow(-t.sub.startMonthsAgo)}::date, ${monthsFromNow(-t.sub.startMonthsAgo + 1)}::date,
               $6, $7, $8, $9, 'CNY', $10, 'normal',
               ${b.paid ? 'now()' : 'null'}, $11, $12, 'system', null, $13, ${monthsFromNow(-t.sub.startMonthsAgo)}, now())
       on conflict (bill_no) do nothing`,
      [
        ID.invoice(t.i), ID.tenant(t.i), `DEMO-BILL-${String(t.i).padStart(4, '0')}`,
        ID.subscription(t.i), t.sub.cycleUnit === 'year' ? 'yearly' : 'monthly',
        b.amount, b.discount, payable, b.paid ? payable : '0.00', b.status,
        b.paid ? (b.source === 'offline' ? 'bank_transfer' : 'alipay') : null,
        b.paid ? `DEMO-TXN-${String(t.i).padStart(4, '0')}` : null,
        b.status === 'cancelled' ? '客户退订后作废（demo）' :
          b.status === 'overdue' ? '已逾期，等待客户回款（demo）' : null,
      ],
    );
    bump('billing.invoices');

    // 明细两条：订阅费 + 折扣（折扣为负数，让"减免"分支有数据）。
    await client.query(
      `insert into billing.invoice_items
         (id, bill_id, tenant_id, workspace_id, subscription_id, item_name, item_type,
          item_unit, quantity, unit_price, total_amount, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, 'subscription_fee', '期', 1, $7, $7, now(), now())
       on conflict (id) do nothing`,
      [ID.invoiceItem(t.i * 2 - 1), ID.invoice(t.i), ID.tenant(t.i), ID.workspace(t.i),
       ID.subscription(t.i), `${t.planCode} 订阅费`, b.amount],
    );
    bump('billing.invoice_items');
    if (Number(b.discount) > 0) {
      await client.query(
        `insert into billing.invoice_items
           (id, bill_id, tenant_id, workspace_id, subscription_id, item_name, item_type,
            item_unit, quantity, unit_price, total_amount, created_at, updated_at)
         values ($1, $2, $3, $4, $5, '年付优惠', 'discount', '次', 1, $6, $6, now(), now())
         on conflict (id) do nothing`,
        [ID.invoiceItem(t.i * 2), ID.invoice(t.i), ID.tenant(t.i), ID.workspace(t.i),
         ID.subscription(t.i), `-${b.discount}`],
      );
      bump('billing.invoice_items');
    }

    // 收款流水：已付的记 paid，线下未付的记 pending_verify（"线下待核"分支）。
    if (b.paid || b.source === 'offline') {
      await client.query(
        `insert into billing.payments
           (id, tenant_id, bill_id, pay_order_no, pay_source, pay_channel, pay_method,
            offline_pay_type, offline_payer_name, offline_pay_time,
            total_amount, paid_amount, currency, pay_status, paid_at,
            actor_type, actor_id, operate_remark, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, ${b.source === 'offline' ? monthsFromNow(-1) : 'null'},
                 $10, $11, 'CNY', $12, ${b.paid ? 'now()' : 'null'}, $13, null, $14, now(), now())
         on conflict (pay_order_no) do nothing`,
        [
          ID.payment(t.i), ID.tenant(t.i), ID.invoice(t.i),
          `DEMO-PAY-${String(t.i).padStart(4, '0')}`,
          b.source, b.source === 'offline' ? null : 'alipay',
          b.source === 'offline' ? null : 'alipay',
          b.source === 'offline' ? 'bank_transfer' : null,
          b.source === 'offline' ? t.name : null,
          payable, b.paid ? payable : '0.00',
          b.paid ? 'paid' : 'pending_verify',
          b.source === 'offline' ? 'operator' : 'customer',
          b.paid ? null : '线下转账凭证待财务核销（demo）',
        ],
      );
      bump('billing.payments');
    }
  }


  // ── 5b. 枚举覆盖：把 per-tenant 那一轮铺不到的状态补齐 ──────────────────────
  //
  // 上面每个租户只产出一张账单、一条收款，能落到的状态就那么几个
  // （paid / overdue / cancelled，收款 paid / pending_verify）。而列表页的状态色、
  // 筛选、语气分档要验，得**每一档都有行**——2026-08-06 的登录态走查就卡在这里：
  // 刚把发票的"申请中/审核中/寄送中"从黄改成蓝、账单"支付中"改成蓝，库里一行都没有，
  // 改完看不见。
  //
  // 这些行不挂新租户（新租户要连带 workspace / membership / 认证，成本高且会让上面
  // 那张"四种典型组合"的表失真），而是复用既有租户，只补账单与收款本身。
  const COVER_BILLS = [
    { n: 1, t: 1, status: 'unpaid',  amount: '1200.00', paid: '0.00',    remark: '账期内待付（demo 枚举覆盖）' },
    { n: 2, t: 1, status: 'paying',  amount: '860.00',  paid: '0.00',    remark: '在线支付进行中（demo 枚举覆盖）' },
    { n: 3, t: 2, status: 'partial', amount: '2400.00', paid: '900.00',  remark: '部分收款，余额待补（demo 枚举覆盖）' },
  ];
  for (const b of COVER_BILLS) {
    await client.query(
      `insert into billing.invoices
         (id, tenant_id, bill_no, subscription_id, bill_cycle, cycle_start_date, cycle_end_date,
          total_amount, discount_amount, payable_amount, paid_amount, currency,
          bill_status, bill_type, payment_method, created_by_type, created_by_id,
          operate_remark, created_at, updated_at)
       values ($1, $2, $3, $4, 'monthly', ${monthsFromNow(-1)}::date, ${monthsFromNow(0)}::date,
               $5, '0.00', $5, $6, 'CNY', $7, 'normal', null, 'system', null, $8, ${monthsFromNow(-1)}, now())
       on conflict (bill_no) do nothing`,
      [
        ID.coverInvoice(b.n), ID.tenant(b.t), `DEMO-BILL-C${String(b.n).padStart(3, '0')}`,
        ID.subscription(b.t), b.amount, b.paid, b.status, b.remark,
      ],
    );
    bump('billing.invoices');
  }

  // 收款态：`chk_payments_pay_status` 只认 6 档
  //   pending · pending_verify · paid · failed · closed · refunding
  // per-tenant 那轮出了 paid 与 pending_verify，这里补齐剩下四档。
  //
  // **admin 的 `OrderPaymentStatus` 比这多三个**——`not_required` / `unpaid` /
  // `partial`。那三个进不了收款表（DB 直接 CHECK 拒绝，2026-08-06 造数据时撞到）。
  // 原因是那个类型被两个域共用：**订单**的支付状态可以是"无需支付/未支付/部分支付"，
  // **收款流水**只有六种。它们不是一回事，共用一个类型迟早出岔子——记在 TD #33
  // 的值域对齐里，本文件不替它决定。
  const COVER_PAYMENTS = [
    { n: 1, t: 1, bill: 1, status: 'pending',   amount: '1200.00', paid: '0.00',   remark: '支付中，等待渠道回调（demo）' },
    { n: 3, t: 1, bill: 2, status: 'failed',    amount: '860.00',  paid: '0.00',   remark: '渠道返回失败（demo）' },
    { n: 4, t: 1, bill: 2, status: 'refunding', amount: '860.00',  paid: '860.00', remark: '客户申请退款，处理中（demo）' },
    { n: 5, t: 2, bill: 3, status: 'closed',    amount: '2400.00', paid: '0.00',   remark: '超时未支付自动关闭（demo）' },
  ];
  for (const p of COVER_PAYMENTS) {
    await client.query(
      `insert into billing.payments
         (id, tenant_id, bill_id, pay_order_no, pay_source, pay_channel, pay_method,
          total_amount, paid_amount, currency, pay_status, paid_at,
          actor_type, actor_id, operate_remark, created_at, updated_at)
       values ($1, $2, $3, $4, 'online', 'alipay', 'alipay', $5, $6, 'CNY', $7,
               ${p.status === 'refunding' ? monthsFromNow(-1) : 'null'},
               'customer', null, $8, ${monthsFromNow(-1)}, now())
       on conflict (pay_order_no) do nothing`,
      [
        ID.coverPayment(p.n), ID.tenant(p.t), ID.coverInvoice(p.bill),
        `DEMO-PAY-C${String(p.n).padStart(3, '0')}`,
        p.amount, p.paid, p.status, p.remark,
      ],
    );
    bump('billing.payments');
  }

  // ── 6. 风控 / 合规事件 ────────────────────────────────────────────────────
  const RISKS = [
    { n: 1, t: 2, level: 'high', score: 88, reason: '账单逾期超过 30 天且联系人失联（demo）', reviewed: false },
    { n: 2, t: 3, level: 'follow_up', score: 55, reason: '实名认证被拒后未重新提交（demo）', reviewed: false },
    { n: 3, t: 1, level: 'normal', score: 12, reason: '例行巡检无异常（demo）', reviewed: true },
  ];
  for (const r of RISKS) {
    await client.query(
      `insert into admin.risk_records
         (id, tenant_id, risk_level, risk_score, scope, reason, reviewer_id, source_table, created_at, updated_at)
       values ($1, $2, $3, $4, 'tenant', $5, null, 'tenancy.tenants', ${monthsFromNow(-1)}, now())
       on conflict (id) do nothing`,
      [ID.risk(r.n), ID.tenant(r.t), r.level, r.score, r.reason],
    );
    bump('admin.risk_records');
  }

  const COMPLIANCE = [
    { n: 1, t: 2, type: 'data_export_request', status: 'open', reg: 'PIPL-45' },
    { n: 2, t: 1, type: 'account_deletion_request', status: 'in_review', reg: 'PIPL-47' },
    { n: 3, t: 3, type: 'kyc_rejected', status: 'resolved', reg: 'AML-12' },
  ];
  for (const c of COMPLIANCE) {
    await client.query(
      `insert into admin.compliance_events
         (id, tenant_id, event_type, status, regulation_code, detail, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6::jsonb, ${monthsFromNow(-1)}, now())
       on conflict (id) do nothing`,
      // detail 是 jsonb，不是文本列——传裸字符串会 22P02。
      [ID.compliance(c.n), ID.tenant(c.t), c.type, c.status, c.reg,
       JSON.stringify({ note: `Demo 合规事件：${c.type}`, source: 'seed-demo' })],
    );
    bump('admin.compliance_events');
  }

  // ── 7. 工单 + 时间线 ──────────────────────────────────────────────────────
  const TICKETS = [
    { n: 1, t: 2, status: 'open', priority: 'p0', title: '账单逾期后服务被限流', cat: 'billing' },
    { n: 2, t: 1, status: 'in_progress', priority: 'p2', title: '希望增加数据源连接数', cat: 'product' },
    { n: 3, t: 3, status: 'resolved', priority: 'p1', title: '实名认证被拒，申请复核', cat: 'account' },
    { n: 4, t: 4, status: 'closed', priority: 'p3', title: '免费版额度说明咨询', cat: 'other' },
  ];
  for (const k of TICKETS) {
    const done = k.status === 'resolved' || k.status === 'closed';
    await client.query(
      `insert into support.tickets
         (id, tenant_id, account_id, ticket_no, category, priority, source, status, title, description,
          reporter_name, assignee_name, first_response_at, resolved_at, closed_at, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, 'console', $7, $8, $9, $10, '平台客服',
               ${monthsFromNow(-1)}, ${done ? monthsFromNow(-1) : 'null'},
               ${k.status === 'closed' ? monthsFromNow(-1) : 'null'}, ${monthsFromNow(-2)}, now())
       on conflict (ticket_no) do nothing`,
      [
        ID.ticket(k.n), ID.tenant(k.t), ID.user(k.t),
        `DEMO-TK-${String(k.n).padStart(4, '0')}`, k.cat, k.priority, k.status, k.title,
        `${k.title}。这是 demo 工单，用于验证工单列表与详情。`,
        TENANTS.find((x) => x.i === k.t).ownerName,
      ],
    );
    bump('support.tickets');

    await client.query(
      `insert into support.ticket_comments
         (id, ticket_id, event_type, actor_type, actor_id, actor_name, payload, created_at)
       values ($1, $2, 'created', 'customer', $3, $4, $5::jsonb, ${monthsFromNow(-2)})
       on conflict (id) do nothing`,
      [ID.ticketComment(k.n * 2 - 1), ID.ticket(k.n), ID.user(k.t),
       TENANTS.find((x) => x.i === k.t).ownerName,
       JSON.stringify({ body: '工单已提交（demo）。' })],
    );
    bump('support.ticket_comments');
    await client.query(
      `insert into support.ticket_comments
         (id, ticket_id, event_type, actor_type, actor_id, actor_name, payload, created_at)
       values ($1, $2, 'comment', 'operator', null, '平台客服', $3::jsonb, ${monthsFromNow(-1)})
       on conflict (id) do nothing`,
      [ID.ticketComment(k.n * 2), ID.ticket(k.n),
       JSON.stringify({ body: '已收到，正在跟进（demo）。' })],
    );
    bump('support.ticket_comments');
  }

  // ── 8. 通知投递流水（覆盖投递成功/失败/退信）──────────────────────────────
  const NOTIFS = [
    { n: 1, t: 1, ch: 'email', tpl: 'invoice.paid', st: 'delivered' },
    { n: 2, t: 2, ch: 'email', tpl: 'invoice.overdue', st: 'failed' },
    { n: 3, t: 2, ch: 'sms', tpl: 'invoice.overdue', st: 'sent' },
    { n: 4, t: 3, ch: 'email', tpl: 'kyc.rejected', st: 'bounced' },
    { n: 5, t: 4, ch: 'inapp', tpl: 'quota.warning', st: 'opened' },
    { n: 6, t: 1, ch: 'webhook', tpl: 'subscription.renewed', st: 'queued' },
  ];
  for (const nf of NOTIFS) {
    const tenant = TENANTS.find((x) => x.i === nf.t);
    await client.query(
      `insert into support.notification_logs
         (id, tenant_id, account_id, channel, template_code, status, reference_type, reference_id,
          recipient, subject, provider, error_message, retry_count,
          delivered_at, opened_at, created_at)
       -- reference_id 是 varchar 而 tenant_id 是 uuid：同一个 $ 参数不能兼职
       -- 两种类型（42P08 inconsistent types deduced），所以单独占一个位置。
       values ($1, $2, $3, $4, $5, $6, 'tenant', $12, $7, $8, $9, $10, $11,
               ${['delivered', 'opened'].includes(nf.st) ? monthsFromNow(-1) : 'null'},
               ${nf.st === 'opened' ? monthsFromNow(-1) : 'null'}, ${monthsFromNow(-1)})
       on conflict (id) do nothing`,
      [
        ID.notification(nf.n), ID.tenant(nf.t), ID.user(nf.t), nf.ch, nf.tpl, nf.st,
        nf.ch === 'sms' ? tenant.phone : tenant.email,
        `[Demo] ${nf.tpl}`,
        nf.ch === 'sms' ? 'aliyun-dypns' : 'smtp',
        nf.st === 'failed' ? 'SMTP 550 mailbox unavailable（demo）'
          : nf.st === 'bounced' ? '硬退信：收件人不存在（demo）' : null,
        nf.st === 'failed' ? 3 : 0,
        ID.tenant(nf.t), // $12 reference_id（文本形态的租户 id）
      ],
    );
    bump('support.notification_logs');
  }

  // ── 9. 优惠券批次 + 券码 ──────────────────────────────────────────────────
  await client.query(
    `insert into promotion.voucher_batches
       (id, kind, name, code_prefix, effect, total_count, issued_count, per_user_limit,
        valid_from, valid_until, status, created_at, updated_at)
     values ($1, 'discount', 'Demo 新客立减', 'DEMO', $2::jsonb, 100, 5, 1,
             ${monthsFromNow(-1)}, ${monthsFromNow(6)}, 'active', now(), now())
     on conflict (id) do nothing`,
    [ID.voucherBatch(1), JSON.stringify({ type: 'amount_off', amount: '200.00', currency: 'CNY' })],
  );
  bump('promotion.voucher_batches');

  for (let n = 1; n <= 5; n++) {
    // 第 1 张标记为已核销，其余可用 —— 核销记录页面才有东西可看。
    const redeemed = n === 1;
    await client.query(
      `insert into promotion.vouchers
         (id, batch_id, code, status, max_uses, used_count, expires_at, redeemed_at, created_at)
       values ($1, $2, $3, $4, 1, $5, ${monthsFromNow(6)}, ${redeemed ? monthsFromNow(-1) : 'null'}, now())
       on conflict (code) do nothing`,
      // 券码状态枚举是 issued/assigned/reserved/redeemed/expired/revoked——
      // 未核销是 `issued` 而不是别处常见的 `active`（chk_vouchers_status）。
      [ID.voucher(n), ID.voucherBatch(1), `DEMO-${String(n).padStart(4, '0')}`,
       redeemed ? 'redeemed' : 'issued', redeemed ? 1 : 0],
    );
    bump('promotion.vouchers');
  }

  // ── 汇总 ──────────────────────────────────────────────────────────────────
  console.log('✓  demo 数据就绪：');
  for (const [table, n] of Object.entries(stats).sort()) {
    console.log(`     ${String(n).padStart(4)}  ${table}`);
  }
  console.log(
    '\n   全部 demo 行的 id 都在 00000000-0000-4000-b000-… 段内。要清空重来：\n' +
      "     删除顺序需自下而上（先子后父），或直接重置本地库后依次跑 catalog → sample → demo。",
  );
}

if (isMain(import.meta.url)) {
  runSeed('demo', seedDemo);
}
