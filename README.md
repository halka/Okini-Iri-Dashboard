# Okini Iri Dashboard

A private, responsive bookmark manager built with Astro and Cloudflare Workers. Bookmark data is stored in Cloudflare D1, UI preferences are stored in a dedicated Cloudflare KV namespace, and all visual tokens remain in CSS.

Production access can be protected by OpenID Connect (OIDC). When OIDC is configured, the application uses the Authorization Code flow with PKCE, validates state and nonce values, verifies ID token signatures, rotates the Astro session after login, and enforces the configured allowlist. When OIDC is not configured, the dashboard runs without an authentication gate.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/halka/Okini-Iri-Dashboard)

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

Open [http://localhost:8787](http://localhost:8787), then import a Chrome bookmark HTML file from the management dialog. OGP and non-secret OIDC settings can be edited from the same dialog.

## Table of Contents

- [Okini Iri Dashboard](#okini-iri-dashboard)
  - [Screenshot](#screenshot)
  - [Quick Start](#quick-start)
  - [Table of Contents](#table-of-contents)
  - [Requirements](#requirements)
  - [Cloudflare Setup](#cloudflare-setup)
    - [OIDC Setup](#oidc-setup)
    - [OIDC settings](#oidc-settings)
  - [Local Development](#local-development)
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
    - [halka](#halka)
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

After you can sign in, open the management dialog to edit OGP metadata and non-secret OIDC settings from the screen. Worker environment variables still take priority over screen-saved values, so remove a variable from `wrangler.toml` when you want the KV-backed screen value to control that setting. `OIDC_CLIENT_SECRET` always stays in Cloudflare Secrets and is not saved through the browser.

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

Open [http://localhost:8787](http://localhost:8787). When OIDC is not configured, requests use an authentication-disabled account context. Import a Chrome bookmark HTML file from the management dialog to populate the database.

`rebuild:local` runs the strict Astro checks, creates the Worker build, and applies pending local D1 migrations. It preserves existing local records.

## Import Behavior

When D1 has no bookmarks and no search or filter is active, the workspace presents a direct Chrome bookmark HTML picker. The management dialog provides the same import control later.

The importer accepts Chrome `.html` or `.htm` exports up to 10 MiB. UTF-8, Shift_JIS (including Windows-31J), EUC-JP, and ISO-2022-JP input is detected and converted to Unicode before it is sent as UTF-8 JSON. URL metadata and structured preview responses use the same conversion boundary. The importer closes an open management dialog after file selection, shows an indeterminate progress overlay, imports metadata with bounded concurrency, and reloads after success.

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
- Edit OGP metadata and non-secret OIDC settings from the management dialog
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

- [Website 1](https://halka.jp)
- [Website 2](https://rjch.jp)

**Made in Goryokaku**

## LICENSE
MIT
