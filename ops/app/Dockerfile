# sloptube app image.
# Build from the repo root:
#   docker build -f ops/app/Dockerfile --build-arg GIT_SHA=$(git rev-parse HEAD) -t sloptube .

# 1. Install dependencies
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# 2. Build the app (output: 'standalone' in next.config.ts)
FROM node:22-bookworm-slim AS build
WORKDIR /app
ARG GIT_SHA=dev
ENV NEXT_TELEMETRY_DISABLED=1 \
    GIT_SHA=$GIT_SHA
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# 3. Small runtime image, runs as the unprivileged node user
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ARG GIT_SHA=dev
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    GIT_SHA=$GIT_SHA
LABEL org.opencontainers.image.source="https://github.com/myfilehero/sloptube" \
      org.opencontainers.image.revision=$GIT_SHA
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
