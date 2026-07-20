# syntax=docker/dockerfile:1

# ---- Build stage ----
FROM node:22-bookworm-slim AS builder

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
FROM node:22-bookworm-slim AS runner

WORKDIR /app

# Keep the runtime trust store current for outbound fetches made by workerd.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && update-ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt

# Install the locked runtime dependencies, including Wrangler.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

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
