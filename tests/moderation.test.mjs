// Feature 14: the pure parts of moderation.
import assert from "node:assert/strict";
import { test } from "node:test";
import { groupActions, groupReports, rowToReport } from "../lib/moderation/queue.ts";
import {
  actionNeedsReason,
  isAction,
  moderationErrorCode,
  moderationErrorMessage,
  moderationStatus,
  reportProblem,
  REPORTS_PER_DAY,
} from "../lib/moderation/rules.ts";
import { activeStrikes, STRIKE_DAYS, STRIKE_LIMIT, strikeState, strikeWouldSuspend, strikesLabel } from "../lib/moderation/strikes.ts";
import { cleanWord, countLinks, findBlockedWord, isWord } from "../lib/moderation/words.ts";

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-04T12:00:00Z");
const ago = (days) => NOW - days * DAY;

// Strikes ---------------------------------------------------------------------------------

test("strikes count for 90 days, the limit is 3", () => {
  assert.equal(STRIKE_DAYS, 90);
  assert.equal(STRIKE_LIMIT, 3);
  assert.deepEqual(activeStrikes([ago(1), ago(89.9), ago(90), ago(200)], NOW), [ago(89.9), ago(1)]);
  // A strike from the future (a skewed clock) does not count.
  assert.deepEqual(activeStrikes([NOW + DAY], NOW), []);
  // ISO strings work, junk is ignored.
  assert.deepEqual(activeStrikes([new Date(ago(2)).toISOString(), "nope"], NOW), [ago(2)]);
});

test("three strikes in 90 days suspend, two do not", () => {
  assert.equal(strikeState([ago(10), ago(5)], NOW).suspends, false);
  assert.equal(strikeState([ago(10), ago(5), ago(1)], NOW).suspends, true);
  // The oldest is past 90 days: only two count.
  const s = strikeState([ago(91), ago(5), ago(1)], NOW);
  assert.equal(s.active, 2);
  assert.equal(s.left, 1);
  assert.equal(s.suspends, false);
  assert.equal(s.nextExpiry, ago(5) + 90 * DAY);
  assert.equal(strikeState([], NOW).nextExpiry, null);
  assert.equal(strikeState([ago(1), ago(2), ago(3), ago(4)], NOW).left, 0);
});

test("one more strike would suspend at two active", () => {
  assert.equal(strikeWouldSuspend([ago(1), ago(2)], NOW), true);
  assert.equal(strikeWouldSuspend([ago(1), ago(100)], NOW), false);
  assert.equal(strikesLabel(2), "2 of 3 strikes");
});

// The word matcher ----------------------------------------------------------------------

test("words are lowercase letters and digits with single separators", () => {
  assert.equal(cleanWord("  Bad   Word "), "bad word");
  for (const w of ["ab", "bad word", "don't", "x-rated", "scam*", "abc123"]) assert.equal(isWord(w), true, w);
  for (const w of ["a", "Bad", "bad  word", "bad!", "*scam", "sc*am", "a".repeat(41), " bad", "bad-", "é"]) assert.equal(isWord(w), false, w);
});

test("a listed word matches as a whole word, any case", () => {
  const list = ["badword", "scam*", "bad phrase"];
  assert.equal(findBlockedWord("This is a BADWORD.", list), "badword");
  assert.equal(findBlockedWord("badword", list), "badword");
  assert.equal(findBlockedWord("(badword)", list), "badword");
  // Inside a longer word it is fine.
  assert.equal(findBlockedWord("badwords and notbadword", list), null);
  // A trailing * takes any ending, but still starts at a word.
  assert.equal(findBlockedWord("total scammers", list), "scam*");
  assert.equal(findBlockedWord("antiscam tips", list), null);
  // Phrases match across any white space.
  assert.equal(findBlockedWord("a bad\n\tphrase here", list), "bad phrase");
  assert.equal(findBlockedWord("a badphrase", list), null);
  assert.equal(findBlockedWord("", list), null);
  assert.equal(findBlockedWord("anything", []), null);
  // The first in a to z order wins, invalid entries are skipped.
  assert.equal(findBlockedWord("scam badword", ["scam", "badword", "Bad!"]), "badword");
});

test("links are counted up to the next space", () => {
  assert.equal(countLinks("no links here, example.com is not one"), 0);
  assert.equal(countLinks("https://a.example http://b.example WWW.c.example"), 3);
  // www inside an https link is one link.
  assert.equal(countLinks("https://www.example.com/x"), 1);
  assert.equal(countLinks(Array.from({ length: 6 }, (_, i) => `https://e${i}.example`).join(" ")), 6);
});

// The queue -------------------------------------------------------------------------------

const row = (over) =>
  rowToReport({
    id: over.id,
    kind: "report",
    target_kind: "video",
    target_id: "v1",
    reason: "spam",
    details: "",
    created_at: new Date(NOW).toISOString(),
    reporter_name: "someone",
    target_label: "A video",
    video_id: "v1",
    channel_id: "c1",
    channel_handle: "maker",
    channel_name: "Maker",
    channel_suspended: false,
    channel_strikes: 1,
    owner_banned: false,
    owner_admin: false,
    target_removed: false,
    target_gone: false,
    ...over,
  });

test("reports group by target with counts and the latest reason", () => {
  const reports = [
    row({ id: "r1", reason: "spam", created_at: new Date(ago(3)).toISOString() }),
    row({ id: "r2", reason: "violent", details: "Gross", created_at: new Date(ago(1)).toISOString() }),
    row({ id: "r3", reason: "spam", created_at: new Date(ago(2)).toISOString() }),
    row({ id: "r4", target_kind: "comment", target_id: "k1", reason: "harassment", created_at: new Date(ago(0.5)).toISOString() }),
    row({ id: "r5", kind: "appeal", reason: "appeal", details: "Please", created_at: new Date(ago(4)).toISOString(), target_removed: true }),
  ];
  const groups = groupReports(reports);
  assert.equal(groups.length, 3);
  // The appeal leads, apart from the reports on the same video.
  assert.equal(groups[0].kind, "appeal");
  assert.equal(groups[0].count, 1);
  // Then the most reported target.
  const v = groups[1];
  assert.equal(v.key, "report:video:v1");
  assert.equal(v.count, 3);
  assert.equal(v.latest.id, "r2");
  assert.equal(v.latest.reason, "violent");
  assert.equal(v.latest.details, "Gross");
  assert.deepEqual(v.reasons, [{ reason: "spam", count: 2 }, { reason: "violent", count: 1 }]);
  assert.equal(v.firstAt, new Date(ago(3)).toISOString());
  assert.equal(groups[2].targetKind, "comment");
});

test("ties go to the most recent report", () => {
  const groups = groupReports([
    row({ id: "a", target_id: "old", created_at: new Date(ago(5)).toISOString() }),
    row({ id: "b", target_id: "new", created_at: new Date(ago(1)).toISOString() }),
  ]);
  assert.deepEqual(groups.map((g) => g.targetId), ["new", "old"]);
  assert.deepEqual(groupReports([]), []);
});

test("the queue offers the actions that fit", () => {
  const [g] = groupReports([row({ id: "x" })]);
  assert.deepEqual(groupActions(g), ["dismiss", "remove", "strike", "suspend", "ban"]);
  assert.deepEqual(groupActions({ ...g, removed: true, channel: { ...g.channel, suspended: true }, ownerBanned: true }), ["dismiss", "strike", "unsuspend", "unban"]);
  assert.deepEqual(groupActions({ ...g, targetKind: "channel" }), ["dismiss", "strike", "suspend", "ban"]);
  assert.deepEqual(groupActions({ ...g, ownerAdmin: true }), ["dismiss", "remove"]);
  assert.deepEqual(groupActions({ ...g, gone: true }), ["dismiss"]);
  assert.deepEqual(groupActions({ ...g, kind: "appeal", removed: true }), ["restore", "dismiss"]);
  assert.deepEqual(groupActions({ ...g, kind: "appeal", removed: false }), ["dismiss"]);
});

// Rules and errors -----------------------------------------------------------------------

test("reports need a reason, and words for something else", () => {
  assert.equal(reportProblem(null, ""), "bad_reason");
  assert.equal(reportProblem("rude", ""), "bad_reason");
  assert.equal(reportProblem("spam", ""), null);
  assert.equal(reportProblem("other", "  "), "details_required");
  assert.equal(reportProblem("other", "It is a scam"), null);
  assert.equal(reportProblem("spam", "x".repeat(501)), "details_too_long");
  assert.equal(REPORTS_PER_DAY, 10);
});

test("actions and error codes", () => {
  assert.equal(isAction("strike"), true);
  assert.equal(isAction("nuke"), false);
  assert.equal(actionNeedsReason("dismiss"), false);
  assert.equal(actionNeedsReason("ban"), true);
  assert.equal(moderationErrorCode("already_reported"), "already_reported");
  assert.equal(moderationErrorCode("permission denied for function report_target"), "not_signed_in");
  assert.equal(moderationErrorCode("boom"), "failed");
  assert.equal(moderationStatus("not_admin"), 404);
  assert.equal(moderationStatus("rate_limited"), 429);
  assert.equal(moderationStatus("already_reported"), 409);
  assert.match(moderationErrorMessage("blocked_words"), /isn't allowed/);
  assert.equal(moderationErrorMessage("whatever"), "Something went wrong. Try again.");
});
