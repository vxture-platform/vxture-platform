"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button, Icon } from "@vxture/design-system";
import type { IconName } from "@vxture/design-system";
import { Link } from "@/lib/i18n/navigation";
import { buildConsoleEntryUrl } from "@/lib/console-entry";
import { useAuthStore } from "@/stores/auth.store";
import AnimatedHeroBg from "./AnimatedHeroBg";

type FilterItem = {
  id: string;
  label: string;
};

type AgentItem = {
  name: string;
  type: string;
  icon: IconName;
  industries: string[];
  description: string;
  value: string;
  capabilities: string[];
  tags: string[];
};

export default function AgentMarketplacePage() {
  const t = useTranslations("appcenter");
  const locale = useLocale();
  const [activeIndustry, setActiveIndustry] = useState("all");
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const user = useAuthStore((state) => state.user);
  const highlights = t.raw("hero.highlights") as string[];
  const filters = t.raw("filters.items") as FilterItem[];
  const agents = t.raw("agents.items") as AgentItem[];
  const hasTenantSession = isAuthenticated && Boolean(user);
  const consoleEntryUrl = buildConsoleEntryUrl(locale);

  const visibleAgents = useMemo(() => {
    if (activeIndustry === "all") {
      return agents;
    }

    return agents.filter((agent) => agent.industries.includes(activeIndustry));
  }, [activeIndustry, agents]);

  return (
    <div className="vx-page-surface">
      <section className="vx-hero-section">
        <AnimatedHeroBg />
        <div className="vx-hero-content">
          <div className="max-w-website-3xl">
            <p className="vx-website-hero-eyebrow mb-3 text-sm font-semibold uppercase text-vx-brand-600 dark:text-vx-info-200">
              {t("hero.eyebrow")}
            </p>
            <h1 className="font-brand text-4xl font-bold leading-tight text-vx-gray-900 dark:text-vx-white md:text-6xl">
              {t("hero.title")}
            </h1>
            <p className="mt-5 max-w-website-2xl text-sm leading-6 text-vx-gray-700 dark:text-vx-gray-200">
              {t("hero.description")}
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              {highlights.map((item) => (
                <span
                  key={item}
                  className="rounded-full border border-vx-brand-100 bg-vx-white/70 px-3 py-1 text-sm font-medium text-vx-brand-700 shadow-sm shadow-vx-brand-900/5 backdrop-blur dark:border-vx-white/20 dark:bg-vx-white/10 dark:text-vx-gray-100"
                >
                  {item}
                </span>
              ))}
            </div>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              {hasTenantSession ? (
                <Button
                  asChild
                  size="xl"
                  className="px-5 hover:bg-vx-brand-500"
                >
                  <a href={consoleEntryUrl}>{t("hero.primaryAction")}</a>
                </Button>
              ) : (
                <Button
                  asChild
                  size="xl"
                  className="px-5 hover:bg-vx-brand-500"
                >
                  <Link href="/signin">{t("hero.guestPrimaryAction")}</Link>
                </Button>
              )}
              <Button
                asChild
                variant="ghost"
                size="xl"
                className="border border-vx-brand-200 bg-vx-white/60 px-5 text-vx-brand-700 hover:border-vx-brand-300 hover:bg-vx-white dark:border-vx-white/35 dark:bg-transparent dark:text-vx-white dark:hover:border-vx-white dark:hover:bg-vx-white/10"
              >
                <a href="#agent-marketplace">{t("hero.secondaryAction")}</a>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section id="agent-marketplace" className="vx-section-odd">
        <div className="mx-auto max-w-7xl px-6 lg:px-8 xl:max-w-screen-2xl">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-semibold text-vx-brand-600 dark:text-vx-brand-300">
                {t("filters.eyebrow")}
              </p>
              <h2 className="font-display mt-2 text-3xl font-bold text-vx-gray-900 dark:text-vx-white">
                {t("filters.title")}
              </h2>
            </div>
            <p className="max-w-website-2xl text-sm leading-6 text-vx-gray-600 dark:text-vx-gray-300">
              {t("filters.description")}
            </p>
          </div>

          <div className="mt-8 flex flex-wrap gap-2">
            {filters.map((filter) => {
              const active = activeIndustry === filter.id;
              return (
                <Button
                  key={filter.id}
                  variant={active ? "default" : "outline"}
                  size="md"
                  onClick={() => setActiveIndustry(filter.id)}
                  className={`h-10 rounded-md border px-4 text-sm font-medium transition ${
                    active
                      ? "border-vx-brand-600 bg-vx-brand-600 text-vx-white shadow-sm shadow-vx-brand-900/20"
                      : "border-vx-gray-200 bg-vx-white text-vx-gray-600 hover:border-vx-brand-200 hover:text-vx-brand-700 dark:border-vx-gray-700 dark:bg-vx-gray-900 dark:text-vx-gray-300 dark:hover:border-vx-brand-500/40 dark:hover:text-vx-brand-200"
                  }`}
                >
                  {filter.label}
                </Button>
              );
            })}
          </div>

          <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {visibleAgents.map((agent) => (
              <article
                key={agent.name}
                className="vx-agent-marketplace-card flex flex-col rounded-lg border border-vx-gray-200 bg-vx-white p-5 shadow-sm transition hover:border-vx-brand-200 hover:shadow-md dark:border-vx-gray-800 dark:bg-vx-gray-900 dark:hover:border-vx-brand-500/30"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-4">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-vx-brand-50 text-vx-brand-600 dark:bg-vx-brand-950/50 dark:text-vx-brand-200">
                      <Icon name={agent.icon} className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-vx-brand-600 dark:text-vx-brand-300">
                        {agent.type}
                      </p>
                      <h3 className="mt-1 text-lg font-semibold text-vx-gray-900 dark:text-vx-white">
                        {agent.name}
                      </h3>
                    </div>
                  </div>
                  <span className="rounded-full border border-vx-info-100 bg-vx-info-50 px-2.5 py-1 text-xs font-medium text-vx-info-700 dark:border-vx-info-400/20 dark:bg-vx-brand-950/30 dark:text-vx-info-200">
                    {t("agents.available")}
                  </span>
                </div>

                <p className="mt-5 text-sm leading-6 text-vx-gray-600 dark:text-vx-gray-300">
                  {agent.description}
                </p>
                <div className="mt-5 rounded-md border border-vx-brand-100 bg-vx-brand-50/50 p-4 dark:border-vx-brand-400/15 dark:bg-vx-brand-950/20">
                  <p className="text-xs font-semibold text-vx-brand-600 dark:text-vx-brand-300">
                    {t("agents.valueLabel")}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-vx-gray-700 dark:text-vx-gray-200">
                    {agent.value}
                  </p>
                </div>

                <ul className="mt-5 space-y-2">
                  {agent.capabilities.map((capability) => (
                    <li
                      key={capability}
                      className="flex gap-2 text-sm text-vx-gray-600 dark:text-vx-gray-300"
                    >
                      <Icon
                        name="check"
                        className="mt-0.5 h-4 w-4 shrink-0 text-vx-brand-500"
                      />
                      <span>{capability}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-auto pt-5">
                  <div className="flex flex-wrap gap-2">
                    {agent.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full border border-vx-gray-200 bg-vx-gray-50 px-2.5 py-1 text-xs text-vx-gray-600 dark:border-vx-gray-700 dark:bg-vx-gray-900 dark:text-vx-gray-300"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                  <Button asChild className="mt-5 w-full">
                    <Link href="/signin">{t("agents.action")}</Link>
                  </Button>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
