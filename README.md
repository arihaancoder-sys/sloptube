# sloptube

<p align="center">
  <img src="public/press/sloptube-logo.svg" alt="sloptube" width="280">
</p>

<p align="center">
  A video platform, built in the open one feature at a time.
</p>

sloptube is an open source video site with the feel of the 2019 to 2020 era:
channels, uploads, a watch page with HLS playback, a home feed, subscriptions,
search, likes, comments, Snips (short vertical videos), a creator studio with
analytics, and moderation. Each feature was built in its own session and filmed
for a video series, so the code, the commits and the docs are meant to be easy
to follow.

Built with Next.js 16, React 19, Tailwind 4, zustand and Supabase (Postgres and
Auth). Video files live on Cloudflare R2, a small ffmpeg worker turns uploads
into HLS, and hls.js plays them. Light by default, with a dark theme.

![The home feed in the light theme](docs/screenshots/home-light.webp)

| Watch page | Snips | Watch page, dark |
| --- | --- | --- |
| ![A watch page with the player, the description and Up next](docs/screenshots/watch-light.webp) | ![A Snip playing in the vertical feed, dark theme](docs/screenshots/snips-dark.webp) | ![A watch page in the dark theme](docs/screenshots/watch-dark.webp) |

| Dark theme | Channel page | On a phone |
| --- | --- | --- |
| ![The home feed in the dark theme](docs/screenshots/home-dark.webp) | ![A channel page with its uploads](docs/screenshots/channel-light.webp) | ![The home feed at phone width](docs/screenshots/phone-home.webp) |

All the content in the screenshots is made up: test pattern videos and invented
channels from `npm run demo`.

## Status, honestly

- It is built for a video series and as a learning resource, not as a hardened
  product. It has unit tests, smoke tests and scripted browser checks, but it
  has not been through a security audit and has not run at scale.
- Every feature is behind a flag. On a new database all of them start switched
  off except accounts and the admin flag panel, so you choose what is live.
- The app runs without a database (it says "database not connected"), and
  `npm run demo` shows a filled site with no accounts and no setup. Uploading
  and playing your own videos needs your own Supabase project, an R2 bucket and
  the encoder worker.
- Only the latest `main` gets fixes.

## Quick start

You need [Node.js 22](https://nodejs.org/) with npm. ffmpeg is only needed for
the demo and the encoder.

```bash
git clone https://github.com/myfilehero/sloptube.git
cd sloptube
npm ci
cp .env.example .env.local   # leave it empty for now
npm run dev                  # http://localhost:3000, "database not connected"
```

To click around a filled site instead (made up content, nothing to set up):

```bash
npm run build
npm run demo                 # http://localhost:3470
```

The full setup, with your own database, uploads and a server, is below in
[Run it yourself](#run-it-yourself).

## Roadmap

| # | Feature | Status |
| --- | --- | --- |
| 0 | Bootstrap: app shell, database wiring, deploy pipeline | done |
| 1 | Accounts | done, behind the `accounts` flag |
| 2 | Channels | done, behind the `channels` flag |
| 3 | Upload | done, behind the `upload` flag |
| 4 | Processing | done, behind the `processing` flag |
| 5 | Watch page | done, behind the `watch` flag |
| 6 | Home feed | done, behind the `feed` flag |
| 7 | Subscriptions | done, behind the `subscriptions` flag |
| 8 | Search | done, behind the `search` flag |
| 9 | Likes and views | done, behind the `engagement` flag |
| 10 | Comments | done, behind the `comments` flag |
| 11 | Snips | done, behind the `shorts` flag |
| 12 | Creator studio | done, behind the `studio` flag |
| 13 | Stats | done, behind the `stats` flag |
| 14 | Moderation | done, behind the `moderation` flag |
| 15 | Launch pack | done, behind the `launch` and `maintenance` flags |
| 16 | Yapin' integration | done, behind the `yapin` flag |
| 17 | Flag panel (Ctrl+Shift+S, admins) | done, behind the `flag_panel` flag |
| 18 | The shell follows the flags: guide links, search box and bell appear with their feature | done |

## Run it yourself

### What you need

- [Node.js 22](https://nodejs.org/) (with npm) and [git](https://git-scm.com/)
- [ffmpeg](https://ffmpeg.org/download.html) for the demo, the encoder worker and
  some checks (not needed to just run the site)
- For a real site: a free [Supabase](https://supabase.com/) project, and for
  uploads a [Cloudflare R2](https://developers.cloudflare.com/r2/) bucket

### 1. Get the code and install

```bash
git clone https://github.com/myfilehero/sloptube.git
cd sloptube
npm ci
cp .env.example .env.local
npm run dev        # http://localhost:3000
```

With an empty `.env.local` the site runs and says "database not connected".
`npm run dev` then shows previews of the upload and studio pages with sample
data. Every setting is explained in [`.env.example`](.env.example).

### 2. Try the demo (no accounts needed)

To click around a filled site without setting anything up:

```bash
npm run build
npm run demo       # http://localhost:3470, Ctrl+C to stop
```

The demo runs the production build against a small local stand in for
Supabase ([`scripts/launch-mock.mjs`](scripts/launch-mock.mjs)) with three made
up channels, a dozen videos and a few Snips, all a test pattern made by ffmpeg.
Nothing is saved and nothing touches the network. You browse as a signed out
visitor.

### 3. Connect a database (Supabase)

1. Create a project at [supabase.com/dashboard](https://supabase.com/dashboard).
2. On the project's [API keys page](https://supabase.com/dashboard/project/_/settings/api-keys),
   copy the **Project URL** and the **publishable key** into `.env.local`:

   ```bash
   NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   ```

   Both are public by design: they reach every browser, and row level security
   on every table protects the data. The **secret** key is different: it never
   goes in `.env.local` unless you switch on Sign in with Yapin'.
   In the docs below, `<project-ref>` is the part of your Project URL before
   `.supabase.co`, and dashboard links with `/project/_/` ask you to pick your
   project.
3. Switch on `pg_cron` under [Database > Extensions](https://supabase.com/dashboard/project/_/database/extensions)
   (for the hourly stats and the daily trash purge).
4. Apply every migration in order, `000` to the last one. Either paste them all
   at once into the [SQL editor](https://supabase.com/dashboard/project/_/sql/new):

   ```bash
   npm run db:migrations > all-migrations.sql   # then paste and Run
   ```

   or run them with `psql` and the connection string from the project's
   **Connect** button (it holds your database password, keep it out of git):

   ```bash
   npm run db:migrations -- --apply "postgresql://..."
   ```

   Later, when you pull new migrations, run only the new ones, for example
   `npm run db:migrations -- --from 021 --apply "postgresql://..."`: a later file
   can change what an earlier one made, so the whole set is meant to run once.
   What each file adds is in [`supabase/migrations/README.md`](supabase/migrations/README.md).
5. In [Authentication > URL Configuration](https://supabase.com/dashboard/project/_/auth/url-configuration)
   add `http://localhost:3000/auth/callback` to the redirect URLs (Google sign in
   is optional, see [Accounts](#accounts)).
6. Restart `npm run dev`, sign up, then make yourself an admin in the SQL editor:

   ```sql
   update public.profiles set role = 'admin' where username = '<your username>';
   ```

### 4. Switch features on

Every feature starts `off` (except `accounts` and `flag_panel`). As an admin,
press **Ctrl+Shift+S** (Cmd+Shift+S on a Mac) anywhere on the site to open the
flag panel and switch each one to **Off**, **Me** or **Everyone**. More in
[Feature flags](docs/features.md#feature-flags).

### 5. Uploads and the encoder

1. Create an R2 bucket, an API token and the CORS rule, then put the four
   `R2_*` settings in `.env.local`: [Uploads (R2)](docs/features.md#uploads-r2).
2. Run the encoder worker, which turns uploads into HLS with ffmpeg. Locally:

   ```bash
   cp worker/.env.example worker/.env     # fill in the Supabase secret key and R2
   npm ci --prefix worker
   node --env-file=worker/.env worker/index.mjs
   ```

   On a server use the Docker image: [`ops/encoder/README.md`](ops/encoder/README.md).
3. Switch on `upload`, `processing` and `watch`, upload a clip at `/upload` and
   watch it in `/studio/videos`. Any video works as demo content; a test pattern
   needs no rights clearance:

   ```bash
   ffmpeg -f lavfi -i testsrc2=size=1280x720:rate=30 -f lavfi -i sine=frequency=440 \
     -t 20 -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest demo.mp4
   ```

   Use made up accounts (any `@example.com` address) for test viewers and
   commenters, never real people's data.

### 6. Put it online

[`docs/launch.md`](docs/launch.md) is the full self hosting checklist (domains,
the servers, every setting, the flags) and [`ops/app/README.md`](ops/app/README.md)
puts the Docker image on a server.

### Checks

```bash
npm run typecheck
npm run lint            # ESLint and the secret scan (scripts/check-secrets.mjs)
npm test                # unit tests in tests/
npm run build
npx next start -p 3123 & node scripts/smoke.mjs http://localhost:3123
npm ci --prefix worker && node --test worker/
```

The same checks run on every pull request (`.github/workflows/ci.yml`). The full
list, with the screenshot scripts, is in [CONTRIBUTING.md](CONTRIBUTING.md).

## Documentation

- How each feature works and how to set it up: [`docs/features.md`](docs/features.md)
- Launch checklist, flags cheat sheet, demo script and the Yapin' setup: [`docs/launch.md`](docs/launch.md)
- Put it on a server: [`ops/app/README.md`](ops/app/README.md)
- Set up the encoder: [`ops/encoder/README.md`](ops/encoder/README.md)
- Database changes: [`supabase/migrations/README.md`](supabase/migrations/README.md)
- Health check: `/api/health`. Running version: `/api/version`.

## Project layout

| Path | What is in it |
| --- | --- |
| `app/` | Next.js App Router pages and API routes |
| `components/` | React components, one folder per feature |
| `lib/` | Server and browser logic, the Supabase clients, flags, stores |
| `supabase/migrations/` | Numbered SQL files, applied in order |
| `worker/` | The ffmpeg encoder worker (its own package) |
| `ops/` | Dockerfiles, compose files and install scripts for the servers |
| `scripts/` | The demo, the secret scan, the smoke test and the screenshot checks |
| `tests/` | `node:test` unit tests |
| `shots/` | Screenshots the check scripts save, light and dark |

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md)
first: one branch per change, every check passing, new features behind a flag.
Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md). Please
report security problems privately, as described in [SECURITY.md](SECURITY.md),
not in a public issue.

## License

sloptube is released under the [MIT license](LICENSE). Third party notices,
including FFmpeg and the Material icons, are in [NOTICE.md](NOTICE.md).

sloptube is an independent project. It is not affiliated with, endorsed by or
sponsored by YouTube or Google. The sloptube name and the green slop mark are
the project's own.
