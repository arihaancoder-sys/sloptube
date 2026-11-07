// Checks that keep the repository ready to be public: the migrations run in a
// clean order, the secret scan catches keys, and .env.example names every
// setting the code reads.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { migrationFiles } from "../scripts/db-migrations.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);

test("migrations are numbered 000, 001, ... with no gaps or doubles", () => {
  const files = migrationFiles();
  assert.ok(files.length > 20);
  files.forEach((f, i) => assert.equal(f.slice(0, 3), String(i).padStart(3, "0"), `${f} is out of order`));
});

test("db-migrations bundles every file in order", () => {
  const res = spawnSync(process.execPath, [join(root, "scripts/db-migrations.mjs")], { encoding: "utf8", maxBuffer: 1 << 26 });
  assert.equal(res.status, 0);
  const headers = [...res.stdout.matchAll(/^-- ===== (\S+) =====$/gm)].map((m) => m[1]);
  assert.deepEqual(headers, migrationFiles());
});

function scan(files) {
  const dir = mkdtempSync(join(tmpdir(), "secrets-"));
  try {
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
    return spawnSync(process.execPath, [join(root, "scripts/check-secrets.mjs")], { cwd: dir, encoding: "utf8" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("check-secrets passes placeholders and made up data", () => {
  const res = scan({
    "ok.txt": [
      "R2_SECRET_ACCESS_KEY=",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_replace_me",
      "write to sam@example.com or noreply@anthropic.com",
      "listen on 127.0.0.1 and 10.0.0.5",
      'const YAPIN_CLIENT_SECRET_ENV = "YAPIN_CLIENT_SECRET";',
    ].join("\n"),
  });
  assert.equal(res.status, 0, res.stderr);
});

test("check-secrets catches keys, real addresses and public IPs", () => {
  const hex64 = "0123456789abcdef".repeat(4);
  const cases = {
    "r2.txt": `R2_SECRET_ACCESS_KEY=${hex64}`,
    "sb.txt": "key: " + "sb_" + "secret_abcdefghijklmnop",
    "jwt.txt": "eyJ" + "hbGciOiJIUzI1NiJ9.e30.x",
    "gh.txt": "token " + "gh" + "p_" + "a".repeat(36),
    "mail.txt": "ask " + "someone" + "@" + "gmail.com",
    "ip.txt": "ssh root@" + ["5", "75", "1", "9"].join("."),
  };
  for (const [name, text] of Object.entries(cases)) {
    const res = scan({ [name]: text });
    assert.equal(res.status, 1, `${name} was not caught`);
  }
});

test(".env.example names every setting the app reads", () => {
  const example = readFileSync(join(root, ".env.example"), "utf8");
  for (const name of [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "FLAGS_PAGE",
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET",
    "MEDIA_PUBLIC_URL",
    "SITE_URL",
    "YAPIN_CLIENT_ID",
    "YAPIN_CLIENT_SECRET",
    "SUPABASE_SERVICE_ROLE_KEY",
  ]) {
    assert.match(example, new RegExp(`^${name}=`, "m"), `${name} is missing from .env.example`);
  }
  assert.doesNotMatch(example, /\.supabase\.co/, "no real project URL in .env.example");
});

test("worker/.env.example names every setting the worker reads", () => {
  const example = readFileSync(join(root, "worker/.env.example"), "utf8");
  const env = readFileSync(join(root, "worker/lib/env.mjs"), "utf8");
  const names = new Set([...env.matchAll(/"([A-Z][A-Z0-9_]{3,})"/g)].map((m) => m[1]));
  for (const name of names) assert.match(example, new RegExp(`^${name}=`, "m"), `${name} is missing from worker/.env.example`);
});
