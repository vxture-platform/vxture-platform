/**
 * ConnectedRow — 「已接入的某个东西」的列表行：徽标 / 标题+状态+说明 / 若干
 * 键值对 / 操作。用于第三方账号、订阅、工作空间这类清单。
 *
 * 原实现是 .vx-account-connected-row 一族遗留类名，ProfilePage 用了两处
 * （第三方账号、工作空间）、TenantInfoPage 两处（订阅、工作空间），共四份。
 *
 * 与 DS 的 `DetailRow` 分工：DetailRow 是「一个字段」（名—值对，语义走 dl/dt/dd）；
 * 本件是「一条记录」——它有自己的标题、说明和多个键值对，是媒体对象不是字段。
 * 与 DS 的 `ListCard` 分工：ListCard 是清单页 cards 视图里 DataTable 行的卡片
 * 形态，跟着列表页的五要件走；本件长在详情页的板块里，没有选择框与序号。
 *
 * 不进 DS：同 IdentityCard，目前只有 console 用，等 admin 侧长出同形再谈提升。
 *
 * `meta` 收成数组而不是自由插槽：四处用法都是「标签在上、值在下」的定宽键值
 * 对，收成数组才能保证四处的对齐一致；实测最多两对。
 */

import type { ReactNode } from "react";

export interface ConnectedRowMeta {
  readonly label: string;
  readonly value: ReactNode;
  /** 值过长时的悬停全文。 */
  readonly title?: string;
}

export interface ConnectedRowProps {
  /** 徽标/图标，通常是 provider logo。 */
  readonly logo?: ReactNode;
  readonly title: ReactNode;
  /** 状态标，通常是一个 StatusBadge。 */
  readonly status?: ReactNode;
  readonly description?: ReactNode;
  readonly meta?: readonly ConnectedRowMeta[];
  readonly actions?: ReactNode;
  /** 整行的悬停全文。 */
  readonly title_?: string;
}

export function ConnectedRow({
  logo,
  title,
  status,
  description,
  meta,
  actions,
  title_,
}: ConnectedRowProps) {
  return (
    <div
      className="flex flex-wrap items-center gap-lg py-md"
      {...(title_ ? { title: title_ } : {})}
    >
      {logo ? (
        <span
          className="inline-flex size-icon-2xl shrink-0 items-center justify-center"
          aria-hidden="true"
        >
          {logo}
        </span>
      ) : null}

      <div className="flex min-w-0 flex-1 basis-media-3xl flex-col gap-2xs">
        <span className="flex flex-wrap items-center gap-sm">
          <strong className="text-label-md text-foreground">{title}</strong>
          {status}
        </span>
        {description ? (
          <p className="text-body-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>

      {meta?.map((item) => (
        <div
          key={item.label}
          className="flex min-w-0 shrink-0 flex-col gap-2xs sm:w-media-2xl"
        >
          <span className="text-label-sm text-muted-foreground">
            {item.label}
          </span>
          <span
            className="truncate text-body-sm text-foreground"
            {...(item.title ? { title: item.title } : {})}
          >
            {item.value}
          </span>
        </div>
      ))}

      {actions ? (
        <div className="flex shrink-0 items-center gap-sm">{actions}</div>
      ) : null}
    </div>
  );
}
