import { Injectable } from "@nestjs/common";
import { deriveInvitationStatus, rejectAcceptance } from "./invitation-rules";
import type {
  AcceptInvitationResult,
  CreateInvitationInput,
  CreateWorkspaceInput,
  DeclineInvitationResult,
  IncomingInvitation,
  InvitationListItem,
  InvitationLocator,
  InvitationLookup,
  InvitationView,
  OrgLogoRecord,
  OrgMemberDetail,
  OrgMemberStatus,
  OrgMembershipView,
  OrgProfileUpdateInput,
  OrgRole,
  OrgRoleCatalogEntry,
  OrgView,
  OrganizationProfileView,
  OrganizationReadRepository,
  PermissionCatalogEntry,
  ProvisionedOrg,
  RotatedInvitation,
  SubmitTenantVerificationInput,
  TenantVerificationRecord,
  TransferOwnerResult,
  UpdateWorkspaceInput,
  WorkspaceDetail,
  WorkspaceMembershipView,
  WorkspaceView,
} from "../types/organization.types";

const EMPTY_PROFILE: OrganizationProfileView = {
  description: null,
  industry: null,
  scale: null,
  website: null,
  contactName: null,
  contactRole: null,
  contactEmail: null,
  contactPhone: null,
  contactUserId: null,
  contactGender: null,
  address2: null,
  countryCode: null,
  address: null,
  postalCode: null,
  isBillingRecipient: false,
  timezone: null,
  language: null,
  currency: null,
  logoHash: null,
  updatedAt: null,
};

const MOCK_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function mockMemberDetail(
  userId: string,
  role: string,
  status: string,
): OrgMemberDetail {
  return {
    userId,
    account: "user_" + userId.slice(0, 6),
    email: null,
    phone: "",
    name: null,
    role,
    status,
    joinedAt: new Date(0),
  };
}

/**
 * In-memory organization repository for offline/no-DB mode. Seeded with the
 * sample "zhangsan" personal org + default workspace + owner memberships,
 * matching deploy seed-sample.mjs (same fixed UUIDs).
 */
@Injectable()
export class MockOrganizationRepository implements OrganizationReadRepository {
  // ── 组织实名认证(mock:内存台账,便于 UI 联调)────────────────────────────
  private readonly tenantVerifications = new Map<
    string,
    TenantVerificationRecord[]
  >();

  async getLatestTenantVerification(
    tenantId: string,
  ): Promise<TenantVerificationRecord | null> {
    return this.tenantVerifications.get(tenantId)?.[0] ?? null;
  }

  async listTenantVerifications(
    tenantId: string,
    limit = 20,
  ): Promise<TenantVerificationRecord[]> {
    return (this.tenantVerifications.get(tenantId) ?? []).slice(0, limit);
  }

  // ── 邀请台账(mock:内存,token 明文保存——只在无库模式跑)──────────────
  private readonly invitations = new Map<
    string,
    {
      view: InvitationView;
      token: string;
      createdBy: string;
      createdAt: Date;
      acceptedAt: Date | null;
    }
  >();

  async listInvitations(
    tenantId: string,
    limit = 100,
  ): Promise<InvitationListItem[]> {
    return [...this.invitations.values()]
      .filter((i) => i.view.organizationId === tenantId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
      .map((i) => ({
        id: i.view.id,
        targetType: i.view.targetType,
        target: i.view.target,
        email: i.view.targetType === "email" ? i.view.target : "",
        roleCode: i.view.role,
        status: deriveInvitationStatus(i.view.status, i.view.expiresAt),
        expiresAt: i.view.expiresAt,
        acceptedAt: i.acceptedAt,
        createdAt: i.createdAt,
        inviterName: null,
      }));
  }

  async convertPersonalToOrganization(
    tenantId: string,
    ownerUserId: string,
    name: string,
  ): Promise<import("../types/organization.types").ConvertPersonalResult> {
    const org = this.orgs.get(tenantId);
    if (!org) return { ok: false, reason: "tenant_not_found" };
    if (org.ownerUserId !== ownerUserId)
      return { ok: false, reason: "not_owner" };
    if (org.type !== "personal") return { ok: false, reason: "not_personal" };
    org.type = "organization";
    org.name = name;
    return {
      ok: true,
      tenantNo: org.tenantNo ?? null,
      newPersonalTenantId: crypto.randomUUID(),
      newPersonalTenantNo: null,
    };
  }

  async renameTenant(
    tenantId: string,
    name: string,
  ): Promise<{ verificationSuperseded: boolean } | null> {
    const org = this.orgs.get(tenantId);
    if (!org) return null;
    org.name = name;
    return { verificationSuperseded: false };
  }

  async revokeInvitationsCreatedBy(_userId: string): Promise<number> {
    return 0;
  }

  async softDeletePersonalOrg(_ownerUserId: string): Promise<boolean> {
    return false;
  }

  async revokeInvitation(
    invitationId: string,
    tenantId: string,
  ): Promise<boolean> {
    const inv = this.invitations.get(invitationId);
    if (
      !inv ||
      inv.view.organizationId !== tenantId ||
      inv.view.status !== "pending"
    ) {
      return false;
    }
    inv.view.status = "revoked";
    return true;
  }

  async rotateInvitationToken(
    invitationId: string,
    tenantId: string,
  ): Promise<RotatedInvitation | null> {
    const inv = this.invitations.get(invitationId);
    if (
      !inv ||
      inv.view.organizationId !== tenantId ||
      inv.view.status !== "pending"
    ) {
      return null;
    }
    inv.token = crypto.randomUUID();
    inv.view.expiresAt = new Date(Date.now() + MOCK_INVITE_TTL_MS);
    return {
      token: inv.token,
      expiresAt: inv.view.expiresAt,
      targetType: inv.view.targetType,
      target: inv.view.target,
      email: inv.view.targetType === "email" ? inv.view.target : "",
      roleCode: inv.view.role,
    };
  }

  async getInvitationByToken(token: string): Promise<InvitationLookup | null> {
    const inv = [...this.invitations.values()].find((i) => i.token === token);
    if (!inv) return null;
    return {
      id: inv.view.id,
      tenantId: inv.view.organizationId,
      tenantName: inv.view.organizationId
        ? (this.orgs.get(inv.view.organizationId)?.name ?? null)
        : null,
      email: inv.view.target,
      roleCode: inv.view.role,
      status: deriveInvitationStatus(inv.view.status, inv.view.expiresAt),
      expiresAt: inv.view.expiresAt,
      inviterName: null,
    };
  }

  async submitTenantVerification(
    input: SubmitTenantVerificationInput,
  ): Promise<TenantVerificationRecord> {
    const list = this.tenantVerifications.get(input.tenantId) ?? [];
    if (list[0]?.status === "pending") {
      throw new Error("verification_already_pending");
    }
    const record: TenantVerificationRecord = {
      id: `mock-verification-${list.length + 1}`,
      verificationType: "enterprise",
      verificationMethod: input.method,
      companyName: input.companyName,
      businessLicenseNo: input.businessLicenseNo,
      legalPersonName: input.legalPersonName,
      status: "pending",
      rejectReason: null,
      reviewedAt: null,
      createdAt: new Date(),
    };
    this.tenantVerifications.set(input.tenantId, [record, ...list]);
    return record;
  }

  private readonly orgs = new Map<string, OrgView>();
  /* 存 WorkspaceDetail 而不是 WorkspaceView:前者是后者的超集,现有的读一行不用改,
     而管理页要的号 / 说明 / 状态 / 成员数都在里面。 */
  private readonly workspaces = new Map<string, WorkspaceDetail>();
  /** mock 的号只要唯一且形状对;真库的号由 tenancy.assign_workspace_no 触发器取。 */
  private nextWorkspaceNo = 3_000_000_001;
  private readonly orgMembers: OrgMembershipView[] = [];
  private readonly wsMembers: WorkspaceMembershipView[] = [];
  private readonly profiles = new Map<string, OrganizationProfileView>();
  private readonly logos = new Map<string, OrgLogoRecord>();

  constructor() {
    const userId = "00000000-0000-4000-a000-000000000100";
    const orgId = "00000000-0000-4000-a000-000000000200";
    const wsId = "00000000-0000-4000-a000-000000000210";
    this.orgs.set(orgId, {
      id: orgId,
      name: "Zhang San",
      type: "personal",
      ownerUserId: userId,
      status: "active",
    });
    this.workspaces.set(wsId, {
      id: wsId,
      organizationId: orgId,
      name: "default workspace",
      isDefault: true,
      workspaceNo: String(this.nextWorkspaceNo++),
      description: null,
      icon: null,
      status: "active" as const,
      memberCount: 0,
      createdAt: new Date(),
    });
    this.orgMembers.push({
      organizationId: orgId,
      userId,
      role: "owner",
      status: "active",
    });
    this.wsMembers.push({
      workspaceId: wsId,
      userId,
      role: "owner",
      status: "active",
    });
  }

  async createPersonalOrg(
    userId: string,
    name?: string | null,
  ): Promise<ProvisionedOrg> {
    return this.provision(userId, "personal", name?.trim() || "Personal");
  }
  async createTeamOrg(
    ownerUserId: string,
    name: string,
  ): Promise<ProvisionedOrg> {
    return this.provision(ownerUserId, "organization", name.trim());
  }
  async countOtherActiveMembers(): Promise<number> {
    return 0;
  }

  async closeTenant(
    tenantId: string,
    ownerUserId: string,
  ): Promise<import("../types/organization.types").CloseTenantResult> {
    const org = this.orgs.get(tenantId);
    if (!org) return { ok: false, reason: "tenant_not_found" };
    if (org.ownerUserId !== ownerUserId)
      return { ok: false, reason: "not_owner" };
    if (org.type !== "organization")
      return { ok: false, reason: "personal_tenant" };
    org.status = "deleted";
    return { ok: true };
  }

  async setTenantDisplayName(
    tenantId: string,
    displayName: string,
  ): Promise<boolean> {
    const org = this.orgs.get(tenantId);
    if (!org) return false;
    org.displayName = displayName;
    return true;
  }

  async renamePersonalOrg(userId: string, name: string): Promise<boolean> {
    const org = [...this.orgs.values()].find(
      (o) => o.ownerUserId === userId && o.type === "personal",
    );
    if (!org) return false;
    org.name = name;
    return true;
  }
  private provision(
    ownerUserId: string,
    type: "personal" | "organization",
    name: string,
  ): ProvisionedOrg {
    const orgId = crypto.randomUUID();
    const wsId = crypto.randomUUID();
    const org: OrgView = {
      id: orgId,
      name,
      type,
      ownerUserId,
      status: "active",
    };
    const workspace: WorkspaceDetail = {
      id: wsId,
      organizationId: orgId,
      name: "default workspace",
      isDefault: true,
      workspaceNo: String(this.nextWorkspaceNo++),
      description: null,
      icon: null,
      status: "active" as const,
      memberCount: 0,
      createdAt: new Date(),
    };
    this.orgs.set(orgId, org);
    this.workspaces.set(wsId, workspace);
    this.orgMembers.push({
      organizationId: orgId,
      userId: ownerUserId,
      role: "owner",
      status: "active",
    });
    this.wsMembers.push({
      workspaceId: wsId,
      userId: ownerUserId,
      role: "owner",
      status: "active",
    });
    return { org, workspace };
  }

  async getOrgById(orgId: string): Promise<OrgView | null> {
    return this.orgs.get(orgId) ?? null;
  }
  async searchOrgs(query: string, limit: number): Promise<OrgView[]> {
    const q = query.trim().toLowerCase();
    const cap = Math.min(Math.max(limit, 1), 50);
    return [...this.orgs.values()]
      .filter(
        (o) =>
          o.name.toLowerCase().includes(q) || o.id.toLowerCase().includes(q),
      )
      .slice(0, cap);
  }
  async getDefaultWorkspace(orgId: string): Promise<WorkspaceView | null> {
    for (const w of this.workspaces.values())
      if (w.organizationId === orgId && w.isDefault) return w;
    return null;
  }
  async getDefaultWorkspaceWithMembership(
    orgId: string,
    userId: string,
  ): Promise<{
    workspace: WorkspaceView | null;
    membershipRole: string | null;
  }> {
    const workspace = await this.getDefaultWorkspace(orgId);
    if (!workspace) return { workspace: null, membershipRole: null };
    const membership = await this.getWorkspaceMembership(userId, workspace.id);
    return { workspace, membershipRole: membership?.role ?? null };
  }
  async getOrgProfile(orgId: string): Promise<OrganizationProfileView | null> {
    return this.profiles.get(orgId) ?? null;
  }
  async upsertOrgProfile(
    orgId: string,
    input: OrgProfileUpdateInput,
  ): Promise<OrganizationProfileView> {
    const next: OrganizationProfileView = {
      ...EMPTY_PROFILE,
      description: input.description ?? null,
      industry: input.industry ?? null,
      scale: input.scale ?? null,
      website: input.website ?? null,
      contactName: input.contactName ?? null,
      contactRole: input.contactRole ?? null,
      contactEmail: input.contactEmail ?? null,
      contactPhone: input.contactPhone ?? null,
      contactUserId: input.contactUserId ?? null,
      contactGender: input.contactGender ?? null,
      address2: input.address2 ?? null,
      countryCode: input.countryCode ?? null,
      address: input.address ?? null,
      postalCode: input.postalCode ?? null,
      isBillingRecipient: input.isBillingRecipient ?? false,
      timezone: input.timezone ?? null,
      language: input.language ?? null,
      currency: input.currency ?? null,
      logoHash: this.logos.get(orgId)?.hash ?? null,
      updatedAt: new Date().toISOString(),
    };
    this.profiles.set(orgId, next);
    return next;
  }
  async getOrgLogo(orgId: string): Promise<OrgLogoRecord | null> {
    return this.logos.get(orgId) ?? null;
  }
  async setOrgLogo(orgId: string, logo: OrgLogoRecord): Promise<void> {
    this.logos.set(orgId, logo);
    const p = this.profiles.get(orgId);
    if (p) p.logoHash = logo.hash;
  }
  async deleteOrgLogo(orgId: string): Promise<void> {
    this.logos.delete(orgId);
    const p = this.profiles.get(orgId);
    if (p) p.logoHash = null;
  }
  async listOrgMembershipsForUser(
    userId: string,
  ): Promise<OrgMembershipView[]> {
    return this.orgMembers
      .filter((m) => m.userId === userId && m.status === "active")
      .map((m) => {
        const organization = this.orgs.get(m.organizationId);
        return organization ? { ...m, organization } : { ...m };
      });
  }
  async setDefaultOrgForUser(userId: string, orgId: string): Promise<boolean> {
    const target = this.orgMembers.find(
      (m) =>
        m.userId === userId &&
        m.organizationId === orgId &&
        m.status === "active" &&
        this.orgs.has(orgId),
    );
    if (!target) return false;
    for (const m of this.orgMembers) {
      if (m.userId === userId) m.isDefault = m === target;
    }
    return true;
  }
  async listOrgMembers(orgId: string): Promise<OrgMembershipView[]> {
    return this.orgMembers.filter(
      (m) => m.organizationId === orgId && m.status === "active",
    );
  }
  async addOrgMember(
    orgId: string,
    userId: string,
    role: OrgRole,
  ): Promise<OrgMembershipView> {
    const existing = this.orgMembers.find(
      (m) => m.organizationId === orgId && m.userId === userId,
    );
    if (existing) {
      existing.role = role;
      existing.status = "active";
      return existing;
    }
    const m: OrgMembershipView = {
      organizationId: orgId,
      userId,
      role,
      status: "active",
    };
    this.orgMembers.push(m);
    return m;
  }
  async updateOrgMemberRole(
    orgId: string,
    userId: string,
    role: OrgRole,
  ): Promise<OrgMembershipView | null> {
    const m = this.orgMembers.find(
      (x) => x.organizationId === orgId && x.userId === userId,
    );
    if (!m) return null;
    m.role = role;
    return m;
  }
  async removeOrgMember(orgId: string, userId: string): Promise<boolean> {
    const i = this.orgMembers.findIndex(
      (m) => m.organizationId === orgId && m.userId === userId,
    );
    if (i < 0) return false;
    this.orgMembers.splice(i, 1);
    // 与 pg 同档:两级 membership 一起删。
    const wsIds = new Set(this.workspaceIdsOf(orgId));
    for (let k = this.wsMembers.length - 1; k >= 0; k -= 1) {
      const w = this.wsMembers[k]!;
      if (w.userId === userId && wsIds.has(w.workspaceId)) {
        this.wsMembers.splice(k, 1);
      }
    }
    return true;
  }

  async setOrgMemberStatus(
    orgId: string,
    userId: string,
    status: OrgMemberStatus,
  ): Promise<OrgMembershipView | null> {
    const m = this.orgMembers.find(
      (x) => x.organizationId === orgId && x.userId === userId,
    );
    if (!m) return null;
    m.status = status;
    const wsIds = new Set(this.workspaceIdsOf(orgId));
    for (const w of this.wsMembers) {
      if (w.userId === userId && wsIds.has(w.workspaceId)) w.status = status;
    }
    return m;
  }

  private workspaceIdsOf(orgId: string): string[] {
    return [...this.workspaces.values()]
      .filter((w) => w.organizationId === orgId)
      .map((w) => w.id);
  }

  async transferOrgOwner(
    orgId: string,
    fromUserId: string,
    toUserId: string,
  ): Promise<TransferOwnerResult> {
    if (fromUserId === toUserId) return { ok: false, reason: "same_user" };
    const org = this.orgs.get(orgId);
    if (!org) return { ok: false, reason: "tenant_not_found" };
    if (org.type === "personal")
      return { ok: false, reason: "personal_tenant" };
    if (org.ownerUserId !== fromUserId)
      return { ok: false, reason: "not_owner" };
    const target = this.orgMembers.find(
      (m) =>
        m.organizationId === orgId &&
        m.userId === toUserId &&
        m.status === "active",
    );
    if (!target) return { ok: false, reason: "target_not_member" };

    org.ownerUserId = toUserId;
    target.role = "owner";
    // 与 pg 实现同档:原 owner 降 manager,不是移除、也不是降到 member。
    const previous = this.orgMembers.find(
      (m) => m.organizationId === orgId && m.userId === fromUserId,
    );
    if (previous) previous.role = "manager";
    return {
      ok: true,
      previousOwnerUserId: fromUserId,
      newOwnerUserId: toUserId,
    };
  }
  async addWorkspaceMember(
    workspaceId: string,
    userId: string,
    role: OrgRole,
  ): Promise<WorkspaceMembershipView> {
    const existing = this.wsMembers.find(
      (m) => m.workspaceId === workspaceId && m.userId === userId,
    );
    if (existing) {
      existing.role = role;
      existing.status = "active";
      return existing;
    }
    const m: WorkspaceMembershipView = {
      workspaceId,
      userId,
      role,
      status: "active",
    };
    this.wsMembers.push(m);
    return m;
  }
  async createInvitation(
    input: CreateInvitationInput,
  ): Promise<{ invitation: InvitationView; token: string }> {
    const invitation: InvitationView = {
      id: crypto.randomUUID(),
      scope: input.scope,
      organizationId: input.organizationId,
      workspaceId: input.workspaceId ?? null,
      targetType: input.targetType,
      target: input.target,
      role: input.role,
      status: "pending",
      expiresAt: new Date(
        Date.now() +
          (input.ttlSeconds ? input.ttlSeconds * 1000 : MOCK_INVITE_TTL_MS),
      ),
    };
    const token = crypto.randomUUID();
    this.invitations.set(invitation.id, {
      view: invitation,
      token,
      createdBy: input.createdBy,
      createdAt: new Date(),
      acceptedAt: null,
    });
    return { invitation, token };
  }
  async listInvitationsForIdentity(
    identity: { email: string | null; userNo: string | null },
    limit = 50,
  ): Promise<IncomingInvitation[]> {
    const now = Date.now();
    return [...this.invitations.values()]
      .filter((i) => {
        const v = i.view;
        if (v.status !== "pending" || v.expiresAt.getTime() <= now)
          return false;
        /* 与 pg 那份同口径:邮箱大小写不敏感,用户号精确串;
           身份缺的那一路一律不匹配(不是「放行」)。 */
        if (v.targetType === "email") {
          return (
            !!identity.email &&
            identity.email.trim().toLowerCase() ===
              v.target.trim().toLowerCase()
          );
        }
        if (v.targetType === "user_no") {
          return (
            !!identity.userNo && identity.userNo.trim() === v.target.trim()
          );
        }
        return false;
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
      .map((i) => ({
        id: i.view.id,
        targetType: i.view.targetType,
        roleCode: i.view.role,
        tenantId: i.view.organizationId ?? null,
        tenantName: null,
        inviterName: null,
        expiresAt: i.view.expiresAt,
        createdAt: i.createdAt,
      }));
  }

  async declineInvitation(
    invitationId: string,
    identity: { email: string | null; userNo: string | null },
  ): Promise<DeclineInvitationResult> {
    const inv = [...this.invitations.values()].find(
      (i) => i.view.id === invitationId,
    );
    if (!inv) return { ok: false, reason: "not_found" };
    const rejection = rejectAcceptance(
      {
        status: inv.view.status,
        expiresAt: inv.view.expiresAt,
        targetType: inv.view.targetType,
        target: inv.view.target,
      },
      identity,
    );
    if (rejection) return { ok: false, reason: rejection };
    inv.view.status = "declined";
    return { ok: true };
  }

  /* ── 工作空间管理 ──────────────────────────────────────────────────────
     不变式与 pg 那份同形,但**判据的权威在 SQL 里**:这里重写一遍只是为了让 mock
     可用,不该有任何用例拿这一份来证明不变式成立(那证明的是重写的这份)。
     真正的验收在 workspace-crud.itest.spec.ts,连真库跑。 */

  private sameName(a: string, b: string): boolean {
    return a.trim().toLowerCase() === b.trim().toLowerCase();
  }

  async resolveWorkspaceForSession(
    orgId: string,
    userId: string,
    hint?: string | null,
  ) {
    if (hint) {
      const w = this.workspaces.get(hint);
      const member = w
        ? this.wsMembers.find(
            (m) =>
              m.workspaceId === w.id &&
              m.userId === userId &&
              m.status === "active",
          )
        : undefined;
      if (w && w.organizationId === orgId && w.status === "active" && member) {
        return { workspace: w, membershipRole: member.role };
      }
    }
    return this.getDefaultWorkspaceWithMembership(orgId, userId);
  }

  async listWorkspacesForSwitch(orgId: string, userId: string) {
    return [...this.workspaces.values()].filter(
      (w) =>
        w.organizationId === orgId &&
        w.status === "active" &&
        this.wsMembers.some(
          (m) =>
            m.workspaceId === w.id &&
            m.userId === userId &&
            m.status === "active",
        ),
    );
  }

  async listWorkspaces(tenantId: string): Promise<WorkspaceDetail[]> {
    return [...this.workspaces.values()]
      .filter((w) => w.organizationId === tenantId)
      .map((w) => ({
        ...w,
        memberCount: this.wsMembers.filter(
          (m) => m.workspaceId === w.id && m.status === "active",
        ).length,
      }))
      .sort(
        (a, b) =>
          Number(b.isDefault) - Number(a.isDefault) ||
          a.createdAt.getTime() - b.createdAt.getTime(),
      );
  }

  async createWorkspace(input: CreateWorkspaceInput) {
    const taken = [...this.workspaces.values()].some(
      (w) =>
        w.organizationId === input.tenantId &&
        this.sameName(w.name, input.name),
    );
    if (taken) return { ok: false as const, reason: "name_taken" as const };
    const id = `ws-${this.workspaces.size + 1}`;
    const workspace: WorkspaceDetail = {
      id,
      organizationId: input.tenantId,
      name: input.name.trim(),
      isDefault: false,
      workspaceNo: String(this.nextWorkspaceNo++),
      description: input.description ?? null,
      icon: input.icon ?? null,
      status: "active",
      memberCount: 1,
      createdAt: new Date(),
    };
    this.workspaces.set(id, workspace);
    await this.addWorkspaceMember(
      id,
      input.creatorUserId,
      input.creatorRoleCode as OrgRole,
    );
    return { ok: true as const, workspace };
  }

  async updateWorkspace(
    tenantId: string,
    workspaceId: string,
    input: UpdateWorkspaceInput,
  ) {
    const w = this.workspaces.get(workspaceId);
    if (!w || w.organizationId !== tenantId) {
      return { ok: false as const, reason: "not_found" as const };
    }
    if (
      input.name !== undefined &&
      [...this.workspaces.values()].some(
        (o) =>
          o.organizationId === tenantId &&
          o.id !== workspaceId &&
          this.sameName(o.name, input.name!),
      )
    ) {
      return { ok: false as const, reason: "name_taken" as const };
    }
    if (input.name !== undefined) w.name = input.name.trim();
    if (input.description !== undefined)
      w.description = input.description ?? null;
    if (input.icon !== undefined) w.icon = input.icon ?? null;
    return { ok: true as const };
  }

  async setDefaultWorkspace(tenantId: string, workspaceId: string) {
    const w = this.workspaces.get(workspaceId);
    if (!w || w.organizationId !== tenantId) {
      return { ok: false as const, reason: "not_found" as const };
    }
    if (w.status !== "active") {
      return { ok: false as const, reason: "archived" as const };
    }
    for (const o of this.workspaces.values()) {
      if (o.organizationId === tenantId) o.isDefault = o.id === workspaceId;
    }
    return { ok: true as const };
  }

  async archiveWorkspace(tenantId: string, workspaceId: string) {
    const w = this.workspaces.get(workspaceId);
    if (!w || w.organizationId !== tenantId) {
      return { ok: false as const, reason: "not_found" as const };
    }
    if (w.isDefault)
      return { ok: false as const, reason: "default_locked" as const };
    const actives = [...this.workspaces.values()].filter(
      (o) => o.organizationId === tenantId && o.status === "active",
    ).length;
    if (actives <= 1)
      return { ok: false as const, reason: "last_active" as const };
    w.status = "archived";
    return { ok: true as const };
  }

  async acceptInvitation(
    locator: InvitationLocator,
    userId: string,
    identity: { email: string | null; userNo: string | null },
  ): Promise<AcceptInvitationResult> {
    const inv = [...this.invitations.values()].find((i) =>
      "token" in locator
        ? i.token === locator.token
        : i.view.id === locator.invitationId,
    );
    if (!inv) return { ok: false, reason: "not_found" };
    const rejection = rejectAcceptance(
      {
        status: inv.view.status,
        expiresAt: inv.view.expiresAt,
        targetType: inv.view.targetType,
        target: inv.view.target,
      },
      identity,
    );
    if (rejection) return { ok: false, reason: rejection };
    inv.view.status = "accepted";
    inv.acceptedAt = new Date();
    const role = inv.view.role as OrgRole;
    if (inv.view.scope === "org" && inv.view.organizationId) {
      const orgId = inv.view.organizationId;
      const membership = await this.addOrgMember(orgId, userId, role);
      const ws = [...this.workspaces.values()].find(
        (w) => w.organizationId === orgId && w.isDefault,
      );
      if (ws) await this.addWorkspaceMember(ws.id, userId, role);
      return {
        ok: true,
        membership,
        tenantName: this.orgs.get(orgId)?.name ?? null,
      };
    }
    const workspace = inv.view.workspaceId
      ? this.workspaces.get(inv.view.workspaceId)
      : undefined;
    if (!workspace) return { ok: false, reason: "not_found" };
    await this.addWorkspaceMember(workspace.id, userId, role);
    return {
      ok: true,
      membership: {
        organizationId: workspace.organizationId,
        userId,
        role,
        status: "active",
      },
      tenantName: this.orgs.get(workspace.organizationId)?.name ?? null,
    };
  }

  async getWorkspaceMembership(
    userId: string,
    workspaceId: string,
  ): Promise<WorkspaceMembershipView | null> {
    return (
      this.wsMembers.find(
        (m) =>
          m.workspaceId === workspaceId &&
          m.userId === userId &&
          m.status === "active",
      ) ?? null
    );
  }

  async listOrgMembersWithUser(orgId: string): Promise<OrgMemberDetail[]> {
    return this.orgMembers
      .filter((m) => m.organizationId === orgId && m.status !== "removed")
      .map((m) => mockMemberDetail(m.userId, m.role, m.status));
  }
  async getOrgMemberDetail(
    orgId: string,
    userId: string,
  ): Promise<OrgMemberDetail | null> {
    const m = this.orgMembers.find(
      (x) =>
        x.organizationId === orgId &&
        x.userId === userId &&
        x.status !== "removed",
    );
    return m ? mockMemberDetail(m.userId, m.role, m.status) : null;
  }
  async getOrgRolesCatalog(): Promise<OrgRoleCatalogEntry[]> {
    return [
      {
        code: "owner",
        name: "Organization Owner",
        permissions: [...(MOCK_ROLE_PERMS["org:owner"] ?? [])],
      },
      {
        code: "manager",
        name: "Organization Manager",
        permissions: [...(MOCK_ROLE_PERMS["org:manager"] ?? [])],
      },
      {
        code: "member",
        name: "Organization Member",
        permissions: [...(MOCK_ROLE_PERMS["org:member"] ?? [])],
      },
    ];
  }
  async listPermissionCatalog(): Promise<PermissionCatalogEntry[]> {
    const codes = new Set(Object.values(MOCK_ROLE_PERMS).flat());
    // 显式比较器:无参 sort 按 UTF-16 码元排,Sonar S2871 判为 bug。
    return [...codes]
      .sort((a, b) => a.localeCompare(b))
      .map((code, i) => ({
        code,
        name: code,
        type: "api" as const,
        parentCode: null,
        routePath: null,
        category: null,
        sort: (i + 1) * 10,
      }));
  }

  async getEffectiveOrgPermissions(
    userId: string,
    orgId: string,
  ): Promise<string[]> {
    const m = this.orgMembers.find(
      (x) =>
        x.organizationId === orgId &&
        x.userId === userId &&
        x.status === "active",
    );
    return m ? [...(MOCK_ROLE_PERMS[`org:${m.role}`] ?? [])] : [];
  }
  async getEffectiveWorkspacePermissions(
    userId: string,
    workspaceId: string,
  ): Promise<string[]> {
    const m = this.wsMembers.find(
      (x) =>
        x.workspaceId === workspaceId &&
        x.userId === userId &&
        x.status === "active",
    );
    return m ? [...(MOCK_ROLE_PERMS[`workspace:${m.role}`] ?? [])] : [];
  }
}

// Mirror of the seed §5.5 role→permission mapping (deploy seed-catalog.mjs).
const ORG_ALL = [
  "tenant.member.manage",
  "tenant.role.assign",
  "tenant.workspace.manage",
  "tenant.billing.manage",
  "tenant.settings.manage",
  "tenant.delete",
];
const WS_ALL = [
  "workspace.member.manage",
  "workspace.role.assign",
  "workspace.settings.manage",
];
const MOCK_ROLE_PERMS: Record<string, string[]> = {
  "org:owner": [...ORG_ALL, ...WS_ALL],
  "org:manager": [
    "tenant.member.manage",
    "tenant.role.assign",
    "tenant.workspace.manage",
    "tenant.settings.manage",
  ],
  "org:member": [],
  "workspace:owner": [...WS_ALL],
  "workspace:manager": ["workspace.member.manage", "workspace.settings.manage"],
  "workspace:member": [],
};
