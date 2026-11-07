# Contributing to sloptube

Thanks for taking a look. sloptube is built in the open, one feature at a time,
and each feature is filmed. Small, readable changes are the easiest to merge.
Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).
Security problems go through private reporting, see [SECURITY.md](SECURITY.md).

## Run it

You need Node.js 22 and npm.

```bash
npm ci
cp .env.example .env.local   # optional: your Supabase URL and publishable key
npm run dev                  # http://localhost:3000
```

Without a key the app still runs and shows "database not connected". To see a
filled site without a database, `npm run build && npm run demo` (needs ffmpeg).
Setting up your own Supabase project is in "Run it yourself" in the
[README](README.md).

## One branch per feature

- Fork the repository (or branch, if you have access) from `main`, one branch
  per feature or fix, and open a pull request against `main`.
- Never push to `main` or `release`. The owner merges and ships. CI
  (`.github/workflows/ci.yml`) runs the checks below on every pull request.
- Commit per logical step with a clear message.

## Checks

Run all of these before you open a pull request:

```bash
npm run typecheck
npm run lint          # also runs scripts/check-secrets.mjs
npm run secrets:history  # the same scan over every commit on every branch
npm test              # node:test unit tests in tests/
rm -rf .next && npm run build
npx next start -p 3123 &
node scripts/smoke.mjs http://localhost:3123
npm ci --prefix worker && node --test worker/   # when worker/ changed
node scripts/watch-shots.mjs                     # when the player changed (ffmpeg, Playwright)
node scripts/feed-shots.mjs                      # when the feed or its cards changed (Playwright)
node scripts/subscriptions-shots.mjs             # when subscriptions, the guide or the bell changed (Playwright)
node scripts/search-shots.mjs                    # when the search box or /results changed (Playwright)
node scripts/engagement-shots.mjs                # when likes, view pings, resume or /feed/history changed (ffmpeg, Playwright)
node scripts/comments-shots.mjs                  # when comments or /studio/comments changed (ffmpeg, Playwright)
node scripts/shorts-shots.mjs                    # when /shorts, the shelf, the Snips tab or the upload box changed (ffmpeg, Playwright)
node scripts/studio-shots.mjs                    # when anything under /studio changed (ffmpeg, Playwright)
node scripts/stats-shots.mjs                     # when /studio/analytics, a video's analytics or the charts changed (Playwright)
node scripts/moderation-shots.mjs                # when reports, /admin, the word list or the removed notices changed (ffmpeg, Playwright)
node scripts/launch-shots.mjs                    # after the build, when the public pages, the footer, contact, SEO, the sitemap or maintenance changed (ffmpeg, Playwright)
node scripts/yapin-shots.mjs                     # after the build, when Sign in with Yapin', Connections, the share box, /embed or the announcements changed (ffmpeg, Playwright)
node scripts/a11y-check.mjs                      # after the build, before a release: axe-core and the player keys on home, watch and channel (ffmpeg, Playwright)
node scripts/lighthouse.mjs                      # after the build, before a release: Lighthouse on home, watch and channel at phone size (ffmpeg, Playwright)
node scripts/press-kit.mjs                       # when a screenshot /press uses changed (ffmpeg)
```

## Database changes

New tables, functions and policies go in `supabase/migrations/` as the next numbered
file. Read [`supabase/migrations/README.md`](supabase/migrations/README.md) first:
migrations must be re-runnable and every table needs row level security.

## New features ship behind a flag

Every new feature checks a row in `public.feature_flags` so it can be switched on
one step at a time. See "Feature flags" in the [README](README.md).

## No secrets, ever

- Keys go in `.env.local`, which is gitignored. Only `.env.example` is committed,
  with placeholder values.
- `npm run lint` fails if a file contains something that looks like a key or a
  private key. If it fires, remove the value instead of working around the check.
- No real user data, no internal hostnames or IP addresses in code, docs or tests.

## Style

- Plain words in UI text and docs. No em dashes.
- The look follows the 2019 to 2020 video site layout: light by default with a dark
  theme toggle. Colors live as CSS variables in `app/globals.css`.
- The logo and names are our own: the green slop mark (`lib/brand.ts`, redraw
  the favicon with `node scripts/favicon.mjs`) and "Snips" for short vertical
  videos. Please do not bring back a red play button or another site's names.
