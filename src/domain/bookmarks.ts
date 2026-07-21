export type Tag = {
  id: string;
  name: string;
  primaryColor: string;
};

export type Folder = {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  bookmarkCount: number;
  childCount: number;
  createdAt: string;
  updatedAt: string;
};

export type Bookmark = {
  id: string;
  title: string;
  url: string;
  faviconUrl: string;
  folderId: string | null;
  folderName: string | null;
  description: string;
  notes: string;
  favorite: boolean;
  structuredPreviewEnabled: boolean;
  sortOrder: number;
  addDate: number | null;
  createdAt: string;
  updatedAt: string;
  tags: Tag[];
};

export type BookmarkInput = {
  title: string;
  url: string;
  faviconUrl?: string;
  folderId?: string | null;
  description?: string;
  notes?: string;
  favorite?: boolean;
  structuredPreviewEnabled?: boolean;
  tagIds?: string[];
};

export type BookmarkPatch = Partial<BookmarkInput>;

export type BookmarkFilters = {
  query?: string;
  tagId?: string;
  favorite?: boolean;
};

export type ChromeBookmarkFolder = {
  id?: string;
  name: string;
  parentId?: string | null;
  sortOrder?: number;
  addDate?: number | null;
  lastModified?: number | null;
};

export type ChromeBookmarkItem = {
  id?: string;
  title?: string;
  name?: string;
  url: string;
  folderId?: string | null;
  folderName?: string | null;
  folder?: string | null;
  description?: string;
  faviconUrl?: string;
  sortOrder?: number;
  addDate?: number | null;
};

export type ChromeBookmarksImport = {
  source?: string;
  folders?: ChromeBookmarkFolder[];
  bookmarks?: ChromeBookmarkItem[];
};
