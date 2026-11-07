// Sorting, filtering and searching the Content list. Pure, so the tests can
// check it. Only relative imports, so Node can load it directly.
import type { StudioRow, Visibility } from "./types.ts";

export type SortKey = "date" | "title" | "views" | "comments" | "likes" | "visibility";
export type SortDir = "asc" | "desc";
export type KindFilter = "all" | "videos" | "shorts";

export type TableQuery = {
  sort: SortKey;
  dir: SortDir;
  visibility: Visibility | "all";
  kind: KindFilter;
  search: string;
};

export const DEFAULT_QUERY: TableQuery = { sort: "date", dir: "desc", visibility: "all", kind: "all", search: "" };

const SORT_KEYS: SortKey[] = ["date", "title", "views", "comments", "likes", "visibility"];
const VIS_ORDER: Record<Visibility, number> = { public: 0, unlisted: 1, private: 2 };

/** The date the list shows and sorts on: deleted (in the trash), else published, else uploaded. */
export function rowDate(v: Pick<StudioRow, "publishedAt" | "createdAt"> & { deletedAt?: string | null }): string {
  return v.deletedAt ?? v.publishedAt ?? v.createdAt;
}

/** The direction a column starts in when first clicked: A to Z for titles, biggest first for numbers and dates. */
export function firstDir(key: SortKey): SortDir {
  return key === "title" || key === "visibility" ? "asc" : "desc";
}

/** Clicking a column header: the same column flips, another starts in its first direction. */
export function toggleSort(q: TableQuery, key: SortKey): TableQuery {
  if (q.sort === key) return { ...q, dir: q.dir === "asc" ? "desc" : "asc" };
  return { ...q, sort: key, dir: firstDir(key) };
}

function compareBy(key: SortKey, a: StudioRow, b: StudioRow): number {
  switch (key) {
    case "title":
      return a.title.localeCompare(b.title, "en", { sensitivity: "base", numeric: true });
    case "views":
      return a.views - b.views;
    case "comments":
      return a.comments - b.comments;
    case "likes":
      return a.likes - b.likes;
    case "visibility":
      return VIS_ORDER[a.visibility] - VIS_ORDER[b.visibility];
    case "date":
      return Date.parse(rowDate(a)) - Date.parse(rowDate(b));
  }
}

/**
 * Sorted copy. Ties fall back to the date, newest first, then the id, so the
 * order never jumps between two renders.
 */
export function sortRows(rows: StudioRow[], key: SortKey, dir: SortDir): StudioRow[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort(
    (a, b) =>
      sign * compareBy(key, a, b) ||
      (key === "date" ? 0 : Date.parse(rowDate(b)) - Date.parse(rowDate(a))) ||
      (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
  );
}

/** Lower case, accents off, spaces squeezed: "  Crêpes  " -> "crepes". */
export function normalizeSearch(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Every word of the search must be in the title. */
export function matchesSearch(title: string, search: string): boolean {
  const q = normalizeSearch(search);
  if (!q) return true;
  const t = normalizeSearch(title);
  return q.split(" ").every((w) => t.includes(w));
}

export function filterRows(rows: StudioRow[], q: Pick<TableQuery, "visibility" | "kind" | "search">): StudioRow[] {
  return rows.filter(
    (v) =>
      (q.visibility === "all" || v.visibility === q.visibility) &&
      (q.kind === "all" || (q.kind === "shorts") === v.isShort) &&
      matchesSearch(v.title, q.search),
  );
}

/** Filter, then sort. */
export function applyQuery(rows: StudioRow[], q: TableQuery): StudioRow[] {
  return sortRows(filterRows(rows, q), q.sort, q.dir);
}

/** The query from the URL (?sort=views&dir=asc&vis=public&kind=shorts&q=cake), anything unknown left at the default. */
export function readQuery(params: { get(name: string): string | null }): TableQuery {
  const sort = params.get("sort") as SortKey | null;
  const dir = params.get("dir");
  const v = params.get("vis");
  const kind = params.get("kind");
  return {
    sort: sort && SORT_KEYS.includes(sort) ? sort : DEFAULT_QUERY.sort,
    dir: dir === "asc" || dir === "desc" ? dir : sort && SORT_KEYS.includes(sort) ? firstDir(sort) : DEFAULT_QUERY.dir,
    visibility: v === "public" || v === "unlisted" || v === "private" ? v : "all",
    kind: kind === "videos" || kind === "shorts" ? kind : "all",
    search: (params.get("q") ?? "").slice(0, 100),
  };
}

/** The query as URL parameters, leaving out the defaults. */
export function queryParams(q: TableQuery): string {
  const p = new URLSearchParams();
  if (q.sort !== DEFAULT_QUERY.sort || q.dir !== DEFAULT_QUERY.dir) {
    p.set("sort", q.sort);
    p.set("dir", q.dir);
  }
  if (q.visibility !== "all") p.set("vis", q.visibility);
  if (q.kind !== "all") p.set("kind", q.kind);
  if (q.search.trim()) p.set("q", q.search.trim());
  return p.toString();
}
