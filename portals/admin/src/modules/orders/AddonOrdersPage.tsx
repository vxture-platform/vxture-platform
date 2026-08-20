"use client";

/**
 * AddonOrdersPage.tsx — 加油包订单核销(运营端,owner 2026-08-20 用量配额线)。
 * 待处理队列(已申报优先):客户线下转账申报后,运营在此确认收款——确认即
 * 一事务完成 支付腿翻转 + 账单结清 + WS 级配额池授予 + 单据完结。
 * 确认收款为危操作(commerce:payment.settle + step-up),必须经 runWithStepUp
 * 包裹(TD-027 前端包裹点清单成员;OrdersPage 列表页漏包是已知反例,勿抄)。
 */

import { useCallback, useEffect, useState } from "react";
import {
  Banner,
  Button,
  DataTable,
  EmptyState,
  StatusBadge,
} from "@vxture/design-system";
import type { DataTableColumn } from "@vxture/design-system";
import {
  confirmAddonOrderPayment,
  fetchAddonOrders,
  type AddonOrderOperationRecord,
} from "@/api/admin-bff";
import { isStepUpCancelled, useStepUp } from "@/providers/StepUpProvider";
import { PageHeader } from "@/modules/shared/PageHeader";
import { formatDate } from "@/modules/tenants/tenant-utils";

function money(yuan: string, currency: string): string {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: currency || "CNY",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.parseFloat(yuan || "0"));
}

export function AddonOrdersPage() {
  const { runWithStepUp } = useStepUp();
  const [orders, setOrders] = useState<AddonOrderOperationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setOrders(await fetchAddonOrders());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void reload().finally(() => setLoading(false));
  }, [reload]);

  const handleConfirm = async (order: AddonOrderOperationRecord) => {
    setError(null);
    setNotice(null);
    setBusyId(order.id);
    try {
      const result = await runWithStepUp(() =>
        confirmAddonOrderPayment(order.id),
      );
      setNotice(
        result.settled
          ? `已确认收款并入池:${order.orderNo}(${order.packName})`
          : `订单 ${order.orderNo} 已是完结状态(重复确认已忽略)`,
      );
      await reload();
    } catch (e) {
      if (isStepUpCancelled(e)) return;
      setError(e instanceof Error ? e.message : "确认收款失败");
    } finally {
      setBusyId(null);
    }
  };

  const columns: DataTableColumn<AddonOrderOperationRecord>[] = [
    {
      id: "order",
      header: "订单",
      cell: (o) => (
        <span className="flex flex-col">
          <span className="font-mono text-label-md text-foreground">
            {o.orderNo}
          </span>
          <span className="text-body-sm text-muted-foreground tabular-nums">
            {formatDate(o.createdAt)}
          </span>
        </span>
      ),
    },
    {
      id: "pack",
      header: "加油包",
      cell: (o) => (
        <span className="flex flex-col">
          <span className="text-foreground">{o.packName}</span>
          <span className="font-mono text-body-sm text-muted-foreground">
            {o.packCode}
          </span>
        </span>
      ),
    },
    {
      id: "bill",
      header: "账单号",
      cell: (o) =>
        o.billNo ? (
          <span className="font-mono text-body-sm">{o.billNo}</span>
        ) : (
          "—"
        ),
    },
    {
      id: "price",
      header: "应收",
      align: "right",
      cell: (o) => (
        <span className="tabular-nums font-medium text-foreground">
          {money(o.price, o.currency)}
        </span>
      ),
    },
    {
      id: "declared",
      header: "申报状态",
      align: "center",
      cell: (o) =>
        o.paymentDeclared ? (
          <StatusBadge tone="info">已申报转账</StatusBadge>
        ) : (
          <StatusBadge tone="warning">未申报</StatusBadge>
        ),
    },
    {
      id: "actions",
      header: "",
      align: "right",
      cell: (o) => (
        <Button
          size="sm"
          disabled={busyId !== null}
          onClick={() => void handleConfirm(o)}
        >
          确认收款
        </Button>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-lg">
      <PageHeader
        icon="lightning"
        title="加油包订单"
        description="客户自助购买的存储扩展包 / AI 加油包待核销队列(已申报优先)。确认收款即自动授予配额池。"
      />
      {error ? <Banner tone="danger" title={error} /> : null}
      {notice ? <Banner tone="success" title={notice} /> : null}
      <DataTable<AddonOrderOperationRecord>
        columns={columns}
        rows={orders}
        rowKey={(o) => o.id}
        loading={loading}
        empty={
          <EmptyState
            title="暂无待处理的加油包订单"
            description="客户下单后会出现在这里;已申报转账的订单排在最前。"
          />
        }
      />
    </div>
  );
}
