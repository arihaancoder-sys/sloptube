#!/usr/bin/env node
// Fails when a file in the repo contains something that looks like a secret.
// Runs as part of `npm run lint`. The project is open source, so keys must
// only ever live in .env.local (gitignored) or on the server.
//
//   node scripts/check-secrets.mjs            the files in the working tree
//   node scripts/check-secrets.mjs --history  every added line in every commit
//                                             of every branch (git log -p --all)
//
// The patterns are built from pieces so this file does not match itself.

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();

const patterns = [
  { name: "Supabase secret key", re: new RegExp("sb_" + "secret_[A-Za-z0-9_-]{8,}") },
  { name: "Stripe live key", re: new RegExp("sk_" + "live_[A-Za-z0-9]{8,}") },
  { name: "Stripe test key", re: new RegExp("sk_" + "test_[A-Za-z0-9]{8,}") },
  { name: "AWS access key", re: new RegExp("AK" + "IA[0-9A-Z]{16}") },
  { name: "PEM private key or certificate", re: new RegExp("-----" + "BEGIN [A-Z ]+-----") },
  { name: "JWT (for example a legacy Supabase anon or service_role key)", re: new RegExp("eyJ" + "hbGci[A-Za-z0-9_-]{10,}") },
  { name: "GitHub token", re: new RegExp("\\b(gh" + "[pousr]_[A-Za-z0-9]{30,}|github" + "_pat_[A-Za-z0-9_]{20,})") },
  { name: "Slack token", re: new RegExp("\\bxo" + "x[abprs]-[A-Za-z0-9-]{10,}") },
  { name: "Google API key", re: new RegExp("\\bAI" + "za[0-9A-Za-z_-]{35}\\b") },
  { name: "Vercel token", re: new RegExp("\\b(vercel_[A-Za-z0-9]{20,}|VERCEL_TOKEN=[A-Za-z0-9]{20,})") },
  {
    // An R2 secret access key is 64 hex characters, an R2 access key id 32,
    // a Cloudflare API token 40 characters. Only flagged next to a hint word,
    // so content hashes in tests do not fire.
    name: "Cloudflare / R2 key",
    re: new RegExp("(secret|token|access.?key|r2|cloudflare)[^\\n]{0,40}?\\b([0-9a-f]{64}|[0-9a-f]{32}|[A-Za-z0-9_-]{40})\\b", "i"),
  },
  {
    // KEY=value lines as in a .env file, with a real looking value.
    name: "secret in a KEY=value line",
    re: new RegExp(
      "^\\s*(export\\s+)?[A-Z0-9_]*(SECRET|TOKEN|PASSWORD|PASSWD|SERVICE_ROLE_KEY|ACCESS_KEY_ID|PRIVATE_KEY|API_KEY)[A-Z0-9_]*=" +
        "['\"]?(?!replace_me|your|changeme|<)[A-Za-z0-9/+_.=-]{12,}",
    ),
  },
  {
    // Email addresses other than made up or no-reply ones.
    name: "email address (use an example.com address)",
    re: new RegExp(
      "\\b[A-Za-z0-9._%+-]+@(?!(?:[a-z0-9-]+\\.)*(?:example\\.(?:com|org|net)|example|localhost|test|invalid)\\b)" +
        "(?!users\\.noreply\\.)(?!noreply\\.)[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)*\\.[A-Za-z]{2,}\\b",
      "i",
    ),
    allow: (line) => /noreply@anthropic\.com|:\/\/[^/\s]*:[^/\s]*@|splitMention\(|@x\.com|@users\.noreply\.github\.com/.test(line),
  },
  {
    // Public IPv4 addresses (private ranges, loopback and the metadata
    // address used in the SSRF tests are fine). SVG path data is skipped.
    name: "public IP address",
    re: new RegExp("(?<![\\d.,-])(?!(?:10|127|0)\\.)(?!192\\.168\\.)(?!172\\.(?:1[6-9]|2\\d|3[01])\\.)(?!169\\.254\\.)" +
      "(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)(?:\\.(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)){3}(?![\\d.])"),
    allow: (line) => /\bd=|"M\d|path|version|\d\.\d+\.\d+-/.test(line) || /\b\d+\.\d+\.\d+\.\d+\s*(?:<|\))/.test(line),
  },
];

const skipDirs = new Set(["node_modules", ".git", ".next", "out", "build", "coverage"]);
const skipFiles = new Set(["package-lock.json"]);
const binaryExt = /\.(ico|png|jpe?g|gif|webp|avif|svg|woff2?|ttf|otf|mp4|webm|pdf|zip|gz)$/i;

function skipped(file) {
  const base = file.split("/").pop() ?? file;
  return skipFiles.has(base) || binaryExt.test(file) || file.split("/").some((part) => skipDirs.has(part));
}

/** The problems on one line, as pattern names. */
function check(line) {
  const hits = [];
  for (const { name, re, allow } of patterns) {
    if (re.test(line) && !(allow && allow(line))) hits.push(name);
  }
  return hits;
}

function listFiles() {
  try {
    const out = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.split("\0").filter(Boolean);
  } catch {
    // Not a git checkout (for example inside a Docker build): walk the folder.
    const files = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        if (skipDirs.has(name) || name.startsWith(".env")) continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else files.push(relative(root, full));
      }
    };
    walk(root);
    return files;
  }
}

function scanTree() {
  let problems = 0;
  let scanned = 0;
  for (const file of listFiles()) {
    if (skipped(file)) continue;
    let text;
    try {
      text = readFileSync(join(root, file), "utf8");
    } catch {
      continue; // deleted but still listed, or unreadable
    }
    scanned++;
    text.split("\n").forEach((line, i) => {
      for (const name of check(line)) {
        problems++;
        console.error(`${file}:${i + 1}  looks like a ${name}`);
      }
    });
  }
  return { problems, summary: `${scanned} files clean` };
}

function scanHistory() {
  const res = spawnSync("git", ["log", "-p", "--all", "--no-color", "--no-ext-diff", "--format=@@commit %H"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 1 << 30,
  });
  if (res.status !== 0) {
    console.error("check-secrets: git log failed. --history needs a git checkout.");
    process.exit(2);
  }
  let commit = "";
  let file = "";
  let commits = 0;
  let problems = 0;
  for (const line of res.stdout.split("\n")) {
    if (line.startsWith("@@commit ")) {
      commit = line.slice(9, 21);
      commits++;
    } else if (line.startsWith("+++ ")) {
      file = line.replace(/^\+\+\+ (b\/)?/, "");
    } else if (line.startsWith("+") && !skipped(file)) {
      for (const name of check(line.slice(1))) {
        problems++;
        console.error(`${commit} ${file}  looks like a ${name}`);
      }
    }
  }
  return { problems, summary: `${commits} commits on every branch clean` };
}

const { problems, summary } = process.argv.includes("--history") ? scanHistory() : scanTree();
if (problems) {
  console.error(`\ncheck-secrets: ${problems} possible secret(s) found. Move them to .env.local.`);
  process.exit(1);
}
console.log(`check-secrets: ${summary}`);
