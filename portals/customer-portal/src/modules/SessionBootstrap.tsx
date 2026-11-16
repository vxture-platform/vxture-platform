"use client";

/**
 * Establish a portal document before starting browser-bound silent authentication.
 * @package @vxture/customer-portal
 * @layer Presentation
 * @category module
 * @author AI-Generated
 * @date 2026-11-17
 */
import { useEffect } from "react";
import Link from "next/link";

/**
 * Start a same-origin navigation without exposing any previous workspace content.
 * @returns A public loading state with a safe route back to the portal.
 */
export function SessionBootstrap() {
  useEffect(() => {
    // Server redirects retain cross-site Fetch Metadata from the original entry.
    window.location.replace("/auth/login?prompt=none");
  }, []);

  return (
    <main className="flex min-h-svh items-center justify-center px-6">
      <section className="space-y-3 text-center">
        <h1 className="text-xl font-medium">正在确认登录状态</h1>
        <p role="status" className="text-sm">
          请稍候，正在安全连接您的工作空间。
        </p>
        <Link
          href="/"
          prefetch={false}
          className="inline-block text-sm underline underline-offset-4"
        >
          返回门户首页
        </Link>
        <noscript>
          <p>请启用 JavaScript，或返回门户首页后点击登录。</p>
        </noscript>
      </section>
    </main>
  );
}
