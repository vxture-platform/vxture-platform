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
  Banner,
  Button,
  DataTable,
  DetailList,
  DetailRow,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  FieldGroup,
  FieldLabel,
  Icon,
  Input,
  NativeSelect,
  StatusBadge,
  Textarea,
  UserAvatar,
  ViewHeader,
  ViewLayout,
} from "@vxture/design-system";
import { ConnectedRow, IdentityCard } from "@/components/detail";
import { PageSection } from "@/layout/shell";
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

/**
 * Record lists (connected accounts / workspaces) own the dashed dividers between
 * their rows, the same way `DetailList` does for its field rows — `ConnectedRow`
 * only draws itself so the last row never carries a stray bottom rule.
 */
const CONNECTED_LIST_CLASS =
  "flex flex-col [&>*+*]:border-t [&>*+*]:border-dashed [&>*+*]:border-primary/10 dark:[&>*+*]:border-primary/20";

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
    /* allSettled, not all: fetchLoginHistory now throws on failure (it is
     * strict so the security screen can tell an outage from "no sessions"),
     * and with Promise.all a single failing read would blank the identities
     * and workspaces sections too — and reject unhandled. Each section falls
     * back independently instead. */
    void Promise.allSettled([
      fetchUserIdentities(),
      fetchLoginHistory(),
      fetchMyWorkspaces(),
    ]).then(([ids, history, ws]) => {
      if (ids.status === "fulfilled") setIdentities(ids.value);
      if (history.status === "fulfilled") setLoginHistory(history.value);
      if (ws.status === "fulfilled") setWorkspaces(ws.value);
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
      <div className="flex flex-wrap items-center gap-xs">
        {steps.map((label, i) => {
          const isActive = i === activeIdx;
          const isDone = i < activeIdx;
          return (
            <Fragment key={label}>
              {i > 0 && <span className="h-px w-media-xs bg-border" />}
              <span
                className={
                  isDone || isActive
                    ? "size-2xs rounded-full bg-primary"
                    : "size-2xs rounded-full bg-border"
                }
              />
              <span
                className={
                  isActive
                    ? "text-label-sm text-foreground"
                    : "text-label-sm text-muted-foreground"
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
    <ViewLayout>
      <ViewHeader
        icon="user"
        title={t("header.title")}
        description={t("header.description")}
      />

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

      {/* ── §一 Avatar header card (grid: avatar | info | actions) ──────────── */}
      <IdentityCard
        avatar={
          <UserAvatar
            className="size-full"
            src={profile?.picture ?? null}
            alt={t("avatar.alt", { name: displayName })}
          />
        }
        avatarLabel={t("avatar.upload")}
        onAvatarClick={() => fileInputRef.current?.click()}
        avatarDisabled={!profile || submitting}
        name={loading ? loadingText : displayName}
        tags={
          <>
            {profile?.accountStatus ? (
              <StatusBadge
                tone={
                  profile.accountStatus === "suspended" ? "danger" : "success"
                }
              >
                {accountStatusLabel(profile.accountStatus)}
              </StatusBadge>
            ) : null}
            {/* No verification badge here: nothing computes a verification
             * state, so an unconditional "unverified" badge was a fabrication. */}
          </>
        }
        meta={
          <>
            {t("fields.userNo")}:{" "}
            {loading ? loadingText : (profile?.userNo ?? empty)}
          </>
        }
        actions={
          <>
            <Button
              variant="outline"
              size="md"
              onClick={() => router.push("/profile/verification")}
            >
              <Icon name="shield-check" size="xs" fallback="placeholder" />
              <span>{t("verification.goVerify")}</span>
            </Button>
            <Button
              variant="outline"
              size="md"
              onClick={() => void removeAvatar()}
              disabled={submitting || !profile?.picture}
            >
              <Icon name="x" size="xs" fallback="placeholder" />
              <span>{t("actions.clearAvatar")}</span>
            </Button>
          </>
        }
      />

      {/* ── §二 Account info: name / phone / email ─────────────────────────── */}
      <PageSection
        title={t("sections.account.title")}
        icon="user-circle"
        level={2}
        description={t("sections.account.description")}
      >
        <DetailList>
          <DetailRow
            label={t("fields.displayName")}
            actions={
              <Button
                variant="outline"
                size="md"
                onClick={openNameDialog}
                disabled={!profile || loading}
              >
                <Icon name="edit" size="xs" fallback="placeholder" />
                <span>{t("actions.edit")}</span>
              </Button>
            }
          >
            {loading ? loadingText : displayName}
          </DetailRow>
          <DetailRow
            label={t("fields.phone")}
            actions={
              <>
                {!loading && profile?.phone && !profile.phoneVerified ? (
                  <Button
                    variant="ghost"
                    size="md"
                    onClick={() => openContactVerify("phone-verify")}
                  >
                    <Icon
                      name="shield-check"
                      size="xs"
                      fallback="placeholder"
                    />
                    <span>{t("actions.verify")}</span>
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  size="md"
                  onClick={openPhoneChangeDialog}
                  disabled={!profile || loading}
                >
                  <Icon name="phone" size="xs" fallback="placeholder" />
                  <span>{t("actions.change")}</span>
                </Button>
              </>
            }
          >
            {loading ? loadingText : phone}
            {!loading && profile?.phone ? (
              <StatusBadge tone={profile.phoneVerified ? "success" : "warning"}>
                {profile.phoneVerified
                  ? t("verified.verified")
                  : t("verified.unverified")}
              </StatusBadge>
            ) : null}
          </DetailRow>
          <DetailRow
            label={t("fields.email")}
            actions={
              <>
                {!loading && profile?.email && !profile.emailVerified ? (
                  <Button
                    variant="ghost"
                    size="md"
                    onClick={() => openContactVerify("email-verify")}
                  >
                    <Icon
                      name="shield-check"
                      size="xs"
                      fallback="placeholder"
                    />
                    <span>{t("actions.verify")}</span>
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  size="md"
                  onClick={() => openContactVerify("email-change")}
                  disabled={!profile || loading}
                >
                  <Icon name="mail" size="xs" fallback="placeholder" />
                  <span>{t("actions.change")}</span>
                </Button>
              </>
            }
          >
            {loading ? loadingText : email}
            {!loading && profile?.email ? (
              <StatusBadge tone={profile.emailVerified ? "success" : "warning"}>
                {profile.emailVerified
                  ? t("verified.verified")
                  : t("verified.unverified")}
              </StatusBadge>
            ) : null}
          </DetailRow>
        </DetailList>
      </PageSection>

      {/* ── §三 Personal info: language / timezone / bio / created (one edit) ─ */}
      <PageSection
        title={t("sections.personal.title")}
        icon="faders"
        level={2}
        description={t("sections.personal.description")}
        action={
          <Button
            variant="outline"
            size="md"
            onClick={openPersonalDialog}
            disabled={!profile}
          >
            <Icon name="edit" size="xs" fallback="placeholder" />
            <span>{t("actions.edit")}</span>
          </Button>
        }
      >
        <DetailList>
          <DetailRow label={t("fields.language")}>
            {loading ? loadingText : language}
          </DetailRow>
          <DetailRow label={t("fields.timezone")}>
            {loading ? loadingText : timezone}
          </DetailRow>
          <DetailRow label={t("fields.bio")}>
            {loading ? loadingText : bio}
          </DetailRow>
          <DetailRow label={t("fields.createdAt")}>
            {loading ? loadingText : createdAt}
          </DetailRow>
        </DetailList>
      </PageSection>

      {/* ── §四 Account security: username / password + login toggle ────────── */}
      <PageSection
        title={t("sections.security.title")}
        icon="shield-check"
        level={2}
        description={t("sections.security.description")}
        action={
          <Button
            variant="outline"
            size="md"
            onClick={() => void toggleAccountLogin(!accountLoginEnabled)}
            disabled={!profile || submitting}
          >
            <Icon
              name={accountLoginEnabled ? "x" : "shield-check"}
              size="xs"
              fallback="placeholder"
            />
            <span>
              {accountLoginEnabled
                ? t("security.disableLogin")
                : t("security.enableLogin")}
            </span>
          </Button>
        }
      >
        <DetailList>
          <DetailRow
            label={t("fields.username")}
            actions={
              <Button
                variant="ghost"
                size="md"
                onClick={openUsernameDialog}
                disabled={!profile || loading || !usernameChangeable}
              >
                <Icon name="edit" size="xs" fallback="placeholder" />
                <span>{t("actions.edit")}</span>
              </Button>
            }
          >
            {loading ? loadingText : username}
            {!loading ? (
              <StatusBadge tone={accountLoginEnabled ? "success" : "danger"}>
                {accountLoginEnabled
                  ? t("security.canLogin")
                  : t("security.cannotLogin")}
              </StatusBadge>
            ) : null}
            {!loading && !usernameChangeable ? (
              <StatusBadge tone="neutral">
                {t("username.cooldownHint", {
                  date: usernameNextChangeLabel,
                })}
              </StatusBadge>
            ) : null}
          </DetailRow>
          <DetailRow
            label={t("fields.password")}
            actions={
              <Button variant="ghost" size="md" onClick={openPasswordDialog}>
                <Icon name="shield-check" size="xs" fallback="placeholder" />
                <span>
                  {profile?.hasPassword
                    ? t("actions.changePassword")
                    : t("actions.setPassword")}
                </span>
              </Button>
            }
          >
            {profile?.hasPassword
              ? t("security.passwordSet")
              : t("security.passwordNotSet")}
          </DetailRow>
        </DetailList>
      </PageSection>

      {/* ── §五 Connected accounts (all 4; google>feishu>dingtalk>wechat) ───── */}
      <PageSection
        title={t("sections.connectedAccounts.title")}
        icon="plugs-connected"
        level={2}
        description={t("sections.connectedAccounts.description")}
      >
        <div className={CONNECTED_LIST_CLASS}>
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
              <ConnectedRow
                key={account.provider}
                title_={providerName}
                logo={
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={PROVIDER_LOGO_SRC[account.provider]}
                    alt=""
                    width={22}
                    height={22}
                  />
                }
                title={providerName}
                status={
                  <StatusBadge tone={account.connected ? "success" : "neutral"}>
                    {account.connected
                      ? t("connectedAccounts.status.connected")
                      : t("connectedAccounts.status.disconnected")}
                  </StatusBadge>
                }
                description={providerDescription}
                meta={[
                  {
                    label: t("connectedAccounts.fields.account"),
                    value: accountId,
                    title: accountId,
                  },
                  {
                    label: t("connectedAccounts.fields.connectedAt"),
                    value: connectedAt,
                    title: connectedAt,
                  },
                ]}
                actions={
                  account.connected ? (
                    <Button
                      variant="outline"
                      size="md"
                      onClick={() => setUnbindTarget(account)}
                    >
                      {t("connectedAccounts.actions.unbind")}
                    </Button>
                  ) : null
                }
              />
            );
          })}
        </div>
      </PageSection>

      {/* ── §六 Workspaces (horizontal rows) ────────────────────────────────── */}
      <PageSection
        title={t("sections.workspaces.title")}
        icon="buildings"
        level={2}
        description={t("sections.workspaces.description")}
      >
        {workspaces.length === 0 ? (
          <EmptyState
            icon="buildings"
            title={loading ? loadingText : t("sections.workspaces.empty")}
          />
        ) : (
          <div className={CONNECTED_LIST_CLASS}>
            {workspaces.map((ws) => {
              const roleLabel = ["owner", "manager", "member"].includes(ws.role)
                ? t(`workspaces.role.${ws.role}`)
                : ws.role;
              const joinedAt = formatProfileDate(ws.joinedAt, locale, empty);
              const workspaceName = ws.workspaceName ?? ws.tenantName;
              const workspaceId = ws.workspaceId ?? ws.tenantId;
              const isDefault = ws.tenantType === "personal";
              return (
                <ConnectedRow
                  key={ws.tenantId}
                  title_={workspaceName}
                  logo={
                    <Icon name="buildings" size="sm" fallback="placeholder" />
                  }
                  title={workspaceName}
                  status={
                    isDefault ? (
                      <StatusBadge tone="neutral">
                        {t("workspaces.defaultTag")}
                      </StatusBadge>
                    ) : null
                  }
                  description={<span title={workspaceId}>{workspaceId}</span>}
                  meta={[
                    { label: t("fields.role"), value: roleLabel },
                    { label: t("workspaces.joinedAt"), value: joinedAt },
                  ]}
                  actions={
                    <Button
                      variant="outline"
                      size="md"
                      onClick={() =>
                        ws.isCurrent
                          ? router.push("/organization")
                          : void handleSwitchTenant(ws.tenantId)
                      }
                      disabled={switchingTenant === ws.tenantId}
                    >
                      {t("workspaces.detail")}
                    </Button>
                  }
                />
              );
            })}
          </div>
        )}
      </PageSection>

      {/* ── §七 Login history (last 3) ──────────────────────────────────────── */}
      <PageSection
        title={t("sections.loginHistory.title")}
        icon="clock-counter-clockwise"
        level={2}
        description={t("sections.loginHistory.description")}
      >
        {recentLogins.length === 0 ? (
          <EmptyState
            icon="clock"
            title={loading ? loadingText : t("sections.loginHistory.empty")}
          />
        ) : (
          /* The index column is declared explicitly rather than via DataTable's
             `indexStart` so its header keeps this page's own i18n key. */
          <DataTable
            rows={recentLogins}
            rowKey={(entry, i) => `${entry.loginAt}-${i}`}
            columns={[
              {
                id: "index",
                header: t("loginHistory.index"),
                align: "center",
                cell: (_entry, i) => i + 1,
              },
              {
                id: "time",
                header: t("loginHistory.time"),
                cell: (entry) =>
                  formatProfileDate(entry.loginAt, locale, empty),
              },
              {
                id: "ip",
                header: t("loginHistory.ip"),
                cell: (entry) => entry.ipAddress || empty,
              },
              {
                id: "os",
                header: t("loginHistory.os"),
                cell: (entry) => parseOS(entry.userAgent) || empty,
              },
            ]}
          />
        )}
      </PageSection>

      {/* ── Dialogs ──────────────────────────────────────────────────────────── */}

      {/* Display-name edit dialog */}
      <Dialog open={nameDialogOpen} onOpenChange={setNameDialogOpen}>
        <DialogContent>
          <form
            className="flex flex-col gap-lg"
            onSubmit={(event) => void submitName(event)}
          >
            <DialogHeader>
              <DialogTitle>{t("dialogs.name.title")}</DialogTitle>
              <DialogDescription>
                {t("dialogs.name.description")}
              </DialogDescription>
            </DialogHeader>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="profile-display-name">
                  {t("fields.displayName")}
                </FieldLabel>
                <Input
                  id="profile-display-name"
                  value={nameForm}
                  onChange={(event) => setNameForm(event.target.value)}
                  autoComplete="name"
                />
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setNameDialogOpen(false)}
              >
                {t("actions.cancel")}
              </Button>
              <Button type="submit" disabled={submitting}>
                {t("actions.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Username edit dialog — unique, once per 30 days */}
      <Dialog open={usernameDialogOpen} onOpenChange={setUsernameDialogOpen}>
        <DialogContent>
          <form className="flex flex-col gap-lg" onSubmit={submitUsername}>
            <DialogHeader>
              <DialogTitle>{t("dialogs.username.title")}</DialogTitle>
              <DialogDescription>
                {t("dialogs.username.description")}
              </DialogDescription>
            </DialogHeader>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="profile-username">
                  {t("fields.username")}
                </FieldLabel>
                <Input
                  id="profile-username"
                  value={usernameForm}
                  onChange={(event) => setUsernameForm(event.target.value)}
                  autoComplete="username"
                  placeholder={t("placeholders.username")}
                />
              </Field>
            </FieldGroup>
            <DialogFooter>
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
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Personal info edit dialog — bio / timezone / language */}
      <Dialog open={personalDialogOpen} onOpenChange={setPersonalDialogOpen}>
        <DialogContent>
          <form
            className="flex flex-col gap-lg"
            onSubmit={(event) => void submitPersonal(event)}
          >
            <DialogHeader>
              <DialogTitle>{t("dialogs.personal.title")}</DialogTitle>
              <DialogDescription>
                {t("dialogs.personal.description")}
              </DialogDescription>
            </DialogHeader>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="profile-language">
                  {t("fields.language")}
                </FieldLabel>
                <NativeSelect
                  id="profile-language"
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
              </Field>
              <Field>
                <FieldLabel htmlFor="profile-timezone">
                  {t("fields.timezone")}
                </FieldLabel>
                <NativeSelect
                  id="profile-timezone"
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
              </Field>
              <Field>
                <FieldLabel htmlFor="profile-bio">{t("fields.bio")}</FieldLabel>
                <Textarea
                  id="profile-bio"
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
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setPersonalDialogOpen(false)}
              >
                {t("actions.cancel")}
              </Button>
              <Button type="submit" disabled={submitting}>
                {t("actions.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Password change dialog */}
      <Dialog open={passwordDialogOpen} onOpenChange={setPasswordDialogOpen}>
        <DialogContent>
          <form
            className="flex flex-col gap-lg"
            onSubmit={(event) => void submitPassword(event)}
          >
            <DialogHeader>
              <DialogTitle>
                {profile?.hasPassword
                  ? t("dialogs.password.title")
                  : t("dialogs.password.setupTitle")}
              </DialogTitle>
              <DialogDescription>
                {profile?.hasPassword
                  ? t("dialogs.password.description")
                  : t("dialogs.password.setupDescription")}
              </DialogDescription>
            </DialogHeader>
            <FieldGroup>
              {profile?.hasPassword ? (
                <Field>
                  <FieldLabel htmlFor="profile-current-password">
                    {t("fields.currentPassword")}
                  </FieldLabel>
                  <Input
                    id="profile-current-password"
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
                </Field>
              ) : null}
              <Field>
                <FieldLabel htmlFor="profile-next-password">
                  {t("fields.nextPassword")}
                </FieldLabel>
                <Input
                  id="profile-next-password"
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
              </Field>
              <Field>
                <FieldLabel htmlFor="profile-confirm-password">
                  {t("fields.confirmPassword")}
                </FieldLabel>
                <Input
                  id="profile-confirm-password"
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
              </Field>
            </FieldGroup>
            <DialogFooter>
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
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Unified contact-verify dialog (phone verify / email verify / change) */}
      <Dialog open={contactVerifyOpen} onOpenChange={setContactVerifyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t(`dialogs.contactVerify.${cvMode}.title`)}
            </DialogTitle>
            <DialogDescription>
              {t(`dialogs.contactVerify.${cvMode}.description`)}
            </DialogDescription>
          </DialogHeader>

          <FieldGroup>
            {cvMode === "email-change" ? (
              <Field>
                <FieldLabel htmlFor="profile-new-email">
                  {t("fields.newEmail")}
                </FieldLabel>
                <Input
                  id="profile-new-email"
                  type="email"
                  value={cvNewEmail}
                  onChange={(event) => {
                    setCvNewEmail(event.target.value);
                    setCvSent(false);
                  }}
                  placeholder={t("placeholders.newEmail")}
                  autoComplete="email"
                />
              </Field>
            ) : null}

            {cvSent ? (
              <p className="flex items-center gap-xs text-body-sm text-success-text">
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
                className="self-start"
                onClick={() => void cvSend()}
                disabled={
                  cvSubmitting ||
                  (cvMode === "email-change" && !cvNewEmail.trim())
                }
              >
                {t("actions.sendCode")}
              </Button>
            )}

            <Field>
              <FieldLabel htmlFor="profile-verify-code">
                {t("fields.verificationCode")}
              </FieldLabel>
              <Input
                id="profile-verify-code"
                value={cvCode}
                onChange={(event) => setCvCode(event.target.value)}
                placeholder={t("placeholders.verificationCode")}
                inputMode="numeric"
                maxLength={6}
                disabled={!cvSent}
              />
            </Field>
          </FieldGroup>

          <DialogFooter>
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
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Phone change dialog — two-step, all-or-nothing */}
      <Dialog open={phoneChangeOpen} onOpenChange={setPhoneChangeOpen}>
        <DialogContent>
          <div className="flex flex-col gap-lg">
            {phoneChangeStep === "success" ? (
              <>
                <DialogHeader>
                  <DialogTitle>
                    {t("dialogs.phoneChange.successTitle")}
                  </DialogTitle>
                  <DialogDescription>
                    {t("dialogs.phoneChange.successMessage", {
                      phone: profile?.phone ?? "",
                    })}
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button onClick={() => setPhoneChangeOpen(false)}>
                    {t("actions.close")}
                  </Button>
                </DialogFooter>
              </>
            ) : (
              <>
                <DialogHeader>
                  {renderPhoneSteps()}
                  <DialogTitle>
                    {phoneChangeStep === "step1"
                      ? t("dialogs.phoneChange.step1Title")
                      : t("dialogs.phoneChange.step2Title")}
                  </DialogTitle>
                  <DialogDescription>
                    {phoneChangeStep === "step1"
                      ? t("dialogs.phoneChange.step1Description")
                      : t("dialogs.phoneChange.step2Description")}
                  </DialogDescription>
                </DialogHeader>

                {phoneChangeStep === "step1" ? (
                  <>
                    {step1Sent ? (
                      <p className="flex items-center gap-xs text-body-sm text-success-text">
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
                        className="self-start"
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

                    <Field>
                      <FieldLabel htmlFor="profile-step1-code">
                        {t("fields.verificationCode")}
                      </FieldLabel>
                      <Input
                        id="profile-step1-code"
                        value={step1Code}
                        onChange={(event) => setStep1Code(event.target.value)}
                        placeholder={t("placeholders.verificationCode")}
                        inputMode="numeric"
                        maxLength={6}
                        disabled={!step1Sent}
                      />
                    </Field>

                    <div className="flex flex-wrap items-center gap-xs">
                      {step1Sent && (
                        <Button
                          variant="ghost"
                          size="md"
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
                          size="md"
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
                          size="md"
                          type="button"
                          onClick={switchToPhoneMethod}
                        >
                          {t("dialogs.phoneChange.switchToPhone")}
                        </Button>
                      ) : null}
                    </div>

                    <DialogFooter>
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
                    </DialogFooter>
                  </>
                ) : (
                  <>
                    <Field>
                      <FieldLabel htmlFor="profile-new-phone">
                        {t("fields.newPhone")}
                      </FieldLabel>
                      <div className="flex items-center gap-sm">
                        <Input
                          id="profile-new-phone"
                          className="flex-1"
                          type="tel"
                          value={newPhone}
                          onChange={(event) => {
                            setNewPhone(event.target.value);
                            setStep2Sent(false);
                          }}
                          placeholder={t("placeholders.newPhone")}
                          autoComplete="tel"
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
                    </Field>

                    {step2Sent && (
                      <p className="flex items-center gap-xs text-body-sm text-success-text">
                        <Icon name="check" size="xs" fallback="placeholder" />
                        {t("dialogs.phoneChange.sentToPhone", {
                          phone: newPhone,
                        })}
                      </p>
                    )}

                    <Field>
                      <FieldLabel htmlFor="profile-new-phone-code">
                        {t("fields.verificationCode")}
                      </FieldLabel>
                      <Input
                        id="profile-new-phone-code"
                        value={newPhoneCode}
                        onChange={(event) =>
                          setNewPhoneCode(event.target.value)
                        }
                        placeholder={t("placeholders.verificationCode")}
                        inputMode="numeric"
                        maxLength={6}
                        disabled={!step2Sent}
                      />
                    </Field>

                    <DialogFooter>
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
                    </DialogFooter>
                  </>
                )}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Disable account-login confirmation */}
      <Dialog
        open={disableLoginConfirmOpen}
        onOpenChange={setDisableLoginConfirmOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("dialogs.disableLogin.title")}</DialogTitle>
            <DialogDescription>
              {t("dialogs.disableLogin.description")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
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
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unbind connected account confirmation dialog */}
      {unbindTarget ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setUnbindTarget(null);
          }}
        >
          <DialogContent>
            <form className="flex flex-col gap-lg" onSubmit={submitUnbind}>
              <DialogHeader>
                <DialogTitle>
                  {t("connectedAccounts.dialogs.unbindTitle")}
                </DialogTitle>
                <DialogDescription>
                  {t("connectedAccounts.dialogs.unbindDescription", {
                    provider: t(
                      `connectedAccounts.providers.${unbindTarget.provider}.name`,
                    ),
                  })}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
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
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
    </ViewLayout>
  );
}
