import type { NextConfig } from "next";
import { embedCsp } from "./lib/yapin/rules";

const nextConfig: NextConfig = {
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
  env: {
    // Baked in at build time so /api/version can report it.
    BUILT_AT: new Date().toISOString(),
  },
  // Channel pages live at /@handle. A folder cannot start with "@" (that marks
  // a parallel route), so the pages sit in app/c/[handle] and these map them.
  async rewrites() {
    return [
      { source: "/@:handle", destination: "/c/:handle" },
      { source: "/@:handle/:tab(videos|shorts|about)", destination: "/c/:handle/:tab" },
    ];
  },
  // /embed/<id> (feature 16) may be framed by Yapin', yapper.website and this
  // site only. Every other page keeps the browser default.
  async headers() {
    return [{ source: "/embed/:id", headers: [{ key: "Content-Security-Policy", value: embedCsp() }] }];
  },
  // Subscriptions (feature 7) and History (feature 9) moved to YouTube's own addresses.
  async redirects() {
    return [
      { source: "/subscriptions", destination: "/feed/subscriptions", permanent: false },
      { source: "/history", destination: "/feed/history", permanent: false },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
