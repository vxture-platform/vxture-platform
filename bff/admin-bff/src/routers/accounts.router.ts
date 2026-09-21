/**
 * accounts.router.ts - 终端账号运营路由
 * @package @vxture/bff-admin
 *
 * Description: 平台终端账号（customer realm）只读运营接口，接 account.users（18-schema）。
 *   列表 GET /api/accounts、详情 GET /api/accounts/:id。
 *   主体来自 account.users(+user_profiles)；租户绑定/主租户/角色来自 tenancy.tenant_memberships
 *   + tenancy.tenants + access.roles；安全态（最后活跃/30 天登录数）来自 session.auth_sessions
 *   + session.login_attempts。全程只读，无写路径。
 *
 * @author AI-Generated
 * @date 2026-07-04
 * @version 1.0
 *
 * @copyright Vxture Team
 *
 * @layer Application
 * @category Router
 */

import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request, Response } from "express";
import type { Pool } from "pg";
import { insertOperatorAuditLog } from "../audit/audit-log";
import { RequireStepUp } from "../auth/step-up.decorator";
import { OperatorAdminService } from "../auth/operator-admin.service";
import { ADMIN_BFF_RO_POOL, ADMIN_BFF_RW_POOL } from "../tokens";
import { TICKET_STATUSES } from "@vxture-platform/shared";
import type { TicketStatus } from "@vxture-platform/shared";
import { requireOperatorId, requireUuid } from "./governance.shared";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
import type {
  AccountLoginAttempt,
  AccountOperationDetailRecord,
  AccountOperationRecord,
  AccountOperationStatus,
  AccountTenantBinding,
  AccountTicket,
  AccountVerifiedStatus,
  RequestContext,
  TenantOperationType,
} from "../types/console.types";

@Controller("api/accounts")
export class AccountsRouter {
  constructor(
    @Inject(ADMIN_BFF_RO_POOL) private readonly pool: Pool,
    @Inject(ADMIN_BFF_RW_POOL) private readonly rwPool: Pool,
    @Inject(OperatorAdminService)
    private readonly operatorAdmin: OperatorAdminService,
  ) {}

  /**
   * 详情路由的参数是**面向用户的账号编码**（`user_no`），不是内部 UUID——地址栏是
   * 可见面，与租户详情同规矩。BFF 双接受：存量书签与审计日志里记的是 id。
   *
   * `user_no` 是 **bigint**：把非数字串直接丢给它比较，Postgres 转型时抛 22P02，
   * 出去是 500 而不是 404，所以先用形状挡一道。19 位是 bigint 的量级上限。
   *
   * 2026-09-16 实测代价：详情页按编码导航、这里只认 UUID，`u.id = '1649201736'`
   * 让整页变成「未找到账号」而接口回 500。**照抄一条约定要连它的两半一起抄**
   * ——前端用可读码与 BFF 双接受本是一件事。
   */
  private async resolveAccountId(value: string): Promise<string> {
    if (UUID_RE.test(value ?? "")) return value;
    if (!/^\d{1,19}$/.test(value ?? "")) {
      throw new NotFoundException("Account not found");
    }
    const { rows } = await this.pool.query<{ id: string }>(
      `select id from account.users where user_no = $1::bigint and deleted_at is null limit 1`,
      [value],
    );
    if (!rows[0]) throw new NotFoundException("Account not found");
    return rows[0].id;
  }

  @Get()
  async listAccounts(
    @Req() req: Request & RequestContext,
  ): Promise<AccountOperationRecord[]> {
    assertCanManageAccounts(req);
    const canReadPii = hasPiiAccess(req);

    const { rows } = await this.pool.query<AccountRow>(ACCOUNT_LIST_SQL);
    return rows.map((row) => mapAccountRow(row, canReadPii));
  }

  /**
   * 详情 = 标量投影（与列表同一条 SQL）+ 三段明细。先拿主行判 404，再并发打三条
   * ——它们互不依赖，串行只是白等；只读池，不必同一连接。与租户详情同形。
   */
  @Get(":id")
  async getAccount(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
  ): Promise<AccountOperationDetailRecord> {
    assertCanManageAccounts(req);
    const canReadPii = hasPiiAccess(req);

    const userId = await this.resolveAccountId(id);
    const { rows } = await this.pool.query<AccountRow>(ACCOUNT_DETAIL_SQL, [
      userId,
    ]);
    const row = rows[0];
    if (!row) {
      throw new NotFoundException("Account not found");
    }

    const [products, tickets, ticketCounts, logins] = await Promise.all([
      this.pool.query<AccountProductRow>(ACCOUNT_DETAIL_PRODUCTS_SQL, [userId]),
      this.pool.query<AccountTicketRow>(ACCOUNT_DETAIL_TICKETS_SQL, [userId]),
      this.pool.query<AccountTicketCountsRow>(
        ACCOUNT_DETAIL_TICKET_COUNTS_SQL,
        [userId],
      ),
      this.pool.query<AccountLoginRow>(ACCOUNT_DETAIL_LOGINS_SQL, [userId]),
    ]);
    const counts = ticketCounts.rows[0];

    return {
      ...mapAccountRow(row, canReadPii),
      productNames: products.rows.map((p) => p.product_name),
      tickets: tickets.rows.map(mapAccountTicketRow),
      ticketOpenCount: counts?.open_count ?? 0,
      ticketTotalCount: counts?.total_count ?? 0,
      loginHistory: logins.rows.map(mapAccountLoginRow),
    };
  }

  /**
   * GET /api/accounts/:id/avatar — 用户头像字节（运营在详情页看原图，审违规用）。
   *
   * 只服务**自定义**头像：`account.user_avatars` 有行 → 返字节；无行 → 404，由前端
   * 画 DS 的平台默认图。按内容哈希版本化，故 immutable 长缓存；private：运营台的图
   * 不进共享缓存。
   */
  @Get(":id/avatar")
  async getAccountAvatar(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
    @Res() res: Response,
  ): Promise<void> {
    assertCanManageAccounts(req);
    const userId = await this.resolveAccountId(id);
    const { rows } = await this.pool.query<AvatarRow>(
      `select data, content_type, hash from account.user_avatars
        where user_id = $1 limit 1`,
      [userId],
    );
    const avatar = rows[0];
    if (!avatar) {
      res.status(404).end();
      return;
    }
    res.setHeader("Content-Type", avatar.content_type);
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("ETag", `"${avatar.hash}"`);
    res.end(avatar.data);
  }

  /**
   * POST /api/accounts/:id/avatar/reset — 重置为平台默认（违规图片处置）。
   *
   * 重置 = **删行**，不写默认字节：「有行 = 用户传的，无行 = 默认」这个判据因此
   * 天然成立。原图不留存、**不可撤回**，故 @RequireStepUp。
   *
   * `users.avatar_hash` 是供 claim 轻读的冗余列，同一事务清掉——否则 token 里的
   * `picture` 还指向一张已经不存在的图。
   */
  @Post(":id/avatar/reset")
  @RequireStepUp()
  async resetAccountAvatar(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
  ): Promise<{ status: "ok"; removed: boolean }> {
    assertCanResetUserAvatar(req);
    const userId = await this.resolveAccountId(id);
    const client = await this.rwPool.connect();
    let removed = false;
    let previousHash: string | null = null;
    try {
      await client.query("begin");
      const { rows } = await client.query<{ hash: string }>(
        `delete from account.user_avatars where user_id = $1 returning hash`,
        [userId],
      );
      removed = rows.length > 0;
      previousHash = rows[0]?.hash ?? null;
      await client.query(
        `update account.user_profiles set avatar_hash = null, updated_at = now()
          where user_id = $1 and avatar_hash is not null`,
        [userId],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
    await insertOperatorAuditLog(this.rwPool, req, {
      action: "account.avatar_reset",
      resourceType: "account_user",
      resourceId: userId,
      // 删掉的图不留存，只留内容哈希——事后能对上「删的是哪一张」。
      ...(removed ? { before: { avatarHash: previousHash } } : {}),
      after: { avatarHash: null },
    });
    return { status: "ok", removed };
  }

  // ── C12 write path — admin处置 C 端账号（委派 IdP，守卫 user:account.manage）──
  // 凭据/会话由 IdP 拥有；admin-bff 只委派 + 本地写审计。actor = RP 会话，非请求体。

  // POST /api/accounts/:id/disable — 全禁用（status='disabled'）+ 吊销全部会话。
  @Post(":id/disable")
  async disableAccount(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
    @Body() body: { reason?: string },
  ): Promise<{ ok: true; status: string; revoked: number }> {
    assertCanManageAccountLifecycle(req);
    const actorId = requireOperatorId(req);
    const userId = requireUuid(id, "Invalid account id");
    const result = await this.operatorAdmin.disableAccount(
      userId,
      actorId,
      body?.reason,
    );
    await insertOperatorAuditLog(this.rwPool, req, {
      action: "account.disable",
      resourceType: "account_user",
      resourceId: userId,
      after: { status: result.status, revoked: result.revoked },
    });
    return result;
  }

  // POST /api/accounts/:id/enable — 恢复（status='active'）。
  @Post(":id/enable")
  async enableAccount(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
    @Body() body: { reason?: string },
  ): Promise<{ ok: true; status: string }> {
    assertCanManageAccountLifecycle(req);
    const actorId = requireOperatorId(req);
    const userId = requireUuid(id, "Invalid account id");
    const result = await this.operatorAdmin.enableAccount(
      userId,
      actorId,
      body?.reason,
    );
    await insertOperatorAuditLog(this.rwPool, req, {
      action: "account.enable",
      resourceType: "account_user",
      resourceId: userId,
      after: { status: result.status },
    });
    return result;
  }

  // POST /api/accounts/:id/force-logout — 吊销该用户全部活跃会话。
  @Post(":id/force-logout")
  async forceLogoutAccount(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
    @Body() body: { reason?: string },
  ): Promise<{ ok: true; revoked: number }> {
    assertCanManageAccountLifecycle(req);
    const actorId = requireOperatorId(req);
    const userId = requireUuid(id, "Invalid account id");
    const result = await this.operatorAdmin.forceLogoutAccount(
      userId,
      actorId,
      body?.reason,
    );
    await insertOperatorAuditLog(this.rwPool, req, {
      action: "account.force_logout",
      resourceType: "account_user",
      resourceId: userId,
      after: { revoked: result.revoked },
    });
    return result;
  }
}

// 重置头像是内容处置（危码 user:avatar.reset + step-up）：删掉的原图不留存、不可
// 撤回，故与读门 platform.tenant.manage、与账号生命周期码 user:account.manage 都分开
// ——能停用账号的人不等于能抹掉用户传的头像，反之亦然（operation 角色有前者没后者）。
function assertCanResetUserAvatar(req: Request & RequestContext): void {
  if (!req.user) {
    throw new UnauthorizedException("No active session");
  }
  if (!req.capabilities?.includes("user:avatar.reset")) {
    throw new ForbiddenException("Missing user:avatar.reset capability");
  }
}

interface AvatarRow {
  data: Buffer;
  content_type: string;
  hash: string;
}

// C12 write guard: customer account lifecycle (disable/enable/force-logout).
// user:account.manage (super_admin/admin per data_admin_200 §4.3). Distinct from the
// read guard (still platform.tenant.manage, a deferred C5 domain re-gate).
function assertCanManageAccountLifecycle(req: Request & RequestContext): void {
  if (!req.user) {
    throw new UnauthorizedException("No active session");
  }
  if (!req.capabilities?.includes("user:account.manage")) {
    throw new ForbiddenException("Missing user:account.manage capability");
  }
}

// user:pii.read (high-risk, super_admin/admin per data_admin_200 §4.3) gates plaintext
// email/phone on THIS page. 租户详情页的成员表**不**走这道闸门（owner 2026-09-21：
// 运营者本来就是管理员）。两页口径因此不同：owner 只就成员表表过态，这一页的闸门是
// 原设计、尚未复核——要改先问，别以"对齐"为由单方面推平任何一边。
function hasPiiAccess(req: Request & RequestContext): boolean {
  return req.capabilities?.includes("user:pii.read") ?? false;
}

// j***@example.com — keep first local char + full domain; empty stays empty.
function maskEmail(email: string): string {
  if (!email) return "";
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  const first = email[0] ?? "";
  return `${first}***${email.slice(at)}`;
}

// Keep the last 4 digits, mask the rest (137****5678); null stays null.
function maskPhone(phone: string | null): string | null {
  if (!phone) return phone;
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 4) return "****";
  return `${digits.slice(0, digits.length - 8 > 0 ? 3 : 0)}****${digits.slice(-4)}`;
}

// 账号运营归属租户治理域；沿用现有最贴近的 platform.tenant.manage 能力（tickets.router 同款软守卫）。
function assertCanManageAccounts(req: Request & RequestContext): void {
  if (!req.user) {
    throw new UnauthorizedException("No active session");
  }

  if (
    !req.capabilities ||
    !req.capabilities.includes("platform.tenant.manage")
  ) {
    throw new ForbiddenException("Missing platform.tenant.manage capability");
  }
}

function toIso(value: Date | string | null): string {
  if (!value) return new Date(0).toISOString();
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

// tenancy.tenants.type: personal / organization → 前端口径 individual / company。
function toTenantType(type: string | null): TenantOperationType {
  return type === "personal" ? "individual" : "company";
}

// account.users.status(active/disabled/pending) + account_login_disabled → 前端账号态。
// 无 pending 时 login_disabled 表锁定；无 locked 源列外的锁定信号。
function mapAccountStatus(
  status: string,
  loginDisabled: boolean,
): AccountOperationStatus {
  if (status === "disabled") return "disabled";
  if (status === "pending") return "invited";
  if (loginDisabled) return "locked";
  return "active";
}

function mapTenantBindings(
  raw: RawTenantBinding[] | null,
): AccountTenantBinding[] {
  if (!raw) return [];
  return raw.map((b) => ({
    tenantId: b.tenantId,
    tenantCode: b.tenantCode,
    tenantName: b.tenantName,
    tenantType: toTenantType(b.tenantType),
    role: b.role,
    isPrimaryOwner: b.isPrimaryOwner,
  }));
}

/* kyc.user_kycs.status 的 CHECK 是四值闭集。库里出了别的值说明有人绕过 CHECK 写入，
   按未认证算是**最保守**的那一档——不能把不认识的值当成已认证。 */
function toVerifiedStatus(raw: string | null): AccountVerifiedStatus {
  return raw === "pending" || raw === "verified" || raw === "rejected"
    ? raw
    : "unverified";
}

/* priority 的 CHECK 是四值闭集；越界按最低档算，不让未知值冒充 p0 排到最前。 */
function toTicketPriority(raw: string): AccountTicket["priority"] {
  return raw === "p0" || raw === "p1" || raw === "p2" ? raw : "p3";
}

/* status 给**库里存的那七值**，不投影成队列视图的粗四值。
   粗四值是队列上的分组：终态票根本不进队列，所以它里面的 `blocked` 在库里没有
   来源，而 `cancelled` 无处安放——归进「完成」会把"客户撤单"说成"问题已解决"。
   账号页列的是**记录**（含终态），所以说七值那套。越界回落 `open`：未知状态
   当成"还没完"最保守，不会让一张没处理的票看起来已经结了。 */
function toTicketStatus(raw: string): TicketStatus {
  return (TICKET_STATUSES as readonly string[]).includes(raw)
    ? (raw as TicketStatus)
    : "open";
}

function mapAccountTicketRow(row: AccountTicketRow): AccountTicket {
  return {
    ticketNo: row.ticket_no,
    title: row.title,
    status: toTicketStatus(row.status),
    priority: toTicketPriority(row.priority),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapAccountLoginRow(row: AccountLoginRow): AccountLoginAttempt {
  return {
    id: row.id,
    result: row.result,
    authMethod: row.auth_method,
    ip: row.ip_address,
    createdAt: toIso(row.created_at),
  };
}

function mapAccountRow(
  row: AccountRow,
  canReadPii: boolean,
): AccountOperationRecord {
  return {
    id: row.id,
    accountCode: row.account_code,
    avatarHash: row.avatar_hash,
    displayName: row.display_name,
    email: canReadPii ? row.email : maskEmail(row.email),
    phone: canReadPii ? row.phone : maskPhone(row.phone),
    status: mapAccountStatus(row.status, row.account_login_disabled),
    primaryTenantId: row.primary_tenant_id ?? "",
    primaryTenantCode: row.primary_tenant_code ?? "",
    primaryTenantName: row.primary_tenant_name ?? "",
    primaryTenantType: toTenantType(row.primary_tenant_type),
    role: row.role ?? "",
    tenantCount: row.tenant_count ?? 0,
    registeredAt: toIso(row.registered_at),
    activatedAt: row.activated_at ? toIso(row.activated_at) : null,
    lastActiveAt: row.last_active_at
      ? toIso(row.last_active_at)
      : toIso(row.registered_at),
    lastActiveIp: row.last_active_ip,
    lastActiveLocation: "未知",
    /* 在线 = 有未过期的活跃会话。给布尔不给计数：界面问的是「此刻在不在」，
       几个会话是另一个问题，现在没人问。 */
    online: (row.online_session_count ?? 0) > 0,
    verifiedStatus: toVerifiedStatus(row.verified_status),
    loginCount30d: row.login_count_30d ?? 0,
    tenantBindings: mapTenantBindings(row.tenant_bindings),
  };
}

interface RawTenantBinding {
  tenantId: string;
  tenantCode: string;
  tenantName: string;
  tenantType: string;
  role: string;
  isPrimaryOwner: boolean;
}

interface AccountRow {
  id: string;
  account_code: string;
  display_name: string;
  email: string;
  phone: string | null;
  status: string;
  account_login_disabled: boolean;
  registered_at: Date | string | null;
  activated_at: Date | string | null;
  primary_tenant_id: string | null;
  primary_tenant_code: string | null;
  primary_tenant_name: string | null;
  primary_tenant_type: string | null;
  role: string | null;
  tenant_count: number | null;
  last_active_at: Date | string | null;
  last_active_ip: string | null;
  login_count_30d: number | null;
  tenant_bindings: RawTenantBinding[] | null;
  /** realm=customer 未过期的活跃会话数；> 0 即在线。 */
  online_session_count: number | null;
  verified_status: string | null;
  avatar_hash: string | null;
}

interface AccountProductRow {
  product_name: string;
}

interface AccountTicketRow {
  ticket_no: string;
  title: string;
  status: string;
  priority: string;
  created_at: Date | string | null;
  updated_at: Date | string | null;
}

interface AccountTicketCountsRow {
  open_count: number | null;
  total_count: number | null;
}

interface AccountLoginRow {
  id: string;
  result: string;
  auth_method: string;
  ip_address: string;
  created_at: Date | string | null;
}

// 列均逐列核对 deploy/database/ddl 10_account.sql / 20_tenancy.sql / 18_access.sql / 24_session.sql。
// account_code = user_no::text（照 tenant_no→tenantCode 约定）；主租户取 owner_user_id 命中且优先 personal。
// 会话/登录态走 realm='customer' 的 session 表；无地理列 → lastActiveLocation 由 mapper 兜底。
const ACCOUNT_SELECT = `
select
  u.id,
  u.user_no::text                              as account_code,
  coalesce(p.display_name, u.account)          as display_name,
  coalesce(u.email, '')                        as email,
  u.phone,
  u.status,
  u.account_login_disabled,
  u.created_at                                 as registered_at,
  u.phone_verified_at                          as activated_at,
  pt.tenant_id                                 as primary_tenant_id,
  pt.tenant_no                                 as primary_tenant_code,
  pt.tenant_name                               as primary_tenant_name,
  pt.tenant_type                               as primary_tenant_type,
  pt.role_name                                 as role,
  coalesce(tc.tenant_count, 0)                 as tenant_count,
  ls.last_active_at,
  ls.last_active_ip,
  coalesce(lc.login_count_30d, 0)              as login_count_30d,
  coalesce(tb.bindings, '[]'::json)            as tenant_bindings,
  coalesce(os.online_count, 0)                 as online_session_count,
  coalesce(kv.status, 'unverified')            as verified_status,
  ua.hash                                      as avatar_hash
from account.users u
left join account.user_profiles p
  on p.user_id = u.id
left join lateral (
  select
    t.id                                       as tenant_id,
    t.tenant_no::text                          as tenant_no,
    t.name                                     as tenant_name,
    t.type                                     as tenant_type,
    coalesce(r.role_name, r.role_code, 'member')         as role_name
  from tenancy.tenants t
  left join tenancy.tenant_memberships m
    on m.tenant_id = t.id and m.user_id = u.id
  left join access.roles r
    on r.id = m.role_id
  where t.owner_user_id = u.id and t.deleted_at is null
  order by case when t.type = 'personal' then 0 else 1 end, t.created_at asc
  limit 1
) pt on true
left join lateral (
  select count(*)::int as tenant_count
  from tenancy.tenant_memberships m
  where m.user_id = u.id and m.status = 'active'
) tc on true
left join lateral (
  select s.last_active_at, s.ip_address as last_active_ip
  from session.auth_sessions s
  where s.user_id = u.id and s.realm = 'customer'
  order by s.last_active_at desc
  limit 1
) ls on true
left join lateral (
  select count(*)::int as login_count_30d
  from session.login_attempts la
  where la.user_id = u.id
    and la.result = 'success'
    and la.created_at >= now() - interval '30 days'
) lc on true
left join lateral (
  select json_agg(
    json_build_object(
      'tenantId',       t.id,
      'tenantCode',     t.tenant_no::text,
      'tenantName',     t.name,
      'tenantType',     t.type,
      'role',           coalesce(r.role_name, r.role_code, 'member'),
      'isPrimaryOwner', (t.owner_user_id = u.id)
    ) order by t.created_at asc
  ) as bindings
  from tenancy.tenant_memberships m
  join tenancy.tenants t
    on t.id = m.tenant_id and t.deleted_at is null
  left join access.roles r
    on r.id = m.role_id
  where m.user_id = u.id and m.status = 'active'
) tb on true
-- 在线 = realm='customer' 还没过期的活跃会话。**不能只看 status**：revoked 之外
-- 还有一类「status 仍写着 active 但 expires_at 已过」的行（清扫是异步的），只判
-- status 会把早就离线的人画成在线，而「强制下线」正是拿这个读数当门。
left join lateral (
  select count(*)::int as online_count
  from session.auth_sessions s
  where s.user_id = u.id and s.realm = 'customer'
    and s.status = 'active' and s.expires_at > now()
) os on true
-- 实名认证。没有行 = 从没提交过，按 'unverified' 算（与 kyc.user_kycs 的列默认值
-- 一致）——不是「读不到」，是确实没认证。
left join kyc.user_kycs kv on kv.user_id = u.id
-- 头像字节存 account.user_avatars(PK user_id)；这里只取 hash，字节走独立端点按内容
-- 哈希版本化。有行 = 用户传过，无行 = 用平台默认——重置就是删这一行。
left join account.user_avatars ua on ua.user_id = u.id
`;

const ACCOUNT_LIST_SQL = `
${ACCOUNT_SELECT}
where u.deleted_at is null
order by u.created_at desc
limit 500
`;

const ACCOUNT_DETAIL_SQL = `
${ACCOUNT_SELECT}
where u.deleted_at is null and u.id = $1
limit 1
`;

// 未结工单：support.tickets CHECK 七值里 resolved / closed / cancelled 是终态，
// 其余四个都还有人要跟。与租户详情的 TENANT_OPEN_TICKET_STATUSES 同一口径。
const ACCOUNT_OPEN_TICKET_STATUSES = `('open','pending','in_progress','reopened')`;

// 在册订阅：与租户详情的 IN_FORCE_SUBSCRIPTION_STATUSES 同一口径。
const IN_FORCE_SUBSCRIPTION_STATUSES = `('active','expiring','trialing','overdue')`;

/**
 * 这个人能用到的产品（去重）。
 *
 * 口径：他**在册成员身份**的每个租户 → 该租户在册的订阅 → 套餐版本的 primary
 * 组件所指的产品。bundled 是随主产品搭售的配件，不单算一个产品（与租户详情的
 * product_count 同一条判据）。
 *
 * 去重发生在人这一层：同一个产品在他的三个租户里各订一份，对「这个人能用什么」
 * 来说仍是一个。数量取本结果的行数，不另算——一份事实只留一份推导。
 */
const ACCOUNT_DETAIL_PRODUCTS_SQL = `
select distinct p.product_name
from tenancy.tenant_memberships m
join tenancy.tenants t
  on t.id = m.tenant_id and t.deleted_at is null
join metering.subscriptions s
  on s.tenant_id = t.id and s.deleted_at is null
 and s.status in ${IN_FORCE_SUBSCRIPTION_STATUSES}
join product.plan_components pcm
  on pcm.plan_version_id = s.plan_version_id and pcm.component_role = 'primary'
join product.products p on p.id = pcm.product_id
where m.user_id = $1 and m.status = 'active'
order by p.product_name asc
`;

// 工单记录：这个人报的全部工单（不只未结——本段是「记录」不是「待办」）。
const ACCOUNT_DETAIL_TICKETS_SQL = `
select
  k.ticket_no,
  k.title,
  k.status,
  k.priority,
  k.created_at,
  k.updated_at
from support.tickets k
where k.account_id = $1 and k.deleted_at is null
order by k.updated_at desc
limit 50
`;

// 未接 / 总计。两个数一次查出来：分开查会在两次查询之间漂移，而这两个数是一起读的
// ——未接不可能多于总计，一旦漂移就会出现「未接 3 / 总计 2」这种自相矛盾的一对。
const ACCOUNT_DETAIL_TICKET_COUNTS_SQL = `
select
  count(*) filter (where k.status in ${ACCOUNT_OPEN_TICKET_STATUSES})::int as open_count,
  count(*)::int as total_count
from support.tickets k
where k.account_id = $1 and k.deleted_at is null
`;

/**
 * 登录历史。**含失败尝试**——运营查一个账号的登录史，正是为了看有没有连续失败、
 * 换了几个 IP；只给成功的那几条等于把要查的东西滤掉了。
 *
 * 给 50 条，界面默认只展开近 10 条（owner 2026-09-21）：分页归界面，服务端给一页。
 */
const ACCOUNT_DETAIL_LOGINS_SQL = `
select
  la.id,
  la.result,
  la.auth_method,
  la.ip_address,
  la.created_at
from session.login_attempts la
where la.user_id = $1
order by la.created_at desc
limit 50
`;
