import type { APIRoute } from "astro";
import { importChromeBookmarks, type ImportProgress } from "../../lib/repositories/import";
import { getDb } from "../../lib/d1";
import { parseChromeBookmarksHtml } from "../../lib/bookmark-html";
import { ApiError, apiRoute, optionalBoolean, optionalText, readJson } from "../../lib/http";
import { normalizeUtf8Text } from "../../lib/text-encoding";

type Payload = { append?: boolean; force?: boolean; html?: string; source?: string };

export const POST: APIRoute = apiRoute(async ({ locals, request }) => {
  const body = await readJson<Payload>(request, 11 * 1024 * 1024);
  const append = optionalBoolean(body.append, "append") ?? false;
  const force = optionalBoolean(body.force, "force") ?? false;
  if (typeof body.html !== "string" || !body.html.trim()) {
    throw new ApiError("Chrome bookmark HTML is required", 422, "validation_error");
  }
  const uploadedHtml = normalizeUtf8Text(body.html).trim();
  if (new TextEncoder().encode(uploadedHtml).byteLength > 10 * 1024 * 1024) {
    throw new ApiError("Bookmark HTML is too large", 413, "payload_too_large");
  }
  if (!/<!doctype\s+netscape-bookmark-file-1\s*>/i.test(uploadedHtml)) {
    throw new ApiError("A Chrome bookmark HTML export is required", 422, "invalid_bookmark_html");
  }
  const source = optionalText(body.source, "source", 255) || "uploaded-bookmarks.html";
  const parsedBookmarks = parseChromeBookmarksHtml(uploadedHtml, source);
  if (!parsedBookmarks.bookmarks?.length && !parsedBookmarks.folders?.length) {
    throw new ApiError("The Chrome bookmark HTML export is empty", 422, "invalid_bookmark_html");
  }
  const encoder = new TextEncoder();
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

      void importChromeBookmarks(
        getDb(locals),
        parsedBookmarks,
        { append, force },
        { blockedOrigins: new Set([new URL(request.url).origin]) },
        sendProgress
      )
        .then((result) => send({ type: "complete", result }))
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
