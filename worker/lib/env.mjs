// The worker's settings, read from the environment (the box's env file).
import { hostname, tmpdir } from "node:os";
import { YAPIN_WEBHOOK_HOSTS } from "./yapin.mjs";

export const REQUIRED_ENV = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
];

/**
 * Optional:
 *   WORKER_NAME       shown in encode_jobs.worker (default: the host name)
 *   WORK_DIR          where sources are downloaded and encoded (default: the system temp folder)
 *   STATE_DIR         where the busy marker for the update script lives (default: none)
 *   MEDIA_PUBLIC_URL  https base that serves the bucket's hls/ files, for thumbnail_url.
 *                     Without it thumbnail_url stays empty and the app signs a link.
 *   SITE_URL          this sloptube's address, like https://tube.example.com, for the
 *                     links in Yapin' announcements (feature 16). Without it none are posted.
 */
export function readConfig(env = process.env) {
  const get = (name) => env[name]?.trim() || "";
  const missing = REQUIRED_ENV.filter((name) => !get(name));
  const publicUrl = get("MEDIA_PUBLIC_URL").replace(/\/+$/, "");
  const siteUrl = get("SITE_URL").replace(/\/+$/, "");
  return {
    missing,
    supabaseUrl: get("SUPABASE_URL"),
    serviceRoleKey: get("SUPABASE_SERVICE_ROLE_KEY"),
    r2: {
      accountId: get("R2_ACCOUNT_ID"),
      accessKeyId: get("R2_ACCESS_KEY_ID"),
      secretAccessKey: get("R2_SECRET_ACCESS_KEY"),
    },
    bucket: get("R2_BUCKET"),
    workerName: get("WORKER_NAME") || hostname(),
    workDir: get("WORK_DIR") || tmpdir(),
    stateDir: get("STATE_DIR") || null,
    mediaPublicUrl: /^https:\/\//.test(publicUrl) ? publicUrl : null,
    siteUrl: /^https?:\/\/[^/\s]+$/.test(siteUrl) ? siteUrl : null,
    yapinHosts: YAPIN_WEBHOOK_HOSTS,
  };
}
