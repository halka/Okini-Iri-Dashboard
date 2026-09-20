# syntax=docker/dockerfile:1

# workerd's official Linux binaries require glibc. Copy only their three ELF
# dependencies; the build and final runtime still use Alpine and its musl Node.
FROM debian:trixie-slim AS workerd-glibc

RUN mkdir -p /compat/lib /compat/licenses \
  && cp -L /lib/*-linux-gnu/libc.so.6 /lib/*-linux-gnu/libm.so.6 \
    /lib/*-linux-gnu/ld-linux-*.so.* /compat/lib/ \
  && cp /usr/share/doc/libc6/copyright /compat/licenses/glibc-copyright

FROM node:22-alpine3.24 AS base

RUN apk add --no-cache ca-certificates && update-ca-certificates

COPY --from=workerd-glibc /compat/lib/ /lib/
COPY --from=workerd-glibc /compat/licenses/ /usr/share/licenses/workerd-glibc/

# The x86_64 ELF interpreter lives in /lib64; arm64 already uses /lib.
RUN if [ -e /lib/ld-linux-x86-64.so.2 ]; then \
      mkdir -p /lib64; \
      if [ ! -e /lib64/ld-linux-x86-64.so.2 ]; then \
        ln -s /lib/ld-linux-x86-64.so.2 /lib64/ld-linux-x86-64.so.2; \
      fi; \
    elif [ ! -e /lib/ld-linux-aarch64.so.1 ]; then \
      echo "The container supports only linux/amd64 and linux/arm64" >&2; exit 1; \
    fi

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
