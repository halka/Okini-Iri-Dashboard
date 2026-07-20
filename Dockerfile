# syntax=docker/dockerfile:1

# ---- Build stage ----
FROM node:22-slim AS builder

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
FROM node:22-slim AS runner

WORKDIR /app

# Install wrangler globally so it is available on PATH
# (re-using the local node_modules is also fine; here we copy them)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy built Worker and required project files
COPY --from=builder /app/dist ./dist
COPY wrangler.toml ./
COPY migrations/ ./migrations/

# Wrangler stores its local D1 / KV state under .wrangler/
# Mount a named volume here to persist data across container restarts.
VOLUME ["/app/.wrangler"]

# Wrangler dev listens on 0.0.0.0:8787 by default
EXPOSE 8787

# Apply local D1 migrations then start the Worker
# --ip 0.0.0.0  → makes the port reachable from outside the container
# --local        → use local D1 / KV (no Cloudflare account needed)
CMD ["sh", "-c", "npx wrangler d1 migrations apply bookmark-dashboard --local && npx wrangler dev --ip 0.0.0.0 --local"]
