# sloptube

A YouTube-style video platform built in the open, one feature per session.
Owner: Antic. Sessions are filmed, so keep the structure clean and docs readable.

@AGENTS.md

## Stack (decided, do not change)

- Next.js 16 (App Router, TypeScript, Tailwind v4, Cache Components on). Read
  `node_modules/next/dist/docs/` before using a Next API: it differs from older versions.
- React 19, zustand for client state (`lib/store/`)
- Supabase (Postgres + Auth). Clients: `lib/supabase/client.ts` (browser) and
  `lib/supabase/server.ts` (server, cookies). Both return `null` when the settings are
  missing; the UI must keep working and show "database not connected".
- Supabase settings are read at request time on the server (`lib/supabase/env.ts`),
  never frozen into the build, so one Docker image works everywhere.
- Cloudflare R2 for files and hls.js for playback (later features)
- The 2019 to 2020 YouTube look: light by default with a dark theme toggle, Roboto,
  colors as CSS variables in `app/globals.css`. Node 22, npm.
- Every feature ships behind a row in `public.feature_flags`: `flagOn(key)` from
  `lib/flags.ts` on the server, `useFlag(key)` from `lib/store/session.ts` in the browser.
- The project is open source (MIT): no secrets, no real user data, no internal hostnames.

## Run it

```bash
npm install
cp .env.example .env.local   # then fill in the publishable key
npm run dev                  # http://localhost:3000
```

## Checks before any push

All of these must pass:

```bash
npm run typecheck
npm run lint                 # also scans for secrets (scripts/check-secrets.mjs)
npm test                     # node:test unit tests in tests/
rm -rf .next && npm run build
npx next start -p 3123 &
node scripts/smoke.mjs http://localhost:3123
```

Worker changes also need: `npm ci --prefix worker && node --test worker/`

If Docker is available, also: `docker build -f ops/app/Dockerfile .` and
`docker build -f ops/encoder/Dockerfile worker/`

## Rules

- Every new feature on its own branch. Never push `main`. Shipping is `main` to `release`
  and is done by the owner.
- Database changes go in `supabase/migrations/` as the next numbered file, re-runnable
  (`if not exists`, `create or replace`, `drop policy if exists`), RLS on every table.
  Never edit an applied migration. See `supabase/migrations/README.md`.
- No em dashes in UI text or docs.
- The logo and names are our own: the green slop mark in `lib/brand.ts` (redraw the
  favicon with `node scripts/favicon.mjs`), and "Snips" for short vertical videos in
  the UI (URLs, flag keys and tables keep the old `shorts` name). Never bring back a
  red play button, a red rectangle mark or another site's product names.
- Never commit secrets. `.env.local` is gitignored; only `.env.example` is committed.
- Deploy files live in `ops/app/` (Dockerfile, compose, install.sh) and
  `ops/encoder/` for the encoder box. Keep each README in step with its files.
