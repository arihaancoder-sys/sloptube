import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HANDLE_COOLDOWN_DAYS,
  bannerCrop,
  bannerFileProblem,
  channelTitle,
  compactCount,
  cooldownText,
  formatSubscribers,
  handleCooldown,
  handleProblem,
  linkProblem,
  normalizeHandle,
} from "../lib/channels/validation.ts";

const DAY = 24 * 60 * 60 * 1000;

test("accepts 3 to 30 lower case letters, numbers, underscores and dots", () => {
  for (const h of ["abc", "antic", "antic.builds", "slop_tube.42", "a".repeat(30), "a.b.c", "007"]) {
    assert.equal(handleProblem(h), null, h);
  }
});

test("rejects handles that are too short or too long", () => {
  assert.equal(handleProblem(""), "too_short");
  assert.equal(handleProblem("ab"), "too_short");
  assert.equal(handleProblem("a".repeat(31)), "too_long");
});

test("rejects other characters", () => {
  for (const h of ["has space", "dash-name", "Upper", "émile", "emoji😀x", "at@sign"]) {
    assert.equal(handleProblem(h), "bad_characters", h);
  }
});

test("rejects a dot first, last or twice in a row", () => {
  for (const h of [".antic", "antic.", "an..tic"]) assert.equal(handleProblem(h), "bad_dots", h);
});

test("rejects reserved handles", () => {
  for (const h of ["studio", "admin", "channel", "videos", "about", "settings"]) {
    assert.equal(handleProblem(h), "reserved", h);
  }
});

test("normalizes case, spaces and a leading @", () => {
  assert.equal(normalizeHandle("  @Antic.Builds "), "antic.builds");
  assert.equal(handleProblem(normalizeHandle("@Antic")), null);
});

test("the first handle change is always allowed", () => {
  assert.deepEqual(handleCooldown(null), { canChange: true });
});

test("a handle cannot change again within 14 days", () => {
  assert.equal(HANDLE_COOLDOWN_DAYS, 14);
  const changed = new Date("2026-11-01T12:00:00Z");
  const now = new Date(changed.getTime() + 3 * DAY);
  const c = handleCooldown(changed.toISOString(), now);
  assert.equal(c.canChange, false);
  assert.equal(c.daysLeft, 11);
  assert.equal(c.nextChangeAt.toISOString(), "2026-11-15T12:00:00.000Z");
  assert.match(cooldownText(c), /Nov 15, 2026 \(in 11 days\)/);
});

test("the cooldown ends exactly 14 days later", () => {
  const changed = new Date("2026-11-01T12:00:00Z");
  assert.equal(handleCooldown(changed, new Date(changed.getTime() + 14 * DAY - 1000)).canChange, false);
  assert.equal(handleCooldown(changed, new Date(changed.getTime() + 14 * DAY)).canChange, true);
  assert.equal(handleCooldown(changed, new Date(changed.getTime() + 30 * DAY)).canChange, true);
});

test("one day left reads as 1 day", () => {
  const changed = new Date("2026-11-01T00:00:00Z");
  const c = handleCooldown(changed, new Date(changed.getTime() + 13.5 * DAY));
  assert.match(cooldownText(c), /in 1 day\)/);
  assert.equal(cooldownText({ canChange: true }), null);
});

test("links must have a title and an https URL", () => {
  assert.equal(linkProblem({ title: "Site", url: "https://example.com" }), null);
  assert.match(linkProblem({ title: "", url: "https://example.com" }), /title/);
  assert.match(linkProblem({ title: "Site", url: "http://example.com" }), /https/);
  assert.match(linkProblem({ title: "Site", url: "javascript:alert(1)" }), /https/);
});

test("banner files: PNG, JPG or WebP up to 6 MB", () => {
  assert.equal(bannerFileProblem({ type: "image/webp", size: 6 * 1024 * 1024 }), null);
  assert.match(bannerFileProblem({ type: "image/webp", size: 6 * 1024 * 1024 + 1 }), /6 MB/);
  assert.match(bannerFileProblem({ type: "image/gif", size: 10 }), /PNG, JPG or WebP/);
});

test("banners are center cropped to the 2560 x 423 shape", () => {
  assert.deepEqual(bannerCrop(2560, 1440), { sx: 0, sy: 509, sw: 2560, sh: 423 });
  assert.deepEqual(bannerCrop(5120, 423), { sx: 1280, sy: 0, sw: 2560, sh: 423 });
});

test("subscriber counts read like 2019", () => {
  assert.equal(formatSubscribers(0), "No subscribers");
  assert.equal(formatSubscribers(1), "1 subscriber");
  assert.equal(formatSubscribers(999), "999 subscribers");
  assert.equal(formatSubscribers(1234), "1.2K subscribers");
  assert.equal(compactCount(12345), "12K");
  assert.equal(compactCount(3_456_789), "3.4M");
});

test("tab titles only use handle characters", () => {
  assert.equal(channelTitle("Antic"), "@antic | sloptube");
  assert.equal(channelTitle("%3Cscript%3E", "About"), "About | @script | sloptube");
});
