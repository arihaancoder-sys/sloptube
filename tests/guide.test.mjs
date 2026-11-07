import assert from "node:assert/strict";
import { test } from "node:test";
import { mainGuide, railGuide, searchShown, youGuide } from "../lib/guide.ts";

test("with everything off the guide is only Home, no you section, no search", () => {
  assert.deepEqual(mainGuide({}), ["home"]);
  assert.deepEqual(youGuide({}), []);
  assert.deepEqual(railGuide({}), ["home"]);
  assert.equal(searchShown({}), false);
});

test("each link appears with its feature, in 2019 order", () => {
  assert.deepEqual(mainGuide({ feed: true }), ["home", "trending"]);
  assert.deepEqual(mainGuide({ feed: true, shorts: true }), ["home", "shorts", "trending"]);
  assert.deepEqual(mainGuide({ feed: true, subscriptions: true }), ["home", "trending", "subscriptions"]);
  assert.deepEqual(mainGuide({ subscriptions: true }), ["home", "subscriptions"]);
  assert.deepEqual(youGuide({ engagement: true }), ["library", "history"]);
  assert.equal(searchShown({ search: true }), true);
});

test("the icon rail is the main section plus Library when there is one", () => {
  assert.deepEqual(railGuide({ feed: true, engagement: true }), ["home", "trending", "library"]);
  assert.deepEqual(railGuide({ shorts: true }), ["home", "shorts"]);
});
