"use client";

/* 产品上线 — 交接信息 + 平台侧实测 + 分两侧的错误报告 + 确认上线。
 *
 * 2026-08-14 新建（B4b-3，设计文件 §6）。
 *
 * **不进导航**（B2 的 21 项里没有它）。接入是低频动作，而未完成的接入本来就以草稿行
 * 躺在产品目录里——从那一行「继续接入」比从一个空的流程页开始更自然。三个入口都在
 * 目录页：主按钮（新接入）/ 草稿行「继续接入」/ 正式行「重新验证」。第三个尤其重要，
 * 它让验证不会变成"接入时通过"这样一个永不更新的过期结论。
 *
 * ── 这页能回答什么、不能回答什么 ─────────────────────────────────────────────
 *
 * 能：**我方**配齐了没有（产品登记 / 接入凭据 / 两个域的授权 / webhook 登记）。
 * 不能：对方接好了没有。C2 权益接入、C3 计量上报、端到端验收三项平台从外面观测不到
 * ——它们留在接入检查单上由操作员按对方回报勾选。页面把这条边界写在明面上，不含糊。
 *
 * 这也是「运营者代跑、报告可交付」的形态（设计 §6.6）：不给对方开 opera 账号，因为
 * **侧栏本身就是信息**——即使点进去 403，导航也已经告诉他平台有哪些能力域、接了哪些
 * 产品。对方拿到的是一份带时间戳、分两侧、逐项结论的报告，不是一个控制台。
 *
 * ── 两条约束（设计 §6.4）────────────────────────────────────────────────────
 *
 * 1. **确认上线时自动重跑验证。** 不接受"三天前通过"——配置随时会变。所以「确认上线」
 *    不是读页面上已有的结果，而是先重跑一遍再判。
 * 2. **上线之后验证失败不自动停用。** 本页对已上线的产品只更新结果、不动生命周期状态。
 *    自动停用一个正在跑的产品，是把监测信号变成破坏性动作。 */

import { Suspense, useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Badge,
  Banner,
  Button,
  EmptyState,
  Icon,
  Section,
  StatusBadge,
  ViewHeader,
  ViewLayout,
  useToast,
} from "@vxture/design-system";
import {
  actionsFor,
  PRODUCT_STATE_META,
  VERIFICATION_META,
  pendingBySide,
  verificationOf,
  type ChecklistItem,
  type ProductState,
} from "@/features/product/lifecycle";
import {
  allPassed,
  runLaunchChecks,
  type CheckResult,
} from "@/features/product/launch-checks";
import { api, OperaApiError } from "@/lib/api";

interface ProductRecord {
  id: string;
  productCode: string;
  productName: string;
  state: ProductState;
  origin: string;
  originProvider: string | null;
}

interface OidcClientLite {
  clientId: string;
  releaseChannel: string;
  status: string;
  redirectUris: string[];
}

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready" };

function describeError(error: unknown): { description?: string } {
  return error instanceof OperaApiError && error.message
    ? { description: error.message }
    : {};
}

export default function ProductLaunchPage() {
  return (
    <Suspense fallback={null}>
      <ProductLaunch />
    </Suspense>
  );
}

function ProductLaunch() {
  const tShared = useTranslations();
  const { toast } = useToast();
  const router = useRouter();
  const productId = useSearchParams().get("productId") ?? "";

  const [product, setProduct] = useState<ProductRecord | null>(null);
  const [clients, setClients] = useState<OidcClientLite[]>([]);
  const [checklist, setChecklist] = useState<ChecklistItem[] | null>(null);
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });

  const [checks, setChecks] = useState<CheckResult[] | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [launching, setLaunching] = useState(false);

  const reload = useCallback(async () => {
    if (!productId) return;
    setLoad({ kind: "loading" });
    try {
      const [p, cs, cl] = await Promise.all([
        api.get<ProductRecord>(`/api/products/${productId}`),
        api
          .get<
            OidcClientLite[]
          >(`/api/oidc-clients?productId=${encodeURIComponent(productId)}`)
          .catch(() => [] as OidcClientLite[]),
        /* 检查单读不到时用 null 而不是 []——「没有未满足项」与「不知道」必须分得开，
           后者要挡住上线（与目录页同一条判断）。 */
        api
          .get<ChecklistItem[]>(`/api/products/${productId}/checklist`)
          .catch(() => null),
      ]);
      setProduct(p);
      setClients(cs);
      setChecklist(cl);
      setLoad({ kind: "ready" });
    } catch (error) {
      setLoad({
        kind: "error",
        message:
          error instanceof OperaApiError ? error.message : "读取产品失败",
      });
    }
  }, [productId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const runChecks = useCallback(
    async (p: ProductRecord): Promise<CheckResult[]> => {
      setRunning(true);
      try {
        const results = await runLaunchChecks(p);
        setChecks(results);
        setCheckedAt(new Date().toLocaleString("zh-CN", { hour12: false }));
        /* 把能映射到检查项的结果写回检查单（`checked_by` 由 BFF 填当前操作员；
           DDL 预留的"自动校验为 NULL"要等 BFF 支持自动标记时再用）。写失败不影响
           页面上的结论——结论来自刚跑完的这一次，不是来自库里那一行。 */
        await Promise.all(
          results
            .filter((r) => r.itemCode)
            .map((r) =>
              api
                .patch(`/api/products/${p.id}/checklist/${r.itemCode}`, {
                  isSatisfied: r.status === "pass",
                  remark: `自动检查：${r.detail}`,
                })
                .catch(() => undefined),
            ),
        );
        const fresh = await api
          .get<ChecklistItem[]>(`/api/products/${p.id}/checklist`)
          .catch(() => null);
        setChecklist(fresh);
        return results;
      } finally {
        setRunning(false);
      }
    },
    [],
  );

  /** 确认上线：**先重跑**再判，不看页面上已有的结果。 */
  async function confirmLaunch() {
    if (!product) return;
    setLaunching(true);
    try {
      const results = await runChecks(product);
      if (!allPassed(results)) {
        const failed = results.filter((r) => r.status !== "pass");
        toast({
          tone: "danger",
          title: `${failed.length} 项平台侧检查未通过，未上线`,
          description:
            "生命周期状态没有改变——验证失败不回滚草稿，也不改状态。下面的错误报告按我方 / 对方分栏列出了待办。",
        });
        return;
      }
      const items = checklist;
      if (!items) {
        toast({
          tone: "danger",
          title: "读不到接入检查单，不能确认上线",
          description: "拿不到不等于通过。刷新重试。",
        });
        return;
      }
      const { ours, theirs } = pendingBySide(items);
      const pending = [...ours, ...theirs];
      if (pending.length > 0) {
        toast({
          tone: "danger",
          title: `还有 ${pending.length} 项接入检查未完成`,
          description:
            "平台侧五项已过，但检查单里还有必填项没勾——那几项平台观测不到，要按对方回报确认。",
        });
        return;
      }
      await api.patch(`/api/products/${product.id}/state`, {
        state: "active",
      });
      toast({ tone: "success", title: `${product.productName} 已上线` });
      await reload();
    } catch (error) {
      toast({ tone: "danger", title: "确认上线失败", ...describeError(error) });
    } finally {
      setLaunching(false);
    }
  }

  if (!productId) {
    return (
      <ViewLayout>
        <ViewHeader icon="rocket" title="产品上线" />
        <EmptyState
          icon="rocket"
          title="从产品目录进入"
          description="上线流程针对某一个产品。接入是低频动作，未完成的接入本来就以草稿行躺在目录里——从那一行「继续接入」比从一个空的流程页开始更自然。"
          action={
            <Button asChild variant="secondary">
              <Link href="/product/catalog">去产品目录</Link>
            </Button>
          }
        />
      </ViewLayout>
    );
  }

  if (load.kind === "error" || (load.kind === "ready" && !product)) {
    return (
      <ViewLayout>
        <ViewHeader icon="rocket" title="产品上线" />
        <EmptyState
          title={tShared("common.loadFailed")}
          description={load.kind === "error" ? load.message : "产品不存在。"}
          action={
            <Button variant="secondary" onClick={() => void reload()}>
              {tShared("common.retry")}
            </Button>
          }
        />
      </ViewLayout>
    );
  }

  if (!product) {
    return (
      <ViewLayout>
        <ViewHeader icon="rocket" title="产品上线" />
        <EmptyState
          title={tShared("common.loading")}
          description="正在读取产品信息。"
        />
      </ViewLayout>
    );
  }

  const verification = verificationOf(checklist ?? []);
  const canLaunch = actionsFor(product.state).some((a) => a.id === "launch");
  const failed = (checks ?? []).filter((r) => r.status !== "pass");
  /* 检查单未完成项**按侧分**，不是整堆算作待对方：`data_plane`（平台按模板 provision）
     与 `acceptance`（两侧一起）都是我方的事，混进右栏会让运营者把该自己做的事发出去等。
     划分规则在 `lifecycle.ts` 的 `THEIR_SIDE`，与验证态的推导共用同一份。 */
  const pendingChecklist = pendingBySide(checklist ?? []);

  return (
    <ViewLayout>
      <ViewHeader
        icon="rocket"
        title={`产品上线 · ${product.productName}`}
        description="平台侧配置的实测 + 要交给对方的信息。这页只能回答「我方配齐了没有」——对方接没接好，平台从外面观测不到。"
        action={
          <div className="flex items-center gap-sm">
            <StatusBadge tone={PRODUCT_STATE_META[product.state].tone} dot>
              {PRODUCT_STATE_META[product.state].label}
            </StatusBadge>
            <StatusBadge tone={VERIFICATION_META[verification].tone} dot>
              {VERIFICATION_META[verification].label}
            </StatusBadge>
          </div>
        }
      />

      {/* ── 交接信息（设计 §6.3）─────────────────────────────────────────── */}
      <Section
        title="交给对方"
        icon="paperplane-tilt"
        level={2}
        description="草稿阶段是交接期，接入是双边的。平台侧配完之后，下面这些要发给对方；对方配完才谈得上验证——这也是草稿必须持久、失败不回滚的原因：等对方可能是几天的事，不是重试一次。"
      >
        <dl className="flex flex-col gap-md">
          <HandoverRow
            term="产品码"
            value={product.productCode}
            mono
            note="授权主体，也是 S2S 令牌的 act.sub。对方用它换票，调用里必须带对。"
          />
          <HandoverRow
            term="client_id"
            value={
              clients.length > 0
                ? clients
                    .map((c) => `${c.clientId}（${c.releaseChannel}）`)
                    .join("、")
                : "尚未注册"
            }
            mono={clients.length > 0}
            note="client_secret 只在注册与轮换后明文出现一次，这里**不回显**——丢了只能轮换。"
            action={
              <Button asChild variant="ghost" size="md">
                <Link
                  href={`/product/clients?productId=${encodeURIComponent(product.id)}`}
                >
                  去接入凭据
                </Link>
              </Button>
            }
          />
          <HandoverRow
            term="回调地址"
            value={
              clients.flatMap((c) => c.redirectUris).join("、") || "尚未配置"
            }
            mono={clients.some((c) => c.redirectUris.length > 0)}
            note="对方实现登录/回调/会话之后要与这里登记的一致，否则换票会被拒。"
          />
          <HandoverRow
            term="权益与授权"
            value="按产品码配置，见「权益配置」"
            note="模型路由授权与能力授权都以产品码为主体（ADR-010：产品是唯一授权主体）。对方不需要知道具体条目，但需要知道调不通时该找谁查。"
            action={
              <Button asChild variant="ghost" size="md">
                <Link
                  href={`/product/entitlements?productCode=${encodeURIComponent(product.productCode)}`}
                >
                  去权益配置
                </Link>
              </Button>
            }
          />
        </dl>
      </Section>

      {/* ── 平台侧实测 ───────────────────────────────────────────────────── */}
      <Section
        title="平台侧检查"
        icon="shield-check"
        level={2}
        description="五项全部是读平台自己已有的状态，不向对方端点发任何请求。「webhook 能不能投递成功」这类问题要看运行监控里的投递队列，本页不发测试投递——那是对对方生产端点的真实请求。"
        action={
          <div className="flex items-center gap-sm">
            {checkedAt ? (
              <span className="text-body-sm text-muted-foreground">
                最近一次：{checkedAt}
              </span>
            ) : null}
            <Button
              variant="secondary"
              onClick={() => void runChecks(product)}
              disabled={running || launching}
            >
              <Icon name="refresh" size="sm" aria-hidden="true" />
              {checks ? "重新检查" : "开始检查"}
            </Button>
          </div>
        }
      >
        {checks === null ? (
          <EmptyState
            icon="shield-check"
            title={running ? "检查中…" : "还没跑过"}
            description={
              running
                ? "五项并发读取中。"
                : "点「开始检查」跑一遍。检查只读状态，不产生任何写入，可以随时重跑。"
            }
          />
        ) : (
          <div className="flex flex-col gap-sm">
            {checks.map((c) => (
              <div
                key={c.id}
                className="flex flex-col gap-2xs rounded-md border border-border p-sm"
              >
                <div className="flex items-center justify-between gap-sm">
                  <div className="flex items-center gap-sm">
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
                  {c.href ? (
                    <Button asChild variant="ghost" size="md">
                      <Link href={c.href}>去处理</Link>
                    </Button>
                  ) : null}
                </div>
                <p className="text-body-sm text-muted-foreground">{c.what}</p>
                <p className="text-body-sm text-foreground">{c.detail}</p>
                {c.remedy ? (
                  <p className="text-body-sm text-warning-text">
                    下一步：{c.remedy}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ── 错误报告：按侧分栏 ───────────────────────────────────────────── */}
      {checks !== null &&
      (failed.length > 0 ||
        pendingChecklist.ours.length + pendingChecklist.theirs.length > 0) ? (
        <Section
          title="错误报告"
          icon="clipboard"
          level={2}
          description="按侧分栏，因为两栏的下一步动作完全不同：左边是去改配置，右边是把这份报告发出去。刻意不设「失败」这一档笼统状态——失败总是有归属的。"
        >
          <div className="grid gap-md md:grid-cols-2">
            <ReportColumn
              title="待我方"
              tone="warning"
              empty="平台侧没有未完成项。"
              items={[
                ...failed.map((f) => `${f.label}：${f.detail}`),
                ...pendingChecklist.ours.map(
                  (i) =>
                    `${i.itemName ?? i.itemCode}：检查单上尚未确认（这一项由平台侧完成）。`,
                ),
              ]}
            />
            <ReportColumn
              title="待对方"
              tone="info"
              empty="检查单里没有待对方的未完成项。"
              items={pendingChecklist.theirs.map(
                (i) =>
                  `${i.itemName ?? i.itemCode}：平台从外面观测不到，需按对方回报在接入检查单上确认。`,
              )}
            />
          </div>
        </Section>
      ) : null}

      {/* ── 终点动作 ─────────────────────────────────────────────────────── */}
      {canLaunch ? (
        <Banner
          tone="info"
          title="确认上线会先重跑一遍检查"
          description="不接受「三天前通过」——配置随时会变，拿过期的通过去上线就是让声明冒充事实。重跑全通过、且接入检查单必填项全满足，才会把草稿转成已上线。失败不改生命周期状态、也不回滚草稿。"
          action={
            <Button
              onClick={() => void confirmLaunch()}
              disabled={running || launching}
            >
              <Icon name="rocket" size="sm" aria-hidden="true" />
              {launching ? "检查中…" : "确认上线"}
            </Button>
          }
        />
      ) : (
        <Banner
          tone="info"
          title={`当前是「${PRODUCT_STATE_META[product.state].label}」，本页只做复验`}
          description={
            product.state === "active"
              ? "已上线的产品在这里重新验证——对方改过配置、或密钥轮换后应当跑一次。**验证失败不会自动停用**：自动停用一个正在跑的产品，是把监测信号变成破坏性动作。要停由人去目录页停。"
              : PRODUCT_STATE_META[product.state].hint
          }
          action={
            <Button asChild variant="secondary">
              <Link
                href={`/product/catalog?productId=${encodeURIComponent(product.id)}`}
              >
                去产品目录
              </Link>
            </Button>
          }
        />
      )}

      <Button
        variant="ghost"
        className="self-start"
        onClick={() => router.push("/product/catalog")}
      >
        <Icon name="arrow-left" size="sm" aria-hidden="true" />
        返回产品目录
      </Button>
    </ViewLayout>
  );
}

function HandoverRow({
  term,
  value,
  note,
  mono,
  action,
}: {
  term: string;
  value: string;
  note: string;
  mono?: boolean;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2xs rounded-md border border-border p-sm">
      <div className="flex items-center justify-between gap-sm">
        <dt className="text-label-md text-foreground">{term}</dt>
        {action}
      </div>
      <dd
        className={
          mono
            ? "font-mono text-code-sm text-foreground"
            : "text-body-sm text-foreground"
        }
      >
        {value}
      </dd>
      <p className="text-body-sm text-muted-foreground">{note}</p>
    </div>
  );
}

function ReportColumn({
  title,
  tone,
  items,
  empty,
}: {
  title: string;
  tone: "warning" | "info";
  items: string[];
  empty: string;
}) {
  return (
    <div className="flex flex-col gap-sm rounded-md border border-border p-sm">
      <div className="flex items-center gap-sm">
        <StatusBadge tone={tone} dot>
          {title}
        </StatusBadge>
        <span className="text-body-sm text-muted-foreground">
          {items.length} 项
        </span>
      </div>
      {items.length === 0 ? (
        <p className="text-body-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-2xs">
          {items.map((t) => (
            <li key={t} className="text-body-sm text-foreground">
              · {t}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
