# sloptube encoder worker image: Node 22 and ffmpeg from Debian.
# The build context is the worker/ folder:
#   docker build -f ops/encoder/Dockerfile --build-arg GIT_SHA=$(git rev-parse HEAD) -t sloptube-encoder worker/

FROM node:22-bookworm-slim

# ffmpeg and ffprobe from the distro: H.264 (libx264), AAC, WebP and the HLS muxer.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# The tests come along so the ffmpeg smoke test can run on the box:
#   docker exec sloptube-encoder node --test test/
COPY index.mjs ./
COPY lib ./lib
COPY test ./test

ARG GIT_SHA=dev
ENV NODE_ENV=production \
    WORK_DIR=/work \
    STATE_DIR=/state \
    GIT_SHA=$GIT_SHA
LABEL org.opencontainers.image.source="https://github.com/myfilehero/sloptube" \
      org.opencontainers.image.description="sloptube encoder worker" \
      org.opencontainers.image.revision=$GIT_SHA

# /work holds the source and the encoded files of the one running job.
# /state holds the busy marker the update script checks.
RUN mkdir -p /work /state && chown node:node /work /state
USER node
CMD ["node", "index.mjs"]
