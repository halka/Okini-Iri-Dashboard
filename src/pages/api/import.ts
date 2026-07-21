import type { APIRoute } from "astro";
import { importChromeBookmarks, type ImportProgress } from "../../lib/repositories/import";
import { getDb } from "../../lib/d1";
import { parseChromeBookmarksHtml } from "../../lib/bookmark-html";
import { ApiError, apiRoute, optionalBoolean, optionalText, readJson } from "../../lib/http";
import { normalizeUtf8Text } from "../../lib/text-encoding";
import { consumeRateLimit } from "../../lib/rate-limit";
import { recordAuditLogSafely } from "../../lib/repositories/audit";

type ImportFilePayload = { html?: string; source?: string };
type Payload = { append?: boolean; force?: boolean; html?: string; source?: string; files?: ImportFilePayload[] };

const maxImportFileBytes = 10 * 1024 * 1024;
const maxImportBatchBytes = 50 * 1024 * 1024;
const maxImportFiles = 20;

export const POST: APIRoute = apiRoute(async ({ locals, request }) => {
  const limit = consumeRateLimit(request, "import", 8, 5 * 60_000);
  if (!limit.allowed) {
    throw new ApiError("Too many import requests", 429, "rate_limited", { "retry-after": String(limit.retryAfter) });
  }
  const body = await readJson<Payload>(request, 64 * 1024 * 1024);
  const append = optionalBoolean(body.append, "append") ?? false;
  const force = optionalBoolean(body.force, "force") ?? false;
  const files = Array.isArray(body.files) ? body.files : [{ html: body.html, source: body.source }];
  if (!files.length || files.length > maxImportFiles) {
    throw new ApiError("Choose between 1 and 20 bookmark HTML files", 422, "validation_error");
  }

  let totalBytes = 0;
  const parsedImports = files.map((file, index) => {
    if (!file || typeof file.html !== "string" || !file.html.trim()) {
      throw new ApiError("Chrome bookmark HTML is required", 422, "validation_error");
    }
    const uploadedHtml = normalizeUtf8Text(file.html).trim();
    const byteLength = new TextEncoder().encode(uploadedHtml).byteLength;
    if (byteLength > maxImportFileBytes) {
      throw new ApiError("Bookmark HTML is too large", 413, "payload_too_large");
    }
    totalBytes += byteLength;
    if (totalBytes > maxImportBatchBytes) {
      throw new ApiError("Bookmark HTML batch is too large", 413, "payload_too_large");
    }
    if (!/<!doctype\s+netscape-bookmark-file-1\s*>/i.test(uploadedHtml)) {
      throw new ApiError("A Chrome bookmark HTML export is required", 422, "invalid_bookmark_html");
    }
    const source = optionalText(file.source, `files[${index}].source`, 255) || `uploaded-bookmarks-${index + 1}.html`;
    const parsed = parseChromeBookmarksHtml(uploadedHtml, source);
    if (!parsed.bookmarks?.length && !parsed.folders?.length) {
      throw new ApiError("The Chrome bookmark HTML export is empty", 422, "invalid_bookmark_html");
    }
    return parsed;
  });
  if (!parsedImports.length) {
    throw new ApiError("Chrome bookmark HTML is required", 422, "validation_error");
  }
  const encoder = new TextEncoder();
  const totalBookmarks = parsedImports.reduce((total, item) => total + (item.bookmarks?.length ?? 0), 0);
  const db = getDb(locals);
  const user = locals.user;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      const send = (message: unknown) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(message)}\n`));
        } catch {
          open = false;
        }
      };
      const sendProgress = ({ completed, total }: ImportProgress) => {
        const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
        send({ type: "progress", completed, total, percent });
      };

      void (async () => {
        const result = { skipped: false, tags: 0, folders: 0, bookmarks: 0 };
        let completedBefore = 0;
        for (let index = 0; index < parsedImports.length; index += 1) {
          const imported = await importChromeBookmarks(
            db,
            parsedImports[index],
            { append: index === 0 ? append : true, force: index === 0 ? force : false },
            { blockedOrigins: new Set([new URL(request.url).origin]) },
            ({ completed }) => sendProgress({ completed: completedBefore + completed, total: totalBookmarks })
          );
          completedBefore += parsedImports[index].bookmarks?.length ?? 0;
          result.skipped ||= imported.skipped;
          result.tags += imported.tags;
          result.folders += imported.folders ?? imported.tags;
          result.bookmarks += imported.bookmarks;
        }
        sendProgress({ completed: totalBookmarks, total: totalBookmarks });
        await recordAuditLogSafely(db, user, {
          action: "bookmarks.imported",
          entityType: "bookmark",
          summary: `${parsedImports.length} file${parsedImports.length === 1 ? "" : "s"}`,
          details: { append, force, bookmarks: result.bookmarks, tags: result.tags, skipped: result.skipped }
        });
        send({ type: "complete", result });
      })()
        .catch((error) => {
          console.error(error);
          send({ type: "error", error: "Import failed", code: "import_failed" });
        })
        .finally(() => {
          if (open) controller.close();
        });
    }
  });

  return new Response(stream, {
    headers: {
      "cache-control": "no-store",
      "content-type": "application/x-ndjson; charset=utf-8",
      "x-content-type-options": "nosniff"
    }
  });
});
