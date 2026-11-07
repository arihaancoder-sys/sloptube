// Feature 15: the contact form rules and the site config.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { BODY_MAX, CONTACT_PER_DAY, CONTACT_TOPICS, cleanContact, contactProblem, isEmail, launchErrorCode, launchErrorMessage, launchStatus } from "../lib/launch/rules.ts";
import { isPlaceholder, siteConfig } from "../site.config.ts";

const ok = { name: "Sam", email: "sam@example.com", topic: "general", body: "Hello there, a message." };

test("contactProblem checks in the same order as contact_send", () => {
  assert.equal(contactProblem(ok), null);
  assert.equal(contactProblem({ ...ok, name: "   " }), "bad_name");
  assert.equal(contactProblem({ ...ok, name: "x".repeat(81) }), "bad_name");
  assert.equal(contactProblem({ ...ok, email: "not-an-email" }), "bad_email");
  assert.equal(contactProblem({ ...ok, email: "a@b" }), "bad_email");
  assert.equal(contactProblem({ ...ok, topic: "jobs" }), "bad_topic");
  assert.equal(contactProblem({ ...ok, topic: "" }), null, "an empty topic is general");
  assert.equal(contactProblem({ ...ok, body: "  short   " }), "too_short");
  assert.equal(contactProblem({ ...ok, body: "x".repeat(BODY_MAX + 1) }), "too_long");
  assert.equal(contactProblem({ ...ok, name: "", email: "bad" }), "bad_name", "the first problem wins");
});

test("cleanContact matches the SQL cleaning", () => {
  assert.deepEqual(cleanContact({ name: "  Sam   Lee ", email: " Sam@Example.COM ", topic: "", body: "  hi there friend  " }), {
    name: "Sam Lee",
    email: "sam@example.com",
    topic: "general",
    body: "hi there friend",
  });
  assert.ok(isEmail("a.b+c@example.co.uk"));
  assert.ok(!isEmail("a b@example.com"));
});

test("the numbers and topics are the same as 017_launch.sql", () => {
  const sql = readFileSync(new URL("../supabase/migrations/017_launch.sql", import.meta.url), "utf8");
  assert.match(sql, new RegExp(`contact_per_day\\(\\) returns int language sql immutable set search_path = '' as \\$\\$ select ${CONTACT_PER_DAY} \\$\\$`));
  const topics = CONTACT_TOPICS.map((t) => `'${t}'`).join(", ");
  assert.ok(sql.includes(`topic in (${topics})`), "the topic check");
  assert.ok(sql.includes(`clean_topic not in (${topics})`), "contact_send's topic check");
  assert.ok(sql.includes(`char_length(body) between 10 and ${BODY_MAX}`));
  for (const key of ["maintenance", "launch"]) assert.match(sql, new RegExp(`'${key}',[\\s\\S]*?'off'\\s*\\)\\s*on conflict \\(key\\) do nothing`));
});

test("error codes, texts and statuses", () => {
  assert.equal(launchErrorCode("rate_limited"), "rate_limited");
  assert.equal(launchErrorCode("something odd"), "failed");
  assert.match(launchErrorMessage("rate_limited"), /5 messages today/);
  assert.equal(launchStatus("rate_limited"), 429);
  assert.equal(launchStatus("launch_off"), 403);
  assert.equal(launchStatus("not_admin"), 404);
  assert.equal(launchStatus("no_db"), 503);
  assert.equal(launchStatus("bad_email"), 400);
});

test("site.config.ts ships with placeholders, not a made up company", () => {
  assert.equal(siteConfig.ownerName, "OWNER_NAME");
  assert.equal(siteConfig.contactEmail, "CONTACT_EMAIL");
  assert.ok(isPlaceholder(siteConfig.ownerName));
  assert.ok(!isPlaceholder("Sam Lee"));
  assert.ok(!isPlaceholder("hello@example.com"));
});
