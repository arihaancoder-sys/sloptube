#!/usr/bin/env node
// A demo of sloptube with made up content and no accounts to set up: the
// production build against the local stand in for Supabase that the launch
// checks use (scripts/launch-mock.mjs). Three made up channels, a dozen
// videos and a few Snips, all a generated test pattern. Nothing touches the
// network and nothing is saved.
//
//   npm run build
//   npm run demo          # http://localhost:3470, Ctrl+C to stop
//
// Needs ffmpeg on the PATH for the test clip and the thumbnails.
// The admin cookie is not set, so you browse as a signed out visitor.

import { startSite } from "./launch-mock.mjs";

const port = Number(process.env.APP_PORT ?? 3470);
const site = await startSite({ port });
console.log(`\nsloptube demo running at ${site.base}`);
console.log("Made up channels and videos, served by a local stand in for Supabase. Ctrl+C to stop.\n");

const stop = () => {
  site.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
setInterval(() => {}, 1 << 30);
