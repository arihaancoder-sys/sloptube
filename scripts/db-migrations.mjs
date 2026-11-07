#!/usr/bin/env node
// All the database migrations in one go, for a new Supabase project.
//
//   node scripts/db-migrations.mjs --list
//       the files, in the order they run
//   node scripts/db-migrations.mjs > all-migrations.sql
//       one SQL file with every migration in order, to paste into the
//       Supabase SQL editor and run once
//   node scripts/db-migrations.mjs --apply "postgresql://..."
//       runs every file in order with psql (stops at the first error). The
//       connection string is on the project's Connect page (Session pooler).
//       Pass it as an argument or in DATABASE_URL; it holds the database
//       password, so never commit it or paste it into an issue.
//   --from 018   (with any of the above) starts at that number, for a project
//       that already has the earlier ones
//
// Each file is safe to run twice in a row, but a later file can change what an
// earlier one made (012's comment_cards view is widened by 016, for example),
// so on a project that already has migrations, run only the new ones (--from).

import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const dir = resolve(new URL("../supabase/migrations", import.meta.url).pathname);

/** The migration files in run order: 000_x.sql, 001_y.sql, ... */
export function migrationFiles(folder = dir) {
  return readdirSync(folder)
    .filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name))
    .sort();
}

function main(argv) {
  const fromAt = argv.indexOf("--from");
  const from = fromAt === -1 ? "" : String(argv[fromAt + 1] ?? "").padStart(3, "0");
  if (fromAt !== -1 && !/^\d{3}$/.test(from)) {
    console.error("--from takes a migration number, like --from 018.");
    return 2;
  }
  const files = migrationFiles().filter((f) => f.slice(0, 3) >= from);
  if (argv.includes("--list")) {
    for (const f of files) console.log(f);
    return 0;
  }
  const at = argv.indexOf("--apply");
  if (at !== -1) {
    const url = argv[at + 1] && !argv[at + 1].startsWith("--") ? argv[at + 1] : process.env.DATABASE_URL;
    if (!url) {
      console.error("Pass the connection string after --apply or set DATABASE_URL.");
      return 2;
    }
    for (const f of files) {
      console.error(`applying ${f}`);
      const res = spawnSync("psql", [url, "-v", "ON_ERROR_STOP=1", "-q", "-f", join(dir, f)], { stdio: "inherit" });
      if (res.error) {
        console.error(`psql could not start (${res.error.message}). Install the PostgreSQL client or paste the bundle into the SQL editor.`);
        return 1;
      }
      if (res.status !== 0) {
        console.error(`stopped at ${f}`);
        return res.status ?? 1;
      }
    }
    console.error(`done: ${files.length} migrations applied`);
    return 0;
  }
  const out = [`-- sloptube: every migration in supabase/migrations, in order (${files.length} files).`, ""];
  for (const f of files) {
    out.push(`-- ===== ${f} =====`, readFileSync(join(dir, f), "utf8").trimEnd(), "");
  }
  process.stdout.write(out.join("\n") + "\n");
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = main(process.argv.slice(2));
