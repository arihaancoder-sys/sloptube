# Database migrations

Every change to the database lives in this folder as a numbered SQL file.

| File | What it adds |
| --- | --- |
| `000_init.sql` | `app_meta` key/value table |
| `001_feature_flags.sql` | `feature_flags` table (see "Feature flags" in the main README) |
| `002_profiles.sql` | `profiles`, the sign up trigger, `complete_signup`, `username_available`, `delete_account`, the `accounts` flag |
| `003_avatars.sql` | the public `avatars` storage bucket and its policies |
| `004_channels.sql` | `channels` (one per profile, made by a trigger and backfilled), `set_channel_handle`, `channel_handle_available`, the public `banners` bucket, the `channels` flag (off) |
| `005_videos.sql` | `videos` (readable when public and ready, owners read all their own), `create_upload`, `finish_upload`, `abandon_upload`, `update_upload_details`, the `upload` flag (off) |
| `006_processing.sql` | `encode_jobs` (owners read their own), a trigger that queues a job when a video is uploaded, the worker functions `claim_encode_job`, `encode_progress`, `encode_done`, `encode_failed` (service role only), `videos.renditions` and `videos.preview_sprite_key`, `channels.video_count` kept in step by a trigger, the `processing` flag (off) |
| `007_watch.sql` | `videos.views` (0 until feature 9 counts), `watch_video(video_id)` for the watch page and the media route (public and unlisted for everyone, private for the owner, playback fields only once ready or for the owner), the `watch` flag (off) |
| `008_feed.sql` | `feed_videos(kind, cursor, cursor_id, lim, for_channel)` for the home grid, `/trending` and channel pages (newest, trending, channel; keyset pages on published_at and id), `related_videos(video_id, lim)` for Up next, a feed index, the `feed` flag (off) |
| `009_subscriptions.sql` | `subscriptions` (people read only their own rows), `channels.subscriber_count` kept in step by a trigger (recounted once), no subscribing to your own channel, `subscribe`, `unsubscribe`, `set_notify` (60 changes an hour per person, logged in `subscription_changes`), `my_subscriptions()` for the guide, `subscriptions_feed(cursor, cursor_id, lim, only_notify)` for `/feed/subscriptions` and the bell, the `subscriptions` flag (off) |
| `010_search.sql` | `pg_trgm` (in the `extensions` schema), `videos.search_doc` (title weight A, description weight B) with a GIN index, trigram indexes on video titles and channel names and handles, `search_videos(q, cursor_rank, cursor_id, lim, filters)` (upload date, duration and sort filters; keyset pages on the sort key and id), `search_channels(q, lim)`, `search_suggest(q, lim)`, 60 searches a minute per person or address (240 suggestions) logged in `search_requests`, the `search` flag (off) |
| `011_engagement.sql` | `video_reactions` (people read their own) with `react(video_id, kind)` (30 a minute), `videos.like_count` and `video_dislike_counts` (owners only) kept by a trigger, `view_events` and `watch_ping(video_id, position_s, played_s)` (a view once per viewer per video per UTC day at 10 seconds watched, never faster than the wall clock, 20 pings a minute per viewer, signed out viewers by a hashed cookie key), `watch_history` with `my_history`, `my_progress`, `clear_history`, `remove_from_history`, `set_history_paused` and `profiles.history_paused`, `video_engagement(video_id)` for the watch page, `video_stats_daily` filled by `rollup_video_stats(days)` every hour with pg_cron, the `engagement` flag (off) |
| `012_comments.sql` | `comments` (one level of replies, soft delete keeps the thread, readable on public and unlisted ready videos) and `comment_likes` (people read their own), `videos.comment_count`, `comments.reply_count` and `like_count` kept by triggers (recounted once), `videos.comments_mode` and `channels.comments_default` (`on`, `off`, `held`), `post_comment` (10 a minute and 100 a day, 3 a minute for accounts under a day old), `edit_comment`, `delete_comment`, `like_comment`, `pin_comment` and `heart_comment` (the video's owner, one pin per video), `list_comments(video_id, sort, cursor, lim)`, `list_replies`, `comments_since` for the new comments pill, `comments_info`, `studio_comments`, `set_comments_mode`, `set_channel_comments_default`, the `comments` flag (off) |
| `013_shorts.sql` | `videos.is_short` set by a trigger (vertical and 60 seconds or under, unless the uploader said no; recounted once) and `videos.short_choice` with `set_short_choice(video_id, on)` (30 a minute), `list_shorts(cursor, lim)` for `/shorts` and the home shelf (unwatched first, then views, likes and comments over age, never the viewer's own, measured at the cursor's time; 60 a minute per person or address, logged in `shorts_requests`), `get_short(video_id)`, `short_watches` (people read their own) and a 3 second view for shorts in `watch_ping`, `feed_videos` with `exclude_shorts` and kind `channel_shorts`, the `shorts` flag (off) |
| `014_studio.sql` | `videos.deleted_at` and `trash_visibility` (a video in the trash is private, a trigger keeps it so, restore puts the old visibility back), `videos.tags` and `thumbnail_name`, `studio_overview()` for the dashboard, `studio_videos(trash)`, `studio_bulk(video_ids, action, visibility)` (visibility, trash, restore on up to 100 of your own videos, all or nothing, 60 a minute), `update_video`, `set_video_thumbnail` (60 edits a minute, logged in `studio_requests`), `purge_trash()` every day with pg_cron after 30 days, the `storage_cleanup` queue with `claim_cleanup`, `cleanup_done` and `cleanup_failed` for the worker (service role only), the `studio` flag (off) |
| `015_stats.sql` | `view_events.source` (home, search, subscriptions, channel, shorts, other, direct, external), `reached` (the twenty 5% parts and the end, marked by `stats_reached` from each ping) and `counted_at`; `watch_ping(video_id, position_s, played_s, source)`; `channel_stats_daily` (views and watch time, subscribers gained and lost by a trigger), `video_retention_daily` and `video_source_daily` filled by the hourly `rollup_video_stats`; `studio_analytics(range)`, `video_analytics(video_id, range)`, `realtime_views(video_id)` (owner only, 60 a minute, logged in `studio_requests`), the `stats` flag (off) |
| `016_moderation.sql` | `profiles.role` (`user` or `admin`, set in SQL) with `is_admin()`, bans (`profiles.banned_at`, every API request refused by `moderation_pre_request`, sessions deleted), suspensions (`channels.suspended_at`, videos private until unsuspended through `videos.held_visibility`), `channel_strikes` (3 in 90 days suspend), `reports` (video, comment or channel; one per person per target, 10 a day) and appeals with `report_target` and `appeal_removal`, removed videos (`videos.removed_at`, purged with the trash after 30 days) and comments (`comments.removed_at`, `comment_cards.removed`), `admin_reports`, `mod_action`, `mod_log` with `admin_log`, `admin_suspended`, `moderation_words` with `admin_words` and `admin_set_word`, triggers for the word list and the 5 link cap, `studio_videos` with the removal and the appeal, the `moderation` flag (off) |
| `017_launch.sql` | `contact_messages` (admins read it, nobody writes through the API) with `contact_send` (the `launch` flag, 5 a day per email address and per network address, the address kept only as a hash), `admin_contact_messages` and `admin_contact_mark`, `sitemap_counts`, `sitemap_videos` and `sitemap_channels` (public, ready, not removed or trashed videos and channels that are not suspended), the `maintenance` and `launch` flags (off) |
| `018_yapin.sql` | `profiles.yapin_id` (unique) and `yapin_username` (not readable through the API) with `yapin_find_user` and `link_yapin` (service role only), `unlink_yapin` and `yapin_status`; `yapin_webhooks` (one incoming webhook per channel, RLS owner only, the URL never readable, only `url_hint`) with `set_yapin_webhook`; `yapin_posts` (one announcement per video, queued by a trigger when a video uploaded after the webhook was connected first becomes public and ready) with `list_yapin_posts` and, for the encoder, `claim_yapin_posts` and `yapin_post_result` (service role only); 30 calls a minute per person logged in `yapin_requests`; the `yapin` flag (off) |
| `019_yapin_facts.sql` | Yapin' as it really is: `yapin_find_user(yapin_id)` only (the email lookup is dropped, Yapin' shares no email), `profiles.email_placeholder` (not readable through the API) set by `yapin_mark_placeholder` (service role only) for accounts made by Sign in with Yapin' and cleared by a trigger on `auth.users` when a real address replaces the placeholder, `unlink_yapin` refuses with `needs_email` while the placeholder is the only address, `yapin_status` answers `needs_email`; webhook URLs only `https://{www.,}{yapin.gg,yapper.website}/api/webhooks/<id>/<token>` (saved URLs that do not match are removed, their queued posts failed) |
| `020_flag_panel.sql` | `set_feature_flag(key, mode)` for admins (`is_admin()`, modes `off` / `test` / `everyone`, `test` lists the caller) so the flag panel (Ctrl+Shift+S) can flip flags without the table editor, and the `flag_panel` flag (starts `everyone`; the panel still shows for admins only) |

## How to apply them

Switch on `pg_cron` under **Database > Extensions** first (the stats rollup and
the trash purge are scheduled with it; without it those files only print a
notice).

**A new project, all at once.** `scripts/db-migrations.mjs` puts every file in
order into one SQL file, or runs them with `psql`:

```bash
npm run db:migrations > all-migrations.sql        # paste into the SQL editor and Run
npm run db:migrations -- --apply "postgresql://..."  # or run them with psql
```

The connection string is under the project's **Connect** button (Session
pooler). It holds the database password: keep it out of git and out of issues.

**A project that already has some.** Run only the new files, in number order:
paste each one into the [SQL editor](https://supabase.com/dashboard/project/_/sql/new)
and click **Run**, or `npm run db:migrations -- --from 021 --apply "postgresql://..."`.
Do not run the whole set again on a project that has it: a later file can
change what an earlier one made (`016` widens the `comment_cards` view that
`012` creates, so `012` fails once `016` is in). Each file on its own can be
run twice in a row.

## Rules

- **Numbered.** Files run in number order. Never rename or renumber an existing file.
- **Re-runnable.** Running a file twice must be harmless. Use `create table if not exists`,
  `create or replace function`, `drop policy if exists` before `create policy`, and so on.
- **Row level security on.** Every new table gets `enable row level security` and explicit policies.
- **Never edit an applied migration.** Fix things in a new, higher numbered file.
- **Views.** `create or replace view` cannot drop or reorder columns. When a new file changes a
  view's columns, use `drop view if exists ...` then `create view`, so older files stay re-runnable.
