export { NoticeModule } from "./module/notice.module";
export { NoticeService, isNoticeId } from "./service/notice.service";
export {
  CREATE_SYSTEM_NOTICE_SQL,
  PgNoticeRepository,
  buildListQuery,
} from "./repository/pg-notice.repository";
export { NOTICE_PLANES, NOTICE_SEVERITIES } from "./types/notice.types";
/* 四项读侧筛选的唯一解析处（admin-bff / opera-bff 都从这里取，见 filters/notice-filters.ts
 * 的文件头：同名参数的值词汇此前在两个 BFF 上分岔了三处）。 */
export {
  NOTICE_KEYWORD_MAX,
  NoticeFilterError,
  likePattern,
  parseNoticeFilters,
  parseNoticeFlag,
  parseNoticeKeyword,
  parseNoticeSeverities,
  parseNoticeSource,
} from "./filters/notice-filters";
export type { NoticeListQuery } from "./repository/pg-notice.repository";
export type {
  NoticeFilterErrorCode,
  NoticeFilterField,
  NoticeFilterQuery,
} from "./filters/notice-filters";
export type {
  CreateSystemNoticeInput,
  CreateSystemNoticeResult,
  NoticePlane,
  NoticeSeverity,
  NoticeSeverityCounts,
  NoticeSource,
  OperatorNoticeView,
  ListNoticesParams,
  ListNoticesResult,
  MarkAllNoticesReadResult,
  MarkNoticeReadResult,
  NoticeFilters,
} from "./types/notice.types";
