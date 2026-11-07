import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CHOICES,
  PANEL_FLAGS,
  PANEL_FLAG_KEY,
  choiceOf,
  flagPanelErrorCode,
  flagPanelErrorMessage,
  flagPanelStatus,
  isPanelShortcut,
  modeOfChoice,
  nextChoice,
} from "../lib/flag-panel.ts";

test("the panel lists the demo flags in cheat sheet order, then maintenance", () => {
  const keys = PANEL_FLAGS.map((f) => f.key);
  assert.deepEqual(keys.slice(0, 3), ["accounts", "channels", "upload"]);
  assert.equal(keys.at(-2), "yapin");
  assert.equal(keys.at(-1), "maintenance");
  assert.deepEqual(PANEL_FLAGS.filter((f) => f.n !== null).map((f) => f.n), Array.from({ length: 16 }, (_, i) => i + 1));
  assert.ok(!keys.includes(PANEL_FLAG_KEY), "the panel's own flag is not a switch");
  assert.equal(new Set(keys).size, keys.length);
});

test("a row's switch position comes from the mode and whether the admin is listed", () => {
  assert.equal(choiceOf(undefined), null);
  assert.equal(choiceOf({ mode: "off", mine: true }), "off");
  assert.equal(choiceOf({ mode: "everyone", mine: false }), "everyone");
  assert.equal(choiceOf({ mode: "test", mine: true }), "me");
  assert.equal(choiceOf({ mode: "test", mine: false }), "test");
});

test("Me asks for test mode, the others for themselves", () => {
  assert.equal(modeOfChoice("me"), "test");
  assert.equal(modeOfChoice("off"), "off");
  assert.equal(modeOfChoice("everyone"), "everyone");
  assert.deepEqual(CHOICES.map((c) => c.mode), ["off", "test", "everyone"]);
});

test("the keyboard cycles Off, Me, Everyone", () => {
  assert.equal(nextChoice(null), "off");
  assert.equal(nextChoice("off"), "me");
  assert.equal(nextChoice("me"), "everyone");
  assert.equal(nextChoice("test"), "everyone");
  assert.equal(nextChoice("everyone"), "off");
});

test("Ctrl+Shift+S or Cmd+Shift+S, nothing else", () => {
  const k = (o) => ({ key: "s", ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...o });
  assert.equal(isPanelShortcut(k({ ctrlKey: true, shiftKey: true })), true);
  assert.equal(isPanelShortcut(k({ metaKey: true, shiftKey: true, key: "S" })), true);
  assert.equal(isPanelShortcut(k({ ctrlKey: true })), false, "plain Ctrl+S is the browser's");
  assert.equal(isPanelShortcut(k({ shiftKey: true })), false);
  assert.equal(isPanelShortcut(k({ ctrlKey: true, shiftKey: true, altKey: true })), false);
  assert.equal(isPanelShortcut(k({ ctrlKey: true, shiftKey: true, key: "a" })), false);
});

test("error codes from the database map to messages and statuses", () => {
  assert.equal(flagPanelErrorCode("not_admin"), "not_admin");
  assert.equal(flagPanelErrorCode("  not_found "), "not_found");
  assert.equal(flagPanelErrorCode("permission denied for function set_feature_flag"), "not_signed_in");
  assert.equal(flagPanelErrorCode("something odd"), "failed");
  assert.equal(flagPanelErrorCode(null), "failed");
  assert.match(flagPanelErrorMessage("not_set_up"), /020/);
  assert.match(flagPanelErrorMessage("nope"), /Try again/);
  assert.equal(flagPanelStatus("not_admin"), 404);
  assert.equal(flagPanelStatus("not_signed_in"), 401);
  assert.equal(flagPanelStatus("not_set_up"), 503);
  assert.equal(flagPanelStatus("bad_mode"), 400);
  assert.equal(flagPanelStatus("failed"), 500);
});
