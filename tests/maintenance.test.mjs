// Feature 15: maintenance mode's page and the paths that stay open.
import assert from "node:assert/strict";
import { test } from "node:test";
import { maintenanceHtml, maintenanceOpen, RETRY_AFTER_S } from "../lib/launch/maintenance.ts";

test("the maintenance page is one static document", () => {
  const html = maintenanceHtml("sloptube");
  assert.match(html, /^<!doctype html>/);
  assert.ok(html.includes('<meta name="robots" content="noindex">'));
  assert.ok(html.includes("We're doing some maintenance."));
  assert.ok(html.includes('data-error-state="maintenance"'));
  assert.ok(!/<script[^>]+src=/.test(html), "no outside scripts");
  assert.ok(!html.includes("—"), "no em dashes");
  assert.ok(maintenanceHtml("<b>").includes("&lt;b&gt;"), "the name is escaped");
  assert.ok(RETRY_AFTER_S > 0);
});

test("sign in, the auth callback, robots.txt and the health checks stay open", () => {
  for (const p of ["/login", "/signup", "/auth/callback", "/robots.txt", "/api/health", "/api/version"]) assert.ok(maintenanceOpen(p), p);
  for (const p of ["/", "/watch", "/api/feed", "/admin", "/loginx", "/sitemap.xml"]) assert.ok(!maintenanceOpen(p), p);
});
