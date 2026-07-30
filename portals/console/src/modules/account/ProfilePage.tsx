"use client";

import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import {
  Icon,
  Button,
  Input,
  Label,
  NativeSelect,
  Textarea,
  UserAvatar,
  ActionButton,
  PageHeader,
} from "@vxture/design-system";
import {
  ConsoleBffError,
  changeUserPassword,
  confirmEmailChange,
  confirmPhoneChange,
  deleteUserAvatar,
  fetchLoginHistory,
  fetchMyWorkspaces,
  fetchUserIdentities,
  fetchUserProfile,
  sendCurrentEmailOtp,
  sendEmailOtpForPhoneChange,
  sendNewEmailOtp,
  sendNewPhoneOtp,
  sendOldPhoneOtp,
  setAccountLogin,
  setInitialUserPassword,
  unbindIdentity,
  updateUsername,
  updateUserProfile,
  uploadUserAvatar,
  verifyCurrentEmail,
  verifyCurrentPhone,
  verifyPhoneChangeIdentity,
} from "@/api/console-bff";
import type {
  ConsoleUserProfile,
  ConsoleWorkspaceItem,
  IdentityRecord,
  LoginHistoryEntry,
} from "@/entities/console";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import { useTenant } from "@/features/tenant";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

type Feedback = {
  tone: "success" | "error";
  key: string;
  values?: Record<string, number | string>;
} | null;

type ConnectedAccountProvider = "google" | "feishu" | "dingtalk" | "wechat";
type ConnectedAccountRecord = {
  provider: ConnectedAccountProvider;
  connected: boolean;
  accountId: string | null;
  connectedAt: string | null;
};

type PhoneChangeStep = "step1" | "step2" | "success";
type PhoneIdMethod = "phone" | "email";
/** Unified verify-contact dialog modes. */
type ContactVerifyMode = "phone-verify" | "email-verify" | "email-change";

const AVATAR_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";
const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const PROVIDER_ORDER: ConnectedAccountProvider[] = [
  "google",
  "feishu",
  "dingtalk",
  "wechat",
];

/** Official brand marks served from the console `/brand/` public directory. */
const PROVIDER_LOGO_SRC: Record<ConnectedAccountProvider, string> = {
  google: "/brand/google-logo-icon.svg",
  feishu: "/brand/feishu-logo-icon.svg",
  dingtalk: "/brand/dingtalk-logo-icon.svg",
  wechat: "/brand/wechat_logo_icon.svg",
};

function normalizeOptional(value: string) {
  const normalized = value.trim();
  return normalized || null;
}

/** Canonical IANA timezone list, with a curated fallback for older runtimes. */
function listTimeZones(): string[] {
  try {
    const supported = (
      Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
    ).supportedValuesOf;
    if (typeof supported === "function") return supported("timeZone");
  } catch {
    // fall through to the curated list
  }
  return [
    "UTC",
    "Asia/Shanghai",
    "Asia/Hong_Kong",
    "Asia/Tokyo",
    "Asia/Singapore",
    "Asia/Kolkata",
    "Europe/London",
    "Europe/Paris",
    "Europe/Berlin",
    "America/New_York",
    "America/Chicago",
    "America/Los_Angeles",
    "Australia/Sydney",
  ];
}
const TIMEZONE_OPTIONS = listTimeZones();

function displayValue(value: string | null | undefined, fallback: string) {
  return value?.trim() || fallback;
}

/** Common international dialing codes, longest-first for greedy-safe matching. */
const DIALING_CODES = [
  "+852",
  "+853",
  "+886",
  "+86",
  "+1",
  "+44",
  "+81",
  "+82",
  "+65",
  "+91",
  "+61",
  "+49",
  "+33",
];

/** Separate the dialing code from the national number, e.g. "+86 18092907523". */
function formatPhone(value: string | null | undefined, fallback: string) {
  const phone = value?.trim();
  if (!phone) return fallback;
  if (!phone.startsWith("+")) return phone;
  for (const code of DIALING_CODES) {
    if (phone.startsWith(code) && phone.length > code.length) {
      return `${code} ${phone.slice(code.length)}`;
    }
  }
  return phone;
}

/** Prefix an IANA zone with its current UTC offset, e.g. "UTC+08:00 Asia/Shanghai". */
function formatTimezone(value: string | null | undefined, fallback: string) {
  const tz = value?.trim();
  if (!tz) return fallback;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "longOffset",
    }).formatToParts(new Date());
    const offset = parts
      .find((p) => p.type === "timeZoneName")
      ?.value.replace("GMT", "UTC");
    return offset ? `${offset} ${tz}` : tz;
  } catch {
    return tz;
  }
}

function formatProfileDate(
  value: string | null | undefined,
  locale: string,
  fallback: string,
) {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function parseOS(userAgent: string | null): string {
  if (!userAgent) return "";
  if (/Windows/i.test(userAgent)) return "Windows";
  if (/Mac OS X/i.test(userAgent)) return "macOS";
  if (/iPhone|iPad/i.test(userAgent)) return "iOS";
  if (/Android/i.test(userAgent)) return "Android";
  if (/Linux/i.test(userAgent)) return "Linux";
  return "";
}

function maskConnectedAccountId(value: string | null) {
  if (!value) return null;
  if (value.length <= 8) return value;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export function ProfilePage() {
  const t = useTranslations("profilePage");
  const locale = useLocale();
  const { session, refreshSession } = useConsoleSession();
  const { switchTenantContext } = useTenant();
  const router = useRouter();
  const [profile, setProfile] = useState<ConsoleUserProfile | null>(null);
  const [workspaces, setWorkspaces] = useState<ConsoleWorkspaceItem[]>([]);
  const [switchingTenant, setSwitchingTenant] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const [nameDialogOpen, setNameDialogOpen] = useState(false);
  const [nameForm, setNameForm] = useState("");
  const [usernameDialogOpen, setUsernameDialogOpen] = useState(false);
  const [usernameForm, setUsernameForm] = useState("");
  const [personalDialogOpen, setPersonalDialogOpen] = useState(false);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [disableLoginConfirmOpen, setDisableLoginConfirmOpen] = useState(false);
  const [unbindTarget, setUnbindTarget] =
    useState<ConnectedAccountRecord | null>(null);
  const [identities, setIdentities] = useState<IdentityRecord[]>([]);
  const [loginHistory, setLoginHistory] = useState<LoginHistoryEntry[]>([]);

  // Phone change dialog state
  const [phoneChangeOpen, setPhoneChangeOpen] = useState(false);
  const [phoneChangeStep, setPhoneChangeStep] =
    useState<PhoneChangeStep>("step1");
  const [phoneIdMethod, setPhoneIdMethod] = useState<PhoneIdMethod>("phone");
  const [step1Code, setStep1Code] = useState("");
  const [emailVerifyToken, setEmailVerifyToken] = useState("");
  const [maskedEmail, setMaskedEmail] = useState("");
  const [identityToken, setIdentityToken] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newPhoneCode, setNewPhoneCode] = useState("");
  const [step1Sent, setStep1Sent] = useState(false);
  const [step2Sent, setStep2Sent] = useState(false);
  const [phoneSubmitting, setPhoneSubmitting] = useState(false);

  // Unified contact-verify dialog (phone verify / email verify / email change)
  const [contactVerifyOpen, setContactVerifyOpen] = useState(false);
  const [cvMode, setCvMode] = useState<ContactVerifyMode>("email-verify");
  const [cvToken, setCvToken] = useState("");
  const [cvCode, setCvCode] = useState("");
  const [cvNewEmail, setCvNewEmail] = useState("");
  const [cvMasked, setCvMasked] = useState("");
  const [cvSent, setCvSent] = useState(false);
  const [cvSubmitting, setCvSubmitting] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [personalForm, setPersonalForm] = useState({
    bio: "",
    timezone: "",
    language: "",
  });
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    nextPassword: "",
    confirmPassword: "",
  });

  useEffect(() => {
    let active = true;
    setLoading(true);
    void fetchUserProfile()
      .then((data) => {
        if (!active) return;
        if (data) {
          setProfile(data);
          setFeedback(null);
          return;
        }
        if (session.user) {
          setProfile({
            id: session.user.id,
            username: session.user.username ?? session.user.name,
            displayName: session.user.displayName ?? session.user.name,
            picture: session.user.picture ?? null,
            avatarUrl: null,
            bio: null,
            email: session.user.email ?? null,
            phone: session.user.phone ?? null,
            timezone: null,
            language: null,
            profileUpdatedAt: null,
          });
          setFeedback(null);
          return;
        }
        setProfile(null);
        setFeedback({ tone: "error", key: "feedback.noProfile" });
      })
      .catch(() => {
        if (active) setFeedback({ tone: "error", key: "feedback.loadError" });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [session.user]);

  useEffect(() => {
    if (!profile?.id) return;
    void Promise.all([
      fetchUserIdentities(),
      fetchLoginHistory(),
      fetchMyWorkspaces(),
    ]).then(([ids, history, ws]) => {
      setIdentities(ids);
      setLoginHistory(history);
      setWorkspaces(ws);
    });
  }, [profile?.id]);

  async function handleSwitchTenant(tenantId: string) {
    setSwitchingTenant(tenantId);
    try {
      await switchTenantContext(tenantId);
    } finally {
      setSwitchingTenant(null);
    }
  }

  function resetFeedback() {
    setFeedback(null);
  }

  function languageLabel(value: string | null | undefined) {
    if (!value) return t("common.empty");
    if (value === "zh-CN") return t("language.zhCN");
    if (value === "en-US") return t("language.enUS");
    return value;
  }

  function accountStatusLabel(status: string | null | undefined) {
    if (status === "active") return t("accountStatus.active");
    if (status === "suspended") return t("accountStatus.suspended");
    if (!status) return empty;
    return t("accountStatus.unknown");
  }

  function openNameDialog() {
    if (!profile) return;
    setNameForm(profile.displayName ?? "");
    setNameDialogOpen(true);
    resetFeedback();
  }

  function openUsernameDialog() {
    if (!profile) return;
    setUsernameForm(profile.username ?? "");
    setUsernameDialogOpen(true);
    resetFeedback();
  }

  function openPersonalDialog() {
    if (!profile) return;
    setPersonalForm({
      bio: profile.bio ?? "",
      timezone: profile.timezone ?? "",
      language: profile.language ?? "",
    });
    setPersonalDialogOpen(true);
    resetFeedback();
  }

  function openPasswordDialog() {
    setPasswordForm({
      currentPassword: "",
      nextPassword: "",
      confirmPassword: "",
    });
    setPasswordDialogOpen(true);
    resetFeedback();
  }

  function openPhoneChangeDialog() {
    setPhoneChangeStep("step1");
    setPhoneIdMethod("phone");
    setStep1Code("");
    setEmailVerifyToken("");
    setMaskedEmail("");
    setIdentityToken("");
    setNewPhone("");
    setNewPhoneCode("");
    setStep1Sent(false);
    setStep2Sent(false);
    setPhoneSubmitting(false);
    setPhoneChangeOpen(true);
    resetFeedback();
  }

  function openContactVerify(mode: ContactVerifyMode) {
    setCvMode(mode);
    setCvToken("");
    setCvCode("");
    setCvNewEmail("");
    setCvMasked("");
    setCvSent(false);
    setCvSubmitting(false);
    setContactVerifyOpen(true);
    resetFeedback();
  }

  async function submitName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile) return;
    setSubmitting(true);
    resetFeedback();
    try {
      const updated = await updateUserProfile({
        displayName: normalizeOptional(nameForm),
      });
      setProfile(updated);
      setNameDialogOpen(false);
      setFeedback({ tone: "success", key: "feedback.profileSaved" });
      await refreshSession();
    } catch {
      setFeedback({ tone: "error", key: "feedback.profileSaveError" });
    } finally {
      setSubmitting(false);
    }
  }

  async function submitUsername(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile) return;
    setSubmitting(true);
    resetFeedback();
    try {
      const updated = await updateUsername(usernameForm.trim());
      setProfile(updated);
      setUsernameDialogOpen(false);
      setFeedback({ tone: "success", key: "feedback.usernameSaved" });
      await refreshSession();
    } catch (error) {
      const status =
        error instanceof ConsoleBffError ? error.status : undefined;
      const key =
        status === 409
          ? "feedback.usernameTaken"
          : status === 400
            ? "feedback.usernameCooldown"
            : "feedback.usernameSaveError";
      setFeedback({ tone: "error", key });
    } finally {
      setSubmitting(false);
    }
  }

  async function submitPersonal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile) return;
    setSubmitting(true);
    resetFeedback();
    try {
      const updated = await updateUserProfile({
        bio: normalizeOptional(personalForm.bio),
        timezone: normalizeOptional(personalForm.timezone),
        language: normalizeOptional(personalForm.language),
      });
      setProfile(updated);
      setPersonalDialogOpen(false);
      setFeedback({ tone: "success", key: "feedback.contactSaved" });
      await refreshSession();
    } catch {
      setFeedback({ tone: "error", key: "feedback.contactSaveError" });
    } finally {
      setSubmitting(false);
    }
  }

  async function submitUnbind(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!unbindTarget) return;
    setSubmitting(true);
    resetFeedback();
    try {
      await unbindIdentity(unbindTarget.provider);
      const ids = await fetchUserIdentities();
      setIdentities(ids);
      setUnbindTarget(null);
      setFeedback({ tone: "success", key: "feedback.unbindSuccess" });
    } catch {
      setFeedback({ tone: "error", key: "feedback.unbindError" });
    } finally {
      setSubmitting(false);
    }
  }

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    resetFeedback();
    if (passwordForm.nextPassword !== passwordForm.confirmPassword) {
      setFeedback({ tone: "error", key: "feedback.passwordMismatch" });
      return;
    }
    if (passwordForm.nextPassword.length < 6) {
      setFeedback({ tone: "error", key: "feedback.passwordTooShort" });
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
      setPasswordDialogOpen(false);
      setFeedback({ tone: "success", key: "feedback.passwordSaved" });
    } catch {
      setFeedback({ tone: "error", key: "feedback.passwordSaveError" });
    } finally {
      setSubmitting(false);
    }
  }

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
    resetFeedback();
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
    resetFeedback();
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

  // ── Account (username+password) login toggle ─────────────────────────────────

  async function toggleAccountLogin(enable: boolean) {
    if (!enable) {
      // Confirm before disabling.
      setDisableLoginConfirmOpen(true);
      return;
    }
    setSubmitting(true);
    resetFeedback();
    try {
      const updated = await setAccountLogin(true);
      setProfile(updated);
      setFeedback({ tone: "success", key: "feedback.accountLoginEnabled" });
    } catch {
      setFeedback({ tone: "error", key: "feedback.accountLoginError" });
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmDisableAccountLogin() {
    setSubmitting(true);
    resetFeedback();
    try {
      const updated = await setAccountLogin(false);
      setProfile(updated);
      setDisableLoginConfirmOpen(false);
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

  // ── Phone change handlers ─────────────────────────────────────────────────

  async function sendStep1PhoneOtp() {
    setPhoneSubmitting(true);
    try {
      await sendOldPhoneOtp();
      setStep1Sent(true);
    } catch {
      setFeedback({ tone: "error", key: "feedback.phoneCodeSendError" });
    } finally {
      setPhoneSubmitting(false);
    }
  }

  async function sendStep1EmailOtp() {
    setPhoneSubmitting(true);
    try {
      const { emailVerifyToken: token, maskedEmail: masked } =
        await sendEmailOtpForPhoneChange();
      setEmailVerifyToken(token);
      setMaskedEmail(masked);
      setStep1Sent(true);
    } catch {
      setFeedback({ tone: "error", key: "feedback.phoneCodeSendError" });
    } finally {
      setPhoneSubmitting(false);
    }
  }

  function switchToEmailMethod() {
    setPhoneIdMethod("email");
    setStep1Code("");
    setStep1Sent(false);
  }

  function switchToPhoneMethod() {
    setPhoneIdMethod("phone");
    setStep1Code("");
    setEmailVerifyToken("");
    setMaskedEmail("");
    setStep1Sent(false);
  }

  async function submitStep1() {
    setPhoneSubmitting(true);
    try {
      const payload =
        phoneIdMethod === "phone"
          ? { method: "phone" as const, code: step1Code }
          : { method: "email" as const, code: step1Code, emailVerifyToken };
      const { identityToken: token } = await verifyPhoneChangeIdentity(payload);
      setIdentityToken(token);
      setPhoneChangeStep("step2");
    } catch {
      setFeedback({ tone: "error", key: "feedback.phoneIdentityError" });
    } finally {
      setPhoneSubmitting(false);
    }
  }

  async function sendStep2Otp() {
    if (!newPhone.trim()) return;
    setPhoneSubmitting(true);
    try {
      await sendNewPhoneOtp(newPhone.trim());
      setStep2Sent(true);
    } catch {
      setFeedback({ tone: "error", key: "feedback.phoneCodeSendError" });
    } finally {
      setPhoneSubmitting(false);
    }
  }

  async function submitStep2() {
    setPhoneSubmitting(true);
    try {
      const updated = await confirmPhoneChange({
        identityToken,
        newPhone: newPhone.trim(),
        newPhoneCode,
      });
      setProfile(updated);
      setPhoneChangeStep("success");
      await refreshSession();
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 409) {
        setFeedback({ tone: "error", key: "feedback.phoneAlreadyInUse" });
      } else {
        setFeedback({ tone: "error", key: "feedback.phoneChangeError" });
      }
    } finally {
      setPhoneSubmitting(false);
    }
  }

  // ── Unified contact-verify (phone verify / email verify / email change) ──────

  async function cvSend() {
    setCvSubmitting(true);
    resetFeedback();
    try {
      if (cvMode === "phone-verify") {
        await sendOldPhoneOtp();
        setCvSent(true);
      } else if (cvMode === "email-verify") {
        const { emailVerifyToken: token, maskedEmail: masked } =
          await sendCurrentEmailOtp();
        setCvToken(token);
        setCvMasked(masked);
        setCvSent(true);
      } else {
        const email = cvNewEmail.trim();
        if (!email.includes("@")) {
          setFeedback({ tone: "error", key: "feedback.emailInvalid" });
          return;
        }
        const { emailVerifyToken: token } = await sendNewEmailOtp(email);
        setCvToken(token);
        setCvSent(true);
      }
    } catch {
      setFeedback({ tone: "error", key: "feedback.phoneCodeSendError" });
    } finally {
      setCvSubmitting(false);
    }
  }

  async function cvSubmit() {
    setCvSubmitting(true);
    resetFeedback();
    try {
      let updated: ConsoleUserProfile;
      if (cvMode === "phone-verify") {
        updated = await verifyCurrentPhone(cvCode);
      } else if (cvMode === "email-verify") {
        updated = await verifyCurrentEmail({
          emailVerifyToken: cvToken,
          code: cvCode,
        });
      } else {
        updated = await confirmEmailChange({
          emailVerifyToken: cvToken,
          newEmail: cvNewEmail.trim(),
          code: cvCode,
        });
      }
      setProfile(updated);
      setContactVerifyOpen(false);
      setFeedback({
        tone: "success",
        key:
          cvMode === "email-change"
            ? "feedback.emailChanged"
            : cvMode === "email-verify"
              ? "feedback.emailVerified"
              : "feedback.phoneVerified",
      });
      await refreshSession();
    } catch (err) {
      const status = (err as { status?: number }).status;
      setFeedback({
        tone: "error",
        key:
          cvMode === "email-change" && status === 409
            ? "feedback.emailInUse"
            : "feedback.verifyError",
      });
    } finally {
      setCvSubmitting(false);
    }
  }

  const empty = t("common.empty");
  const loadingText = t("common.loading");
  const displayName = displayValue(
    profile?.displayName,
    profile?.username || session.user?.name || empty,
  );
  const username = displayValue(
    profile?.username,
    session.user?.username ?? empty,
  );
  const bio = displayValue(profile?.bio, empty);
  const email = displayValue(profile?.email, empty);
  const phone = formatPhone(profile?.phone, empty);
  const timezone = formatTimezone(profile?.timezone, empty);
  const language = languageLabel(profile?.language);
  const createdAt = formatProfileDate(profile?.accountCreatedAt, locale, empty);
  const usernameNextChangeAt = profile?.usernameChangeableAt ?? null;
  const usernameChangeable =
    !usernameNextChangeAt ||
    new Date(usernameNextChangeAt).getTime() <= Date.now();
  const usernameNextChangeLabel = usernameNextChangeAt
    ? formatProfileDate(usernameNextChangeAt, locale, empty)
    : empty;
  const accountLoginEnabled = !(profile?.accountLoginDisabled ?? false);
  // All four providers listed in fixed order (google > feishu > dingtalk >
  // wechat); this panel only reflects bound/unbound — binding is login-time.
  const connectedAccounts: ConnectedAccountRecord[] = PROVIDER_ORDER.map(
    (provider) => {
      const identity = identities.find((i) => i.provider === provider);
      return {
        provider,
        connected: Boolean(identity),
        accountId: identity?.providerSubject ?? null,
        connectedAt: identity?.connectedAt ?? null,
      };
    },
  );
  const recentLogins = loginHistory.slice(0, 3);

  function renderPhoneSteps() {
    const steps = [
      t("dialogs.phoneChange.step1Label"),
      t("dialogs.phoneChange.step2Label"),
    ];
    const activeIdx = phoneChangeStep === "step1" ? 0 : 1;
    return (
      <div className="vx-phone-change-steps">
        {steps.map((label, i) => {
          const isActive = i === activeIdx;
          const isDone = i < activeIdx;
          return (
            <Fragment key={label}>
              {i > 0 && <span className="vx-phone-change-steps__connector" />}
              <span
                className={
                  isDone
                    ? "vx-phone-change-steps__dot vx-phone-change-steps__dot--done"
                    : isActive
                      ? "vx-phone-change-steps__dot vx-phone-change-steps__dot--active"
                      : "vx-phone-change-steps__dot"
                }
              />
              <span
                className={
                  isActive
                    ? "vx-phone-change-steps__label vx-phone-change-steps__label--active"
                    : "vx-phone-change-steps__label"
                }
              >
                {label}
              </span>
            </Fragment>
          );
        })}
      </div>
    );
  }

  return (
    <div className="vx-page-stack vx-profile-page vx-account-profile-page">
      <PageHeader
        eyebrow={t("header.eyebrow")}
        title={t("header.title")}
        description={t("header.description")}
      />

      {feedback ? (
        <p
          className={
            feedback.tone === "success"
              ? "vx-profile-message"
              : "vx-profile-error"
          }
        >
          {t(feedback.key, feedback.values)}
        </p>
      ) : null}

      <Input
        ref={fileInputRef}
        type="file"
        accept={AVATAR_ACCEPT}
        hidden
        onChange={(event) => void handleAvatarSelect(event)}
      />

      {/* ── §一 Avatar header card (grid: avatar | info | actions) ──────────── */}
      <div className="vx-account-profile-compact-card">
        <Button
          variant="ghost"
          size="icon"
          className="vx-account-profile-avatar-button"
          aria-label={t("avatar.upload")}
          title={t("avatar.upload")}
          onClick={() => fileInputRef.current?.click()}
          disabled={!profile || submitting}
        >
          <UserAvatar
            className="vx-account-profile-compact-avatar vx-account-profile-avatar"
            src={profile?.picture ?? null}
            alt={t("avatar.alt", { name: displayName })}
          />
          <span
            className="vx-account-profile-avatar-button__edit"
            aria-hidden="true"
          >
            <Icon name="edit" size="xs" fallback="placeholder" />
          </span>
        </Button>

        <div className="vx-account-profile-compact-card__info">
          <span className="vx-account-profile-compact-name-row">
            <strong>{loading ? loadingText : displayName}</strong>
            <span className="vx-account-profile-compact-tags">
              {profile?.accountStatus ? (
                <span
                  className={
                    profile.accountStatus === "suspended"
                      ? "vx-profile-tag vx-profile-tag--error"
                      : "vx-profile-tag"
                  }
                >
                  {accountStatusLabel(profile.accountStatus)}
                </span>
              ) : null}
              <span className="vx-profile-tag vx-profile-tag--warning">
                {t("verification.unverified")}
              </span>
            </span>
          </span>
          <span className="vx-account-profile-compact-account-no">
            {t("fields.userNo")}:{" "}
            {loading ? loadingText : (profile?.userNo ?? empty)}
          </span>
        </div>

        <div className="vx-account-profile-compact-card__actions">
          <ActionButton
            variant="outline"
            icon="shield-check"
            size="sm"
            onClick={() => router.push("/profile/verification")}
          >
            {t("verification.goVerify")}
          </ActionButton>
          <ActionButton
            variant="outline"
            icon="x"
            size="sm"
            onClick={() => void removeAvatar()}
            disabled={submitting || !profile?.picture}
          >
            {t("actions.clearAvatar")}
          </ActionButton>
        </div>
      </div>

      {/* ── §二 Account info: name / phone / email ─────────────────────────── */}
      <section className="vx-profile-group">
        <div className="vx-profile-group__header">
          <div>
            <h2>{t("sections.account.title")}</h2>
            <p>{t("sections.account.description")}</p>
          </div>
        </div>
        <div className="vx-profile-row vx-profile-row--actionable">
          <span>{t("fields.displayName")}</span>
          <span className="vx-profile-value">
            {loading ? loadingText : displayName}
          </span>
          <ActionButton
            variant="outline"
            size="sm"
            icon="edit"
            onClick={openNameDialog}
            disabled={!profile || loading}
          >
            {t("actions.edit")}
          </ActionButton>
        </div>
        <div className="vx-profile-row vx-profile-row--actionable">
          <span>{t("fields.phone")}</span>
          <span className="vx-profile-value">
            {loading ? loadingText : phone}
            {!loading && profile?.phone ? (
              <>
                {" "}
                <span
                  className={
                    profile.phoneVerified
                      ? "vx-profile-tag"
                      : "vx-profile-tag vx-profile-tag--warning"
                  }
                >
                  {profile.phoneVerified
                    ? t("verified.verified")
                    : t("verified.unverified")}
                </span>
              </>
            ) : null}
          </span>
          <span className="vx-profile-row__actions">
            {!loading && profile?.phone && !profile.phoneVerified ? (
              <ActionButton
                variant="ghost"
                size="sm"
                icon="shield-check"
                onClick={() => openContactVerify("phone-verify")}
              >
                {t("actions.verify")}
              </ActionButton>
            ) : null}
            <ActionButton
              variant="ghost"
              size="sm"
              icon="phone"
              onClick={openPhoneChangeDialog}
              disabled={!profile || loading}
            >
              {t("actions.change")}
            </ActionButton>
          </span>
        </div>
        <div className="vx-profile-row vx-profile-row--actionable">
          <span>{t("fields.email")}</span>
          <span className="vx-profile-value">
            {loading ? loadingText : email}
            {!loading && profile?.email ? (
              <>
                {" "}
                <span
                  className={
                    profile.emailVerified
                      ? "vx-profile-tag"
                      : "vx-profile-tag vx-profile-tag--warning"
                  }
                >
                  {profile.emailVerified
                    ? t("verified.verified")
                    : t("verified.unverified")}
                </span>
              </>
            ) : null}
          </span>
          <span className="vx-profile-row__actions">
            {!loading && profile?.email && !profile.emailVerified ? (
              <ActionButton
                variant="ghost"
                size="sm"
                icon="shield-check"
                onClick={() => openContactVerify("email-verify")}
              >
                {t("actions.verify")}
              </ActionButton>
            ) : null}
            <ActionButton
              variant="ghost"
              size="sm"
              icon="mail"
              onClick={() => openContactVerify("email-change")}
              disabled={!profile || loading}
            >
              {t("actions.change")}
            </ActionButton>
          </span>
        </div>
      </section>

      {/* ── §三 Personal info: language / timezone / bio / created (one edit) ─ */}
      <section className="vx-profile-group">
        <div className="vx-profile-group__header">
          <div>
            <h2>{t("sections.personal.title")}</h2>
            <p>{t("sections.personal.description")}</p>
          </div>
          <ActionButton
            variant="outline"
            icon="edit"
            onClick={openPersonalDialog}
            disabled={!profile}
          >
            {t("actions.edit")}
          </ActionButton>
        </div>
        <div className="vx-profile-row">
          <span>{t("fields.language")}</span>
          <span className="vx-profile-value">
            {loading ? loadingText : language}
          </span>
        </div>
        <div className="vx-profile-row">
          <span>{t("fields.timezone")}</span>
          <span className="vx-profile-value">
            {loading ? loadingText : timezone}
          </span>
        </div>
        <div className="vx-profile-row">
          <span>{t("fields.bio")}</span>
          <span className="vx-profile-value">
            {loading ? loadingText : bio}
          </span>
        </div>
        <div className="vx-profile-row">
          <span>{t("fields.createdAt")}</span>
          <span className="vx-profile-value">
            {loading ? loadingText : createdAt}
          </span>
        </div>
      </section>

      {/* ── §四 Account security: username / password + login toggle ────────── */}
      <section className="vx-profile-group">
        <div className="vx-profile-group__header">
          <div>
            <h2>{t("sections.security.title")}</h2>
            <p>{t("sections.security.description")}</p>
          </div>
          <ActionButton
            variant="outline"
            icon={accountLoginEnabled ? "x" : "shield-check"}
            onClick={() => void toggleAccountLogin(!accountLoginEnabled)}
            disabled={!profile || submitting}
          >
            {accountLoginEnabled
              ? t("security.disableLogin")
              : t("security.enableLogin")}
          </ActionButton>
        </div>
        <div className="vx-profile-row vx-profile-row--actionable">
          <span>{t("fields.username")}</span>
          <span className="vx-profile-value">
            {loading ? loadingText : username}
            {!loading ? (
              <>
                {" "}
                <span
                  className={
                    accountLoginEnabled
                      ? "vx-profile-tag"
                      : "vx-profile-tag vx-profile-tag--error"
                  }
                >
                  {accountLoginEnabled
                    ? t("security.canLogin")
                    : t("security.cannotLogin")}
                </span>
              </>
            ) : null}
            {!loading && !usernameChangeable ? (
              <span className="vx-profile-tag">
                {t("username.cooldownHint", {
                  date: usernameNextChangeLabel,
                })}
              </span>
            ) : null}
          </span>
          <ActionButton
            variant="ghost"
            size="sm"
            icon="edit"
            onClick={openUsernameDialog}
            disabled={!profile || loading || !usernameChangeable}
          >
            {t("actions.edit")}
          </ActionButton>
        </div>
        <div className="vx-profile-row vx-profile-row--actionable">
          <span>{t("fields.password")}</span>
          <span className="vx-profile-value">
            {profile?.hasPassword
              ? t("security.passwordSet")
              : t("security.passwordNotSet")}
          </span>
          <ActionButton
            variant="ghost"
            size="sm"
            icon="shield-check"
            onClick={openPasswordDialog}
          >
            {profile?.hasPassword
              ? t("actions.changePassword")
              : t("actions.setPassword")}
          </ActionButton>
        </div>
      </section>

      {/* ── §五 Connected accounts (all 4; google>feishu>dingtalk>wechat) ───── */}
      <section className="vx-profile-group">
        <div className="vx-profile-group__header">
          <div>
            <h2>{t("sections.connectedAccounts.title")}</h2>
            <p>{t("sections.connectedAccounts.description")}</p>
          </div>
        </div>
        <div className="vx-account-connected-list">
          {connectedAccounts.map((account) => {
            const providerName = t(
              `connectedAccounts.providers.${account.provider}.name`,
            );
            const providerDescription = t(
              `connectedAccounts.providers.${account.provider}.description`,
            );
            const accountId =
              maskConnectedAccountId(account.accountId) || empty;
            const connectedAt = account.connected
              ? formatProfileDate(account.connectedAt, locale, empty)
              : empty;
            return (
              <div
                key={account.provider}
                className={
                  account.connected
                    ? "vx-account-connected-row vx-account-connected-row--connected"
                    : "vx-account-connected-row"
                }
                title={providerName}
              >
                <span
                  className={`vx-account-connected-logo vx-account-connected-logo--${account.provider}`}
                  aria-hidden="true"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={PROVIDER_LOGO_SRC[account.provider]}
                    alt=""
                    width={22}
                    height={22}
                  />
                </span>
                <div className="vx-account-connected-copy">
                  <div className="vx-account-connected-copy__title">
                    <strong>{providerName}</strong>
                    <span className="vx-profile-tag">
                      {account.connected
                        ? t("connectedAccounts.status.connected")
                        : t("connectedAccounts.status.disconnected")}
                    </span>
                  </div>
                  <p>{providerDescription}</p>
                </div>
                <div className="vx-account-connected-meta">
                  <span>{t("connectedAccounts.fields.account")}</span>
                  <span title={accountId}>{accountId}</span>
                </div>
                <div className="vx-account-connected-meta">
                  <span>{t("connectedAccounts.fields.connectedAt")}</span>
                  <span title={connectedAt}>{connectedAt}</span>
                </div>
                <div className="vx-account-connected-actions">
                  {account.connected ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setUnbindTarget(account)}
                    >
                      {t("connectedAccounts.actions.unbind")}
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── §六 Workspaces (horizontal rows) ────────────────────────────────── */}
      <section className="vx-profile-group">
        <div className="vx-profile-group__header">
          <div>
            <h2>{t("sections.workspaces.title")}</h2>
            <p>{t("sections.workspaces.description")}</p>
          </div>
        </div>
        {workspaces.length === 0 ? (
          <p className="vx-profile-message">
            {loading ? loadingText : t("sections.workspaces.empty")}
          </p>
        ) : (
          <div className="vx-account-connected-list">
            {workspaces.map((ws) => {
              const roleLabel = ["owner", "manager", "member"].includes(ws.role)
                ? t(`workspaces.role.${ws.role}`)
                : ws.role;
              const joinedAt = formatProfileDate(ws.joinedAt, locale, empty);
              const workspaceName = ws.workspaceName ?? ws.tenantName;
              const workspaceId = ws.workspaceId ?? ws.tenantId;
              const isDefault = ws.tenantType === "personal";
              return (
                <div
                  key={ws.tenantId}
                  className="vx-account-connected-row"
                  title={workspaceName}
                >
                  <span
                    className="vx-account-connected-logo vx-account-connected-logo--workspace"
                    aria-hidden="true"
                  >
                    <Icon name="buildings" size="sm" fallback="placeholder" />
                  </span>
                  <div className="vx-account-connected-copy">
                    <div className="vx-account-connected-copy__title">
                      <strong>{workspaceName}</strong>
                      {isDefault ? (
                        <span className="vx-profile-tag">default</span>
                      ) : null}
                    </div>
                    <p title={workspaceId}>{workspaceId}</p>
                  </div>
                  <div className="vx-account-connected-meta">
                    <span>{t("fields.role")}</span>
                    <span>{roleLabel}</span>
                  </div>
                  <div className="vx-account-connected-meta">
                    <span>{t("workspaces.joinedAt")}</span>
                    <span>{joinedAt}</span>
                  </div>
                  <div className="vx-account-connected-actions">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        ws.isCurrent
                          ? router.push("/organization")
                          : void handleSwitchTenant(ws.tenantId)
                      }
                      disabled={switchingTenant === ws.tenantId}
                    >
                      {t("workspaces.detail")}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── §七 Login history (last 3) ──────────────────────────────────────── */}
      <section className="vx-profile-group">
        <div className="vx-profile-group__header">
          <div>
            <h2>{t("sections.loginHistory.title")}</h2>
            <p>{t("sections.loginHistory.description")}</p>
          </div>
        </div>
        {recentLogins.length === 0 ? (
          <p className="vx-profile-message">
            {loading ? loadingText : t("sections.loginHistory.empty")}
          </p>
        ) : (
          <div className="vx-login-history" role="table">
            <div className="vx-login-history__head" role="row">
              <span role="columnheader">{t("loginHistory.index")}</span>
              <span role="columnheader">{t("loginHistory.time")}</span>
              <span role="columnheader">{t("loginHistory.ip")}</span>
              <span role="columnheader">{t("loginHistory.os")}</span>
            </div>
            {recentLogins.map((entry, i) => (
              <div
                className="vx-login-history__row"
                role="row"
                key={`${entry.loginAt}-${i}`}
              >
                <span role="cell">{i + 1}</span>
                <span role="cell">
                  {formatProfileDate(entry.loginAt, locale, empty)}
                </span>
                <span role="cell">{entry.ipAddress || empty}</span>
                <span role="cell">{parseOS(entry.userAgent) || empty}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Dialogs ──────────────────────────────────────────────────────────── */}

      {/* Display-name edit dialog */}
      {nameDialogOpen ? (
        <div
          className="vx-profile-dialog"
          role="dialog"
          aria-modal="true"
          aria-label={t("dialogs.name.title")}
        >
          <div
            className="vx-profile-dialog__backdrop"
            onClick={() => setNameDialogOpen(false)}
          />
          <form
            className="vx-profile-dialog__content vx-account-profile-dialog"
            onSubmit={(event) => void submitName(event)}
          >
            <header className="vx-account-profile-dialog__header">
              <h3>{t("dialogs.name.title")}</h3>
              <p>{t("dialogs.name.description")}</p>
            </header>
            <div className="vx-account-profile-form-grid">
              <Label className="vx-account-profile-form-grid__wide">
                {t("fields.displayName")}
                <Input
                  value={nameForm}
                  onChange={(event) => setNameForm(event.target.value)}
                  autoComplete="name"
                />
              </Label>
            </div>
            <div className="vx-profile-dialog__actions">
              <Button
                variant="outline"
                onClick={() => setNameDialogOpen(false)}
              >
                {t("actions.cancel")}
              </Button>
              <Button type="submit" disabled={submitting}>
                {t("actions.save")}
              </Button>
            </div>
          </form>
        </div>
      ) : null}

      {/* Username edit dialog — unique, once per 30 days */}
      {usernameDialogOpen ? (
        <div
          className="vx-profile-dialog"
          role="dialog"
          aria-modal="true"
          aria-label={t("dialogs.username.title")}
        >
          <div
            className="vx-profile-dialog__backdrop"
            onClick={() => setUsernameDialogOpen(false)}
          />
          <form
            className="vx-profile-dialog__content vx-account-profile-dialog"
            onSubmit={submitUsername}
          >
            <header className="vx-account-profile-dialog__header">
              <h3>{t("dialogs.username.title")}</h3>
              <p>{t("dialogs.username.description")}</p>
            </header>
            <div className="vx-account-profile-form-grid">
              <Label className="vx-account-profile-form-grid__wide">
                {t("fields.username")}
                <Input
                  value={usernameForm}
                  onChange={(event) => setUsernameForm(event.target.value)}
                  autoComplete="username"
                  placeholder={t("placeholders.username")}
                />
              </Label>
            </div>
            <div className="vx-profile-dialog__actions">
              <Button
                variant="outline"
                onClick={() => setUsernameDialogOpen(false)}
                disabled={submitting}
              >
                {t("actions.cancel")}
              </Button>
              <Button type="submit" disabled={submitting}>
                {t("actions.save")}
              </Button>
            </div>
          </form>
        </div>
      ) : null}

      {/* Personal info edit dialog — bio / timezone / language */}
      {personalDialogOpen ? (
        <div
          className="vx-profile-dialog"
          role="dialog"
          aria-modal="true"
          aria-label={t("dialogs.personal.title")}
        >
          <div
            className="vx-profile-dialog__backdrop"
            onClick={() => setPersonalDialogOpen(false)}
          />
          <form
            className="vx-profile-dialog__content vx-account-profile-dialog"
            onSubmit={(event) => void submitPersonal(event)}
          >
            <header className="vx-account-profile-dialog__header">
              <h3>{t("dialogs.personal.title")}</h3>
              <p>{t("dialogs.personal.description")}</p>
            </header>
            <Label>
              {t("fields.language")}
              <NativeSelect
                className="vx-input"
                value={personalForm.language}
                onChange={(event) =>
                  setPersonalForm((old) => ({
                    ...old,
                    language: event.target.value,
                  }))
                }
              >
                <option value="">{t("common.empty")}</option>
                <option value="zh-CN">{t("language.zhCN")}</option>
                <option value="en-US">{t("language.enUS")}</option>
              </NativeSelect>
            </Label>
            <Label>
              {t("fields.timezone")}
              <NativeSelect
                className="vx-input"
                value={personalForm.timezone}
                onChange={(event) =>
                  setPersonalForm((old) => ({
                    ...old,
                    timezone: event.target.value,
                  }))
                }
              >
                <option value="">{t("common.empty")}</option>
                {personalForm.timezone &&
                !TIMEZONE_OPTIONS.includes(personalForm.timezone) ? (
                  <option value={personalForm.timezone}>
                    {personalForm.timezone}
                  </option>
                ) : null}
                {TIMEZONE_OPTIONS.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </NativeSelect>
            </Label>
            <Label>
              {t("fields.bio")}
              <Textarea
                className="vx-profile-dialog__textarea"
                rows={4}
                value={personalForm.bio}
                onChange={(event) =>
                  setPersonalForm((old) => ({
                    ...old,
                    bio: event.target.value,
                  }))
                }
                placeholder={t("placeholders.bio")}
              />
            </Label>
            <div className="vx-profile-dialog__actions">
              <Button
                variant="outline"
                onClick={() => setPersonalDialogOpen(false)}
              >
                {t("actions.cancel")}
              </Button>
              <Button type="submit" disabled={submitting}>
                {t("actions.save")}
              </Button>
            </div>
          </form>
        </div>
      ) : null}

      {/* Password change dialog */}
      {passwordDialogOpen ? (
        <div
          className="vx-profile-dialog"
          role="dialog"
          aria-modal="true"
          aria-label={t("dialogs.password.title")}
        >
          <div
            className="vx-profile-dialog__backdrop"
            onClick={() => setPasswordDialogOpen(false)}
          />
          <form
            className="vx-profile-dialog__content vx-account-profile-dialog"
            onSubmit={(event) => void submitPassword(event)}
          >
            <header className="vx-account-profile-dialog__header">
              <h3>
                {profile?.hasPassword
                  ? t("dialogs.password.title")
                  : t("dialogs.password.setupTitle")}
              </h3>
              <p>
                {profile?.hasPassword
                  ? t("dialogs.password.description")
                  : t("dialogs.password.setupDescription")}
              </p>
            </header>
            {profile?.hasPassword ? (
              <Label>
                {t("fields.currentPassword")}
                <Input
                  type="password"
                  value={passwordForm.currentPassword}
                  onChange={(event) =>
                    setPasswordForm((old) => ({
                      ...old,
                      currentPassword: event.target.value,
                    }))
                  }
                  autoComplete="current-password"
                  required
                />
              </Label>
            ) : null}
            <Label>
              {t("fields.nextPassword")}
              <Input
                type="password"
                value={passwordForm.nextPassword}
                onChange={(event) =>
                  setPasswordForm((old) => ({
                    ...old,
                    nextPassword: event.target.value,
                  }))
                }
                autoComplete="new-password"
                minLength={6}
                required
              />
            </Label>
            <Label>
              {t("fields.confirmPassword")}
              <Input
                type="password"
                value={passwordForm.confirmPassword}
                onChange={(event) =>
                  setPasswordForm((old) => ({
                    ...old,
                    confirmPassword: event.target.value,
                  }))
                }
                autoComplete="new-password"
                minLength={6}
                required
              />
            </Label>
            <div className="vx-profile-dialog__actions">
              <Button
                variant="outline"
                onClick={() => setPasswordDialogOpen(false)}
              >
                {t("actions.cancel")}
              </Button>
              <Button type="submit" disabled={submitting}>
                {profile?.hasPassword
                  ? t("actions.updatePassword")
                  : t("actions.setPassword")}
              </Button>
            </div>
          </form>
        </div>
      ) : null}

      {/* Unified contact-verify dialog (phone verify / email verify / change) */}
      {contactVerifyOpen ? (
        <div
          className="vx-profile-dialog"
          role="dialog"
          aria-modal="true"
          aria-label={t(`dialogs.contactVerify.${cvMode}.title`)}
        >
          <div
            className="vx-profile-dialog__backdrop"
            onClick={() => setContactVerifyOpen(false)}
          />
          <div className="vx-profile-dialog__content vx-account-profile-dialog">
            <header className="vx-account-profile-dialog__header">
              <h3>{t(`dialogs.contactVerify.${cvMode}.title`)}</h3>
              <p>{t(`dialogs.contactVerify.${cvMode}.description`)}</p>
            </header>

            {cvMode === "email-change" ? (
              <Label>
                {t("fields.newEmail")}
                <Input
                  type="email"
                  value={cvNewEmail}
                  onChange={(event) => {
                    setCvNewEmail(event.target.value);
                    setCvSent(false);
                  }}
                  placeholder={t("placeholders.newEmail")}
                  autoComplete="email"
                />
              </Label>
            ) : null}

            {cvSent ? (
              <p className="vx-phone-change-sent-hint">
                <Icon name="check" size="xs" fallback="placeholder" />
                {cvMode === "phone-verify"
                  ? t("dialogs.phoneChange.sentToPhone", {
                      phone: profile?.phone ?? "",
                    })
                  : cvMode === "email-verify"
                    ? t("dialogs.phoneChange.sentToEmail", { email: cvMasked })
                    : t("dialogs.phoneChange.sentToEmail", {
                        email: cvNewEmail,
                      })}
              </p>
            ) : (
              <Button
                variant="outline"
                onClick={() => void cvSend()}
                disabled={
                  cvSubmitting ||
                  (cvMode === "email-change" && !cvNewEmail.trim())
                }
              >
                {t("actions.sendCode")}
              </Button>
            )}

            <Label>
              {t("fields.verificationCode")}
              <Input
                value={cvCode}
                onChange={(event) => setCvCode(event.target.value)}
                placeholder={t("placeholders.verificationCode")}
                inputMode="numeric"
                maxLength={6}
                disabled={!cvSent}
              />
            </Label>

            <div className="vx-profile-dialog__actions">
              <Button
                variant="outline"
                onClick={() => setContactVerifyOpen(false)}
              >
                {t("actions.cancel")}
              </Button>
              <Button
                onClick={() => void cvSubmit()}
                disabled={cvSubmitting || !cvSent || cvCode.length < 6}
              >
                {t("actions.confirm")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Phone change dialog — two-step, all-or-nothing */}
      {phoneChangeOpen ? (
        <div
          className="vx-profile-dialog"
          role="dialog"
          aria-modal="true"
          aria-label={t("dialogs.phoneChange.step1Title")}
        >
          <div
            className="vx-profile-dialog__backdrop"
            onClick={() => setPhoneChangeOpen(false)}
          />
          <div className="vx-profile-dialog__content vx-account-profile-dialog">
            {phoneChangeStep === "success" ? (
              <>
                <header className="vx-account-profile-dialog__header">
                  <h3>{t("dialogs.phoneChange.successTitle")}</h3>
                  <p>
                    {t("dialogs.phoneChange.successMessage", {
                      phone: profile?.phone ?? "",
                    })}
                  </p>
                </header>
                <div className="vx-profile-dialog__actions">
                  <Button onClick={() => setPhoneChangeOpen(false)}>
                    {t("actions.close")}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <header className="vx-account-profile-dialog__header">
                  {renderPhoneSteps()}
                  <h3>
                    {phoneChangeStep === "step1"
                      ? t("dialogs.phoneChange.step1Title")
                      : t("dialogs.phoneChange.step2Title")}
                  </h3>
                  <p>
                    {phoneChangeStep === "step1"
                      ? t("dialogs.phoneChange.step1Description")
                      : t("dialogs.phoneChange.step2Description")}
                  </p>
                </header>

                {phoneChangeStep === "step1" ? (
                  <>
                    {step1Sent ? (
                      <p className="vx-phone-change-sent-hint">
                        <Icon name="check" size="xs" fallback="placeholder" />
                        {phoneIdMethod === "phone"
                          ? t("dialogs.phoneChange.sentToPhone", {
                              phone: profile?.phone ?? "",
                            })
                          : t("dialogs.phoneChange.sentToEmail", {
                              email: maskedEmail,
                            })}
                      </p>
                    ) : (
                      <Button
                        variant="outline"
                        onClick={() =>
                          void (phoneIdMethod === "phone"
                            ? sendStep1PhoneOtp()
                            : sendStep1EmailOtp())
                        }
                        disabled={phoneSubmitting}
                      >
                        {phoneIdMethod === "phone"
                          ? t("dialogs.phoneChange.sendToPhone", {
                              phone: profile?.phone ?? "",
                            })
                          : t("actions.sendCode")}
                      </Button>
                    )}

                    <Label>
                      {t("fields.verificationCode")}
                      <Input
                        value={step1Code}
                        onChange={(event) => setStep1Code(event.target.value)}
                        placeholder={t("placeholders.verificationCode")}
                        inputMode="numeric"
                        maxLength={6}
                        disabled={!step1Sent}
                      />
                    </Label>

                    <div className="vx-phone-change-alt">
                      {step1Sent && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="vx-phone-change-alt__btn"
                          type="button"
                          onClick={() =>
                            void (phoneIdMethod === "phone"
                              ? sendStep1PhoneOtp()
                              : sendStep1EmailOtp())
                          }
                          disabled={phoneSubmitting}
                        >
                          {t("actions.resendCode")}
                        </Button>
                      )}
                      {phoneIdMethod === "phone" && profile?.email ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="vx-phone-change-alt__btn"
                          type="button"
                          onClick={switchToEmailMethod}
                        >
                          {t("dialogs.phoneChange.switchToEmail", {
                            email: profile.email,
                          })}
                        </Button>
                      ) : phoneIdMethod === "email" ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="vx-phone-change-alt__btn"
                          type="button"
                          onClick={switchToPhoneMethod}
                        >
                          {t("dialogs.phoneChange.switchToPhone")}
                        </Button>
                      ) : null}
                    </div>

                    <div className="vx-profile-dialog__actions">
                      <Button
                        variant="outline"
                        onClick={() => setPhoneChangeOpen(false)}
                      >
                        {t("actions.cancel")}
                      </Button>
                      <Button
                        onClick={() => void submitStep1()}
                        disabled={
                          phoneSubmitting || !step1Sent || step1Code.length < 6
                        }
                      >
                        {t("actions.next")}
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <Label>
                      {t("fields.newPhone")}
                      <div className="vx-phone-change-new-phone-row">
                        <Input
                          type="tel"
                          value={newPhone}
                          onChange={(event) => {
                            setNewPhone(event.target.value);
                            setStep2Sent(false);
                          }}
                          placeholder={t("placeholders.newPhone")}
                          autoComplete="tel"
                          style={{ flex: 1 }}
                        />
                        <Button
                          variant="outline"
                          onClick={() => void sendStep2Otp()}
                          disabled={phoneSubmitting || !newPhone.trim()}
                        >
                          {step2Sent
                            ? t("actions.resendCode")
                            : t("actions.sendCode")}
                        </Button>
                      </div>
                    </Label>

                    {step2Sent && (
                      <p className="vx-phone-change-sent-hint">
                        <Icon name="check" size="xs" fallback="placeholder" />
                        {t("dialogs.phoneChange.sentToPhone", {
                          phone: newPhone,
                        })}
                      </p>
                    )}

                    <Label>
                      {t("fields.verificationCode")}
                      <Input
                        value={newPhoneCode}
                        onChange={(event) =>
                          setNewPhoneCode(event.target.value)
                        }
                        placeholder={t("placeholders.verificationCode")}
                        inputMode="numeric"
                        maxLength={6}
                        disabled={!step2Sent}
                      />
                    </Label>

                    <div className="vx-profile-dialog__actions">
                      <Button
                        variant="outline"
                        onClick={() => setPhoneChangeStep("step1")}
                      >
                        {t("actions.prev")}
                      </Button>
                      <Button
                        onClick={() => void submitStep2()}
                        disabled={
                          phoneSubmitting ||
                          !step2Sent ||
                          newPhoneCode.length < 6
                        }
                      >
                        {t("actions.completeChange")}
                      </Button>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      ) : null}

      {/* Disable account-login confirmation */}
      {disableLoginConfirmOpen ? (
        <div
          className="vx-profile-dialog"
          role="dialog"
          aria-modal="true"
          aria-label={t("dialogs.disableLogin.title")}
        >
          <div
            className="vx-profile-dialog__backdrop"
            onClick={() => setDisableLoginConfirmOpen(false)}
          />
          <div className="vx-profile-dialog__content vx-account-profile-dialog">
            <header className="vx-account-profile-dialog__header">
              <h3>{t("dialogs.disableLogin.title")}</h3>
              <p>{t("dialogs.disableLogin.description")}</p>
            </header>
            <div className="vx-profile-dialog__actions">
              <Button
                variant="outline"
                onClick={() => setDisableLoginConfirmOpen(false)}
                disabled={submitting}
              >
                {t("actions.cancel")}
              </Button>
              <Button
                onClick={() => void confirmDisableAccountLogin()}
                disabled={submitting}
              >
                {t("security.disableLogin")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Unbind connected account confirmation dialog */}
      {unbindTarget ? (
        <div
          className="vx-profile-dialog"
          role="dialog"
          aria-modal="true"
          aria-label={t("connectedAccounts.dialogs.unbindTitle")}
        >
          <div
            className="vx-profile-dialog__backdrop"
            onClick={() => setUnbindTarget(null)}
          />
          <form
            className="vx-profile-dialog__content vx-account-profile-dialog"
            onSubmit={submitUnbind}
          >
            <header className="vx-account-profile-dialog__header">
              <h3>{t("connectedAccounts.dialogs.unbindTitle")}</h3>
              <p>
                {t("connectedAccounts.dialogs.unbindDescription", {
                  provider: t(
                    `connectedAccounts.providers.${unbindTarget.provider}.name`,
                  ),
                })}
              </p>
            </header>
            <div className="vx-profile-dialog__actions">
              <Button
                variant="outline"
                onClick={() => setUnbindTarget(null)}
                disabled={submitting}
              >
                {t("actions.cancel")}
              </Button>
              <Button type="submit" disabled={submitting}>
                {t("connectedAccounts.actions.confirmUnbind")}
              </Button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
