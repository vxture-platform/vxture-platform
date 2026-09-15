"use client";

/**
 * SecretsDrawer.tsx — 产品页「密钥管理」面板。
 * @package @vxture/opera
 * @layer Presentation
 * @category Features - Product
 *
 * owner 2026-09-14:「除了需要单独的密钥管理可以弹出单独面板」。
 *
 * 密钥与其它配置分开，不是为了整齐，是因为它们的性质不同：
 *  - **不可回读**。client_secret 库里只有哈希，webhook 签名密钥是密文。表单回填不了，
 *    放进「保存设置」里就只能是一个恒空的框——而恒空的框配上「留空则不改」的三态规则，
 *    是此前误清密钥的那条路。
 *  - **明文只出现一次**。签发或轮换之后当场交接，关掉就再也拿不到。
 *  - **每一次都是安全动作**。两条写都挂 step-up：能换掉签名密钥的人就能伪造平台发往产品
 *    的开通 / 停用事件；轮换 client_secret 会让产品侧当前的配置当场失效。
 */

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  Badge,
  Banner,
  Button,
  DialogForm,
  Drawer,
  Icon,
  Input,
  SectionHeader,
  Separator,
  StatusBadge,
  Textarea,
  useToast,
} from "@vxture/design-system";
import { useTranslations } from "next-intl";
import { api, OperaApiError } from "@/lib/api";
import { isStepUpCancelled, useStepUp } from "@/features/stepup/StepUpProvider";
import { FormField } from "./DetailForm";
import {
  CHANNEL_LABEL,
  generateSecret,
  type ClientRecord,
  type WebhookRecord,
} from "./onboarding-model";

function reason(error: unknown, fallback: string): string {
  return error instanceof OperaApiError && error.message
    ? error.message
    : fallback;
}

export interface SecretsDrawerProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly productId: string;
  readonly productCode: string;
  readonly clients: readonly ClientRecord[];
  readonly webhook: WebhookRecord | null;
  readonly canManage: boolean;
  /** 签名设置写成功后回传新的登记行，页面据此更新「已登记」与上线检查。 */
  readonly onWebhookChange: (next: WebhookRecord) => void;
}

export function SecretsDrawer({
  open,
  onClose,
  productId,
  productCode,
  clients,
  webhook,
  canManage,
  onWebhookChange,
}: SecretsDrawerProps) {
  const tShared = useTranslations();
  const { toast } = useToast();
  const { runWithStepUp } = useStepUp();

  /** 一次性明文。面板关掉即清空——明文不在内存里多留一刻。 */
  const [reveal, setReveal] = useState<{
    title: string;
    lines: string[];
  } | null>(null);
  const [rotateTarget, setRotateTarget] = useState<ClientRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [secretRef, setSecretRef] = useState("");
  const [secret, setSecret] = useState("");

  /* 每次打开都按库里的现状重置：上一次没保存的输入不该带进下一次。 */
  useEffect(() => {
    if (open) {
      setSecretRef(webhook?.webhookSecretRef ?? "");
      setSecret("");
    } else {
      setReveal(null);
    }
  }, [open, webhook?.webhookSecretRef]);

  async function rotate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const target = rotateTarget;
    if (!target) return;
    setBusy(true);
    try {
      const result = await runWithStepUp(() =>
        api.post<{ clientId: string; clientSecret: string }>(
          `/api/oidc-clients/${encodeURIComponent(target.clientId)}/rotate-secret`,
        ),
      );
      setRotateTarget(null);
      setReveal({
        title: `${result.clientId} 的新密钥`,
        lines: [
          `client_id：${result.clientId}`,
          `client_secret：${result.clientSecret}`,
        ],
      });
    } catch (error) {
      if (!isStepUpCancelled(error)) {
        toast({
          tone: "danger",
          title: "轮换失败",
          description: reason(error, "轮换失败"),
        });
      }
    } finally {
      setBusy(false);
    }
  }

  async function saveWebhookSecret(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextRef = secretRef.trim();
    const nextSecret = secret.trim();
    const refChanged = nextRef !== (webhook?.webhookSecretRef ?? "");
    if (!refChanged && !nextSecret) {
      toast({ tone: "info", title: "没有改动" });
      return;
    }
    setBusy(true);
    try {
      const result = await runWithStepUp(() =>
        api.put<WebhookRecord>(`/api/products/${productId}/webhook-secret`, {
          ...(refChanged ? { webhookSecretRef: nextRef || null } : {}),
          ...(nextSecret ? { webhookSecret: nextSecret } : {}),
        }),
      );
      onWebhookChange(result);
      setSecret("");
      if (nextSecret) {
        setReveal({
          title: "Webhook 签名密钥已登记",
          lines: [
            `回调地址：${result.webhookUrl ?? "（未填）"}`,
            ...(result.webhookSecretRef
              ? [`签名密钥引用（旧路径）：${result.webhookSecretRef}`]
              : []),
            `签名密钥：${nextSecret}`,
          ],
        });
      } else {
        toast({ tone: "success", title: "签名密钥引用已更新" });
      }
    } catch (error) {
      if (!isStepUpCancelled(error)) {
        toast({
          tone: "danger",
          title: "保存失败",
          description: reason(error, "保存失败"),
        });
      }
    } finally {
      setBusy(false);
    }
  }

  function copyReveal() {
    if (!reveal) return;
    void navigator.clipboard.writeText(reveal.lines.join("\n")).then(
      () => toast({ tone: "success", title: "已复制" }),
      () =>
        toast({
          tone: "danger",
          title: "复制失败",
          description: "浏览器拒绝了剪贴板访问，请手动选中复制。",
        }),
    );
  }

  return (
    <>
      <Drawer
        open={open}
        onClose={onClose}
        width="lg"
        title="密钥管理"
        description={productCode}
      >
        <div className="flex flex-col gap-xl">
          {reveal ? (
            <div className="flex flex-col gap-sm">
              <Banner
                tone="warning"
                title={reveal.title}
                description="这是唯一一次看到明文，关闭面板后无法再次查看。请立即复制并交给产品侧。"
              />
              <Textarea
                readOnly
                rows={reveal.lines.length + 1}
                value={reveal.lines.join("\n")}
                className="font-mono text-code-sm"
                onFocus={(e) => e.currentTarget.select()}
              />
              <div className="flex flex-wrap items-center gap-sm">
                <Button type="button" variant="outline" onClick={copyReveal}>
                  <Icon name="copy" size="sm" aria-hidden="true" />
                  复制全部
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setReveal(null)}
                >
                  我已保存
                </Button>
              </div>
            </div>
          ) : null}

          <div className="flex flex-col gap-md">
            <SectionHeader
              level={3}
              icon="fingerprint"
              title="登录客户端"
              description="client_secret 只在签发与轮换后明文出现一次，库里只有哈希——所以没有「查看」，只有「轮换」。轮换后旧密钥当场失效。"
            />
            {clients.length === 0 ? (
              <p className="text-body-sm text-muted-foreground">
                还没有登录客户端。在「登录接入」添加并保存后，密钥会在保存时签发。
              </p>
            ) : (
              clients.map((c) => {
                const isPublic = c.tokenEndpointAuthMethod === "none";
                return (
                  <div
                    key={c.clientId}
                    className="flex flex-wrap items-center justify-between gap-sm rounded-md border border-border p-sm"
                  >
                    <div className="flex min-w-0 flex-wrap items-center gap-sm">
                      <span className="truncate font-mono text-code-sm text-foreground">
                        {c.clientId}
                      </span>
                      <Badge variant="outline">
                        {CHANNEL_LABEL[c.releaseChannel]}
                      </Badge>
                    </div>
                    {isPublic ? (
                      <Badge variant="secondary">公共客户端 · 无密钥</Badge>
                    ) : canManage ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="md"
                        disabled={busy}
                        onClick={() => setRotateTarget(c)}
                      >
                        <Icon name="refresh" size="sm" aria-hidden="true" />
                        轮换密钥
                      </Button>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>

          <Separator />

          <form onSubmit={saveWebhookSecret} className="flex flex-col gap-md">
            <SectionHeader
              level={3}
              icon="key"
              title="Webhook 签名"
              titleSuffix={
                <StatusBadge
                  tone={webhook?.hasWebhookSecret ? "success" : "neutral"}
                  dot
                >
                  {webhook?.hasWebhookSecret ? "密钥已登记" : "密钥未登记"}
                </StatusBadge>
              }
            />
            <p className="text-body-sm text-muted-foreground">
              平台用这把密钥给发往产品的开通、停用事件签名，产品侧用同一个值验签。
            </p>
            {/* 引用是**旧路径**（引用名 → 平台容器环境变量，每接一个产品要改一次 .env），
                新产品不填。只对库里已经有引用的存量产品露出来，让它能被改或清掉。 */}
            {webhook?.webhookSecretRef ? (
              <FormField
                id="sk-ref"
                label="签名密钥引用（旧路径）"
                help="存量产品用的旧路径：引用名 → 平台容器环境变量。投递时加密密钥优先，没有才回落到它。迁到新路径后清空即可。"
              >
                <Input
                  id="sk-ref"
                  value={secretRef}
                  disabled={!canManage}
                  className="font-mono text-code-sm"
                  onChange={(e) => setSecretRef(e.target.value)}
                />
              </FormField>
            ) : null}
            <FormField
              id="sk-secret"
              label={webhook?.hasWebhookSecret ? "更换签名密钥" : "签名密钥"}
              help="至少 16 位，加密落库。已登记时留空即不更换。「生成」给一把 32 位字母数字的新密钥，保存后明文显示一次。"
            >
              <div className="flex min-w-0 items-center gap-sm">
                <Input
                  id="sk-secret"
                  type="password"
                  autoComplete="new-password"
                  value={secret}
                  disabled={!canManage}
                  placeholder={
                    webhook?.hasWebhookSecret ? "留空则不更换" : "至少 16 位"
                  }
                  className="font-mono text-code-sm"
                  onChange={(e) => setSecret(e.target.value)}
                />
                {canManage ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setSecret(generateSecret())}
                  >
                    生成
                  </Button>
                ) : null}
              </div>
            </FormField>
            {canManage ? (
              <Button type="submit" disabled={busy} className="self-start">
                {busy ? "保存中…" : "保存签名设置"}
              </Button>
            ) : null}
          </form>
        </div>
      </Drawer>

      <DialogForm
        size="sm"
        open={rotateTarget !== null}
        onOpenChange={(next) => {
          if (!next) setRotateTarget(null);
        }}
        title={rotateTarget ? `轮换 ${rotateTarget.clientId} 的密钥` : ""}
        description="旧密钥当场失效，产品侧要换上新密钥才能继续登录与换票。要过一次二次验证。"
        submitLabel="轮换"
        submitting={busy}
        onSubmit={rotate}
        cancelLabel={tShared("actions.cancel")}
      >
        {null}
      </DialogForm>
    </>
  );
}
