"use client";

/**
 * AcceptInvitationPage.tsx — 接受邀请(批 2;邮件链接落点 /accept-invitation?token=)。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * 先看清楚再点:按 token 读出「谁邀你、进哪个租户、什么角色、发给哪个邮箱、
 * 有效期到几时」,再给一个「接受并加入」。租户由 token 决定,不看当前活跃租户;
 * 受邀邮箱与登录账号邮箱不一致时在这一页就说出来(BFF 也会拒),并给出换账号的路。
 * 接受成功后先在本页说「已加入」,「进入」才切到该租户——切租户是一次顶层导航
 * (identity/080 §2.8,页面整体重载到工作台首页),不静默跳转。
 */

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@vxture-platform/shared";
import {
  Banner,
  Button,
  DetailList,
  DetailRow,
  Skeleton,
  StatusBadge,
  ViewHeader,
  ViewLayout,
} from "@vxture/design-system";
import {
  ConsoleBffError,
  acceptInvitation,
  acceptInvitationReason,
  lookupInvitation,
  type AcceptInvitationReason,
  type InvitationLookup,
} from "@/api/console-bff";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import { getPathname, useRouter } from "@/lib/i18n/navigation";
import { PageSection } from "@/layout/shell";
import { fmtDate, fmtTime } from "@/modules/commerce/components/hubModel";

const KNOWN_ROLES = new Set([
  "owner",
  "manager",
  "member",
  "readonly",
  "guest",
]);

type LookupState =
  | { kind: "loading" }
  | { kind: "failed" }
  | { kind: "rejected"; reason: AcceptInvitationReason }
  | { kind: "ready"; invitation: InvitationLookup };

export function AcceptInvitationPage() {
  const t = useTranslations("acceptInvitationPage");
  const tLoad = useTranslations("loadState");
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const { session, switchTenant, signOut } = useConsoleSession();

  const [lookup, setLookup] = useState<LookupState>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [accepting, setAccepting] = useState(false);
  const [entering, setEntering] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [acceptedReason, setAcceptedReason] =
    useState<AcceptInvitationReason | null>(null);
  const [done, setDone] = useState<{
    tenantId: string;
    tenantName: string | null;
  } | null>(null);

  useEffect(() => {
    if (!token) return;
    let active = true;
    setLookup({ kind: "loading" });
    lookupInvitation(token)
      .then((invitation) => {
        if (!active) return;
        if (invitation.status === "pending") {
          setLookup({ kind: "ready", invitation });
        } else {
          setLookup({
            kind: "rejected",
            reason:
              invitation.status === "accepted"
                ? "already_accepted"
                : invitation.status,
          });
        }
      })
      .catch((caught: unknown) => {
        if (!active) return;
        const reason = acceptInvitationReason(caught);
        setLookup(reason ? { kind: "rejected", reason } : { kind: "failed" });
      });
    return () => {
      active = false;
    };
  }, [token, reloadKey]);

  const currentEmail = session.user?.email?.trim().toLowerCase() ?? "";
  const invitation = lookup.kind === "ready" ? lookup.invitation : null;
  const emailMismatch = useMemo(
    () =>
      invitation !== null &&
      currentEmail !== invitation.email.trim().toLowerCase(),
    [currentEmail, invitation],
  );

  const roleLabel = (code: string) =>
    KNOWN_ROLES.has(code) ? t(`role.${code}`) : code;

  const reasonText = (reason: AcceptInvitationReason) =>
    reason === "email_mismatch"
      ? t("reasons.email_mismatch", { email: session.user?.email ?? "—" })
      : t(`reasons.${reason}`);

  async function handleAccept() {
    if (!invitation) return;
    setAccepting(true);
    setAcceptError(null);
    try {
      const accepted = await acceptInvitation(token);
      setDone({ tenantId: accepted.tenantId, tenantName: accepted.tenantName });
    } catch (caught) {
      const reason = acceptInvitationReason(caught);
      if (reason) {
        setAcceptedReason(reason);
      } else {
        setAcceptError(
          caught instanceof ConsoleBffError && caught.message
            ? caught.message
            : t("acceptError"),
        );
      }
    } finally {
      setAccepting(false);
    }
  }

  async function handleSwitchAccount() {
    const next = `/accept-invitation?token=${encodeURIComponent(token)}`;
    try {
      await signOut();
    } finally {
      router.replace(`/signin?next=${encodeURIComponent(next)}`);
    }
  }

  const switchAccountButton = (
    <Button
      size="md"
      variant="outline"
      onClick={() => void handleSwitchAccount()}
    >
      {t("actions.switchAccount")}
    </Button>
  );

  function renderBody() {
    if (!token) {
      return <Banner tone="danger" title={t("missingToken")} />;
    }
    if (done) {
      const target = done;
      return (
        <div className="flex flex-col gap-md">
          <Banner
            tone="success"
            title={t("accepted", { tenant: target.tenantName ?? "—" })}
            description={t("acceptedDescription")}
          />
          <div>
            <Button
              size="md"
              disabled={entering}
              onClick={() => {
                // 顶层导航:切到受邀租户并落到工作台首页(页面整体重载)
                setEntering(true);
                void switchTenant(
                  target.tenantId,
                  getPathname({ href: "/", locale: locale as Locale }),
                );
              }}
            >
              {t("actions.enter")}
            </Button>
          </div>
        </div>
      );
    }
    if (lookup.kind === "loading") {
      return (
        <div className="flex flex-col gap-sm" aria-busy="true">
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-6 w-1/3" />
          <Skeleton className="h-6 w-2/3" />
        </div>
      );
    }
    if (lookup.kind === "failed") {
      return (
        <div className="flex flex-col gap-sm">
          <Banner
            tone="danger"
            title={tLoad("title")}
            description={tLoad("description")}
          />
          <div>
            <Button
              size="md"
              variant="outline"
              onClick={() => setReloadKey((k) => k + 1)}
            >
              {tLoad("retry")}
            </Button>
          </div>
        </div>
      );
    }
    if (lookup.kind === "rejected" || acceptedReason) {
      const reason =
        lookup.kind === "rejected" ? lookup.reason : acceptedReason!;
      return (
        <div className="flex flex-col gap-md">
          <Banner tone="warning" title={reasonText(reason)} />
          <div className="flex flex-wrap gap-sm">
            {reason === "email_mismatch" ? switchAccountButton : null}
            <Button
              size="md"
              variant={reason === "email_mismatch" ? "ghost" : "outline"}
              onClick={() => router.replace("/")}
            >
              {t("actions.later")}
            </Button>
          </div>
        </div>
      );
    }
    const inv = lookup.invitation;
    return (
      <div className="flex flex-col gap-md">
        <DetailList>
          <DetailRow label={t("fields.tenant")}>
            {inv.tenantName ?? "—"}
          </DetailRow>
          <DetailRow label={t("fields.inviter")}>
            {inv.inviterName ?? "—"}
          </DetailRow>
          <DetailRow label={t("fields.role")}>
            <StatusBadge tone="brand">{roleLabel(inv.roleCode)}</StatusBadge>
          </DetailRow>
          <DetailRow label={t("fields.email")}>{inv.email}</DetailRow>
          <DetailRow label={t("fields.expires")}>
            <span className="tabular-nums">
              {fmtDate(inv.expiresAt)} {fmtTime(inv.expiresAt)}
            </span>
          </DetailRow>
        </DetailList>
        {emailMismatch ? (
          <Banner
            tone="warning"
            title={t("mismatchTitle")}
            description={t("mismatchHint", {
              current: session.user?.email || "—",
              invited: inv.email,
            })}
          />
        ) : null}
        {acceptError ? <Banner tone="danger" title={acceptError} /> : null}
        <div className="flex flex-wrap gap-sm">
          {emailMismatch ? (
            switchAccountButton
          ) : (
            <Button
              size="md"
              disabled={accepting}
              onClick={() => void handleAccept()}
            >
              {t("actions.accept")}
            </Button>
          )}
          <Button
            size="md"
            variant="ghost"
            disabled={accepting}
            onClick={() => router.replace("/")}
          >
            {t("actions.later")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <ViewLayout>
      <ViewHeader
        icon="mail"
        title={t("title")}
        description={t("description")}
      />
      <PageSection icon="mail" level={2} title={t("cardTitle")}>
        {renderBody()}
      </PageSection>
    </ViewLayout>
  );
}
