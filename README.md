# Okini Iri Dashboard

A private, responsive bookmark manager built with Astro and Cloudflare Workers. Bookmark data is stored in Cloudflare D1, UI preferences are stored in a dedicated Cloudflare KV namespace, and all visual tokens remain in CSS.

> [!WARNING]
> This application exposes data-changing APIs and does not include application-level authentication.
>
> **Protect production deployments with Cloudflare Access** or an equivalent access policy.

## Features

- Import Chrome bookmark HTML exports with progress feedback and automatic reload
- Fetch redirect-resolved URLs, titles, descriptions, and favicons automatically
- Create, read, update, and delete bookmarks, folders, and tags
- Delete a folder together with its nested folders and bookmarks
- Search across title, URL, description, and notes
- Filter favorites independently of the selected folder
- Add folders and tags directly from the bookmark editor
- Toggle favorites from bookmark cards
- Enable JSON/XML pretty view per bookmark
- Highlight JSON/XML with `highlight.js` and make embedded HTTP(S) URLs actionable
- Switch between Japanese and English without changing control dimensions
- Use light, dark, or device-controlled color modes
- Work across phone, tablet, desktop, and iOS Safari layouts
- Fully reset D1 data without silently reseeding it on the next GET request

## Technology

- Astro 7 with the Cloudflare adapter
- Cloudflare Workers
- Cloudflare D1 for bookmark domain data
- Cloudflare KV `PREFERENCES` for locale and color-mode preferences
- Cloudflare KV `SESSION` for Astro's adapter-managed session storage
- `highlight.js` for JSON/XML syntax highlighting
- TypeScript in strict mode

## Requirements

- Node.js 22.12 or later
- npm
- A Cloudflare account for remote deployment

## Local Development

Install dependencies and prepare the local D1 database:

```sh
npm ci
npm run rebuild:local
```

Start the Cloudflare-compatible preview server:

```sh
npm run preview
```

Open [http://localhost:8787](http://localhost:8787). Import a Chrome bookmark HTML file from the management dialog to populate the database.

`rebuild:local` runs the strict Astro checks, creates the Worker build, and applies pending local D1 migrations. It preserves existing local records.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start Astro's development server |
| `npm run preview` | Run the built Worker with Wrangler |
| `npm run build` | Run `astro check` and create the production Worker build |
| `npm run rebuild:local` | Build and apply local D1 migrations |
| `npm run db:migrate:local` | Apply D1 migrations to the local database |
| `npm run db:migrate:remote` | Apply D1 migrations to the remote database |
| `npm run import:bookmarks -- /path/to/bookmarks.html` | Regenerate the optional bundled seed JSON |
| `npm run cf-typegen` | Regenerate Cloudflare binding types |

The bundled seed file is written to `src/data/imported-bookmarks.json`. A bookmark list GET never imports this file automatically. The `/api/import` endpoint can import it when called without an HTML payload, while the normal UI import sends the selected Chrome HTML directly.

## Architecture

The codebase separates domain data, infrastructure, HTTP handling, browser behavior, and presentation:

```text
src/
├── components/              Astro UI structure
├── config/                  Identity, metadata, and preference defaults
├── domain/bookmarks.ts      Shared bookmark domain contracts
├── i18n/messages.ts         Japanese and English copy
├── lib/
│   ├── d1.ts                D1 binding access only
│   ├── kv.ts                Preferences KV binding access only
│   ├── http.ts              API responses and runtime validation
│   ├── metadata.ts          Remote metadata and favicon retrieval
│   └── repositories/        D1 queries grouped by domain operation
├── pages/api/               HTTP route orchestration
├── scripts/
│   ├── dashboard.ts         Screen state and interaction coordination
│   └── lib/                 Browser API, i18n, theme, DOM, and preview helpers
└── styles/global.css        Theme tokens, layout, and component presentation
```

### Responsibility Boundaries

- D1 stores bookmarks, folders, tags, and their relationships. Schema changes happen only through versioned migrations.
- `PREFERENCES` KV stores locale and color-mode preferences. It does not store bookmark records or visual color values.
- `SESSION` KV is reserved for Astro's Cloudflare session driver.
- CSS owns color tokens and presentation. Fixed colors are not stored in D1 or KV.
- API routes validate HTTP input and delegate persistence to repositories.
- Browser modules own UI state and DOM behavior; they do not contain D1 or KV logic.
- GET requests are read-only. Import and reset behavior is always explicit.

## Data Model

| Table | Responsibility |
| --- | --- |
| `bookmarks` | URL, title, description, notes, favicon URL, favorite flag, and structured-preview flag |
| `folders` | Folder hierarchy and ordering |
| `tags` | Unique tag names |
| `bookmark_tags` | Many-to-many bookmark/tag relationships |

The archive field and tag colors are not part of the current schema. Tag and theme colors are controlled by CSS variables.

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
| `/api/import` | `POST` | Import Chrome HTML or the bundled seed file |
| `/api/preferences` | `GET`, `PATCH` | Read and update KV-backed UI preferences |
| `/api/reset` | `DELETE` | Delete all D1 domain records |

JSON responses use `no-store` and `nosniff` headers. Runtime validation rejects malformed input before repository operations.

## Cloudflare Setup

Create one D1 database and two KV namespaces:

```sh
npx wrangler d1 create bookmark-dashboard
npx wrangler kv namespace create PREFERENCES
npx wrangler kv namespace create SESSION
```

Replace the placeholders in both `wrangler.toml` and `wrangler.build.toml`:

- `REPLACE_WITH_CLOUDFLARE_D1_DATABASE_ID`
- `REPLACE_WITH_CLOUDFLARE_KV_NAMESPACE_ID`
- `REPLACE_WITH_CLOUDFLARE_SESSION_KV_NAMESPACE_ID`

Then migrate, build, and deploy:

```sh
npm run db:migrate:remote
npm run build
npx wrangler deploy
```

> [!CAUTION]
> Apply a Cloudflare Access policy before sharing the Worker URL. Bookmarklets and imported URLs should be treated as trusted personal data.

## Import Behavior

The management dialog accepts Chrome `.html` or `.htm` exports up to 10 MiB. It closes after file selection, shows an indeterminate progress overlay, imports metadata with bounded concurrency, and reloads after success.

The parser excludes Chrome's synthetic root folder named `ブックマーク バー`. HTTP(S) bookmarks receive metadata enrichment. `javascript:` and `data:` bookmarklets are retained but are not sent to the metadata or preview fetchers.

## Reset Behavior
> [!CAUTION]
> Full reset deletes bookmarks, folders, tags, and bookmark/tag relationships. It does not delete UI preferences and does not automatically restore bundled seed data. This operation cannot be undone.

## Configuration

- `src/config/app.ts`: product identity, canonical URL, and outbound User-Agent values
- `src/config/site.ts`: OGP and social metadata
- `src/config/preferences.ts`: supported locales, color modes, and defaults
- `src/i18n/messages.ts`: all visible Japanese and English strings
- `src/styles/global.css`: light/dark tokens and every visual color

## 日本語

### 概要

Astro と Cloudflare Workers で動作する個人向けブックマーク管理アプリです。ブックマーク、フォルダ、タグは D1、言語とカラーモードは専用の KV、見た目と色は CSS で管理し、責務を分離しています。
> [!WARNING]
> 本番環境にはアプリ内認証がないため、公開前に **Cloudflare Access などで必ず保護**してください。

### ローカル実行

```sh
npm ci
npm run rebuild:local
npm run preview
```

[http://localhost:8787](http://localhost:8787) を開き、右上の管理画面から Chrome のブックマークHTMLをインポートします。

### 主な仕様

- ChromeブックマークHTMLのインポートとメタデータ自動取得
- ブックマーク、フォルダ、タグのCRUD
- 子フォルダとリンクを含むフォルダ削除
- 検索時とお気に入り表示時はフォルダ選択を無視
- カードからのお気に入り登録・解除
- リンク単位で有効にできるJSON/XML整形表示
- 日本語・英語、ライト・ダーク・デバイス連動モード
- スマートフォン、タブレット、デスクトップ、iOS Safari対応
- 完全初期化後に暗黙の再インポートを行わない読み取り専用GET API

### データと責務

- D1: ブックマーク、フォルダ、タグ、関連テーブル
- `PREFERENCES` KV: 言語とカラーモード
- `SESSION` KV: Astro Cloudflareアダプターのセッション
- CSS: 色、テーマ、レイアウト、コンポーネント表示
- TypeScript/Astro: 入力検証、API制御、画面状態、DOM更新

DBスキーマは `migrations/` のみで変更します。固定色はD1やKVへ保存しません。

### 完全初期化

> [!CAUTION]
> 管理画面の「完全初期化」はD1内の全ブックマーク、フォルダ、タグ、関連付けを削除します。言語・カラーモード設定は保持され、初期JSONは自動再投入されません。この操作は元に戻せません。
