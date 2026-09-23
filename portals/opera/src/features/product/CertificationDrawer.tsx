"use client";

/**
 * CertificationDrawer.tsx —— 产品页「接入认证」抽屉。
 *
 * ── 它和「接入检查」抽屉是两件事 ──
 *
 * `LaunchDrawer` 回答的是**上线门**：平台侧配了没有、对方接通了没有。那道门在
 * `draft → active` 上卡着，判据是该产品的**任意**流量。
 *
 * 这里回答的是**发布门**：在一个沙箱里，整条链**这一次**跑通了没有。判据按本次认证的
 * 沙箱工作区收口——不收口的话，A 客户的真实使用会把 B 产品的认证喂绿，而那是静默的。
 *
 * 两者顺序是先上线后认证：上线门证的是「对方接通了」，认证证的是「整条链跑得通」。
 * 颠倒过来，认证会在对方还没实现任何接口时去等五段痕迹，白等一场。
 *
 * ── 为什么这一屏要让人选一个套餐版本 ──
 *
 * 认证订阅指向**待发布的那个草稿版本本身**，不另造认证套餐：认证的对象与发布的对象
 * 字节相同，而且顺带跑一遍配额池物化——套餐组件配错会在认证时炸，不带上线。
 *
 * 版本是商业侧（admin）的东西，运营在这一屏手上没有那个 id。所以候选由 BFF 列出来供
 * 选择，而不是让人在两个门户之间抄 uuid：抄错了不会报错，只会认到另一版上去。
 *
 * ── 两个按钮各做什么，别混 ──
 *
 *   发起认证  供给沙箱工作区 → 建一条指向该草稿版本的认证订阅（平台由此发出开通与
 *             回调）→ 开一条 running 的台账。**这一步会产生真实的开通事件**。
 *   判定      只读：按本次认证的沙箱收口读五段痕迹，齐了就落 certified。
 *             缺段**不判失败**——缺段几乎总是「对方还没调」，而那不由平台决定。
 */

import { useCallback, useEffect, useState } from "react";
import {
  Banner,
  Button,
  Drawer,
  Icon,
  NativeSelect,
  SectionHeader,
  Separator,
  StatusBadge,
  useToast,
  type StatusBadgeTone,
} from "@vxture/design-system";
import { formatDateTime } from "@vxture-platform/shared";
import { api, OperaApiError } from "@/lib/api";

interface CertificationRun {
  id: string;
  productId: string;
  contractVersion: string;
  sandboxWorkspaceId: string;
  sandboxWorkspaceNo: string | null;
  planVersionId: string | null;
  componentFingerprint: string | null;
  segments: Record<string, boolean>;
  verdict: string;
  staleReason: string | null;
  certifiedAt: string | null;
  createdAt: string;
}

interface Candidate {
  planVersionId: string;
  planCode: string;
  planName: string;
  versionNo: number;
  tier: string | null;
}

export interface CertificationDrawerProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly productId: string;
  readonly productCode: string;
  readonly canManage: boolean;
  readonly locale?: string;
}

/**
 * 五段的顺序就是链的顺序。展示顺序与判定顺序一致，运营才能一眼看出「卡在哪一步」
 * ——乱序摆的话，缺的那一段在视觉上没有位置感。
 */
const SEGMENTS: { key: string; label: string; who: string }[] = [
  { key: "login", label: "登录", who: "人" },
  { key: "provision", label: "开通", who: "平台" },
  { key: "delivery", label: "回调投递", who: "平台" },
  { key: "entitlement", label: "权益拉取", who: "对方" },
  { key: "consume", label: "用量上报", who: "对方" },
];

/**
 * 失效原因的人话。认不得的值原样显示那个码——没登记正是要看见的事。
 *
 * 这里**没有**「上游授权被撤销」：那不是契约变更，认证那句「T 时刻这条链跑通过」
 * 仍然成立，断的是运行时——该由运行健康报 degraded，不是把一张历史证书涂掉。
 */
const STALE_LABEL: Record<string, string> = {
  webhook_changed: "回调地址变更",
  secret_rotated: "签名密钥轮换",
  redirect_uri_changed: "回调 URI 变更",
  contract_version_bumped: "接入通则契约升版",
  components_changed: "套餐组件改过",
};

function reason(error: unknown, fallback: string): string {
  return error instanceof OperaApiError ? error.message : fallback;
}

export function CertificationDrawer({
  open,
  onClose,
  productId,
  productCode,
  canManage,
  locale,
}: CertificationDrawerProps) {
  const { toast } = useToast();
  const [effective, setEffective] = useState<CertificationRun | null>(null);
  const [latest, setLatest] = useState<CertificationRun | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [picked, setPicked] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<null | "run" | "evaluate">(null);
  const [loadFailed, setLoadFailed] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(null);
    try {
      const [cert, cand] = await Promise.all([
        api.get<{
          effective: CertificationRun | null;
          latest: CertificationRun | null;
        }>(`/api/products/${productId}/certification`),
        api.get<Candidate[]>(
          `/api/products/${productId}/certification/candidates`,
        ),
      ]);
      setEffective(cert.effective);
      setLatest(cert.latest);
      setCandidates(cand);
      /* 默认选第一个候选，但**不替人做决定**：只有一个候选时它就是答案，
         多个时运营仍然看得见自己选的是哪一个。 */
      setPicked((prev) => prev || (cand[0]?.planVersionId ?? ""));
    } catch (error) {
      /* 读不到就说读不到，别把空结果显示成「未认证」——后者是一个确定的结论，
         而我们此刻什么都不知道。 */
      setLoadFailed(reason(error, "读取认证状态失败"));
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  async function startRun() {
    if (!picked) return;
    setBusy("run");
    try {
      await api.post(`/api/products/${productId}/certification/run`, {
        planVersionId: picked,
      });
      toast({
        tone: "success",
        title: "认证已发起",
        description:
          "沙箱已开通，平台侧的开通与回调已经发出。接下来要对方在沙箱里拉一次权益、报一次用量，再回来点「判定」。",
      });
      await load();
    } catch (error) {
      toast({
        tone: "danger",
        title: "认证没发起来",
        description: reason(error, "认证没发起来"),
      });
    } finally {
      setBusy(null);
    }
  }

  async function runEvaluate() {
    setBusy("evaluate");
    try {
      const out = await api.post<CertificationRun>(
        `/api/products/${productId}/certification/evaluate`,
      );
      const missing = SEGMENTS.filter((s) => !out.segments[s.key]).map(
        (s) => s.label,
      );
      toast({
        tone: out.verdict === "certified" ? "success" : "info",
        title: out.verdict === "certified" ? "认证通过" : "还差几段",
        description:
          out.verdict === "certified"
            ? "这个产品现在可以发布套餐了。"
            : `还缺：${missing.join("、")}。缺段通常是对方还没调——这不是失败。`,
      });
      await load();
    } catch (error) {
      toast({
        tone: "danger",
        title: "判定没跑成",
        description: reason(error, "判定没跑成"),
      });
    } finally {
      setBusy(null);
    }
  }

  const headline = ((): {
    label: string;
    tone: StatusBadgeTone;
    hint: string;
  } => {
    if (loadFailed)
      return { label: "读取失败", tone: "danger", hint: loadFailed };
    if (loading && !latest)
      return { label: "读取中", tone: "neutral", hint: "正在读认证状态…" };
    if (effective)
      return {
        label: "已认证",
        tone: "success",
        hint: `认证于 ${formatDateTime(new Date(effective.certifiedAt ?? effective.createdAt), locale)}，契约版本 ${effective.contractVersion}。可以发布套餐。`,
      };
    if (latest?.staleReason)
      return {
        label: "待复认证",
        tone: "warning",
        hint: `${STALE_LABEL[latest.staleReason] ?? latest.staleReason}。已上线的产品不受影响，但再发布新版本前要重跑一次认证。`,
      };
    if (latest?.verdict === "running")
      return {
        label: "认证中",
        tone: "info",
        hint: "沙箱已开通。等对方在沙箱里拉权益、报用量之后，回来点「判定」。",
      };
    return {
      label: "未认证",
      tone: "neutral",
      hint: "这个产品还没跑过接入认证，所以发布套餐会被拦下。",
    };
  })();

  const segments = latest?.segments ?? {};

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="lg"
      title="接入认证"
      description={productCode}
    >
      <div className="flex flex-col gap-xl">
        {/* ── 结论 ──────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-2xs">
          <div className="flex items-center gap-sm">
            <StatusBadge tone={headline.tone}>{headline.label}</StatusBadge>
            {latest ? (
              /* 可视码，不是那个 uuid。工作区被清理之后码取不到——那时显示「未知」，
               **不退回 id**：裸 UUID 上屏在任何场景下都不行，内部页面也不例外。 */
              <span className="text-body-sm text-muted-foreground">
                沙箱工作区 {latest.sandboxWorkspaceNo ?? "未知"}
              </span>
            ) : null}
          </div>
          <p className="text-body-sm text-muted-foreground">{headline.hint}</p>
        </div>

        {loadFailed ? (
          <Banner
            tone="danger"
            title="读不到认证状态"
            description={loadFailed}
          />
        ) : null}

        {/* ── 五段 ──────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-sm">
          <SectionHeader
            level={3}
            icon="link"
            title="链路五段"
            description="按本次认证的沙箱工作区收口——别的租户的流量不算数。"
          />
          {latest ? (
            SEGMENTS.map((s) => (
              <div
                key={s.key}
                className="flex items-center justify-between gap-sm border-b border-border py-2xs last:border-b-0"
              >
                <div className="flex min-w-0 items-center gap-sm">
                  <StatusBadge tone={segments[s.key] ? "success" : "neutral"}>
                    {segments[s.key] ? "已发生" : "未发生"}
                  </StatusBadge>
                  <span className="text-label-md text-foreground">
                    {s.label}
                  </span>
                </div>
                <span className="text-body-sm text-muted-foreground">
                  由{s.who}触发
                </span>
              </div>
            ))
          ) : (
            <p className="text-body-sm text-muted-foreground">
              还没发起过认证，五段都没有记录。
            </p>
          )}
        </div>

        <Separator />

        {/* ── 发起 ──────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-sm">
          <SectionHeader
            level={3}
            icon="rocket"
            title="发起认证"
            description="认证针对一个待发布的草稿版本——认的对象与将来发布的对象是同一个。"
          />
          {candidates.length === 0 ? (
            /* 没有候选不是错误，是「还没建草稿版本」。说清楚下一步在哪，
               而不是给一个点不动的按钮。 */
            <Banner
              tone="info"
              title="这个产品还没有草稿版本"
              description="认证针对待发布的草稿版本。先去 admin 的产品套餐页建一版草稿，再回来发起。"
            />
          ) : (
            <div className="flex flex-wrap items-end gap-sm">
              <NativeSelect
                aria-label="待认证的套餐版本"
                wrapperClassName="w-fit"
                value={picked}
                onChange={(e) => setPicked(e.target.value)}
                disabled={!canManage || busy !== null}
              >
                {candidates.map((c) => (
                  <option key={c.planVersionId} value={c.planVersionId}>
                    {c.planCode} v{c.versionNo}
                    {c.tier ? ` · ${c.tier}` : ""} —— {c.planName}
                  </option>
                ))}
              </NativeSelect>
              <Button
                type="button"
                variant="default"
                disabled={!canManage || !picked || busy !== null}
                onClick={() => void startRun()}
              >
                <Icon name="rocket" size="sm" aria-hidden="true" />
                {busy === "run" ? "发起中…" : "发起认证"}
              </Button>
            </div>
          )}
          <p className="text-body-sm text-muted-foreground">
            发起会在沙箱里真的开通一次并发出回调。登录那一段要有人用沙箱账号走一遍真实登录
            ——那是判据最硬的一段，它蕴含对方的登录实现是完整的。
          </p>
        </div>

        {/* ── 判定 ──────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-between gap-sm">
          <p className="text-body-sm text-muted-foreground">
            判定只读，不改任何东西；缺段不算失败，可以隔一会儿再点。
          </p>
          <Button
            type="button"
            variant="secondary"
            disabled={
              !canManage || busy !== null || latest?.verdict !== "running"
            }
            onClick={() => void runEvaluate()}
          >
            <Icon name="refresh" size="sm" aria-hidden="true" />
            {busy === "evaluate" ? "判定中…" : "判定"}
          </Button>
        </div>
      </div>
    </Drawer>
  );
}
