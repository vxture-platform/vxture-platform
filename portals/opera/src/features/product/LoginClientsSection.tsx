"use client";

/**
 * LoginClientsSection.tsx — 产品页「登录接入」板块：每个渠道一组 OIDC 客户端字段。
 * @package @vxture/opera
 * @layer Presentation
 * @category Features - Product
 *
 * owner 2026-09-14：注册客户端要填的信息整合进产品接入的新建 / 配置页面。
 *
 * 字段分三类，界面上各有各的样子——
 *  - **建后不可改**（client_id、认证方式）：新添加时是输入框，保存之后锁着、没有解锁按钮。
 *    client_id 写在产品自己的配置里，认证方式决定了有没有 client_secret；要换就新建一个渠道。
 *  - **安全边界**（登录回调、登出回跳、scopes、PKCE）：直接改，保存时服务端要求二次验证。
 *    帮助文案里写明这一点，免得运营者以为「保存又弹 TOTP」是出错了。
 *  - **展示**（展示名、logo）：直接改，不打扰。
 *
 * 密钥不在这里：client_secret 只在「密钥管理」面板里轮换。
 */

import {
  Badge,
  Button,
  Icon,
  Input,
  NativeSelect,
  StatusBadge,
  Textarea,
} from "@vxture/design-system";
import { LockedInput } from "@/components/form/LockedInput";
import { CopyableInput, FieldGrid, FormField, ToggleRow } from "./DetailForm";
import {
  CHANNEL_LABEL,
  RELEASE_CHANNELS,
  newClientDraft,
  type AuthMethod,
  type ClientDraft,
  type ClientState,
} from "./onboarding-model";

/** 输入框 id。保存失败时页面按 BFF 的 `clients[i].field` 找到它、滚过去、聚焦。 */
export function clientFieldId(index: number, field: string): string {
  return `pd-client-${index}-${field}`;
}

export interface LoginClientsSectionProps {
  readonly drafts: readonly ClientDraft[];
  readonly onChange: (next: ClientDraft[]) => void;
  /** 键是 BFF 回的 `field`（`clients[0].redirectUris` 这种）。 */
  readonly errors: Readonly<Record<string, string>>;
  readonly canManage: boolean;
  readonly productCode: string;
  readonly productName: string;
  /** 已登记（或按产品码推导）的边缘域名，只用来给占位符。 */
  readonly edgeDomain: string;
  /** 已存在客户端的启用 / 停用。新建页没有（还没有客户端可停）。 */
  readonly onToggleState?: (clientId: string, next: ClientState) => void;
  readonly busyClientId?: string | null;
}

export function LoginClientsSection({
  drafts,
  onChange,
  errors,
  canManage,
  productCode,
  productName,
  edgeDomain,
  onToggleState,
  busyClientId,
}: LoginClientsSectionProps) {
  const host =
    edgeDomain.trim() || `${productCode.trim() || "acme"}.vxture.com`;
  const missing = RELEASE_CHANNELS.filter(
    (ch) => !drafts.some((d) => d.releaseChannel === ch),
  );

  function update(index: number, patch: Partial<ClientDraft>) {
    onChange(drafts.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  }

  return (
    <div className="flex min-w-0 flex-col gap-lg">
      {drafts.length === 0 ? (
        <p className="text-body-sm text-muted-foreground">
          还没有登录客户端。要让用户用平台账号登录这个产品，先添加一个正式渠道。
        </p>
      ) : null}

      {drafts.map((d, i) => {
        const isPublic = d.tokenEndpointAuthMethod === "none";
        const err = (field: string) => errors[`clients[${i}].${field}`];
        return (
          <div
            key={d.key}
            className="flex min-w-0 flex-col gap-lg rounded-md border border-border p-md"
          >
            <div className="flex flex-wrap items-center justify-between gap-sm">
              <div className="flex min-w-0 flex-wrap items-center gap-sm">
                <Badge variant="outline">
                  {CHANNEL_LABEL[d.releaseChannel]} · {d.releaseChannel}
                </Badge>
                {d.isNew ? (
                  <StatusBadge tone="info" dot>
                    保存后签发
                  </StatusBadge>
                ) : (
                  <StatusBadge
                    tone={d.state === "active" ? "success" : "neutral"}
                    dot
                  >
                    {d.state === "active" ? "启用" : "停用"}
                  </StatusBadge>
                )}
                <Badge variant={isPublic ? "secondary" : "outline"}>
                  {isPublic ? "公共客户端" : "机密客户端"}
                </Badge>
              </div>
              {canManage ? (
                d.isNew ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="md"
                    onClick={() => onChange(drafts.filter((_, j) => j !== i))}
                  >
                    移除
                  </Button>
                ) : onToggleState ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="md"
                    disabled={busyClientId === d.clientId}
                    onClick={() =>
                      onToggleState(
                        d.clientId,
                        d.state === "active" ? "inactive" : "active",
                      )
                    }
                  >
                    {d.state === "active" ? "停用" : "启用"}
                  </Button>
                ) : null
              ) : null}
            </div>

            <FieldGrid>
              <FormField
                id={clientFieldId(i, "clientId")}
                label="client_id"
                required={d.isNew}
                error={err("clientId")}
                help={
                  d.isNew
                    ? "小写字母、数字与连字符。写进产品自己的配置，保存后不可改。"
                    : "不可改：它写在产品自己的配置里，改了产品当场登不进来。"
                }
              >
                {d.isNew ? (
                  <Input
                    id={clientFieldId(i, "clientId")}
                    value={d.clientId}
                    disabled={!canManage}
                    aria-invalid={!!err("clientId")}
                    className="font-mono text-code-sm"
                    onChange={(e) => update(i, { clientId: e.target.value })}
                  />
                ) : (
                  <LockedInput
                    id={clientFieldId(i, "clientId")}
                    locked
                    value={d.clientId}
                    className="font-mono text-code-sm"
                  />
                )}
              </FormField>

              <FormField
                id={clientFieldId(i, "tokenEndpointAuthMethod")}
                label="认证方式"
                error={err("tokenEndpointAuthMethod")}
                help="机密客户端在服务端换票、持有 client_secret；公共客户端是桌面 / 移动原生应用，没有密钥、强制 PKCE。保存后不可改。"
              >
                <NativeSelect
                  id={clientFieldId(i, "tokenEndpointAuthMethod")}
                  value={d.tokenEndpointAuthMethod}
                  disabled={!canManage || !d.isNew}
                  onChange={(e) => {
                    const next = e.target.value as AuthMethod;
                    update(i, {
                      tokenEndpointAuthMethod: next,
                      ...(next === "none" ? { pkceRequired: true } : {}),
                    });
                  }}
                >
                  <option value="client_secret_basic">机密客户端</option>
                  <option value="none">公共客户端</option>
                </NativeSelect>
              </FormField>

              <FormField
                id={clientFieldId(i, "redirectUris")}
                label="登录回调地址"
                required
                full
                error={err("redirectUris")}
                help="授权完成后浏览器被送回的地址，一行一个。必须与产品侧实现的回调逐字一致，含协议、端口与路径。改动在保存时要过一次二次验证。"
              >
                <Textarea
                  id={clientFieldId(i, "redirectUris")}
                  rows={2}
                  value={d.redirectUris}
                  disabled={!canManage}
                  aria-invalid={!!err("redirectUris")}
                  placeholder={`https://${host}/api/auth/oidc/callback`}
                  className="font-mono text-code-sm"
                  onChange={(e) => update(i, { redirectUris: e.target.value })}
                />
              </FormField>

              <FormField
                id={clientFieldId(i, "postLogoutRedirectUris")}
                label="登出回跳地址"
                full
                error={err("postLogoutRedirectUris")}
                help="登出后允许跳回的地址，一行一个。留空则登出后停在平台页面。改动在保存时要过一次二次验证。"
              >
                <Textarea
                  id={clientFieldId(i, "postLogoutRedirectUris")}
                  rows={2}
                  value={d.postLogoutRedirectUris}
                  disabled={!canManage}
                  aria-invalid={!!err("postLogoutRedirectUris")}
                  placeholder={`https://${host}/`}
                  className="font-mono text-code-sm"
                  onChange={(e) =>
                    update(i, { postLogoutRedirectUris: e.target.value })
                  }
                />
              </FormField>

              <FormField
                id={clientFieldId(i, "displayName")}
                label="展示名"
                error={err("displayName")}
                help="客户在授权页与登出页看到的名字。留空则显示 client_id。"
              >
                <Input
                  id={clientFieldId(i, "displayName")}
                  value={d.displayName}
                  disabled={!canManage}
                  onChange={(e) => update(i, { displayName: e.target.value })}
                />
              </FormField>

              <FormField
                id={clientFieldId(i, "logoUrl")}
                label="Logo 地址"
                error={err("logoUrl")}
                help="授权页与登出页展示的图标。"
              >
                <CopyableInput
                  id={clientFieldId(i, "logoUrl")}
                  value={d.logoUrl}
                  disabled={!canManage}
                  aria-invalid={!!err("logoUrl")}
                  placeholder={`https://${host}/logo.svg`}
                  className="font-mono text-code-sm"
                  onChange={(e) => update(i, { logoUrl: e.target.value })}
                />
              </FormField>

              <FormField
                id={clientFieldId(i, "allowedScopes")}
                label="Scopes"
                required
                error={err("allowedScopes")}
                help="允许申请的范围，空格分隔，必须包含 openid。改动在保存时要过一次二次验证。"
              >
                <Input
                  id={clientFieldId(i, "allowedScopes")}
                  value={d.allowedScopes}
                  disabled={!canManage}
                  aria-invalid={!!err("allowedScopes")}
                  className="font-mono text-code-sm"
                  onChange={(e) => update(i, { allowedScopes: e.target.value })}
                />
              </FormField>

              <FormField
                id={clientFieldId(i, "pkceRequired")}
                label="PKCE"
                group
                error={err("pkceRequired")}
                help={
                  isPublic
                    ? "公共客户端没有密钥，PKCE 是唯一的防护，不能关。"
                    : "OAuth 2.1 建议所有客户端都开。改动在保存时要过一次二次验证。"
                }
              >
                <ToggleRow
                  id={`${clientFieldId(i, "pkceRequired")}-switch`}
                  label="强制 PKCE"
                  checked={isPublic || d.pkceRequired}
                  disabled={!canManage || isPublic}
                  onChange={(v) => update(i, { pkceRequired: v })}
                />
              </FormField>
            </FieldGrid>
          </div>
        );
      })}

      {canManage && missing.length > 0 ? (
        <div className="flex flex-wrap items-center gap-sm">
          {missing.map((ch) => (
            <Button
              key={ch}
              type="button"
              variant="outline"
              onClick={() =>
                onChange([
                  ...drafts,
                  newClientDraft(ch, productCode, productName),
                ])
              }
            >
              <Icon name="plus" size="xs" aria-hidden="true" />
              添加{CHANNEL_LABEL[ch]}渠道
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
