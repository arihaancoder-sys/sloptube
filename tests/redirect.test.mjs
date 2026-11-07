import assert from "node:assert/strict";
import { test } from "node:test";
import { safeNext } from "../lib/accounts/redirect.ts";

test("keeps paths on this site", () => {
  assert.equal(safeNext("/settings"), "/settings");
  assert.equal(safeNext("/watch/abc?t=10"), "/watch/abc?t=10");
});

test("refuses other sites and odd values", () => {
  for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "settings", "", null, undefined, "/a\nb"]) {
    assert.equal(safeNext(bad), "/", String(bad));
  }
});
