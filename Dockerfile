# syntax=docker/dockerfile:1

FROM node:22-alpine3.24 AS base

ARG TARGETARCH
ARG GLIBC_VERSION=2.42
ARG GLIBC_KEY_SHA256=a14b57143989380b1e6a0716e4351a788f870db164ea0d6a02098aeddf3f4fdb

# workerd's prebuilt Linux binaries require real glibc symbols that gcompat
# does not provide. Install the signed Alpine glibc package for this platform;
# pinning the signing key checksum prevents an unverified key replacement.
RUN case "$TARGETARCH" in amd64|arm64) ;; *) echo "Unsupported architecture: $TARGETARCH" >&2; exit 1 ;; esac \
  && apk add --no-cache ca-certificates \
  && update-ca-certificates \
  && wget -q https://raw.githubusercontent.com/dalet-oss/alpine-glibc/refs/heads/master/alpine-packaging-rsa.pub \
    -O /etc/apk/keys/alpine-packaging-rsa.pub \
  && echo "$GLIBC_KEY_SHA256  /etc/apk/keys/alpine-packaging-rsa.pub" | sha256sum -c - \
  && wget -q "https://github.com/dalet-oss/alpine-glibc/releases/download/${GLIBC_VERSION}-${TARGETARCH}/glibc-${GLIBC_VERSION}.apk" \
    -O /tmp/glibc.apk \
  && apk add --force-overwrite --no-cache /tmp/glibc.apk \
  && rm /tmp/glibc.apk

ENV SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt

# ---- Build stage ----
FROM base AS builder

WORKDIR /app

# Install dependencies (ci uses package-lock.json for reproducibility)
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and config files needed for build
COPY astro.config.mjs tsconfig.json wrangler.toml worker-configuration.d.ts ./
COPY src/ ./src/
COPY public/ ./public/
COPY migrations/ ./migrations/
COPY scripts/ ./scripts/

# Build the Worker (astro check + astro build)
RUN npm run build

# ---- Runtime stage ----
FROM base AS runner

WORKDIR /app

# Install the locked runtime dependencies, including Wrangler.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# npm's workerd installer only warns when its native binary cannot start.
# Exercise a real Worker with D1 and KV so incompatible images fail the build.
COPY scripts/container-smoke.mjs ./scripts/container-smoke.mjs
RUN node scripts/container-smoke.mjs

# Copy built Worker and required project files
COPY --from=builder /app/dist ./dist
COPY wrangler.toml ./
COPY migrations/ ./migrations/
COPY --chmod=0755 scripts/container-entrypoint.sh /usr/local/bin/container-entrypoint

# Wrangler stores its local D1 / KV state under .wrangler/
# Mount a named volume here to persist data across container restarts.
VOLUME ["/app/.wrangler"]

# Wrangler dev listens on 0.0.0.0:8787 by default
EXPOSE 8787

ENTRYPOINT ["container-entrypoint"]

# Apply local D1 migrations then start the Worker
# --ip 0.0.0.0  → makes the port reachable from outside the container
# --local        → use local D1 / KV (no Cloudflare account needed)
# Astro generates the Worker entrypoint, assets paths, and bindings in this config.
# Both commands must use it so migrations and requests resolve the same local D1 database.
CMD ["sh", "-c", "npx wrangler d1 migrations apply DB --config dist/server/wrangler.json --local --persist-to /app/.wrangler/state && npx wrangler dev --config dist/server/wrangler.json --ip 0.0.0.0 --local --persist-to /app/.wrangler/state"]
