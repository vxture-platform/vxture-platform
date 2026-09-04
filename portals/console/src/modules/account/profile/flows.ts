"use client";

/**
 * flows.ts — 账号信息页里带验证码的两条流程(换手机 / 验证或更换联系方式)。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * 批 5a:从 ProfilePage 抽出成 hook,对话框组件只拿状态与动作,不再各自持一堆
 * useState。两条流程的 BFF 端点与步骤逻辑原样保留(OTP 发送 / 校验 / 二步换号)。
 */

import { useState } from "react";
import {
  confirmEmailChange,
  confirmPhoneChange,
  sendCurrentEmailOtp,
  sendEmailOtpForPhoneChange,
  sendNewEmailOtp,
  sendNewPhoneOtp,
  sendOldPhoneOtp,
  verifyCurrentEmail,
  verifyCurrentPhone,
  verifyPhoneChangeIdentity,
} from "@/api/console-bff";
import type { ConsoleUserProfile } from "@/entities/console";

export type Feedback = {
  tone: "success" | "error";
  key: string;
  values?: Record<string, number | string>;
} | null;

export type PhoneChangeStep = "step1" | "step2" | "success";
export type PhoneIdMethod = "phone" | "email";
/** Unified verify-contact dialog modes. */
export type ContactVerifyMode =
  | "phone-verify"
  | "email-verify"
  | "email-change";

interface FlowDeps {
  profile: ConsoleUserProfile | null;
  setProfile: (next: ConsoleUserProfile) => void;
  setFeedback: (next: Feedback) => void;
  refreshSession: () => Promise<unknown>;
}

export function usePhoneChangeFlow(deps: FlowDeps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<PhoneChangeStep>("step1");
  const [idMethod, setIdMethod] = useState<PhoneIdMethod>("phone");
  const [step1Code, setStep1Code] = useState("");
  const [emailVerifyToken, setEmailVerifyToken] = useState("");
  const [maskedEmail, setMaskedEmail] = useState("");
  const [identityToken, setIdentityToken] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newPhoneCode, setNewPhoneCode] = useState("");
  const [step1Sent, setStep1Sent] = useState(false);
  const [step2Sent, setStep2Sent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function start() {
    setStep("step1");
    setIdMethod("phone");
    setStep1Code("");
    setEmailVerifyToken("");
    setMaskedEmail("");
    setIdentityToken("");
    setNewPhone("");
    setNewPhoneCode("");
    setStep1Sent(false);
    setStep2Sent(false);
    setSubmitting(false);
    setOpen(true);
    deps.setFeedback(null);
  }

  async function sendStep1PhoneOtp() {
    setSubmitting(true);
    try {
      await sendOldPhoneOtp();
      setStep1Sent(true);
    } catch {
      deps.setFeedback({ tone: "error", key: "feedback.phoneCodeSendError" });
    } finally {
      setSubmitting(false);
    }
  }

  async function sendStep1EmailOtp() {
    setSubmitting(true);
    try {
      const { emailVerifyToken: token, maskedEmail: masked } =
        await sendEmailOtpForPhoneChange();
      setEmailVerifyToken(token);
      setMaskedEmail(masked);
      setStep1Sent(true);
    } catch {
      deps.setFeedback({ tone: "error", key: "feedback.phoneCodeSendError" });
    } finally {
      setSubmitting(false);
    }
  }

  function switchToEmailMethod() {
    setIdMethod("email");
    setStep1Code("");
    setStep1Sent(false);
  }

  function switchToPhoneMethod() {
    setIdMethod("phone");
    setStep1Code("");
    setEmailVerifyToken("");
    setMaskedEmail("");
    setStep1Sent(false);
  }

  async function submitStep1() {
    setSubmitting(true);
    try {
      const payload =
        idMethod === "phone"
          ? { method: "phone" as const, code: step1Code }
          : { method: "email" as const, code: step1Code, emailVerifyToken };
      const { identityToken: token } = await verifyPhoneChangeIdentity(payload);
      setIdentityToken(token);
      setStep("step2");
    } catch {
      deps.setFeedback({ tone: "error", key: "feedback.phoneIdentityError" });
    } finally {
      setSubmitting(false);
    }
  }

  async function sendStep2Otp() {
    if (!newPhone.trim()) return;
    setSubmitting(true);
    try {
      await sendNewPhoneOtp(newPhone.trim());
      setStep2Sent(true);
    } catch {
      deps.setFeedback({ tone: "error", key: "feedback.phoneCodeSendError" });
    } finally {
      setSubmitting(false);
    }
  }

  async function submitStep2() {
    setSubmitting(true);
    try {
      const updated = await confirmPhoneChange({
        identityToken,
        newPhone: newPhone.trim(),
        newPhoneCode,
      });
      deps.setProfile(updated);
      setStep("success");
      await deps.refreshSession();
    } catch (err) {
      const status = (err as { status?: number }).status;
      deps.setFeedback({
        tone: "error",
        key:
          status === 409
            ? "feedback.phoneAlreadyInUse"
            : "feedback.phoneChangeError",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return {
    open,
    setOpen,
    start,
    step,
    setStep,
    idMethod,
    step1Code,
    setStep1Code,
    maskedEmail,
    newPhone,
    setNewPhone,
    newPhoneCode,
    setNewPhoneCode,
    step1Sent,
    step2Sent,
    setStep2Sent,
    submitting,
    sendStep1PhoneOtp,
    sendStep1EmailOtp,
    switchToEmailMethod,
    switchToPhoneMethod,
    submitStep1,
    sendStep2Otp,
    submitStep2,
  };
}

export type PhoneChangeFlow = ReturnType<typeof usePhoneChangeFlow>;

export function useContactVerifyFlow(deps: FlowDeps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ContactVerifyMode>("email-verify");
  const [token, setToken] = useState("");
  const [code, setCode] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [masked, setMasked] = useState("");
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function start(next: ContactVerifyMode) {
    setMode(next);
    setToken("");
    setCode("");
    setNewEmail("");
    setMasked("");
    setSent(false);
    setSubmitting(false);
    setOpen(true);
    deps.setFeedback(null);
  }

  async function send() {
    setSubmitting(true);
    deps.setFeedback(null);
    try {
      if (mode === "phone-verify") {
        await sendOldPhoneOtp();
        setSent(true);
      } else if (mode === "email-verify") {
        const { emailVerifyToken, maskedEmail } = await sendCurrentEmailOtp();
        setToken(emailVerifyToken);
        setMasked(maskedEmail);
        setSent(true);
      } else {
        const email = newEmail.trim();
        if (!email.includes("@")) {
          deps.setFeedback({ tone: "error", key: "feedback.emailInvalid" });
          return;
        }
        const { emailVerifyToken } = await sendNewEmailOtp(email);
        setToken(emailVerifyToken);
        setSent(true);
      }
    } catch {
      deps.setFeedback({ tone: "error", key: "feedback.phoneCodeSendError" });
    } finally {
      setSubmitting(false);
    }
  }

  async function submit() {
    setSubmitting(true);
    deps.setFeedback(null);
    try {
      let updated: ConsoleUserProfile;
      if (mode === "phone-verify") {
        updated = await verifyCurrentPhone(code);
      } else if (mode === "email-verify") {
        updated = await verifyCurrentEmail({ emailVerifyToken: token, code });
      } else {
        updated = await confirmEmailChange({
          emailVerifyToken: token,
          newEmail: newEmail.trim(),
          code,
        });
      }
      deps.setProfile(updated);
      setOpen(false);
      deps.setFeedback({
        tone: "success",
        key:
          mode === "email-change"
            ? "feedback.emailChanged"
            : mode === "email-verify"
              ? "feedback.emailVerified"
              : "feedback.phoneVerified",
      });
      await deps.refreshSession();
    } catch (err) {
      const status = (err as { status?: number }).status;
      deps.setFeedback({
        tone: "error",
        key:
          mode === "email-change" && status === 409
            ? "feedback.emailInUse"
            : "feedback.verifyError",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return {
    open,
    setOpen,
    start,
    mode,
    code,
    setCode,
    newEmail,
    setNewEmail,
    setSent,
    masked,
    sent,
    submitting,
    send,
    submit,
  };
}

export type ContactVerifyFlow = ReturnType<typeof useContactVerifyFlow>;
