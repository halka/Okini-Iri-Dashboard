import type { Bookmark, Folder, Tag } from "../../domain/bookmarks";

export type D1Row = Record<string, unknown>;

export function mapFolder(row: D1Row): Folder {
  return {
    id: String(row.id),
    name: String(row.name),
    parentId: nullableString(row.parent_id),
    sortOrder: Number(row.sort_order),
    bookmarkCount: Number(row.bookmark_count ?? 0),
    childCount: Number(row.child_count ?? 0),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export function mapTag(row: D1Row): Tag {
  return {
    id: String(row.id),
    name: String(row.name),
    primaryColor: String(row.primary_color ?? "#4f8cff")
  };
}

export function mapBookmark(row: D1Row): Bookmark {
  const tags = JSON.parse(String(row.tags_json ?? "[]")).filter(Boolean) as Tag[];
  return {
    id: String(row.id),
    title: String(row.title),
    url: String(row.url),
    faviconUrl: String(row.favicon_url ?? ""),
    folderId: nullableString(row.folder_id),
    folderName: nullableString(row.folder_name),
    description: String(row.description ?? ""),
    notes: String(row.notes ?? ""),
    favorite: Boolean(row.favorite),
    structuredPreviewEnabled: Boolean(row.structured_preview_enabled),
    sortOrder: Number(row.sort_order),
    addDate: row.add_date === null ? null : Number(row.add_date),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    tags
  };
}

function nullableString(value: unknown) {
  return value === null || value === undefined ? null : String(value);
}
