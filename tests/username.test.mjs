import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeUsername, usernameProblem } from "../lib/accounts/validation.ts";

test("accepts 3 to 24 lower case letters, numbers and underscores", () => {
  for (const name of ["abc", "antic", "slop_tube_42", "a".repeat(24), "___", "007"]) {
    assert.equal(usernameProblem(name), null, name);
  }
});

test("rejects names that are too short or too long", () => {
  assert.match(usernameProblem("ab"), /at least 3/);
  assert.match(usernameProblem(""), /at least 3/);
  assert.match(usernameProblem("a".repeat(25)), /at most 24/);
});

test("rejects other characters", () => {
  for (const name of ["has space", "dash-name", "dot.name", "émile", "emoji😀x", "Upper"]) {
    assert.match(usernameProblem(name), /letters, numbers and underscores/, name);
  }
});

test("rejects reserved names", () => {
  assert.match(usernameProblem("admin"), /reserved/);
  assert.match(usernameProblem("settings"), /reserved/);
});

test("normalizes case, spaces and a leading @", () => {
  assert.equal(normalizeUsername("  @Antic_Dev "), "antic_dev");
  assert.equal(usernameProblem(normalizeUsername("Antic")), null);
});
