// Feature 12: the pure parts of the creator studio.
import assert from "node:assert/strict";
import { test } from "node:test";
import { bulkDoneText, bulkReducer, initBulk, selectionOf } from "../lib/studio/bulk.ts";
import {
  BULK_MAX,
  customThumbnailName,
  isThumbnailName,
  parseTags,
  studioErrorCode,
  studioStatus,
  tagsProblem,
  thumbnailFileProblem,
  thumbnailKey,
  TRASH_DAYS,
  trashExpiry,
  trashLabel,
} from "../lib/studio/rules.ts";
import {
  applyQuery,
  DEFAULT_QUERY,
  filterRows,
  matchesSearch,
  queryParams,
  readQuery,
  sortRows,
  toggleSort,
} from "../lib/studio/table.ts";
import { readOverview, rowToStudio, watchHours } from "../lib/studio/types.ts";

const NOW = Date.parse("2026-11-04T12:00:00Z");
const DAY = 86_400_000;
const id = (n) => `f0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const daysAgo = (d) => new Date(NOW - d * DAY).toISOString();

function row(n, extra = {}) {
  return {
    id: id(n),
    title: `Video ${n}`,
    description: "",
    visibility: "public",
    status: "ready",
    isShort: false,
    shortChoice: null,
    durationS: 120,
    thumbnail: null,
    thumbnailName: null,
    hlsKey: `hls/${id(n)}/master.m3u8`,
    tags: [],
    commentsMode: null,
    createdAt: daysAgo(n),
    publishedAt: daysAgo(n),
    views: 0,
    likes: 0,
    comments: 0,
    deletedAt: null,
    trashVisibility: null,
    ...extra,
  };
}

const ROWS = [
  row(1, { title: "Pancakes in ten minutes", views: 500, likes: 40, comments: 12 }),
  row(2, { title: "crêpes for beginners", visibility: "unlisted", views: 90, likes: 3, comments: 30 }),
  row(3, { title: "A short about eggs", isShort: true, durationS: 30, views: 2000, likes: 40, comments: 1 }),
  row(4, { title: "Bread at home", visibility: "private", views: 0, publishedAt: null, createdAt: daysAgo(0.5) }),
  row(5, { title: "Video 10", views: 500, likes: 1 }),
];
const ids = (rows) => rows.map((r) => Number(r.id.slice(-2)));

// Sorting and filtering ------------------------------------------------------------------------

test("sortRows: by date newest first uses published, else uploaded", () => {
  assert.deepEqual(ids(sortRows(ROWS, "date", "desc")), [4, 1, 2, 3, 5]);
  assert.deepEqual(ids(sortRows(ROWS, "date", "asc")), [5, 3, 2, 1, 4]);
});

test("sortRows: in the trash the date is when it was deleted", () => {
  const trash = [row(7, { deletedAt: daysAgo(10), publishedAt: daysAgo(1) }), row(8, { deletedAt: daysAgo(2), publishedAt: daysAgo(90) })];
  assert.deepEqual(ids(sortRows(trash, "date", "desc")), [8, 7]);
});

test("sortRows: numbers, ties broken by the date then the id", () => {
  // 1 and 5 both have 500 views: 1 is newer.
  assert.deepEqual(ids(sortRows(ROWS, "views", "desc")), [3, 1, 5, 2, 4]);
  assert.deepEqual(ids(sortRows(ROWS, "views", "asc")), [4, 2, 1, 5, 3]);
  // 1 and 3 both have 40 likes: 1 is newer, in either direction.
  assert.deepEqual(ids(sortRows(ROWS, "likes", "desc")), [1, 3, 2, 5, 4]);
  assert.deepEqual(ids(sortRows(ROWS, "comments", "desc")), [2, 1, 3, 4, 5]);
});

test("sortRows: titles A to Z without caring about case or accents, numbers in order", () => {
  assert.deepEqual(
    sortRows(ROWS, "title", "asc").map((r) => r.title),
    ["A short about eggs", "Bread at home", "crêpes for beginners", "Pancakes in ten minutes", "Video 10"],
  );
  const numbered = [row(1, { title: "Part 10" }), row(2, { title: "Part 2" })];
  assert.deepEqual(sortRows(numbered, "title", "asc").map((r) => r.title), ["Part 2", "Part 10"]);
});

test("sortRows: visibility goes public, unlisted, private and never changes the input", () => {
  const before = ROWS.map((r) => r.id);
  assert.deepEqual(ids(sortRows(ROWS, "visibility", "asc")), [1, 3, 5, 2, 4]);
  assert.deepEqual(ROWS.map((r) => r.id), before);
});

test("toggleSort: the same column flips, a new one starts in its own direction", () => {
  let q = DEFAULT_QUERY;
  assert.equal(q.sort, "date");
  assert.equal(q.dir, "desc");
  q = toggleSort(q, "date");
  assert.equal(q.dir, "asc");
  q = toggleSort(q, "title");
  assert.deepEqual([q.sort, q.dir], ["title", "asc"]);
  q = toggleSort(q, "views");
  assert.deepEqual([q.sort, q.dir], ["views", "desc"]);
});

test("matchesSearch: every word, any order, any case, accents off", () => {
  assert.equal(matchesSearch("Crêpes for beginners", "CREPES"), true);
  assert.equal(matchesSearch("Pancakes in ten minutes", "minutes pancakes"), true);
  assert.equal(matchesSearch("Pancakes in ten minutes", "pancakes bread"), false);
  assert.equal(matchesSearch("Anything", "   "), true);
});

test("filterRows: visibility, shorts or videos, and the search together", () => {
  assert.deepEqual(ids(filterRows(ROWS, { visibility: "public", kind: "all", search: "" })), [1, 3, 5]);
  assert.deepEqual(ids(filterRows(ROWS, { visibility: "all", kind: "shorts", search: "" })), [3]);
  assert.deepEqual(ids(filterRows(ROWS, { visibility: "all", kind: "videos", search: "" })), [1, 2, 4, 5]);
  assert.deepEqual(ids(filterRows(ROWS, { visibility: "public", kind: "videos", search: "pan" })), [1]);
  assert.deepEqual(ids(filterRows(ROWS, { visibility: "private", kind: "shorts", search: "" })), []);
});

test("applyQuery and the URL: round trip, defaults left out, unknown values ignored", () => {
  const q = { sort: "views", dir: "asc", visibility: "public", kind: "videos", search: " cake " };
  const text = queryParams(q);
  assert.equal(text, "sort=views&dir=asc&vis=public&kind=videos&q=cake");
  assert.deepEqual(readQuery(new URLSearchParams(text)), { ...q, search: "cake" });
  assert.equal(queryParams(DEFAULT_QUERY), "");
  assert.deepEqual(readQuery(new URLSearchParams("sort=nope&dir=up&vis=secret&kind=x")), DEFAULT_QUERY);
  // A known column without a direction starts in its own direction.
  assert.equal(readQuery(new URLSearchParams("sort=title")).dir, "asc");
  assert.deepEqual(ids(applyQuery(ROWS, { ...DEFAULT_QUERY, sort: "views", visibility: "public" })), [3, 1, 5]);
});

// The bulk reducer -----------------------------------------------------------------------------

test("bulk: toggle, toggle all over the visible rows, clear", () => {
  let s = initBulk(ROWS);
  s = bulkReducer(s, { type: "toggle", id: id(2) });
  s = bulkReducer(s, { type: "toggle", id: id(9) }); // not in the list: ignored
  assert.deepEqual(s.selected, [id(2)]);
  assert.equal(selectionOf(s.selected, [id(1), id(2)]), "some");
  s = bulkReducer(s, { type: "toggle-all", visibleIds: [id(1), id(2)] });
  assert.deepEqual(s.selected, [id(2), id(1)]);
  assert.equal(selectionOf(s.selected, [id(1), id(2)]), "all");
  // All visible ones selected: the header box clears them, and only them.
  s = bulkReducer(s, { type: "toggle", id: id(3) });
  s = bulkReducer(s, { type: "toggle-all", visibleIds: [id(1), id(2)] });
  assert.deepEqual(s.selected, [id(3)]);
  s = bulkReducer(s, { type: "toggle", id: id(3) });
  assert.deepEqual(s.selected, []);
  s = bulkReducer(bulkReducer(s, { type: "toggle", id: id(1) }), { type: "clear" });
  assert.deepEqual(s.selected, []);
  assert.equal(selectionOf([], []), "none");
});

test("bulk: never more than BULK_MAX selected", () => {
  const many = Array.from({ length: BULK_MAX + 5 }, (_, i) => row(i + 1));
  let s = bulkReducer(initBulk(many), { type: "toggle-all", visibleIds: many.map((r) => r.id) });
  assert.equal(s.selected.length, BULK_MAX);
  s = bulkReducer(s, { type: "toggle", id: many[BULK_MAX + 1].id });
  assert.equal(s.selected.length, BULK_MAX);
  assert.match(s.error, /up to 100/);
});

test("bulk: a visibility change shows at once and stays when it worked", () => {
  let s = initBulk(ROWS);
  s = bulkReducer(s, { type: "toggle", id: id(1) });
  s = bulkReducer(s, { type: "toggle", id: id(4) });
  s = bulkReducer(s, { type: "start", action: { kind: "visibility", visibility: "unlisted" } });
  assert.deepEqual(s.pending.ids, [id(1), id(4)]);
  assert.deepEqual(s.rows.filter((r) => r.visibility === "unlisted").map((r) => r.id).sort(), [id(1), id(2), id(4)]);
  // A second change waits for the first.
  assert.equal(bulkReducer(s, { type: "start", action: { kind: "trash" } }), s);
  s = bulkReducer(s, { type: "done" });
  assert.equal(s.pending, null);
  assert.deepEqual(s.selected, [id(1), id(4)]);
  assert.equal(bulkDoneText({ kind: "visibility", visibility: "unlisted" }, 2), "2 videos set to unlisted");
});

test("bulk: trash takes the rows out and drops them from the selection; a failure puts everything back", () => {
  let s = initBulk(ROWS);
  s = bulkReducer(s, { type: "toggle", id: id(2) });
  s = bulkReducer(s, { type: "toggle", id: id(3) });
  s = bulkReducer(s, { type: "start", action: { kind: "trash" } });
  assert.deepEqual(ids(s.rows), [1, 4, 5]);
  assert.deepEqual(s.selected, []);
  s = bulkReducer(s, { type: "failed", error: "rate_limited" });
  assert.deepEqual(ids(s.rows), [1, 2, 3, 4, 5]);
  // The selection comes back too, so trying again is one click.
  assert.deepEqual(s.selected, [id(2), id(3)]);
  assert.equal(s.error, "rate_limited");
  assert.equal(s.pending, null);
  assert.equal(bulkDoneText({ kind: "trash" }, 1), "1 video moved to the trash");
});

test("bulk: one row's menu acts on that row only, the selection stays", () => {
  let s = bulkReducer(initBulk(ROWS), { type: "toggle", id: id(1) });
  s = bulkReducer(s, { type: "start", action: { kind: "trash" }, ids: [id(5)] });
  assert.deepEqual(ids(s.rows), [1, 2, 3, 4]);
  assert.deepEqual(s.selected, [id(1)]);
  // Nothing to act on: no change at all.
  assert.equal(bulkReducer(initBulk(ROWS), { type: "start", action: { kind: "trash" } }).pending, null);
});

test("bulk: restore in the trash list, and replace keeps only the ids still there", () => {
  const trash = [row(7, { deletedAt: daysAgo(3), visibility: "private", trashVisibility: "public" }), row(8, { deletedAt: daysAgo(1) })];
  let s = bulkReducer(initBulk(trash), { type: "toggle-all", visibleIds: trash.map((r) => r.id) });
  s = bulkReducer(s, { type: "start", action: { kind: "restore" }, ids: [id(7)] });
  assert.deepEqual(ids(s.rows), [8]);
  assert.deepEqual(s.selected, [id(8)]);
  s = bulkReducer(bulkReducer(s, { type: "done" }), { type: "replace", rows: [] });
  assert.deepEqual(s.selected, []);
  assert.equal(bulkDoneText({ kind: "restore" }, 3), "3 videos restored");
});

// The trash expiry ------------------------------------------------------------------------------

test("trashExpiry: 30 days from the delete, whole days rounded up", () => {
  assert.equal(TRASH_DAYS, 30);
  const fresh = trashExpiry(new Date(NOW).toISOString(), NOW);
  assert.equal(fresh.purgeAt, NOW + 30 * DAY);
  assert.equal(fresh.daysLeft, 30);
  assert.equal(fresh.expired, false);
  assert.equal(trashLabel(fresh), "Deleted forever in 30 days");
  // One minute in: still 30 (rounded up). 29.5 days in: 1 day left.
  assert.equal(trashExpiry(NOW - 60_000, NOW).daysLeft, 30);
  const last = trashExpiry(NOW - 29.5 * DAY, NOW);
  assert.equal(last.daysLeft, 1);
  assert.equal(trashLabel(last), "Deleted forever in 1 day");
});

test("trashExpiry: past 30 days it is expired with 0 days, whatever the purge did", () => {
  const exact = trashExpiry(NOW - 30 * DAY, NOW);
  assert.equal(exact.expired, true);
  assert.equal(exact.daysLeft, 0);
  const late = trashExpiry(daysAgo(45), NOW);
  assert.deepEqual([late.expired, late.daysLeft], [true, 0]);
  assert.equal(trashLabel(late), "Deleted forever today");
  // A broken date counts from now, never NaN.
  assert.equal(trashExpiry("not a date", NOW).daysLeft, 30);
});

// Tags, thumbnails, errors ----------------------------------------------------------------------

test("parseTags and tagsProblem: like video_tags_are_valid()", () => {
  assert.deepEqual(parseTags(" cooking,pancakes,, Pancakes ,\nbreakfast  ideas "), ["cooking", "pancakes", "breakfast ideas"]);
  assert.equal(tagsProblem(parseTags("a, b, c")), null);
  assert.match(tagsProblem(Array.from({ length: 16 }, (_, i) => `t${i}`)), /15/);
  assert.match(tagsProblem(["x".repeat(31)]), /30/);
  assert.match(tagsProblem(["a,b"]), /commas/);
  // 15 tags of 30 characters are fine (464 characters with the commas).
  assert.equal(tagsProblem(Array.from({ length: 15 }, (_, i) => "y".repeat(29) + i.toString(36))), null);
});

test("thumbnails: names, files and keys", () => {
  assert.equal(isThumbnailName("thumb-2.webp"), true);
  assert.equal(isThumbnailName("thumb-4.webp"), false);
  assert.equal(isThumbnailName("../thumb-1.webp"), false);
  const name = customThumbnailName("image/png", new Uint8Array(16).fill(200));
  assert.match(name, /^custom-[a-z0-9]{24}\.png$/);
  assert.equal(isThumbnailName(name), true);
  assert.equal(customThumbnailName("image/gif", new Uint8Array(16)), null);
  assert.equal(thumbnailFileProblem({ type: "image/jpeg", size: 1000 }), null);
  assert.match(thumbnailFileProblem({ type: "image/gif", size: 1000 }), /JPG/);
  assert.match(thumbnailFileProblem({ type: "image/jpeg", size: 3 * 1024 * 1024 }), /2 MB/);
  assert.equal(thumbnailKey(id(1).toUpperCase(), "thumb-2.webp"), `hls/${id(1)}/thumb-2.webp`);
});

test("errors: codes from the database and their HTTP status", () => {
  assert.equal(studioErrorCode("rate_limited"), "rate_limited");
  assert.equal(studioErrorCode("permission denied for function studio_bulk"), "not_signed_in");
  assert.equal(studioErrorCode("boom"), "failed");
  assert.equal(studioStatus("rate_limited"), 429);
  assert.equal(studioStatus("not_allowed"), 403);
  assert.equal(studioStatus("in_trash"), 400);
  assert.equal(studioStatus("not_signed_in"), 401);
});

test("rows and the overview from the RPCs", () => {
  const thumb = (vid, name, url) => url ?? `/api/media/${vid}/${name ?? "thumb-1.webp"}`;
  const r = rowToStudio(
    { id: id(1), title: "T", visibility: "secret", status: "ready", is_short: true, views: "12", like_count: 3, comment_count: null, tags: ["a"], comments_mode: "held", thumbnail_name: "thumb-3.webp" },
    thumb,
  );
  assert.equal(r.visibility, "private");
  assert.equal(r.views, 12);
  assert.equal(r.comments, 0);
  assert.equal(r.commentsMode, "held");
  assert.equal(r.thumbnail, `/api/media/${id(1)}/thumb-3.webp`);
  assert.equal(rowToStudio({ id: id(2), status: "processing" }, thumb).thumbnail, null);
  const o = readOverview({ channel: null, totals: { views: 10, videos: 2, watch_s: 7200 }, latest: null, trash: 1 }, thumb);
  assert.equal(o.totals.views, 10);
  assert.equal(o.recent.days, 28);
  assert.equal(o.trash, 1);
  assert.equal(watchHours(o.totals.watchS), "2.0");
  assert.equal(watchHours(3600 * 1234.4), "1,234");
});
