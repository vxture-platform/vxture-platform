#!/usr/bin/env node
/**
 * seed-bulk-core.mjs —— ⑤ 主干实体批量种子。
 *
 * @package @vxture/platform
 * @layer Data
 *
 * ── 它与 seed-bulk.mjs 的分工 ─────────────────────────────────────────────
 * `seed-bulk.mjs`（④）灌的是**叶子表**：公告、特性开关、维护窗口、流水、券核销、
 * 用量月表……这些表不被别人引用，随手灌就能满。第一版只做了这些，于是"每页上百
 * 条"只兑现在 9 张表上，而**租户 5 / 用户 5 / 订阅 4 / 工单 4** 这条主干原样没动
 * ——页面看着依然是空的（owner 2026-08-06 当场点破）。
 *
 * 本文件（⑤）灌的是**主干**：用户 → 租户 → 工作区 → 成员 → 订阅 → 账单 → 支付
 * → 工单 …… 每张表都被下游若干张表按外键引用，所以必须**按依赖顺序整图生成**，
 * 不能像叶子表那样单独灌。这是第一版偷懒跳过它的真实原因。
 *
 * 执行顺序：catalog → sample → demo → **bulk-core（本文件）** → bulk。
 * 放在 bulk 之前：bulk 里的模型授权、券核销等要按租户/工作区铺开，租户先到位它
 * 才能铺满（此前只有 5 个租户，`uq_model_policies_model_tenant` 把授权卡在 30 行）。
 *
 * ── 幂等 ─────────────────────────────────────────────────────────────────
 * 所有 id 落在 `00000000-0000-4000-d000-…` 段（catalog=a000、demo=b000、bulk=c000），
 * 配 `on conflict do nothing`。不用 `Math.random()`：随机值会让每次执行产生新行，
 * 重跑一次就翻一倍。
 *
 * ── 值域 ─────────────────────────────────────────────────────────────────
 * 每个枚举都取自**库里的 CHECK 约束**，不是照着页面猜的。BFF 普遍有
 * `Set.has(x) ? x : 默认值` 的静默兜底，造错的值不会报错、只会显示成默认档
 * （公告 type 就是这么被吞掉 50 行的），所以值域必须对着约束抄。
 */

import { runSeed, isMain } from "./seed-lib.mjs";

const N = 100;

/** id 生成器：段内按 `种类(2 hex) + 序号(10 位)` 编址，保证可预测、可重跑。 */
const KIND = {
  user: "01", tenant: "02", workspace: "03", membership: "04", wsMember: "05",
  verification: "06", contact: "07", subscription: "08", subHistory: "09",
  quotaPool: "0a", invoice: "0b", invoiceItem: "0c", payment: "0d", credit: "0e",
  ticket: "0f", ticketEvent: "10", notifyLog: "11", complianceEvent: "12",
  riskRecord: "13", operator: "14", loginAttempt: "15", authSession: "16",
  provider: "17", model: "18", priceRule: "19", voucherBatch: "1a",
  productMetric: "1b", provisioning: "1c",
};

const ID = (kind, i) =>
  `00000000-0000-4000-d000-${KIND[kind]}${String(i).padStart(10, "0")}`;

/** 取模轮转，替代随机：同一个 i 永远得到同一个值。 */
const pick = (arr, i) => arr[i % arr.length];

/** 以 2026-01-01 为原点按天推移，避免 `new Date()` 让每次执行产生不同数据。 */
const EPOCH = Date.UTC(2026, 0, 1);
const day = (n) => new Date(EPOCH + n * 86400_000).toISOString();

const counts = [];

export async function seedBulkCore(c) {
  {
    // ── 前置：借用既有的角色与套餐版本，不新建 ──────────────────────────
    // 角色与套餐属于目录数据（catalog seed 的地盘），批量数据只引用不新造。
    const tenantRole = (
      await c.query(
        `select id, scope from access.roles where scope = 'tenant' order by id limit 1`,
      )
    ).rows[0];
    const wsRole = (
      await c.query(
        `select id, scope from access.roles where scope = 'workspace' order by id limit 1`,
      )
    ).rows[0];
    const operatorRoles = (
      await c.query(`select id from admin.operator_role order by id`)
    ).rows.map((r) => r.id);
    // 套餐版本不直接挂产品——产品关系走 `plan_components`，`plans` 里没有
    // product_id 这一列。这里只要能引用的版本 id，产品另取。
    const planVersions = (
      await c.query(`select id from product.plan_versions order by id`)
    ).rows;
    const products = (
      await c.query(`select id from product.products order by id`)
    ).rows.map((r) => r.id);

    if (!tenantRole || !wsRole || !planVersions.length || !products.length) {
      throw new Error(
        "前置目录数据缺失（access.roles / plan_versions / products），先跑 catalog seed",
      );
    }

    // ── 1. 用户 ────────────────────────────────────────────────────────
    // phone 与 phone_verified_at 都是 NOT NULL 且无默认；account/email/phone 三列
    // 各自唯一，所以序号必须进到每一列里，不能只进 id。
    const uStatus = ["active", "active", "active", "disabled", "pending"];
    for (let i = 1; i <= N; i += 1) {
      await c.query(
        `insert into account.users
           (id, account, email, email_verified_at, phone, phone_verified_at,
            status, level_no, source, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, 'bulk', $9)
         on conflict do nothing`,
        [
          ID("user", i),
          `bulkuser${String(i).padStart(3, "0")}`,
          `bulk.user${String(i).padStart(3, "0")}@example.test`,
          i % 4 === 0 ? null : day(i),
          `1990${String(1000000 + i).padStart(7, "0")}`,
          day(i),
          pick(uStatus, i),
          (i % 5) + 1,
          day(i),
        ],
      );
    }
    counts.push(["account.users", N]);

    for (let i = 1; i <= N; i += 1) {
      await c.query(
        `insert into account.user_profiles
           (user_id, display_name, gender, language, timezone, theme, created_at)
         values ($1, $2, $3, 'zh-CN', 'Asia/Shanghai', $4, $5)
         on conflict do nothing`,
        [
          ID("user", i),
          `测试用户 ${String(i).padStart(3, "0")}`,
          pick(["male", "female", "unspecified"], i),
          pick(["light", "dark", "system"], i),
          day(i),
        ],
      );
    }
    counts.push(["account.user_profiles", N]);

    // ── 2. 租户 ────────────────────────────────────────────────────────
    // owner_user_id 指向上一步的用户，一人一租户，编号对齐便于排查。
    const tStatus = ["active", "active", "active", "active", "suspended"];
    const tVerify = ["verified", "verified", "pending", "unverified", "rejected"];
    for (let i = 1; i <= N; i += 1) {
      const type = i % 3 === 0 ? "personal" : "organization";
      const verification = pick(tVerify, i);
      await c.query(
        `insert into tenancy.tenants
           (id, name, type, owner_user_id, status, verification_status,
            verification_type, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict do nothing`,
        [
          ID("tenant", i),
          type === "personal"
            ? `个人租户 ${String(i).padStart(3, "0")}`
            : `测试科技 ${String(i).padStart(3, "0")} 有限公司`,
          type,
          ID("user", i),
          pick(tStatus, i),
          verification,
          type === "personal" ? "individual" : "enterprise",
          day(i),
        ],
      );
    }
    counts.push(["tenancy.tenants", N]);

    for (let i = 1; i <= N; i += 1) {
      await c.query(
        `insert into tenancy.tenant_profiles
           (tenant_id, description, industry, scale, country_code, address,
            is_billing_recipient, timezone, language, currency, created_at)
         values ($1, $2, $3, $4, 'CN', $5, true, 'Asia/Shanghai', 'zh-CN', 'CNY', $6)
         on conflict do nothing`,
        [
          ID("tenant", i),
          `批量测试租户 ${i} 的简介。`,
          pick(["制造", "金融", "教育", "医疗", "零售", "物流", "能源"], i),
          pick(["1-20", "21-100", "101-500", "501-2000", "2000+"], i),
          pick(["北京市朝阳区", "上海市浦东新区", "深圳市南山区", "杭州市余杭区"], i),
          day(i),
        ],
      );
    }
    counts.push(["tenancy.tenant_profiles", N]);

    // 一租户两个联系人（唯一键是 tenant+type+email，两种角色不撞）。
    for (let i = 1; i <= N; i += 1) {
      for (const [seq, ct] of [["a", "admin"], ["b", "billing"]]) {
        await c.query(
          `insert into tenancy.tenant_contacts
             (id, tenant_id, contact_type, name, title, email, phone, user_id, created_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           on conflict do nothing`,
          [
            `00000000-0000-4000-d000-${KIND.contact}${seq === "a" ? "0" : "1"}${String(i).padStart(9, "0")}`,
            ID("tenant", i),
            ct,
            `联系人 ${String(i).padStart(3, "0")}${seq === "a" ? "甲" : "乙"}`,
            ct === "admin" ? "管理员" : "财务负责人",
            `${ct}${String(i).padStart(3, "0")}@example.test`,
            `1991${String(1000000 + i).padStart(7, "0")}`,
            ct === "admin" ? ID("user", i) : null,
            day(i),
          ],
        );
      }
    }
    counts.push(["tenancy.tenant_contacts", N * 2]);

    // ── 3. 工作区与成员 ────────────────────────────────────────────────
    for (let i = 1; i <= N; i += 1) {
      await c.query(
        `insert into tenancy.workspaces
           (id, tenant_id, name, is_default, description, status, created_at)
         values ($1, $2, $3, true, $4, $5, $6)
         on conflict do nothing`,
        [
          ID("workspace", i),
          ID("tenant", i),
          `默认工作区 ${String(i).padStart(3, "0")}`,
          `批量测试工作区 ${i}`,
          i % 20 === 0 ? "archived" : "active",
          day(i),
        ],
      );
    }
    counts.push(["tenancy.workspaces", N]);

    const mStatus = ["active", "active", "active", "suspended", "removed"];
    for (let i = 1; i <= N; i += 1) {
      await c.query(
        `insert into tenancy.tenant_memberships
           (id, tenant_id, user_id, role_id, role_scope, status,
            default_workspace_id, title, department, employee_no, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         on conflict do nothing`,
        [
          ID("membership", i),
          ID("tenant", i),
          ID("user", i),
          tenantRole.id,
          tenantRole.scope,
          pick(mStatus, i),
          ID("workspace", i),
          pick(["负责人", "工程师", "运营", "财务", "客服"], i),
          pick(["技术部", "运营部", "财务部", "市场部"], i),
          `E${String(i).padStart(5, "0")}`,
          day(i),
        ],
      );
      await c.query(
        `insert into tenancy.workspace_memberships
           (id, workspace_id, tenant_id, user_id, role_id, role_scope, status, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict do nothing`,
        [
          ID("wsMember", i),
          ID("workspace", i),
          ID("tenant", i),
          ID("user", i),
          wsRole.id,
          wsRole.scope,
          pick(mStatus, i),
          day(i),
        ],
      );
    }
    counts.push(["tenancy.tenant_memberships", N]);
    counts.push(["tenancy.workspace_memberships", N]);

    // ── 4. 实名认证 ────────────────────────────────────────────────────
    // 与租户的 verification_status 保持一致，否则租户列表与认证列表会互相打架。
    for (let i = 1; i <= N; i += 1) {
      const type = i % 3 === 0 ? "individual" : "enterprise";
      const status = pick(tVerify, i);
      await c.query(
        `insert into kyc.tenant_verifications
           (id, tenant_id, verification_type, business_license_no,
            legal_person_name, status, reviewed_at, reject_reason, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict do nothing`,
        [
          ID("verification", i),
          ID("tenant", i),
          type,
          type === "enterprise" ? `91${String(100000000000 + i)}X` : null,
          `法人 ${String(i).padStart(3, "0")}`,
          status,
          status === "verified" || status === "rejected" ? day(i + 3) : null,
          status === "rejected" ? "营业执照影像不清晰，请重新上传" : null,
          day(i),
        ],
      );
    }
    counts.push(["kyc.tenant_verifications", N]);

    // ── 5. 订阅 ────────────────────────────────────────────────────────
    // 约束两条必须一起看：`trial` 必须 auto_renew=false；`perpetual` 必须 end_at
    // 为空。所以周期与种类不能各自独立轮转，得成对决定。
    const subStatus = [
      "active", "active", "active", "trialing", "overdue",
      "suspended", "expired", "cancelled",
    ];
    for (let i = 1; i <= N; i += 1) {
      const pv = planVersions[i % planVersions.length];
      const status = pick(subStatus, i);
      const kind =
        status === "trialing" ? "trial" : i % 11 === 0 ? "free" : "paid";
      const perpetual = kind === "free" && i % 22 === 0;
      await c.query(
        `insert into metering.subscriptions
           (id, tenant_id, workspace_id, plan_version_id, subscription_kind,
            cycle_unit, cycle_count, start_at, end_at, trial_end_at, status,
            auto_renew, activation_method, next_renewal_at, order_no,
            pay_amount, currency, created_by_type, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
                 $15, $16, 'CNY', $17, $18)
         on conflict do nothing`,
        [
          ID("subscription", i),
          ID("tenant", i),
          ID("workspace", i),
          pv.id,
          kind,
          perpetual ? "perpetual" : pick(["month", "month", "year"], i),
          1,
          day(i),
          perpetual ? null : day(i + 365),
          kind === "trial" ? day(i + 14) : null,
          status,
          kind === "trial" ? false : status === "active",
          kind === "trial"
            ? "trial"
            : kind === "free"
              ? "free"
              : pick(
                  ["online_purchase", "offline_purchase", "redemption", "operator_grant"],
                  i,
                ),
          status === "active" && !perpetual ? day(i + 365) : null,
          `SO${String(202600000 + i)}`,
          kind === "paid" ? (i % 12) * 500 + 1999 : 0,
          pick(["customer", "customer", "operator", "system"], i),
          day(i),
        ],
      );
    }
    counts.push(["metering.subscriptions", N]);

    // 每条订阅两条变更史：开通 + 一次状态流转。
    for (let i = 1; i <= N; i += 1) {
      for (const [seq, changeType, from, to] of [
        ["0", "create", null, "active"],
        ["1", "status_change", "active", pick(subStatus, i)],
      ]) {
        await c.query(
          `insert into metering.subscription_histories
             (id, tenant_id, subscription_id, change_type, from_status, to_status,
              actor_type, remark, created_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           on conflict do nothing`,
          [
            `00000000-0000-4000-d000-${KIND.subHistory}${seq}${String(i).padStart(9, "0")}`,
            ID("tenant", i),
            ID("subscription", i),
            changeType,
            from,
            to,
            pick(["customer", "operator", "system"], i),
            changeType === "create" ? "订阅开通" : "状态流转",
            day(i + Number(seq)),
          ],
        );
      }
    }
    counts.push(["metering.subscription_histories", N * 2]);

    // 配额池：pool_source='subscription' 时 subscription_id 必填；reset_period
    // 非 none 时 current_period_start 与 period_anchor 必填。两条约束联动。
    for (let i = 1; i <= N; i += 1) {
      const reset = pick(["month", "month", "day", "none"], i);
      await c.query(
        `insert into metering.quota_pools
           (id, workspace_id, subscription_id, product_id, metric_key,
            quota_limit, quota_used, component_role, pool_source, reset_period,
            period_anchor, current_period_start, status, effective_at, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, 'subscription', $9, $10, $11,
                 $12, $13, $14)
         on conflict do nothing`,
        [
          ID("quotaPool", i),
          ID("workspace", i),
          ID("subscription", i),
          pick(products, i),
          pick(["api_calls", "tokens", "storage_gb", "seats", "documents"], i),
          (i % 10 + 1) * 10000,
          (i % 10 + 1) * 1000 * (i % 7),
          i % 4 === 0 ? "bundled" : "primary",
          reset,
          reset === "none" ? null : day(i),
          reset === "none" ? null : day(i),
          i % 15 === 0 ? "retired" : "active",
          day(i),
          day(i),
        ],
      );
    }
    counts.push(["metering.quota_pools", N]);

    // ── 6. 账单 / 明细 / 支付 / 余额 ───────────────────────────────────
    const billStatus = [
      "paid", "paid", "paid", "unpaid", "paying", "partial", "overdue", "cancelled",
    ];
    for (let i = 1; i <= N; i += 1) {
      const status = pick(billStatus, i);
      const total = (i % 12) * 500 + 1999;
      const discount = i % 5 === 0 ? 200 : 0;
      const payable = total - discount;
      const paid =
        status === "paid" ? payable : status === "partial" ? Math.floor(payable / 2) : 0;
      await c.query(
        `insert into billing.invoices
           (id, tenant_id, bill_no, subscription_id, bill_cycle, cycle_start_date,
            cycle_end_date, total_amount, discount_amount, payable_amount,
            paid_amount, currency, bill_status, bill_type, paid_at,
            payment_method, created_by_type, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'CNY', $12, $13,
                 $14, $15, 'system', $16)
         on conflict do nothing`,
        [
          ID("invoice", i),
          ID("tenant", i),
          `BILL${String(202600000 + i)}`,
          ID("subscription", i),
          pick(["monthly", "yearly"], i),
          day(i).slice(0, 10),
          day(i + 30).slice(0, 10),
          total,
          discount,
          payable,
          paid,
          status,
          pick(["normal", "normal", "normal", "one_off", "adjustment"], i),
          status === "paid" ? day(i + 2) : null,
          status === "paid" ? pick(["alipay", "wechat", "bank_transfer"], i) : null,
          day(i),
        ],
      );
    }
    counts.push(["billing.invoices", N]);

    // 每张账单两条明细：订阅费 + 超量或折扣。
    for (let i = 1; i <= N; i += 1) {
      const base = (i % 12) * 500 + 1999;
      for (const [seq, itemType, name, qty, price] of [
        ["0", "subscription_fee", "套餐订阅费", 1, base],
        [
          "1",
          i % 5 === 0 ? "discount" : "metered_overage",
          i % 5 === 0 ? "促销折扣" : "调用量超额",
          i % 5 === 0 ? 1 : (i % 8) + 1,
          i % 5 === 0 ? -200 : 30,
        ],
      ]) {
        await c.query(
          `insert into billing.invoice_items
             (id, bill_id, tenant_id, workspace_id, subscription_id, product_id,
              metric_key, item_name, item_type, item_unit, quantity, unit_price,
              total_amount, created_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
           on conflict do nothing`,
          [
            `00000000-0000-4000-d000-${KIND.invoiceItem}${seq}${String(i).padStart(9, "0")}`,
            ID("invoice", i),
            ID("tenant", i),
            ID("workspace", i),
            ID("subscription", i),
            pick(products, i),
            itemType === "metered_overage" ? "api_calls" : null,
            name,
            itemType,
            itemType === "metered_overage" ? "千次" : "次",
            qty,
            price,
            qty * price,
            day(i),
          ],
        );
      }
    }
    counts.push(["billing.invoice_items", N * 2]);

    const payStatus = [
      "paid", "paid", "paid", "pending", "pending_verify", "failed", "closed", "refunding",
    ];
    for (let i = 1; i <= N; i += 1) {
      const status = pick(payStatus, i);
      const total = (i % 12) * 500 + 1999;
      const source = pick(["online", "online", "offline", "voucher"], i);
      await c.query(
        `insert into billing.payments
           (id, tenant_id, bill_id, pay_order_no, pay_source, pay_channel,
            pay_method, offline_pay_type, offline_payer_name, offline_pay_time,
            total_amount, paid_amount, currency, pay_status, paid_at, closed_at,
            actor_type, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'CNY', $13,
                 $14, $15, $16, $17)
         on conflict do nothing`,
        [
          ID("payment", i),
          ID("tenant", i),
          ID("invoice", i),
          `PAY${String(202600000 + i)}`,
          source,
          source === "online" ? pick(["alipay", "wechat", "unionpay"], i) : null,
          source === "online" ? pick(["qrcode", "app", "h5"], i) : null,
          source === "offline" ? pick(["bank_transfer", "cheque", "cash"], i) : null,
          source === "offline" ? `付款方 ${String(i).padStart(3, "0")}` : null,
          source === "offline" ? day(i + 1) : null,
          total,
          status === "paid" ? total : 0,
          status,
          status === "paid" ? day(i + 2) : null,
          status === "closed" ? day(i + 3) : null,
          pick(["customer", "customer", "operator", "system"], i),
          day(i),
        ],
      );
    }
    counts.push(["billing.payments", N]);

    // 余额：tenant_id 唯一，一租户一行。
    for (let i = 1; i <= N; i += 1) {
      const granted = (i % 20) * 1000;
      const consumed = Math.floor(granted * ((i % 9) / 10));
      await c.query(
        `insert into billing.credits
           (id, tenant_id, billing_mode, currency, balance, total_granted,
            total_consumed, created_at)
         values ($1, $2, $3, 'CNY', $4, $5, $6, $7)
         on conflict do nothing`,
        [
          ID("credit", i),
          ID("tenant", i),
          i % 3 === 0 ? "prepaid" : "postpaid",
          granted - consumed,
          granted,
          consumed,
          day(i),
        ],
      );
    }
    counts.push(["billing.credits", N]);

    // ── 7. 工单 ────────────────────────────────────────────────────────
    // 按**库里的 7 个状态**造，不按页面的 4 个。BFF 的 `normalizeTicketStatus`
    // 把 resolved / reopened / cancelled 一起兜进 "closed"，那是展示层的有损
    // 映射（已登记），数据层不该迁就它。
    const tkStatus = [
      "open", "open", "pending", "in_progress", "in_progress",
      "resolved", "closed", "reopened", "cancelled",
    ];
    for (let i = 1; i <= N; i += 1) {
      const status = pick(tkStatus, i);
      const done = status === "resolved" || status === "closed";
      await c.query(
        `insert into support.tickets
           (id, tenant_id, ticket_no, category, priority, source, status, title,
            description, reporter_name, assignee_name, tags, satisfaction_score,
            first_response_at, due_at, resolved_at, closed_at, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
                 $15, $16, $17, $18)
         on conflict do nothing`,
        [
          ID("ticket", i),
          ID("tenant", i),
          `TK${String(202600000 + i)}`,
          pick(["billing", "technical", "account", "product", "compliance"], i),
          pick(["p0", "p1", "p2", "p2", "p3"], i),
          pick(["console", "website", "email", "admin", "api"], i),
          status,
          `${pick(["计费疑问", "接口报错", "账号无法登录", "配额不足", "开票申请"], i)} #${i}`,
          `批量测试工单 ${i} 的问题描述。`,
          `联系人 ${String(i).padStart(3, "0")}甲`,
          i % 4 === 0 ? null : `运营 ${String((i % 8) + 1).padStart(2, "0")}`,
          [pick(["紧急", "常规", "已升级", "待客户确认"], i)],
          status === "closed" ? (i % 5) + 1 : null,
          i % 6 === 0 ? null : day(i),
          day(i + 3),
          done ? day(i + 2) : null,
          status === "closed" ? day(i + 3) : null,
          day(i),
        ],
      );
    }
    counts.push(["support.tickets", N]);

    for (let i = 1; i <= N; i += 1) {
      for (const [seq, eventType, actorType, actorName, text] of [
        ["0", "comment", "customer", `联系人 ${String(i).padStart(3, "0")}甲`, "请协助处理，谢谢。"],
        ["1", "reply", "operator", `运营 ${String((i % 8) + 1).padStart(2, "0")}`, "已收到，正在核查。"],
      ]) {
        await c.query(
          `insert into support.ticket_comments
             (id, ticket_id, event_type, actor_type, actor_name, payload, created_at)
           values ($1, $2, $3, $4, $5, $6, $7)
           on conflict do nothing`,
          [
            `00000000-0000-4000-d000-${KIND.ticketEvent}${seq}${String(i).padStart(9, "0")}`,
            ID("ticket", i),
            eventType,
            actorType,
            actorName,
            JSON.stringify({ text }),
            day(i + Number(seq)),
          ],
        );
      }
    }
    counts.push(["support.ticket_comments", N * 2]);

    const nlStatus = ["delivered", "delivered", "sent", "opened", "queued", "failed", "bounced"];
    for (let i = 1; i <= N; i += 1) {
      const status = pick(nlStatus, i);
      const channel = pick(["email", "sms", "inapp", "webhook", "push"], i);
      await c.query(
        `insert into support.notification_logs
           (id, tenant_id, channel, template_code, status, reference_type,
            reference_id, recipient, subject, provider, error_message,
            retry_count, delivered_at, opened_at, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         on conflict do nothing`,
        [
          ID("notifyLog", i),
          ID("tenant", i),
          channel,
          pick(
            ["bill_due", "sub_expiring", "ticket_reply", "verify_result", "quota_alert"],
            i,
          ),
          status,
          "invoice",
          `BILL${String(202600000 + i)}`,
          channel === "sms"
            ? `1990${String(1000000 + i).padStart(7, "0")}`
            : `bulk.user${String(i).padStart(3, "0")}@example.test`,
          `【Vxture】通知 #${i}`,
          pick(["aliyun", "tencent", "internal"], i),
          status === "failed" || status === "bounced" ? "收件地址不可达" : null,
          status === "failed" ? 3 : 0,
          status === "delivered" || status === "opened" ? day(i) : null,
          status === "opened" ? day(i + 1) : null,
          day(i),
        ],
      );
    }
    counts.push(["support.notification_logs", N]);

    // ── 8. 运营账号 / 合规 / 风险 ──────────────────────────────────────
    for (let i = 1; i <= N; i += 1) {
      await c.query(
        `insert into admin.operator_account
           (id, role_id, username, email, email_verified, phone, phone_verified,
            display_name, status, account_type, last_login_at, last_login_ip,
            remark, created_at)
         values ($1, $2, $3, $4, true, $5, true, $6, $7, $8, $9, $10, $11, $12)
         on conflict do nothing`,
        [
          ID("operator", i),
          pick(operatorRoles, i),
          `bulkops${String(i).padStart(3, "0")}`,
          `bulk.ops${String(i).padStart(3, "0")}@example.test`,
          `1992${String(1000000 + i).padStart(7, "0")}`,
          `运营 ${String(i).padStart(3, "0")}`,
          pick(["active", "active", "active", "disabled", "locked"], i),
          pick(["staff", "staff", "outsourced"], i),
          day(i + 200),
          `10.0.${i % 256}.${(i * 7) % 256}`,
          i % 7 === 0 ? "批量测试账号" : null,
          day(i),
        ],
      );
    }
    counts.push(["admin.operator_account", N]);

    for (let i = 1; i <= N; i += 1) {
      const status = pick(["open", "open", "in_review", "resolved", "resolved", "dismissed"], i);
      await c.query(
        `insert into admin.compliance_events
           (id, tenant_id, event_type, status, regulation_code, handler_id,
            detail, tags, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict do nothing`,
        [
          ID("complianceEvent", i),
          ID("tenant", i),
          pick(
            ["data_export", "pii_access", "retention_breach", "consent_withdraw", "cross_border"],
            i,
          ),
          status,
          pick(["PIPL-2021", "GDPR-ART17", "DSL-2021", "CSL-2017"], i),
          status === "open" ? null : ID("operator", (i % N) + 1),
          JSON.stringify({ note: `批量合规事件 ${i}`, severity: (i % 3) + 1 }),
          [pick(["个人信息", "跨境", "留存", "审计"], i)],
          day(i),
        ],
      );
    }
    counts.push(["admin.compliance_events", N]);

    for (let i = 1; i <= N; i += 1) {
      const level = pick(["normal", "normal", "normal", "follow_up", "high"], i);
      await c.query(
        `insert into admin.risk_records
           (id, tenant_id, risk_level, risk_score, scope, reason, reviewer_id,
            tags, source_table, source_id, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         on conflict do nothing`,
        [
          ID("riskRecord", i),
          ID("tenant", i),
          level,
          level === "high" ? 80 + (i % 20) : level === "follow_up" ? 50 + (i % 25) : i % 40,
          pick(["payment", "login", "usage", "content"], i),
          pick(
            ["短时间内多次支付失败", "异地登录", "调用量突增", "内容合规命中", "退款率异常"],
            i,
          ),
          level === "normal" ? null : ID("operator", (i % N) + 1),
          [pick(["自动", "人工复核", "已联系"], i)],
          "billing.payments",
          `PAY${String(202600000 + i)}`,
          day(i),
        ],
      );
    }
    counts.push(["admin.risk_records", N]);

    // ── 9. 会话与登录记录 ──────────────────────────────────────────────
    for (let i = 1; i <= N; i += 1) {
      const ok = i % 5 !== 0;
      await c.query(
        `insert into session.login_attempts
           (id, user_id, identifier, auth_method, result, ip_address,
            country_code, user_agent, created_at)
         values ($1, $2, $3, $4, $5, $6, 'CN', $7, $8)
         on conflict do nothing`,
        [
          ID("loginAttempt", i),
          ID("user", i),
          `bulk.user${String(i).padStart(3, "0")}@example.test`,
          pick(["password", "sms_code", "email_code", "feishu", "dingtalk"], i),
          ok ? "success" : pick(["wrong_password", "locked", "expired_code"], i),
          `115.${i % 256}.${(i * 3) % 256}.${(i * 11) % 256}`,
          pick(
            ["Mozilla/5.0 (Windows NT 10.0)", "Mozilla/5.0 (Macintosh)", "Mozilla/5.0 (iPhone)"],
            i,
          ),
          day(i + 100),
        ],
      );
      await c.query(
        `insert into session.auth_sessions
           (id, sid, user_id, realm, auth_method, ip_address, user_agent,
            status, last_active_at, expires_at, revoked_at, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         on conflict do nothing`,
        [
          ID("authSession", i),
          `bulk-sid-${String(i).padStart(4, "0")}`,
          ID("user", i),
          i % 9 === 0 ? "workforce" : "customer",
          pick(["password", "sms_code", "feishu", "dingtalk"], i),
          `115.${i % 256}.${(i * 3) % 256}.${(i * 11) % 256}`,
          pick(["Chrome/126", "Safari/17", "Edge/126"], i),
          pick(["active", "active", "expired", "revoked"], i),
          day(i + 100),
          day(i + 130),
          i % 4 === 3 ? day(i + 101) : null,
          day(i + 100),
        ],
      );
    }
    counts.push(["session.login_attempts", N]);
    counts.push(["session.auth_sessions", N]);

    // ── 10. 模型平台 ──────────────────────────────────────────────────
    for (let i = 1; i <= N; i += 1) {
      await c.query(
        `insert into model.model_providers
           (id, provider_code, provider_type, provider_name, description,
            is_active, is_customer_visible, is_workforce_visible, created_at)
         values ($1, $2, $3, $4, $5, $6, true, true, $7)
         on conflict do nothing`,
        [
          ID("provider", i),
          `bulk-provider-${String(i).padStart(3, "0")}`,
          pick(["online", "online", "self_hosted", "private"], i),
          `测试厂商 ${String(i).padStart(3, "0")}`,
          `批量测试模型厂商 ${i}`,
          i % 8 !== 0,
          day(i),
        ],
      );
      await c.query(
        `insert into model.models
           (id, provider_id, model_code, model_type, protocol, model_name,
            description, endpoint_url, context_window, max_output_tokens,
            capabilities, supports_streaming, is_active, is_customer_visible,
            is_workforce_visible, sort, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, true,
                 true, $14, $15)
         on conflict do nothing`,
        [
          ID("model", i),
          ID("provider", i),
          `bulk-model-${String(i).padStart(3, "0")}`,
          pick(["chat", "chat", "embedding", "rerank", "image"], i),
          pick(["openai", "anthropic", "ollama", "custom"], i),
          `测试模型 ${String(i).padStart(3, "0")}`,
          `批量测试模型 ${i}`,
          `https://api.example.test/v1/bulk-${String(i).padStart(3, "0")}`,
          pick([8192, 32768, 128000, 200000], i),
          pick([2048, 4096, 8192], i),
          [pick(["text", "vision", "tool_use", "json_mode"], i)],
          i % 3 !== 0,
          i % 9 !== 0,
          i,
          day(i),
        ],
      );
      await c.query(
        `insert into model.model_price_rules
           (id, model_id, billing_mode, currency, unit_tokens, input_unit_price,
            output_unit_price, request_unit_price, is_active, effective_at, created_at)
         values ($1, $2, $3, 'CNY', 1000, $4, $5, $6, $7, $8, $9)
         on conflict do nothing`,
        [
          ID("priceRule", i),
          ID("model", i),
          i % 6 === 0 ? "request" : "token",
          (i % 20) * 0.001 + 0.002,
          (i % 20) * 0.003 + 0.006,
          // 有默认值但仍是 NOT NULL：显式传 null 会顶掉默认值直接违约，给 0。
          i % 6 === 0 ? 0.05 : 0,
          i % 10 !== 0,
          day(i),
          day(i),
        ],
      );
    }
    counts.push(["model.model_providers", N]);
    counts.push(["model.models", N]);
    counts.push(["model.model_price_rules", N]);

    // ── 11. 券批次 ────────────────────────────────────────────────────
    for (let i = 1; i <= N; i += 1) {
      const total = (i % 10 + 1) * 100;
      await c.query(
        `insert into promotion.voucher_batches
           (id, tenant_id, kind, name, code_prefix, effect, total_count,
            issued_count, per_user_limit, valid_from, valid_until, status, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         on conflict do nothing`,
        [
          ID("voucherBatch", i),
          i % 4 === 0 ? ID("tenant", i) : null,
          pick(
            ["credit_voucher", "recharge_card", "redemption", "discount", "extension"],
            i,
          ),
          `批量券批次 ${String(i).padStart(3, "0")}`,
          `BULK${String(i).padStart(3, "0")}`,
          JSON.stringify({ type: "amount_off", value: (i % 10 + 1) * 50 }),
          total,
          Math.floor(total * ((i % 10) / 10)),
          (i % 3) + 1,
          day(i),
          day(i + 180),
          pick(["active", "active", "active", "paused", "archived"], i),
          day(i),
        ],
      );
    }
    counts.push(["promotion.voucher_batches", N]);

    // ── 12. 产品度量 / 开通记录 ────────────────────────────────────────
    // 度量的唯一键是 (product_id, metric_key)，所以是**产品数 × 指标数**封顶，
    // 不是 100 —— 这里如实按上限铺满，不硬凑数字。
    const METRICS = [
      ["api_calls", "pool", "divisible", "次", "month"],
      ["tokens", "pool", "divisible", "token", "month"],
      ["storage_gb", "max", null, "GB", "none"],
      ["seats", "max", null, "个", "none"],
      ["documents", "pool", "atomic", "份", "month"],
      ["concurrent_jobs", "max", null, "个", "none"],
    ];
    let metricRows = 0;
    for (const [pi, productId] of products.entries()) {
      for (const [mi, [key, merge, consume, unit, reset]] of METRICS.entries()) {
        const r = await c.query(
          `insert into product.product_metrics
             (id, product_id, metric_key, merge_strategy, consume_mode,
              metric_unit, reset_period, created_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8)
           on conflict do nothing`,
          [
            `00000000-0000-4000-d000-${KIND.productMetric}${String(pi).padStart(6, "0")}${String(mi).padStart(4, "0")}`,
            productId,
            key,
            merge,
            consume,
            unit,
            reset,
            day(pi + mi),
          ],
        );
        metricRows += r.rowCount;
      }
    }
    counts.push(["product.product_metrics", metricRows]);

    for (let i = 1; i <= N; i += 1) {
      const status = pick(["provisioned", "provisioned", "pending", "deprovisioned"], i);
      await c.query(
        `insert into provisioning.provisionings
           (id, workspace_id, tenant_id, product_id, status, version,
            provisioned_at, deprovisioned_at, metadata, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         on conflict do nothing`,
        [
          ID("provisioning", i),
          ID("workspace", i),
          ID("tenant", i),
          pick(products, i),
          status,
          (i % 3) + 1,
          status === "pending" ? null : day(i + 1),
          status === "deprovisioned" ? day(i + 60) : null,
          JSON.stringify({ region: pick(["cn-east", "cn-north", "cn-south"], i) }),
          day(i),
        ],
      );
    }
    counts.push(["provisioning.provisionings", N]);

    // ── 13. 产品分类与回调 ────────────────────────────────────────────
    // 分类 id 是 smallint 且**没有默认值**，必须显式给号；占 500 段，避开目录
    // seed 的低号。三层树：10 个一级 + 每级挂 9 个二级。
    const CAT_L1 = [
      "平台服务", "模型能力", "智能体", "数据服务", "行业方案",
      "开发工具", "安全合规", "运维支撑", "协作办公", "增值服务",
    ];
    let catRows = 0;
    for (const [ci, name] of CAT_L1.entries()) {
      const parentId = 500 + ci * 10;
      const r1 = await c.query(
        `insert into product.product_categories
           (id, parent_id, code, name, name_key, sort, is_customer_visible,
            is_workforce_visible, created_at)
         values ($1, null, $2, $3, $4, $5, true, true, $6)
         on conflict do nothing`,
        [
          parentId,
          `bulk-cat-${parentId}`,
          name,
          // i18n key is NOT optional here: the baseline audit's [C2] assertion
          // fails the whole database when a seeded catalog row leaves an i18n
          // key NULL — row floors alone let entire columns stay silently empty
          // (the 2026-07-05 seed-correction line). Same shape catalog uses:
          // product.category.<code>.
          `product.category.bulk-cat-${parentId}`,
          ci,
          day(ci),
        ],
      );
      catRows += r1.rowCount;
      for (let j = 1; j <= 9; j += 1) {
        const r2 = await c.query(
          `insert into product.product_categories
             (id, parent_id, code, name, name_key, sort, is_customer_visible,
              is_workforce_visible, created_at)
           values ($1, $2, $3, $4, $5, $6, $7, true, $8)
           on conflict do nothing`,
          [
            parentId + j,
            parentId,
            `bulk-cat-${parentId + j}`,
            `${name} · 子类 ${j}`,
            `product.category.bulk-cat-${parentId + j}`,
            j,
            j % 5 !== 0,
            day(ci + j),
          ],
        );
        catRows += r2.rowCount;
      }
    }
    counts.push(["product.product_categories", catRows]);

    // 回调的主键就是 product_id —— 一产品一行，**上限等于产品数**，不是 100。
    // 这里如实铺到上限，不为了凑数字去造不存在的产品。
    let hookRows = 0;
    for (const [pi, productId] of products.entries()) {
      const r = await c.query(
        `insert into product.product_webhooks
           (product_id, home_url, webhook_url, webhook_secret_ref, created_at)
         values ($1, $2, $3, $4, $5)
         on conflict do nothing`,
        [
          productId,
          `https://app${String(pi + 1).padStart(2, "0")}.example.test`,
          `https://app${String(pi + 1).padStart(2, "0")}.example.test/webhooks/vxture`,
          `secret://bulk/product-${String(pi + 1).padStart(2, "0")}`,
          day(pi),
        ],
      );
      hookRows += r.rowCount;
    }
    counts.push(["product.product_webhooks", `${hookRows}（上限=产品数 ${products.length}）`]);

    console.log("\n  [bulk-core] 主干实体批量种子\n");
    for (const [label, n] of counts) {
      console.log(`  ${String(n).padStart(6)}  ${label}`);
    }
    console.log(
      "\n   全部行的 id 都在 00000000-0000-4000-d000-… 段内（catalog=a000、demo=b000、bulk=c000）。",
    );
  }
}

if (isMain(import.meta.url)) {
  await runSeed("bulk-core", seedBulkCore);
}
