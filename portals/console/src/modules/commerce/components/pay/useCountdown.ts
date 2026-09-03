"use client";

/**
 * useCountdown — 付款截止倒计时(订阅单与加油包单共用,批 1)。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * 返回 mm:ss / hh:mm:ss;到点时**只调一次** `onExpire`——此前两页的倒计时归零后
 * 什么都不做,页面停在「待付款 00:00」还能点申报,只能等服务端报错。到点应当
 * 重取订单让服务端的 expired 态显影。
 */

import { useEffect, useRef, useState } from "react";
import { formatRemain } from "../hubModel";

export function useCountdown(
  deadline: string | null,
  onExpire?: () => void,
): string | null {
  const [now, setNow] = useState(() => Date.now());
  const firedFor = useRef<string | null>(null);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  useEffect(() => {
    if (!deadline) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(t);
  }, [deadline]);

  useEffect(() => {
    if (!deadline) return;
    const remain = new Date(deadline).getTime() - now;
    if (remain > 0 || firedFor.current === deadline) return;
    firedFor.current = deadline;
    onExpireRef.current?.();
  }, [deadline, now]);

  if (!deadline) return null;
  return formatRemain(deadline, now);
}
