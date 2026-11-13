"use client";

/**
 * Shared cards and application-center filtering using published DS controls.
 * @package @vxture/workbench
 * @layer Presentation
 * @category component
 * @author AI-Generated
 * @date 2026-11-05
 */
import { useWorkLocale } from "../../lib/locale";
import { useState } from "react";
import {
  Badge,
  Button,
  Icon,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  SegmentedControl,
  type IconName,
} from "@vxture/design-system";
import type { WorkApp } from "../../lib/contracts";
import {
  appVersion,
  filterApps,
  RELEASE_LABELS,
  TIER_LABELS,
} from "../../lib/presentation";
import type { Category } from "../../lib/presentation";

const CATEGORIES: { value: Category; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "agent", label: "专业智能体" },
  { value: "platform", label: "知识与数据" },
];
const PRODUCT_ICONS: Record<string, IconName> = {
  tenderforge: "edit",
  tender: "edit",
  bidproposal: "folder",
  solution: "folder",
  karda: "file",
  knowledge: "file",
  arda: "database",
  data: "database",
  yucer: "users",
  contractaudit: "shield",
  contract: "shield",
  review: "shield",
};
const TONES = ["brand", "violet", "teal", "amber"] as const;

// ============================================================================
// Presentation composition
// ============================================================================
/**
 * Render an entire-card overview target and an independent product entry action.
 * @param props - Current application and drawer callback.
 * @returns A keyboard-accessible application card.
 */
export function AppCard({
  app,
  onOverview,
  onFavorite,
  onLaunch,
  favoritesEnabled,
}: {
  app: WorkApp;
  onOverview: (app: WorkApp) => void;
  onFavorite: (app: WorkApp) => void;
  onLaunch: (app: WorkApp) => void;
  favoritesEnabled: boolean;
}): React.JSX.Element {
  const { t } = useWorkLocale();
  const tone =
    TONES[
      Array.from(app.code).reduce((sum, char) => sum + char.charCodeAt(0), 0) %
        TONES.length
    ];
  return (
    <article className="work-app-card">
      <Button
        type="button"
        variant="ghost"
        className="work-card-target"
        aria-label={t("查看{0}的概要", app.name)}
        onClick={() => onOverview(app)}
      />
      <div className="work-card-content">
        <div className="work-card-identity">
          <span
            className={`work-app-glyph work-tone-${tone}`}
            aria-hidden="true"
          >
            {app.icon ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={app.icon} alt="" width={24} height={24} />
            ) : (
              <Icon
                name={
                  PRODUCT_ICONS[app.code] ??
                  (app.category === "agent" ? "sparkles" : "database")
                }
                size="lg"
              />
            )}
          </span>
          <div className="work-app-name">
            <h3 title={app.name}>{app.name}</h3>
            {app.brand && (
              <p className="work-app-brand" title={app.brand}>
                {app.brand}
              </p>
            )}
          </div>
          <div className="work-card-badges">
            {app.tier && (
              <Badge variant="outline" className="work-plan-badge">
                {t(TIER_LABELS[app.tier] ?? app.tier)}
              </Badge>
            )}
            {RELEASE_LABELS[app.stage] && (
              <Badge
                variant="outline"
                className={`work-release-badge work-release-${app.stage}`}
              >
                {t(RELEASE_LABELS[app.stage]!)}
              </Badge>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="work-card-favorite"
              aria-label={t(app.favorite ? "取消收藏{0}" : "收藏{0}", app.name)}
              aria-pressed={Boolean(app.favorite)}
              disabled={!favoritesEnabled}
              onClick={() => onFavorite(app)}
            >
              <Icon
                name="star"
                size="sm"
                weight={app.favorite ? "fill" : "regular"}
              />
            </Button>
          </div>
        </div>
        <p className="work-app-description">
          {app.description || t("产品介绍暂未提供")}
        </p>
      </div>
      <div className="work-app-actions">
        <span className="work-app-version">{appVersion(app.version)}</span>
        {app.available && app.href ? (
          <Button asChild size="sm" className="work-action">
            <a
              onClick={() => onLaunch(app)}
              onAuxClick={(event) => {
                if (event.button === 1) onLaunch(app);
              }}
              href={app.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t("进入{0}（新标签页）", app.name)}
            >
              {t("进入")}
            </a>
          </Button>
        ) : (
          <span className="work-app-unavailable">
            {t(app.availabilityLabel)}
          </span>
        )}
      </div>
    </article>
  );
}

/**
 * Compose the catalog toolbar and filtered cards without a redundant result row.
 * @param props - Real catalog applications and overview action.
 * @returns Search, availability selection, contextual counts and cards.
 */
export function AppCatalog({
  apps,
  onOverview,
  onFavorite,
  onLaunch,
  favoritesEnabled,
}: {
  apps: WorkApp[];
  onOverview: (app: WorkApp) => void;
  onFavorite: (app: WorkApp) => void;
  onLaunch: (app: WorkApp) => void;
  favoritesEnabled: boolean;
}): React.JSX.Element {
  const { t } = useWorkLocale();
  const [query, setQuery] = useState("");
  const [availability, setAvailability] = useState<"all" | "available">("all");
  const [category, setCategory] = useState<Category>("all");
  const result = filterApps(
    apps,
    query,
    availability === "available",
    category,
  );
  return (
    <section aria-label={t("应用目录")} className="work-catalog">
      <div className="work-catalog-toolbar">
        <div
          role="group"
          aria-label={t("应用分类")}
          className="work-category-filters"
        >
          {CATEGORIES.map((item) => (
            <Button
              key={item.value}
              variant="ghost"
              size="sm"
              aria-pressed={category === item.value}
              className="work-category-filter"
              onClick={() => setCategory(item.value)}
            >
              {t(item.label)}
              <span className="text-body-sm tabular-nums">
                {result.counts[item.value]}
              </span>
            </Button>
          ))}
        </div>
        <div className="work-toolbar-actions">
          <InputGroup className="work-search">
            <InputGroupAddon>
              <Icon name="search" size="sm" />
            </InputGroupAddon>
            <InputGroupInput
              type="search"
              aria-label={t("搜索应用")}
              placeholder={t("搜索名称或业务能力")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </InputGroup>
          <div
            className="work-availability"
            onKeyDown={(event) => {
              const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
              if (!keys.includes(event.key)) return;
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? "all"
                  : event.key === "End"
                    ? "available"
                    : availability === "all"
                      ? "available"
                      : "all";
              setAvailability(next);
              const radios =
                event.currentTarget.querySelectorAll<HTMLButtonElement>(
                  "[role=radio]",
                );
              radios[next === "all" ? 0 : 1]?.focus();
            }}
          >
            <SegmentedControl<"all" | "available">
              ariaLabel={t("应用可用性")}
              value={availability}
              items={[
                { value: "all", label: t("全部") },
                { value: "available", label: t("可用") },
              ]}
              onChange={setAvailability}
            />
          </div>
        </div>
      </div>
      <div role="status" aria-live="polite" className="sr-only">
        {result.items.length} {t("个匹配应用")}
      </div>
      {result.items.length ? (
        <div className="work-app-grid">
          {result.items.map((app) => (
            <AppCard
              key={app.code}
              app={app}
              onOverview={onOverview}
              onFavorite={onFavorite}
              onLaunch={onLaunch}
              favoritesEnabled={favoritesEnabled}
            />
          ))}
        </div>
      ) : (
        <div className="work-empty">
          <Icon name="search" size="lg" />
          <h3>{apps.length ? t("没有找到相关应用") : t("尚未订阅应用")}</h3>
          <p className="text-body-sm text-muted-foreground">
            {apps.length
              ? t("试试其他关键词，或调整应用分类")
              : t("订阅适合你的产品，让专业能力融入日常工作")}
          </p>
          {apps.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setQuery("");
                setAvailability("all");
                setCategory("all");
              }}
            >
              {t("重置筛选")}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
