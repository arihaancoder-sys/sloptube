import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateFlag } from "../lib/flags-core.ts";

const tester = "11111111-1111-1111-1111-111111111111";

test("off hides, everyone shows", () => {
  assert.equal(evaluateFlag({ mode: "off", users: [tester] }, tester), false);
  assert.equal(evaluateFlag({ mode: "everyone", users: [] }, null), true);
});

test("test mode is only on for listed users", () => {
  const flag = { mode: "test", users: [tester] };
  assert.equal(evaluateFlag(flag, tester), true);
  assert.equal(evaluateFlag(flag, "22222222-2222-2222-2222-222222222222"), false);
  assert.equal(evaluateFlag(flag, null), false);
});

test("an unknown flag is off", () => {
  assert.equal(evaluateFlag(undefined, tester), false);
});
