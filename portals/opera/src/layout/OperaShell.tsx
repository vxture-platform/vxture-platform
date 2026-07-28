"use client";

/* Capability Console shell frame — deliberately thin re-use of the shared
 * shell-template chrome (.app/.vxh/.sidebar), stripped of the admin extras
 * (workspace launcher, Varda assistant, drawers): header + sidebar + content.
 * Provider modules render OUTSIDE this shell (edge-proxied full pages); the
 * shell only hosts chrome and the overview. */

import { useEffect, useState, type ReactNode } from "react";
import Image from "next/image";
import { capNavSections } from "@/config/navigation";
import { useOperatorSession } from "@/features/session/SessionProvider";

const LS_NAV = "vx-opera-nav-collapsed";
const BRAND_NAME = "Vxture Capability Console";

function SkeletonFrame() {
  return (
    <div className="app">
      <div className="vxh vxh--skeleton" aria-hidden="true">
        <div className="vxh-left">
          <div className="vxh-skeleton-block vxh-skeleton-block--icon" />
          <div className="vxh-skeleton-block vxh-skeleton-block--brand" />
        </div>
        <div className="vxh-actions">
          <div className="vxh-skeleton-block vxh-skeleton-block--circle" />
        </div>
      </div>
      <div className="app-body">
        <div className="sidebar">
          <div className="vxh-skeleton-nav">
            {[...Array(4)].map((_, i) => (
              <div
                key={i}
                className="vxh-skeleton-block vxh-skeleton-block--nav"
              />
            ))}
          </div>
        </div>
        <main className="content-scroll">
          <div className="content-inner vxh-skeleton-content">
            <div className="vxh-skeleton-block vxh-skeleton-block--title" />
            <div className="vxh-skeleton-block vxh-skeleton-block--card" />
          </div>
        </main>
      </div>
    </div>
  );
}

export function OperaShell({ children }: { children: ReactNode }) {
  const { operator, status, signOut } = useOperatorSession();
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [userPanel, setUserPanel] = useState(false);

  useEffect(() => {
    try {
      setNavCollapsed(window.localStorage.getItem(LS_NAV) === "true");
    } catch {
      /* ignore */
    }
  }, []);

  const toggleNav = () =>
    setNavCollapsed((c) => {
      const n = !c;
      try {
        window.localStorage.setItem(LS_NAV, String(n));
      } catch {
        /* ignore */
      }
      return n;
    });

  if (status === "loading") return <SkeletonFrame />;
  if (status === "anonymous" || !operator) {
    // The production edge gate never lets an unauthenticated navigation get
    // here; render nothing while the client-side redirect (dev/expiry) runs.
    return null;
  }

  const navigate = (href: string, external: boolean) => {
    if (external) {
      window.location.href = href;
      return;
    }
    window.location.assign(href);
  };

  return (
    <div className={"app" + (navCollapsed ? " nav-collapsed" : "")}>
      <header className="vxh">
        <div className="vxh-left">
          <button
            type="button"
            className="vxh-brand"
            aria-label={BRAND_NAME}
            onClick={() => navigate("/", false)}
          >
            <Image
              className="vxh-logo"
              src="/brand/vxture-logo-white.png"
              alt=""
              aria-hidden="true"
              width={24}
              height={24}
              priority
            />
            <strong className="vxh-brand-name">{BRAND_NAME}</strong>
          </button>
          <span className="vxh-divider" aria-hidden="true"></span>
          <span className="vxh-active-menu">
            <span>能力控制台</span>
          </span>
        </div>

        <div className="vxh-actions">
          <div className="vxh-pop-anchor">
            <button
              className="vxh-user"
              title="用户菜单"
              aria-label="用户菜单"
              onClick={() => setUserPanel((v) => !v)}
            >
              <span className="vxh-avatar" aria-hidden="true">
                <i className="ph ph-user"></i>
              </span>
              <span className="vxh-user-status"></span>
            </button>
            {userPanel && (
              <div className="vxh-panel vxh-user-panel">
                <div className="vxh-user-head">
                  <div className="vxh-user-meta">
                    <div className="vxh-user-name">{operator.displayName}</div>
                    <div className="vxh-user-contacts">
                      <span className="vxh-user-contact">
                        {operator.role || "operator"}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="vxh-acct-div"></div>
                <div className="vxh-user-actions">
                  <button
                    className="vxh-menu-item danger"
                    onClick={() => {
                      setUserPanel(false);
                      void signOut();
                    }}
                  >
                    <i className="ph ph-sign-out"></i>
                    退出登录
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {userPanel && (
          <div
            className="vxh-backdrop"
            onClick={() => setUserPanel(false)}
          ></div>
        )}
      </header>

      <div className="app-body">
        <aside className={"sidebar" + (navCollapsed ? " is-collapsed" : "")}>
          <div className="side-rail">
            <button
              className="rail-toggle"
              onClick={toggleNav}
              title={navCollapsed ? "展开导航" : "收起导航"}
              aria-label={navCollapsed ? "展开导航" : "收起导航"}
            >
              <i
                className={
                  "ph " + (navCollapsed ? "ph-text-indent" : "ph-text-outdent")
                }
              ></i>
            </button>
            {!navCollapsed && <span className="side-domain">能力控制台</span>}
          </div>

          <nav className="side-nav">
            {capNavSections.map((section) => (
              <section key={section.title} className="nav-section">
                <button className="nav-section-trigger" aria-expanded>
                  <span className="nav-section-title">{section.title}</span>
                </button>
                <div className="nav-items">
                  {section.items.map((it) => (
                    <button
                      key={it.href}
                      className="nav-item"
                      onClick={() => navigate(it.href, it.external)}
                      title={it.description ?? it.label}
                      aria-label={it.label}
                    >
                      <i className={"ph " + it.icon}></i>
                      <span className="nav-item-label">{it.label}</span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </nav>
        </aside>

        <main className="content-scroll">
          <div className="content-inner">{children}</div>
        </main>
      </div>
    </div>
  );
}
