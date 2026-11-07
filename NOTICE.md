# Third party notices

sloptube's own code is under the [MIT license](LICENSE). It uses, but does not
copy into this repository, the open source software and assets below. Their
licenses travel with them in `node_modules/` and in the Docker images.

## Fonts and icons

- **Roboto** (Google Fonts, Apache License 2.0), loaded with `next/font/google`
  and served from the site at build time.
- **Material Icons** paths in `components/icons.tsx` (Google, Apache License
  2.0).
- The **Google "G"** on the "Sign in with Google" button is Google's mark, used
  as Google's sign in branding guidelines ask. It is not covered by this
  project's MIT license.
- The sloptube logo, the Shorts mark, `public/sample-*.svg` and everything in
  `public/press/` and `shots/` are this project's own drawings and screenshots
  of made up content (generated test patterns, made up names), under the MIT
  license.

## Runtime packages (website)

| Package | License |
| --- | --- |
| next, react, react-dom | MIT |
| @supabase/supabase-js, @supabase/ssr | MIT |
| zustand | MIT |
| hls.js | Apache-2.0 |
| @aws-sdk/client-s3, @aws-sdk/s3-request-presigner | Apache-2.0 |
| sharp (optional, pulled in by Next.js for image optimization) | Apache-2.0; its prebuilt **libvips** binaries (`@img/sharp-libvips-*`) are **LGPL-3.0-or-later**, dynamically linked and unmodified |

Development and build only, not shipped in the app image: tailwindcss (MIT), eslint (MIT), typescript
(Apache-2.0), axe-core (MPL-2.0), lighthouse (Apache-2.0; pulls in lightningcss
MPL-2.0 and Sentry's FSL-1.1-Apache-2.0 client).

No GPL licensed npm package is a dependency. Run `npx license-checker --summary`
for the full list of the installed tree.

## The encoder (worker/)

- npm packages: @aws-sdk/client-s3 (Apache-2.0), @supabase/supabase-js (MIT).
- **FFmpeg** is not part of this repository. The worker runs the `ffmpeg` and
  `ffprobe` programs as separate processes, which does not make sloptube a
  derivative work of FFmpeg. The encoder Docker image (`ops/encoder/Dockerfile`)
  installs Debian's `ffmpeg` package, which is built with libx264 and is
  therefore distributed under the **GPL-2.0-or-later**. If you publish that
  image, the GPL applies to the FFmpeg binaries in it: the matching source is
  available from Debian (`apt-get source ffmpeg`, or
  [sources.debian.org/src/ffmpeg](https://sources.debian.org/src/ffmpeg/)).
  The license texts are in the image under `/usr/share/doc/`.

## Trademarks

"YouTube" and "YouTube Shorts" are trademarks of Google LLC. sloptube follows the
general page layout common to video sites of 2019 and 2020, but it is not
affiliated with, endorsed by or sponsored by Google or YouTube. The sloptube
name, the green slop mark and the Snips drop are the project's own drawings
(`lib/brand.ts`) and do not use any YouTube logo, play button or name. Yapin' is a separate service; sloptube only
talks to its public OAuth and webhook API.
