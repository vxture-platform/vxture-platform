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
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import type { Pool, PoolClient } from "pg";
import { TIERS, type Tier } from "@vxture-platform/shared";
import { ADMIN_BFF_RO_POOL, ADMIN_BFF_RW_POOL } from "../tokens";
import { RequireStepUp } from "../auth/step-up.decorator";
import { insertOperatorAuditLog } from "../audit/audit-log";
import { isValidReleaseStage, RELEASE_STAGES } from "@vxture/core-utils";
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
  ): Promise<{ published: true; versionId: string }> {
    assertCanManageProducts(req);
    const client = await this.rwPool.connect();
    try {
      await client.query("BEGIN");
      const cur = await client.query<{ plan_id: string; status: string }>(
        `SELECT plan_id, status FROM product.plan_versions WHERE id = $1 FOR UPDATE`,
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
      // publish: freeze the version and make it the plan's live version. A
      // prior published version stays 'published' (subscriptions pinned to it
      // keep resolving) — it just stops being current.
      await client.query(
        `UPDATE product.plan_versions SET status = 'published', is_locked = true WHERE id = $1`,
        [versionId],
      );
      await client.query(
        `UPDATE product.plans SET current_version_id = $2, updated_at = now() WHERE id = $1`,
        [row.plan_id, versionId],
      );
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
  ): Promise<PlanMatrixProduct[]> {
    assertCanManageProducts(req);
    const { rows } = await this.pool.query<PlanMatrixRow>(PLAN_MATRIX_SQL);
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
   */
  @Post("plans/:planId/versions")
  async createDraftVersion(
    @Req() req: Request & RequestContext,
    @Param("planId") planId: string,
  ): Promise<PlanVersionDetail> {
    assertCanManageProducts(req);
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
        trial_cycle_unit: string | null;
        trial_cycle_count: number | null;
        max_no: number;
      }>(
        `SELECT v.id, v.version_no, v.trial_cycle_unit, v.trial_cycle_count,
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
      const version = await client.query<{ id: string }>(
        `INSERT INTO product.plan_versions
           (id, plan_id, version_no, status, is_locked, trial_cycle_unit, trial_cycle_count, created_by, created_at)
         VALUES (gen_random_uuid(), $1, $2, 'draft', false, $3, $4, $5, now())
         RETURNING id`,
        [
          planId,
          nextNo,
          sourceRow.trial_cycle_unit,
          sourceRow.trial_cycle_count,
          req.user!.id,
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

interface PlanVersionPrice {
  cycleUnit: string;
  price: string;
}

interface PlanVersionSummary {
  id: string;
  versionNo: number;
  status: string;
  isLocked: boolean;
  isCurrent: boolean;
  /** ISO timestamp — the version timeline is unreadable without a date axis. */
  createdAt: string;
  prices: PlanVersionPrice[];
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
  status: string;
  is_locked: boolean;
  is_current: boolean;
  created_at: Date | string;
  prices: PlanVersionPrice[];
}

const PLAN_VERSIONS_SQL = `
  SELECT pv.id, pv.version_no, pv.status, pv.is_locked, pv.created_at,
         (pv.id = p.current_version_id) AS is_current,
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
    status: row.status,
    isLocked: row.is_locked,
    isCurrent: row.is_current,
    createdAt: new Date(row.created_at).toISOString(),
    prices: row.prices ?? [],
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
    `SELECT pv.id, pv.plan_id, pv.version_no, pv.status, pv.is_locked, pv.created_at,
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
  const { rows } = await client.query<{ id: string; product_code: string }>(
    `SELECT id, product_code FROM product.products
      WHERE deleted_at IS NULL AND product_code = ANY($1::text[])`,
    [items.map((item) => item.productCode)],
  );
  const byCode = new Map(rows.map((row) => [row.product_code, row.id]));
  return items.map((item, index) => {
    const field = `components[${index}].productCode`;
    if (primary && item.productCode === primary.product_code) {
      throw new BadRequestException(
        `${field}: ${item.productCode} is this version's primary product and cannot be bundled into itself`,
      );
    }
    const productId = byCode.get(item.productCode);
    if (!productId) {
      throw new NotFoundException({
        statusCode: 404,
        message: `Product ${item.productCode} not found`,
        field,
      });
    }
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
interface ProductCatalogRow {
  id: string;
  product_code: string;
  product_type: string; // 受管枚举 @vxture/core-utils: general_platform|industry_platform|general_agent|industry_agent|undefined
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
    p.origin,
    p.release_stage,
    p.marketing,
    p.product_name,
    p.description,
    p.status,
    p.is_customer_visible,
    p.is_workforce_visible,
    p.tags,
    c.code AS category_code,
    (SELECT COUNT(DISTINCT pv.plan_id)::int
       FROM product.plan_components comp
       JOIN product.plan_versions pv ON pv.id = comp.plan_version_id
      WHERE comp.product_id = p.id) AS plan_count,
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
  const [products, metrics, webhooks, solutions] = await Promise.all([
    pool.query<ProductCatalogRow>(PRODUCT_CATALOG_SQL),
    pool.query<ProductMetricRow>(
      `SELECT product_id, metric_key, metric_unit, reset_period, merge_strategy
         FROM product.product_metrics`,
    ),
    pool.query<ProductWebhookRow>(
      `SELECT product_id, webhook_url FROM product.product_webhooks`,
    ),
    pool.query<ProductSolutionLinkRow>(PRODUCT_SOLUTION_LINKS_SQL),
  ]);

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
      metricName: metric.metric_key,
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
      source,
      status,
      // 成熟度轴与营销内容(产品目录录入的业务字段,原样透传给前端表单回填)。
      releaseStage: row.release_stage,
      marketing: row.marketing ?? null,
      visibility: row.is_customer_visible ? "public" : "internal",
      region: "global",
      ownerTeam: "",
      capabilitySummary: row.description ?? "",
      accessModes: [],
      tags: row.tags ?? [],
      meteringUnit: productMetrics[0]?.unit ?? "",
      billingMode: "",
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
  if (input.industry !== undefined)
    fields.industry = readOptionalText(input.industry, "industry", 128);
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
}

/** One plan laid on a product's tier ladder. */
export interface PlanMatrixPlan {
  planId: string;
  planCode: string;
  planName: string;
  planStatus: string;
  tier: Tier;
  /** The live version (plans.current_version_id, published); null = never published. */
  currentVersion:
    | (PlanMatrixVersionRef & { prices: PlanVersionPrice[] })
    | null;
  /** The editable draft in flight; null = none open. */
  draftVersion: PlanMatrixVersionRef | null;
  versionCount: number;
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
  tier: string | null;
  current_version_id: string | null;
  current_version_no: number | null;
  current_prices: PlanVersionPrice[] | null;
  draft_version_id: string | null;
  draft_version_no: number | null;
  version_count: number | null;
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
         plan.plan_id, plan.plan_code, plan.plan_name, plan.plan_status, plan.tier,
         plan.current_version_id, plan.current_version_no, plan.current_prices,
         plan.draft_version_id, plan.draft_version_no, plan.version_count
    FROM product.products pr
    LEFT JOIN LATERAL (
      SELECT p.id AS plan_id, p.plan_code, p.plan_name, p.status AS plan_status,
             axis.tier,
             cv.id AS current_version_id, cv.version_no AS current_version_no,
             COALESCE((
               SELECT jsonb_agg(jsonb_build_object('cycleUnit', pp.cycle_unit, 'price', to_char(pp.price, 'FM999999999990.00'))
                                ORDER BY pp.cycle_unit)
                 FROM product.plan_prices pp WHERE pp.plan_version_id = cv.id
             ), '[]'::jsonb) AS current_prices,
             d.id AS draft_version_id, d.version_no AS draft_version_no,
             (SELECT count(*)::int FROM product.plan_versions v WHERE v.plan_id = p.id) AS version_count
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
          SELECT v.id, v.version_no
            FROM product.plan_versions v
           WHERE v.plan_id = p.id AND v.status = 'draft' AND NOT v.is_locked
           ORDER BY v.version_no DESC
           LIMIT 1
        ) d ON true
       WHERE p.deleted_at IS NULL
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
      tier: row.tier as Tier,
      currentVersion:
        row.current_version_id && row.current_version_no !== null
          ? {
              id: row.current_version_id,
              versionNo: row.current_version_no,
              prices: row.current_prices ?? [],
            }
          : null,
      draftVersion:
        row.draft_version_id && row.draft_version_no !== null
          ? { id: row.draft_version_id, versionNo: row.draft_version_no }
          : null,
      versionCount: row.version_count ?? 0,
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
