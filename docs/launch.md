# Launch

Everything you need to run your own sloptube in public, plus the flags cheat
sheet and the script for the launch video.

- [Before you open it up](#before-you-open-it-up)
- [Self-hosting checklist](#self-hosting-checklist)
- [Flags cheat sheet](#flags-cheat-sheet)
- [Demo script](#demo-script)
- [Maintenance mode](#maintenance-mode)
- [SEO and sharing](#seo-and-sharing)
- [Yapin'](#yapin)
- [Lighthouse and accessibility results](#lighthouse-and-accessibility-results)

## Before you open it up

The public pages (`/about`, `/terms`, `/privacy`, `/guidelines`, `/press`,
`/contact`) and the footer read the owner's details from one file,
[`site.config.ts`](../site.config.ts):

| Setting | What it is | Shipped as |
| --- | --- | --- |
| `ownerName` | The person or organization that runs this copy, as it appears in the terms | `OWNER_NAME` |
| `contactEmail` | Where people and the press can write | `CONTACT_EMAIL` |
| `jurisdiction` | The country or state whose law the terms follow | `JURISDICTION` |
| `legalUpdated` | When the terms and the privacy page last changed | `LEGAL_UPDATED` |
| `siteName`, `description`, `sourceUrl` | The name in titles and share cards, one line about the site, the code | `sloptube`, the tagline, this repository |

Until a value is changed, the pages show the placeholder in capitals in a grey
box, so a missing detail is easy to spot. Nothing in the file is secret.

The terms and the privacy page are a plain starting point written from what the
code actually stores. They are not legal advice: read them, change what does not
fit, and ask someone who knows the law where you live.

The press screenshots come from `shots/`. After a screenshot script changes a
picture, run `node scripts/press-kit.mjs` to copy them to `public/press/` again.

## Self-hosting checklist

Work through it top to bottom. Each step links to the full guide.

### 1. Supabase project

- [ ] Create a project at [supabase.com](https://supabase.com/dashboard/projects).
- [ ] Copy the project URL and the **publishable** key (Project settings, API keys).
      For the encoder, also a **secret** key. The secret key goes in the app only
      for Sign in with Yapin' (see [Yapin'](#yapin)).
- [ ] Switch on `pg_cron` under **Database > Extensions** (the hourly stats rollup
      and the trash purge use it).
- [ ] Authentication > URL Configuration: the site URL and
      `https://<your domain>/auth/callback` as a redirect URL.
- [ ] Optional: Google sign in (see [Accounts](features.md#accounts)).

### 2. Migrations, in order

Run each file in the SQL editor, in number order. Every file is safe to run
again. See [`supabase/migrations/README.md`](../supabase/migrations/README.md).

- [ ] `000_init.sql`
- [ ] `001_feature_flags.sql`
- [ ] `002_profiles.sql`
- [ ] `003_avatars.sql`
- [ ] `004_channels.sql`
- [ ] `005_videos.sql`
- [ ] `006_processing.sql`
- [ ] `007_watch.sql`
- [ ] `008_feed.sql`
- [ ] `009_subscriptions.sql`
- [ ] `010_search.sql`
- [ ] `011_engagement.sql`
- [ ] `012_comments.sql`
- [ ] `013_shorts.sql`
- [ ] `014_studio.sql`
- [ ] `015_stats.sql`
- [ ] `016_moderation.sql`
- [ ] `017_launch.sql`
- [ ] `018_yapin.sql`
- [ ] `019_yapin_facts.sql`
- [ ] `020_flag_panel.sql`

Then make yourself an admin (sign up on the site first):

```sql
update public.profiles set role = 'admin' where username = '<your username>';
```

### 3. Flags

- [ ] Every flag starts `off` except `accounts` (`everyone`). Switch them
      on from the [flag panel](#flag-panel) (Ctrl+Shift+S, admins only) or in
      the table editor, `feature_flags` table, `mode` column. See the
      [cheat sheet](#flags-cheat-sheet) below.

### 4. R2 bucket and CORS

- [ ] Create a private bucket, for example `sloptube-videos`.
- [ ] Make an R2 API token with **Object Read & Write** on that bucket only.
- [ ] Add the CORS rule (PUT from your domain, expose `ETag`). The rule is in
      [Uploads (R2)](features.md#uploads-r2).
- [ ] Optional: a public domain on the bucket for `MEDIA_PUBLIC_URL`. Read
      [Watch page](features.md#watch-page) first.

### 5. Hetzner boxes

- [ ] The app server: [`ops/app/README.md`](../ops/app/README.md) (a CX23 is plenty).
- [ ] The encoder: [`ops/encoder/README.md`](../ops/encoder/README.md) (it needs the
      secret key and the R2 token).

### 6. GHCR images

- [ ] The images are built by GitHub Actions and pushed to GHCR:
      `ghcr.io/<owner>/sloptube` (from `.github/workflows/build.yml`, on a push to
      `release`) and `ghcr.io/<owner>/sloptube-encoder` (from `.github/workflows/encoder.yml`).
      On a fork, change the owner in both workflows and in
      `ops/app/docker-compose.yml`, `ops/app/install.sh` and the encoder compose file.
- [ ] Make the packages public, or log the servers in to GHCR with a read only token
      (see step 5 of the app guide).

### 7. Cloudflare

- [ ] DNS: an `A` record to the app server, **Proxied**.
- [ ] SSL/TLS mode: **Full**.
- [ ] Optional: a cache rule for `/press/*` and `/_next/static/*`. Leave pages and
      `/api/*` uncached: they depend on who is signed in.

### 8. Environment variables

App server, in `/opt/sloptube/.env` (read when the container starts, never baked
into the image):

| Name | Needed | What |
| --- | --- | --- |
| `DOMAIN` | yes | The domain Caddy gets a certificate for |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | The Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | yes | The publishable key |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | for uploads | The R2 token and bucket |
| `MEDIA_PUBLIC_URL` | no | The bucket's public domain |
| `SITE_URL` | no | `https://<your domain>`, for canonical links, share cards and the sitemap. Without it the address the browser asked for is used |
| `FLAGS_PAGE` | no | `1` shows the read only `/flags` page |
| `YAPIN_CLIENT_ID`, `YAPIN_CLIENT_SECRET` | for Sign in with Yapin' | The Yapin' app from yapin.gg/developers. See [Yapin'](#yapin) |
| `SUPABASE_SERVICE_ROLE_KEY` | for Sign in with Yapin' | The Supabase secret key, to sign in Yapin' users. Leave it out otherwise. See [Yapin'](#yapin) |

Encoder, in `/opt/sloptube-encoder/.env`: `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, the four `R2_` values, optionally `WORKER_NAME`,
`MEDIA_PUBLIC_URL` and `SITE_URL` (needed for Yapin' announcements).

### 9. Last checks

- [ ] Fill in [`site.config.ts`](../site.config.ts) and ship.
- [ ] `https://<your domain>/api/health` answers `{"ok":true}`.
- [ ] `https://<your domain>/robots.txt` and `/sitemap.xml` show your domain.
- [ ] Paste a watch link into a chat app: the card shows the title and thumbnail.
- [ ] Sign in, upload a short clip, watch it process, play it.

## Flags cheat sheet

`off` hides a feature, `test` shows it only to the user ids in `users`, `everyone`
shows it to all. Flags are read once per page load (maintenance within 15
seconds). Turn them on in this order: later features build on earlier ones.

| # | Key | What it shows | For the demo |
| --- | --- | --- | --- |
| 1 | `accounts` | Sign up, sign in, the avatar menu, `/settings` | `everyone` |
| 2 | `channels` | Channel pages at `/@handle`, `/studio/channel` | `everyone` |
| 3 | `upload` | The upload icon, `/upload`, `/studio/videos` | `everyone` |
| 4 | `processing` | The encoder turns uploads into HLS, thumbnails and the hover sprite; progress in the studio | `everyone` |
| 5 | `watch` | `/watch` with the player and `/api/media` | `everyone` |
| 6 | `feed` | The home grid, `/trending`, the channel Videos tab, Up next | `everyone` |
| 7 | `subscriptions` | Subscribe, the bell, the guide list, `/feed/subscriptions` | `everyone` |
| 8 | `search` | The search box, suggestions, `/results` | `everyone` |
| 9 | `engagement` | Likes and dislikes, counted views, history, resume, the red bars | `everyone` |
| 10 | `comments` | Comments under the watch page, `/studio/comments` | `everyone` |
| 11 | `shorts` | `/shorts`, the Snips shelf, the channel Snips tab | `everyone` |
| 12 | `studio` | The creator studio with its left nav | `everyone` |
| 13 | `stats` | `/studio/analytics` and per video analytics | `everyone` |
| 14 | `moderation` | Report buttons, `/admin` (admins only), strikes, appeals | `everyone` |
| 15 | `launch` | The footer, `/about`, `/terms`, `/privacy`, `/guidelines`, `/press`, `/contact`, the Messages tab in `/admin` | `everyone` |
| 15 | `maintenance` | Everyone but admins sees the maintenance page | `off` (flip it on and off once to show it) |
| 16 | `yapin` | Continue with Yapin', Settings > Connections, Share to Yapin', `/embed` with playable link previews, announcements in Studio > Settings | `everyone` |

The frame follows the flags too: with everything off the guide is just Home,
there is no search box and no bell. Trending appears with `feed`, Snips with
`shorts`, Subscriptions and the bell with `subscriptions`, Library and History
with `engagement`, the search box with `search`, the upload icon with `upload`.

To try a feature alone first, set `test` and put your own user id (from
**Authentication > Users**) in `users`, like `{11111111-2222-3333-4444-555555555555}`.

## Demo script

About 12 minutes. Before you start: migrations 000 to 020 applied, you are an
admin, every flag `off` except `accounts` (`everyone`), a second browser window signed out,
three or four videos uploaded and processed on a test channel (set `channels`, `upload`,
`processing` and `watch` to **Me** in the flag panel to prepare them, then back to
**Off**), `site.config.ts` filled in.

### Flag panel

Press **Ctrl+Shift+S** (Cmd+Shift+S on a Mac) anywhere on the site, as an admin,
and a small panel lists every flag below in demo order with three switches:
**Off**, **Me** (test mode with your id listed) and **Everyone**. Each switch
changes the real row in `feature_flags`, so the second window sees it on its
next page load, and your own page refreshes at once. Drag it by its title bar,
fold it with the arrow, Escape closes it. It needs `020_flag_panel.sql`; the
`flag_panel` flag hides it for every admin when set to `off`.

1. **The empty shell.** Show the home page with everything off: the grid of grey
   cards and sign in. "Every feature is behind a
   switch." Press Ctrl+Shift+S and show the panel.
2. **Channels and uploads.** Flip `channels`, `upload`, `processing`. Open your
   channel, upload a clip, watch the progress in the studio.
3. **Watching.** Flip `watch`. Open a video: the player, the hover previews on the
   bar, keyboard keys (space, arrows, m, f, c).
4. **The feed.** Flip `feed`. Reload the home page: the grid fills in, hover a
   thumbnail for the preview, open Trending.
5. **Following.** Flip `subscriptions`. Subscribe from the second window, show the
   bell and `/feed/subscriptions`.
6. **Finding things.** Flip `search`. Type a few letters, show the suggestions,
   then the filters on `/results`.
7. **Reactions and comments.** Flip `engagement` and `comments`. Like a video,
   leave a comment, pin and heart it as the creator, show History.
8. **Snips.** Flip `shorts`. The shelf on the home page, swipe through `/shorts`.
9. **The studio.** Flip `studio` and `stats`. The dashboard, Content with bulk
   changes, a video's analytics with the retention curve.
10. **Moderation.** Flip `moderation`. Report a comment from the second window,
    open `/admin`, remove it, show the mod log.
11. **Launch.** Flip `launch`. Scroll to the footer, open About, Terms and Press,
    send a message from `/contact` in the second window, read it in
    **Admin > Messages** and mark it handled. Paste a watch link into a chat app
    to show the share card, open `/sitemap.xml`.
12. **Yapin'.** Flip `yapin`. Sign out, Continue with Yapin', come back signed
    in; show Settings > Connections. Connect a test Yapin' channel in
    Studio > Settings, publish a clip and show the card arriving in Yapin' and
    the Posted row in the studio. Share a video to Yapin' and play it in the
    preview card.
13. **Maintenance.** Flip `maintenance` to `everyone`. Within 15 seconds the second
    window shows "We're doing some maintenance." while your admin window still
    works. Flip it back to `off`.
14. **Close.** "It is all open source": the footer's Source code link.

## Maintenance mode

With the `maintenance` flag on, `proxy.ts` answers every page with one static
page (status 503, `Retry-After: 600`) and every API route with
`{"error":"maintenance"}`. It needs no database and no React, so it keeps working
while you fix things. Admins see the site as usual. `/login`, `/signup`,
`/auth/*`, `/robots.txt` (which then asks crawlers to stay away) and the health
checks stay open, so you can sign in. `test` puts only the listed people in
maintenance, to try the page on yourself (as an admin you will not see it: use a
second account). Each app server keeps the flag for 15 seconds.

## SEO and sharing

- Watch pages, channel pages and Snips have a title, a description, a canonical
  link, Open Graph and Twitter cards with the thumbnail, and the duration.
  Unlisted videos are marked `noindex`.
- Public watch pages carry a JSON-LD `VideoObject`.
- `/sitemap.xml` is an index of `/sitemaps/pages.xml`, `/sitemaps/videos-<n>.xml`
  (with the video extension; Snips at `/shorts/<id>`) and
  `/sitemaps/channels-<n>.xml`, 5,000 addresses a file. Only what a signed out
  visitor can open is listed.
- `/robots.txt` keeps crawlers out of the studio, admin, settings, sign in and the
  API, and points at the sitemap.
- Next 16 streams the metadata of pages that read the request. Social bots
  (Twitter, Facebook, Slack, Discord and others) get it in `<head>` in the first
  response; browsers and Google get it a moment later in the stream, which Google
  reads. Lighthouse runs as a browser and counts that as "no meta description",
  which is why its SEO score on the watch and channel pages is 91, not 100.

## Yapin'

Sign in with Yapin', Connections, Share to Yapin', playable link previews and
upload announcements, all behind the `yapin` flag. What each does is in the
[feature docs](features.md#yapin).

### 1. Register the app

- [ ] Open [yapin.gg/developers](https://www.yapin.gg/developers) and make a new
      app (a "Yapin' app") for your sloptube.
- [ ] Redirect URI, exactly (your domain, https, no slash at the end):

      ```
      https://<your domain>/auth/yapin
      ```

      For `npm run dev` also add `http://localhost:3000/auth/yapin`. If `SITE_URL`
      is set, the redirect URI is built from it, so the two must match.
- [ ] Scope: `identify` (the only one Yapin' has; there is no email scope).
      Sign in uses the authorization code flow with PKCE: people are sent to
      `https://www.yapin.gg/oauth/authorize`, the server calls
      `https://www.yapin.gg/api/oauth/token` (the client secret in the form,
      not also as HTTP Basic) and `https://www.yapin.gg/api/oauth/me`.
- [ ] Copy the client id and the client secret.

### Accounts without an email address

Yapin' never shares an email address, so a new account made by Sign in with
Yapin' gets a placeholder, `yapin_<yapin id>@users.noreply.<your host>`. It is
marked in `profiles.email_placeholder`, never shown and must never be mailed.
People can add a real address in **Settings** ("Add an email"), which uses
Supabase's email change: a confirm link goes to the new address.

- [ ] In Supabase, **Authentication > Sign In / Providers > Email**, look at
      **Secure email change**. When it is on (the default), Supabase also mails
      a confirm link to the old address, which for a placeholder has no
      mailbox: the change can then never finish and Supabase tries to mail the
      placeholder. Turn it off if Yapin' accounts should be able to add an
      email; leave it on if you prefer the extra check for everyone else (Yapin'
      accounts then keep signing in with Yapin' only).

### 2. Environment variables

On the app server, in `/opt/sloptube/.env`:

```bash
YAPIN_CLIENT_ID=
YAPIN_CLIENT_SECRET=
SUPABASE_SERVICE_ROLE_KEY=
```

- `YAPIN_CLIENT_SECRET` and `SUPABASE_SERVICE_ROLE_KEY` are server only. Never
  prefix them with `NEXT_PUBLIC`, never commit them.
- `SUPABASE_SERVICE_ROLE_KEY` is the Supabase **secret** key (Project settings,
  API keys), the same kind the encoder has. Sign in with Yapin' needs it to sign
  in, or make, the account of a Yapin' user: the server makes a one time token
  and redeems it into the session cookie at once. Only `/auth/yapin` uses it.
  It can read and change everything in the database, so leave it out if you do
  not use Sign in with Yapin'. Roll it on the API keys page if it ever leaks.
- Without all three, Continue with Yapin' and Connections are hidden and
  `/auth/yapin` answers 503 `{"error":"yapin_off"}`. Share to Yapin', `/embed`
  and announcements need none of them, only the flag.
- Restart the app (`docker compose up -d` in `/opt/sloptube`).

### 3. Announcements in a Yapin' channel

- [ ] On the encoder box, set `SITE_URL=https://<your domain>` in
      `/opt/sloptube-encoder/.env` and restart it. The cards link there.
- [ ] In Yapin', make an incoming webhook for the channel that should get the
      announcements and copy its URL. It looks like
      `https://www.yapin.gg/api/webhooks/<id>/<token>` (yapin.gg, www.yapin.gg,
      yapper.website and www.yapper.website are taken; it is the same
      service). No bot token is needed.
- [ ] Yapin' only shows embed images from its own list of image hosts, so the
      thumbnail in the card may not show for your media host. The watch link is
      also in the message text and always unfurls into a card.
- [ ] On sloptube, open **Studio > Settings**, paste the URL into **Yapin'
      announcements** and save. From then on, each video you upload posts a card
      when it first becomes public and ready. Videos uploaded before you
      connected are not announced.
- [ ] The **Posts** list below shows each card as Waiting, Posted or Failed
      (with the reason). A card is tried 4 times in all (2, 4 and 8 seconds
      apart); a 404 from Yapin' (a deleted webhook) is not retried.
- [ ] Disconnect removes the URL. Saving a new one replaces it.

### 4. Check it

- [ ] Switch `yapin` to `test` with your user id.
- [ ] Signed in to your own account, **Settings > Connections > Link**. It says
      Linked. (Yapin' shares no email, so Continue with Yapin' on its own would
      make a new account instead of finding yours.)
- [ ] Sign out, **Continue with Yapin'** on `/login`, and you are back signed in
      to the same account.
- [ ] In a private window with another Yapin' account, Continue with Yapin'
      makes a new account and goes to `/welcome`; **Settings** shows "Add an
      email" and no Unlink.
- [ ] Share to Yapin' copies the message and opens yapin.gg (there is no share
      page to fill in).
- [ ] Paste a watch link in Yapin': the card plays the video. `/embed/<id>` only
      opens inside yapin.gg, yapper.website or your own site.
- [ ] Publish a short clip: the card arrives in the Yapin' channel.

## Lighthouse and accessibility results

Run on the production build against the made up site in
`scripts/launch-mock.mjs` (`npm run build`, then the two scripts below), on
2026-11-04.

`node scripts/lighthouse.mjs`: Lighthouse 13.6.0, mobile preset (a 412 x 823
phone, slow 4G, a 4x slower CPU, simulated), the median of 3 runs.

| Page | Performance | Accessibility | Best Practices | SEO |
| --- | --- | --- | --- | --- |
| Home | 93 | 100 | 100 | 100 |
| Watch | 95 | 100 | 100 | 91 |
| Channel | 92 | 100 | 100 | 91 |

What was fixed on the way: thumbnails, avatars and banners through `next/image`
with `sizes`, the first row of thumbnails loaded eagerly with high priority (the
largest paint), the rest lazily; route level skeletons; the next feed page read
ahead while the browser is idle. Thumbnails stay `unoptimized`: they come from the
video bucket through a short lived redirect or from `MEDIA_PUBLIC_URL`, which is
only known at request time, so the image optimizer would need that host frozen
into the build. The encoder already makes small WebP thumbnails.

`node scripts/a11y-check.mjs`: axe-core 4.14.0, WCAG 2.0 to 2.2 A and AA plus best
practices, at 390 x 844 in both themes.

| Page | Light | Dark |
| --- | --- | --- |
| Home | 0 violations | 0 violations |
| Watch | 0 violations | 0 violations |
| Channel | 0 violations | 0 violations |

What was fixed: tertiary text at 4.5:1 in both themes, the wordmark white in the
dark theme, names for icon only links and buttons (the phone Sign in button, the
channel avatar, the like and dislike buttons now say "I like this" with the count),
card titles as `h2` under the page title. The same script checks the skip link,
focus rings and the player keys: space, k, j, l, the arrows, m, f, t, i, c and 0
to 9 (c turns subtitles on or off, or says the video has none). Space on a focused
button or link presses it instead of playing.
