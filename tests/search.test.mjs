// Feature 8: the pure parts of search. The ranking, the filters in SQL and
// the rate limit live in 010_search.sql; these test the app side: the query,
// the filters it sends, the description snippet, the suggestions and the
// recent searches.
import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeSearchCursor, encodeSearchCursor } from "../lib/search/cursor.ts";
import {
  durationBounds,
  filtersToSql,
  isActive,
  normalizeQuery,
  parseFilters,
  queryWords,
  readQuery,
  resultsHref,
  showsChannels,
  showsVideos,
  toggleFilter,
} from "../lib/search/query.ts";
import { addRecent, parseRecent, removeRecent } from "../lib/search/recent.ts";
import { MAX_QUERY_LENGTH, RECENT_LIMIT, SUGGEST_LIMIT } from "../lib/search/rules.ts";
import { highlight, snippet } from "../lib/search/snippet.ts";
import { dedupeSuggestions, splitSuggestion } from "../lib/search/suggest.ts";

// Query normalization --------------------------------------------------------------

test("query: trimmed, spaces collapsed", () => {
  assert.equal(normalizeQuery("   bread   with\tfour \n ingredients  "), "bread with four ingredients");
});

test("query: punctuation and symbols become spaces, apostrophes go", () => {
  assert.equal(normalizeQuery("don't stop!!!"), "dont stop");
  assert.equal(normalizeQuery("c++/rust: a 'test', (really)?"), "c rust a test really");
  assert.equal(normalizeQuery("pancakes’ recipe #1 $5 50%"), "pancakes recipe 1 5 50");
  assert.equal(normalizeQuery("%_%"), "", "nothing but punctuation is empty");
});

test("query: case and letters from other scripts stay", () => {
  assert.equal(normalizeQuery("Crème Brûlée"), "Crème Brûlée");
  assert.equal(normalizeQuery("東京 ラーメン"), "東京 ラーメン");
});

test("query: at most 100 characters, never ending in a space", () => {
  const long = "a".repeat(99) + " bcd";
  assert.equal(normalizeQuery(long), "a".repeat(99));
  assert.equal(normalizeQuery("x".repeat(500)).length, MAX_QUERY_LENGTH);
  // Counted in characters, not UTF-16 units.
  assert.equal(Array.from(normalizeQuery("😀a".repeat(80))).length <= MAX_QUERY_LENGTH, true);
});

test("query: anything that is not a string is empty", () => {
  for (const v of [undefined, null, 42, ["a"], {}]) assert.equal(normalizeQuery(v), "");
});

test("query: read from ?search_query=, first value wins", () => {
  assert.equal(readQuery(new URLSearchParams("search_query=%20hello%20%20world%20")), "hello world");
  assert.equal(readQuery({ search_query: ["one", "two"] }), "one");
  assert.equal(readQuery({}), "");
});

test("query words: lower case, no repeats", () => {
  assert.deepEqual(queryWords("Bread BREAD bread, Club"), ["bread", "club"]);
});

// Filters --------------------------------------------------------------------------

test("filters: parsed from the URL, unknown values dropped", () => {
  assert.deepEqual(parseFilters(new URLSearchParams("uploaded=week&type=video&duration=long&sort=views")), {
    uploaded: "week",
    type: "video",
    duration: "long",
    sort: "views",
  });
  assert.deepEqual(parseFilters({ uploaded: "decade", duration: "huge", sort: "random", type: "playlist" }), {});
  assert.deepEqual(parseFilters({ sort: "relevance" }), {}, "relevance is the default, not a filter");
});

test("filters: SQL params carry upload date, duration and sort, never type", () => {
  assert.deepEqual(filtersToSql({}), { sort: "relevance" });
  assert.deepEqual(filtersToSql({ uploaded: "hour", type: "video", duration: "short", sort: "date" }), {
    uploaded: "hour",
    duration: "short",
    sort: "date",
  });
  assert.deepEqual(filtersToSql({ type: "channel", sort: "views" }), { sort: "views" });
});

test("filters: duration bounds match search_videos (short < 4 min, medium 4 to 20, long > 20)", () => {
  assert.deepEqual(durationBounds("short"), { max: 240 });
  assert.deepEqual(durationBounds("medium"), { min: 240, max: 1200 });
  assert.deepEqual(durationBounds("long"), { min: 1200 });
  assert.deepEqual(durationBounds(undefined), {});
});

test("filters: type picks videos, channels or both", () => {
  assert.equal(showsVideos({}), true);
  assert.equal(showsChannels({}), true);
  assert.equal(showsVideos({ type: "channel" }), false);
  assert.equal(showsChannels({ type: "video" }), false);
  assert.equal(showsChannels({ uploaded: "week" }), false, "channels have no upload date");
  assert.equal(showsChannels({ sort: "views" }), false);
  assert.equal(showsChannels({ type: "channel", uploaded: "week" }), true);
});

test("filters: a click picks, a second click clears, and the URL keeps the 2019 shape", () => {
  let f = toggleFilter({}, "uploaded", "today");
  assert.deepEqual(f, { uploaded: "today" });
  f = toggleFilter(f, "uploaded", "week");
  assert.deepEqual(f, { uploaded: "week" }, "one value per column");
  f = toggleFilter(f, "sort", "views");
  assert.equal(resultsHref("bread club", f), "/results?search_query=bread+club&uploaded=week&sort=views");
  f = toggleFilter(f, "uploaded", "week");
  assert.deepEqual(f, { sort: "views" });
  f = toggleFilter(f, "sort", "relevance");
  assert.deepEqual(f, {});
  assert.equal(isActive({}, "sort", "relevance"), true);
  assert.deepEqual(toggleFilter({}, "duration", "forever"), {}, "unknown values are ignored");
});

// Cursor ---------------------------------------------------------------------------

test("cursor: the sort key round trips exactly", () => {
  const id = "5E507EAA-951C-4556-A482-7C46A1729169";
  for (const key of [1.468719720840454, 0.44317084550857544, 1793814089786911, 0, 12345]) {
    assert.deepEqual(decodeSearchCursor(encodeSearchCursor({ key, id })), { key, id: id.toLowerCase() });
  }
  for (const bad of [null, "", "!!", btoa("1|nope"), btoa("x|5e507eaa-951c-4556-a482-7c46a1729169"), "a".repeat(300)]) {
    assert.equal(decodeSearchCursor(bad), null);
  }
});

// Snippet highlighter --------------------------------------------------------------

test("highlight: matched words are bold, matching as prefixes and ignoring case", () => {
  assert.deepEqual(highlight("Testing ovens for bread, a test.", ["test", "bread"]), [
    { text: "Testing", bold: true },
    { text: " ovens for ", bold: false },
    { text: "bread", bold: true },
    { text: ", a ", bold: false },
    { text: "test", bold: true },
    { text: ".", bold: false },
  ]);
  assert.deepEqual(highlight("Nothing here", ["bread"]), [{ text: "Nothing here", bold: false }]);
  assert.deepEqual(highlight("", ["bread"]), []);
});

test("highlight: words in the middle of other words are not bold", () => {
  assert.deepEqual(highlight("Contest results", ["test"]), [{ text: "Contest results", bold: false }]);
});

test("highlight: the pieces join back to the same text", () => {
  const text = "Fluffy pancakes, ten minutes. Pancakes again!";
  assert.equal(
    highlight(text, ["pancake", "ten"]).map((p) => p.text).join(""),
    text,
  );
});

test("snippet: short descriptions stay whole, with line breaks flattened", () => {
  assert.equal(snippet("Line one\n\nline   two", ["line"]), "Line one line two");
  assert.equal(snippet("", ["x"]), "");
});

test("snippet: a far match starts the window near it, cut at a word with dots", () => {
  const text = `${"filler words ".repeat(20)}the sourdough starter needs time. ${"more text ".repeat(40)}`;
  const s = snippet(text, ["sourdough"], 120);
  assert.ok(s.startsWith("..."), s);
  assert.ok(s.includes("sourdough starter"), s);
  assert.ok(s.endsWith("..."), s);
  assert.ok(s.length <= 126, `${s.length}`);
  assert.ok(!s.includes("  "));
});

// Suggestions ----------------------------------------------------------------------

test("suggestions: lower case, deduplicated, blanks dropped, at most 10", () => {
  assert.deepEqual(dedupeSuggestions(["Bread Club", "bread  club", " BREAD CLUB ", "", null, 4, "bread with four ingredients"]), [
    "bread club",
    "bread with four ingredients",
  ]);
  const many = Array.from({ length: 30 }, (_, i) => `item ${i}`);
  assert.equal(dedupeSuggestions(many).length, SUGGEST_LIMIT);
  assert.deepEqual(dedupeSuggestions("not a list"), []);
});

test("suggestions: what was typed stays normal, the rest is bold", () => {
  assert.deepEqual(splitSuggestion("bread club", "Bre"), { typed: "bre", rest: "ad club" });
  assert.deepEqual(splitSuggestion("testing ovens", "oven"), { typed: "", rest: "testing ovens" });
});

// Recent searches ------------------------------------------------------------------

test("recent: newest first, no repeats, a ring of ten", () => {
  let list = [];
  for (let i = 1; i <= 12; i++) list = addRecent(list, `query ${i}`);
  assert.equal(list.length, RECENT_LIMIT);
  assert.equal(list[0], "query 12");
  assert.equal(list[9], "query 3", "the two oldest fell off");
  list = addRecent(list, "Query 5");
  assert.equal(list[0], "Query 5", "a repeat moves to the top");
  assert.equal(list.filter((x) => x.toLowerCase() === "query 5").length, 1);
  assert.equal(list.length, RECENT_LIMIT);
  assert.deepEqual(addRecent(["a"], "   "), ["a"], "blank queries are not kept");
});

test("recent: remove one, and broken storage reads as empty", () => {
  assert.deepEqual(removeRecent(["bread", "Desk", "moss"], "desk"), ["bread", "moss"]);
  assert.deepEqual(parseRecent(null), []);
  assert.deepEqual(parseRecent("not json"), []);
  assert.deepEqual(parseRecent('{"a":1}'), []);
  assert.deepEqual(parseRecent('["a", 3, "", "A", "b"]'), ["a", "b"]);
  assert.equal(parseRecent(JSON.stringify(Array.from({ length: 20 }, (_, i) => `q${i}`))).length, RECENT_LIMIT);
});
