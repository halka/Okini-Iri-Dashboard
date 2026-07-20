# Okini Iri Dashboard
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/halka/Okini-Iri-Dashboard)

A private, responsive bookmark manager built with Astro and Cloudflare Workers. Bookmark data is stored in Cloudflare D1, UI preferences are stored in a dedicated Cloudflare KV namespace, and all visual tokens remain in CSS.

Production access can be protected by OpenID Connect (OIDC). When OIDC is configured, the application uses the Authorization Code flow with PKCE, validates state and nonce values, verifies ID token signatures, rotates the Astro session after login, and enforces the configured allowlist. When OIDC is not configured, the dashboard runs without an authentication gate.



## Screenshot

Light mode:

![Okini Iri Dashboard light mode screenshot](docs/screenshot-dashboard-light.png)

Dark mode:

![Okini Iri Dashboard dark mode screenshot](docs/screenshot-dashboard-dark.png)

## Quick Start

To deploy your own dashboard, use the Cloudflare button above, then complete the D1 and KV configuration in [Cloudflare Setup](#cloudflare-setup). OIDC is optional.

To try it locally:

```sh
npm ci
npm run rebuild:local
npm run preview
```

Open [http://localhost:8787](http://localhost:8787), then choose **Menu > Import** to load a Chrome bookmark HTML file. OGP and non-secret OIDC settings are available under **Menu > System settings**.

## Using the Dashboard

1. Select **Add**, enter a URL, and move focus away from the URL field. The dashboard automatically fetches the resolved URL, title, description, and favicon. Use **Fetch** or **Refetch** only when you want to run that step manually.
2. Review the fetched fields, choose a folder and tags, then save the bookmark. New folders and color-coded tags can also be created from the editor.
3. Use search, **All**, **Uncategorized**, a folder, or **Favorites** to narrow the list. Selecting the app title in the header clears active filters and returns to the top.
4. Bookmark cards always show the URL. Select **Description / notes** for the full text, or **Pretty view** when JSON/XML preview is enabled for that bookmark.

The header menu keeps account information and sign-out controls separate from **Manage folders**, **Manage tags**, **Import**, and **System settings**. System settings contains OGP, optional OIDC, and full-reset controls.

## Table of Contents

- [Okini Iri Dashboard](#okini-iri-dashboard)
  - [Screenshot](#screenshot)
  - [Quick Start](#quick-start)
  - [Using the Dashboard](#using-the-dashboard)
  - [Requirements](#requirements)
  - [Cloudflare Setup](#cloudflare-setup)
    - [OIDC Setup](#oidc-setup)
    - [OIDC settings](#oidc-settings)
  - [Local Development](#local-development)
  - [Docker](#docker)
  - [Apple Container](#apple-container)
  - [Import Behavior](#import-behavior)
  - [Reset Behavior](#reset-behavior)
  - [Scripts](#scripts)
  - [Features](#features)
  - [Technology](#technology)
  - [Configuration](#configuration)
  - [Architecture](#architecture)
    - [Responsibility Boundaries](#responsibility-boundaries)
  - [Data Model](#data-model)
  - [API Overview](#api-overview)
  - [Author](#author)
  - [Contributing](#contributing)
  - [LICENSE](#license)

## Requirements

- Node.js 22.12 or later
- npm
- A Cloudflare account for remote deployment

## Cloudflare Setup

Create one D1 database and two KV namespaces:

```sh
npx wrangler d1 create bookmark-dashboard
npx wrangler kv namespace create PREFERENCES
npx wrangler kv namespace create SESSION
```

Replace the placeholders in `wrangler.toml`:

- `REPLACE_WITH_CLOUDFLARE_D1_DATABASE_ID`
- `REPLACE_WITH_CLOUDFLARE_KV_NAMESPACE_ID`
- `REPLACE_WITH_CLOUDFLARE_SESSION_KV_NAMESPACE_ID`

### OIDC Setup

Register the following redirect URI with your OIDC provider:

```text
https://your-dashboard.example.com/auth/callback
```

If the provider supports RP-initiated logout, also register:

```text
https://your-dashboard.example.com/auth/signed-out
```

To protect the dashboard with OIDC, add non-secret settings to `wrangler.toml` for the first production login:

```toml
[vars]
OIDC_ISSUER_URL = "https://identity.example.com/"
OIDC_CLIENT_ID = "bookmark-dashboard"
OIDC_SCOPES = "openid profile email"
OIDC_ALLOWED_EMAILS = "you@example.com"
AUTH_SESSION_TTL_SECONDS = "28800"
```

Store a confidential-client secret with Wrangler:

```sh
npx wrangler secret put OIDC_CLIENT_SECRET
```

After you can sign in, open **Menu > System settings** to edit OGP metadata and non-secret OIDC settings from the screen. Worker environment variables still take priority over screen-saved values, so remove a variable from `wrangler.toml` when you want the KV-backed screen value to control that setting. `OIDC_CLIENT_SECRET` always stays in Cloudflare Secrets and is not saved through the browser.

### OIDC settings

| Variable | Required | Purpose |
| --- | --- | --- |
| `OIDC_ISSUER_URL` | With OIDC | HTTPS issuer URL used for OIDC discovery |
| `OIDC_CLIENT_ID` | With OIDC | Registered OIDC client identifier |
| `OIDC_CLIENT_SECRET` | Confidential clients | Secret stored with `wrangler secret`, never committed |
| `OIDC_TOKEN_AUTH_METHOD` | No | `client_secret_basic` (default with a secret), `client_secret_post`, or `none` |
| `OIDC_SCOPES` | No | Defaults to `openid profile email`; `openid` is always included |
| `OIDC_ALLOWED_EMAILS` | No | Comma-separated, case-insensitive email allowlist |
| `OIDC_ALLOWED_DOMAINS` | No | Comma-separated, case-insensitive email-domain allowlist |
| `AUTH_SESSION_TTL_SECONDS` | No | Authenticated-session lifetime; defaults to 8 hours |

When both allowlists are omitted, every identity authenticated by the configured provider is accepted. Configure at least one allowlist for a personal deployment.

Then migrate, build, and deploy:

```sh
npm run db:migrate:remote
npm run build
npx wrangler deploy
```

> [!CAUTION]
> Test the provider callback and allowlist before sharing the Worker URL. Bookmarklets and imported URLs should still be treated as trusted personal data.

## Local Development

Install dependencies and prepare the local D1 database:

```sh
npm ci
npm run rebuild:local
npm run preview
```

Open [http://localhost:8787](http://localhost:8787). When OIDC is not configured, requests use an authentication-disabled account context. Choose **Menu > Import** to populate the database from a Chrome bookmark HTML file.

`rebuild:local` runs the strict Astro checks, creates the Worker build, and applies pending local D1 migrations. It preserves existing local records.

## Docker

The repository ships a multi-stage `Dockerfile` and a `docker-compose.yml` so the dashboard can be run inside a container without installing Node.js, npm, or wrangler locally.

**Files**

| File | Purpose |
| --- | --- |
| `Dockerfile` | Builder stage compiles the Astro Worker; runner stage applies D1 migrations and starts `wrangler dev` |
| `docker-compose.yml` | Maps port 8787, mounts the persistence volume, and exposes optional OIDC environment variables |
| `.dockerignore` | Excludes `node_modules/`, `.wrangler/`, `.git/`, and other large paths from the build context |

**Quick start**

```sh
# Build the image and start the container (first run or after source changes)
docker compose up --build

# Subsequent starts without rebuilding
docker compose up
```

Open [http://localhost:8787](http://localhost:8787).

**Data persistence**

Wrangler stores its local D1 database and KV namespaces under `.wrangler/`. The compose file mounts a named Docker volume (`wrangler_data`) at `/app/.wrangler` so bookmark and preference data survives `docker compose down` and container restarts.

**OIDC in Docker**

To enable OIDC protection, create a `.env` file in the project root:

```env
OIDC_CLIENT_SECRET=your-secret-here
```

Then uncomment the OIDC environment variable block in `docker-compose.yml` and fill in the non-secret values:

```yaml
environment:
  OIDC_ISSUER_URL: "https://identity.example.com/"
  OIDC_CLIENT_ID: "bookmark-dashboard"
  OIDC_CLIENT_SECRET: "${OIDC_CLIENT_SECRET}"
  OIDC_SCOPES: "openid profile email"
  OIDC_ALLOWED_EMAILS: "you@example.com"
  AUTH_SESSION_TTL_SECONDS: "28800"
```

> [!NOTE]
> `wrangler dev --local` does not require a Cloudflare account. All D1 and KV bindings are emulated on-disk inside the container.

## Apple Container

For **Apple Silicon Macs (M1 or later)** running **macOS 15 or later**, the dashboard can be run with [Apple Container](https://github.com/apple/container), Apple's native container runtime. Each container runs in its own lightweight VM; no Docker Desktop or daemon is required.

**Prerequisites**

```sh
# Install the container CLI
brew install container

# Start the system service (installs a kernel on first run)
container system start
```

**Files**

| File | Purpose |
| --- | --- |
| `Dockerfile` | Same OCI-compatible image used by Docker — no changes needed |
| `container-run.sh` | Convenience script that builds the image, creates a named volume, and runs the container |

**Quick start**

```sh
# Build the image and start the container (first run or after source changes)
./container-run.sh --build

# Start without rebuilding
./container-run.sh

# Follow logs
./container-run.sh logs

# Stop and remove the container
./container-run.sh stop
```

Open [http://localhost:8787](http://localhost:8787).

**Data persistence**

A named volume (`okini-iri-wrangler`) is mounted at `/app/.wrangler` inside the container. Wrangler's local D1 database and KV state are written there and persist across container restarts.

**OIDC in Apple Container**

Pass OIDC environment variables with `-e` flags on the `container run` command, or edit `container-run.sh` to add them to the `container run` call:

```sh
container run \
  --name okini-iri-dashboard \
  --detach \
  -p 8787:8787 \
  -v okini-iri-wrangler:/app/.wrangler \
  -e OIDC_ISSUER_URL="https://identity.example.com/" \
  -e OIDC_CLIENT_ID="bookmark-dashboard" \
  -e OIDC_CLIENT_SECRET="your-secret" \
  -e OIDC_ALLOWED_EMAILS="you@example.com" \
  okini-iri-dashboard
```

> [!NOTE]
> Apple Container does not yet support a native compose format. `container-run.sh` serves as the single-container equivalent of `docker compose up`.

## Import Behavior

When D1 has no bookmarks and no search or filter is active, the workspace presents a direct Chrome bookmark HTML picker. The **Import** screen in the header menu provides the same control later.

The importer accepts Chrome `.html` or `.htm` exports up to 10 MiB. UTF-8, Shift_JIS (including Windows-31J), EUC-JP, and ISO-2022-JP input is detected and converted to Unicode before it is sent as UTF-8 JSON. URL metadata and structured preview responses use the same conversion boundary. The importer closes the **Import** screen after file selection, shows an indeterminate progress overlay, imports metadata with bounded concurrency, and reloads after success.

The parser excludes Chrome's synthetic root folder named `ブックマーク バー` or `Bookmarks bar`. HTTP(S) bookmarks receive metadata enrichment. `javascript:` and `data:` bookmarklets are retained but are not sent to the metadata or preview fetchers.

Metadata, favicon, and preview requests only fetch public HTTP(S) URLs on standard ports. Private/local address ranges, application-origin URLs, credential-bearing URLs, and redirects that leave the public boundary are rejected. Redirects are capped, response bodies are bounded, and remote requests use `no-store` caching.

## Reset Behavior
> [!CAUTION]
> Full reset deletes bookmarks, folders, tags, and bookmark/tag relationships. It does not delete UI preferences. This operation cannot be undone.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start Astro's development server |
| `npm run preview` | Run the built Worker with Wrangler |
| `npm run build` | Run `astro check` and create the production Worker build |
| `npm run rebuild:local` | Build and apply local D1 migrations |
| `npm run db:migrate:local` | Apply D1 migrations to the local database |
| `npm run db:migrate:remote` | Apply D1 migrations to the remote database |
| `npm run cf-typegen` | Regenerate Cloudflare binding types |
| `docker compose up --build` | Build the Docker image and start the container |
| `docker compose up` | Start the container without rebuilding the image |
| `docker compose down` | Stop the container (data is preserved in the named volume) |
| `./container-run.sh --build` | Build the image and start with Apple Container (Apple Silicon, macOS 15+) |
| `./container-run.sh` | Start with Apple Container without rebuilding |
| `./container-run.sh stop` | Stop the Apple Container container |
| `./container-run.sh logs` | Follow Apple Container logs |

## Features

- Import UTF-8 and legacy Japanese Chrome bookmark HTML exports with progress feedback and automatic reload
- Fetch redirect-resolved URLs, titles, descriptions, and favicons with legacy Japanese encoding support
- Create, read, update, and delete bookmarks, folders, and tags
- Delete a folder together with its nested folders and bookmarks
- Search across title, URL, description, and notes
- Filter favorites independently of the selected folder
- Add folders and tags directly from the bookmark editor
- Choose tag colors when creating or editing tags
- Toggle favorites from bookmark cards
- Enable JSON/XML pretty view per bookmark
- Highlight JSON/XML with `highlight.js` and make embedded HTTP(S) URLs actionable
- Switch between Japanese and English without changing control dimensions
- Use light, dark, or device-controlled color modes
- Work across phone, tablet, desktop, and iOS Safari layouts
- Fully reset all bookmark data stored in D1
- Optionally authenticate pages and APIs through a configurable OIDC provider
- Edit OGP metadata and non-secret OIDC settings from **System settings**
- Restrict access to selected email addresses or email domains
- End both the local application session and, when supported, the OIDC provider session

## Technology

- Astro 7 with the Cloudflare adapter
- Cloudflare Workers
- Cloudflare D1 for bookmark domain data
- Cloudflare KV `PREFERENCES` for locale, color-mode, OGP, and non-secret OIDC settings
- Cloudflare KV `SESSION` for Astro's adapter-managed session storage
- Cloudflare Workers compatibility flag `global_fetch_strictly_public` for outbound fetch hardening
- `oauth4webapi` for the OIDC Authorization Code flow with PKCE
- `encoding-japanese` for browser-side UTF-8, Shift_JIS, EUC-JP, and ISO-2022-JP detection and conversion
- `highlight.js` for JSON/XML syntax highlighting
- TypeScript in strict mode

## Configuration

- `src/config/app.ts`: product identity, canonical URL, and outbound User-Agent values
- `src/config/settings.ts`: OGP defaults and screen-editable OIDC setting contracts
- `src/config/preferences.ts`: supported locales, color modes, and defaults
- `src/i18n/messages.ts`: all visible Japanese and English strings
- `src/styles/global.css`: light/dark tokens and presentation colors
- Worker variables and secrets: OIDC provider metadata, client credentials, allowlists, and session lifetime

## Architecture

The codebase separates domain data, infrastructure, HTTP handling, browser behavior, and presentation:

```text
src/
├── components/              Astro UI structure
├── config/                  Identity, metadata, and preference defaults
├── domain/auth.ts           Authenticated-user and OIDC transaction contracts
├── domain/bookmarks.ts      Shared bookmark domain contracts
├── i18n/messages.ts         Japanese and English copy
├── lib/
│   ├── d1.ts                D1 binding access only
│   ├── kv.ts                Preferences KV binding access only
│   ├── http.ts              API responses and runtime validation
│   ├── remote-fetch.ts      Public URL validation and bounded redirects
│   ├── settings.ts          KV-backed OGP and non-secret OIDC settings
│   ├── metadata.ts          Remote metadata and favicon retrieval
│   ├── auth/                OIDC configuration, protocol flow, and session helpers
│   └── repositories/        D1 queries grouped by domain operation
├── middleware.ts            Page/API authentication and request security checks
├── pages/
│   ├── api/                 Authenticated HTTP route orchestration
│   └── auth/                Login, callback, logout, and status routes
├── scripts/
│   ├── dashboard.ts         Screen state and interaction coordination
│   └── lib/                 Browser API, i18n, theme, DOM, and preview helpers
└── styles/global.css        Theme tokens, layout, and component presentation
```

### Responsibility Boundaries

- D1 stores bookmarks, folders, tags, and their relationships. Schema changes happen only through versioned migrations.
- `PREFERENCES` KV stores locale, color-mode, OGP, and non-secret OIDC settings. It does not store bookmark records, visual color values, or OIDC client secrets.
- `SESSION` KV stores OIDC transactions, authenticated-user sessions, and the ID token used for provider logout.
- OIDC client secrets are Worker secrets, never D1 or KV domain records. Environment variables override matching screen-saved OIDC policy settings.
- CSS owns theme tokens and presentation. Tag colors are stored with tag records in D1.
- API routes validate HTTP input and delegate persistence to repositories.
- Browser modules own UI state and DOM behavior; they do not contain D1 or KV logic.
- GET requests are read-only. Import and reset behavior is always explicit.

## Data Model

| Table | Responsibility |
| --- | --- |
| `bookmarks` | URL, title, description, notes, favicon URL, favorite flag, and structured-preview flag |
| `folders` | Folder hierarchy and ordering |
| `tags` | Unique tag names and primary colors |
| `bookmark_tags` | Many-to-many bookmark/tag relationships |

The archive field is not part of the current schema. Theme colors are controlled by CSS variables.

## API Overview

| Endpoint | Methods | Purpose |
| --- | --- | --- |
| `/api/bookmarks` | `GET`, `POST` | Filter/list and create bookmarks |
| `/api/bookmarks/:id` | `GET`, `PATCH`, `DELETE` | Read, update, and delete one bookmark |
| `/api/folders` | `GET`, `POST` | List and create folders |
| `/api/folders/:id` | `PATCH`, `DELETE` | Update or recursively delete a folder |
| `/api/tags` | `GET`, `POST` | List and create tags |
| `/api/tags/:id` | `PATCH`, `DELETE` | Update and delete a tag |
| `/api/metadata` | `POST` | Resolve an HTTP(S) URL and fetch metadata |
| `/api/preview` | `POST` | Fetch up to 1 MiB for JSON/XML preview |
| `/api/import` | `POST` | Import Chrome bookmark HTML |
| `/api/preferences` | `GET`, `PATCH` | Read and update KV-backed UI preferences |
| `/api/settings` | `GET`, `PATCH` | Read and update KV-backed OGP and non-secret OIDC settings |
| `/api/reset` | `DELETE` | Delete all D1 domain records |

JSON responses use `no-store` and `nosniff` headers. Runtime validation rejects malformed input before repository operations. Deployed responses also set CSP, clickjacking, referrer, cross-origin, HSTS, and cache-control headers; static assets use explicit immutable or revalidation-friendly cache rules.
When OIDC is configured, every API endpoint requires an authenticated session and returns `401` instead of redirecting an unauthenticated API request. When OIDC is not configured, APIs remain available without a login session.

## Author
### halka

- [Website halka.jp](https://halka.jp)
- [Website rjch.jp](https://rjch.jp)

![Made in Goryokaku](https://private-user-images.githubusercontent.com/71738/623899498-966287f1-8ec7-4464-994a-79caddd20dac.webp?jwt=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJnaXRodWIuY29tIiwiYXVkIjoicmF3LmdpdGh1YnVzZXJjb250ZW50LmNvbSIsImtleSI6ImtleTUiLCJleHAiOjE3ODQ1NTE5NzEsIm5iZiI6MTc4NDU1MTY3MSwicGF0aCI6Ii83MTczOC82MjM4OTk0OTgtOTY2Mjg3ZjEtOGVjNy00NDY0LTk5NGEtNzljYWRkZDIwZGFjLndlYnA_WC1BbXotQWxnb3JpdGhtPUFXUzQtSE1BQy1TSEEyNTYmWC1BbXotQ3JlZGVudGlhbD1BS0lBVkNPRFlMU0E1M1BRSzRaQSUyRjIwMjYwNzIwJTJGdXMtZWFzdC0xJTJGczMlMkZhd3M0X3JlcXVlc3QmWC1BbXotRGF0ZT0yMDI2MDcyMFQxMjQ3NTFaJlgtQW16LUV4cGlyZXM9MzAwJlgtQW16LVNpZ25hdHVyZT1lMWYyZGQ3NTc5NDM4YTM1MDFmOGMwOTNhMjZhNWQ5N2E4NTBkZDdlOThkNWNiYmY0MGZjNGI2NGEzY2Y3YTlmJlgtQW16LVNpZ25lZEhlYWRlcnM9aG9zdCZyZXNwb25zZS1jb250ZW50LXR5cGU9aW1hZ2UlMkZ3ZWJwIn0.XhWUjdKtd5Og5Mhosi-6ScSLoI6nU7qASPLsH0Ph36E)

## Contributing

Contributions are welcome! Feel free to open an issue to report a bug or suggest a feature, or submit a pull request with improvements to the code, documentation, or Docker/container setup.

## LICENSE
MIT
