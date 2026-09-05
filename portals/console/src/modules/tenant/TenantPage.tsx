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
  type ContactOption,
} from "./TenantFormCards";
import { TenantDangerCard } from "./TenantDangerCard";
import { ConvertTenantDialog } from "./ConvertTenantDialog";

const LOGO_ACCEPT = "image/png,image/jpeg,image/webp";

/** 默认区域的托底值(owner 2026-09-05:按中国设定,三项可改)。 */
const REGION_DEFAULTS = {
  timezone: "Asia/Shanghai",
  language: "zh-CN",
  currency: "CNY",
} as const;

const EMPTY_DRAFT: TenantDraft = {
  name: "",
  displayName: "",
  contactUserId: "",
  industry: "",
  scale: "",
  website: "",
  contactName: "",
  contactSalutation: "",
  contactRole: "",
  contactEmail: "",
  contactPhone: "",
  address: "",
  postalCode: "",
  isBillingRecipient: false,
  timezone: REGION_DEFAULTS.timezone,
  language: REGION_DEFAULTS.language,
  currency: REGION_DEFAULTS.currency,
};

function toDraft(p: ConsoleOrganizationProfile | null): TenantDraft {
  if (!p) return EMPTY_DRAFT;
  return {
    name: p.tenantName ?? "",
    displayName: p.displayName ?? "",
    contactUserId: p.contactUserId ?? "",
    industry: p.industry ?? "",
    scale: p.scale ?? "",
    website: p.website ?? "",
    contactName: p.contactName ?? "",
    contactSalutation: p.contactSalutation ?? "",
    contactRole: p.contactRole ?? "",
    contactEmail: p.contactEmail ?? "",
    contactPhone: p.contactPhone ?? "",
    address: p.address ?? "",
    postalCode: p.postalCode ?? "",
    isBillingRecipient: p.isBillingRecipient ?? false,
    // 走查(owner 2026-09-05):默认区域三项托底按中国设定,可改。库里为空时不画
    // 「未设置」,直接显示托底值;基线与草稿同源,所以不会凭空算成「有改动」。
    timezone: p.timezone || REGION_DEFAULTS.timezone,
    language: p.language || REGION_DEFAULTS.language,
    currency: p.currency || REGION_DEFAULTS.currency,
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
  const [convertOpen, setConvertOpen] = useState(false);
  // 保存 / 放弃后重置基本信息卡的行级「修改」状态(用 key 重挂)
  const [cardsVersion, setCardsVersion] = useState(0);
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
    setCardsVersion((v) => v + 1);
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
      // 关联成员:空串是「不关联」,传 null 让后端解除关联
      if ("contactUserId" in patch) {
        patch.contactUserId = draft.contactUserId || null;
      }
      if ("contactSalutation" in patch) {
        patch.contactSalutation = draft.contactSalutation || null;
      }
      const next = await updateOrganization(patch);
      setProfile(next);
      setDraft(toDraft(next));
      setCardsVersion((v) => v + 1);
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
  // 联系人可关联的成员:组织租户 = 活跃成员;个人租户只有自己(成员接口不对个人租户开)。
  const contactOptions = useMemo<ContactOption[]>(
    () =>
      isOrg
        ? members
            .filter((m) => m.statusCode === "active")
            .map((m) => ({
              id: m.id,
              name: m.name,
              email: m.email ?? null,
              phone: m.phone ?? null,
            }))
        : session.user
          ? [
              {
                id: session.user.id,
                name: session.user.name,
                email: session.user.email ?? null,
                phone: session.user.phone ?? null,
              },
            ]
          : [],
    [isOrg, members, session.user],
  );
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
        name={
          loading ? t("common.loading") : profile?.displayName || tenantName
        }
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
        key={cardsVersion}
        draft={draft}
        saved={saved}
        onChange={changeDraft}
        readOnly={!canManage}
        verified={Boolean(verifiedLocksName)}
        loading={loading}
        onGoVerify={() => router.push("/tenant/verification")}
      />
      <TenantContactCard
        draft={draft}
        options={contactOptions}
        onChange={changeDraft}
        readOnly={!canManage || loading}
        isPersonal={!isOrg}
        loading={loading}
      />
      <TenantRegionCard
        draft={draft}
        onChange={changeDraft}
        readOnly={!canManage || loading}
      />
      <TenantPolicyCard />

      {/* 组织租户:转让所有权 + 注销;个人租户:转为组织租户(批 5c-2) */}
      <TenantDangerCard
        isPersonal={!isOrg}
        isOwner={isOrg ? isOwner : true}
        transferReady={transferCandidates.length > 0}
        onTransfer={() => {
          setTransferTarget("");
          setTransferConfirm("");
          setTransferError(null);
          setTransferOpen(true);
        }}
        onConvert={() => setConvertOpen(true)}
      />

      <ConvertTenantDialog
        open={convertOpen}
        currentName={tenantName}
        onClose={() => setConvertOpen(false)}
        onDone={() => {
          // 转换后当前会话的 active_org 就是这个租户(id 未变),整页重载拿到
          // 新类型 / 名称,页面随之变成组织形态;顶栏面板会多出新的个人租户。
          window.location.reload();
        }}
      />

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
