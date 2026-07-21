export type AuditAction =
  | "bookmark.created"
  | "bookmark.updated"
  | "bookmark.deleted"
  | "bookmarks.reordered"
  | "bookmarks.tags_updated"
  | "bookmarks.imported"
  | "tag.created"
  | "tag.updated"
  | "tag.deleted"
  | "data.reset";

export type AuditLog = {
  id: string;
  actorSubject: string;
  actorName: string;
  actorEmail: string | null;
  action: AuditAction;
  entityType: string;
  entityId: string | null;
  summary: string;
  details: Record<string, unknown>;
  createdAt: string;
};
