// Search numbers shared by the routes, the box and the tests.
// No imports, so Node can load this file directly.

/** Keep in step with search_limit_per_minute() in 010_search.sql. */
export const SEARCHES_PER_MINUTE = 60;
export const SUGGESTS_PER_MINUTE = 240;

/** The longest query, after normalizing. Same as search_normalize() in SQL. */
export const MAX_QUERY_LENGTH = 100;

/** Suggestions in the dropdown, at most. */
export const SUGGEST_LIMIT = 10;

/** The box waits this long after the last key before asking for suggestions. */
export const SUGGEST_DEBOUNCE_MS = 150;

/** Recent searches kept in the browser. */
export const RECENT_LIMIT = 10;

/** Video results per page on /results. */
export const SEARCH_PAGE_SIZE = 20;

/** Channel rows at the top of the first page when Type is not set. */
export const CHANNELS_ON_TOP = 3;

/** Channel rows when Type is Channel. */
export const CHANNELS_ONLY = 30;
