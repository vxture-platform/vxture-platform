"use client";

/**
 * ProfilePage — 「账号信息」(批 5a,owner 2026-09-04 定稿的重排;原 2030 行个人信息页)。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * 结构:身份卡(含所在租户展开)→ 基本信息 → 安全设置 → 三方登录 → 个人偏好 →
 * 页底保存 / 放弃(粘底)。能直接改的(显示名、五项偏好)内联改、随页底一次提交;
 * 需要验证或有副作用的(账号名、手机、邮箱、密码、三方绑定、登录开关)逐行按钮进各自
 * 流程。原 /security 页并入本页(`?panel=sessions` 直接展开会话)。
 * 读全部 allSettled,任一失败显影为「读取失败 + 重试」。页底危险操作:删除账号
 * (批 5b,050-account §7)——资格清单对话框确认后进入 30 天保留期并登出。
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import {
  Banner,
  Button,
  FormPageTemplate,
  Input,
  ViewHeader,
  useTheme,
} from "@vxture/design-system";
import type { Locale, Theme } from "@vxture-platform/shared";
import {
  setGlobalDensityPreference,
  setGlobalLocalePreference,
  setGlobalThemePreference,
} from "@vxture/platform-browser";
import {
  ConsoleBffError,
  buildLogoutUrl,
  changeUserPassword,
  deleteUserAvatar,
  fetchLoginHistory,
  fetchMyWorkspaces,
  fetchSessions,
  fetchUserIdentities,
  fetchUserProfile,
  revokeSession,
  setAccountLogin,
  setInitialUserPassword,
  unbindIdentity,
  updateUsername,
  updateUserProfile,
  uploadUserAvatar,
} from "@/api/console-bff";
import type {
  AuthSessionRecord,
  ConsoleUserProfile,
  ConsoleWorkspaceItem,
  IdentityRecord,
  LoginHistoryEntry,
} from "@/entities/console";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import { useTenant } from "@/features/tenant";
import { usePathname, useRouter } from "@/lib/i18n/navigation";
import { LoadFailedBanner } from "@/components/load/LoadFailed";
import { IdentityHeader, type TenantRow } from "./IdentityHeader";
import { BasicInfoCard } from "./BasicInfoCard";
import { SecurityCard } from "./SecurityCard";
import { DangerZoneCard } from "./DangerZoneCard";
import { DeleteAccountDialog } from "./dialogs/DeleteAccountDialog";

/** 删除保留期天数(与 service-account ACCOUNT_DELETION_RETENTION_DAYS 一致;快照会带真值)。 */
const DELETION_RETENTION_DAYS = 30;
import {
  PROVIDER_ORDER,
  ThirdPartyLoginCard,
  type ThirdPartyAccount,
} from "./ThirdPartyLoginCard";
import {
  PreferencesCard,
  type DensityChoice,
  type FontSizeChoice,
  type PreferencesDraft,
  type ThemeChoice,
} from "./PreferencesCard";
import {
  useContactVerifyFlow,
  usePhoneChangeFlow,
  type Feedback,
} from "./flows";
import { PhoneChangeDialog } from "./dialogs/PhoneChangeDialog";
import { ContactVerifyDialog } from "./dialogs/ContactVerifyDialog";
import {
  DisableLoginDialog,
  PasswordDialog,
  UnbindDialog,
  UsernameDialog,
  type PasswordFormState,
} from "./dialogs/SimpleDialogs";
import {
  displayValue,
  formatPhone,
  formatProfileDate,
  formatProfileDay,
} from "./format";

const AVATAR_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";
const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
/** 与后端口径一致(此前前端 ≥6、后端 ≥8,提示与拒绝对不上)。 */
const PASSWORD_MIN_LENGTH = 8;

function normalizeOptional(value: string) {
  const normalized = value.trim();
  return normalized || null;
}

const THEME_CHOICES: readonly ThemeChoice[] = ["system", "light", "dark"];
const DENSITY_CHOICES: readonly DensityChoice[] = [
  "compact",
  "default",
  "comfortable",
];
const FONT_CHOICES: readonly FontSizeChoice[] = ["small", "default", "large"];
const asChoice = <T extends string>(
  value: unknown,
  choices: readonly T[],
  fallback: T,
): T => (choices.includes(value as T) ? (value as T) : fallback);

export function ProfilePage() {
  const t = useTranslations("profilePage");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { session, refreshSession } = useConsoleSession();
  const { switchTenantContext } = useTenant();
  const { theme, setTheme, density, setDensity, fontSize, setFontSize } =
    useTheme();

  // ── 读 ──────────────────────────────────────────────────────────────────
  const [profile, setProfile] = useState<ConsoleUserProfile | null>(null);
  const [identities, setIdentities] = useState<IdentityRecord[]>([]);
  const [workspaces, setWorkspaces] = useState<ConsoleWorkspaceItem[]>([]);
  const [history, setHistory] = useState<LoginHistoryEntry[]>([]);
  const [historyFailed, setHistoryFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadFailed(false);
    void Promise.allSettled([
      fetchUserProfile(),
      fetchUserIdentities(),
      fetchMyWorkspaces(),
      fetchLoginHistory(),
    ]).then(([p, ids, ws, hist]) => {
      if (!active) return;
      const data = p.status === "fulfilled" ? p.value : null;
      if (data) setProfile(data);
      else setLoadFailed(true);
      setIdentities(ids.status === "fulfilled" ? ids.value : []);
      setWorkspaces(ws.status === "fulfilled" ? ws.value : []);
      setHistory(hist.status === "fulfilled" ? hist.value : []);
      setHistoryFailed(hist.status === "rejected");
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [session.user?.id, reloadKey]);

  // ── 会话(懒读:展开时才取)────────────────────────────────────────────────
  const [sessions, setSessions] = useState<AuthSessionRecord[]>([]);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsFailed, setSessionsFailed] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(
    () => searchParams.get("panel") === "sessions",
  );
  const [historyOpen, setHistoryOpen] = useState(false);
  const [tenantsOpen, setTenantsOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  // 展开时才取一次。守卫用 ref 而不是 effect 的 cleanup 标记:setSessionsLoading(true)
  // 本身会让 effect 依赖变化、cleanup 把标记翻成 false,请求回来时 finally 不再落地,
  // 「加载中」就永远停在那里(owner 2026-09-04 走查抓到的)。
  const sessionsRequested = useRef(false);
  useEffect(() => {
    if (!sessionsOpen || sessionsRequested.current) return;
    sessionsRequested.current = true;
    setSessionsLoading(true);
    setSessionsFailed(false);
    fetchSessions()
      .then((rows) => {
        setSessions(rows);
        setSessionsLoaded(true);
      })
      .catch(() => {
        setSessionsFailed(true);
        sessionsRequested.current = false;
      })
      .finally(() => {
        setSessionsLoading(false);
      });
  }, [sessionsOpen]);

  async function handleRevoke(sid: string) {
    setRevoking(sid);
    try {
      await revokeSession(sid);
      setSessions(await fetchSessions());
      setFeedback({ tone: "success", key: "feedback.sessionRevoked" });
    } catch {
      setFeedback({ tone: "error", key: "feedback.sessionRevokeError" });
    } finally {
      setRevoking(null);
    }
  }

  // ── 内联草稿:显示名 + 五项偏好;主题 / 密度 / 字号即时预览,放弃回滚 ──────
  const [nameEditing, setNameEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const initialAppearance = useRef<{
    theme: ThemeChoice;
    density: DensityChoice;
    fontSize: FontSizeChoice;
  } | null>(null);
  if (initialAppearance.current === null) {
    initialAppearance.current = {
      theme: asChoice(theme, THEME_CHOICES, "system"),
      density: asChoice(density, DENSITY_CHOICES, "default"),
      fontSize: asChoice(fontSize, FONT_CHOICES, "default"),
    };
  }
  const savedPrefs = useMemo<PreferencesDraft>(
    () => ({
      language: profile?.language ?? locale,
      timezone: profile?.timezone ?? "",
      ...initialAppearance.current!,
    }),
    [profile?.language, profile?.timezone, locale],
  );
  const [prefs, setPrefs] = useState<PreferencesDraft>(savedPrefs);
  useEffect(() => {
    setPrefs(savedPrefs);
  }, [savedPrefs]);

  function changePrefs(patch: Partial<PreferencesDraft>) {
    setPrefs((old) => ({ ...old, ...patch }));
    // 外观三项即时预览(不持久化;保存才写 platform-browser)。
    if (patch.theme) setTheme(patch.theme as Parameters<typeof setTheme>[0]);
    if (patch.density)
      setDensity(patch.density as Parameters<typeof setDensity>[0]);
    if (patch.fontSize)
      setFontSize(patch.fontSize as Parameters<typeof setFontSize>[0]);
  }

  const nameDirty =
    nameEditing && nameDraft.trim() !== (profile?.displayName ?? "").trim();
  const prefsDirty =
    prefs.language !== savedPrefs.language ||
    prefs.timezone !== savedPrefs.timezone ||
    prefs.theme !== savedPrefs.theme ||
    prefs.density !== savedPrefs.density ||
    prefs.fontSize !== savedPrefs.fontSize;
  const dirtyCount = (nameDirty ? 1 : 0) + (prefsDirty ? 1 : 0);

  function discard() {
    setNameEditing(false);
    setNameDraft(profile?.displayName ?? "");
    setPrefs(savedPrefs);
    setTheme(savedPrefs.theme as Parameters<typeof setTheme>[0]);
    setDensity(savedPrefs.density as Parameters<typeof setDensity>[0]);
    setFontSize(savedPrefs.fontSize as Parameters<typeof setFontSize>[0]);
    setFeedback(null);
  }

  async function save() {
    if (!profile || dirtyCount === 0) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      const patch: Parameters<typeof updateUserProfile>[0] = {};
      if (nameDirty) patch.displayName = normalizeOptional(nameDraft);
      if (prefs.language !== savedPrefs.language)
        patch.language = prefs.language;
      if (prefs.timezone !== savedPrefs.timezone)
        patch.timezone = normalizeOptional(prefs.timezone);
      let updated = profile;
      if (Object.keys(patch).length > 0) {
        updated = await updateUserProfile(patch);
        setProfile(updated);
      }
      // 外观三项:预览已经生效,这里只做跨门户持久化。
      if (prefs.theme !== savedPrefs.theme)
        setGlobalThemePreference(prefs.theme as Theme);
      if (prefs.density !== savedPrefs.density)
        setGlobalDensityPreference(prefs.density);
      initialAppearance.current = {
        theme: prefs.theme,
        density: prefs.density,
        fontSize: prefs.fontSize,
      };
      setNameEditing(false);
      setFeedback({ tone: "success", key: "feedback.profileSaved" });
      await refreshSession();
      if (prefs.language !== savedPrefs.language) {
        setGlobalLocalePreference(prefs.language as Locale);
        router.replace(pathname, { locale: prefs.language as Locale });
      }
    } catch {
      setFeedback({ tone: "error", key: "feedback.profileSaveError" });
    } finally {
      setSubmitting(false);
    }
  }

  // ── 头像 ────────────────────────────────────────────────────────────────
  const fileInputRef = useRef<HTMLInputElement>(null);
  async function handleAvatarSelect(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !profile) return;
    if (!AVATAR_ACCEPT.split(",").includes(file.type)) {
      setFeedback({ tone: "error", key: "feedback.avatarInvalidType" });
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      setFeedback({ tone: "error", key: "feedback.avatarTooLarge" });
      return;
    }
    setSubmitting(true);
    setFeedback(null);
    try {
      const { picture } = await uploadUserAvatar(file);
      setProfile({ ...profile, picture });
      setFeedback({ tone: "success", key: "feedback.avatarUploaded" });
      await refreshSession();
    } catch {
      setFeedback({ tone: "error", key: "feedback.avatarUploadError" });
    } finally {
      setSubmitting(false);
    }
  }

  async function removeAvatar() {
    if (!profile?.picture) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      await deleteUserAvatar();
      setProfile({ ...profile, picture: null });
      setFeedback({ tone: "success", key: "feedback.avatarCleared" });
      await refreshSession();
    } catch {
      setFeedback({ tone: "error", key: "feedback.avatarClearError" });
    } finally {
      setSubmitting(false);
    }
  }

  // ── 逐行流程:账号名 / 密码 / 登录开关 / 三方解绑 / 手机 / 邮箱 ────────────
  const [usernameOpen, setUsernameOpen] = useState(false);
  const [usernameForm, setUsernameForm] = useState("");
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwordForm, setPasswordForm] = useState<PasswordFormState>({
    currentPassword: "",
    nextPassword: "",
    confirmPassword: "",
  });
  const [disableLoginOpen, setDisableLoginOpen] = useState(false);
  const [unbindTarget, setUnbindTarget] = useState<ThirdPartyAccount | null>(
    null,
  );
  const flowDeps = { profile, setProfile, setFeedback, refreshSession };
  const phoneFlow = usePhoneChangeFlow(flowDeps);
  const contactFlow = useContactVerifyFlow(flowDeps);

  async function submitUsername(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      const updated = await updateUsername(usernameForm.trim());
      setProfile(updated);
      setUsernameOpen(false);
      setFeedback({ tone: "success", key: "feedback.usernameSaved" });
      await refreshSession();
    } catch (error) {
      const status =
        error instanceof ConsoleBffError ? error.status : undefined;
      setFeedback({
        tone: "error",
        key:
          status === 409
            ? "feedback.usernameTaken"
            : status === 400
              ? "feedback.usernameCooldown"
              : "feedback.usernameSaveError",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);
    if (passwordForm.nextPassword !== passwordForm.confirmPassword) {
      setFeedback({ tone: "error", key: "feedback.passwordMismatch" });
      return;
    }
    if (passwordForm.nextPassword.length < PASSWORD_MIN_LENGTH) {
      setFeedback({
        tone: "error",
        key: "feedback.passwordTooShort",
        values: { min: PASSWORD_MIN_LENGTH },
      });
      return;
    }
    setSubmitting(true);
    try {
      if (profile?.hasPassword) {
        await changeUserPassword({
          currentPassword: passwordForm.currentPassword,
          nextPassword: passwordForm.nextPassword,
        });
      } else {
        await setInitialUserPassword({
          nextPassword: passwordForm.nextPassword,
        });
        setProfile((old) => (old ? { ...old, hasPassword: true } : old));
      }
      setPasswordOpen(false);
      setFeedback({ tone: "success", key: "feedback.passwordSaved" });
    } catch {
      setFeedback({ tone: "error", key: "feedback.passwordSaveError" });
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleAccountLogin(enable: boolean) {
    if (!enable) {
      setDisableLoginOpen(true);
      return;
    }
    setSubmitting(true);
    setFeedback(null);
    try {
      setProfile(await setAccountLogin(true));
      setFeedback({ tone: "success", key: "feedback.accountLoginEnabled" });
    } catch {
      setFeedback({ tone: "error", key: "feedback.accountLoginError" });
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmDisableAccountLogin() {
    setSubmitting(true);
    setFeedback(null);
    try {
      setProfile(await setAccountLogin(false));
      setDisableLoginOpen(false);
      setFeedback({ tone: "success", key: "feedback.accountLoginDisabled" });
    } catch (error) {
      const status =
        error instanceof ConsoleBffError ? error.status : undefined;
      setFeedback({
        tone: "error",
        key:
          status === 400
            ? "feedback.accountLoginLastMethod"
            : "feedback.accountLoginError",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmUnbind() {
    if (!unbindTarget) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      await unbindIdentity(unbindTarget.provider);
      setIdentities(await fetchUserIdentities());
      setUnbindTarget(null);
      setFeedback({ tone: "success", key: "feedback.unbindSuccess" });
    } catch {
      setFeedback({ tone: "error", key: "feedback.unbindError" });
    } finally {
      setSubmitting(false);
    }
  }

  // ── 派生值 ──────────────────────────────────────────────────────────────
  const empty = t("common.empty");
  const displayName = displayValue(
    profile?.displayName,
    profile?.username || session.user?.name || empty,
  );
  const username = displayValue(
    profile?.username,
    session.user?.username ?? empty,
  );
  const phone = formatPhone(profile?.phone, empty);
  const email = displayValue(profile?.email, empty);
  const usernameNextChangeAt = profile?.usernameChangeableAt ?? null;
  const usernameChangeable =
    !usernameNextChangeAt ||
    new Date(usernameNextChangeAt).getTime() <= Date.now();
  const accountLoginEnabled = !(profile?.accountLoginDisabled ?? false);
  const accounts: ThirdPartyAccount[] = PROVIDER_ORDER.map((provider) => {
    const identity = identities.find((i) => i.provider === provider);
    return {
      provider,
      connected: Boolean(identity),
      accountId: identity?.providerSubject ?? null,
      connectedAt: identity?.connectedAt ?? null,
    };
  });
  const tenantNoById = new Map(
    (session.tenantOptions ?? []).map((tenant) => [
      tenant.id,
      tenant.tenantNo ?? null,
    ]),
  );
  const tenants: TenantRow[] = workspaces.map((ws) => ({
    tenantId: ws.tenantId,
    name: ws.tenantName,
    type: ws.tenantType,
    tenantNo: tenantNoById.get(ws.tenantId) ?? null,
    role: ws.role,
    joinedAt: formatProfileDay(ws.joinedAt, locale, empty),
    isCurrent: ws.isCurrent,
    workspaces: ws.workspaceName
      ? [{ name: ws.workspaceName, isDefault: true }]
      : [],
  }));
  const statusLabel = profile?.accountStatus
    ? profile.accountStatus === "active"
      ? t("accountStatus.active")
      : profile.accountStatus === "suspended"
        ? t("accountStatus.suspended")
        : t("accountStatus.unknown")
    : null;

  async function openTenant(tenant: TenantRow) {
    if (!tenant.isCurrent) await switchTenantContext(tenant.tenantId);
    router.push(
      tenant.type === "personal" ? "/personal-tenant" : "/organization",
    );
  }

  return (
    <FormPageTemplate
      sticky
      header={
        <div className="flex flex-col gap-md">
          <ViewHeader
            icon="user"
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
              title={t(feedback.key, feedback.values)}
            />
          ) : null}
          <Input
            ref={fileInputRef}
            type="file"
            accept={AVATAR_ACCEPT}
            hidden
            onChange={(event) => void handleAvatarSelect(event)}
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
            disabled={dirtyCount === 0 || submitting || !profile}
          >
            {t("footer.save")}
          </Button>
        </div>
      }
    >
      <IdentityHeader
        picture={profile?.picture ?? null}
        displayName={loading ? t("common.loading") : displayName}
        statusLabel={statusLabel}
        statusTone={
          profile?.accountStatus === "suspended" ? "danger" : "success"
        }
        userNo={loading ? t("common.loading") : (profile?.userNo ?? empty)}
        createdAt={formatProfileDay(profile?.accountCreatedAt, locale, empty)}
        loading={loading}
        avatarBusy={submitting}
        onAvatarClick={() => fileInputRef.current?.click()}
        onClearAvatar={() => void removeAvatar()}
        canClearAvatar={Boolean(profile?.picture)}
        onGoVerify={() => router.push("/profile/verification")}
        tenants={tenants}
        tenantsOpen={tenantsOpen}
        onTenantsOpenChange={setTenantsOpen}
        onOpenTenant={(tenant) => void openTenant(tenant)}
      />

      <BasicInfoCard
        loading={loading}
        displayName={displayName}
        nameEditing={nameEditing}
        nameDraft={nameDraft}
        onNameDraftChange={setNameDraft}
        onStartEditName={() => {
          setNameDraft(profile?.displayName ?? "");
          setNameEditing(true);
        }}
        onCancelEditName={() => {
          setNameEditing(false);
          setNameDraft(profile?.displayName ?? "");
        }}
        username={username}
        loginEnabled={accountLoginEnabled}
        usernameChangeable={usernameChangeable}
        usernameNextChangeLabel={
          usernameNextChangeAt
            ? formatProfileDate(usernameNextChangeAt, locale, empty)
            : empty
        }
        onEditUsername={() => {
          setUsernameForm(profile?.username ?? "");
          setUsernameOpen(true);
          setFeedback(null);
        }}
        phone={phone}
        phoneVerified={profile?.phoneVerified ?? false}
        hasPhone={Boolean(profile?.phone)}
        onChangePhone={phoneFlow.start}
        onVerifyPhone={() => contactFlow.start("phone-verify")}
        email={email}
        emailVerified={profile?.emailVerified ?? false}
        hasEmail={Boolean(profile?.email)}
        onChangeEmail={() => contactFlow.start("email-change")}
        onVerifyEmail={() => contactFlow.start("email-verify")}
        lastLogin={history[0] ?? null}
        history={{ items: history, loading, failed: historyFailed }}
        historyOpen={historyOpen}
        onHistoryOpenChange={setHistoryOpen}
        locale={locale}
      />

      <SecurityCard
        loading={loading}
        hasPassword={profile?.hasPassword ?? false}
        onChangePassword={() => {
          setPasswordForm({
            currentPassword: "",
            nextPassword: "",
            confirmPassword: "",
          });
          setPasswordOpen(true);
          setFeedback(null);
        }}
        loginEnabled={accountLoginEnabled}
        onToggleLogin={(next) => void toggleAccountLogin(next)}
        toggling={submitting}
        sessions={{
          items: sessions,
          loading: sessionsLoading,
          failed: sessionsFailed,
          loaded: sessionsLoaded,
        }}
        sessionsOpen={sessionsOpen}
        onSessionsOpenChange={setSessionsOpen}
        onRevoke={(sid) => void handleRevoke(sid)}
        revoking={revoking}
        locale={locale}
      />

      <ThirdPartyLoginCard
        accounts={accounts}
        loading={loading || submitting}
        onUnbind={setUnbindTarget}
        onBind={() => {
          /* 绑定在登录时完成:用该平台账号登录一次即绑定(接入后开放) */
        }}
        formatDate={(iso) => formatProfileDay(iso, locale, empty)}
      />

      <PreferencesCard draft={prefs} onChange={changePrefs} loading={loading} />

      <DangerZoneCard
        retentionDays={DELETION_RETENTION_DAYS}
        disabled={loading || submitting}
        onDelete={() => {
          setFeedback(null);
          setDeleteOpen(true);
        }}
      />

      <DeleteAccountDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onDeleted={() => {
          // 账号已进保留期,BFF 对其余路由一律 403:直接登出,下次登录再选撤销与否。
          window.location.assign(buildLogoutUrl());
        }}
      />

      <UsernameDialog
        open={usernameOpen}
        value={usernameForm}
        onChange={setUsernameForm}
        onClose={() => setUsernameOpen(false)}
        onSubmit={(event) => void submitUsername(event)}
        submitting={submitting}
      />
      <PasswordDialog
        open={passwordOpen}
        hasPassword={profile?.hasPassword ?? false}
        form={passwordForm}
        onChange={setPasswordForm}
        onClose={() => setPasswordOpen(false)}
        onSubmit={(event) => void submitPassword(event)}
        submitting={submitting}
        minLength={PASSWORD_MIN_LENGTH}
      />
      <DisableLoginDialog
        open={disableLoginOpen}
        onClose={() => setDisableLoginOpen(false)}
        onConfirm={() => void confirmDisableAccountLogin()}
        submitting={submitting}
      />
      <UnbindDialog
        providerName={
          unbindTarget
            ? t(`connectedAccounts.providers.${unbindTarget.provider}.name`)
            : null
        }
        onClose={() => setUnbindTarget(null)}
        onConfirm={() => void confirmUnbind()}
        submitting={submitting}
      />
      <ContactVerifyDialog
        flow={contactFlow}
        currentPhone={profile?.phone ?? ""}
      />
      <PhoneChangeDialog
        flow={phoneFlow}
        currentPhone={profile?.phone ?? ""}
        currentEmail={profile?.email ?? null}
      />
    </FormPageTemplate>
  );
}
