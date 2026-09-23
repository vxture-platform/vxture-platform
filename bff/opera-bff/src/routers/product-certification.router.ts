/**
 * product-certification.router.ts —— 接入认证：平台自己把整条链在沙箱里跑一遍。
 *
 * @package @vxture/bff-opera
 *
 * ── 它解决的是一个环，不是「检查太严」 ──
 *
 * 发布套餐要 `acceptance`（端到端验收）满足；验收要五段台账落在同一工作区；其中
 * 开通与回调**只由活跃订阅触发**；而订阅唯一的入口是客户下单，下单查价要求
 * `plan.current_version_id = pv.id`——那个指针**只有发布会设**。环在这里闭合。
 *
 * 代码里曾注释说「有 `operator_grant` 与邀请订阅两条不发布也能开通的路」，两条都
 * 不成立：`operator_grant` 只是 `50_metering.sql` 的 CHECK 值域里一个值加 seed 演示
 * 数据，**全仓零写入路径**；邀请订阅解锁的是 `plans.is_public`，改变「谁能买」，
 * 不改变「已不已发布」。
 *
 * 断点只需要一条**新的入边**：一条指向**未发布草稿版本**的订阅，不经过订单流。
 * 本文件就是那条边，`operator_grant` 在这里第一次真的有了写入方。
 *
 * ── 为什么不另造一个「认证套餐」 ──
 *
 * 认证订阅指向**待发布的那个草稿版本本身**。这样认证的对象与发布的对象字节相同，
 * publish 当场 `is_locked=true` 冻结，中间没有可漂移的窗口；而且它顺带跑一遍
 * `materializeQuotaPools`——**套餐组件配错会在认证时炸，而不是上架后炸**。
 * 另造一个认证套餐则是在认证一个永远不会卖的东西。
 *
 * 草稿在发布前仍可改，所以每次认证记一份**组件指纹**；发布门比对指纹。用指纹而不是
 * 时间戳，因为「改了又改回来」不该判成失效。
 *
 * ── 半驱动半观测 ──
 *
 * 五段里平台能自己造的就造，只有对方才能发起的就观测等待：
 *   登录      人      沙箱测试用户走一次真实授权码流（判据最硬：它蕴含对方 RP 实现完整）
 *   开通      平台    认证订阅落地即由 SubscriptionService 发 tenant.provisioned
 *   回调投递  平台    同上，判据是投递状态 delivered
 *   权益拉取  对方    平台只能等
 *   用量上报  对方    同上
 *
 * 观测那一半**按沙箱收口**（`integration-signals` 的 workspaceId / userId 参数）。
 * 不收口的话，A 客户的真实使用会把 B 产品的认证喂绿——那正是旧 `acceptance` 判据的
 * 毛病：它读的是该产品的**任意**流量。
 *
 * ── 走的是和客户完全相同的代码路径 ──
 *
 * 这里调的是 `SubscriptionService.createSubscription`，与客户下单落地用的是同一个
 * 方法：同样物化配额池、同样触发开通派发与权益失效。**若认证走一条特殊路径，它就
 * 证明不了生产路径能跑通**——那是这整套机制唯一的价值所在。
 * 差别只有两处，且都只在入参里：`activationMethod='operator_grant'`（无订单无钱）
 * 与「工作区属于认证租户」。
 */
import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import type { Pool } from "pg";
import { PLAN_COMPONENT_FINGERPRINT_SQL } from "@vxture-platform/shared";
import { SubscriptionService } from "@vxture/service-subscription";
import { insertOperatorAuditLog } from "../audit/audit-log";
import { conflict, invalidRequest, notFound } from "../errors/api-error";
import { RP_REDIS, RP_RUNTIME, type RpRuntime } from "../oidc/oidc-rp.tokens";
import {
  readIntegrationSignals,
  type SignalRedisReader,
} from "./product-integration-signals.router";
import { OPERA_BFF_RO_POOL, OPERA_BFF_RW_POOL } from "../tokens";
import type { RequestContext } from "../types/request-context";
import { assertCanManage, assertCanRead } from "./product-authz";
import { requireUuid } from "./router.shared";

/**
 * 认证租户（平台固定装置，见 migrations/2026-10-31-certification-sandbox.sql）。
 *
 * 写成常量而不是「查 purpose='certification' 的第一行」：那样在有两个认证租户时会
 * 静默挑一个，而迁移里那条断言正是为了保证**有且只有一个**。常量与断言互为对证。
 */
const CERT_TENANT_ID = "00000000-0000-4000-a000-0000000000c2";

/**
 * 《产品接入通则》契约版本。bump 它会让既有认证转 stale——所以它必须是一个**会动**
 * 的值：钉死在这里的好处是改它需要一次提交、一次评审，而不是某天被配置悄悄改掉。
 */
const CONTRACT_VERSION = "C1/C2/C3-2026-09";

/** 认证订阅的周期：沙箱不计费，取最短周期，过期即自然失效不必人工清。 */
const CERT_CYCLE_UNIT = "month";

interface CertificationRunRecord {
  id: string;
  productId: string;
  contractVersion: string;
  sandboxWorkspaceId: string;
  /**
   * 沙箱工作区的**可视码**。裸 UUID 一律不上屏（铁律：任何场景只展示可视码，
   * 文字 / tooltip / aria / CSV 都算），而运营把沙箱交给对方时需要一个能说出口的号。
   * 工作区已被清理时为 null——查不到就显示「未知」，**永不退回那个 id**。
   */
  sandboxWorkspaceNo: string | null;
  planVersionId: string | null;
  componentFingerprint: string | null;
  segments: Record<string, boolean>;
  verdict: string;
  staleReason: string | null;
  certifiedAt: string | null;
  createdAt: string;
}

interface RunRow {
  id: string;
  product_id: string;
  contract_version: string;
  sandbox_workspace_id: string;
  sandbox_workspace_no: string | null;
  plan_version_id: string | null;
  component_fingerprint: string | null;
  segments: Record<string, boolean> | null;
  verdict: string;
  stale_reason: string | null;
  certified_at: Date | null;
  created_at: Date;
}

function toRecord(row: RunRow): CertificationRunRecord {
  return {
    id: row.id,
    productId: row.product_id,
    contractVersion: row.contract_version,
    sandboxWorkspaceId: row.sandbox_workspace_id,
    sandboxWorkspaceNo: row.sandbox_workspace_no,
    planVersionId: row.plan_version_id,
    componentFingerprint: row.component_fingerprint,
    segments: row.segments ?? {},
    verdict: row.verdict,
    staleReason: row.stale_reason,
    certifiedAt: row.certified_at ? row.certified_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  };
}

/**
 * 台账列 + 沙箱工作区的可视码。
 *
 * 可视码用左连接取：工作区被清理之后台账仍然要留得住（「这个产品当时在哪个沙箱里
 * 认的」是事后追责要答的问题），那时 `workspace_no` 为 null，界面显示「未知」——
 * **不退回那个 uuid**。
 */
const RUN_COLUMNS = `r.id, r.product_id, r.contract_version, r.sandbox_workspace_id,
                     w.workspace_no::text AS sandbox_workspace_no,
                     r.plan_version_id, r.component_fingerprint, r.segments, r.verdict,
                     r.stale_reason, r.certified_at, r.created_at`;

/** 与 RUN_COLUMNS 配套的 FROM：两者必须一起改，分开改就会 42P01。 */
const RUN_FROM = `product.certification_runs r
         LEFT JOIN tenancy.workspaces w ON w.id = r.sandbox_workspace_id`;

@Controller("api/products")
export class ProductCertificationRouter {
  constructor(
    @Inject(OPERA_BFF_RO_POOL) private readonly pool: Pool,
    @Inject(OPERA_BFF_RW_POOL) private readonly rwPool: Pool,
    @Inject(SubscriptionService)
    private readonly subscriptions: SubscriptionService,
    @Inject(RP_REDIS) private readonly redis: SignalRedisReader,
    @Inject(RP_RUNTIME) private readonly rpRuntime: RpRuntime,
  ) {}

  /**
   * 当前那一条有效认证；没有就是 null。
   *
   * 「有效」= `verdict='certified'` 且 `stale_reason IS NULL`。**不带时间窗**：
   * 认证回答「能不能工作」，不回答「有没有人在用」——后者归运行健康。一个安静了
   * 三个月的正常产品不该因此失效。
   */
  @Get(":id/certification")
  async current(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
  ): Promise<{
    effective: CertificationRunRecord | null;
    latest: CertificationRunRecord | null;
  }> {
    assertCanRead(req);
    const productId = requireUuid(id, "id");

    const [eff, latest] = await Promise.all([
      this.pool.query<RunRow>(
        `SELECT ${RUN_COLUMNS} FROM ${RUN_FROM}
          WHERE r.product_id = $1 AND r.verdict = 'certified' AND r.stale_reason IS NULL
          ORDER BY r.certified_at DESC LIMIT 1`,
        [productId],
      ),
      this.pool.query<RunRow>(
        `SELECT ${RUN_COLUMNS} FROM ${RUN_FROM}
          WHERE r.product_id = $1
          ORDER BY r.created_at DESC LIMIT 1`,
        [productId],
      ),
    ]);
    /* 两个都给：有效的那条答「能不能发布」，最近的那条答「上次跑到哪儿了」。
       只给前者的话，一次失败的认证在界面上和「从没认过」长得一模一样。 */
    return {
      effective: eff.rows[0] ? toRecord(eff.rows[0]) : null,
      latest: latest.rows[0] ? toRecord(latest.rows[0]) : null,
    };
  }

  /**
   * 可认证的候选版本：这个产品当主组件的**草稿**版本。
   *
   * 认证要挑一个版本，而版本是商业侧（admin）的东西——运营在 opera 点「发起认证」时
   * 手上没有那个 id。与其让人在两个门户之间抄 uuid，不如在这里把候选列出来：
   * 抄 uuid 这种事，抄错了不会报错，只会认到另一版上去。
   *
   * 只列草稿：已发布版本没有认证的必要（它已经在卖），而认证的全部意义在于
   * 「发布之前就把链跑通」。
   */
  @Get(":id/certification/candidates")
  async candidates(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
  ): Promise<
    {
      planVersionId: string;
      planCode: string;
      planName: string;
      versionNo: number;
      tier: string | null;
    }[]
  > {
    assertCanRead(req);
    const productId = requireUuid(id, "id");
    const rows = await this.pool.query<{
      plan_version_id: string;
      plan_code: string;
      plan_name: string;
      version_no: number;
      tier: string | null;
    }>(
      `SELECT pv.id AS plan_version_id, pl.plan_code, pl.plan_name,
              pv.version_no, pc.tier
         FROM product.plan_components pc
         JOIN product.plan_versions pv ON pv.id = pc.plan_version_id
         JOIN product.plans pl ON pl.id = pv.plan_id
        WHERE pc.product_id = $1
          AND pc.component_role = 'primary'
          AND pv.status = 'draft'
          AND pl.deleted_at IS NULL
        ORDER BY pl.plan_code ASC, pv.version_no DESC`,
      [productId],
    );
    return rows.rows.map((r) => ({
      planVersionId: r.plan_version_id,
      planCode: r.plan_code,
      planName: r.plan_name,
      versionNo: r.version_no,
      tier: r.tier,
    }));
  }

  /**
   * 发起一次认证：供给沙箱工作区 → 建认证订阅 → 开一条 running 的台账。
   *
   * 订阅创建走 `SubscriptionService`，与客户下单落地同一个方法——这是整套机制的
   * 立足点，不要为了省事在这里写裸 INSERT。
   */
  @Post(":id/certification/run")
  async run(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
    @Body() body: { planVersionId?: string },
  ): Promise<CertificationRunRecord> {
    assertCanManage(req);
    const productId = requireUuid(id, "id");
    const planVersionId = requireUuid(body?.planVersionId, "planVersionId");

    const product = await this.pool.query<{
      product_code: string;
      status: string;
    }>(
      `SELECT product_code, status FROM product.products
        WHERE id = $1 AND deleted_at IS NULL`,
      [productId],
    );
    const prod = product.rows[0];
    if (!prod) throw notFound("CATALOG_PRODUCT_NOT_FOUND", "Product not found");
    /* 认证发生在上线之后：上线门证的是「对方接通了」，认证证的是「整条链跑得通」。
       顺序颠倒的话，认证会在对方还没实现任何接口时去等五段痕迹，白等。 */
    if (prod.status !== "active") {
      throw conflict(
        "CERTIFICATION_PRODUCT_NOT_ACTIVE",
        `产品当前是「${prod.status}」，认证要在上线之后跑——先过上线门。`,
      );
    }

    /* 待认证的必须是**草稿**版本：已发布版本没有认证的必要（它已经在卖），而认证
       的全部意义在于「发布之前就把链跑通」。 */
    const version = await this.pool.query<{
      status: string;
      owns: boolean;
    }>(
      `SELECT pv.status,
              EXISTS (SELECT 1 FROM product.plan_components pc
                       WHERE pc.plan_version_id = pv.id
                         AND pc.component_role = 'primary'
                         AND pc.product_id = $2) AS owns
         FROM product.plan_versions pv
        WHERE pv.id = $1`,
      [planVersionId, productId],
    );
    const ver = version.rows[0];
    if (!ver)
      throw notFound(
        "CATALOG_PLAN_VERSION_NOT_FOUND",
        "Plan version not found",
      );
    if (!ver.owns) {
      /* 归属校验：`productId` 与 `planVersionId` 是各自独立送来的两个字段。不校验的
         后果不只是认错对象——台账会记下一条「A 产品在 B 套餐上认过」的假事实。 */
      throw invalidRequest(
        "VALIDATION_INVALID_VALUE",
        "这个套餐版本的主组件不是本产品",
        "planVersionId",
      );
    }
    if (ver.status !== "draft") {
      throw conflict(
        "CERTIFICATION_VERSION_NOT_DRAFT",
        `版本当前是「${ver.status}」，认证针对的是待发布的草稿版本。`,
      );
    }

    const workspaceId = await this.ensureSandboxWorkspace(prod.product_code);
    const fingerprint = await this.componentFingerprint(planVersionId);

    /*
     * 认证订阅：`uidx_subscriptions_live_per_product` 是 (workspace, product) 唯一，
     * 所以同一个沙箱工作区里同一个产品至多一条在活——重复发起时复用，不撞唯一索引。
     */
    const existing = await this.pool.query<{ id: string }>(
      `SELECT id FROM metering.subscriptions
        WHERE workspace_id = $1 AND product_id = $2
          AND status IN ('active','trialing','expiring','overdue')
          AND deleted_at IS NULL
        LIMIT 1`,
      [workspaceId, productId],
    );
    if (!existing.rows[0]) {
      await this.subscriptions.createSubscription({
        tenantId: CERT_TENANT_ID,
        workspaceId,
        planVersionId,
        cycleType: CERT_CYCLE_UNIT,
        startAt: new Date(),
        autoRenew: false,
        payAmount: 0,
        createdBy: req.operator!.id,
        /* 三个入参就是认证订阅与客户订阅的**全部**差别。 */
        subscriptionKind: "free",
        activationMethod: "operator_grant",
        createdByType: "operator",
      });
    }

    /* RETURNING 取不到左连接来的可视码，所以插完再按 id 读一次。多一次往返换
       「裸 uuid 永不上屏」——这条铁律没有「反正只是内部页面」的例外。 */
    const insertedId = await this.rwPool.query<{ id: string }>(
      `INSERT INTO product.certification_runs
         (product_id, contract_version, sandbox_workspace_id, plan_version_id,
          component_fingerprint, verdict, run_by)
       VALUES ($1, $2, $3, $4, $5, 'running', $6)
       RETURNING id`,
      [
        productId,
        CONTRACT_VERSION,
        workspaceId,
        planVersionId,
        fingerprint,
        req.operator?.id ?? null,
      ],
    );

    const inserted = await this.pool.query<RunRow>(
      `SELECT ${RUN_COLUMNS} FROM ${RUN_FROM} WHERE r.id = $1`,
      [insertedId.rows[0]!.id],
    );

    const client = await this.rwPool.connect();
    try {
      await insertOperatorAuditLog(client, req, {
        action: "product.certification.run",
        resourceType: "product",
        resourceId: prod.product_code,
        before: null,
        after: {
          runId: insertedId.rows[0]!.id,
          planVersionId,
          sandboxWorkspaceId: workspaceId,
          contractVersion: CONTRACT_VERSION,
        },
      });
    } finally {
      client.release();
    }

    return toRecord(inserted.rows[0]!);
  }

  /**
   * 判定：读**按沙箱收口**的信号，五段齐则定 certified。
   *
   * ── 五段是哪五段，为什么不是六段 ──
   * 登录 / 开通 / 回调投递 / 权益拉取 / 用量上报。C1 出站换票**不在内**：它归上线门，
   * 而且 `support.audit_logs` 没有 workspace_id，收不了口——给它一个收不了口的位置，
   * 等于让一次别处的换票把沙箱认证喂绿。
   *
   * ── 判据是「这一次」，不是「有没有过」 ──
   * 全部信号都按本次 run 的 `sandbox_workspace_id` 收口（登录段按沙箱租户的成员，因为
   * `refresh_tokens` 没有 workspace_id）。不收口就退化成旧 `acceptance`：读该产品的
   * 任意流量，A 客户的使用把 B 的认证喂绿。
   *
   * ── 为什么不自动把 running 判成 failed ──
   * 缺段几乎总是「对方还没调」，而对方什么时候调不由平台决定。留在 running 并把缺哪
   * 几段原样回出去，运营看到的是「还差权益和用量」，而不是一个没有下一步的「失败」。
   * 真正该 failed 的是「跑过且不可能再成」——那需要一个超时判据，目前没有，所以不编。
   */
  @Post(":id/certification/evaluate")
  async evaluate(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
  ): Promise<CertificationRunRecord> {
    assertCanManage(req);
    const productId = requireUuid(id, "id");

    const latest = await this.pool.query<RunRow>(
      `SELECT ${RUN_COLUMNS} FROM ${RUN_FROM}
        WHERE r.product_id = $1 AND r.verdict = 'running'
        ORDER BY r.created_at DESC LIMIT 1`,
      [productId],
    );
    const run = latest.rows[0];
    if (!run) {
      throw conflict(
        "CERTIFICATION_NO_RUNNING",
        "这个产品没有进行中的认证——先发起一次。",
      );
    }

    const signals = await readIntegrationSignals(
      {
        pool: this.pool,
        redis: this.redis,
        keyPrefix: this.rpRuntime.keyPrefix,
      },
      productId,
      { workspaceId: run.sandbox_workspace_id, tenantId: CERT_TENANT_ID },
    );

    const segments = {
      login: signals.login !== null,
      provision: signals.provision !== null,
      delivery: signals.delivery !== null,
      entitlement: signals.entitlement !== null,
      consume: signals.consume !== null,
    };
    const allPresent = Object.values(segments).every(Boolean);

    await this.rwPool.query(
      `UPDATE product.certification_runs
          SET segments = $2::jsonb,
              verdict = CASE WHEN $3::bool THEN 'certified' ELSE verdict END,
              /* 结论与时刻互为充要（DDL 上有 CHECK 钉着），所以这两列必须一起写。
                 分两条语句写的话，中间那一瞬是一个 CHECK 不允许的状态。 */
              certified_at = CASE WHEN $3::bool THEN now() ELSE certified_at END,
              updated_at = now()
        WHERE id = $1`,
      [run.id, JSON.stringify(segments), allPresent],
    );
    const updated = await this.pool.query<RunRow>(
      `SELECT ${RUN_COLUMNS} FROM ${RUN_FROM} WHERE r.id = $1`,
      [run.id],
    );

    if (allPresent) {
      const client = await this.rwPool.connect();
      try {
        await insertOperatorAuditLog(client, req, {
          action: "product.certification.certified",
          resourceType: "product",
          resourceId: productId,
          before: { verdict: "running" },
          after: {
            verdict: "certified",
            runId: run.id,
            sandboxWorkspaceId: run.sandbox_workspace_id,
            contractVersion: run.contract_version,
          },
        });
      } finally {
        client.release();
      }
    }

    return toRecord(updated.rows[0]!);
  }

  /**
   * 沙箱工作区：一个认证租户，**每产品一个工作区**。
   *
   * 每产品一个而不是共用一个：`uidx_subscriptions_live_per_product` 是
   * (workspace, product) 唯一，共用一个工作区时多个产品的认证订阅并不冲突——但
   * 收口就失效了，五段信号会混在同一个 workspace_id 下分不清是谁的。
   */
  private async ensureSandboxWorkspace(productCode: string): Promise<string> {
    const name = `cert-${productCode}`;
    const found = await this.pool.query<{ id: string }>(
      `SELECT id FROM tenancy.workspaces
        WHERE tenant_id = $1 AND name = $2 AND deleted_at IS NULL
        LIMIT 1`,
      [CERT_TENANT_ID, name],
    );
    if (found.rows[0]) return found.rows[0].id;

    const created = await this.rwPool.query<{ id: string }>(
      `INSERT INTO tenancy.workspaces (tenant_id, name, description, status)
       VALUES ($1, $2, $3, 'active')
       RETURNING id`,
      [CERT_TENANT_ID, name, `接入认证沙箱 · ${productCode}`],
    );
    return created.rows[0]!.id;
  }

  /**
   * 本版组件的指纹。算法在 `@vxture-platform/shared` 的
   * `PLAN_COMPONENT_FINGERPRINT_SQL`——发布门要用同一份重算并比对，各写一份的症状是
   * 「明明刚认过却说指纹对不上」，一个纯粹的假警报，而且两边各自看都没错。
   *
   * 本来这里是把行取回来在 JS 里 sha256 的。改成在库里算，两处才可能真的是同一份：
   * 同样的摊平次序、同样的空值占位、同样的空集语义（`sha256('')`，不是 NULL）。
   */
  private async componentFingerprint(planVersionId: string): Promise<string> {
    const row = await this.pool.query<{ fingerprint: string }>(
      `SELECT ${PLAN_COMPONENT_FINGERPRINT_SQL} AS fingerprint
         FROM product.plan_components pc
        WHERE pc.plan_version_id = $1`,
      [planVersionId],
    );
    return row.rows[0]?.fingerprint ?? "";
  }
}
