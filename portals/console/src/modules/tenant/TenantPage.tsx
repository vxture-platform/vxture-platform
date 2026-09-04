"use client";

/**
 * TenantPage — 「租户信息」(批 5c,owner 2026-09-05 九条决策)。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * 今天的三个二级页面合成这一个:租户信息 `/personal-tenant` + 组织信息
 * `/organization` + 系统设置 `/settings`(旧路由全部跳转到这里)。
 *
 * **个人租户 = 只有一个用户的组织租户**:同一页、同一套卡、同一批字段,差异只落在
 * 身份卡的徽章与危险操作的动作上——个人转组织因此是平滑的,页面不换。
 *
 * 骨架与「账号信息」页一致:ViewHeader(无面包屑、无返回)→ 身份卡 → 基本信息 →
 * 联系人 → 默认区域 → 租户策略(规划中,折叠)→ 危险操作 → 页底保存 / 放弃(粘底)。
 * 集合(成员 / 订阅 / 账单 / 审计)不进这页,只在身份卡给数量与入口。
 */

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Banner,
  Button,
  FormPageTemplate,
  Input,
  Label,
  NativeSelect,
  ViewHeader,
} from "@vxture/design-system";
import {
  ConsoleBffError,
  deleteOrgLogo,
  fetchMembers,
  fetchMyWorkspaces,
  fetchOrganizationProfile,
  orgLogoUrl,
  transferTenantOwner,
  updateOrganization,
  uploadOrgLogo,
} from "@/api/console-bff";
import type {
  ConsoleOrganizationProfile,
  MemberRecord,
} from "@/entities/console";
import { LoadFailedBanner } from "@/components/load/LoadFailed";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import { hasCapability } from "@/features/permissions/can";
import { useRouter } from "@/lib/i18n/navigation";
import { formatProfileDay } from "@/modules/account/profile/format";
import {
  TenantIdentityCard,
  type TenantWorkspaceRow,
} from "./TenantIdentityCard";
import {
  TenantBasicCard,
  TenantContactCard,
  TenantPolicyCard,
  TenantRegionCard,
  type TenantDraft,
  type TenantDraftPatch,
} from "./TenantFormCards";
import { TenantDangerCard } from "./TenantDangerCard";

const LOGO_ACCEPT = "image/png,image/jpeg,image/webp";

const EMPTY_DRAFT: TenantDraft = {
  name: "",
  description: "",
  industry: "",
  scale: "",
  website: "",
  contactName: "",
  contactRole: "",
  contactEmail: "",
  contactPhone: "",
  countryCode: "",
  address: "",
  postalCode: "",
  isBillingRecipient: false,
  timezone: "",
  language: "",
  currency: "",
};

function toDraft(p: ConsoleOrganizationProfile | null): TenantDraft {
  if (!p) return EMPTY_DRAFT;
  return {
    name: p.tenantName ?? "",
    description: p.description ?? "",
    industry: p.industry ?? "",
    scale: p.scale ?? "",
    website: p.website ?? "",
    contactName: p.contactName ?? "",
    contactRole: p.contactRole ?? "",
    contactEmail: p.contactEmail ?? "",
    contactPhone: p.contactPhone ?? "",
    countryCode: p.countryCode ?? "",
    address: p.address ?? "",
    postalCode: p.postalCode ?? "",
    isBillingRecipient: p.isBillingRecipient ?? false,
    timezone: p.timezone ?? "",
    language: p.language ?? "",
    currency: p.currency ?? "",
  };
}

export function TenantPage() {
  const t = useTranslations("tenantInfoPage");
  const locale = useLocale();
  const router = useRouter();
  const { session, refreshSession } = useConsoleSession();

  const canManage = hasCapability(
    session.capabilities,
    "tenant.settings.manage",
  );
  const tenantType = session.tenant?.tenantType ?? "personal";
  const isOrg = tenantType === "organization";

  const [profile, setProfile] = useState<ConsoleOrganizationProfile | null>(
    null,
  );
  const [workspaces, setWorkspaces] = useState<TenantWorkspaceRow[]>([]);
  const [members, setMembers] = useState<MemberRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error";
    key: string;
  } | null>(null);

  const [draft, setDraft] = useState<TenantDraft>(EMPTY_DRAFT);
  const [workspacesOpen, setWorkspacesOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── 读(allSettled:任一失败显影,不让一条读挂掉整页)────────────────────────
  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadFailed(false);
    void Promise.allSettled([
      fetchOrganizationProfile(),
      fetchMyWorkspaces(),
      isOrg ? fetchMembers() : Promise.resolve([] as MemberRecord[]),
    ]).then((results) => {
      if (!active) return;
      const [profileR, wsR, membersR] = results;
      if (profileR.status === "fulfilled") {
        setProfile(profileR.value);
        setDraft(toDraft(profileR.value));
      }
      if (wsR.status === "fulfilled") {
        setWorkspaces(
          wsR.value
            .filter((w) => w.tenantId === session.tenant?.id)
            .map((w) => ({
              workspaceId: w.workspaceId,
              name: w.workspaceName,
              workspaceNo: null,
              isDefault: true,
            })),
        );
      }
      if (membersR.status === "fulfilled") setMembers(membersR.value);
      setLoadFailed(results.some((r) => r.status === "rejected"));
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [reloadKey, isOrg, session.tenant?.id]);

  // 当前工作空间的可视码来自会话(workspaces 接口不带号)。
  const workspaceRows = useMemo<TenantWorkspaceRow[]>(() => {
    if (workspaces.length === 0) return [];
    return workspaces.map((w) => ({
      ...w,
      workspaceNo: session.tenant?.workspaceNo ?? null,
      name: w.name ?? session.tenant?.workspaceName ?? null,
    }));
  }, [workspaces, session.tenant?.workspaceNo, session.tenant?.workspaceName]);

  const saved = useMemo(() => toDraft(profile), [profile]);
  const dirtyCount = useMemo(
    () =>
      (Object.keys(saved) as (keyof TenantDraft)[]).filter(
        (k) => draft[k] !== saved[k],
      ).length,
    [draft, saved],
  );

  const verifiedLocksName =
    isOrg &&
    (profile?.verifiedStatus === "verified" ||
      profile?.verifiedStatus === "pending");

  function changeDraft(patch: TenantDraftPatch) {
    setDraft((prev) => ({ ...prev, ...patch }));
  }

  function discard() {
    setDraft(saved);
    setFeedback(null);
  }

  async function save() {
    if (dirtyCount === 0) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      const patch: Record<string, unknown> = {};
      for (const key of Object.keys(saved) as (keyof TenantDraft)[]) {
        if (draft[key] !== saved[key]) patch[key] = draft[key];
      }
      const next = await updateOrganization(patch);
      setProfile(next);
      setDraft(toDraft(next));
      await refreshSession({ silent: true });
      setFeedback({
        tone: "success",
        key:
          "name" in patch && verifiedLocksName
            ? "feedback.savedVerificationReset"
            : "feedback.saved",
      });
    } catch (err) {
      setFeedback({
        tone: "error",
        key:
          err instanceof ConsoleBffError && err.message
            ? err.message
            : "feedback.saveFailed",
      });
    } finally {
      setSubmitting(false);
    }
  }

  // ── Logo ────────────────────────────────────────────────────────────────
  async function handleLogoSelect(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setSubmitting(true);
    try {
      await uploadOrgLogo(file);
      setProfile(await fetchOrganizationProfile());
      setFeedback({ tone: "success", key: "feedback.logoSaved" });
    } catch {
      setFeedback({ tone: "error", key: "feedback.logoFailed" });
    } finally {
      setSubmitting(false);
    }
  }

  async function clearLogo() {
    setSubmitting(true);
    try {
      await deleteOrgLogo();
      setProfile(await fetchOrganizationProfile());
      setFeedback({ tone: "success", key: "feedback.logoCleared" });
    } catch {
      setFeedback({ tone: "error", key: "feedback.logoFailed" });
    } finally {
      setSubmitting(false);
    }
  }

  // ── 转让所有权(自 SettingsPage 迁来)────────────────────────────────────
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferTarget, setTransferTarget] = useState("");
  const [transferConfirm, setTransferConfirm] = useState("");
  const [transferBusy, setTransferBusy] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);

  const isOwner = useMemo(
    () =>
      members.some((m) => m.id === session.user?.id && m.roleCode === "owner"),
    [members, session.user?.id],
  );
  const transferCandidates = useMemo(
    () =>
      members.filter(
        (m) => m.statusCode === "active" && m.id !== session.user?.id,
      ),
    [members, session.user?.id],
  );
  const tenantName = profile?.tenantName ?? session.tenant?.name ?? "";
  const transferReady =
    transferTarget !== "" && transferConfirm.trim() === tenantName;

  async function doTransfer() {
    if (!transferReady) return;
    setTransferBusy(true);
    setTransferError(null);
    try {
      await transferTenantOwner(transferTarget);
      setTransferOpen(false);
      setTransferTarget("");
      setTransferConfirm("");
      await refreshSession({ silent: true });
      setMembers(await fetchMembers());
      setFeedback({ tone: "success", key: "feedback.transferred" });
    } catch (error) {
      setTransferError(
        error instanceof Error && error.message
          ? error.message
          : t("danger.transfer.failed"),
      );
    } finally {
      setTransferBusy(false);
    }
  }

  const logoSrc = profile?.logoHash ? orgLogoUrl(profile.logoHash) : null;

  return (
    <FormPageTemplate
      sticky
      header={
        <div className="flex flex-col gap-md">
          <ViewHeader
            icon="buildings"
            title={t("header.title")}
            description={t("header.description")}
          />
          {loadFailed ? (
            <LoadFailedBanner
              onRetry={() => setReloadKey((k) => k + 1)}
              retrying={loading}
            />
          ) : null}
          {feedback ? (
            <Banner
              tone={feedback.tone === "success" ? "success" : "danger"}
              title={
                feedback.key.startsWith("feedback.")
                  ? t(feedback.key)
                  : feedback.key
              }
            />
          ) : null}
          <Input
            ref={fileInputRef}
            type="file"
            accept={LOGO_ACCEPT}
            hidden
            onChange={(event) => void handleLogoSelect(event)}
          />
        </div>
      }
      footer={
        <div className="flex w-full items-center justify-end gap-sm">
          <span className="mr-auto text-body-sm text-muted-foreground">
            {dirtyCount > 0
              ? t("footer.dirty", { count: dirtyCount })
              : t("footer.clean")}
          </span>
          <Button
            variant="outline"
            size="md"
            onClick={discard}
            disabled={dirtyCount === 0 || submitting}
          >
            {t("footer.discard")}
          </Button>
          <Button
            size="md"
            onClick={() => void save()}
            disabled={dirtyCount === 0 || submitting || !canManage}
          >
            {t("footer.save")}
          </Button>
        </div>
      }
    >
      <TenantIdentityCard
        logoSrc={logoSrc}
        name={loading ? t("common.loading") : tenantName}
        tenantType={tenantType}
        tenantNo={session.tenant?.tenantNo ?? null}
        status={profile?.status ?? null}
        verifiedStatus={profile?.verifiedStatus ?? null}
        createdAt={formatProfileDay(profile?.createdAt, locale, "—")}
        ownerName={
          members.find((m) => m.roleCode === "owner")?.name ??
          (isOrg ? null : (session.user?.name ?? null))
        }
        memberCount={isOrg ? members.length : null}
        canManage={canManage}
        logoBusy={submitting}
        onLogoClick={() => fileInputRef.current?.click()}
        onClearLogo={() => void clearLogo()}
        onGoVerify={() => router.push("/tenant/verification")}
        onOpenMembers={() => router.push("/members")}
        workspaces={workspaceRows}
        workspacesOpen={workspacesOpen}
        onWorkspacesOpenChange={setWorkspacesOpen}
        loading={loading}
      />

      <TenantBasicCard
        draft={draft}
        onChange={changeDraft}
        readOnly={!canManage || loading}
        verified={Boolean(verifiedLocksName)}
      />
      <TenantContactCard
        draft={draft}
        onChange={changeDraft}
        readOnly={!canManage || loading}
      />
      <TenantRegionCard
        draft={draft}
        onChange={changeDraft}
        readOnly={!canManage || loading}
      />
      <TenantPolicyCard />

      {/* 个人租户的「转为组织租户」归 5c 第二段;本段组织租户才有危险操作 */}
      {isOrg ? (
        <TenantDangerCard
          isOwner={isOwner}
          transferReady={transferCandidates.length > 0}
          onTransfer={() => {
            setTransferTarget("");
            setTransferConfirm("");
            setTransferError(null);
            setTransferOpen(true);
          }}
        />
      ) : null}

      <AlertDialog open={transferOpen} onOpenChange={setTransferOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("danger.transfer.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("danger.transfer.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-col gap-md">
            {transferError ? (
              <Banner tone="danger" title={transferError} />
            ) : null}
            <Label>
              {t("danger.transfer.target")}
              <NativeSelect
                value={transferTarget}
                onChange={(event) => setTransferTarget(event.target.value)}
              >
                <option value="">{t("danger.transfer.targetEmpty")}</option>
                {transferCandidates.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} · {m.role}
                  </option>
                ))}
              </NativeSelect>
            </Label>
            <Label>
              {t("danger.transfer.confirmLabel", { name: tenantName })}
              <Input
                value={transferConfirm}
                onChange={(event) => setTransferConfirm(event.target.value)}
              />
            </Label>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={transferBusy}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={!transferReady || transferBusy}
              onClick={(event) => {
                event.preventDefault();
                void doTransfer();
              }}
            >
              {t("danger.transfer.action")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </FormPageTemplate>
  );
}
