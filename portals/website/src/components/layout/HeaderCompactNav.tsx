/**
 * HeaderCompactNav.tsx - Keyboard and touch navigation for compact headers.
 * @package @vxture/website
 * @layer Presentation
 * @category Components - Layout
 * @author AI-Generated
 * @date 2026-11-13
 */
"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  ShellIconButton,
  Icon,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@vxture/design-system";
import { HEADER_DATA } from "@/data/layout/header.data";
import { Link, usePathname } from "@/lib/i18n/navigation";

// ----------------------------------------------------------------------------
// Shared navigation styling
// ----------------------------------------------------------------------------

const LINK_CLASS =
  "flex min-h-11 items-center rounded-lg px-3 py-2 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

// ----------------------------------------------------------------------------
// Compact navigation
// ----------------------------------------------------------------------------

export function HeaderCompactNav({ consoleHref }: { consoleHref: string }) {
  const t = useTranslations("layout.header");
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    // Close the portaled panel when its trigger leaves the compact layout.
    const desktop = window.matchMedia("(min-width: 1152px)");
    const closeOnDesktop = () => {
      if (desktop.matches) setOpen(false);
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  return (
    <div className="website-header-compact-nav">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <ShellIconButton
            icon="list"
            label={t(open ? "nav.close" : "nav.open")}
            iconClassName="size-5"
          />
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={12}
          collisionPadding={16}
          aria-label={t("nav.label")}
          className="website-header-nav-panel w-80 overflow-y-auto p-2"
        >
          <nav aria-label={t("nav.label")}>
            {HEADER_DATA.nav.map((item) => (
              <div key={item.key}>
                <Link
                  href={item.href}
                  className={LINK_CLASS}
                  onClick={() => setOpen(false)}
                >
                  {t(item.labelKey)}
                </Link>
                {item.children?.map((child) => (
                  <Link
                    key={child.key}
                    href={child.href}
                    className={`${LINK_CLASS} gap-3 pl-6 text-muted-foreground`}
                    onClick={() => setOpen(false)}
                  >
                    <Icon name={child.icon} className="size-4 shrink-0" />
                    {t(child.labelKey)}
                  </Link>
                ))}
              </div>
            ))}
            <a
              href={consoleHref}
              className={`${LINK_CLASS} mt-2 border-t border-border`}
              onClick={() => setOpen(false)}
            >
              {t("actions.console")}
            </a>
          </nav>
        </PopoverContent>
      </Popover>
    </div>
  );
}
