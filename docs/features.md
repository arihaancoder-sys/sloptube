# Features

How each feature works and how to set it up. Start with the quick start in the
[README](../README.md), then come back here for the details.

## Feature flags

Every feature ships behind a flag so it can be switched on one step at a time.
The flags live in the `feature_flags` table:

| Mode | Who sees the feature |
| --- | --- |
| `off` | nobody |
| `test` | only the user ids listed in `users` |
| `everyone` | everybody |

The quickest way is the **flag panel**: as an admin, press **Ctrl+Shift+S**
(Cmd+Shift+S on a Mac). It lists every flag with **Off**, **Me** (test mode with
your id) and **Everyone**, changes the real row, and reloads your page. It needs
`020_flag_panel.sql`; setting the `flag_panel` flag to `off` hides it.

Without the panel, use the table editor:

1. Open the [Supabase table editor](https://supabase.com/dashboard/project/_/editor)
   and pick the `feature_flags` table.
2. Find the row by its `key` and double click the `mode` cell.
3. Type `off`, `test` or `everyone` and press `Enter`. For `test`, also put the user
   ids in `users`, like `{11111111-2222-3333-4444-555555555555}`. A user id is in
   **Authentication > Users**.
4. Reload the site. Flags are read once per page load.

`/flags` lists every flag and its mode, read only. It is there with `npm run dev`;
in production set `FLAGS_PAGE=1`.

In code, use `flagOn("key")` from `lib/flags.ts` on the server and
`useFlag("key")` from `lib/store/session.ts` in the browser. The guide links,
the search box and the bell in the top bar appear only with their feature
(feature 18).

## Accounts

Sign up with Google or with email and password, sign in, the avatar menu and
`/settings` (name, username, picture, bio, delete account). People must be 13 or
older: the birthday is asked at sign up and checked in the database.

### 1. Run the migrations

In the [SQL editor](https://supabase.com/dashboard/project/_/sql/new),
run these files in order (each one is safe to run again):

1. `supabase/migrations/001_feature_flags.sql`
2. `supabase/migrations/002_profiles.sql`
3. `supabase/migrations/003_avatars.sql`

### 2. Tell Supabase where the site lives

In [Authentication > URL Configuration](https://supabase.com/dashboard/project/_/auth/url-configuration):

- **Site URL**: your domain, for example `https://tube.example.com`
- **Redirect URLs**: add `https://tube.example.com/auth/callback` and
  `http://localhost:3000/auth/callback`

### 3. Switch on Google sign in

1. In the [Google Cloud console](https://console.cloud.google.com/apis/credentials),
   set up the OAuth consent screen, then **Create credentials > OAuth client ID >
   Web application**.
2. Under **Authorized redirect URIs**, paste:

   ```
   https://<project-ref>.supabase.co/auth/v1/callback
   ```

3. Copy the client ID and client secret.
4. In Supabase open [Authentication > Providers > Google](https://supabase.com/dashboard/project/_/auth/providers),
   switch it on, paste both values and save.

The client secret stays in the Supabase dashboard. Never put it in this repository.

Until Google is switched on, the Google button says so and email sign up still works.

## Channels

Every account has a channel at `/@handle` with Home, Videos and About tabs, and
the owner edits it in `/studio/channel`: name, handle, description, links,
picture and banner. `/channel/<id>` sends people on to the `/@handle` address.

- A handle is 3 to 30 lower case letters, numbers, underscores or dots. The
  first change is free, after that once every 14 days.
- The channel and the account share one picture.
- Banners are cropped to 2560 x 423 and saved as WebP in the browser before
  they are uploaded (6 MB max). On phones the whole banner shows, letterboxed.
- The Subscribe button works once the `subscriptions` flag is on (see
  Subscriptions below). Until then it is a disabled placeholder.

To set it up, run `supabase/migrations/004_channels.sql` in the
[SQL editor](https://supabase.com/dashboard/project/_/sql/new)
(after 001 to 003). It creates a channel for every existing account, adds the
`banners` storage bucket and a `channels` flag that starts `off`. Switch the flag
to `test` or `everyone` to show channel pages and the "Your channel" menu item.
While it is off, `/@handle` says "Channels aren't on yet".

## Uploads (R2)

Signed in people upload videos at `/upload`: drag and drop or pick a file, fill in
the title, description and visibility while it uploads, and see it land in
`/studio/videos`. Video files go straight from the browser to a Cloudflare R2
bucket with presigned URLs, in 16 MB parts, so the app server never touches the
bytes. Processing (feature 4) turns it into HLS and the watch page (feature 5)
plays it.

- MP4, MOV, WebM or MKV, up to 2 GB per file, 10 uploads a day per person.
- Uploading needs a finished sign up (13 or older) and a channel.
- New videos are private unless the uploader picks unlisted or public.

### 1. Run the migration

Run `supabase/migrations/005_videos.sql` in the
[SQL editor](https://supabase.com/dashboard/project/_/sql/new)
(after 001 to 004). It adds the `videos` table, the upload functions and an
`upload` flag that starts `off`. Switch the flag to `test` or `everyone` to show
the upload icon in the top bar, `/upload` and `/studio/videos`.

### 2. Create the bucket

1. Open [R2 > Create bucket](https://dash.cloudflare.com/?to=/:account/r2/new).
2. Pick a name, for example `sloptube-videos`, and create it. Leave public
   access off: nothing in it is served straight to viewers.

### 3. Make an API token

1. On the R2 overview page, open **Manage R2 API Tokens** (or
   [this link](https://dash.cloudflare.com/?to=/:account/r2/api-tokens)) and click
   **Create API token**.
2. Permissions: **Object Read & Write**.
3. Under **Specify bucket(s)**, pick only your video bucket.
4. Create it and copy the **Access Key ID** and the **Secret Access Key**. The
   secret is shown once.
5. The **Account ID** is on the R2 overview page.

### 4. Allow uploads from the site (CORS)

The browser uploads each part with a `PUT` to R2 and needs to read the `ETag`
R2 sends back. In the bucket, open **Settings > CORS Policy > Add CORS policy**
and paste this, with your own domain:

```json
[
  {
    "AllowedOrigins": ["https://tube.example.com", "http://localhost:3000"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["content-type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Without `ExposeHeaders: ETag` every upload fails with "no ETag in the answer".

Optional: under **Settings > Object lifecycle rules**, keep the rule that aborts
incomplete multipart uploads (1 day is plenty), so parts from closed tabs do
not pile up.

### 5. Add the four settings

Put these names in `.env.local` for local development and in
`/opt/sloptube/.env` on the server, with your values after the `=`:

```bash
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
```

They are read on the server only, at request time. Never prefix them with
`NEXT_PUBLIC_` and never commit the values. Restart the app after adding them.
While they are missing, `/api/upload/sign` answers 501 "uploads not configured"
and `/upload` shows a notice. With `npm run dev` and no Supabase key, `/upload`
shows a preview of the page.

## Processing

A separate encoder box turns every finished upload into HLS at 360p, 720p and
1080p (never bigger than the upload), makes three thumbnails and a hover
preview sprite, and marks the video ready. `/studio/videos` shows
"Processing, 42%" and updates every 5 seconds; ready videos get their thumbnail.
The owner sees the same percent on `/watch?v=<id>`.

- The worker lives in [`worker/`](../worker/) (plain Node 22 and ffmpeg) and runs on
  its own server. Set it up with [`ops/encoder/README.md`](../ops/encoder/README.md).
- It uses the Supabase **secret key** (service role). That key goes only into the
  encoder box's `/opt/sloptube-encoder/.env`, never into the website's settings.
- Segments are fMP4 (4 seconds), with H.264 video and AAC sound. The reasons are
  in the encoder README.
- `/api/videos/<id>/status` answers the owner with the status and percent, for
  the studio to poll.
- With `npm run dev` and no Supabase key, `/studio/videos` shows sample videos in
  every state.

To set it up:

1. Run `supabase/migrations/006_processing.sql` in the
   [SQL editor](https://supabase.com/dashboard/project/_/sql/new)
   (after 001 to 005). It adds the `encode_jobs` queue, the worker functions and
   a `processing` flag that starts `off`. While the flag is off the worker takes
   no jobs; in `test` mode it only processes videos of the listed users.
2. Set up the encoder box: [`ops/encoder/README.md`](../ops/encoder/README.md).
3. Switch the `processing` flag to `test` or `everyone`.

Worker tests (ladder, ffmpeg arguments, sprite timing, the loop with Supabase
and R2 mocked, and a real 3 second encode when ffmpeg is installed):

```bash
npm ci --prefix worker
node --test worker/
```

## Watch page

`/watch?v=<id>` plays a video in the 2019 layout: the player on the left (up to
1280 wide), title, views and date, like, dislike, share and save, the channel
row and the description with SHOW MORE, and "Up next" on the right. The theater
button (or `t`) puts the player across the whole width. On phones everything is
stacked under the player.

- The player uses [hls.js](https://github.com/video-dev/hls.js) (pinned to an
  exact version), and Safari's own HLS playback on Safari.
- Gear menu: playback speed (0.25 to 2) and quality (every rendition, highest
  first, and Auto). Hovering the progress bar shows a frame from the preview
  sprite with the time.
- Keys: space or `k` play and pause, `j` and `l` jump 10 seconds, the arrows
  5 seconds, up and down change the volume, `m` mutes, `f` is full screen, `t`
  theater, `i` picture in picture, `0` to `9` jump to 0% to 90%.
- The browser remembers the volume, the last quality and where you stopped in
  each video. With the `engagement` flag on, signed in people resume from
  their history instead (see Likes, views and history).
- Share copies the link, with an optional "Start at" time (`&t=90`).
- Public and unlisted videos play for anybody with the link, private ones only
  for the owner. The owner sees "Processing, N%" until the video is ready;
  others see "This video is being processed", or "Video unavailable" for
  private, failed and missing videos.
- Likes and dislikes work with the `engagement` flag (feature 9); save is a
  disabled placeholder. Subscribe works with the `subscriptions` flag
  (feature 7). Views show `videos.views`, counted by feature 9. Up next
  shows more videos from the same channel, padded with placeholders until the
  home feed (feature 6) fills it.

### How the player gets the video

The bucket is private, so the browser cannot read it directly. The player asks
the site instead, at `/api/media/<video>/<file>`:

1. The route calls `watch_video()` in the database, which decides who may
   watch: public and unlisted videos once they are ready, the owner always.
   Everybody else gets 404, the same as for a video that does not exist.
2. **Playlists** (`master.m3u8`, `720p/index.m3u8`) and the sprite's `.vtt` are
   tiny text files. The route reads them from R2 and sends them on, with every
   file name inside rewritten to point back at the route.
3. **Video segments**, init files and images get a `302` redirect to a
   presigned R2 link that works for 10 minutes. The bytes go straight from R2
   to the browser; the site only signs links, which needs no request to R2.

Why not redirect the playlists too: the player would then read the relative
names inside them against the R2 link and ask R2 for unsigned files, which
fails. Why not one long lived link per video: anybody could keep sharing it
after the video goes private. With the route, making a video private stops
playback within minutes.

**Optional: a public bucket domain.** If you connect a custom domain to the
bucket ([Cloudflare docs](https://developers.cloudflare.com/r2/buckets/public-buckets/))
and set `MEDIA_PUBLIC_URL=https://media.example.com` on the website, the player
loads `https://media.example.com/hls/<video>/master.m3u8` directly and skips the
route. That is cheaper and uses Cloudflare's cache, but every file under `hls/`
is then readable by anybody who knows the video id, including private videos.
Leave it empty unless that is fine for you.

### Set it up

1. Run `supabase/migrations/007_watch.sql` in the
   [SQL editor](https://supabase.com/dashboard/project/_/sql/new)
   (after 001 to 006). It adds `videos.views`, the `watch_video` function and a
   `watch` flag that starts `off`. While it is off, `/watch` shows the feature 4
   page.
2. Let the player read from R2: in the bucket, **Settings > CORS Policy**, add
   `GET` and `HEAD` to the allowed methods and `range` to the allowed headers
   (keep `PUT` for uploads):

   ```json
   [
     {
       "AllowedOrigins": ["https://tube.example.com", "http://localhost:3000"],
       "AllowedMethods": ["GET", "HEAD", "PUT"],
       "AllowedHeaders": ["content-type", "range"],
       "ExposeHeaders": ["ETag"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

   hls.js follows the segment redirects with `fetch`, so without `GET` the video
   never starts.
3. Switch the `watch` flag to `test` or `everyone`.

With `npm run dev` and no Supabase key, `/watch` shows a sample video.
`node scripts/watch-shots.mjs` makes a 3 second HLS clip with ffmpeg, plays it
in that preview with Playwright (play, pause, a quality switch) and saves the
screenshots in `shots/watch/`.

## Home feed

The home page (`/`) shows the 2019 grid of public videos, newest first, under
"Recommended": one column on phones, up to five at 1800 wide. Each card has the
16:9 thumbnail with the duration, the channel picture, a two line title and
"channel · 1.2K views · 3 days ago". Rest the pointer on a card for a second
and the preview sprite plays in the thumbnail (only the small sprite image
loads, never the video). More cards load as you scroll, with a row of grey
cards while they come. Signed out people see the same feed.

- `/trending` is the same grid, numbered 1 to 50: videos from the last 30 days
  ranked by `views / hours_since_publish ^ 1.5`, worked out on every request
  for now.
- Channel pages: the Videos tab lists every public video of the channel, newest
  first, with the same cards; the Home tab shows the latest 8 under "Uploads".
- The watch page's Up next shows more from the same channel first, then the
  newest from everybody. Clicking a card switches video without reloading the
  page.
- Thumbnails come from `MEDIA_PUBLIC_URL` when it is set, else from
  `/api/media/<video>/thumb-1.webp`, which signs one image when the browser
  asks for it. The page itself never signs links, however many cards it shows.
- `/api/feed?kind=newest&cursor=...` hands the browser the next page.
  Pages are cut by `published_at` and id, so new uploads never shift or repeat
  cards while you scroll.

To set it up:

1. Run `supabase/migrations/008_feed.sql` in the
   [SQL editor](https://supabase.com/dashboard/project/_/sql/new)
   (after 001 to 007). It adds `feed_videos()`, `related_videos()`, an index
   for the feed and a `feed` flag that starts `off`. While it is off, `/` and
   `/trending` keep the placeholder grid, channel tabs say "This channel has no
   videos yet" and Up next lists the channel's own videos like before.
2. Switch the `feed` flag to `test` or `everyone`.

`node scripts/feed-shots.mjs` starts `next dev` against a small local stand in
for Supabase and the bucket (a dozen made up videos with generated thumbnails
and sprites), checks the columns, the hover preview, infinite scroll, the
trending order and Up next, and saves screenshots in `shots/feed/`.

## Subscriptions

Signed in people subscribe to channels from the watch page and the channel
header: the red SUBSCRIBE button turns into a grey SUBSCRIBED with a bell next
to it. The bell is filled while notifications are on (the default) and
outlined when they are off. Clicks show at once and the subscriber count next
to the button moves with them; the server gets one change at a time, and a
change that fails puts the button back and says why in a small message at the
bottom left. Signed out, SUBSCRIBE goes to sign in and comes back.

- The guide gets a SUBSCRIPTIONS section with the channels, newest upload
  first: seven, then SHOW MORE. A small blue dot means the channel uploaded in
  the last 7 days. Signed out people do not see it.
- `/feed/subscriptions` (the guide's Subscriptions link; `/subscriptions` sends
  you there) is the home grid with uploads from your channels only, under
  "Today", "This week" and "Older" in your own time zone. Signed out it says
  "Don't miss new videos" with a Sign in button.
- The bell in the top bar lists the last 20 uploads from channels with the
  bell on. The red badge counts the ones since you last opened it in this
  browser (kept in localStorage). No push or email yet.
- You cannot subscribe to your own channel. Each person can make 60 changes
  (subscribe, unsubscribe, bell) an hour. Nobody sees who subscribes to a
  channel, only the count.
- `/api/subscriptions` (GET your channels, POST a change) and
  `/api/subscriptions/feed` (`?cursor=` for the next page, `?notify=1` for
  the bell) are what the browser calls.

To set it up:

1. Run `supabase/migrations/009_subscriptions.sql` in the
   [SQL editor](https://supabase.com/dashboard/project/_/sql/new)
   (after 001 to 008). It adds the `subscriptions` table, the functions, the
   subscriber count trigger (and recounts once) and a `subscriptions` flag that
   starts `off`. While it is off the buttons stay disabled placeholders, the
   guide keeps its old note and `/feed/subscriptions` shows a placeholder.
2. Switch the `subscriptions` flag to `test` or `everyone`.

`node scripts/subscriptions-shots.mjs` starts `next dev` against a small local
stand in for Supabase with a made up signed in viewer and ten made up
channels, checks subscribe and unsubscribe (with the count moving before the
server answers), a failed change, the bell, the guide list, the feed sections
and the notifications badge, and saves screenshots in `shots/subscriptions/`.

## Search

The search box in the top bar is real now. Typing shows up to ten
suggestions from video titles and channel names (150 ms after the last key),
with what you typed in normal text and the rest in bold. Up and down move
through them, Enter or the search button goes to
`/results?search_query=<what you typed>`, Escape closes the list. With the box
empty it shows your last 10 searches, each with an X to remove it. They are
kept in this browser only (localStorage). On a phone the search icon opens a
full width search with the suggestions under it.

- `/results` has a FILTER button that opens Upload date, Type, Duration and
  Sort by as columns. Clicking a picked filter again clears it, and the
  filters live in the address (`&uploaded=week&duration=short&sort=views`).
- Channels that match come first, with their picture, subscriber count and a
  SUBSCRIBE button. Then videos as rows: the thumbnail on the left, the title,
  views and age, the channel, and two lines of the description with the
  matched words in bold. More load as you scroll. On a phone they are the
  home feed cards.
- Words match as prefixes ("bre" finds "bread") and small typos still find
  close titles. The query is cleaned first: punctuation goes, spaces collapse,
  at most 100 characters.
- 60 searches a minute per person (or per address when signed out), and 240
  suggestion requests. Past that the page asks you to wait a minute.
- `/api/search/suggest?q=` and `/api/search?search_query=&cursor=` are what
  the browser calls.

To set it up:

1. Run `supabase/migrations/010_search.sql` in the
   [SQL editor](https://supabase.com/dashboard/project/_/sql/new)
   (after 001 to 009). It switches on `pg_trgm`, adds the search column and
   indexes, the three search functions, the rate limit and a `search` flag
   that starts `off`. While it is off the box still goes to `/results`, which
   shows a placeholder, and there are no suggestions or recent searches.
2. Switch the `search` flag to `test` or `everyone`.

Signed out searches are counted per address: the app passes on the address
from `X-Forwarded-For`, which Caddy sets (see `ops/app/`). Somebody calling
the database directly can make up that header, so the per address limit only
holds for visits through the site.

`node scripts/search-shots.mjs` starts `next dev` against a small local stand
in for Supabase with made up channels and videos, checks the suggestions
dropdown with the keyboard, recent searches, the results page, infinite
scroll, the filter panel, "No results found" and the phone overlay, and saves
screenshots in `shots/search/`.

## Likes, views and history

The thumbs under a video work now: a click shows at once (the count moves
before the server answers) and clicking the same thumb again takes it back.
Signed out, a thumb goes to sign in and comes back. Everybody sees the like
count. Only the video's owner sees the dislike count, and with it the thin
2019 like bar under the thumbs (likes against dislikes); everybody else sees
the dislike thumb without a number.

Views are counted so they can't be spammed:

- The player pings `/api/watch/ping` when playback starts, every 10 seconds
  while playing, and on pause, end and leaving the page.
- A view counts once per viewer per video per day (UTC), when 10 seconds have
  been watched (or the whole video, when it is shorter). `videos.views` goes up
  by one at that moment, and only then. The count on the watch page and on
  every card comes from `videos.views`.
- The database never credits seconds faster than they pass: the first ping of
  the day only starts the clock, and the day's total can't run ahead of the
  time since then. At most 20 pings a minute per viewer.
- Signed in viewers are counted by their account. Signed out viewers get a
  random `sv` cookie from the site (one year, not readable by scripts); the
  app hashes it before it goes to the database, which hashes it again, so the
  cookie itself is never stored.

Watch history and resume, for signed in people:

- Every ping saves where you are. Opening the video again starts there (with
  a small "Resumed" note) when you were past 10 seconds and before 90
  percent. Signed out, the browser's own position is used like before.
- `/feed/history` (the guide's History link; `/history` sends you there) is the
  2019 history page: rows like the search results under Today, Yesterday and
  the date, a red bar under each thumbnail, an X on each row to remove it,
  more as you scroll, and "Clear all watch history" and "Pause watch history"
  in the right column (above the list on phones). While paused, nothing new is
  added and nothing new is remembered for resume.
- Thumbnails everywhere (home, channel pages, search, Up next) show the red
  bar for videos you have watched.
- `/api/reactions`, `/api/watch/ping`, `/api/history` (GET a page, DELETE to
  clear or remove one, POST to pause) and `/api/history/progress` are what the
  browser calls.

There is also a daily table for the creator stats of feature 13:
`video_stats_daily` (views, watch time, likes and dislikes per video per day),
refreshed every hour by a pg_cron job.

To set it up:

1. Switch on pg_cron, so the hourly stats job can be scheduled: open
   [Database > Extensions](https://supabase.com/dashboard/project/_/database/extensions),
   search for `pg_cron` and switch it on (keep the suggested `pg_catalog`
   schema). If you skip this, the migration still runs and says so in a
   notice; switch it on later and run the file again to add the job.
2. Run `supabase/migrations/011_engagement.sql` in the
   [SQL editor](https://supabase.com/dashboard/project/_/sql/new)
   (after 001 to 010). It adds the reactions, the counts, view counting,
   history, the stats table and its job, and an `engagement` flag that starts
   `off`. While it is off the thumbs stay disabled placeholders, the player
   sends no pings and keeps resuming from the browser, there are no red bars,
   and `/feed/history` shows a placeholder.
3. Switch the `engagement` flag to `test` or `everyone`.

To check the job: `select * from cron.job;` lists `sloptube-video-stats`, and
`select * from cron.job_run_details order by start_time desc limit 5;` shows
its last runs.

`node scripts/engagement-shots.mjs` makes a 14 second clip with ffmpeg,
starts `next dev` against a small local stand in for Supabase that counts
views with the same rule as the database, checks the flag off, the like
toggle, the owner's dislike count and like bar, a 12 second playback that
marks a view, resume, the red bars and the history page (day headers,
infinite scroll, remove, pause, clear), and saves screenshots in
`shots/engagement/`.

## Comments

Under the description on the watch page (under Up next on phones), in the 2019
layout: "1,234 Comments" with a SORT BY menu (Top comments, Newest first), the
"Add a public comment..." box that shows CANCEL and COMMENT once it has focus,
and the comments with the author, "2 days ago", the text folded after four
lines with "Read more", the thumbs, REPLY, and the three dot menu. Signed out
people see a sign in prompt instead of the box, and the buttons send them to
sign in.

- Replies are one level deep, like YouTube: a reply to a reply goes under the
  same comment and starts with `@name`. "View 12 replies" loads them oldest
  first, ten at a time, joined to the comment by a thin line.
- A new comment shows at once as "Posting...", then the real row takes its
  place. More comments load as you scroll.
- The video's owner can pin one comment ("Pinned by" on top of the list) and
  heart comments (their picture with a small red heart), and delete any
  comment on their videos. Authors edit and delete their own. A deleted
  comment with replies stays as "This comment was deleted" so the thread
  keeps its shape. Report is a placeholder until moderation (feature 14).
- The dislike thumb is a button only: there is no dislike count for comments.
- Every 20 seconds the page asks for comments newer than the newest it has.
  When there are some, an "N new comments" pill shows above the list and puts
  them at the top when clicked. There is no websocket yet; the spot where a
  realtime subscription would replace the poll is marked in
  `lib/store/comments.ts` (feature 16).
- Limits: 10 comments a minute and 100 a day per person, 3 a minute for
  accounts less than a day old. Likes, edits, deletes, pins and hearts: 60 a
  minute. Comments are 1 to 2,000 characters.
- Comments mode: `on`, `off` or `held` per channel (the default for its
  videos) and per video (`set_comments_mode`; the studio editor for it comes
  with feature 12). `held` stops everybody but the owner for now; holding for
  review arrives with moderation.
- `/studio/comments` lists the latest 50 comments on your videos with heart
  and delete, and sets the channel's comments mode.

To set it up:

1. Run `supabase/migrations/012_comments.sql` in the
   [SQL editor](https://supabase.com/dashboard/project/_/sql/new)
   (after 001 to 011). It adds the comments and comment likes, the counters,
   the comments mode columns, the functions and a `comments` flag that starts
   `off`. While it is off the watch page has no comments section, the
   comments routes answer 403 and `/studio/comments` shows a placeholder.
2. Switch the `comments` flag to `test` or `everyone`.

`node scripts/comments-shots.mjs` starts `next dev` against a small local
stand in for Supabase with made up comments, checks the flag off, signed out,
sorting, Read more, replies, infinite scroll, posting, replies to replies,
likes, the new comments pill, pin, heart and delete as the owner and
`/studio/comments`, and saves screenshots in `shots/comments/`.

## Snips

Vertical videos of a minute or less get their own feed at `/shorts`, in the
first 2020 Snips look: one short per screen on a dark player, the title and
the channel at the bottom, and a rail of white icons on the right for like
(with the count), dislike, comments (with the count), share and the channel's
picture, which opens the channel.

- A video is a short when it is vertical (taller than wide) and 60 seconds or
  less (the length rounded down, as the player shows it). The database works
  it out from what processing measured, so nothing else changes in the
  encoder. Videos from before are sorted once when the migration runs.
- On `/upload`, "Upload as a Snip" is ticked by itself when the picked file
  qualifies (the browser reads its size and length, nothing extra is
  uploaded). Untick it to keep the video out of Snips. For anything else the
  box is greyed out and says why: "It's horizontal (1920 x 1080)" or "It's
  2:14 long". Ticking can never make a horizontal or long video a short.
- Swipe, scroll (it snaps one short at a time), use the arrow keys or the
  arrow buttons on desktop to move. The short on screen plays and loops,
  muted until the first tap (browsers only autoplay without sound); after
  that the sound stays on, and a tap pauses. The address follows along as
  `/shorts/<id>`, so a short can be shared or reloaded, and a link like that
  starts the feed at that short. A link to a regular video goes on to
  `/watch`.
- Comments open in a sheet on the right of the player on desktop and from the
  bottom on phones. It is the watch page's comments section (feature 10).
- The order: shorts the viewer has not watched first, then by
  `(1 + views + 2 * likes + 3 * comments) / hours_since_publish ^ 1.5` (the
  trending math of the home feed, plus a point so new shorts still show),
  never the viewer's own. Pages carry the moment the first page was read, and
  ages, what counts as published and what counts as watched are measured at
  that moment, so the same cursor always gives the same page.
- Views count like regular videos (feature 9), once per viewer per day, but a
  short counts at 3 seconds watched instead of 10. That is also when it counts
  as watched for the order. Clearing the history forgets it.
- The home feed gets a Snips shelf after the first row: the red mark,
  "Snips" and a row of vertical thumbnails. Snips leave the home grid and
  the channel's Videos tab while the flag is on; channel pages get a Snips
  tab with the channel's shorts in a 9:16 grid. The guide gets a Snips entry
  under Home.
- Limits: 60 pages of shorts a minute per person or address, 30 changes of
  the Snip box a minute.

To set it up:

1. Run `supabase/migrations/013_shorts.sql` in the
   [SQL editor](https://supabase.com/dashboard/project/_/sql/new)
   (after 001 to 012). It adds `videos.is_short` (kept by a trigger and
   counted once for the videos already there), the uploader's choice, the
   shorts functions, a 3 second view in `watch_ping`, and a `shorts` flag that
   starts `off`. While it is off `/shorts` keeps the "No Snips yet"
   placeholder, the shelf, the tab, the guide entry and the upload box are
   hidden, and the shorts routes answer 403.
2. Switch the `shorts` flag to `test` or `everyone`.

`node scripts/shorts-shots.mjs` makes a vertical clip with ffmpeg, starts
`next dev` against a small local stand in for Supabase with made up shorts,
checks the flag off, the shelf, autoplay, mute and loop, the keys, the wheel
and the buttons, the 3 second view, likes, the comments sheet, share, paging,
deep links and the channel tab, and saves screenshots in `shots/shorts/`.

## Creator studio

`/studio` is the creator studio in the 2020 Studio look: a dark left nav with
the channel's picture, white cards on light grey, blue buttons and links.

- **Left nav**: Dashboard, Content, Comments (the feature 10 page, now inside
  the studio), Customization (the channel editor from feature 2, with its live
  preview) and Settings (a placeholder for now). On phones it is a strip under
  the top bar. The main guide does not dock next to it; the hamburger opens it
  as a drawer.
- **Dashboard** (`/studio`): the latest video with its views, likes, comments
  and watch time (from the view pings of feature 9), channel analytics with
  current subscribers, the last 28 days (the hourly stats rollup of feature 9)
  and all time totals, a "What's new" card, and upload buttons.
- **Content** (`/studio/content`): every video of the channel with its
  thumbnail, title, visibility, date, views, comments and likes. Search by
  title, filter by visibility and by Snips or videos, and sort by any column;
  the filters stay in the address. Each row has Details, View on sloptube and
  Delete. Tick rows (up to 100) for the dark selection bar: Edit visibility or
  Delete for all of them at once. Changes show at once and roll back if the
  server says no.
- **Trash** (`/studio/content/trash`): Delete never deletes right away. The
  video moves to the trash and becomes private everywhere; the trash shows how
  many days are left and Restore puts it back with the visibility it had.
  After 30 days a daily job deletes the video for good, with its comments,
  likes and views, and queues its files in R2 for the encoder box to remove
  (see "Emptying the trash in R2" in [ops/encoder/README.md](../ops/encoder/README.md)).
- **Video details** (`/studio/video/<id>/edit`): title, description, tags (up
  to 15), visibility, the comments setting (feature 10) and "Show this video
  as a Snip" (feature 11), saved with SAVE; UNDO CHANGES goes back. The
  thumbnail is one of the encoder's three stills or a custom JPG, PNG or WebP
  up to 2 MB, uploaded straight to R2 next to the video's files; a pick saves
  at once.
- `/studio/videos` (feature 3) goes to Content while the flag is on.
- Limits: 60 bulk changes and 60 edits a minute per person.

A picked thumbnail shows everywhere when `MEDIA_PUBLIC_URL` is set, or when the
site runs on https (the link then goes through `/api/media`). Without either,
for example `npm run dev` on http, only the studio shows the pick. Custom
thumbnails need the R2 settings and the CORS rule from "Uploads (R2)", which
already allows the `PUT` they use.

To set it up:

1. Run `supabase/migrations/014_studio.sql` in the
   [SQL editor](https://supabase.com/dashboard/project/_/sql/new)
   (after 001 to 013). It adds the trash columns, tags and the thumbnail pick
   to `videos`, the studio functions, the `storage_cleanup` queue, a daily
   purge with pg_cron (switch pg_cron on under **Database > Extensions** first,
   or the file says so with a notice and the trash is not emptied), and a
   `studio` flag that starts `off`. While it is off `/studio` shows a coming
   soon page, the studio routes answer 403, and `/studio/comments`,
   `/studio/channel` and `/studio/videos` work as before without the nav.
2. Update the encoder box to the new worker image, so it empties the R2
   folders of purged videos.
3. Switch the `studio` flag to `test` or `everyone`.

`node scripts/studio-shots.mjs` makes three stills with ffmpeg, starts
`next dev` against a small local stand in for Supabase with a made up
channel, checks the flag off, the dashboard, search, filters and sorting,
bulk visibility, delete with the confirm box, the trash and restore, a
refused bulk change rolling back, the edit page and the nav, and saves
screenshots in `shots/studio/`.

## Analytics

Channel and video analytics in the studio, in the 2020 Studio look. Charts
are plain inline SVG (no chart library) with a tooltip on hover or touch, in
both themes. Every page has a range menu: the last 7, 28 or 90 days, or
lifetime (from the day the channel or the video was made). Days are UTC days.

- **Channel analytics** (`/studio/analytics`, Analytics in the studio nav):
  views, watch time in hours, subscribers gained and lost, and the estimated
  audience (unique viewers with a counted view). A daily line of views, daily
  bars of watch time, the top 10 videos by views in the range, the current
  subscribers, and a **Realtime** card with the views of each of the last 48
  hours, asked again every minute.
- **Video analytics** (`/studio/video/<id>/analytics`, from a top video, the
  Analytics icon on a Content row, or the Analytics button on the edit page):
  views and unique viewers, watch time, average view duration and percentage
  viewed, likes, dislikes and the share of likes, comments, the same charts,
  realtime for that video, and:
  - **Audience retention**: the share of viewers still watching at every 5% of
    the video and at the end. Each view ping marks the stretch of the video it
    covers (the seconds played before its position; seeks play nothing), so
    jumping ahead does not count the part skipped.
  - **Traffic sources**: where viewers came from: browse features (home),
    search, subscriptions, channel pages, the Snips feed, other pages here,
    external sites, or direct. The player's first ping says so, from the
    previous page in the app or else the referrer. Views from before
    migration 015 carry no source, and the card is hidden until some do.
  - There is no country card: the view ping carries no country.
- The numbers come from the hourly rollup (feature 9), so a day can be up to
  an hour behind; the realtime card reads the view pings directly.
- Only the channel owner sees them, 60 requests a minute per person.

To set it up:

1. Run `supabase/migrations/015_stats.sql` in the
   [SQL editor](https://supabase.com/dashboard/project/_/sql/new)
   (after 001 to 014). It adds the source, the parts reached and the time a
   view counted to `view_events`, a fourth (optional) `source` argument to
   `watch_ping`, the `channel_stats_daily`, `video_retention_daily` and
   `video_source_daily` rollups (filled for the last 400 days right away, then
   every hour by the existing pg_cron job), subscribers gained and lost from
   now on (subscriptions made before count as gained on their day), the three
   analytics functions, and a `stats` flag that starts `off`. While it is off
   the Analytics nav item and links are hidden, the pages show a coming soon
   page, and the routes answer 403 `stats_off`.
2. Switch the `stats` flag to `test` or `everyone` (the `studio` flag must be
   on too).

`node scripts/stats-shots.mjs` starts `next dev` against a small local stand in
for Supabase with a made up channel, checks the flag off, the channel overview,
the range menu, a video with retention and traffic sources, a video with
neither, another channel's video and the links, and saves screenshots in
`shots/stats/`.

## Moderation

Reports, an admin queue, strikes, suspensions, bans and a word list.

- **Reports**: anyone signed in can report a video (Report in the three dot
  menu under the player), a comment (Report in its menu) or a channel (the
  flag next to Subscribe). Pick a reason (spam or misleading, sexual content,
  violent or repulsive content, harassment or bullying, infringes my rights,
  something else) and add a few words; "something else" needs them. One report
  per person per target, 10 a day per person.
- **Admins**: `profiles.role` is `user` or `admin`. There is no button to
  promote anyone: the owner does it in the SQL editor:
  `update public.profiles set role = 'admin' where username = '<name>';`
  `is_admin()` answers for the caller and guards every admin function and
  policy.
- **The queue** (`/admin`, a plain 404 for everyone else): open reports
  grouped by what they point at, with the count, the reasons and the latest
  report; appeals first. For each: dismiss, remove (a video becomes private
  and "removed", kept 30 days and then deleted with its files by the trash
  purge; a comment is replaced by "This comment was removed by moderation"),
  strike the channel, suspend or unsuspend it, ban or unban the person behind
  it. Remove, strike, suspend and ban need a reason. Below the queue: find a
  channel by handle to suspend it directly, and the channels suspended now.
- **Strikes**: 3 strikes in 90 days suspend the channel until an admin
  unsuspends it. A suspended channel can't upload or comment and its videos
  are private until then (their visibility comes back on unsuspend).
- **Bans**: the profile is flagged, every API request of that person is
  refused (a PostgREST pre request check), their sessions are deleted and the
  site signs them out on their next page. A ban suspends the channel too.
- **Mod log** (`/admin/log`): every action with who did it, on what and why.
- **Word list** (`/admin/words`): words and phrases (a `*` at the end matches
  any ending). A comment, video title or description that holds one as a
  whole word is refused with a plain message. Comments can have up to 5 links.
- **Removed videos**: the studio Content row says "Your video was removed"
  with the reason, and **Appeal** sends an appeal the admins see in the same
  queue; restoring it gives the video its visibility back.

To set it up:

1. Run `supabase/migrations/016_moderation.sql` in the
   [SQL editor](https://supabase.com/dashboard/project/_/sql/new)
   (after 001 to 015). It adds everything above and a `moderation` flag that
   starts `off`. While it is off there are no report buttons and `/admin` is a
   404. Bans, suspensions and removals already made keep holding.
2. Make yourself an admin with the `update` above.
3. Switch the `moderation` flag to `test` (with your user id) or `everyone`.

`node scripts/moderation-shots.mjs` starts `next dev` against a small local
stand in for Supabase with made up people, checks the flag off, reporting,
automod, the queue and its actions, strikes, the appeal, the log, the word list
and a ban, and saves screenshots in `shots/moderation/`.

## Launch pack

Everything for opening a sloptube to the public. The full checklist, the flags
cheat sheet and the demo script are in [`docs/launch.md`](launch.md).

- **Public pages** behind the `launch` flag: `/about`, `/terms`, `/privacy`,
  `/guidelines`, `/press` (the logo, a paragraph and screenshots) and `/contact`
  (a form, 5 messages a day per email address and per network address, read in
  **Admin > Messages**). Footer links on every page and in the guide.
- **Your details in one file.** The pages read the owner's name, contact email,
  jurisdiction and the legal date from [`site.config.ts`](../site.config.ts). They
  ship as the placeholders `OWNER_NAME`, `CONTACT_EMAIL`, `JURISDICTION` and
  `LEGAL_UPDATED`, shown in a grey box until you fill them in. No company is made
  up for you.
- **SEO and sharing**, always on: Open Graph and Twitter cards with the thumbnail
  and duration on watch pages, channels and Snips, canonical links, JSON-LD
  `VideoObject`, `/sitemap.xml` (paginated, public videos and channels) and
  `/robots.txt`. Set `SITE_URL` to your address (optional, read at request time).
- **Error pages**: the 2019 style 404 and 500.
- **Maintenance mode**: switch the `maintenance` flag to `everyone` and everyone
  but admins sees one static page (503) and the API answers
  `{"error":"maintenance"}`. Sign in stays open.
- **Performance and accessibility**: `next/image` for thumbnails and avatars,
  loading skeletons, the next feed page read ahead, a skip link, focus rings,
  names for icon buttons, player keys (space, arrows, m, f, c). Checked with
  Lighthouse and axe-core; the scores are in [`docs/launch.md`](launch.md).

To set it up, run `supabase/migrations/017_launch.sql` in the
[SQL editor](https://supabase.com/dashboard/project/_/sql/new)
(after 001 to 016). It adds the `contact_messages` table, the sitemap functions
and the `launch` and `maintenance` flags, both `off`. Fill in `site.config.ts`,
then switch `launch` to `test` or `everyone`.

## Yapin'

Works with [Yapin'](https://www.yapin.gg), the chat app the owner also runs.
Everything is behind the `yapin` flag and keeps working without the Yapin'
settings: the buttons are hidden and the routes answer 503 `yapin_off`.

- **Sign in with Yapin'**: Continue with Yapin' under Google on `/login` and
  `/signup`. OAuth2 authorization code with PKCE (S256): people go to Yapin's
  consent page at `https://www.yapin.gg/oauth/authorize`, the server swaps the
  code at `/api/oauth/token` and reads `/api/oauth/me` (`id`, `username`,
  `display_name`, `avatar_url`). The only scope is `identify`: Yapin' never
  shares an email address, so nothing is ever matched by email. A signed state
  cookie is good for 10 minutes and the callback is `/auth/yapin`. A Yapin'
  account already linked signs in to its sloptube account; otherwise a new
  account is made (then `/welcome` asks for the birthday and username like
  Google sign up). The session is made on the server with the Supabase secret
  key: a one time magic link token that is redeemed right away and never sent
  anywhere.
- **Accounts made with Yapin'**: Supabase needs an email address, so a new
  account gets a placeholder, `yapin_<yapin id>@users.noreply.<your host>`
  (the host of `SITE_URL`, or the address the browser used). There is no
  mailbox behind it: `profiles.email_placeholder` marks it, the app never shows
  it and nothing should ever mail it. **Settings** offers "Add an email": Supabase
  sends a confirm link to the new address and, once opened, the real address
  replaces the placeholder and the mark is cleared. Until then Yapin' is the
  only way in, so Unlink is refused (`needs_email`).
- **Settings > Connections**: link a Yapin' account to the account you are
  signed in to, or unlink it. A Yapin' account links to one sloptube account.
  This is the way to use Yapin' with an account you already have.
- **Share to Yapin'**: a Yapin' button in the share box copies the title and
  the link and opens Yapin' in a new tab to paste it. Yapin' has no share
  page, so `YAPIN_SHARE_TEMPLATE` in `lib/yapin/rules.ts` is `null`. If Yapin'
  ever adds one, set it there.
- **Playable link previews**: watch pages and Snips add `og:video` and a
  `twitter:player` card pointing at `/embed/<id>`, the player alone. Only
  yapin.gg, yapper.website (and their subdomains) and this site may frame it
  (`Content-Security-Policy: frame-ancestors`). Public and unlisted ready videos
  only, kept out of search engines.
- **Upload announcements**: in **Studio > Settings**, paste the incoming
  webhook URL of a Yapin' channel, `https://www.yapin.gg/api/webhooks/<id>/<token>`
  (yapin.gg, www.yapin.gg, yapper.website and www.yapper.website are taken, the
  same service; nothing else). No bot token is needed. When a video uploaded
  after that first becomes public and ready, the encoder posts a Discord style
  message there (`content` with the watch link, one embed with the title,
  thumbnail and channel, no mentions), with 3 retries (2, 4 and 8 seconds).
  Yapin' only shows embed images from its own list of image hosts, so the
  thumbnail may not show for your media host; the watch link in the message
  always unfurls into a card from the watch page's Open Graph tags. The studio lists
  each post as Waiting, Posted or Failed with the reason. The URL is a secret:
  it is never sent back to the browser after saving, only its last 4
  characters, and never logged.

To set it up:

1. Run `supabase/migrations/018_yapin.sql` and then `019_yapin_facts.sql` in the
   [SQL editor](https://supabase.com/dashboard/project/_/sql/new)
   (after 001 to 017). They add the columns, the two tables, the functions and a
   `yapin` flag that starts `off`.
2. For sign in: register a Yapin' app and set `YAPIN_CLIENT_ID`,
   `YAPIN_CLIENT_SECRET` and `SUPABASE_SERVICE_ROLE_KEY` on the app server. The
   steps and the redirect URI are in [`docs/launch.md`](launch.md#yapin).
3. For announcements: set `SITE_URL` on the encoder box (see
   [`ops/encoder/README.md`](../ops/encoder/README.md)).
4. Switch the `yapin` flag to `test` (with your user id) or `everyone`.

`node scripts/yapin-shots.mjs` runs the production build against the made up
site, a stand in for Yapin' (its OAuth endpoints and an incoming webhook), and
checks sign in, linking, the share box, `/embed`, the share cards and the
announcements, with screenshots in `shots/yapin/`. Nothing in it talks to the
real Yapin'.
