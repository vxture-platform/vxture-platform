"use client";

/**
 * useAdminSearch — header ⌘K 面板的取数与合流（admin 形态）。
 *
 * 与 console 的 `useGlobalSearch` 同一套结构，刻意保持一致：两个来源、形态
 * 不同、不合并成一次请求。
 * - **页面/功能**：数据是前端导航注册表（已按当前工作域过滤），本地即时匹配，
 *   零延迟零请求。后端没有这份数据的副本，也不该有。
 * - **业务数据**（租户/订单/操作员）：打 `GET /api/search`，防抖后发出。
 *
 * 本地结果先出、远端结果后到；面板不会因为等网络而空屏。远端失败只让远端那
 * 部分为空并置 `error`，本地结果照常显示——搜索是辅助入口，半份结果好过一个
 * 错误弹窗。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { searchAdmin, type AdminSearchItem } from "@/api/admin-bff";

/** 与 BFF 的 MIN_QUERY_LENGTH 保持一致：低于此长度两边都不检索。 */
const MIN_QUERY_LENGTH = 2;
/** 防抖窗口。够短到不觉得卡，够长到一次连续输入只发一个请求。 */
const DEBOUNCE_MS = 220;
/** 本地导航结果上限，跟后端每类的上限同档，面板各段高度才均衡。 */
const NAV_LIMIT = 5;

export interface NavSearchEntry {
  href: string;
  label: string;
  /** 所属分组名，作为副行——同名条目（"概览"）靠它区分。 */
  group?: string | undefined;
}

export interface AdminSearchState {
  query: string;
  setQuery: (next: string) => void;
  navHits: NavSearchEntry[];
  remoteHits: AdminSearchItem[];
  loading: boolean;
  /** 远端检索失败（网络/鉴权/服务不可用）。本地结果不受影响。 */
  error: boolean;
}

export function useAdminSearch(
  navEntries: readonly NavSearchEntry[],
): AdminSearchState {
  const [query, setQuery] = useState("");
  const [remoteHits, setRemoteHits] = useState<AdminSearchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  // 记住最后一次真正发出的查询串，用来丢弃过期响应：防抖只能减少请求数，
  // 减不掉乱序——先发的慢请求后到，会用旧关键词的结果盖掉新关键词的。
  const latestQuery = useRef("");

  const trimmed = query.trim();

  const navHits = useMemo(() => {
    if (trimmed.length < MIN_QUERY_LENGTH) return [];
    const needle = trimmed.toLowerCase();
    return navEntries
      .filter(
        (entry) =>
          entry.label.toLowerCase().includes(needle) ||
          entry.group?.toLowerCase().includes(needle),
      )
      .slice(0, NAV_LIMIT);
  }, [navEntries, trimmed]);

  useEffect(() => {
    latestQuery.current = trimmed;

    if (trimmed.length < MIN_QUERY_LENGTH) {
      setRemoteHits([]);
      setLoading(false);
      setError(false);
      return;
    }

    setLoading(true);
    setError(false);
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      searchAdmin(trimmed, controller.signal)
        .then((result) => {
          if (latestQuery.current !== trimmed) return;
          setRemoteHits(result.items);
          setLoading(false);
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted) return;
          if (latestQuery.current !== trimmed) return;
          setRemoteHits([]);
          setError(true);
          setLoading(false);
          void cause;
        });
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed]);

  return { query, setQuery, navHits, remoteHits, loading, error };
}
