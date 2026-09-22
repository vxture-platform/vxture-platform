import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import type { Pool, PoolClient } from "pg";
import { TIERS, type Tier } from "@vxture-platform/shared";
import { ADMIN_BFF_RO_POOL, ADMIN_BFF_RW_POOL } from "../tokens";
import { RequireStepUp } from "../auth/step-up.decorator";
import { insertOperatorAuditLog } from "../audit/audit-log";
import {
  isValidIndustry,
  isValidReleaseStage,
  isForwardReleaseStageMove,
  releaseStageLabel,
  RELEASE_STAGES,
} from "@vxture/core-utils";
import { pgErrorCode, withTransaction } from "../db/tx";
import type {
  ProductAgentRecord,
  ProductCapabilityIntegration,
  ProductCapabilityMetricRule,
  ProductCapabilityRecord,
  ProductCapabilitySource,
  ProductCapabilityRelatedSolution,
  ProductCapabilityStatus,
  ProductCapabilityType,
  ProductPlanRecord,
  ProductReleaseFeature,
  ProductReleasePeriodType,
  ProductReleasePrice,
  ProductReleaseRecord,
  ProductPlanVersionRecord,
  ProductServicePlanDetailRecord,
  ProductServicePlanEntitlement,
  ProductServicePlanPrice,
  ProductSolutionDetailRecord,
  ProductSolutionPlanBindInput,
  ProductSolutionProductInput,
  ProductSolutionRecord,
  ProductSolutionStatus,
  ProductSolutionTier,
  ProductContentWriteInput,
  ProductSolutionWriteInput,
  RequestContext,
} from "../types/console.types";

@Controller("api/products")
export class ProductsRouter {
  constructor(
    @Inject(ADMIN_BFF_RO_POOL) private readonly pool: Pool,
    @Inject(ADMIN_BFF_RW_POOL) private readonly rwPool: Pool,
  ) {}

  @Get("capabilities")
  async listCapabilities(
    @Req() req: Request & RequestContext,
  ): Promise<ProductCapabilityRecord[]> {
    assertCanManageProducts(req);
    return loadProductCapabilities(this.pool);
  }

  @Get("capabilities/:productCode")
  async getCapability(
    @Req() req: Request & RequestContext,
    @Param("productCode") productCode: string,
  ): Promise<ProductCapabilityRecord> {
    assertCanManageProducts(req);
    const normalizedCode = decodeURIComponent(productCode);
    const capability = (await loadProductCapabilities(this.pool)).find(
      (item) => item.productCode === normalizedCode,
    );

    if (!capability) {
      throw new NotFoundException(
        `Product capability ${normalizedCode} not found`,
      );
    }

    return capability;
  }

  /**
   * 更新产品**营销内容与呈现**:marketing(营销富字段 jsonb)/ release_stage(成熟度轴)/
   * is_customer_visible(是否上站)。这些是**业务/运营字段**,归 admin 产品目录录入;
   * 技术注册(code/type/origin/OIDC)仍在 opera。PATCH 语义:只改送来的字段,没送的不动。
   */
  @Patch("capabilities/:productCode/content")
  @RequireStepUp()
  async updateProductContent(
    @Req() req: Request & RequestContext,
    @Param("productCode") productCode: string,
    @Body() body: ProductContentWriteInput,
  ): Promise<ProductCapabilityRecord> {
    assertCanManageProducts(req);
    const code = decodeURIComponent(productCode);

    if (
      body.releaseStage !== undefined &&
      !isValidReleaseStage(body.releaseStage)
    ) {
      throw new BadRequestException(
        `releaseStage must be one of ${RELEASE_STAGES.join(", ")}`,
      );
    }

    await withTransaction(this.rwPool, async (client) => {
      const before = await client.query<{
        id: string;
        release_stage: string;
        is_customer_visible: boolean;
        marketing: unknown;
      }>(
        `SELECT id, release_stage, is_customer_visible, marketing
           FROM product.products
          WHERE product_code = $1 AND deleted_at IS NULL
          FOR UPDATE`,
        [code],
      );
      const row = before.rows[0];
      if (!row) {
        throw new NotFoundException(`Product ${code} not found`);
      }

      /*
       * 成熟度状态机（2026-09-17）。此前只校枚举合法，于是 `ga → developing`
       * 这种倒退也照写——而官网会当场把一个已发布产品的订阅入口换成「敬请期待」。
       *
       * 成熟度只向前走：`developing → beta → ga`，可跨级（developing → ga），
       * 同态重放不报错（反复保存同一张表单是常事）。**不开倒退口**：真要把一个
       * 产品从客户面前收回去，该动的是可见性（`is_customer_visible`）或生命周期
       * （`status`），那两根轴各自有出口；拿成熟度当开关使是在说「它变不成熟了」。
       */
      if (
        body.releaseStage !== undefined &&
        body.releaseStage !== row.release_stage &&
        !isForwardReleaseStageMove(row.release_stage, body.releaseStage)
      ) {
        throw new ConflictException(
          `成熟度只能向前：当前为「${releaseStageLabel(row.release_stage)}」，不能改回「${releaseStageLabel(body.releaseStage)}」。要下架请改可见性或产品状态。`,
        );
      }

      const sets: string[] = [];
      const values: unknown[] = [];
      if (body.marketing !== undefined) {
        values.push(JSON.stringify(body.marketing));
        sets.push(`marketing = $${values.length + 1}::jsonb`);
      }
      if (body.releaseStage !== undefined) {
        values.push(body.releaseStage);
        sets.push(`release_stage = $${values.length + 1}`);
      }
      if (body.isCustomerVisible !== undefined) {
        values.push(body.isCustomerVisible);
        sets.push(`is_customer_visible = $${values.length + 1}`);
      }
      if (sets.length === 0) {
        throw new BadRequestException("No editable field supplied");
      }

      await client.query(
        `UPDATE product.products
            SET ${sets.join(", ")}, updated_by = $${values.length + 2}, updated_at = now()
          WHERE id = $1`,
        [row.id, ...values, req.user!.id],
      );
      await insertOperatorAuditLog(client, req, {
        action: "product.content.update",
        resourceType: "product",
        resourceId: code,
        before: {
          release_stage: row.release_stage,
          is_customer_visible: row.is_customer_visible,
          marketing: row.marketing,
        },
        after: {
          releaseStage: body.releaseStage,
          isCustomerVisible: body.isCustomerVisible,
          marketing: body.marketing,
        },
      });
    });

    const updated = (await loadProductCapabilities(this.pool)).find(
      (item) => item.productCode === code,
    );
    if (!updated) {
      throw new NotFoundException(`Product ${code} not found`);
    }
    return updated;
  }

  /**
   * 产品发布 = 已发布的套餐版本（一条 = 一个 status='published' 的 plan_version，
   * 产品取其 primary 组件）。没有 release 表，也不建：能发布出去的只有版本。
   */
  @Get("releases")
  async listReleases(
    @Req() req: Request & RequestContext,
  ): Promise<ProductReleaseRecord[]> {
    assertCanManageProducts(req);
    return loadProductReleases(this.pool);
  }

  @Get("plans")
  async listPlans(
    @Req() req: Request & RequestContext,
  ): Promise<ProductPlanRecord[]> {
    assertCanManageProducts(req);

    const planRows = await this.pool.query<ProductPlanRow>(PRODUCT_PLAN_SQL);

    // Versioned model (§7): a plan is browsed via its current published
    // plan_version (single price). The old per-plan relational feature/agent
    // breakdown is gone (features live on plan_component); the rich component/tier
    // browse belongs to the new versioned-plan admin surface, so features/agents
    // are empty here — this endpoint stays runtime-correct against the new schema.
    return planRows.rows.map((plan) => {
      const price = plan.price === null ? 0 : Number(plan.price);
      return {
        id: plan.id,
        planCode: plan.plan_code,
        planName: plan.plan_name,
        description: plan.description,
        planType: "normal",
        level: 0,
        isFree: price === 0,
        isPublic: plan.is_public,
        isActive: plan.status === "active",
        subscriptionCount: Number(plan.subscription_count),
        prices:
          plan.current_version_id === null
            ? []
            : [
                {
                  id: plan.current_version_id,
                  currency: plan.currency ?? "CNY",
                  price,
                  originalPrice: price,
                  periodType: "monthly" as const,
                  periodValue: 1,
                  isDefault: true,
                  isActive: plan.version_status === "published",
                },
              ],
        features: [],
        agents: [],
        createdAt: toIso(plan.created_at),
        updatedAt: toIso(plan.updated_at),
      };
    });
  }

  // ── 解决方案（product.solutions / solution_products / solution_plans）────────
  // 读全部走 RO 池；写走 RW 池 + 事务 + 审计（support.audit_logs，与 plan 发布同一条
  // 审计线）。model-policies 端点已退役（2026-08-31）：真实的模型策略是 Atlas 的，
  // 由 atlas.router `GET /api/atlas/policies` 代理并做契约断言，这里不再造第二份。

  @Get("solutions")
  async listSolutions(
    @Req() req: Request & RequestContext,
  ): Promise<ProductSolutionRecord[]> {
    assertCanManageProducts(req);
    return loadProductSolutions(this.pool);
  }

  @Get("solutions/:solutionCode")
  async getSolution(
    @Req() req: Request & RequestContext,
    @Param("solutionCode") solutionCode: string,
  ): Promise<ProductSolutionDetailRecord> {
    assertCanManageProducts(req);
    return loadProductSolutionDetail(
      this.pool,
      decodeURIComponent(solutionCode),
    );
  }

  /**
   * 方案的六个写端点全部挂 @RequireStepUp（owner 2026-08-31 裁定，70-product-solutions.md §7）。
   * 方案 × 档位绑到哪条套餐、方案上不上线，直接决定客户能买到什么——与套餐版本发布
   * 同一风险级；退役 / 解绑还不可逆。能力码仍是粗粒度的 platform:product.manage（seed
   * 里刻意不整码标 requires_step_up，见 STEP_UP_REQUIRED 的注释），所以门挂在路由上。
   */
  @Post("solutions")
  @RequireStepUp()
  async createSolution(
    @Req() req: Request & RequestContext,
    @Body() body: ProductSolutionWriteInput,
  ): Promise<ProductSolutionDetailRecord> {
    assertCanManageProducts(req);
    const solutionCode = readSolutionCode(body?.solutionCode);
    const fields = readSolutionFields(body, { requireName: true });
    if (!fields.solution_name) {
      throw new BadRequestException("solutionName is required");
    }
    try {
      await withTransaction(this.rwPool, async (client) => {
        await client.query(
          `INSERT INTO product.solutions
             (solution_code, solution_name, description, industry, scenario, customer_segment,
              owner_team, tags, delivery_mode, delivery_boundaries, is_public, status,
              created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::text[], $9, $10::text[], $11, 'draft', $12, $12)`,
          [
            solutionCode,
            fields.solution_name,
            fields.description ?? null,
            fields.industry ?? null,
            fields.scenario ?? null,
            fields.customer_segment ?? null,
            fields.owner_team ?? null,
            fields.tags ?? [],
            fields.delivery_mode ?? null,
            fields.delivery_boundaries ?? [],
            fields.is_public ?? true,
            req.user!.id,
          ],
        );
        await insertOperatorAuditLog(client, req, {
          action: "product.solution.create",
          resourceType: "product_solution",
          resourceId: solutionCode,
          after: { solutionCode, ...fields },
        });
      });
    } catch (error) {
      if (pgErrorCode(error) === "23505") {
        throw new ConflictException(
          `Solution code ${solutionCode} already exists`,
        );
      }
      throw error;
    }
    return loadProductSolutionDetail(this.pool, solutionCode);
  }

  @Put("solutions/:solutionCode")
  @RequireStepUp()
  async updateSolution(
    @Req() req: Request & RequestContext,
    @Param("solutionCode") solutionCode: string,
    @Body() body: ProductSolutionWriteInput,
  ): Promise<ProductSolutionDetailRecord> {
    assertCanManageProducts(req);
    const code = decodeURIComponent(solutionCode);
    const fields = readSolutionFields(body, { requireName: false });
    const keys = Object.keys(fields) as (keyof SolutionFields)[];
    if (keys.length === 0) {
      throw new BadRequestException("No editable field supplied");
    }
    await withTransaction(this.rwPool, async (client) => {
      const before = await lockSolution(client, code);
      // 只更新送来的字段：PUT 语义在这里是「替换这些字段」，没送的不动——
      // 表单只编辑基础资料时不该把交付边界清空。
      const sets = keys.map((key, index) => `${key} = $${index + 2}`);
      const values: unknown[] = keys.map((key) => fields[key] ?? null);
      await client.query(
        `UPDATE product.solutions
            SET ${sets.join(", ")}, updated_by = $${keys.length + 2}, updated_at = now()
          WHERE id = $1`,
        [before.id, ...values, req.user!.id],
      );
      await insertOperatorAuditLog(client, req, {
        action: "product.solution.update",
        resourceType: "product_solution",
        resourceId: code,
        before: pickSolutionAudit(before),
        after: fields,
      });
    });
    return loadProductSolutionDetail(this.pool, code);
  }

  @Patch("solutions/:solutionCode/state")
  @RequireStepUp()
  async setSolutionState(
    @Req() req: Request & RequestContext,
    @Param("solutionCode") solutionCode: string,
    @Body() body: { state?: string },
  ): Promise<ProductSolutionDetailRecord> {
    assertCanManageProducts(req);
    const code = decodeURIComponent(solutionCode);
    const next = body?.state;
    if (!next || !isSolutionStatus(next)) {
      throw new BadRequestException(
        `state must be one of ${SOLUTION_STATES.join(", ")}`,
      );
    }
    await withTransaction(this.rwPool, async (client) => {
      const current = await lockSolution(client, code);
      const from = current.status;
      // 幂等重放（active → active）不报错也不写库，同 opera 产品目录的做法。
      if (from === next) return;
      if (!SOLUTION_STATE_TRANSITIONS[from].includes(next)) {
        const allowed = SOLUTION_STATE_TRANSITIONS[from];
        throw new ConflictException(
          allowed.length === 0
            ? `${SOLUTION_STATE_LABELS[from]}是终态，不能再改成${SOLUTION_STATE_LABELS[next]}`
            : `不允许从${SOLUTION_STATE_LABELS[from]}改成${SOLUTION_STATE_LABELS[next]}；可以改成：${allowed
                .map((s) => SOLUTION_STATE_LABELS[s])
                .join(" / ")}`,
        );
      }
      await client.query(
        `UPDATE product.solutions SET status = $2, updated_by = $3, updated_at = now() WHERE id = $1`,
        [current.id, next, req.user!.id],
      );
      await insertOperatorAuditLog(client, req, {
        action: "product.solution.state",
        resourceType: "product_solution",
        resourceId: code,
        before: { status: from },
        after: { status: next },
      });
    });
    return loadProductSolutionDetail(this.pool, code);
  }

  /**
   * 删除方案（软删 deleted_at）——与退役并列的另一出口(owner 2026-08-31,同产品目录
   * 口径):退役=可见终态,删除=「本不该在册」直接从目录消失,给误建方案用。
   *
   * 判据「无客户足迹即可删」:方案所绑套餐上有 active/trialing 订阅 → 409 只能退役
   * (删除会解绑,但订阅活在 plan 上,删方案不影响它们,只是收入归属断链——所以有
   * 订阅就不许删)。放行时软删方案行 + 解绑 solution_products / solution_plans(释放
   * uq_solution_plans_plan_id,那些 plan 可再绑别处)。step-up + 审计。
   */
  @Delete("solutions/:solutionCode")
  @RequireStepUp()
  async deleteSolution(
    @Req() req: Request & RequestContext,
    @Param("solutionCode") solutionCode: string,
  ): Promise<{ solutionCode: string; deleted: true }> {
    assertCanManageProducts(req);
    const code = decodeURIComponent(solutionCode);
    await withTransaction(this.rwPool, async (client) => {
      const solution = await lockSolution(client, code);
      const { rows } = await client.query<{ has_subs: boolean }>(
        `SELECT EXISTS(
           SELECT 1
             FROM product.solution_plans sp
             JOIN product.plan_versions pv ON pv.plan_id = sp.plan_id
             JOIN metering.subscriptions s ON s.plan_version_id = pv.id
            WHERE sp.solution_id = $1
              AND s.status IN ('active', 'trialing')
              AND s.deleted_at IS NULL
         ) AS has_subs`,
        [solution.id],
      );
      if (rows[0]?.has_subs) {
        throw new ConflictException(
          `方案 ${code} 的套餐已有生效订阅，不能删除——请改用退役。`,
        );
      }
      await client.query(
        `DELETE FROM product.solution_plans WHERE solution_id = $1`,
        [solution.id],
      );
      await client.query(
        `DELETE FROM product.solution_products WHERE solution_id = $1`,
        [solution.id],
      );
      await client.query(
        `UPDATE product.solutions SET deleted_at = now(), updated_by = $2, updated_at = now() WHERE id = $1`,
        [solution.id, req.user!.id],
      );
      await insertOperatorAuditLog(client, req, {
        action: "product.solution.delete",
        resourceType: "product_solution",
        resourceId: code,
        before: { status: solution.status, ...pickSolutionAudit(solution) },
        after: { deleted: true },
      });
    });
    return { solutionCode: code, deleted: true };
  }

  /** 整体替换方案的产品清单（幂等：送什么就是什么）。 */
  @Put("solutions/:solutionCode/products")
  @RequireStepUp()
  async replaceSolutionProducts(
    @Req() req: Request & RequestContext,
    @Param("solutionCode") solutionCode: string,
    @Body()
    body:
      | ProductSolutionProductInput[]
      | { products?: ProductSolutionProductInput[] },
  ): Promise<ProductSolutionDetailRecord> {
    assertCanManageProducts(req);
    const code = decodeURIComponent(solutionCode);
    const items = readSolutionProductInputs(body);
    await withTransaction(this.rwPool, async (client) => {
      const solution = await lockSolution(client, code);
      const resolved = await resolveProducts(client, items);
      await client.query(
        `DELETE FROM product.solution_products WHERE solution_id = $1`,
        [solution.id],
      );
      for (const item of resolved) {
        await client.query(
          `INSERT INTO product.solution_products (solution_id, product_id, role, sort)
           VALUES ($1, $2, $3, $4)`,
          [solution.id, item.productId, item.role, item.sort],
        );
      }
      await client.query(
        `UPDATE product.solutions SET updated_by = $2, updated_at = now() WHERE id = $1`,
        [solution.id, req.user!.id],
      );
      await insertOperatorAuditLog(client, req, {
        action: "product.solution.products.replace",
        resourceType: "product_solution",
        resourceId: code,
        after: resolved.map((item) => ({
          productCode: item.productCode,
          role: item.role,
          sort: item.sort,
        })),
      });
    });
    return loadProductSolutionDetail(this.pool, code);
  }

  /** 把一个既有 plan 绑到方案的某个档位（服务套餐）。一档一个 plan，一个 plan 只能绑一处。 */
  @Put("solutions/:solutionCode/plans/:tier")
  @RequireStepUp()
  async bindSolutionPlan(
    @Req() req: Request & RequestContext,
    @Param("solutionCode") solutionCode: string,
    @Param("tier") tierParam: string,
    @Body() body: ProductSolutionPlanBindInput,
  ): Promise<ProductSolutionDetailRecord> {
    assertCanManageProducts(req);
    const code = decodeURIComponent(solutionCode);
    const tier = readTier(tierParam);
    const planRef = readPlanRef(body);
    try {
      await withTransaction(this.rwPool, async (client) => {
        const solution = await lockSolution(client, code);
        const plan = await resolvePlan(client, planRef);
        const bound = await client.query<{
          solution_code: string;
          tier: string;
        }>(
          `SELECT s.solution_code, sp.tier
             FROM product.solution_plans sp
             JOIN product.solutions s ON s.id = sp.solution_id
            WHERE sp.plan_id = $1`,
          [plan.id],
        );
        const elsewhere = bound.rows.find(
          (row) => row.solution_code !== code || row.tier !== tier,
        );
        if (elsewhere) {
          throw new ConflictException(
            `Plan ${plan.plan_code} is already bound to ${elsewhere.solution_code}/${elsewhere.tier}`,
          );
        }
        const previous = await client.query<{ plan_code: string }>(
          `SELECT p.plan_code
             FROM product.solution_plans sp JOIN product.plans p ON p.id = sp.plan_id
            WHERE sp.solution_id = $1 AND sp.tier = $2`,
          [solution.id, tier],
        );
        await client.query(
          `INSERT INTO product.solution_plans (solution_id, tier, plan_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (solution_id, tier) DO UPDATE SET plan_id = EXCLUDED.plan_id`,
          [solution.id, tier, plan.id],
        );
        await client.query(
          `UPDATE product.solutions SET updated_by = $2, updated_at = now() WHERE id = $1`,
          [solution.id, req.user!.id],
        );
        await insertOperatorAuditLog(client, req, {
          action: "product.solution.plan.bind",
          resourceType: "product_solution",
          resourceId: code,
          before: { tier, planCode: previous.rows[0]?.plan_code ?? null },
          after: { tier, planCode: plan.plan_code },
        });
      });
    } catch (error) {
      // 并发下 UNIQUE (plan_id) 仍可能兜住第二个绑定；和上面的显式检查同一含义。
      if (pgErrorCode(error) === "23505") {
        throw new ConflictException("Plan is already bound to another tier");
      }
      throw error;
    }
    return loadProductSolutionDetail(this.pool, code);
  }

  @Delete("solutions/:solutionCode/plans/:tier")
  @RequireStepUp()
  async unbindSolutionPlan(
    @Req() req: Request & RequestContext,
    @Param("solutionCode") solutionCode: string,
    @Param("tier") tierParam: string,
  ): Promise<ProductSolutionDetailRecord> {
    assertCanManageProducts(req);
    const code = decodeURIComponent(solutionCode);
    const tier = readTier(tierParam);
    await withTransaction(this.rwPool, async (client) => {
      const solution = await lockSolution(client, code);
      const removed = await client.query<{ plan_code: string }>(
        `DELETE FROM product.solution_plans sp
          USING product.plans p
          WHERE sp.solution_id = $1 AND sp.tier = $2 AND p.id = sp.plan_id
          RETURNING p.plan_code`,
        [solution.id, tier],
      );
      if (removed.rowCount === 0) {
        throw new NotFoundException(`No plan bound to ${code}/${tier}`);
      }
      await client.query(
        `UPDATE product.solutions SET updated_by = $2, updated_at = now() WHERE id = $1`,
        [solution.id, req.user!.id],
      );
      await insertOperatorAuditLog(client, req, {
        action: "product.solution.plan.unbind",
        resourceType: "product_solution",
        resourceId: code,
        before: { tier, planCode: removed.rows[0]?.plan_code ?? null },
        after: { tier, planCode: null },
      });
    });
    return loadProductSolutionDetail(this.pool, code);
  }

  @Get("service-plans/:solutionCode/:tierCode")
  async getServicePlan(
    @Req() req: Request & RequestContext,
    @Param("solutionCode") solutionCode: string,
    @Param("tierCode") tierCode: string,
  ): Promise<ProductServicePlanDetailRecord> {
    assertCanManageProducts(req);
    return loadProductServicePlanDetail(
      this.pool,
      decodeURIComponent(solutionCode),
      readTier(decodeURIComponent(tierCode)),
    );
  }

  @Get("agents")
  async listAgents(
    @Req() req: Request & RequestContext,
  ): Promise<ProductAgentRecord[]> {
    assertCanManageProducts(req);
    return loadProductAgents(this.pool);
  }

  // ── plan version lifecycle (product_320) — list · edit draft · publish ─────
  // draft = editable working copy (unlocked, never current); publish freezes it
  // (is_locked=true) and points plans.current_version_id at it. §7 triggers make
  // components/prices immutable once locked, so edits are draft-only.

  @Get("plans/:planId/versions")
  async listPlanVersions(
    @Req() req: Request & RequestContext,
    @Param("planId") planId: string,
  ): Promise<PlanVersionSummary[]> {
    assertCanManageProducts(req);
    const { rows } = await this.pool.query<PlanVersionSummaryRow>(
      PLAN_VERSIONS_SQL,
      [planId],
    );
    return rows.map(mapPlanVersionSummary);
  }

  @Get("plan-versions/:versionId")
  async getPlanVersion(
    @Req() req: Request & RequestContext,
    @Param("versionId") versionId: string,
  ): Promise<PlanVersionDetail> {
    assertCanManageProducts(req);
    return loadPlanVersionDetail(this.pool, versionId);
  }

  @Patch("plan-versions/:versionId")
  async updateDraftVersion(
    @Req() req: Request & RequestContext,
    @Param("versionId") versionId: string,
    @Body() body: UpdateDraftVersionInput,
  ): Promise<PlanVersionDetail> {
    assertCanManageProducts(req);
    const client = await this.rwPool.connect();
    try {
      await client.query("BEGIN");
      const cur = await client.query<{ status: string; is_locked: boolean }>(
        `SELECT status, is_locked FROM product.plan_versions WHERE id = $1 FOR UPDATE`,
        [versionId],
      );
      const row = cur.rows[0];
      if (!row) {
        throw new NotFoundException(`Plan version ${versionId} not found`);
      }
      if (row.status !== "draft" || row.is_locked) {
        throw new BadRequestException(
          "Only an unpublished draft version can be edited",
        );
      }
      if (Array.isArray(body.prices)) {
        for (const p of body.prices) {
          const cycle = p.cycleUnit;
          if (cycle !== "month" && cycle !== "year") {
            throw new BadRequestException(
              `Invalid cycleUnit: ${String(cycle)}`,
            );
          }
          const price = Number(p.price);
          if (!Number.isFinite(price) || price < 0) {
            throw new BadRequestException(`Invalid price for ${cycle}`);
          }
          // 资金类有且只有两位小数（owner 2026-09-03）：列已是 numeric(12,2)，
          // 但多出来的小数由 PG 静默四舍五入等于改了运营录入的数——写侧直接拒绝。
          if (Math.round(price * 100) !== price * 100) {
            throw new BadRequestException(
              `价格最多两位小数（${cycle}：${String(p.price)}）`,
            );
          }
          await client.query(
            `INSERT INTO product.plan_prices
               (id, plan_version_id, cycle_unit, cycle_count, price, currency, created_at)
             VALUES (gen_random_uuid(), $1, $2, 1, $3, 'CNY', now())
             ON CONFLICT (plan_version_id, cycle_unit, cycle_count, currency)
             DO UPDATE SET price = EXCLUDED.price`,
            [versionId, cycle, price],
          );
        }
      }
      if (body.quota && typeof body.quota === "object") {
        assertConsumableShare(body.quota);
        await client.query(
          `UPDATE product.plan_components SET quota = $2::jsonb
            WHERE plan_version_id = $1 AND component_role = 'primary'`,
          [versionId, JSON.stringify(body.quota)],
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    return loadPlanVersionDetail(this.pool, versionId);
  }

  @Post("plan-versions/:versionId/publish")
  @RequireStepUp()
  async publishPlanVersion(
    @Req() req: Request & RequestContext,
    @Param("versionId") versionId: string,
    @Body() body?: { override?: { reason?: string } },
  ): Promise<{ published: true; versionId: string }> {
    assertCanManageProducts(req);
    /* 跳过了哪几项、理由是什么——审计要写，所以提到事务外声明。 */
    let overriddenItems: string[] = [];
    let overrideReason = "";
    const client = await this.rwPool.connect();
    try {
      await client.query("BEGIN");
      /* 连 plan_code / version_no 一起取：审计那一行要写「哪个套餐的第几版」，
         而 resourceId 只认可读码（不许落 uuid）。 */
      const cur = await client.query<{
        plan_id: string;
        status: string;
        plan_code: string;
        version_no: number;
      }>(
        `SELECT pv.plan_id, pv.status, pv.version_no, p.plan_code
           FROM product.plan_versions pv
           JOIN product.plans p ON p.id = pv.plan_id
          WHERE pv.id = $1
          FOR UPDATE OF pv`,
        [versionId],
      );
      const row = cur.rows[0];
      if (!row) {
        throw new NotFoundException(`Plan version ${versionId} not found`);
      }
      if (row.status === "published") {
        throw new BadRequestException("Version is already published");
      }
      // Tier-occupancy guard (90-plan-publishing.md): a product sells at most
      // one live plan per commercial tier — the publishing desk renders tiers
      // as five slots, and two current-published plans in one slot would be
      // two prices for the same shelf position. Same-plan republish (v2 over
      // v1) is exempt: the clash query excludes the plan being published.
      const axis = await client.query<{
        product_id: string;
        tier: string | null;
      }>(
        `SELECT pc.product_id, pc.tier
           FROM product.plan_components pc
          WHERE pc.plan_version_id = $1 AND pc.component_role = 'primary'
          LIMIT 1`,
        [versionId],
      );
      const primaryAxis = axis.rows[0];
      if (primaryAxis?.tier) {
        const clash = await client.query<{ plan_code: string }>(
          `SELECT p2.plan_code
             FROM product.plans p2
             JOIN product.plan_versions cv2
               ON cv2.id = p2.current_version_id AND cv2.status = 'published'
             JOIN product.plan_components pc2
               ON pc2.plan_version_id = cv2.id AND pc2.component_role = 'primary'
            WHERE p2.id <> $3 AND p2.deleted_at IS NULL AND p2.status <> 'deprecated'
              AND pc2.product_id = $1 AND pc2.tier = $2
            LIMIT 1`,
          [primaryAxis.product_id, primaryAxis.tier, row.plan_id],
        );
        if (clash.rows[0]) {
          throw new ConflictException(
            `Tier ${primaryAxis.tier} already has published plan ${clash.rows[0].plan_code} as current — retire or deprecate it first`,
          );
        }
      }
      /*
       * ── 上架检查的 publish 门（owner 2026-09-22 改指这里）──
       *
       * `launch_checklist_items.gate` 有两个值。`launch` 由 opera 在 draft→active
       * 时卡着，一直在用。`publish` 当初是为了卡 `release_stage` 的 developing→beta，
       * 但 **beta 那条线已被 owner 简化为纯展示标签**，于是那道门悬空了——
       * 三项（verification_policy / pricing_set / acceptance）登记着、opera 的抽屉里
       * 还让人勾，而**全仓零读者**。运营勾完以为有用，实际什么都没卡。
       *
       * 按 owner 给的生命周期，它们本来就该卡在「发布套餐」这一步：
       *   开发中 → 接入调试 → 上线（gate='launch'）→ 发布套餐（gate='publish'）
       *
       * 循环自锁在这一版不成立了：`acceptance`（验收）要的端到端订阅链路，现在有
       * `operator_grant` 与**邀请订阅**两条不发布也能开通的路。
       *
       * `coalesce(s.is_satisfied, false)`——没有行的项算未满足，否则「一次都没检查过
       * 的产品」会被判成通过（这条口径照抄 opera 那一侧，不另写）。
       */
      if (primaryAxis?.product_id) {
        const pending = await client.query<{
          item_code: string;
          item_name: string;
        }>(
          `SELECT i.item_code, i.item_name
             FROM product.launch_checklist_items i
             LEFT JOIN product.product_launch_statuses s
               ON s.item_code = i.item_code AND s.product_id = $1
            WHERE i.is_required
              AND i.gate = 'publish'
              AND NOT coalesce(s.is_satisfied, false)
            ORDER BY i.sort ASC`,
          [primaryAxis.product_id],
        );
        if (pending.rowCount) {
          const names = pending.rows.map((r) => r.item_name || r.item_code);
          const reason = body?.override?.reason?.trim() ?? "";
          if (!reason) {
            throw new ConflictException({
              code: "PUBLISH_CHECKLIST_PENDING",
              message: `还有 ${names.length} 项上架检查未满足，不能发布套餐：${names.join("、")}。请在运维台的产品接入页完成，或带理由跳过。`,
              pendingItems: pending.rows.map((r) => r.item_code),
            });
          }
          /*
           * 带理由跳过（owner 2026-09-22）。
           *
           * ── 为什么这道门必须有逃生口 ──
           * 上线门（gate='launch'）一开始就带着 override，而我加 publish 门时**没
           * 照抄这一半**。上线那个 override 的存在本身就是信号：设计它的人早知道
           * 自动检查会卡住真实的上线动作。
           *
           * 装上门的当天就坐实了：`acceptance` 是**自动**检查（登录 → 开通 → 鉴权
           * → 消费 → 失效 五段），生产上四个产品全部未满足（卡在「用量上报」那段），
           * 而且人工勾不掉。于是这道门不是门，是墙——没有任何产品能发布任何套餐。
           *
           * **条件不删也不降级**：删了它以后什么也证明不了。保留门，另开一条写明
           * 理由的路，理由进运营审计（问责台账归 audit_logs，同上线门的口径）。
           */
          overriddenItems = pending.rows.map((r) => r.item_code);
          overrideReason = reason;
        }
      }

      // publish: freeze the version and make it the plan's live version. A
      // prior published version stays 'published' (subscriptions pinned to it
      // keep resolving) — it just stops being current.
      /* `published_at` 就在这里落——运营问的「什么时间启用」只有这一刻能答，
         `created_at` 是草稿何时开的。两列都在 98 的 GRANT 名单里（同批迁移补的）。 */
      await client.query(
        `UPDATE product.plan_versions
            SET status = 'published', is_locked = true, published_at = now()
          WHERE id = $1`,
        [versionId],
      );
      await client.query(
        `UPDATE product.plans SET current_version_id = $2, updated_at = now() WHERE id = $1`,
        [row.plan_id, versionId],
      );
      /*
       * 审计（2026-09-22 补）。**发布此前压根不留痕**——它是这一屏最要紧的动作
       * （决定客户买不到/买得到、且把版本连同 components/prices 一起冻结），也是
       * 少数挂 step-up 的动作之一，而七个已登记的审计动作里偏偏没有它：
       * plan.create / plan.delete / plan.deprecate / plan.visibility /
       * plan_version.create / plan_version.delete / plan_version.bundled.replace
       * 全都写了。「谁在什么时候把哪一版放上货架」查不到，这是个治理洞不是小事。
       */
      await insertOperatorAuditLog(client, req, {
        action: "product.plan_version.publish",
        resourceType: "product_plan_version",
        resourceId: `${row.plan_code} v${row.version_no}`,
        before: { status: row.status, isLocked: false, isCurrent: false },
        after: {
          status: "published",
          isLocked: true,
          isCurrent: true,
          /* 带缺项发布的事实留在台账里：谁、什么时候、跳过了哪几项、为什么。 */
          ...(overriddenItems.length
            ? { overriddenChecklistItems: overriddenItems, overrideReason }
            : {}),
        },
      });
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    return { published: true, versionId };
  }

  /**
   * 删除草稿版本（物理删）。
   *
   * `plan_versions` **没有 `deleted_at`** —— 版本要么在、要么不在，没有软删这一档。
   * 所以这里是真删，而且只对 `draft` 且 `NOT is_locked` 的行：已发布版本被三条
   * §7 触发器钉死（锁守卫拦 components/prices 的增删改、is_locked 不可清除），
   * 要删就得先拆「已发布不可变」这条地基——不做。
   *
   * 当前版本指针也要挡：草稿理论上不会是 `current_version_id`（发布才设指针），
   * 但并发下指针可能刚被挪过来，所以事务内一并复核，不假定。
   *
   * owner 2026-09-18：**所有删除一律 step-up**，不按「草稿不可售所以无害」分级。
   */
  @Delete("plan-versions/:versionId")
  @RequireStepUp()
  async deletePlanVersion(
    @Req() req: Request & RequestContext,
    @Param("versionId") versionId: string,
  ): Promise<{ deleted: true; versionId: string }> {
    assertCanManageProducts(req);
    await withTransaction(this.rwPool, async (client) => {
      const cur = await client.query<{
        plan_id: string;
        plan_code: string;
        version_no: number;
        status: string;
        is_locked: boolean;
        is_current: boolean;
      }>(
        `SELECT pv.plan_id, p.plan_code, pv.version_no, pv.status, pv.is_locked,
                (pv.id = p.current_version_id) AS is_current
           FROM product.plan_versions pv
           JOIN product.plans p ON p.id = pv.plan_id
          WHERE pv.id = $1
          FOR UPDATE OF pv`,
        [versionId],
      );
      const row = cur.rows[0];
      if (!row) {
        throw new NotFoundException(`Plan version ${versionId} not found`);
      }
      if (row.status !== "draft" || row.is_locked) {
        throw new ConflictException(
          `${row.plan_code}@v${row.version_no} is ${row.status}${row.is_locked ? " and locked" : ""} — only an unlocked draft can be deleted`,
        );
      }
      if (row.is_current) {
        throw new ConflictException(
          `${row.plan_code}@v${row.version_no} is the plan's current version`,
        );
      }
      /* prices / components 是 ON DELETE CASCADE 的子行，随版本行一并消失。 */
      await client.query(`DELETE FROM product.plan_versions WHERE id = $1`, [
        versionId,
      ]);
      await insertOperatorAuditLog(client, req, {
        action: "product.plan_version.delete",
        resourceType: "product_plan_version",
        resourceId: `${row.plan_code}@v${row.version_no}`,
        before: { status: row.status, isLocked: row.is_locked },
        after: null,
      });
    });
    return { deleted: true, versionId };
  }

  /**
   * 套餐可删性预检（两步删除第一步）——只读，回一份影响面。
   *
   * 门户据此决定「删除」按钮出不出现：**判据成立才给按钮**，而不是让人点下去
   * 才吃一个 409。形状照 opera 的 `deletion-preview`（`deletable` + `blockers`
   * 原因码 + 计数），两处口径保持一致。
   *
   * 读路由**不 gate step-up**（与 opera 同）——预检本身不改任何东西。
   */
  @Get("plans/:planId/deletable")
  async planDeletable(
    @Req() req: Request & RequestContext,
    @Param("planId") planId: string,
  ): Promise<PlanDeletionImpact> {
    assertCanManageProducts(req);
    const exists = await this.pool.query<{ plan_code: string }>(
      `SELECT plan_code FROM product.plans WHERE id = $1 AND deleted_at IS NULL`,
      [planId],
    );
    if (!exists.rows[0]) {
      throw new NotFoundException(`Plan ${planId} not found`);
    }
    return readPlanDeletionImpact(this.pool, planId);
  }

  /**
   * 删除套餐（两步删除第二步）——**真删，不是软删**（owner 2026-09-22 裁定）。
   *
   * ── 两条路各管什么 ──
   *   退役 deprecate  卖过的套餐**唯一**的路：老订阅仍钉在它的版本上照常解析，
   *                   新客户买不到，行还在、查得到
   *   删除 delete     从来没人订过、没下过单、没被方案绑过 → 它本不该在册，整行删掉
   *
   * 中间那个「软删」态被撤了。它带来的唯一后果是**码位被永久占住**：
   * `uq_plans_plan_code` 是普通唯一约束（不排除软删行），而档位占用检查写的是
   * `deleted_at IS NULL`——两个判据对「软删行算不算」判得不一样。于是删掉一档再想
   * 用回同一个 plan_code：占用检查放你过，INSERT 撞唯一约束抛 23505，运营侧看到的
   * 是一句「Internal server error」。owner 2026-09-22 在 umbra 上撞到这一条。
   *
   * ── 为什么敢直接 DELETE ──
   * `readPlanDeletionImpact` 检的那三条，**正好就是硬删会撞的三个无 CASCADE 外键**：
   *   metering.subscriptions.plan_version_id   在订阅
   *   billing.orders.plan_version_id           订单历史
   *   product.solution_plans.plan_id           方案绑定
   * 而 plan_versions（plan_id CASCADE）、plan_prices / plan_components
   * （plan_version_id CASCADE）是子行，随删。也就是说这道门本来就是按硬删写的，
   * 只有最后那一句是软删——本次是让语句跟它自己的判据对齐。
   *
   * `fk_plans_current_version`（plans.current_version_id → plan_versions.id）无需
   * 先清空：它是 NO ACTION，在**语句末**校验，那时 plans 那一行已经不在了。
   *
   * 事务内 `FOR UPDATE` 之后**再复核一次**判据：预检与执行之间新产生的订阅要挡住
   * （TOCTOU）。
   *
   * 注意 `plans.deleted_at` 这一列**没有退役**：opera 删产品时会连带软删它名下的
   * 套餐（`product-catalog.router.ts`，那条路径上产品行本身也是软删）。所以读路径
   * 的 `deleted_at IS NULL` 过滤一律保留。两条路径的口径差异已报 owner。
   */
  @Delete("plans/:planId")
  @RequireStepUp()
  async deletePlan(
    @Req() req: Request & RequestContext,
    @Param("planId") planId: string,
    @Body() body: PlanDeleteBody,
  ): Promise<{ deleted: true; planCode: string }> {
    assertCanManageProducts(req);
    /* 服务端也要显式确认——两步删除的第二步不该被一个漏参的 DELETE 顶穿。 */
    if (body?.confirm !== true) {
      throw new BadRequestException(
        "delete requires confirm=true (two-step deletion)",
      );
    }
    let planCode = "";
    await withTransaction(this.rwPool, async (client) => {
      const cur = await client.query<{
        id: string;
        plan_code: string;
        status: string;
      }>(
        `SELECT id, plan_code, status FROM product.plans
          WHERE id = $1 AND deleted_at IS NULL
          FOR UPDATE`,
        [planId],
      );
      const row = cur.rows[0];
      if (!row) {
        throw new NotFoundException(`Plan ${planId} not found`);
      }
      planCode = row.plan_code;
      /* 事务内复核（防 TOCTOU）——预检那次的结论在这里不算数。 */
      const impact = await readPlanDeletionImpact(client, planId);
      if (!impact.deletable) {
        throw new ConflictException(
          `${row.plan_code} has customer footprint (${impact.blockers.join(", ")}) — deprecate it instead`,
        );
      }
      /* 审计先写：行删掉之后 plan_code 就查不回来了，而它是这条日志的 resourceId。 */
      await insertOperatorAuditLog(client, req, {
        action: "product.plan.delete",
        resourceType: "product_plan",
        resourceId: row.plan_code,
        before: { status: row.status, exists: true },
        after: { exists: false },
      });
      const gone = await client.query(
        `DELETE FROM product.plans WHERE id = $1`,
        [planId],
      );
      /* 上面 FOR UPDATE 已经把行锁住了，删不掉只能是判据与外键不一致——那是缺陷，
         不是并发。抛出去让事务回滚，别静默返回 deleted: true。 */
      if (gone.rowCount !== 1) {
        throw new ConflictException(
          `${row.plan_code} 未被删除（影响 ${gone.rowCount ?? 0} 行）——判据与外键约束不一致`,
        );
      }
    });
    return { deleted: true, planCode };
  }

  /**
   * 退役一档：`status = deprecated`，套餐连同它的全部版本退出主视线。
   *
   * 与软删的分工见 `deletePlan` 的头注。退役**不要求无足迹**——正相反，卖过的
   * 套餐只有这一条路：老订阅仍钉在它的版本上照常解析，新客户买不到。
   *
   * 它同时让开档位：`PLAN_TIER_AXIS_OCCUPANCY_SQL` 写着
   * `p.status <> 'deprecated'`，所以退役之后同产品同档可以重新建套餐。
   *
   * 不是删除，但与 publish 同风险级（都改「客户买得到什么」），照它挂 step-up。
   */
  /**
   * 订阅方式开关：公开订阅 ⇄ 邀请订阅（`product.plans.is_public`）。
   *
   * ── 为什么要有这条路由 ──
   * 这一列此前**没有任何写路径**：INSERT 时硬编码 `true`，全仓没有一条 UPDATE
   * 碰它。于是「把某个套餐设成邀请制」只能写迁移——而发券那一侧（卡券 `invite`
   * 型 + console 的邀请解锁）已经做完了，整条链缺的就是这个开关。运营既看不见
   * 也改不了，一个已经能用的机制等于不存在。
   *
   * ── 翻过去会发生什么（运营要知道的） ──
   * 改成邀请订阅后，这一档从客户的套餐阶梯里消失，只有持有效邀请的人看得见、
   * 买得到。**已有订阅不受影响，续订也不受影响**（console 侧的邀请闸门对
   * 「续自己手上这一档」有例外）。所以返回值带上活订阅数，让确认框能把影响面
   * 说清楚，而不是让运营自己去别处对。
   *
   * 列锁无需变更：`is_public` 本来就在 98 给 platform_svc 的 GRANT 名单里。
   */
  /**
   * 改套餐的可改字段（owner 2026-09-22 裁定：A 类字段开放编辑）。
   *
   * ── 为什么这些能改、那些不能 ──
   * 冻结是**两层**，而这一层从来没被锁过：三条 §7 触发器钉的是 `plan_versions` 及
   * 其以下（components / prices / trial），`product.plans` 这一层**没有任何触发器**，
   * 98 的 GRANT 也放行。所以「已发布不能改」里，名称/描述/可见性这部分不是被禁止，
   * 是**一直没有入口**。
   *
   * 放行的判据是「改它会不会动客户的契约」：
   *   plan_name / description   只换显示名。历史单据不受影响——
   *                             `billing.invoice_items.item_name` 是下单时快照。
   *   is_customer_visible       展示轴：显不显示
   *   is_workforce_visible      运营端展示轴
   * 而 quota / features / 价格 / tier / trial 决定「拿到什么、付多少」，仍由触发器
   * 钉死：要改就开新版本。
   *
   * `is_public`（能不能自助买）不在这里——它是商务开关，有自己的两向确认与 step-up，
   * 走 `plans/:planId/visibility`。两根轴是 DDL 明写的正交轴，不要合并：
   *   is_public=false + is_customer_visible=true  → 邀请档（不公开卖，持券的看得见）
   *   is_public=true  + is_customer_visible=false → 能买但不列出
   *
   * 已退役的套餐不给改：它已经下架，改它只会让人以为还在卖（同 visibility 那条）。
   * 不挂 step-up——改显示名不改「客户买得到什么」，与退役/发布/改售卖方式不同级。
   */
  @Patch("plans/:planId")
  async updatePlan(
    @Req() req: Request & RequestContext,
    @Param("planId") planId: string,
    @Body()
    body: {
      planName?: unknown;
      description?: unknown;
      isCustomerVisible?: unknown;
      isWorkforceVisible?: unknown;
    },
  ): Promise<{ planCode: string; updated: string[] }> {
    assertCanManageProducts(req);

    const sets: string[] = [];
    const values: unknown[] = [planId];
    const updated: string[] = [];
    const text = (v: unknown, field: string, max: number): string => {
      if (typeof v !== "string") {
        throw new BadRequestException(`${field} must be a string`);
      }
      const t = v.trim();
      if (t.length > max) {
        throw new BadRequestException(`${field} exceeds ${max} characters`);
      }
      return t;
    };

    if (body.planName !== undefined) {
      const name = text(body.planName, "planName", 128);
      if (!name) throw new BadRequestException("planName cannot be empty");
      values.push(name);
      sets.push(`plan_name = $${values.length}`);
      updated.push("planName");
    }
    if (body.description !== undefined) {
      /* 空串 = 清掉说明，是合法意图；落 NULL 与「没填过」同态。 */
      const desc = text(body.description, "description", 4000);
      values.push(desc || null);
      sets.push(`description = $${values.length}`);
      updated.push("description");
    }
    for (const [key, column] of [
      ["isCustomerVisible", "is_customer_visible"],
      ["isWorkforceVisible", "is_workforce_visible"],
    ] as const) {
      const raw = (body as Record<string, unknown>)[key];
      if (raw === undefined) continue;
      if (typeof raw !== "boolean") {
        throw new BadRequestException(`${key} must be a boolean`);
      }
      values.push(raw);
      sets.push(`${column} = $${values.length}`);
      updated.push(key);
    }
    if (sets.length === 0) {
      throw new BadRequestException("no editable field supplied");
    }

    let planCode = "";
    await withTransaction(this.rwPool, async (client) => {
      const cur = await client.query<{
        plan_code: string;
        plan_name: string;
        description: string | null;
        is_customer_visible: boolean;
        is_workforce_visible: boolean;
        status: string;
      }>(
        `SELECT plan_code, plan_name, description, is_customer_visible,
                is_workforce_visible, status
           FROM product.plans
          WHERE id = $1 AND deleted_at IS NULL
          FOR UPDATE`,
        [planId],
      );
      const row = cur.rows[0];
      if (!row) throw new NotFoundException(`Plan ${planId} not found`);
      planCode = row.plan_code;
      if (row.status === "deprecated") {
        throw new BadRequestException(`${row.plan_code} 已退役，不能再改`);
      }

      values.push(req.user!.id);
      await client.query(
        `UPDATE product.plans
            SET ${sets.join(", ")}, updated_by = $${values.length}, updated_at = now()
          WHERE id = $1`,
        values,
      );
      await insertOperatorAuditLog(client, req, {
        action: "product.plan.update",
        resourceType: "product_plan",
        resourceId: row.plan_code,
        before: {
          planName: row.plan_name,
          description: row.description,
          isCustomerVisible: row.is_customer_visible,
          isWorkforceVisible: row.is_workforce_visible,
        },
        after: Object.fromEntries(
          updated.map((k) => [k, (body as Record<string, unknown>)[k]]),
        ),
      });
    });
    return { planCode, updated };
  }

  @Patch("plans/:planId/visibility")
  @RequireStepUp()
  async setPlanVisibility(
    @Req() req: Request & RequestContext,
    @Param("planId") planId: string,
    @Body() body: { isPublic?: unknown },
  ): Promise<{
    planCode: string;
    isPublic: boolean;
    subscriptionCount: number;
  }> {
    assertCanManageProducts(req);
    if (typeof body?.isPublic !== "boolean") {
      throw new BadRequestException("isPublic must be a boolean");
    }
    const isPublic = body.isPublic;

    let planCode = "";
    let subscriptionCount = 0;
    await withTransaction(this.rwPool, async (client) => {
      const cur = await client.query<{
        plan_code: string;
        is_public: boolean;
        status: string;
        subscription_count: number;
      }>(
        `SELECT p.plan_code, p.is_public, p.status,
                (SELECT count(*)::int
                   FROM metering.subscriptions s
                   JOIN product.plan_versions pv ON pv.id = s.plan_version_id
                  WHERE pv.plan_id = p.id AND s.deleted_at IS NULL)
                  AS subscription_count
           FROM product.plans p
          WHERE p.id = $1 AND p.deleted_at IS NULL
          FOR UPDATE OF p`,
        [planId],
      );
      const row = cur.rows[0];
      if (!row) throw new NotFoundException(`Plan ${planId} not found`);
      planCode = row.plan_code;
      subscriptionCount = Number(row.subscription_count ?? 0);

      /* 已退役的套餐不该再改售卖方式：它已经下架，改它只会让人以为还在卖。 */
      if (row.status === "deprecated") {
        throw new BadRequestException(
          `${row.plan_code} 已退役，不能再改订阅方式`,
        );
      }
      if (row.is_public === isPublic) {
        /* 幂等：已经是这个状态就原样回，不写审计（没有发生变更）。 */
        return;
      }

      await client.query(
        `UPDATE product.plans
            SET is_public = $2, updated_by = $3, updated_at = now()
          WHERE id = $1`,
        [planId, isPublic, req.user!.id],
      );
      await insertOperatorAuditLog(client, req, {
        action: "product.plan.visibility",
        resourceType: "product_plan",
        resourceId: row.plan_code,
        before: { isPublic: row.is_public },
        after: { isPublic },
      });
    });
    return { planCode, isPublic, subscriptionCount };
  }

  @Post("plans/:planId/deprecate")
  @RequireStepUp()
  async deprecatePlan(
    @Req() req: Request & RequestContext,
    @Param("planId") planId: string,
  ): Promise<{ deprecated: true; planCode: string }> {
    assertCanManageProducts(req);
    let planCode = "";
    await withTransaction(this.rwPool, async (client) => {
      const cur = await client.query<{ plan_code: string; status: string }>(
        `SELECT plan_code, status FROM product.plans
          WHERE id = $1 AND deleted_at IS NULL
          FOR UPDATE`,
        [planId],
      );
      const row = cur.rows[0];
      if (!row) {
        throw new NotFoundException(`Plan ${planId} not found`);
      }
      planCode = row.plan_code;
      if (row.status === "deprecated") {
        throw new BadRequestException(`${row.plan_code} is already deprecated`);
      }
      await client.query(
        `UPDATE product.plans
            SET status = 'deprecated', updated_by = $2, updated_at = now()
          WHERE id = $1`,
        [planId, req.user!.id],
      );
      await insertOperatorAuditLog(client, req, {
        action: "product.plan.deprecate",
        resourceType: "product_plan",
        resourceId: row.plan_code,
        before: { status: row.status },
        after: { status: "deprecated" },
      });
    });
    return { deprecated: true, planCode };
  }

  /**
   * 配额候选清单：平台级键 + 该产品自己登记的键，合并成一份带归属的选项表。
   *
   * 这是草稿编辑器那两列穿梭选择器的数据源——**为的是不再让运营手写 JSON**。
   * 两组必须分开标：写进 WS 共享键是往跨产品共用的池贡献额度，本产品键只进
   * 自己的池。而这条边界不是界面上的分类习惯，是库强制的：
   * `trg_product_metrics_no_platform_shadow` 不许产品在自己的 `product_metrics`
   * 里声明平台已有的键。
   *
   * `platform_metrics.status='reserved'` 的行照回，但标出来——它们已登记、尚不可用，
   * 藏起来会让人以为键不存在而去产品侧另造一个同名的（那会被上面那条触发器拒）。
   */
  @Get("products/:productCode/metric-options")
  async listMetricOptions(
    @Req() req: Request & RequestContext,
    @Param("productCode") productCode: string,
  ): Promise<MetricOption[]> {
    assertCanManageProducts(req);
    const code = decodeURIComponent(productCode);
    const product = await this.pool.query<{ id: string }>(
      `SELECT id FROM product.products WHERE product_code = $1 AND deleted_at IS NULL`,
      [code],
    );
    if (!product.rows[0]) {
      throw new NotFoundException({
        message: `Product ${code} not found`,
        field: "productCode",
      });
    }
    const { rows } = await this.pool.query<MetricOptionRow>(
      METRIC_OPTIONS_SQL,
      [product.rows[0].id],
    );
    return rows.map((row) => ({
      metricKey: row.metric_key,
      scope: row.scope === "platform" ? "platform" : "product",
      kind: row.kind,
      mergeStrategy: row.merge_strategy,
      consumeMode: row.consume_mode,
      metricUnit: row.metric_unit,
      resetPeriod: row.reset_period,
      reserved: row.reserved,
    }));
  }

  /**
   * Full replace of a draft version's bundled component set (PUT semantics,
   * 30-management-api.md §1: what is sent is what remains; an empty list clears).
   *
   * Owner decision 2026-08-30: atlas / runos are infrastructure products with no
   * customer plans of their own — their quota reaches a workspace ONLY as a
   * bundled component inside a subscription product's plan version. Seed writes
   * primary rows only, so this is the single entry point for that wiring.
   * Step-up gated like publish: bundled quota is sold value (product_220 §2).
   */
  @Put("plan-versions/:versionId/bundled-components")
  @RequireStepUp()
  async replaceBundledComponents(
    @Req() req: Request & RequestContext,
    @Param("versionId") versionId: string,
    @Body() body: ReplaceBundledComponentsInput,
  ): Promise<PlanVersionDetail> {
    assertCanManageProducts(req);
    const items = readBundledComponentInputs(body);
    try {
      await withTransaction(this.rwPool, async (client) => {
        const version = await lockDraftPlanVersion(client, versionId);
        const primary = await loadPrimaryComponent(client, versionId);
        const resolved = await resolveBundledComponents(client, items, primary);
        const before = await client.query<BundledComponentAudit>(
          `SELECT p.product_code AS "productCode", pc.quota, pc.features, pc.priority
             FROM product.plan_components pc
             JOIN product.products p ON p.id = pc.product_id
            WHERE pc.plan_version_id = $1 AND pc.component_role = 'bundled'
            ORDER BY pc.sort_order ASC`,
          [versionId],
        );
        await client.query(
          `DELETE FROM product.plan_components
            WHERE plan_version_id = $1 AND component_role = 'bundled'`,
          [versionId],
        );
        for (const [index, item] of resolved.entries()) {
          await client.query(
            `INSERT INTO product.plan_components
               (id, plan_version_id, product_id, tier, component_role, priority, features, quota, sort_order, created_at)
             VALUES (gen_random_uuid(), $1, $2, NULL, 'bundled', $3, $4::text[], $5::jsonb, $6, now())`,
            [
              versionId,
              item.productId,
              item.priority,
              item.features,
              JSON.stringify(item.quota),
              index,
            ],
          );
        }
        await insertOperatorAuditLog(client, req, {
          action: "product.plan_version.bundled.replace",
          resourceType: "product_plan_version",
          resourceId: `${version.plan_code}@v${version.version_no}`,
          before: before.rows,
          after: resolved.map<BundledComponentAudit>((item) => ({
            productCode: item.productCode,
            quota: item.quota,
            features: item.features,
            priority: item.priority,
          })),
        });
      });
    } catch (error) {
      // P0001 = a §7 trigger RAISEd (lock guard / bundled-before-primary priority
      // rule). Both are pre-checked above; if one still fires it is a concurrent
      // publish or primary edit, i.e. a state conflict rather than bad input.
      if (pgErrorCode(error) === "P0001") {
        throw new ConflictException(
          error instanceof Error ? error.message : "Plan version changed",
        );
      }
      throw error;
    }
    return loadPlanVersionDetail(this.pool, versionId);
  }

  // ── plan publishing desk (product × tier matrix; 90-plan-publishing.md) ───

  /**
   * The publishing desk read model: every standalone-subscribable product with
   * its plans laid on the five-tier commercial ladder. A plan's product/tier
   * axis comes from its current version's primary component (falling back to
   * the newest version for never-published skeletons), so a draft-only plan is
   * visible on the desk — /releases only ever shows published versions.
   */
  @Get("plan-matrix")
  async listPlanMatrix(
    @Req() req: Request & RequestContext,
    @Query("include") include?: string,
  ): Promise<PlanMatrixProduct[]> {
    assertCanManageProducts(req);
    /* 默认收起已退役的套餐：退役=「这一档不卖了」,它连同全部版本退出主视线,
       但**不是删除**——老订阅仍钉在它的版本上照常解析,所以行还在、查得到。
       `?include=deprecated` 让二级页的「已退役」分区把它们取回来。
       开关写成 ($1::bool OR ...) 而不是拼 SQL:一插值 lint:anchor-writes
       就抽不到列名、当场变瞎且恒绿。 */
    const includeDeprecated = include === "deprecated";
    const { rows } = await this.pool.query<PlanMatrixRow>(PLAN_MATRIX_SQL, [
      includeDeprecated,
    ]);
    return groupPlanMatrix(rows);
  }

  /**
   * Create a plan skeleton on an empty tier slot: the plan row, its v1 draft
   * version and the primary component (tier axis) in one unit. Prices and
   * quota are edited on the draft afterwards; nothing is sellable until the
   * draft is published, so no step-up here — publish carries it.
   */
  @Post("plans")
  async createPlan(
    @Req() req: Request & RequestContext,
    @Body() body: CreatePlanInput,
  ): Promise<PlanVersionDetail> {
    assertCanManageProducts(req);
    const input = readCreatePlanInput(body);
    let draftId = "";
    try {
      await withTransaction(this.rwPool, async (client) => {
        const product = await client.query<{
          id: string;
          product_code: string;
          standalone_subscribable: boolean;
        }>(
          `SELECT id, product_code, standalone_subscribable
             FROM product.products
            WHERE product_code = $1 AND deleted_at IS NULL
            FOR UPDATE`,
          [input.productCode],
        );
        const productRow = product.rows[0];
        if (!productRow) {
          throw new NotFoundException({
            message: `Product ${input.productCode} not found`,
            field: "productCode",
          });
        }
        if (!productRow.standalone_subscribable) {
          throw new BadRequestException(
            `Product ${input.productCode} is not standalone-subscribable — it reaches customers only as a bundled component`,
          );
        }
        const occupied = await client.query<{ plan_code: string }>(
          PLAN_TIER_AXIS_OCCUPANCY_SQL,
          [productRow.id, input.tier],
        );
        if (occupied.rows[0]) {
          throw new ConflictException(
            `Tier ${input.tier} of ${productRow.product_code} is already covered by plan ${occupied.rows[0].plan_code}`,
          );
        }
        const plan = await client.query<{ id: string }>(
          `INSERT INTO product.plans
             (id, plan_code, plan_name, description, is_public, status, created_by, updated_by, created_at, updated_at)
           VALUES (gen_random_uuid(), $1, $2, $3, true, 'active', $4, $4, now(), now())
           RETURNING id`,
          [input.planCode, input.planName, input.description, req.user!.id],
        );
        const version = await client.query<{ id: string }>(
          `INSERT INTO product.plan_versions
             (id, plan_id, version_no, status, is_locked, created_by, created_at)
           VALUES (gen_random_uuid(), $1, 1, 'draft', false, $2, now())
           RETURNING id`,
          [plan.rows[0]!.id, req.user!.id],
        );
        draftId = version.rows[0]!.id;
        await client.query(
          `INSERT INTO product.plan_components
             (id, plan_version_id, product_id, tier, component_role, priority, features, quota, sort_order, created_at)
           VALUES (gen_random_uuid(), $1, $2, $3, 'primary', 100, '{}'::text[], '{}'::jsonb, 0, now())`,
          [draftId, productRow.id, input.tier],
        );
        await insertOperatorAuditLog(client, req, {
          action: "product.plan.create",
          resourceType: "product_plan",
          resourceId: input.planCode,
          after: {
            planCode: input.planCode,
            planName: input.planName,
            productCode: productRow.product_code,
            tier: input.tier,
          },
        });
      });
    } catch (error) {
      if (pgErrorCode(error) === "23505") {
        throw new ConflictException(
          `Plan code ${input.planCode} already exists`,
        );
      }
      throw error;
    }
    return loadPlanVersionDetail(this.pool, draftId);
  }

  /**
   * Open the next draft version of a plan, cloned from the current published
   * version (or the newest version when nothing is published yet): components,
   * prices and trial config all carry over, so an operator edits a delta
   * instead of retyping the whole grant. One draft in flight per plan — a
   * second one would make "the draft" ambiguous for every editor endpoint.
   *
   * ── 主版本号（owner 2026-09-22） ──
   * `majorNo` 由调用方给，**缺省沿用源版本的**——绝大多数新草稿是小改（调一两个
   * 配额、价格不变），那就还在同一个商业代际里，于是同一 V1 下会有多个日期修订。
   * 价格或档位结构变了才升位，而升位是**人的决定**，不是自增：所以这里不自动 +1。
   * 显式给的值只许 ≥ 源版本（代际不能倒退），且必须 ≥ 1。
   */
  @Post("plans/:planId/versions")
  async createDraftVersion(
    @Req() req: Request & RequestContext,
    @Param("planId") planId: string,
    @Body() body?: { majorNo?: unknown },
  ): Promise<PlanVersionDetail> {
    assertCanManageProducts(req);
    let requestedMajor: number | null = null;
    if (body?.majorNo !== undefined && body.majorNo !== null) {
      if (
        typeof body.majorNo !== "number" ||
        !Number.isInteger(body.majorNo) ||
        body.majorNo < 1
      ) {
        throw new BadRequestException("majorNo must be an integer >= 1");
      }
      requestedMajor = body.majorNo;
    }
    let draftId = "";
    await withTransaction(this.rwPool, async (client) => {
      const plan = await client.query<{
        id: string;
        plan_code: string;
        current_version_id: string | null;
      }>(
        `SELECT id, plan_code, current_version_id
           FROM product.plans
          WHERE id = $1 AND deleted_at IS NULL
          FOR UPDATE`,
        [planId],
      );
      const planRow = plan.rows[0];
      if (!planRow) {
        throw new NotFoundException(`Plan ${planId} not found`);
      }
      const draft = await client.query<{ version_no: number }>(
        `SELECT version_no FROM product.plan_versions
          WHERE plan_id = $1 AND status = 'draft' AND NOT is_locked
          ORDER BY version_no DESC
          LIMIT 1`,
        [planId],
      );
      if (draft.rows[0]) {
        throw new ConflictException(
          `Plan ${planRow.plan_code} already has draft v${draft.rows[0].version_no} — edit or publish it first`,
        );
      }
      const source = await client.query<{
        id: string;
        version_no: number;
        major_no: number | null;
        trial_cycle_unit: string | null;
        trial_cycle_count: number | null;
        max_no: number;
      }>(
        `SELECT v.id, v.version_no, v.major_no, v.trial_cycle_unit, v.trial_cycle_count,
                (SELECT max(version_no) FROM product.plan_versions WHERE plan_id = $1) AS max_no
           FROM product.plan_versions v
          WHERE v.plan_id = $1
          ORDER BY (v.id = $2) DESC, v.version_no DESC
          LIMIT 1`,
        [planId, planRow.current_version_id],
      );
      const sourceRow = source.rows[0];
      if (!sourceRow) {
        throw new ConflictException(
          `Plan ${planRow.plan_code} has no versions to clone from`,
        );
      }
      const nextNo = sourceRow.max_no + 1;
      const sourceMajor = Number(sourceRow.major_no ?? 1);
      if (requestedMajor !== null && requestedMajor < sourceMajor) {
        throw new BadRequestException(
          `majorNo ${requestedMajor} 低于当前 V${sourceMajor}——商业代际不能倒退`,
        );
      }
      const majorNo = requestedMajor ?? sourceMajor;
      const version = await client.query<{ id: string }>(
        `INSERT INTO product.plan_versions
           (id, plan_id, version_no, major_no, status, is_locked, trial_cycle_unit, trial_cycle_count, created_by, created_at)
         VALUES (gen_random_uuid(), $1, $2, $6, 'draft', false, $3, $4, $5, now())
         RETURNING id`,
        [
          planId,
          nextNo,
          sourceRow.trial_cycle_unit,
          sourceRow.trial_cycle_count,
          req.user!.id,
          majorNo,
        ],
      );
      draftId = version.rows[0]!.id;
      await client.query(
        `INSERT INTO product.plan_components
           (id, plan_version_id, product_id, tier, component_role, source_profile_code, priority, features, quota, sort_order, created_at)
         SELECT gen_random_uuid(), $2, product_id, tier, component_role, source_profile_code, priority, features, quota, sort_order, now()
           FROM product.plan_components
          WHERE plan_version_id = $1`,
        [sourceRow.id, draftId],
      );
      await client.query(
        `INSERT INTO product.plan_prices
           (id, plan_version_id, cycle_unit, cycle_count, price, currency, created_at)
         SELECT gen_random_uuid(), $2, cycle_unit, cycle_count, price, currency, now()
           FROM product.plan_prices
          WHERE plan_version_id = $1`,
        [sourceRow.id, draftId],
      );
      await insertOperatorAuditLog(client, req, {
        action: "product.plan_version.create",
        resourceType: "product_plan_version",
        resourceId: `${planRow.plan_code}@v${nextNo}`,
        before: { clonedFromVersionNo: sourceRow.version_no },
        after: { planCode: planRow.plan_code, versionNo: nextNo },
      });
    });
    return loadPlanVersionDetail(this.pool, draftId);
  }
}

// ── plan version lifecycle: types · SQL · loaders (product_320) ─────────────

/**
 * 套餐可删性影响面。形状对齐 opera 的 `ProductDeletionImpact`（deletable +
 * blockers 原因码）——两处是同一件事的两个入口，口径不该各说各话。
 */
export interface PlanDeletionImpact {
  deletable: boolean;
  /** 挡住删除的原因码（deletable=false 时非空），供门户直接给出去处。 */
  blockers: string[];
  /** 该套餐**全部版本**上钉过的订阅数（含已软删——卖过就是卖过）。 */
  subscriptions: number;
  /** 引用该套餐任一版本的订单数（订单是钱的台账，只增不减）。 */
  orders: number;
  /** 绑定该套餐的服务方案档位数（solution_plans.plan_id 唯一，至多 1）。 */
  solutionBindings: number;
}

/** DELETE /plans/:planId body —— 两步删除的第二步显式确认。 */
export interface PlanDeleteBody {
  confirm?: boolean;
}

/**
 * 配额候选项：平台级键与产品自有键归一成同一形状，靠 `scope` 分组。
 *
 * 两组的差别不是分类习惯，是库强制的边界：
 * `trg_product_metrics_no_platform_shadow` 不许产品在自己的 `product_metrics`
 * 里声明 `platform_metrics` 已有的键。所以同一个 metricKey 不可能两边都出现。
 */
export interface MetricOption {
  metricKey: string;
  /** platform = 跨产品共用一个池；product = 只进这个产品自己的池。 */
  scope: "platform" | "product";
  /** platform_metrics.kind（counter/gauge）；产品自有键为 null。 */
  kind: string | null;
  /** product_metrics.merge_strategy（max/union/pool/tiered）；平台键为 null。 */
  mergeStrategy: string | null;
  consumeMode: string | null;
  metricUnit: string | null;
  resetPeriod: string;
  /** 平台键已登记但尚不可用（status='reserved'）。照回但要标出来—— */
  /** 藏起来会让人以为键不存在，转去产品侧另造一个同名的，那会被触发器拒。 */
  reserved: boolean;
}

interface MetricOptionRow {
  metric_key: string;
  scope: string;
  kind: string | null;
  merge_strategy: string | null;
  consume_mode: string | null;
  metric_unit: string | null;
  reset_period: string;
  reserved: boolean;
}

/**
 * 配额候选：两张登记表 UNION 成一份清单。
 *
 * `platform_metrics` 是平台级、不属于任何产品，所以不带 product_id 条件；
 * `product_metrics` 只取这一个产品的。ORDER BY 把 platform 排在前面
 * （字典序 platform < product），与编辑器左栏「WS 共享 / 本产品」的分组同序。
 */
const METRIC_OPTIONS_SQL = `
  SELECT metric_key,
         'platform' AS scope,
         kind,
         NULL::varchar AS merge_strategy,
         consume_mode,
         metric_unit,
         reset_period,
         (status = 'reserved') AS reserved
    FROM product.platform_metrics
   UNION ALL
  SELECT metric_key,
         'product' AS scope,
         NULL::varchar AS kind,
         merge_strategy,
         consume_mode,
         metric_unit,
         reset_period,
         false AS reserved
    FROM product.product_metrics
   WHERE product_id = $1
   ORDER BY scope ASC, metric_key ASC
`;

/**
 * 三条判据：卖过的套餐不能删，只能退役。
 *
 * **订阅与订单都经该套餐的全部版本反查**，不是只看 `current_version_id`——
 * 一个卖过 v1、又开了 v2 的套餐，current 指向 v2，只看 current 会把它误判成
 * 可删，而 v1 上还钉着老客户。
 *
 * **不滤 `deleted_at`**：软删一条订阅不等于它没卖过；订单更是只增不减的钱账。
 * 判据问的是「这个套餐有没有客户足迹」，答案一旦为真就永远为真。
 *
 * 子行（plan_prices / plan_components）是 ON DELETE CASCADE，不构成阻挡；
 * `plans.current_version_id` 是自指针，也不算外部引用。
 */
async function readPlanDeletionImpact(
  db: Pick<Pool, "query"> | Pick<PoolClient, "query">,
  planId: string,
): Promise<PlanDeletionImpact> {
  const { rows } = await db.query<{
    subscriptions: string;
    orders: string;
    solution_bindings: string;
  }>(
    `SELECT
       (SELECT count(*) FROM metering.subscriptions s
          JOIN product.plan_versions pv ON pv.id = s.plan_version_id
         WHERE pv.plan_id = $1) AS subscriptions,
       (SELECT count(*) FROM billing.orders o
          JOIN product.plan_versions pv ON pv.id = o.plan_version_id
         WHERE pv.plan_id = $1) AS orders,
       (SELECT count(*) FROM product.solution_plans sp
         WHERE sp.plan_id = $1) AS solution_bindings`,
    [planId],
  );
  const row = rows[0];
  const subscriptions = Number(row?.subscriptions ?? 0);
  const orders = Number(row?.orders ?? 0);
  const solutionBindings = Number(row?.solution_bindings ?? 0);
  const blockers: string[] = [];
  if (subscriptions > 0) blockers.push("HAS_SUBSCRIPTIONS");
  if (orders > 0) blockers.push("HAS_ORDERS");
  if (solutionBindings > 0) blockers.push("HAS_SOLUTION_BINDING");
  return {
    deletable: blockers.length === 0,
    blockers,
    subscriptions,
    orders,
    solutionBindings,
  };
}
interface PlanVersionPrice {
  cycleUnit: string;
  price: string;
}

interface PlanVersionSummary {
  id: string;
  versionNo: number;
  /**
   * 主版本号 V1/V2…——**人设定的商业代际**，不自增（owner 2026-09-22）。
   * 价格或档位结构变了才升；只改配额这类小改沿用当前主版本，于是同一 V1 下可以
   * 有多个日期修订。`versionNo` 仍是内部身份（唯一键、排序、详情路由都拄它）。
   */
  majorNo: number;
  status: string;
  isLocked: boolean;
  isCurrent: boolean;
  /** ISO timestamp — the version timeline is unreadable without a date axis. */
  createdAt: string;
  /**
   * 发布（启用）那一刻；`null` = 还没发布，或发布于本列上线之前。
   *
   * 「什么时间启用」只有这一刻能答——`createdAt` 是草稿何时开的，是另一个时刻。
   * 存量已发布版本没有这个时刻可考，界面显示「—」，**不拿 createdAt 冒充**。
   */
  publishedAt: string | null;
  prices: PlanVersionPrice[];
  /**
   * 还钉在这一版上的订阅数（不含已软删）。
   *
   * 版本史要把「当前在售 / 仍在服务 / 已停用」分开呈现,而 plan_versions.status
   * 只有 draft|published 两个值——第三、四态靠这个计数与 isCurrent 一起判出来,
   * 不新增存储态（那会和 current_version_id 长出第二份真相）。
   *
   * 注意它与删除判据口径不同:那边问「卖过没有」(含软删、含订单),这边问
   * 「现在还有没有人钉着」。
   */
  subscriptionCount: number;
}

/** One plan_components row as the editor sees it (primary and bundled alike). */
export interface PlanVersionComponent {
  productCode: string;
  productName: string;
  componentRole: string;
  /** Commercial tier — primary only; bundled rows carry null (D6). */
  tier: string | null;
  quota: Record<string, unknown>;
  features: string[];
  priority: number;
}

export interface PlanVersionDetail extends PlanVersionSummary {
  planId: string;
  planCode: string;
  planName: string;
  /** product_code of the primary component; null when the version has none. */
  productCode: string | null;
  /** Primary component quota — kept flat for the existing PATCH editor. */
  quota: Record<string, unknown>;
  /** Every component of the version, primary first, then bundled by sort_order. */
  components: PlanVersionComponent[];
}

interface UpdateDraftVersionInput {
  prices?: { cycleUnit?: unknown; price?: unknown }[];
  /** 主组件 quota jsonb 整体替换；`_pricing.consumable_share`（α，product_330 §4.1）随其中。 */
  quota?: Record<string, unknown>;
}

/**
 * product_330 §4.1：`quota._pricing.consumable_share` 是升级折抵的 α，
 * 折抵引擎按 [0,1] 加权——越界值会把折抵算成负数或超额，写侧直接拒。
 */
function assertConsumableShare(quota: Record<string, unknown>): void {
  const pricing = quota._pricing;
  if (pricing === undefined || pricing === null) return;
  if (typeof pricing !== "object" || Array.isArray(pricing)) {
    throw new BadRequestException("quota._pricing must be an object");
  }
  const share = (pricing as Record<string, unknown>).consumable_share;
  if (share === undefined || share === null) return;
  if (
    typeof share !== "number" ||
    !Number.isFinite(share) ||
    share < 0 ||
    share > 1
  ) {
    throw new BadRequestException(
      "quota._pricing.consumable_share must be a number between 0 and 1",
    );
  }
}

/** PUT /plan-versions/:id/bundled-components body (full replace). */
export interface ReplaceBundledComponentsInput {
  components?: {
    productCode?: unknown;
    quota?: unknown;
    features?: unknown;
    priority?: unknown;
  }[];
}

/** Validated bundled component input — not yet resolved against the catalog. */
interface BundledComponentItem {
  productCode: string;
  quota: Record<string, unknown>;
  features: string[];
  priority: number | null;
}

/** What the audit row records per bundled component (before / after). */
interface BundledComponentAudit {
  productCode: string;
  quota: Record<string, unknown> | null;
  features: string[];
  priority: number;
}

/**
 * Default bundled priority. §7 trigger: max(bundled priority) < min(primary
 * priority) — bundled backing pools burn before the primary pool (product_220
 * §4.2). Seed writes primary at 100, so 50 sits safely below it.
 */
const DEFAULT_BUNDLED_PRIORITY = 50;
const MAX_BUNDLED_COMPONENTS = 64;

interface PlanVersionSummaryRow {
  id: string;
  version_no: number;
  major_no: number | null;
  published_at: Date | string | null;
  status: string;
  is_locked: boolean;
  is_current: boolean;
  created_at: Date | string;
  prices: PlanVersionPrice[];
  subscription_count: number;
}

const PLAN_VERSIONS_SQL = `
  SELECT pv.id, pv.version_no, pv.major_no, pv.published_at,
         pv.status, pv.is_locked, pv.created_at,
         (pv.id = p.current_version_id) AS is_current,
         (SELECT count(*)::int FROM metering.subscriptions s
           WHERE s.plan_version_id = pv.id AND s.deleted_at IS NULL) AS subscription_count,
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object('cycleUnit', pp.cycle_unit, 'price', to_char(pp.price, 'FM999999999990.00'))
                            ORDER BY pp.cycle_unit)
             FROM product.plan_prices pp WHERE pp.plan_version_id = pv.id
         ), '[]'::jsonb) AS prices
    FROM product.plan_versions pv
    JOIN product.plans p ON p.id = pv.plan_id
   WHERE pv.plan_id = $1
   ORDER BY pv.version_no ASC
`;

function mapPlanVersionSummary(row: PlanVersionSummaryRow): PlanVersionSummary {
  return {
    id: row.id,
    versionNo: row.version_no,
    /* 读不到按 1 算：主版本号是 NOT NULL DEFAULT 1，回落到 1 不会造出假代际。 */
    majorNo: Number(row.major_no ?? 1),
    status: row.status,
    isLocked: row.is_locked,
    isCurrent: row.is_current,
    createdAt: new Date(row.created_at).toISOString(),
    publishedAt: row.published_at
      ? new Date(row.published_at).toISOString()
      : null,
    prices: row.prices ?? [],
    subscriptionCount: Number(row.subscription_count ?? 0),
  };
}

async function loadPlanVersionDetail(
  pool: Pool,
  versionId: string,
): Promise<PlanVersionDetail> {
  const { rows } = await pool.query<
    PlanVersionSummaryRow & {
      plan_id: string;
      plan_code: string;
      plan_name: string;
      components: (Omit<PlanVersionComponent, "quota"> & {
        quota: Record<string, unknown> | null;
      })[];
    }
  >(
    `SELECT pv.id, pv.plan_id, pv.version_no, pv.major_no, pv.published_at,
            pv.status, pv.is_locked, pv.created_at,
            (pv.id = p.current_version_id) AS is_current,
            p.plan_code, p.plan_name,
            COALESCE((
              SELECT jsonb_agg(jsonb_build_object('cycleUnit', pp.cycle_unit, 'price', to_char(pp.price, 'FM999999999990.00'))
                               ORDER BY pp.cycle_unit)
                FROM product.plan_prices pp WHERE pp.plan_version_id = pv.id
            ), '[]'::jsonb) AS prices,
            COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                       'productCode', cp.product_code, 'productName', cp.product_name,
                       'componentRole', pc.component_role, 'tier', pc.tier,
                       'quota', pc.quota, 'features', pc.features, 'priority', pc.priority)
                     ORDER BY (pc.component_role = 'primary') DESC, pc.sort_order ASC)
                FROM product.plan_components pc
                JOIN product.products cp ON cp.id = pc.product_id
               WHERE pc.plan_version_id = pv.id
            ), '[]'::jsonb) AS components
       FROM product.plan_versions pv
       JOIN product.plans p ON p.id = pv.plan_id
      WHERE pv.id = $1`,
    [versionId],
  );
  const row = rows[0];
  if (!row) {
    throw new NotFoundException(`Plan version ${versionId} not found`);
  }
  const components = (row.components ?? []).map<PlanVersionComponent>(
    (component) => ({
      ...component,
      quota: component.quota ?? {},
      features: component.features ?? [],
    }),
  );
  const primary = components.find((c) => c.componentRole === "primary");
  return {
    ...mapPlanVersionSummary(row),
    planId: row.plan_id,
    planCode: row.plan_code,
    planName: row.plan_name,
    productCode: primary?.productCode ?? null,
    quota: primary?.quota ?? {},
    components,
  };
}

// ── bundled components: input reading · locking · catalog resolution ────────

/**
 * Validate the PUT body shape before any DB access. Duplicate product codes
 * are rejected here (not deduped silently — a duplicate means two different
 * quotas were sent for one product and we cannot guess which one wins).
 *
 * @throws {BadRequestException} on any shape violation
 */
function readBundledComponentInputs(
  body: ReplaceBundledComponentsInput | undefined,
): BundledComponentItem[] {
  const list = body?.components;
  if (!Array.isArray(list)) {
    throw new BadRequestException("components must be an array");
  }
  if (list.length > MAX_BUNDLED_COMPONENTS) {
    throw new BadRequestException(
      `components has more than ${MAX_BUNDLED_COMPONENTS} items`,
    );
  }
  const seen = new Set<string>();
  return list.map((item, index) => {
    const key = `components[${index}]`;
    const productCode =
      typeof item?.productCode === "string" ? item.productCode.trim() : "";
    if (!productCode) {
      throw new BadRequestException(`${key}.productCode is required`);
    }
    if (seen.has(productCode)) {
      throw new BadRequestException(
        `${key}.productCode ${productCode} is listed more than once`,
      );
    }
    seen.add(productCode);
    const quota = item?.quota;
    if (!quota || typeof quota !== "object" || Array.isArray(quota)) {
      throw new BadRequestException(`${key}.quota must be a JSON object`);
    }
    const features =
      item?.features === undefined
        ? []
        : readStringArray(item.features, `${key}.features`, 64);
    let priority: number | null = null;
    if (item?.priority !== undefined && item?.priority !== null) {
      priority = Number(item.priority);
      if (!Number.isInteger(priority) || priority < 0) {
        throw new BadRequestException(
          `${key}.priority must be a non-negative integer`,
        );
      }
    }
    return {
      productCode,
      quota: quota as Record<string, unknown>,
      features,
      priority,
    };
  });
}

interface LockedPlanVersionRow {
  id: string;
  plan_code: string;
  version_no: number;
  status: string;
  is_locked: boolean;
}

/**
 * FOR UPDATE the version row and refuse anything that is not an editable
 * draft. Same rule as updateDraftVersion, surfaced as 409: the version exists,
 * it is its lifecycle state that conflicts with the write (§7 lock triggers
 * would reject the row writes anyway — this just says so before touching them).
 *
 * @throws {NotFoundException} unknown version
 * @throws {ConflictException} published or locked version
 */
async function lockDraftPlanVersion(
  client: PoolClient,
  versionId: string,
): Promise<LockedPlanVersionRow> {
  const { rows } = await client.query<LockedPlanVersionRow>(
    `SELECT pv.id, p.plan_code, pv.version_no, pv.status, pv.is_locked
       FROM product.plan_versions pv
       JOIN product.plans p ON p.id = pv.plan_id
      WHERE pv.id = $1
      FOR UPDATE OF pv`,
    [versionId],
  );
  const row = rows[0];
  if (!row) {
    throw new NotFoundException(`Plan version ${versionId} not found`);
  }
  if (row.status !== "draft" || row.is_locked) {
    throw new ConflictException(
      `Plan version ${row.plan_code}@v${row.version_no} is ${
        row.is_locked ? "locked" : row.status
      }; its components are frozen — open a new draft version`,
    );
  }
  return row;
}

interface PrimaryComponentRow {
  product_code: string;
  priority: number;
}

async function loadPrimaryComponent(
  client: PoolClient,
  versionId: string,
): Promise<PrimaryComponentRow | null> {
  const { rows } = await client.query<PrimaryComponentRow>(
    `SELECT p.product_code, pc.priority
       FROM product.plan_components pc
       JOIN product.products p ON p.id = pc.product_id
      WHERE pc.plan_version_id = $1 AND pc.component_role = 'primary'
      LIMIT 1`,
    [versionId],
  );
  return rows[0] ?? null;
}

interface ResolvedBundledComponent {
  productId: string;
  productCode: string;
  quota: Record<string, unknown>;
  features: string[];
  priority: number;
}

/**
 * Resolve product codes against the live catalog and apply the two rules that
 * need the primary row: a version cannot bundle the product it sells, and every
 * bundled priority must sit below the primary's (§7 trigger, checked here so the
 * caller gets a 400 with the reason instead of a raw trigger error).
 *
 * @throws {BadRequestException} primary listed as bundled / priority not below primary
 * @throws {NotFoundException} unknown or soft-deleted product (carries `field`)
 */
async function resolveBundledComponents(
  client: PoolClient,
  items: BundledComponentItem[],
  primary: PrimaryComponentRow | null,
): Promise<ResolvedBundledComponent[]> {
  if (items.length === 0) return [];
  const { rows } = await client.query<{
    id: string;
    product_code: string;
    layer: string | null;
  }>(
    `SELECT id, product_code, layer FROM product.products
      WHERE deleted_at IS NULL AND product_code = ANY($1::text[])`,
    [items.map((item) => item.productCode)],
  );
  const byCode = new Map(rows.map((row) => [row.product_code, row]));
  return items.map((item, index) => {
    const field = `components[${index}].productCode`;
    if (primary && item.productCode === primary.product_code) {
      throw new BadRequestException(
        `${field}: ${item.productCode} is this version's primary product and cannot be bundled into itself`,
      );
    }
    const found = byCode.get(item.productCode);
    if (!found) {
      throw new NotFoundException({
        statusCode: 404,
        message: `Product ${item.productCode} not found`,
        field,
      });
    }
    /* 可被绑的只有 L2 域平台（owner 2026-09-17）。
       L1 基础支撑不绑——它的额度走平台级度量键（ai.credit 在 platform_metrics，
       且 trg_product_metrics_no_platform_shadow 禁止产品声明它），套餐里写一行
       配额就进平台池，不需要把 atlas 当组件绑进来。
       L3 智能体不能**被**绑——它卖的就是那套界面，抽掉前端什么都不剩；
       但 L3 自己的套餐仍可绑 L2（product_220 §2 的 raven-pro 捆 arda 不受影响）。
       未分层（layer IS NULL）一并挡下：宁可让运营先去产品目录补上分层，
       也不放一个来路不明的组件进客户买到的配额里。 */
    if (found.layer !== "L2") {
      throw new BadRequestException({
        statusCode: 400,
        message: `${item.productCode} is ${found.layer ?? "unclassified"}; only L2 domain platforms can be bundled`,
        field,
      });
    }
    const productId = found.id;
    const priority = item.priority ?? DEFAULT_BUNDLED_PRIORITY;
    if (primary && priority >= primary.priority) {
      throw new BadRequestException(
        `components[${index}].priority must be below the primary component's priority (${primary.priority}) — bundled pools burn first`,
      );
    }
    return {
      productId,
      productCode: item.productCode,
      quota: item.quota,
      features: item.features,
      priority,
    };
  });
}

// ── C14 de-mock: product catalog capabilities + agents read from the live
//   `product` schema (product.products is the unified SoT — merged agent +
//   application). solutions / service-plans / releases followed on 2026-08-31
//   (TD-029 closed: product.solutions + solution_products + solution_plans, and
//   releases redefined as published plan versions); model-policies was retired
//   in favour of the Atlas proxy. See the solutions section at the bottom.

/** Raw product.products row (+ derived plan_count / category_code) for the catalog list. */
/**
 * 套餐版本历史（DS04）。
 *
 * 排序：先按套餐码，再按版本号**倒序**——同一个套餐的最新版在上，人找的是
 * 「现在是第几版」而不是「当初第一版」。
 */
const PRODUCT_PLAN_VERSIONS_SQL = `
  SELECT DISTINCT
    comp.product_id,
    pl.plan_code,
    pl.plan_name,
    pv.version_no,
    pv.status,
    pv.is_locked,
    comp.component_role,
    pv.created_at
  FROM product.plan_components comp
  JOIN product.plan_versions pv ON pv.id = comp.plan_version_id
  JOIN product.plans pl ON pl.id = pv.plan_id
  ORDER BY pl.plan_code ASC, pv.version_no DESC
`;

interface ProductPlanVersionRow {
  product_id: string;
  plan_code: string;
  plan_name: string;
  version_no: number;
  status: string;
  is_locked: boolean;
  component_role: string;
  created_at: Date | string | null;
}

interface ProductCatalogRow {
  product_nick: string | null;
  standalone_subscribable: boolean;
  origin_provider: string | null;
  release_version: string | null;
  released_at: Date | string | null;
  launch_override_at: Date | string | null;
  launch_override_pending: string[] | null;
  category_name: string | null;
  surfaces: string[] | null;
  public_plan_count: number | null;
  published_plan_count: number | null;
  id: string;
  product_code: string;
  product_type: string; // 受管枚举 @vxture/core-utils: general_platform|industry_platform|general_agent|industry_agent|undefined
  layer: string | null; // 定位轴 L1|L2|L3（product_100_matrix §2）；NULL=未分层。绑定候选按它过滤，所以原样透出不加工
  origin: string; // 来源轴 self|third_party|other —— source 从这里判，不再从 product_type='external' 反推
  release_stage: string; // 成熟度轴 ga|beta|developing
  marketing: unknown | null; // 营销内容 jsonb(双语富结构)
  product_name: string;
  description: string | null;
  status: string; // active | inactive | draft | deprecated
  is_customer_visible: boolean;
  is_workforce_visible: boolean;
  tags: string[];
  category_code: string | null;
  plan_count: number;
  created_at: Date | string;
  updated_at: Date | string;
}

interface ProductMetricRow {
  display_name: string | null;
  description: string | null;
  product_id: string;
  metric_key: string;
  metric_unit: string | null;
  reset_period: string;
  merge_strategy: string;
}

interface ProductWebhookRow {
  product_id: string;
  webhook_url: string | null;
}

/** Map the open-ended product_type kind onto the capability presentation type. */
function mapProductCapabilityType(productType: string): ProductCapabilityType {
  switch (productType) {
    // 受管枚举(@vxture/core-utils):智能体族。
    case "agent":
    case "general_agent":
    case "industry_agent":
      return "agent";
    case "model":
    case "model_platform":
      return "model";
    case "data_platform":
    case "data":
      return "data";
    // 受管枚举:平台族(general/industry)+历史平台型都归 platform。
    case "platform":
    case "general_platform":
    case "industry_platform":
    case "capability_platform":
    case "knowledge_platform":
      return "platform";
    // undefined / client / external / 其它一律作为集成服务呈现。
    default:
      return "service";
  }
}

/** Project the DDL status (active|inactive|draft|deprecated) onto the 3-state capability status. */
function mapProductCapabilityStatus(status: string): ProductCapabilityStatus {
  if (status === "active") return "active";
  if (status === "draft") return "draft";
  return "archived"; // inactive | deprecated
}

interface ProductSolutionLinkRow {
  product_id: string;
  solution_code: string;
  solution_name: string;
  solution_status: string;
  role: string | null;
  tier_names: string[] | null;
}

/** 产品 → 所在方案（含角色、方案已绑档位的套餐名）；软删的方案 / 套餐不算。 */
export const PRODUCT_SOLUTION_LINKS_SQL = `
  SELECT sp.product_id,
         s.solution_code,
         s.solution_name,
         s.status AS solution_status,
         sp.role,
         COALESCE(
           ARRAY_AGG(pl.plan_name ORDER BY spl.tier) FILTER (WHERE pl.plan_name IS NOT NULL),
           ARRAY[]::text[]
         ) AS tier_names
    FROM product.solution_products sp
    JOIN product.solutions s ON s.id = sp.solution_id AND s.deleted_at IS NULL
    LEFT JOIN product.solution_plans spl ON spl.solution_id = s.id
    LEFT JOIN product.plans pl ON pl.id = spl.plan_id AND pl.deleted_at IS NULL
   GROUP BY sp.product_id, s.solution_code, s.solution_name, s.status, sp.role, sp.sort
   ORDER BY sp.product_id, sp.sort ASC, s.solution_code ASC
`;

/** 方案四态收成能力目录的三态：inactive / deprecated 在这张表上都是「不再售卖」。 */
function solutionStatusToCapabilityStatus(
  status: string,
): ProductCapabilityStatus {
  if (status === "active") return "active";
  if (status === "draft") return "draft";
  return "archived";
}

const PRODUCT_CATALOG_SQL = `
  SELECT
    p.id,
    p.product_code,
    p.product_type,
    p.layer,
    p.origin,
    p.release_stage,
    p.marketing,
    p.product_name,
    /* 「译名/副名」列名不副实：库里装的就是英文名（数据平台→Arda、模型平台→Atlas
       ……）。对外按英文名用，与中文名同时给，不走 i18n（owner 2026-09-21：
       「和中文同时提供，超越 i18n 范围」）。 */
    p.product_nick,
    p.description,
    p.status,
    p.is_customer_visible,
    p.is_workforce_visible,
    p.standalone_subscribable,
    p.origin_provider,
    p.release_version,
    p.released_at,
    /* 带理由跳过上线闸门的痕迹。admin 这一页是运营唯一能看见「这个产品的接入门
       被绕过了、还欠哪几项」的地方——不显示，就会在不知情的情况下卖一个没验完
       的东西。理由本身在 support.audit_logs。 */
    p.launch_override_at,
    p.launch_override_pending,
    p.tags,
    c.code AS category_code,
    c.name AS category_name,
    -- 终端支持：opera 接入页写的 product_surfaces（web/desktop/app/miniprogram）。
    (SELECT array_agg(s.surface ORDER BY s.surface)
       FROM product.product_surfaces s WHERE s.product_id = p.id) AS surfaces,
    (SELECT COUNT(DISTINCT pv.plan_id)::int
       FROM product.plan_components comp
       JOIN product.plan_versions pv ON pv.id = comp.plan_version_id
      WHERE comp.product_id = p.id) AS plan_count,
    -- 订阅开放：这个产品的套餐里有几个对外开放自助购买（plans.is_public）。
    -- 那根轴已经在跑——console-bff 的订阅列表与购买路径三处都过滤 is_public = true。
    -- 这里只是把它汇到产品这一层给运营看，不新增语义。
    -- （owner 2026-09-21 裁定：轴维持在套餐层，「邀请订阅」另起一条线。）
    -- 注意：本注释在模板串里，不能写反引号——它会当场截断字符串。
    (SELECT COUNT(DISTINCT pv.plan_id)::int
       FROM product.plan_components comp
       JOIN product.plan_versions pv ON pv.id = comp.plan_version_id
       JOIN product.plans pl ON pl.id = pv.plan_id AND pl.is_public
      WHERE comp.product_id = p.id) AS public_plan_count,
    -- 正式套餐数：至少有一个 published 版本的套餐（owner：正式不含草稿）。
    -- 与 plan_count 的差就是「只存在草稿版本」的那些——它们还卖不出去。
    (SELECT COUNT(DISTINCT pv.plan_id)::int
       FROM product.plan_components comp
       JOIN product.plan_versions pv ON pv.id = comp.plan_version_id
      WHERE comp.product_id = p.id AND pv.status = 'published') AS published_plan_count,
    p.created_at,
    p.updated_at
  FROM product.products p
  LEFT JOIN product.product_categories c ON c.id = p.category_id
  WHERE p.deleted_at IS NULL
  ORDER BY (p.status = 'active') DESC, p.product_name ASC
`;

/**
 * Load the product-capability catalog from the live product schema. Fields with
 * no schema home (ownerTeam / accessModes / billingMode / releases /
 * modelPolicyCount) are returned empty rather than fabricated.
 *
 * relatedSolutions / solutionCount 自 2026-08-31 起从 product.solution_products
 * 实算（方案模型落库后，70-product-solutions.md）：一个产品挂在哪些方案里、在方案里
 * 扮演什么角色、方案已绑了哪些档位的套餐——此前这两个字段是 [] / 0 的占位。
 */
export async function loadProductCapabilities(
  pool: Pool,
): Promise<ProductCapabilityRecord[]> {
  const [products, metrics, webhooks, solutions, versions] = await Promise.all([
    pool.query<ProductCatalogRow>(PRODUCT_CATALOG_SQL),
    pool.query<ProductMetricRow>(
      /* 中文名住在 `metric_catalog`（key → 名/说明），不在本表上——它是**键的属性**，
         同一个 member.max 不该每接一个产品就被再命名一遍（owner 2026-09-22）。
         LEFT JOIN：没命名过的键回落显示 metric_key 本身，不阻塞。 */
      `SELECT pm.product_id, pm.metric_key,
              mc.display_name, mc.description,
              pm.metric_unit, pm.reset_period, pm.merge_strategy
         FROM product.product_metrics pm
         LEFT JOIN product.metric_catalog mc ON mc.metric_key = pm.metric_key`,
    ),
    pool.query<ProductWebhookRow>(
      `SELECT product_id, webhook_url FROM product.product_webhooks`,
    ),
    pool.query<ProductSolutionLinkRow>(PRODUCT_SOLUTION_LINKS_SQL),
    pool.query<ProductPlanVersionRow>(PRODUCT_PLAN_VERSIONS_SQL),
  ]);

  /* 套餐版本按产品归堆。一个版本可能挂多个产品（plan_components 里 primary 之外
     还有 bundled 搭售件），所以这里按 (product_id, plan_id, version_no) 去重的活
     交给 SQL 的 DISTINCT，本函数只归堆。 */
  const versionsByProduct = new Map<string, ProductPlanVersionRecord[]>();
  for (const row of versions.rows) {
    const list = versionsByProduct.get(row.product_id) ?? [];
    list.push({
      planCode: row.plan_code,
      planName: row.plan_name,
      versionNo: row.version_no,
      status: row.status === "published" ? "published" : "draft",
      isLocked: row.is_locked,
      componentRole: row.component_role === "primary" ? "primary" : "bundled",
      createdAt: toIso(row.created_at),
    });
    versionsByProduct.set(row.product_id, list);
  }

  const solutionsByProduct = new Map<
    string,
    ProductCapabilityRelatedSolution[]
  >();
  for (const link of solutions.rows) {
    const list = solutionsByProduct.get(link.product_id) ?? [];
    list.push({
      solutionCode: link.solution_code,
      solutionName: link.solution_name,
      role: link.role ?? "",
      status: solutionStatusToCapabilityStatus(link.solution_status),
      tierNames: link.tier_names ?? [],
    });
    solutionsByProduct.set(link.product_id, list);
  }

  const metricsByProduct = new Map<string, ProductCapabilityMetricRule[]>();
  for (const metric of metrics.rows) {
    const list = metricsByProduct.get(metric.product_id) ?? [];
    list.push({
      metricCode: metric.metric_key,
      /* 中文名与说明可空：没填就给空串，**界面回落显示 metric_key**。
         不在这里替它编一个——平台替产品命名必然错（`varda.enabled` 该叫
         「Varda 开关」还是「智能体启用」，只有产品自己知道）。录入面在运维台的
         产品接入页；存量 19 条人工补录。 */
      metricName: metric.display_name ?? "",
      metricDescription: metric.description ?? "",
      unit: metric.metric_unit ?? "",
      cycle: metric.reset_period,
      quotaBase: metric.merge_strategy,
      billingMode: metric.merge_strategy === "pool" ? "配额池扣减" : "能力包含",
    });
    metricsByProduct.set(metric.product_id, list);
  }

  const webhookByProduct = new Map<string, ProductWebhookRow>();
  for (const webhook of webhooks.rows) {
    webhookByProduct.set(webhook.product_id, webhook);
  }

  return products.rows.map((row) => {
    const productType = mapProductCapabilityType(row.product_type);
    const status = mapProductCapabilityStatus(row.status);
    // 来源判 origin(self/third_party/other),不再从 product_type='external' 反推
    // ——external 已回归为来源而非类型。复用与方案侧同一口径 mapSolutionSource。
    const source: ProductCapabilitySource = mapSolutionSource(row.origin);
    const productMetrics = metricsByProduct.get(row.id) ?? [];
    const webhook = webhookByProduct.get(row.id);
    const integration: ProductCapabilityIntegration = webhook
      ? {
          providerName: source === "partner" ? "合作方服务商" : "Vxture",
          providerType: source,
          status: webhook.webhook_url ? "connected" : "config_required",
          endpoint: webhook.webhook_url,
          protocol: "REST / HTTPS",
          authMode: "HMAC 自签",
          settlementMode: source === "partner" ? "按合同结算" : null,
          lastCheckedAt: null,
        }
      : {
          providerName: source === "partner" ? "合作方服务商" : "Vxture",
          providerType: source,
          status: "not_required",
          endpoint: null,
          protocol: "内部服务",
          authMode: "平台会话",
          settlementMode: null,
          lastCheckedAt: null,
        };

    return {
      id: row.id,
      productCode: row.product_code,
      productName: row.product_name,
      description: row.description ?? "",
      productType,
      layer: row.layer,
      source,
      status,
      // 成熟度轴与营销内容(产品目录录入的业务字段,原样透传给前端表单回填)。
      releaseStage: row.release_stage,
      marketing: row.marketing ?? null,
      visibility: row.is_customer_visible ? "public" : "internal",
      isWorkforceVisible: row.is_workforce_visible,
      /* 英文名（库列名叫 product_nick「译名/副名」，装的其实是英文名）。 */
      productNameEn: row.product_nick ?? "",
      categoryName: row.category_name ?? "",
      originProvider: row.origin_provider ?? "",
      standaloneSubscribable: row.standalone_subscribable,
      releaseVersion: row.release_version ?? "",
      releasedAt: row.released_at ? toIso(row.released_at) : null,
      surfaces: row.surfaces ?? [],
      publicPlanCount: row.public_plan_count ?? 0,
      publishedPlanCount: row.published_plan_count ?? 0,
      planVersions: versionsByProduct.get(row.id) ?? [],
      /* 上线方式：带理由跳过上线闸门的产品，这里给时刻与当时欠的项。
         null = 正常过门。 */
      launchOverrideAt: row.launch_override_at
        ? toIso(row.launch_override_at)
        : null,
      launchOverridePending: row.launch_override_pending ?? [],
      tags: row.tags ?? [],
      meteringUnit: productMetrics[0]?.unit ?? "",
      healthStatus:
        status === "active"
          ? "normal"
          : status === "draft"
            ? "warning"
            : "disabled",
      integration,
      metrics: productMetrics,
      relatedSolutions: solutionsByProduct.get(row.id) ?? [],
      releases: [],
      solutionCount: (solutionsByProduct.get(row.id) ?? []).length,
      planCount: Number(row.plan_count) || 0,
      releaseCount: 0,
      modelPolicyCount: 0,
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
    };
  });
}

/** Agent-kind products from the live catalog (受管枚举的智能体族 + 历史裸 agent)。 */
export async function loadProductAgents(
  pool: Pool,
): Promise<ProductAgentRecord[]> {
  const rows = await pool.query<
    Pick<
      ProductCatalogRow,
      | "id"
      | "product_code"
      | "product_name"
      | "description"
      | "status"
      | "is_customer_visible"
      | "is_workforce_visible"
      | "created_at"
      | "updated_at"
    >
  >(
    `SELECT id, product_code, product_name, description, status,
            is_customer_visible, is_workforce_visible, created_at, updated_at
       FROM product.products
      WHERE deleted_at IS NULL
        AND product_type IN ('agent', 'general_agent', 'industry_agent')
      ORDER BY product_name ASC`,
  );

  return rows.rows.map((row) => ({
    id: row.id,
    agentCode: row.product_code,
    agentName: row.product_name,
    description: row.description ?? "",
    // agentType / defaultModelCode have no product-schema column — the versioned
    // agent-config model is not yet defined; default to chat / unbound.
    agentType: "chat" as const,
    status:
      row.status === "active" ? ("active" as const) : ("inactive" as const),
    visibility: row.is_customer_visible
      ? ("public" as const)
      : row.is_workforce_visible
        ? ("internal" as const)
        : ("private" as const),
    defaultModelCode: null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  }));
}

function toIso(value: Date | string | null): string {
  if (!value) return new Date(0).toISOString();
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function assertCanManageProducts(req: Request & RequestContext): void {
  if (!req.user) {
    throw new UnauthorizedException("No active session");
  }

  if (
    !req.capabilities ||
    !req.capabilities.includes("platform.product.manage")
  ) {
    throw new ForbiddenException("Missing platform.product.manage capability");
  }
}

interface ProductPlanRow {
  id: string;
  plan_code: string;
  plan_name: string;
  description: string;
  is_public: boolean;
  status: string; // active | inactive | draft | deprecated
  current_version_id: string | null;
  price: string | number | null; // from current published plan_version
  currency: string | null;
  version_status: string | null; // draft | published
  subscription_count: number;
  created_at: Date | string;
  updated_at: Date | string;
}

const PRODUCT_PLAN_SQL = `
  SELECT
    p.id,
    p.plan_code,
    p.plan_name,
    COALESCE(p.description, '') AS description,
    p.is_public,
    p.status,
    p.current_version_id,
    pp.price,
    pp.currency,
    -- plan_versions dropped the draft/published status column; the version that
    -- plans.current_version_id points at is the live/published one by definition.
    CASE WHEN pv.id IS NOT NULL THEN 'published' ELSE 'draft' END AS version_status,
    p.created_at,
    p.updated_at,
    (SELECT COUNT(*)::int
       FROM metering.subscriptions s
       JOIN product.plan_versions pv2 ON pv2.id = s.plan_version_id
      WHERE pv2.plan_id = p.id AND s.deleted_at IS NULL) AS subscription_count
  FROM product.plans p
  LEFT JOIN product.plan_versions pv ON pv.id = p.current_version_id
  -- price/currency moved from the old inline plan_version columns to the new
  -- per-cycle product.plan_prices table; pick the monthly cycle to preserve the
  -- single-price shape this endpoint projects (periodType is hardcoded monthly).
  LEFT JOIN LATERAL (
    SELECT price, currency
      FROM product.plan_prices
     WHERE plan_version_id = pv.id
     ORDER BY CASE cycle_unit WHEN 'month' THEN 0 ELSE 1 END, cycle_count ASC
     LIMIT 1
  ) pp ON true
  WHERE p.deleted_at IS NULL
  ORDER BY p.plan_code ASC
`;

// ── 解决方案：状态机 · 校验 · 写路径辅助（2026-08-31，TD-029 收口）──────────────
// 设计：docs/20-specs/000-platform/admin/70-product-solutions.md。

const SOLUTION_STATES = [
  "draft",
  "active",
  "inactive",
  "deprecated",
] as const satisfies readonly ProductSolutionStatus[];

/**
 * 与 product.products 同形（opera product-catalog.router `STATE_TRANSITIONS`）：
 * draft → active ⇄ inactive，任一 → deprecated（终态，出边为空）。
 * 守卫立在这里而不只在界面：直连 BFF 的调用同样过不去。
 */
const SOLUTION_STATE_TRANSITIONS: Record<
  ProductSolutionStatus,
  readonly ProductSolutionStatus[]
> = {
  draft: ["active", "deprecated"],
  active: ["inactive", "deprecated"],
  inactive: ["active", "deprecated"],
  deprecated: [],
};

const SOLUTION_STATE_LABELS: Record<ProductSolutionStatus, string> = {
  draft: "草稿",
  active: "启用",
  inactive: "停用",
  deprecated: "退役",
};

function isSolutionStatus(value: string): value is ProductSolutionStatus {
  return (SOLUTION_STATES as readonly string[]).includes(value);
}

/** 可视码：kebab-case，进地址栏与审计 resource_id。 */
const SOLUTION_CODE_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function readSolutionCode(raw: unknown): string {
  const code = typeof raw === "string" ? raw.trim() : "";
  if (!code || code.length > 64 || !SOLUTION_CODE_RE.test(code)) {
    throw new BadRequestException(
      "solutionCode must be kebab-case (a-z, 0-9, '-'), at most 64 chars",
    );
  }
  return code;
}

function readTier(raw: string): Tier {
  const tier = raw.trim().toLowerCase();
  if (!(TIERS as readonly string[]).includes(tier)) {
    throw new BadRequestException(`tier must be one of ${TIERS.join(", ")}`);
  }
  return tier as Tier;
}

function readOptionalText(
  value: unknown,
  key: string,
  max: number,
): string | null {
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new BadRequestException(`${key} must be a string`);
  }
  const text = value.trim();
  if (text.length > max) {
    throw new BadRequestException(`${key} exceeds ${max} chars`);
  }
  return text || null;
}

function readStringArray(value: unknown, key: string, max: number): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw new BadRequestException(`${key} must be a string array`);
  }
  const items = (value as string[]).map((v) => v.trim()).filter(Boolean);
  if (items.length > max) {
    throw new BadRequestException(`${key} has more than ${max} items`);
  }
  return Array.from(new Set(items));
}

/** 列名即 product.solutions 列名——动态 SET 直接拼键，键集固定在此处。 */
interface SolutionFields {
  solution_name?: string;
  description?: string | null;
  industry?: string | null;
  scenario?: string | null;
  customer_segment?: string | null;
  owner_team?: string | null;
  tags?: string[];
  delivery_mode?: string | null;
  delivery_boundaries?: string[];
  is_public?: boolean;
}

/** 只收送来的键（undefined = 不动）；create 时名称必填。 */
function readSolutionFields(
  body: ProductSolutionWriteInput | undefined,
  options: { requireName: boolean },
): SolutionFields {
  const input = body ?? {};
  const fields: SolutionFields = {};
  if (input.solutionName !== undefined || options.requireName) {
    const name = readOptionalText(
      input.solutionName ?? "",
      "solutionName",
      128,
    );
    if (!name) throw new BadRequestException("solutionName is required");
    fields.solution_name = name;
  }
  if (input.description !== undefined)
    fields.description = readOptionalText(
      input.description,
      "description",
      4000,
    );
  if (input.industry !== undefined) {
    // 行业领域只认 core-utils industry-taxonomy 清单码(与租户所属行业同一清单,
    // owner 2026-09-06);空 = 清掉。历史自由文本留在库里可读,再写入只能是码。
    const industry = readOptionalText(input.industry, "industry", 128);
    if (industry && !isValidIndustry(industry)) {
      throw new BadRequestException("invalid_industry");
    }
    fields.industry = industry;
  }
  if (input.scenario !== undefined)
    fields.scenario = readOptionalText(input.scenario, "scenario", 128);
  if (input.customerSegment !== undefined)
    fields.customer_segment = readOptionalText(
      input.customerSegment,
      "customerSegment",
      255,
    );
  if (input.ownerTeam !== undefined)
    fields.owner_team = readOptionalText(input.ownerTeam, "ownerTeam", 128);
  if (input.tags !== undefined)
    fields.tags = readStringArray(input.tags, "tags", 32);
  if (input.deliveryMode !== undefined)
    fields.delivery_mode = readOptionalText(
      input.deliveryMode,
      "deliveryMode",
      1000,
    );
  if (input.deliveryBoundaries !== undefined)
    fields.delivery_boundaries = readStringArray(
      input.deliveryBoundaries,
      "deliveryBoundaries",
      32,
    );
  if (input.isPublic !== undefined) {
    if (typeof input.isPublic !== "boolean") {
      throw new BadRequestException("isPublic must be a boolean");
    }
    fields.is_public = input.isPublic;
  }
  return fields;
}

interface SolutionProductItem {
  productId: string | null;
  productCode: string | null;
  role: string | null;
  sort: number;
}

function readSolutionProductInputs(
  body:
    | ProductSolutionProductInput[]
    | { products?: ProductSolutionProductInput[] }
    | undefined,
): SolutionProductItem[] {
  const list = Array.isArray(body) ? body : body?.products;
  if (!Array.isArray(list)) {
    throw new BadRequestException("products must be an array");
  }
  if (list.length > 64) {
    throw new BadRequestException("products has more than 64 items");
  }
  return list.map((item, index) => {
    const productId =
      typeof item?.productId === "string" && item.productId.trim()
        ? item.productId.trim()
        : null;
    const productCode =
      typeof item?.productCode === "string" && item.productCode.trim()
        ? item.productCode.trim()
        : null;
    if (!productId && !productCode) {
      throw new BadRequestException(
        `products[${index}] needs productId or productCode`,
      );
    }
    const sort =
      item?.sort === undefined ? index : Number.parseInt(String(item.sort), 10);
    if (!Number.isInteger(sort)) {
      throw new BadRequestException(`products[${index}].sort must be an int`);
    }
    return {
      productId,
      productCode,
      role: readOptionalText(
        item?.role ?? null,
        `products[${index}].role`,
        128,
      ),
      sort,
    };
  });
}

function readPlanRef(body: ProductSolutionPlanBindInput | undefined): {
  planId: string | null;
  planCode: string | null;
} {
  const planId =
    typeof body?.planId === "string" && body.planId.trim()
      ? body.planId.trim()
      : null;
  const planCode =
    typeof body?.planCode === "string" && body.planCode.trim()
      ? body.planCode.trim()
      : null;
  if (!planId && !planCode) {
    throw new BadRequestException("planId or planCode is required");
  }
  return { planId, planCode };
}

interface LockedSolutionRow {
  id: string;
  solution_code: string;
  solution_name: string;
  description: string | null;
  industry: string | null;
  scenario: string | null;
  customer_segment: string | null;
  owner_team: string | null;
  tags: string[];
  delivery_mode: string | null;
  delivery_boundaries: string[];
  status: ProductSolutionStatus;
  is_public: boolean;
}

/** FOR UPDATE：状态迁移与清单替换都要先锁住这一行（同 opera 产品目录）。 */
async function lockSolution(
  client: PoolClient,
  solutionCode: string,
): Promise<LockedSolutionRow> {
  const { rows } = await client.query<LockedSolutionRow>(
    `SELECT id, solution_code, solution_name, description, industry, scenario,
            customer_segment, owner_team, tags, delivery_mode, delivery_boundaries,
            status, is_public
       FROM product.solutions
      WHERE solution_code = $1 AND deleted_at IS NULL
      FOR UPDATE`,
    [solutionCode],
  );
  const row = rows[0];
  if (!row) {
    throw new NotFoundException(`Product solution ${solutionCode} not found`);
  }
  return row;
}

function pickSolutionAudit(row: LockedSolutionRow): SolutionFields {
  return {
    solution_name: row.solution_name,
    description: row.description,
    industry: row.industry,
    scenario: row.scenario,
    customer_segment: row.customer_segment,
    owner_team: row.owner_team,
    tags: row.tags,
    delivery_mode: row.delivery_mode,
    delivery_boundaries: row.delivery_boundaries,
    is_public: row.is_public,
  };
}

/** 把 productId / productCode 解析成目录行；任一解析不到即 400（不静默丢）。 */
async function resolveProducts(
  client: PoolClient,
  items: SolutionProductItem[],
): Promise<
  {
    productId: string;
    productCode: string;
    role: string | null;
    sort: number;
  }[]
> {
  if (items.length === 0) return [];
  const ids = items.map((i) => i.productId).filter((v): v is string => !!v);
  const codes = items.map((i) => i.productCode).filter((v): v is string => !!v);
  const { rows } = await client.query<{ id: string; product_code: string }>(
    `SELECT id, product_code FROM product.products
      WHERE deleted_at IS NULL
        AND (id::text = ANY($1::text[]) OR product_code = ANY($2::text[]))`,
    [ids, codes],
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  const byCode = new Map(rows.map((r) => [r.product_code, r]));
  const seen = new Set<string>();
  const resolved: {
    productId: string;
    productCode: string;
    role: string | null;
    sort: number;
  }[] = [];
  for (const item of items) {
    const row =
      (item.productId ? byId.get(item.productId) : undefined) ??
      (item.productCode ? byCode.get(item.productCode) : undefined);
    if (!row) {
      throw new BadRequestException(
        `Product ${item.productCode ?? item.productId} not found`,
      );
    }
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    resolved.push({
      productId: row.id,
      productCode: row.product_code,
      role: item.role,
      sort: item.sort,
    });
  }
  return resolved;
}

async function resolvePlan(
  client: PoolClient,
  ref: { planId: string | null; planCode: string | null },
): Promise<{ id: string; plan_code: string }> {
  const { rows } = await client.query<{ id: string; plan_code: string }>(
    `SELECT id, plan_code FROM product.plans
      WHERE deleted_at IS NULL
        AND (($1::text IS NOT NULL AND id::text = $1) OR ($2::text IS NOT NULL AND plan_code = $2))
      LIMIT 1`,
    [ref.planId, ref.planCode],
  );
  const row = rows[0];
  if (!row) {
    throw new NotFoundException(`Plan ${ref.planCode ?? ref.planId} not found`);
  }
  return row;
}

// ── 解决方案：SQL 与投影 ────────────────────────────────────────────────────

/**
 * 订阅收入的唯一定义——列表、详情、服务套餐三处共用这一段。
 *
 * 口径（owner 2026-09-03：收入是真实收入，不做月均折算）：只计 `status = 'active'`
 * 的订阅（trialing 还没付钱，expiring/overdue 等也不计；它们进 subscriptionCount 但
 * 不进收入），金额 = 该订阅本周期实付 `paid_amount`（product_330，升级/续订履约时回写；
 * 旧行退回 pay_amount）。年付 ¥0.10 就是 ¥0.10，不折成 ¥0.01。按面值相加，不做币种
 * 换算（目前只有 CNY；多币种出现时这里要先分币再合）。列名 monthly_revenue 保留给
 * 既有投影字段 monthlyRevenue。
 */
const MRR_MONTHLY_EXPR = `
  CASE
    WHEN s.status <> 'active' THEN 0
    ELSE COALESCE(s.paid_amount, s.pay_amount, 0)
  END`;

/** 计数三件套：active/trialing 订阅数、去重租户数、订阅收入。按绑定 plan 的全部版本归集。 */
const SOLUTION_COUNTS_CTE = `
  counts AS (
    SELECT sp.solution_id,
           COUNT(*) FILTER (WHERE s.status IN ('active','trialing'))::int AS subscription_count,
           COUNT(DISTINCT s.tenant_id) FILTER (WHERE s.status IN ('active','trialing'))::int AS active_tenant_count,
           COALESCE(SUM(${MRR_MONTHLY_EXPR}), 0)::numeric(18,2) AS monthly_revenue
      FROM product.solution_plans sp
      JOIN product.plan_versions pv ON pv.plan_id = sp.plan_id
      JOIN metering.subscriptions s ON s.plan_version_id = pv.id AND s.deleted_at IS NULL
     GROUP BY sp.solution_id
  )`;

/** 取价/取权益所用的版本：优先 plans.current_version_id，否则已发布的最新版，否则最新版。 */
const PLAN_VERSION_PICK_LATERAL = `
  LEFT JOIN LATERAL (
    SELECT v.id, v.version_no, v.status
      FROM product.plan_versions v
     WHERE v.plan_id = pl.id
     ORDER BY (v.id = pl.current_version_id) DESC, (v.status = 'published') DESC, v.version_no DESC
     LIMIT 1
  ) ver ON true`;

/** 与 /plans 端点同一取价：月付优先，其次周期数最小。 */
const PLAN_PRICE_PICK_LATERAL = `
  LEFT JOIN LATERAL (
    SELECT price, currency, cycle_unit, cycle_count
      FROM product.plan_prices
     WHERE plan_version_id = ver.id
     ORDER BY CASE cycle_unit WHEN 'month' THEN 0 ELSE 1 END, cycle_count ASC
     LIMIT 1
  ) pr ON true`;

const SOLUTION_SQL = `
  WITH ${SOLUTION_COUNTS_CTE}
  SELECT sol.id, sol.solution_code, sol.solution_name,
         COALESCE(sol.description, '') AS description,
         COALESCE(sol.industry, '') AS industry,
         COALESCE(sol.scenario, '') AS scenario,
         COALESCE(sol.customer_segment, '') AS customer_segment,
         COALESCE(sol.owner_team, '') AS owner_team,
         sol.tags, COALESCE(sol.delivery_mode, '') AS delivery_mode, sol.delivery_boundaries,
         sol.status, sol.is_public, sol.created_at, sol.updated_at,
         COALESCE(c.subscription_count, 0) AS subscription_count,
         COALESCE(c.active_tenant_count, 0) AS active_tenant_count,
         COALESCE(c.monthly_revenue, 0) AS monthly_revenue,
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object(
                    'id', p.id, 'productCode', p.product_code, 'productName', p.product_name,
                    'productType', p.product_type, 'origin', p.origin, 'status', p.status,
                    'role', sp.role, 'sort', sp.sort)
                  ORDER BY sp.sort ASC, p.product_name ASC)
             FROM product.solution_products sp
             JOIN product.products p ON p.id = sp.product_id
            WHERE sp.solution_id = sol.id AND p.deleted_at IS NULL
         ), '[]'::jsonb) AS products,
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object(
                    'tier', spl.tier, 'planId', pl.id, 'planCode', pl.plan_code,
                    'planName', pl.plan_name, 'description', COALESCE(pl.description, ''),
                    'status', pl.status, 'isPublic', pl.is_public,
                    'price', pr.price, 'currency', pr.currency,
                    'cycleUnit', pr.cycle_unit, 'cycleCount', pr.cycle_count)
                  ORDER BY array_position(ARRAY['free','starter','pro','business','enterprise'], spl.tier))
             FROM product.solution_plans spl
             JOIN product.plans pl ON pl.id = spl.plan_id AND pl.deleted_at IS NULL
             ${PLAN_VERSION_PICK_LATERAL}
             ${PLAN_PRICE_PICK_LATERAL}
            WHERE spl.solution_id = sol.id
         ), '[]'::jsonb) AS tiers
    FROM product.solutions sol
    LEFT JOIN counts c ON c.solution_id = sol.id
   WHERE sol.deleted_at IS NULL
     AND ($1::text IS NULL OR sol.solution_code = $1)
   ORDER BY sol.sort ASC, sol.solution_name ASC
`;

interface SolutionProductJson {
  id: string;
  productCode: string;
  productName: string;
  productType: string;
  origin: string;
  status: string;
  role: string | null;
  sort: number;
}

interface SolutionTierJson {
  tier: string;
  planId: string;
  planCode: string;
  planName: string;
  description: string;
  status: string;
  isPublic: boolean;
  price: number | string | null;
  currency: string | null;
  cycleUnit: string | null;
  cycleCount: number | null;
}

export interface SolutionRow {
  id: string;
  solution_code: string;
  solution_name: string;
  description: string;
  industry: string;
  scenario: string;
  customer_segment: string;
  owner_team: string;
  tags: string[];
  delivery_mode: string;
  delivery_boundaries: string[];
  status: string;
  is_public: boolean;
  created_at: Date | string;
  updated_at: Date | string;
  subscription_count: number | string;
  active_tenant_count: number | string;
  monthly_revenue: number | string | null;
  products: SolutionProductJson[];
  tiers: SolutionTierJson[];
}

type Reader = Pick<Pool, "query">;

function mapSolutionSource(origin: string): ProductCapabilitySource {
  return origin === "third_party" ? "partner" : "self";
}

function toSolutionStatus(status: string): ProductSolutionStatus {
  return isSolutionStatus(status) ? status : "draft";
}

function toTier(value: string): Tier {
  return (TIERS as readonly string[]).includes(value)
    ? (value as Tier)
    : "free";
}

function toMoney(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function formatCurrency(value: number, currency: string): string {
  if (currency === "CNY")
    return `¥${new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;
  return `${currency} ${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;
}

function cycleLabel(unit: string, count: number): string {
  const n = count > 1 ? `${count} ` : "";
  switch (unit) {
    case "month":
      return count > 1 ? `${count} 个月` : "月";
    case "year":
      return `${n}年`;
    case "week":
      return `${n}周`;
    case "day":
      return `${n}天`;
    default:
      return "一次性";
  }
}

function periodTypeOf(cycleUnit: string): ProductReleasePeriodType {
  switch (cycleUnit) {
    case "day":
      return "daily";
    case "week":
      return "weekly";
    case "year":
      return "yearly";
    case "perpetual":
      return "perpetual";
    default:
      return "monthly";
  }
}

/** 无价格行 → 合同报价；0 → 免费；否则「¥x / 周期」。 */
function servicePlanPrice(price: {
  price: number | string | null;
  currency: string | null;
  cycleUnit: string | null;
  cycleCount: number | null;
}): ProductServicePlanPrice {
  if (price.price === null || price.price === undefined || !price.cycleUnit) {
    return {
      priceLabel: "合同报价",
      price: null,
      originalPrice: null,
      currency: price.currency ?? "CNY",
      periodType: "contract",
      periodValue: 1,
    };
  }
  const amount = toMoney(price.price);
  const currency = price.currency ?? "CNY";
  const count = price.cycleCount ?? 1;
  return {
    priceLabel:
      amount === 0
        ? "免费"
        : `${formatCurrency(amount, currency)} / ${cycleLabel(price.cycleUnit, count)}`,
    price: amount,
    originalPrice: null,
    currency,
    periodType: periodTypeOf(price.cycleUnit),
    periodValue: count,
  };
}

function projectSolutionTier(tier: SolutionTierJson): ProductSolutionTier {
  const price = servicePlanPrice(tier);
  return {
    tierCode: toTier(tier.tier),
    tierName: tier.planName,
    summary: tier.description ?? "",
    status: toSolutionStatus(tier.status),
    isPublic: tier.isPublic,
    planId: tier.planId,
    planCode: tier.planCode,
    priceLabel: price.priceLabel,
    priceKind:
      price.periodType === "contract"
        ? "contract"
        : price.price === 0
          ? "free"
          : "paid",
  };
}

export function projectSolution(row: SolutionRow): ProductSolutionRecord {
  return {
    id: row.id,
    solutionCode: row.solution_code,
    solutionName: row.solution_name,
    description: row.description ?? "",
    industry: row.industry ?? "",
    scenario: row.scenario ?? "",
    customerSegment: row.customer_segment ?? "",
    status: toSolutionStatus(row.status),
    visibility: row.is_public ? "public" : "internal",
    ownerTeam: row.owner_team ?? "",
    subscriptionCount: Number(row.subscription_count) || 0,
    activeTenantCount: Number(row.active_tenant_count) || 0,
    monthlyRevenue: toMoney(row.monthly_revenue),
    tags: row.tags ?? [],
    products: (row.products ?? []).map((product) => ({
      id: product.id,
      productCode: product.productCode,
      productName: product.productName,
      productType: mapProductCapabilityType(product.productType),
      source: mapSolutionSource(product.origin),
      role: product.role ?? "",
      status: mapProductCapabilityStatus(product.status),
      sort: Number(product.sort) || 0,
    })),
    tiers: (row.tiers ?? []).map(projectSolutionTier),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export function projectSolutionDetail(
  row: SolutionRow,
): ProductSolutionDetailRecord {
  const base = projectSolution(row);
  return {
    ...base,
    deliveryMode: row.delivery_mode ?? "",
    deliveryBoundaries: row.delivery_boundaries ?? [],
    relatedServicePlans: base.tiers,
  };
}

export async function loadProductSolutions(
  pool: Reader,
): Promise<ProductSolutionRecord[]> {
  const { rows } = await pool.query<SolutionRow>(SOLUTION_SQL, [null]);
  return rows.map(projectSolution);
}

async function loadSolutionRow(
  pool: Reader,
  solutionCode: string,
): Promise<SolutionRow> {
  const { rows } = await pool.query<SolutionRow>(SOLUTION_SQL, [solutionCode]);
  const row = rows[0];
  if (!row) {
    throw new NotFoundException(`Product solution ${solutionCode} not found`);
  }
  return row;
}

export async function loadProductSolutionDetail(
  pool: Reader,
  solutionCode: string,
): Promise<ProductSolutionDetailRecord> {
  return projectSolutionDetail(await loadSolutionRow(pool, solutionCode));
}

// ── 服务套餐详情：方案档位上绑的 plan 的版本 · 价格 · 组件权益 · 计数 ───────────

interface PlanComponentJson {
  productCode: string;
  productName: string;
  productType: string;
  origin: string;
  tier: string | null;
  componentRole: string;
  features: string[];
  quota: Record<string, unknown> | null;
}

interface PlanPriceJson {
  id: string;
  currency: string;
  price: number | string;
  cycleUnit: string;
  cycleCount: number;
}

export interface ServicePlanRow {
  plan_id: string;
  plan_code: string;
  plan_name: string;
  description: string;
  status: string;
  is_public: boolean;
  created_at: Date | string;
  updated_at: Date | string;
  version_no: number | null;
  version_status: string | null;
  price: number | string | null;
  currency: string | null;
  cycle_unit: string | null;
  cycle_count: number | null;
  components: PlanComponentJson[];
  subscription_count: number | string;
  active_tenant_count: number | string;
  monthly_revenue: number | string | null;
}

const SERVICE_PLAN_SQL = `
  SELECT pl.id AS plan_id, pl.plan_code, pl.plan_name,
         COALESCE(pl.description, '') AS description,
         pl.status, pl.is_public, pl.created_at, pl.updated_at,
         ver.version_no, ver.status AS version_status,
         pr.price, pr.currency, pr.cycle_unit, pr.cycle_count,
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object(
                    'productCode', cp.product_code, 'productName', cp.product_name,
                    'productType', cp.product_type, 'origin', cp.origin,
                    'tier', pc.tier, 'componentRole', pc.component_role,
                    'features', pc.features, 'quota', pc.quota)
                  ORDER BY pc.priority ASC, pc.sort_order ASC)
             FROM product.plan_components pc
             JOIN product.products cp ON cp.id = pc.product_id
            WHERE pc.plan_version_id = ver.id
         ), '[]'::jsonb) AS components,
         COALESCE(c.subscription_count, 0) AS subscription_count,
         COALESCE(c.active_tenant_count, 0) AS active_tenant_count,
         COALESCE(c.monthly_revenue, 0) AS monthly_revenue
    FROM product.plans pl
    ${PLAN_VERSION_PICK_LATERAL}
    ${PLAN_PRICE_PICK_LATERAL}
    LEFT JOIN LATERAL (
      SELECT COUNT(*) FILTER (WHERE s.status IN ('active','trialing'))::int AS subscription_count,
             COUNT(DISTINCT s.tenant_id) FILTER (WHERE s.status IN ('active','trialing'))::int AS active_tenant_count,
             COALESCE(SUM(${MRR_MONTHLY_EXPR}), 0)::numeric(18,2) AS monthly_revenue
        FROM product.plan_versions pv
        JOIN metering.subscriptions s ON s.plan_version_id = pv.id AND s.deleted_at IS NULL
       WHERE pv.plan_id = pl.id
    ) c ON true
   WHERE pl.id = $1 AND pl.deleted_at IS NULL
`;

/** quota JSON → 紧凑一行：`doc.words 1,000,000 · storage.max 不限`。 */
export function quotaSummary(quota: Record<string, unknown> | null): string {
  if (!quota || typeof quota !== "object") return "";
  const parts: string[] = [];
  for (const [key, value] of Object.entries(quota)) {
    if (typeof value === "number") {
      parts.push(
        value === -1
          ? `${key} 不限`
          : `${key} ${new Intl.NumberFormat("zh-CN").format(value)}`,
      );
    } else if (typeof value === "boolean") {
      if (value) parts.push(key);
    } else if (value !== null && value !== undefined) {
      parts.push(
        `${key} ${typeof value === "string" ? value : JSON.stringify(value)}`,
      );
    }
  }
  return parts.join(" · ");
}

export function projectServicePlan(
  solution: SolutionRow,
  tier: Tier,
  plan: ServicePlanRow,
): ProductServicePlanDetailRecord {
  const base = projectSolution(solution);
  const componentByCode = new Map(
    (plan.components ?? []).map((component) => [
      component.productCode,
      component,
    ]),
  );
  const roleByCode = new Map(
    base.products.map((product) => [product.productCode, product.role]),
  );
  const entitlements: ProductServicePlanEntitlement[] = (
    plan.components ?? []
  ).map((component) => ({
    productCode: component.productCode,
    productName: component.productName,
    productType: mapProductCapabilityType(component.productType),
    source: mapSolutionSource(component.origin),
    role: roleByCode.get(component.productCode) || component.componentRole,
    included: true,
    quotaSummary: quotaSummary(component.quota),
    note: (component.features ?? []).join("、"),
  }));
  // 方案里有、这个套餐的组件里没有的产品：如实标为不包含（不猜配额）。
  for (const product of base.products) {
    if (componentByCode.has(product.productCode)) continue;
    entitlements.push({
      productCode: product.productCode,
      productName: product.productName,
      productType: product.productType,
      source: product.source,
      role: product.role,
      included: false,
      quotaSummary: "",
      note: "",
    });
  }
  const included = entitlements.filter((item) => item.included).length;
  return {
    id: `${base.solutionCode}:${tier}`,
    solutionCode: base.solutionCode,
    solutionName: base.solutionName,
    industry: base.industry,
    scenario: base.scenario,
    customerSegment: base.customerSegment,
    ownerTeam: base.ownerTeam,
    tierCode: tier,
    tierName: plan.plan_name,
    planCode: plan.plan_code,
    summary: plan.description ?? "",
    status: toSolutionStatus(plan.status),
    isPublic: plan.is_public,
    versionNo: plan.version_no === null ? null : Number(plan.version_no),
    versionStatus:
      plan.version_status === "published" || plan.version_status === "draft"
        ? plan.version_status
        : null,
    price: servicePlanPrice({
      price: plan.price,
      currency: plan.currency,
      cycleUnit: plan.cycle_unit,
      cycleCount: plan.cycle_count,
    }),
    subscriptionCount: Number(plan.subscription_count) || 0,
    activeTenantCount: Number(plan.active_tenant_count) || 0,
    monthlyRevenue: toMoney(plan.monthly_revenue),
    deliveryMode: solution.delivery_mode ?? "",
    entitlements,
    includedProductCount: included,
    excludedProductCount: entitlements.length - included,
    createdAt: toIso(plan.created_at),
    updatedAt: toIso(plan.updated_at),
  };
}

export async function loadProductServicePlanDetail(
  pool: Reader,
  solutionCode: string,
  tier: Tier,
): Promise<ProductServicePlanDetailRecord> {
  const solution = await loadSolutionRow(pool, solutionCode);
  const binding = (solution.tiers ?? []).find((item) => item.tier === tier);
  if (!binding) {
    throw new NotFoundException(
      `Service plan ${solutionCode}/${tier} not found`,
    );
  }
  const { rows } = await pool.query<ServicePlanRow>(SERVICE_PLAN_SQL, [
    binding.planId,
  ]);
  const plan = rows[0];
  if (!plan) {
    throw new NotFoundException(
      `Plan bound to ${solutionCode}/${tier} no longer exists`,
    );
  }
  return projectServicePlan(solution, tier, plan);
}

// ── 产品发布 = 已发布的套餐版本 ──────────────────────────────────────────────
// 一条 = 一个 status='published' 的 plan_version；产品 = 该版本的 primary 组件所指
// 产品（没有 primary 组件的版本不是任何产品的发布，INNER JOIN 直接滤掉）。

export interface ReleaseRow {
  id: string;
  version_no: number;
  version_created_at: Date | string;
  plan_code: string;
  plan_name: string;
  description: string;
  is_public: boolean;
  plan_status: string;
  plan_updated_at: Date | string;
  is_current: boolean;
  product_code: string;
  product_name: string;
  product_status: string;
  origin: string;
  prices: PlanPriceJson[];
  components: PlanComponentJson[];
}

const RELEASES_SQL = `
  SELECT pv.id, pv.version_no, pv.created_at AS version_created_at,
         p.plan_code, p.plan_name, COALESCE(p.description, '') AS description,
         p.is_public, p.status AS plan_status, p.updated_at AS plan_updated_at,
         (pv.id = p.current_version_id) AS is_current,
         prod.product_code, prod.product_name, prod.status AS product_status, prod.origin,
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object(
                    'id', pp.id, 'currency', pp.currency, 'price', pp.price,
                    'cycleUnit', pp.cycle_unit, 'cycleCount', pp.cycle_count)
                  ORDER BY CASE pp.cycle_unit WHEN 'month' THEN 0 ELSE 1 END, pp.cycle_count ASC)
             FROM product.plan_prices pp WHERE pp.plan_version_id = pv.id
         ), '[]'::jsonb) AS prices,
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object(
                    'productCode', cp.product_code, 'productName', cp.product_name,
                    'productType', cp.product_type, 'origin', cp.origin,
                    'tier', pc.tier, 'componentRole', pc.component_role,
                    'features', pc.features, 'quota', pc.quota)
                  ORDER BY pc.priority ASC, pc.sort_order ASC)
             FROM product.plan_components pc
             JOIN product.products cp ON cp.id = pc.product_id
            WHERE pc.plan_version_id = pv.id
         ), '[]'::jsonb) AS components
    FROM product.plan_versions pv
    JOIN product.plans p ON p.id = pv.plan_id
    JOIN LATERAL (
      SELECT pr.product_code, pr.product_name, pr.status, pr.origin
        FROM product.plan_components pc
        JOIN product.products pr ON pr.id = pc.product_id
       WHERE pc.plan_version_id = pv.id AND pc.component_role = 'primary'
       ORDER BY pc.priority ASC, pc.sort_order ASC
       LIMIT 1
    ) prod ON true
   WHERE pv.status = 'published' AND p.deleted_at IS NULL
   ORDER BY prod.product_code ASC, p.plan_code ASC, pv.version_no DESC
`;

function projectReleaseFeature(
  component: PlanComponentJson,
): ProductReleaseFeature {
  const quota = component.quota ?? null;
  const values = quota && typeof quota === "object" ? Object.values(quota) : [];
  const numeric = values.filter((v): v is number => typeof v === "number");
  return {
    code: component.productCode,
    name: component.productName,
    type: numeric.length > 0 ? "quota" : "function",
    quotaValue: typeof quota === "number" ? quota : null,
    isUnlimited: numeric.includes(-1),
    config: quota && typeof quota === "object" ? quota : null,
  };
}

export function projectRelease(row: ReleaseRow): ProductReleaseRecord {
  const prices: ProductReleasePrice[] = (row.prices ?? []).map(
    (price, index) => ({
      id: price.id,
      currency: price.currency,
      price: toMoney(price.price),
      originalPrice: null,
      periodType: periodTypeOf(price.cycleUnit),
      periodValue: Number(price.cycleCount) || 1,
      isDefault: index === 0,
      isActive: true,
    }),
  );
  const components = row.components ?? [];
  return {
    id: row.id,
    productCode: row.product_code,
    productName: row.product_name,
    productStatus: mapProductCapabilityStatus(row.product_status),
    releaseCode: `${row.plan_code}@v${row.version_no}`,
    releaseName: row.plan_name,
    description: row.description ?? "",
    releaseType: row.origin === "third_party" ? "custom" : "standard",
    versionLabels: components
      .filter((c) => c.componentRole === "primary" && c.tier)
      .map((c) => c.tier as string),
    isFree: prices.length > 0 && prices.every((price) => price.price === 0),
    isPublic: row.is_public,
    isActive: row.plan_status === "active",
    isCurrent: row.is_current,
    prices,
    features: components.map(projectReleaseFeature),
    createdAt: toIso(row.version_created_at),
    updatedAt: toIso(row.plan_updated_at),
  };
}

export async function loadProductReleases(
  pool: Reader,
): Promise<ProductReleaseRecord[]> {
  const { rows } = await pool.query<ReleaseRow>(RELEASES_SQL);
  return rows.map(projectRelease);
}
// ── plan publishing desk: matrix read model · create inputs ─────────────────

/** A version pointer as the matrix shows it — enough to badge, not to edit. */
export interface PlanMatrixVersionRef {
  id: string;
  versionNo: number;
  /** 主版本号 V1/V2…（人设定的商业代际，不自增）。 */
  majorNo: number;
  /** 发布（启用）那一刻；null = 未发布，或发布于该列上线之前。 */
  publishedAt: string | null;
}

/** One plan laid on a product's tier ladder. */
export interface PlanMatrixPlan {
  planId: string;
  planCode: string;
  planName: string;
  planStatus: string;
  tier: Tier;
  /**
   * 订阅方式：`true` = 公开订阅（客户在 console 自助下单），
   * `false` = 邀请订阅（不进客户的套餐阶梯，只有持邀请券的人看得见、买得到）。
   *
   * 这一列此前**只有 INSERT 时硬编码的 `true`，没有任何写路径**——要把一个套餐
   * 设成邀请制，只能写迁移。运营侧看不见也改不了，而发券那一侧（卡券 `invite`）
   * 已经做完了，整条链缺的就是这个开关。
   */
  isPublic: boolean;
  /** 套餐说明（客户可见）；可改，见 `PATCH plans/:planId`。 */
  description: string;
  /** 展示轴：客户端显不显示。与 is_public（能不能自助买）是正交的两根轴。 */
  isCustomerVisible: boolean;
  /** 展示轴：运营端显不显示。 */
  isWorkforceVisible: boolean;
  /** The live version (plans.current_version_id, published); null = never published. */
  currentVersion:
    | (PlanMatrixVersionRef & { prices: PlanVersionPrice[] })
    | null;
  /** The editable draft in flight; null = none open. */
  draftVersion: PlanMatrixVersionRef | null;
  versionCount: number;
  /**
   * 还钉在这个套餐**任一版本**上的活订阅数（`deleted_at IS NULL`）。
   *
   * 一级列表的「在订阅」列用它，并据此把「现在为 0」与「从未售出」分开呈现。
   * **与删除判据的计数口径不同**：那边问的是「卖过没有」，所以**不滤**
   * `deleted_at`；这里问的是「现在还有没有人在用」，所以滤。同一个词两处含义
   * 不同，别互相套用。
   */
  subscriptionCount: number;
}

/** One row of the publishing desk: a sellable product and its tier ladder. */
export interface PlanMatrixProduct {
  productCode: string;
  productName: string;
  productStatus: string;
  plans: PlanMatrixPlan[];
}

interface PlanMatrixRow {
  product_code: string;
  product_name: string;
  product_status: string;
  plan_id: string | null;
  plan_code: string | null;
  plan_name: string | null;
  plan_status: string | null;
  is_public: boolean | null;
  plan_description: string | null;
  is_customer_visible: boolean | null;
  is_workforce_visible: boolean | null;
  tier: string | null;
  current_version_id: string | null;
  current_version_no: number | null;
  current_major_no: number | null;
  current_published_at: Date | string | null;
  current_prices: PlanVersionPrice[] | null;
  draft_version_id: string | null;
  draft_version_no: number | null;
  draft_major_no: number | null;
  version_count: number | null;
  subscription_count: number | null;
}

/**
 * One query, flat rows: products LEFT JOIN their plans (so a product with no
 * plans still yields a row and shows an empty ladder). The lateral `axis`
 * resolves each plan's product/tier from the current version's primary
 * component, falling back to the newest version — a never-published skeleton
 * must still land on its slot.
 */
const PLAN_MATRIX_SQL = `
  SELECT pr.product_code, pr.product_name, pr.status AS product_status,
         plan.plan_id, plan.plan_code, plan.plan_name, plan.plan_status,
         plan.is_public, plan.plan_description,
         plan.is_customer_visible, plan.is_workforce_visible, plan.tier,
         plan.current_version_id, plan.current_version_no,
         plan.current_major_no, plan.current_published_at, plan.current_prices,
         plan.draft_version_id, plan.draft_version_no, plan.draft_major_no,
         plan.version_count,
         plan.subscription_count
    FROM product.products pr
    LEFT JOIN LATERAL (
      SELECT p.id AS plan_id, p.plan_code, p.plan_name, p.status AS plan_status,
             p.is_public, coalesce(p.description, '') AS plan_description,
             p.is_customer_visible, p.is_workforce_visible,
             axis.tier,
             cv.id AS current_version_id, cv.version_no AS current_version_no,
             cv.major_no AS current_major_no, cv.published_at AS current_published_at,
             COALESCE((
               SELECT jsonb_agg(jsonb_build_object('cycleUnit', pp.cycle_unit, 'price', to_char(pp.price, 'FM999999999990.00'))
                                ORDER BY pp.cycle_unit)
                 FROM product.plan_prices pp WHERE pp.plan_version_id = cv.id
             ), '[]'::jsonb) AS current_prices,
             d.id AS draft_version_id, d.version_no AS draft_version_no,
             d.major_no AS draft_major_no,
             (SELECT count(*)::int FROM product.plan_versions v WHERE v.plan_id = p.id) AS version_count,
             -- 跨该套餐的全部版本反查活订阅，不只当前版本：一个客户订的是套餐，
             -- 落到哪个版本由 current_version_id 解析。所以「这个套餐有多少人在用」
             -- 必须跨版本数——只看当前版本会把仍钉在旧版上的老客户漏掉。
             (SELECT count(*)::int
                FROM metering.subscriptions s
                JOIN product.plan_versions pv2 ON pv2.id = s.plan_version_id
               WHERE pv2.plan_id = p.id AND s.deleted_at IS NULL) AS subscription_count
        FROM product.plans p
        JOIN LATERAL (
          SELECT pc.tier
            FROM product.plan_versions pv
            JOIN product.plan_components pc
              ON pc.plan_version_id = pv.id AND pc.component_role = 'primary'
           WHERE pv.plan_id = p.id AND pc.product_id = pr.id
           ORDER BY (pv.id = p.current_version_id) DESC, pv.version_no DESC
           LIMIT 1
        ) axis ON true
        LEFT JOIN product.plan_versions cv
          ON cv.id = p.current_version_id AND cv.status = 'published'
        LEFT JOIN LATERAL (
          SELECT v.id, v.version_no, v.major_no
            FROM product.plan_versions v
           WHERE v.plan_id = p.id AND v.status = 'draft' AND NOT v.is_locked
           ORDER BY v.version_no DESC
           LIMIT 1
        ) d ON true
       WHERE p.deleted_at IS NULL
         AND ($1::bool OR p.status <> 'deprecated')
    ) plan ON true
   WHERE pr.deleted_at IS NULL AND pr.standalone_subscribable
   ORDER BY pr.sort ASC, pr.product_name ASC, pr.product_code ASC, plan.plan_code ASC
`;

function groupPlanMatrix(rows: PlanMatrixRow[]): PlanMatrixProduct[] {
  const byProduct = new Map<string, PlanMatrixProduct>();
  for (const row of rows) {
    let product = byProduct.get(row.product_code);
    if (!product) {
      product = {
        productCode: row.product_code,
        productName: row.product_name,
        productStatus: row.product_status,
        plans: [],
      };
      byProduct.set(row.product_code, product);
    }
    // A plan whose axis tier is somehow NULL cannot sit on the ladder; the
    // DDL forbids primary components without a tier, so skip defensively.
    if (!row.plan_id || !row.tier || !TIERS.includes(row.tier as Tier)) {
      continue;
    }
    product.plans.push({
      planId: row.plan_id,
      planCode: row.plan_code ?? "",
      planName: row.plan_name ?? "",
      planStatus: row.plan_status ?? "active",
      /* 读不到按公开算：漏判成「邀请制」会把一个在售档从客户阶梯里摘掉。 */
      isPublic: row.is_public !== false,
      description: row.plan_description ?? "",
      /* 读不到按可见算：漏判成「不可见」会把一个在售档从客户眼前摘掉。 */
      isCustomerVisible: row.is_customer_visible !== false,
      isWorkforceVisible: row.is_workforce_visible !== false,
      tier: row.tier as Tier,
      currentVersion:
        row.current_version_id && row.current_version_no !== null
          ? {
              id: row.current_version_id,
              versionNo: row.current_version_no,
              majorNo: Number(row.current_major_no ?? 1),
              publishedAt: row.current_published_at
                ? new Date(row.current_published_at).toISOString()
                : null,
              prices: row.current_prices ?? [],
            }
          : null,
      draftVersion:
        row.draft_version_id && row.draft_version_no !== null
          ? {
              id: row.draft_version_id,
              versionNo: row.draft_version_no,
              majorNo: Number(row.draft_major_no ?? 1),
              /* 草稿没有发布时刻——它还没启用。 */
              publishedAt: null,
            }
          : null,
      versionCount: row.version_count ?? 0,
      subscriptionCount: Number(row.subscription_count ?? 0),
    });
  }
  return [...byProduct.values()];
}

/**
 * Occupancy for plan CREATION: any non-deprecated plan whose tier axis (see
 * PLAN_MATRIX_SQL) already sits on this product+tier blocks a second skeleton
 * — a draft-only plan occupies its slot too, else two operators could open
 * two skeletons for one shelf position. Publication has its own guard.
 */
const PLAN_TIER_AXIS_OCCUPANCY_SQL = `
  SELECT p.plan_code
    FROM product.plans p
    JOIN LATERAL (
      SELECT pc.tier
        FROM product.plan_versions pv
        JOIN product.plan_components pc
          ON pc.plan_version_id = pv.id AND pc.component_role = 'primary'
       WHERE pv.plan_id = p.id AND pc.product_id = $1
       ORDER BY (pv.id = p.current_version_id) DESC, pv.version_no DESC
       LIMIT 1
    ) axis ON true
   WHERE p.deleted_at IS NULL AND p.status <> 'deprecated' AND axis.tier = $2
   LIMIT 1
`;

/** POST /plans body. */
export interface CreatePlanInput {
  planCode?: unknown;
  planName?: unknown;
  description?: unknown;
  productCode?: unknown;
  tier?: unknown;
}

interface ValidatedCreatePlanInput {
  planCode: string;
  planName: string;
  description: string | null;
  productCode: string;
  tier: Tier;
}

const PLAN_CODE_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;

/**
 * Validate the create-plan body before any DB access (same contract as the
 * bundled reader: shape errors are 400s that never touch a pool).
 *
 * @throws {BadRequestException} on any shape violation
 */
function readCreatePlanInput(
  body: CreatePlanInput | undefined,
): ValidatedCreatePlanInput {
  const planCode =
    typeof body?.planCode === "string" ? body.planCode.trim() : "";
  if (!PLAN_CODE_PATTERN.test(planCode)) {
    throw new BadRequestException(
      "planCode must be 2-64 chars of lowercase letters, digits and hyphens",
    );
  }
  const planName =
    typeof body?.planName === "string" ? body.planName.trim() : "";
  if (!planName || planName.length > 128) {
    throw new BadRequestException("planName is required (max 128 chars)");
  }
  let description: string | null = null;
  if (body?.description !== undefined && body?.description !== null) {
    if (
      typeof body.description !== "string" ||
      body.description.length > 2000
    ) {
      throw new BadRequestException(
        "description must be a string (max 2000 chars)",
      );
    }
    description = body.description.trim() || null;
  }
  const productCode =
    typeof body?.productCode === "string" ? body.productCode.trim() : "";
  if (!productCode) {
    throw new BadRequestException("productCode is required");
  }
  const tier = typeof body?.tier === "string" ? body.tier : "";
  if (!TIERS.includes(tier as Tier)) {
    throw new BadRequestException(`tier must be one of: ${TIERS.join(", ")}`);
  }
  return {
    planCode,
    planName,
    description,
    productCode,
    tier: tier as Tier,
  };
}
