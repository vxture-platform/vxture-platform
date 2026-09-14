"use client";

/**
 * LaunchDrawer.tsx — 产品页「接入检查」抽屉：复验、检查单、交给对方、确认上线。
 * @package @vxture/opera
 * @layer Presentation
 * @category Features - Product
 *
 * 2026-09-14 接管了原「产品上线」页（`/product/launch`）与目录页的「接入检查单」抽屉。
 * 那是同一件事的三处：上线页跑复验、目录抽屉勾检查单、详情页抽屉只看状态——
 * 运营者要在三个地方之间来回，才能回答「这个产品能不能上线」。
 *
 * **不跳转**（owner 2026-09-11：「切记不能跳转」）：检查项的「去处理」以 `#` 开头时是
 * 页内板块或密钥面板，交给页面就地处理；其它去处（授权页）新标签页打开。
 * 抽屉是在配置中途打开的，跳走会丢掉页面上没保存的改动。
 *
 * **确认上线先重跑**：不接受「三天前通过」——配置随时会变，拿过期的通过去上线就是让
 * 声明冒充事实。重跑全通过、且检查单必填项全满足，才把草稿转成已上线；失败不改状态。
 */

import { useState } from "react";
import {
  Badge,
  Banner,
  Button,
  Checkbox,
  Drawer,
  EmptyState,
  Icon,
  Separator,
  StatusBadge,
  useToast,
} from "@vxture/design-system";
import { isAutoDeterminedChecklistItem } from "@vxture/core-utils";
import { formatDateTime } from "@vxture-platform/shared";
import { api, OperaApiError } from "@/lib/api";
import { allPassed, runLaunchChecks, type CheckResult } from "./launch-checks";
import {
  pendingBySide,
  PRODUCT_STATE_META,
  type ProductState,
} from "./lifecycle";
import type { ClientRecord, WebhookRecord } from "./onboarding-model";

/** `GET /api/products/:id/checklist` 的一行（opera-bff `ChecklistItemRecord`）。 */
export interface ChecklistEntry {
  itemCode: string;
  itemName: string | null;
  description?: string | null;
  isRequired: boolean;
  isSatisfied: boolean;
  checkedAt: string | null;
}

export interface LaunchDrawerProduct {
  id: string;
  productCode: string;
  productName: string;
  state: ProductState;
  origin: string;
  originProvider: string | null;
}

export interface LaunchDrawerProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly product: LaunchDrawerProduct;
  readonly clients: readonly ClientRecord[];
  readonly webhook: WebhookRecord | null;
  readonly checklist: readonly ChecklistEntry[];
  readonly onChecklistChange: (next: ChecklistEntry[]) => void;
  readonly canManage: boolean;
  readonly locale: string;
  /** 「去处理」。`#` 开头的交给页面就地处理，其余由页面决定怎么打开。 */
  readonly onGoto: (href: string) => void;
  /** 上线成功之后。页面重读。 */
  readonly onLaunched: () => Promise<void>;
}

function reason(error: unknown, fallback: string): string {
  return error instanceof OperaApiError && error.message
    ? error.message
    : fallback;
}

export function LaunchDrawer({
  open,
  onClose,
  product,
  clients,
  webhook,
  checklist,
  onChecklistChange,
  canManage,
  locale,
  onGoto,
  onLaunched,
}: LaunchDrawerProps) {
  const { toast } = useToast();
  const [checks, setChecks] = useState<CheckResult[] | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [ticking, setTicking] = useState<string | null>(null);

  async function reloadChecklist(): Promise<ChecklistEntry[] | null> {
    const fresh = await api
      .get<ChecklistEntry[]>(`/api/products/${product.id}/checklist`)
      .catch(() => null);
    if (fresh) onChecklistChange(fresh);
    return fresh;
  }

  /**
   * 跑一次复验并把机器判定的几项写回检查单。
   *
   * `source: "auto"` 让 BFF 把 `checked_by` 写成 NULL（自动校验不署名），同时它拒绝人手
   * 去勾这几项——「这一项是谁说通过的」在数据里答得出来。
   */
  async function runChecks(): Promise<CheckResult[] | null> {
    setRunning(true);
    try {
      const results = await runLaunchChecks(product, { locale });
      await Promise.all(
        results
          .filter((r) => r.itemCode)
          .map((r) =>
            api
              .patch(`/api/products/${product.id}/checklist/${r.itemCode}`, {
                isSatisfied: r.status === "pass",
                remark: `自动检查：${r.detail}`,
                source: "auto",
              })
              .catch(() => undefined),
          ),
      );
      setChecks(results);
      setCheckedAt(formatDateTime(new Date(), locale));
      await reloadChecklist();
      return results;
    } catch (error) {
      toast({
        tone: "danger",
        title: "复验没跑成",
        description: reason(error, "复验没跑成"),
      });
      return null;
    } finally {
      setRunning(false);
    }
  }

  async function tick(item: ChecklistEntry, isSatisfied: boolean) {
    setTicking(item.itemCode);
    try {
      await api.patch(
        `/api/products/${product.id}/checklist/${item.itemCode}`,
        { isSatisfied },
      );
      await reloadChecklist();
    } catch (error) {
      toast({
        tone: "danger",
        title: "更新失败",
        description: reason(error, "更新失败"),
      });
    } finally {
      setTicking(null);
    }
  }

  async function confirmLaunch() {
    setLaunching(true);
    try {
      const results = await runChecks();
      if (!results) return;
      if (!allPassed(results)) {
        const failed = results.filter((r) => r.status !== "pass").length;
        toast({
          tone: "danger",
          title: `${failed} 项接入检查未通过，未上线`,
          description:
            "生命周期状态没有改变。未通过的项在上面列着，各自写着下一步。",
        });
        return;
      }
      const items = await reloadChecklist();
      if (!items) {
        toast({
          tone: "danger",
          title: "读不到接入检查单，不能确认上线",
          description: "读不到不等于通过。稍后重试。",
        });
        return;
      }
      const { ours, theirs } = pendingBySide(
        items.map((i) => ({
          itemCode: i.itemCode,
          isRequired: i.isRequired,
          isSatisfied: i.isSatisfied,
          checkedAt: i.checkedAt,
          ...(i.itemName ? { itemName: i.itemName } : {}),
        })),
      );
      const pending = ours.length + theirs.length;
      if (pending > 0) {
        toast({
          tone: "danger",
          title: `还有 ${pending} 项检查单未确认`,
          description:
            "实测项已过，但检查单里还有必填项没勾——数据面就绪与端到端验收平台观测不到，按实际情况在下面确认。",
        });
        return;
      }
      await api.patch(`/api/products/${product.id}/state`, { state: "active" });
      toast({ tone: "success", title: `${product.productName} 已上线` });
      await onLaunched();
    } catch (error) {
      toast({
        tone: "danger",
        title: "确认上线失败",
        description: reason(error, "确认上线失败"),
      });
    } finally {
      setLaunching(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="lg"
      title="接入检查"
      description={product.productCode}
    >
      <div className="flex flex-col gap-xl">
        {/* ── 复验 ─────────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-md">
          <div className="flex flex-wrap items-center justify-between gap-sm">
            <p className="text-body-sm text-muted-foreground">
              {checkedAt
                ? `最近一次：${checkedAt}`
                : "复验只读平台自己的存储——我方的配置，加上对方接通后留下的调用痕迹——不向对方端点发任何请求，可以随时重跑。"}
            </p>
            <Button
              type="button"
              variant="secondary"
              disabled={running || launching}
              onClick={() => void runChecks()}
            >
              <Icon name="refresh" size="sm" aria-hidden="true" />
              {running ? "复验中…" : checks ? "重新复验" : "跑一次复验"}
            </Button>
          </div>
          {checks?.map((c) => (
            <div
              key={c.id}
              className="flex flex-col gap-2xs rounded-md border border-border p-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-sm">
                <div className="flex flex-wrap items-center gap-sm">
                  <StatusBadge
                    tone={c.status === "pass" ? "success" : "danger"}
                    dot
                  >
                    {c.status === "pass" ? "通过" : "未通过"}
                  </StatusBadge>
                  <span className="text-label-md text-foreground">
                    {c.label}
                  </span>
                  <Badge variant="outline">
                    {c.side === "ours" ? "我方" : "对方"}
                  </Badge>
                </div>
                {c.href && c.status !== "pass" ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="md"
                    onClick={() => onGoto(c.href!)}
                  >
                    去处理
                  </Button>
                ) : null}
              </div>
              <p className="text-body-sm text-foreground">{c.detail}</p>
              {c.remedy ? (
                <p className="text-body-sm text-warning-text">
                  下一步：{c.remedy}
                </p>
              ) : null}
            </div>
          ))}
        </div>

        <Separator />

        {/* ── 检查单 ───────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-sm">
          <p className="text-label-md text-foreground">接入检查单</p>
          <p className="text-body-sm text-muted-foreground">
            带「复验判定」的几项由平台实测写入，勾不动；其余几项平台观测不到，按实际情况确认。
          </p>
          {checklist.length === 0 ? (
            <EmptyState
              title="读不到检查单"
              description="读不到不等于通过。请先解决读取失败。"
            />
          ) : (
            checklist.map((item) => {
              /* 机器判定的项不给勾。BFF 也会拒（409），这里灰掉是为了让人在点之前
                 就知道——一个点得下去然后报错的框，等于让人白跑一趟。 */
              const auto = isAutoDeterminedChecklistItem(item.itemCode);
              return (
                <div
                  key={item.itemCode}
                  className="flex items-start gap-sm rounded-md border border-border p-sm"
                >
                  <Checkbox
                    checked={item.isSatisfied}
                    disabled={!canManage || auto || ticking !== null}
                    aria-label={item.itemName ?? item.itemCode}
                    onCheckedChange={(checked) =>
                      void tick(item, checked === true)
                    }
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-2xs">
                    <div className="flex flex-wrap items-center gap-sm">
                      <span className="text-body-md text-foreground">
                        {item.itemName ?? item.itemCode}
                      </span>
                      {item.isRequired ? (
                        <Badge variant="outline">必需</Badge>
                      ) : null}
                      {auto ? (
                        <Badge variant="secondary">复验判定</Badge>
                      ) : null}
                    </div>
                    {item.description ? (
                      <span className="text-body-sm text-muted-foreground">
                        {item.description}
                      </span>
                    ) : null}
                    {item.checkedAt ? (
                      <span className="text-body-sm text-muted-foreground">
                        {formatDateTime(item.checkedAt, locale)} 确认
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <Separator />

        {/* ── 交给对方 ─────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-sm">
          <p className="text-label-md text-foreground">交给对方</p>
          <p className="text-body-sm text-muted-foreground">
            接入是双边的：平台侧配完之后，下面这些要发给产品侧。密钥不在这里——它们只在签发与轮换时明文出现一次。
          </p>
          <HandoverRow
            term="产品码"
            value={product.productCode}
            note="授权主体，也是 S2S 令牌的 act.sub。"
          />
          <HandoverRow
            term="client_id"
            value={
              clients.length > 0
                ? clients
                    .map((c) => `${c.clientId}（${c.releaseChannel}）`)
                    .join("、")
                : "尚未添加"
            }
            note="在「登录接入」添加；client_secret 在保存或轮换时明文显示一次。"
          />
          <HandoverRow
            term="登录回调地址"
            value={
              clients.flatMap((c) => c.redirectUris).join("、") || "尚未配置"
            }
            note="产品侧实现的回调要与这里逐字一致，否则授权会被拒。"
          />
          <HandoverRow
            term="Webhook 回调地址"
            value={webhook?.webhookUrl ?? "尚未配置"}
            note="产品侧按这个地址收开通与停用事件；签名密钥在「密钥管理」。"
          />
        </div>

        {/* ── 终点动作 ─────────────────────────────────────────────────── */}
        {product.state === "draft" ? (
          <Banner
            tone="info"
            title="确认上线会先重跑一遍复验"
            description="重跑全通过、且检查单必填项全部满足，才会把草稿转成已上线。失败不改状态。"
            {...(canManage
              ? {
                  action: (
                    <Button
                      type="button"
                      disabled={running || launching}
                      onClick={() => void confirmLaunch()}
                    >
                      <Icon name="rocket" size="sm" aria-hidden="true" />
                      {launching ? "检查中…" : "确认上线"}
                    </Button>
                  ),
                }
              : {})}
          />
        ) : (
          <Banner
            tone="info"
            title={`当前是「${PRODUCT_STATE_META[product.state].label}」，这里只做复验`}
            description={
              product.state === "active"
                ? "对方改过配置、或密钥轮换后应当跑一次。复验失败不会自动停用——自动停用一个正在跑的产品，是把监测信号变成破坏性动作。要停由人在页头的生命周期菜单里停。"
                : PRODUCT_STATE_META[product.state].hint
            }
          />
        )}
      </div>
    </Drawer>
  );
}

function HandoverRow({
  term,
  value,
  note,
}: {
  readonly term: string;
  readonly value: string;
  readonly note: string;
}) {
  return (
    <div className="flex flex-col gap-2xs rounded-md border border-border p-sm">
      <span className="text-label-md text-foreground">{term}</span>
      <span className="break-all font-mono text-code-sm text-foreground">
        {value}
      </span>
      <span className="text-body-sm text-muted-foreground">{note}</span>
    </div>
  );
}
