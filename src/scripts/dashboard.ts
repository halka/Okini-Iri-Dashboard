import { UNCATEGORIZED_FOLDER_FILTER_ID, type Bookmark, type BookmarkInput, type Folder, type Tag } from "../domain/bookmarks";
import type { ColorMode } from "../config/preferences";
import type { Locale, MessageKey } from "../i18n/messages";
import { readTextBlob, UnsupportedTextEncodingError } from "../lib/text-encoding";
import { requestJson } from "./lib/api-client";
import { byId, formControl } from "./lib/dom";
import { escapeAttribute, escapeHtml, faviconHtml, faviconMarkup, isHttpBookmarkUrl, safeHost, setupFaviconFallbacks } from "./lib/format";
import { I18nController } from "./lib/i18n-controller";
import { formatStructuredText, renderHighlightedPreview } from "./lib/structured-preview";
import { ThemeController } from "./lib/theme-controller";

type DashboardState = {
  bookmarks: Bookmark[];
  folders: Folder[];
  tags: Tag[];
  folderId: string;
  query: string;
  favoriteOnly: boolean;
};

type PublicSettings = {
  site: {
    title: string;
    description: string;
    url: string;
    siteName: string;
    ogImage: string;
    locale: string;
    alternateLocale: string;
    twitterCard: "summary" | "summary_large_image";
  };
  oidc: {
    issuerUrl: string;
    clientId: string;
    tokenAuthMethod: "" | "client_secret_basic" | "client_secret_post" | "none";
    scopes: string;
    allowedEmails: string;
    allowedDomains: string;
    sessionTtlSeconds: number;
    clientSecretConfigured: boolean;
  };
};

const state: DashboardState = {
  bookmarks: [],
  folders: [],
  tags: [],
  folderId: "",
  query: "",
  favoriteOnly: false
};

const elements = {
  bookmarkList: byId<HTMLElement>("bookmarkList"),
  workspaceStatus: byId<HTMLElement>("workspaceStatus"),
  workspace: byId<HTMLElement>("workspace"),
  folderSelect: byId<HTMLSelectElement>("folderSelect"),
  searchInput: byId<HTMLInputElement>("searchInput"),
  favoriteOnlyButton: byId<HTMLButtonElement>("favoriteOnly"),
  homeFilterButton: byId<HTMLButtonElement>("homeFilterButton"),
  newButton: byId<HTMLButtonElement>("newButton"),
  moveToTopButton: byId<HTMLButtonElement>("moveToTopButton"),
  languageButton: byId<HTMLButtonElement>("languageButton"),
  themeButton: byId<HTMLButtonElement>("themeButton"),
  manageDataButton: byId<HTMLButtonElement>("manageDataButton"),
  editor: byId<HTMLDialogElement>("editor"),
  editorTitle: byId<HTMLElement>("editorTitle"),
  form: byId<HTMLFormElement>("bookmarkForm"),
  editorTags: byId<HTMLSelectElement>("editorTags"),
  deleteButton: byId<HTMLButtonElement>("deleteButton"),
  manager: byId<HTMLDialogElement>("manager"),
  folderManager: byId<HTMLDialogElement>("folderManager"),
  tagManager: byId<HTMLDialogElement>("tagManager"),
  importManager: byId<HTMLDialogElement>("importManager"),
  systemSettings: byId<HTMLDialogElement>("systemSettings"),
  folderManageList: byId<HTMLElement>("folderManageList"),
  tagManageList: byId<HTMLElement>("tagManageList"),
  bookmarkHtmlInput: byId<HTMLInputElement>("bookmarkHtmlInput"),
  resetDataButton: byId<HTMLButtonElement>("resetDataButton"),
  siteSettingsForm: byId<HTMLFormElement>("siteSettingsForm"),
  siteSettingsStatus: byId<HTMLElement>("siteSettingsStatus"),
  oidcSettingsForm: byId<HTMLFormElement>("oidcSettingsForm"),
  oidcSettingsStatus: byId<HTMLElement>("oidcSettingsStatus"),
  oidcSecretStatus: byId<HTMLElement>("oidcSecretStatus"),
  importOverlay: byId<HTMLElement>("importOverlay"),
  metadataStatus: byId<HTMLElement>("metadataStatus"),
  faviconPreview: byId<HTMLElement>("faviconPreview"),
  fetchMetadataButton: byId<HTMLButtonElement>("fetchMetadataButton"),
  inlineFolderForm: byId<HTMLElement>("inlineFolderForm"),
  inlineTagForm: byId<HTMLElement>("inlineTagForm"),
  structuredPreview: byId<HTMLDialogElement>("structuredPreview"),
  previewTitle: byId<HTMLElement>("previewTitle"),
  previewStatus: byId<HTMLElement>("previewStatus"),
  previewContent: byId<HTMLElement>("previewContent"),
  bookmarkDetailsDialog: byId<HTMLDialogElement>("bookmarkDetailsDialog"),
  bookmarkDetailsTitle: byId<HTMLElement>("bookmarkDetailsTitle"),
  bookmarkDetailsUrl: byId<HTMLAnchorElement>("bookmarkDetailsUrl"),
  bookmarkDetailsDescription: byId<HTMLElement>("bookmarkDetailsDescription"),
  bookmarkDetailsNotes: byId<HTMLElement>("bookmarkDetailsNotes"),
  previewLinkDialog: byId<HTMLDialogElement>("previewLinkDialog"),
  previewLinkUrl: byId<HTMLElement>("previewLinkUrl"),
  openPreviewLinkExternal: byId<HTMLButtonElement>("openPreviewLinkExternal"),
  openPreviewLinkInline: byId<HTMLButtonElement>("openPreviewLinkInline"),
  cancelPreviewLink: byId<HTMLButtonElement>("cancelPreviewLink"),
  toast: byId<HTMLElement>("toast")
};

const i18n = new I18nController();
const t = (key: MessageKey, vars: Record<string, string | number> = {}) => i18n.t(key, vars);
const theme = new ThemeController(elements.themeButton, t);
let pendingPreviewUrl = "";
let refreshSequence = 0;
let searchTimer = 0;
let toastTimer = 0;
let metadataTimer = 0;
let metadataController: AbortController | null = null;
let lastMetadataUrl = "";
let preferenceSaveQueue = Promise.resolve();

async function savePreferences(input: Partial<{ locale: Locale; colorMode: ColorMode }>) {
  const request = preferenceSaveQueue.then(() =>
    requestJson("/api/preferences", { method: "PATCH", body: JSON.stringify(input) })
  );
  preferenceSaveQueue = request.then(
    () => undefined,
    () => undefined
  );
  try {
    await request;
  } catch {
    showToast(t("settingsSaveBlocked"));
  }
}

async function cycleLocale() {
  const locale = i18n.nextLocale();
  i18n.apply(locale);
  theme.apply(theme.current());
  syncOpenDialogLocale();
  render();
  await savePreferences({ locale });
}

async function cycleColorMode() {
  const colorMode = theme.next();
  theme.apply(colorMode);
  await savePreferences({ colorMode });
}

function syncOpenDialogLocale() {
  if (elements.editor.open) {
    elements.editorTitle.textContent = formControl<HTMLInputElement>(elements.form, "id").value ? t("linkEdit") : t("newLink");
  }
}

async function refresh() {
  const sequence = ++refreshSequence;
  elements.bookmarkList.setAttribute("aria-busy", "true");
  elements.workspaceStatus.textContent = t("loading");
  const params = new URLSearchParams();
  if (state.query) params.set("q", state.query);
  if (state.folderId && !state.query && !state.favoriteOnly) params.set("folderId", state.folderId);
  if (state.favoriteOnly) params.set("favorite", "true");

  try {
    const [{ bookmarks }, { folders }, { tags }] = await Promise.all([
      requestJson<{ bookmarks: Bookmark[] }>(`/api/bookmarks?${params}`),
      requestJson<{ folders: Folder[] }>("/api/folders"),
      requestJson<{ tags: Tag[] }>("/api/tags")
    ]);
    if (sequence !== refreshSequence) return;
    state.bookmarks = bookmarks;
    state.folders = folders;
    state.tags = tags;
    if (state.folderId && state.folderId !== UNCATEGORIZED_FOLDER_FILTER_ID && !folders.some((folder) => folder.id === state.folderId)) state.folderId = "";
    render();
  } catch (error) {
    elements.workspaceStatus.textContent = error instanceof Error ? error.message : t("genericError");
    throw error;
  } finally {
    if (sequence === refreshSequence) elements.bookmarkList.setAttribute("aria-busy", "false");
  }
}

function render() {
  renderFolders();
  renderFavoriteFilter();
  renderManager();
  renderBookmarks();
  renderEditorFolders();
  renderEditorTags();
}

function renderFolders() {
  elements.folderSelect.innerHTML = [
    `<option value="">${escapeHtml(t("all"))}</option>`,
    `<option value="${UNCATEGORIZED_FOLDER_FILTER_ID}">${escapeHtml(t("uncategorized"))}</option>`,
    ...state.folders.map((folder) => `<option value="${escapeAttribute(folder.id)}">${escapeHtml(folderLabel(folder))}</option>`)
  ].join("");
  elements.folderSelect.value = state.folderId;
}

function renderFavoriteFilter() {
  elements.favoriteOnlyButton.classList.toggle("is-active", state.favoriteOnly);
  elements.favoriteOnlyButton.setAttribute("aria-pressed", String(state.favoriteOnly));
}

function scrollWorkspaceToTop() {
  elements.workspace.scrollTop = 0;
  elements.workspace.scrollTo({ top: 0, behavior: "smooth" });
  elements.moveToTopButton.hidden = true;
}

async function resetFilters() {
  state.folderId = "";
  state.query = "";
  state.favoriteOnly = false;
  elements.folderSelect.value = "";
  elements.searchInput.value = "";
  renderFavoriteFilter();
  await refresh();
  requestAnimationFrame(scrollWorkspaceToTop);
}

function renderManager() {
  elements.folderManageList.innerHTML = state.folders.length
    ? state.folders
        .map(
          (folder) => `<article class="manage-row folder-manage-row" data-folder-id="${escapeAttribute(folder.id)}">
            <label>
              <span class="visually-hidden">${escapeHtml(t("newFolderPlaceholder"))}</span>
              <input name="name" type="text" value="${escapeAttribute(folder.name)}" maxlength="200" />
            </label>
            <span>${escapeHtml(folderUsageLabel(folder))}</span>
            <button type="button" data-save-folder="${escapeAttribute(folder.id)}">${escapeHtml(t("save"))}</button>
            <button type="button" class="danger" data-delete-folder="${escapeAttribute(folder.id)}">${escapeHtml(t("delete"))}</button>
          </article>`
        )
        .join("")
    : `<p class="empty">${escapeHtml(t("noFolders"))}</p>`;

  elements.tagManageList.innerHTML = state.tags.length
    ? state.tags
        .map(
          (tag) => `<article class="manage-row tag-manage-row" data-tag-id="${escapeAttribute(tag.id)}">
            <label>
              <span class="visually-hidden">${escapeHtml(t("tagNamePlaceholder"))}</span>
              <input name="name" type="text" value="${escapeAttribute(tag.name)}" maxlength="100" />
            </label>
            <label class="color-control">
              <span class="visually-hidden">${escapeHtml(t("tagColor"))}</span>
              <input name="primaryColor" type="color" value="${escapeAttribute(tag.primaryColor)}" />
            </label>
            <button type="button" data-save-tag="${escapeAttribute(tag.id)}">${escapeHtml(t("save"))}</button>
            <button type="button" class="danger" data-delete-tag="${escapeAttribute(tag.id)}">${escapeHtml(t("delete"))}</button>
          </article>`
        )
        .join("")
    : `<p class="empty">${escapeHtml(t("noTags"))}</p>`;
}

function renderBookmarks() {
  elements.workspaceStatus.textContent = state.bookmarks.length
    ? t("linksFound", { count: state.bookmarks.length })
    : state.query || state.folderId || state.favoriteOnly
      ? t("noLinks")
      : t("importBookmarks");
  if (!state.bookmarks.length) {
    const isUnfilteredView = !state.query && !state.folderId && !state.favoriteOnly;
    elements.bookmarkList.innerHTML = isUnfilteredView
      ? `<section class="empty-panel first-run-panel">
          <h2>${escapeHtml(t("importBookmarks"))}</h2>
          <p>${escapeHtml(t("importBookmarksHint"))}</p>
          <label class="file-button first-run-import">
            <span>${escapeHtml(t("chooseBookmarkHtml"))}</span>
            <input type="file" accept=".html,.htm,text/html" data-initial-bookmark-import aria-label="${escapeAttribute(t("chooseBookmarkHtml"))}" />
          </label>
          <small>${escapeHtml(t("bookmarkHtmlRequirements"))}</small>
        </section>`
      : `<div class="empty-panel">${escapeHtml(t("noLinks"))}</div>`;
    return;
  }

  elements.bookmarkList.innerHTML = state.bookmarks
    .map((bookmark) => {
      const isOpenable = isHttpBookmarkUrl(bookmark.url);
      const tags = bookmark.tags
        .map((tag) => `<span class="pill tag-pill" style="--tag-color: ${escapeAttribute(tag.primaryColor)}">${escapeHtml(tag.name)}</span>`)
        .join("");
      const previewAction =
        bookmark.structuredPreviewEnabled && isOpenable
          ? `<button type="button" class="ghost-link preview-link card-top-action" data-preview="${escapeAttribute(bookmark.id)}">${escapeHtml(t("structuredPreview"))}</button>`
          : "";
      const main = isOpenable
        ? `<a class="card-main" href="${escapeAttribute(bookmark.url)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" aria-label="${escapeAttribute(t("openLinkLabel", { title: bookmark.title }))}">
          ${faviconHtml(bookmark)}
          <div>
            <h3>${escapeHtml(bookmark.title)}</h3>
            <span class="card-host">${escapeHtml(safeHost(bookmark.url))}</span>
          </div>
        </a>`
        : `<div class="card-main" role="group">
          ${faviconHtml(bookmark)}
          <div>
            <h3>${escapeHtml(bookmark.title)}</h3>
            <span class="card-host">${escapeHtml(safeHost(bookmark.url))}</span>
          </div>
        </div>`;
      return `<article class="bookmark-card">
        <div class="card-top">
          ${main}
          ${previewAction}
        </div>
        <p class="card-url">${escapeHtml(bookmark.url)}</p>
        <div class="card-meta">
          <span>${escapeHtml(bookmark.folderName ?? t("uncategorized"))}</span>
          <button type="button" class="favorite-toggle${bookmark.favorite ? " is-active" : ""}" data-favorite="${escapeAttribute(bookmark.id)}" aria-label="${escapeAttribute(t(bookmark.favorite ? "removeFavorite" : "addFavorite"))}" title="${escapeAttribute(t(bookmark.favorite ? "removeFavorite" : "addFavorite"))}">${bookmark.favorite ? "★" : "☆"}</button>
        </div>
        <div class="card-footer">
          <div class="pill-row">${tags}</div>
          <div class="card-actions">
            <button type="button" class="ghost-link" data-details="${escapeAttribute(bookmark.id)}">${escapeHtml(t("descriptionNotes"))}</button>
            <button type="button" class="edit-link" data-edit="${escapeAttribute(bookmark.id)}">${escapeHtml(t("edit"))}</button>
          </div>
        </div>
      </article>`;
    })
    .join("");

  setupFaviconFallbacks(elements.bookmarkList.querySelectorAll<HTMLImageElement>(".favicon img"));
}

function renderEditorFolders(selectedFolderId?: string | null) {
  const select = formControl<HTMLSelectElement>(elements.form, "folderId");
  const currentValue = selectedFolderId ?? select.value;
  select.innerHTML = [
    `<option value="">${escapeHtml(t("uncategorized"))}</option>`,
    ...state.folders.map(
      (folder) => `<option value="${escapeAttribute(folder.id)}">${"&nbsp;".repeat(getDepth(folder) * 2)}${escapeHtml(folder.name)}</option>`
    )
  ].join("");
  select.value = currentValue ?? "";
}

function renderEditorTags(selectedTagIds?: Set<string>) {
  const selected = selectedTagIds ?? selectedEditorTagIds();
  elements.editorTags.innerHTML = state.tags
    .map(
      (tag) => `<option value="${escapeAttribute(tag.id)}"${selected.has(tag.id) ? " selected" : ""}>${escapeHtml(tag.name)}</option>`
    )
    .join("");
}

function selectedEditorTagIds() {
  return new Set(Array.from(elements.editorTags.selectedOptions, (option) => option.value));
}

function folderUsageLabel(folder: Folder) {
  return folder.bookmarkCount || folder.childCount
    ? t("folderCounts", { bookmarkCount: folder.bookmarkCount, childCount: folder.childCount })
    : t("emptyFolder");
}

function folderLabel(folder: Folder) {
  return `${"　".repeat(getDepth(folder))}${folder.name}`;
}

function getDepth(folder: Folder) {
  const visited = new Set<string>([folder.id]);
  let depth = 0;
  let parentId = folder.parentId;
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    depth += 1;
    parentId = state.folders.find((item) => item.id === parentId)?.parentId ?? null;
  }
  return depth;
}

function openEditor(bookmark?: Bookmark) {
  elements.form.reset();
  elements.editorTitle.textContent = bookmark ? t("linkEdit") : t("newLink");
  elements.deleteButton.toggleAttribute("hidden", !bookmark);
  formControl<HTMLInputElement>(elements.form, "id").value = bookmark?.id ?? "";
  formControl<HTMLInputElement>(elements.form, "title").value = bookmark?.title ?? "";
  formControl<HTMLInputElement>(elements.form, "url").value = bookmark?.url ?? "";
  formControl<HTMLInputElement>(elements.form, "faviconUrl").value = bookmark?.faviconUrl ?? "";
  renderEditorFolders(bookmark?.folderId);
  formControl<HTMLInputElement>(elements.form, "description").value = bookmark?.description ?? "";
  formControl<HTMLTextAreaElement>(elements.form, "notes").value = bookmark?.notes ?? "";
  formControl<HTMLInputElement>(elements.form, "favorite").checked = Boolean(bookmark?.favorite);
  formControl<HTMLInputElement>(elements.form, "structuredPreviewEnabled").checked = Boolean(bookmark?.structuredPreviewEnabled);
  renderEditorTags(new Set(bookmark?.tags.map((tag) => tag.id) ?? []));
  updateFaviconPreview(bookmark?.faviconUrl ?? "", bookmark?.title ?? "");
  lastMetadataUrl = bookmark?.url ?? "";
  updateMetadataButton(Boolean(bookmark));
  setMetadataStatus(bookmark ? t("metadataSaved") : t("metadataIdle"));
  elements.editor.showModal();
  requestAnimationFrame(() => formControl<HTMLInputElement>(elements.form, "url").focus());
}

function bookmarkPayload(): BookmarkInput {
  const data = new FormData(elements.form);
  return {
    title: String(data.get("title") ?? ""),
    url: String(data.get("url") ?? ""),
    faviconUrl: String(data.get("faviconUrl") ?? ""),
    folderId: String(data.get("folderId") || "") || null,
    description: String(data.get("description") ?? ""),
    notes: String(data.get("notes") ?? ""),
    favorite: data.get("favorite") === "on",
    structuredPreviewEnabled: data.get("structuredPreviewEnabled") === "on",
    tagIds: Array.from(elements.editorTags.selectedOptions, (option) => option.value)
  };
}

async function fillMetadata(force = false) {
  const urlInput = formControl<HTMLInputElement>(elements.form, "url");
  const titleInput = formControl<HTMLInputElement>(elements.form, "title");
  const descriptionInput = formControl<HTMLInputElement>(elements.form, "description");
  const faviconInput = formControl<HTMLInputElement>(elements.form, "faviconUrl");
  const url = urlInput.value.trim();
  if (!url) return;
  if (!force && lastMetadataUrl === url) return;

  metadataController?.abort();
  metadataController = new AbortController();
  setMetadataStatus(t("metadataLoading"));
  elements.fetchMetadataButton.disabled = true;
  try {
    const { metadata } = await requestJson<{ metadata: { url: string; title: string; description: string; faviconUrl: string } }>(
      "/api/metadata",
      { method: "POST", body: JSON.stringify({ url }), signal: metadataController.signal }
    );
    urlInput.value = metadata.url;
    if (force || !titleInput.value.trim()) titleInput.value = metadata.title;
    if (force || !descriptionInput.value.trim()) descriptionInput.value = metadata.description;
    faviconInput.value = metadata.faviconUrl;
    updateFaviconPreview(metadata.faviconUrl, titleInput.value);
    lastMetadataUrl = metadata.url;
    updateMetadataButton(true);
    setMetadataStatus(t("metadataLoaded"));
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    faviconInput.value = "";
    updateFaviconPreview("", titleInput.value);
    setMetadataStatus(error instanceof Error ? error.message : t("metadataFailed"));
  } finally {
    if (!metadataController?.signal.aborted) elements.fetchMetadataButton.disabled = false;
  }
}

function setMetadataStatus(message: string) {
  elements.metadataStatus.textContent = message;
}

function updateMetadataButton(hasMetadata: boolean) {
  elements.fetchMetadataButton.textContent = hasMetadata ? t("refetch") : t("fetchMetadata");
}

function updateFaviconPreview(faviconUrl: string, title = "") {
  elements.faviconPreview.innerHTML = faviconMarkup(faviconUrl, title);
  setupFaviconFallbacks(elements.faviconPreview.querySelectorAll<HTMLImageElement>("img"));
}

async function openStructuredPreview(bookmark: Bookmark) {
  await openStructuredPreviewUrl(bookmark.url, bookmark.title || safeHost(bookmark.url));
}

function openBookmarkDetails(bookmark: Bookmark) {
  elements.bookmarkDetailsTitle.textContent = bookmark.title || t("bookmarkDetails");
  elements.bookmarkDetailsUrl.textContent = bookmark.url;
  elements.bookmarkDetailsUrl.href = bookmark.url;
  elements.bookmarkDetailsDescription.textContent = bookmark.description || t("emptyDescription");
  elements.bookmarkDetailsNotes.textContent = bookmark.notes || t("emptyNotes");
  elements.bookmarkDetailsDialog.showModal();
}

async function openStructuredPreviewUrl(url: string, title: string) {
  elements.previewTitle.textContent = title || safeHost(url);
  elements.previewStatus.textContent = t("structuredLoading");
  elements.previewContent.replaceChildren();
  if (!elements.structuredPreview.open) elements.structuredPreview.showModal();

  try {
    const { preview } = await requestJson<{ preview: { url: string; contentType: string; text: string; truncated: boolean } }>(
      "/api/preview",
      { method: "POST", body: JSON.stringify({ url }) }
    );
    const formatted = formatStructuredText(preview.text, preview.contentType, preview.url || url, {
      unknown: t("structuredUnknown"),
      invalidXml: t("xmlParseFailed")
    });
    renderHighlightedPreview(elements.previewContent, formatted.text, formatted.language);
    elements.previewStatus.textContent = preview.truncated ? t("previewTruncated", { kind: formatted.kind }) : formatted.kind;
  } catch (error) {
    elements.previewStatus.textContent = error instanceof Error ? error.message : t("structuredFailed");
    elements.previewContent.replaceChildren();
  }
}

function showToast(message: string) {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  toastTimer = window.setTimeout(() => elements.toast.classList.remove("show"), 2400);
}

function showError(error: unknown) {
  const message = error instanceof Error ? error.message : t("genericError");
  elements.workspaceStatus.textContent = message;
  showToast(message);
}

async function createInlineFolder() {
  const input = elements.inlineFolderForm.querySelector<HTMLInputElement>("[name='name']");
  const button = elements.inlineFolderForm.querySelector<HTMLButtonElement>("button");
  if (!input || !button) return;
  const name = input.value.trim();
  if (!name) return;
  button.disabled = true;
  try {
    const result = await requestJson<{ id: string }>("/api/folders", { method: "POST", body: JSON.stringify({ name }) });
    input.value = "";
    await refreshFolders(result.id);
    showToast(t("folderAdded"));
  } finally {
    button.disabled = false;
  }
}

async function createInlineTag() {
  const input = elements.inlineTagForm.querySelector<HTMLInputElement>("[name='name']");
  const colorInput = elements.inlineTagForm.querySelector<HTMLInputElement>("[name='primaryColor']");
  const button = elements.inlineTagForm.querySelector<HTMLButtonElement>("button");
  if (!input || !colorInput || !button) return;
  const name = input.value.trim();
  if (!name) return;
  button.disabled = true;
  try {
    const result = await requestJson<{ id: string }>("/api/tags", { method: "POST", body: JSON.stringify({ name, primaryColor: colorInput.value }) });
    input.value = "";
    await refreshTags(result.id);
    showToast(t("tagAdded"));
  } finally {
    button.disabled = false;
  }
}

async function refreshFolders(selectedFolderId?: string) {
  const { folders } = await requestJson<{ folders: Folder[] }>("/api/folders");
  state.folders = folders;
  renderFolders();
  renderEditorFolders(selectedFolderId);
  renderManager();
}

async function refreshTags(selectedTagId?: string) {
  const { tags } = await requestJson<{ tags: Tag[] }>("/api/tags");
  const selected = selectedEditorTagIds();
  if (selectedTagId) selected.add(selectedTagId);
  state.tags = tags;
  renderEditorTags(selected);
  renderManager();
}

async function deleteFolder(id: string) {
  const folder = state.folders.find((item) => item.id === id);
  if (!folder) return;
  const hasRecords = folder.bookmarkCount > 0 || folder.childCount > 0;
  const message = hasRecords
    ? t("confirmDeleteFolder", { name: folder.name, bookmarkCount: folder.bookmarkCount, childCount: folder.childCount })
    : t("confirmDeleteEmptyFolder", { name: folder.name });
  if (!window.confirm(message)) return;

  const selectedFolderIsRemoved = isFolderWithin(state.folderId, folder.id);
  const result = await requestJson<{ bookmarkCount: number; childCount: number }>(`/api/folders/${folder.id}`, { method: "DELETE" });
  if (selectedFolderIsRemoved) state.folderId = "";
  await refresh();
  showToast(
    result.bookmarkCount || result.childCount
      ? t("folderDeletedWithRecords", { bookmarkCount: result.bookmarkCount, childCount: result.childCount })
      : t("folderDeleted")
  );
}

async function updateManagedFolder(id: string) {
  const row = elements.folderManageList.querySelector<HTMLElement>(`[data-folder-id="${CSS.escape(id)}"]`);
  const nameInput = row?.querySelector<HTMLInputElement>("[name='name']");
  if (!row || !nameInput) return;
  const name = nameInput.value.trim();
  if (!name) return;
  await requestJson(`/api/folders/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ name })
  });
  await refresh();
  showToast(t("folderUpdated"));
}

function isFolderWithin(folderId: string, ancestorId: string) {
  let currentId: string | null = folderId || null;
  const visited = new Set<string>();
  while (currentId && !visited.has(currentId)) {
    if (currentId === ancestorId) return true;
    visited.add(currentId);
    currentId = state.folders.find((folder) => folder.id === currentId)?.parentId ?? null;
  }
  return false;
}

async function deleteTag(id: string) {
  const tag = state.tags.find((item) => item.id === id);
  if (!tag || !window.confirm(t("confirmDeleteTag", { name: tag.name }))) return;
  await requestJson(`/api/tags/${tag.id}`, { method: "DELETE" });
  await refresh();
  showToast(t("tagDeleted"));
}

async function updateManagedTag(id: string) {
  const row = elements.tagManageList.querySelector<HTMLElement>(`[data-tag-id="${CSS.escape(id)}"]`);
  const nameInput = row?.querySelector<HTMLInputElement>("[name='name']");
  const colorInput = row?.querySelector<HTMLInputElement>("[name='primaryColor']");
  if (!row || !nameInput || !colorInput) return;
  const name = nameInput.value.trim();
  if (!name) return;
  await requestJson(`/api/tags/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ name, primaryColor: colorInput.value })
  });
  await refresh();
  showToast(t("tagUpdated"));
}

async function importBookmarkHtml(input: HTMLInputElement) {
  const file = input.files?.[0];
  if (!file) return;
  if (!/\.html?$/i.test(file.name) && file.type !== "text/html") {
    input.value = "";
    showToast(t("invalidBookmarkHtml"));
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    input.value = "";
    showToast(t("importFileTooLarge"));
    return;
  }

  const force = state.bookmarks.length > 0 || state.folders.length > 0 ? window.confirm(t("confirmReplaceBookmarks")) : true;
  if (!force) {
    input.value = "";
    return;
  }

  if (elements.manager.open) elements.manager.close();
  if (elements.importManager.open) elements.importManager.close();
  elements.importOverlay.hidden = false;
  try {
    const html = await readTextBlob(file);
    await requestJson("/api/import", {
      method: "POST",
      body: JSON.stringify({ html, source: file.name, force })
    });
    window.location.reload();
  } catch (error) {
    elements.importOverlay.hidden = true;
    if (error instanceof UnsupportedTextEncodingError) showToast(t("unsupportedBookmarkEncoding"));
    else showError(error);
  } finally {
    input.value = "";
  }
}

async function resetData() {
  if (!window.confirm(t("confirmResetData"))) return;
  elements.resetDataButton.disabled = true;
  if (elements.systemSettings.open) elements.systemSettings.close();
  elements.importOverlay.hidden = false;
  try {
    await requestJson("/api/reset", { method: "DELETE" });
    window.location.reload();
  } catch (error) {
    elements.importOverlay.hidden = true;
    elements.resetDataButton.disabled = false;
    showError(error);
  }
}

async function loadSettings() {
  const { settings } = await requestJson<{ settings: PublicSettings }>("/api/settings");
  setSettingsFormValues(settings);
}

function setSettingsFormValues(settings: PublicSettings) {
  setFormValue(elements.siteSettingsForm, "title", settings.site.title);
  setFormValue(elements.siteSettingsForm, "description", settings.site.description);
  setFormValue(elements.siteSettingsForm, "url", settings.site.url);
  setFormValue(elements.siteSettingsForm, "siteName", settings.site.siteName);
  setFormValue(elements.siteSettingsForm, "ogImage", settings.site.ogImage);
  setFormValue(elements.siteSettingsForm, "locale", settings.site.locale);
  setFormValue(elements.siteSettingsForm, "alternateLocale", settings.site.alternateLocale);
  setFormValue(elements.siteSettingsForm, "twitterCard", settings.site.twitterCard);
  setFormValue(elements.oidcSettingsForm, "issuerUrl", settings.oidc.issuerUrl);
  setFormValue(elements.oidcSettingsForm, "clientId", settings.oidc.clientId);
  setFormValue(elements.oidcSettingsForm, "tokenAuthMethod", settings.oidc.tokenAuthMethod);
  setFormValue(elements.oidcSettingsForm, "scopes", settings.oidc.scopes);
  setFormValue(elements.oidcSettingsForm, "allowedEmails", settings.oidc.allowedEmails);
  setFormValue(elements.oidcSettingsForm, "allowedDomains", settings.oidc.allowedDomains);
  setFormValue(elements.oidcSettingsForm, "sessionTtlSeconds", String(settings.oidc.sessionTtlSeconds));
  elements.oidcSecretStatus.textContent = t(settings.oidc.clientSecretConfigured ? "oidcSecretConfigured" : "oidcSecretMissing");
}

function setFormValue(form: HTMLFormElement, name: string, value: string) {
  const control = formControl<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(form, name);
  control.value = value;
}

async function saveSiteSettings() {
  const data = new FormData(elements.siteSettingsForm);
  const { settings } = await requestJson<{ settings: PublicSettings }>("/api/settings", {
    method: "PATCH",
    body: JSON.stringify({
      site: {
        title: data.get("title"),
        description: data.get("description"),
        url: data.get("url"),
        siteName: data.get("siteName"),
        ogImage: data.get("ogImage"),
        locale: data.get("locale"),
        alternateLocale: data.get("alternateLocale"),
        twitterCard: data.get("twitterCard")
      }
    })
  });
  setSettingsFormValues(settings);
  elements.siteSettingsStatus.textContent = t("settingsSaved");
  showToast(t("settingsSaved"));
}

async function saveOidcSettings() {
  const data = new FormData(elements.oidcSettingsForm);
  const { settings } = await requestJson<{ settings: PublicSettings }>("/api/settings", {
    method: "PATCH",
    body: JSON.stringify({
      oidc: {
        issuerUrl: data.get("issuerUrl"),
        clientId: data.get("clientId"),
        tokenAuthMethod: data.get("tokenAuthMethod"),
        scopes: data.get("scopes"),
        allowedEmails: data.get("allowedEmails"),
        allowedDomains: data.get("allowedDomains"),
        sessionTtlSeconds: data.get("sessionTtlSeconds")
      }
    })
  });
  setSettingsFormValues(settings);
  elements.oidcSettingsStatus.textContent = t("settingsSaved");
  showToast(t("settingsSaved"));
}

async function toggleFavorite(id: string) {
  const bookmark = state.bookmarks.find((item) => item.id === id);
  if (!bookmark) return;
  await requestJson(`/api/bookmarks/${bookmark.id}`, {
    method: "PATCH",
    body: JSON.stringify({ favorite: !bookmark.favorite })
  });
  await refresh();
}

function setFormBusy(form: HTMLFormElement, busy: boolean) {
  form.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
    button.disabled = busy;
  });
  form.setAttribute("aria-busy", String(busy));
}

function handleBookmarkListClick(event: MouseEvent) {
  const target = event.target as Element;
  const editButton = target.closest<HTMLButtonElement>("[data-edit]");
  if (editButton) {
    openEditor(state.bookmarks.find((bookmark) => bookmark.id === editButton.dataset.edit));
    return;
  }
  const previewButton = target.closest<HTMLButtonElement>("[data-preview]");
  if (previewButton) {
    const bookmark = state.bookmarks.find((item) => item.id === previewButton.dataset.preview);
    if (bookmark) openStructuredPreview(bookmark).catch(showError);
    return;
  }
  const detailsButton = target.closest<HTMLButtonElement>("[data-details]");
  if (detailsButton) {
    const bookmark = state.bookmarks.find((item) => item.id === detailsButton.dataset.details);
    if (bookmark) openBookmarkDetails(bookmark);
    return;
  }
  const favoriteButton = target.closest<HTMLButtonElement>("[data-favorite]");
  if (favoriteButton) toggleFavorite(favoriteButton.dataset.favorite ?? "").catch(showError);
}

elements.newButton.addEventListener("click", () => openEditor());
elements.moveToTopButton.addEventListener("click", scrollWorkspaceToTop);
elements.languageButton.addEventListener("click", () => cycleLocale().catch(showError));
elements.themeButton.addEventListener("click", () => cycleColorMode().catch(showError));
theme.media.addEventListener("change", () => {
  if (theme.current() === "system") theme.apply("system");
});
elements.workspace.addEventListener("scroll", () => {
  elements.moveToTopButton.hidden = elements.workspace.scrollTop < 320;
});
elements.homeFilterButton.addEventListener("click", () => resetFilters().catch(showError));
elements.bookmarkList.addEventListener("click", handleBookmarkListClick);
elements.bookmarkList.addEventListener("change", (event) => {
  const input = (event.target as Element).closest<HTMLInputElement>("[data-initial-bookmark-import]");
  if (input) importBookmarkHtml(input).catch(showError);
});
byId<HTMLButtonElement>("closeEditor").addEventListener("click", () => elements.editor.close());
byId<HTMLButtonElement>("closePreview").addEventListener("click", () => elements.structuredPreview.close());
byId<HTMLButtonElement>("closeBookmarkDetails").addEventListener("click", () => elements.bookmarkDetailsDialog.close());
elements.previewContent.addEventListener("click", (event) => {
  const anchor = (event.target as Element).closest<HTMLAnchorElement>("[data-preview-url]");
  if (!anchor) return;
  event.preventDefault();
  pendingPreviewUrl = anchor.dataset.previewUrl ?? anchor.href;
  elements.previewLinkUrl.textContent = pendingPreviewUrl;
  elements.previewLinkDialog.showModal();
});
elements.openPreviewLinkExternal.addEventListener("click", () => {
  if (pendingPreviewUrl) window.open(pendingPreviewUrl, "_blank", "noopener,noreferrer");
  elements.previewLinkDialog.close();
});
elements.openPreviewLinkInline.addEventListener("click", () => {
  const url = pendingPreviewUrl;
  elements.previewLinkDialog.close();
  if (url) openStructuredPreviewUrl(url, safeHost(url)).catch(showError);
});
elements.cancelPreviewLink.addEventListener("click", () => elements.previewLinkDialog.close());
elements.fetchMetadataButton.addEventListener("click", () => fillMetadata(true).catch(showError));
formControl<HTMLInputElement>(elements.form, "url").addEventListener("input", (event) => {
  window.clearTimeout(metadataTimer);
  const url = (event.currentTarget as HTMLInputElement).value.trim();
  updateMetadataButton(false);
  if (!url) {
    setMetadataStatus(t("metadataIdle"));
    return;
  }
  setMetadataStatus(t("metadataReady"));
  metadataTimer = window.setTimeout(() => fillMetadata(false).catch(showError), 700);
});
formControl<HTMLInputElement>(elements.form, "url").addEventListener("blur", () => {
  window.clearTimeout(metadataTimer);
  fillMetadata(false).catch(showError);
});
formControl<HTMLInputElement>(elements.form, "title").addEventListener("input", (event) => {
  const faviconUrl = formControl<HTMLInputElement>(elements.form, "faviconUrl").value;
  if (!faviconUrl) updateFaviconPreview("", (event.target as HTMLInputElement).value);
});
elements.manageDataButton.addEventListener("click", () => {
  elements.manager.showModal();
});
byId<HTMLButtonElement>("closeManager").addEventListener("click", () => elements.manager.close());
byId<HTMLButtonElement>("openFolderManager").addEventListener("click", () => {
  elements.manager.close();
  elements.folderManager.showModal();
});
byId<HTMLButtonElement>("closeFolderManager").addEventListener("click", () => elements.folderManager.close());
byId<HTMLButtonElement>("openTagManager").addEventListener("click", () => {
  elements.manager.close();
  elements.tagManager.showModal();
});
byId<HTMLButtonElement>("closeTagManager").addEventListener("click", () => elements.tagManager.close());
byId<HTMLButtonElement>("openImportManager").addEventListener("click", () => {
  elements.manager.close();
  elements.importManager.showModal();
});
byId<HTMLButtonElement>("closeImportManager").addEventListener("click", () => elements.importManager.close());
byId<HTMLButtonElement>("openSystemSettings").addEventListener("click", () => {
  elements.manager.close();
  elements.systemSettings.showModal();
  loadSettings().catch(showError);
});
byId<HTMLButtonElement>("closeSystemSettings").addEventListener("click", () => elements.systemSettings.close());
elements.bookmarkHtmlInput.addEventListener("change", () => importBookmarkHtml(elements.bookmarkHtmlInput).catch(showError));
elements.resetDataButton.addEventListener("click", () => resetData().catch(showError));
elements.siteSettingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  setFormBusy(elements.siteSettingsForm, true);
  saveSiteSettings().catch(showError).finally(() => setFormBusy(elements.siteSettingsForm, false));
});
elements.oidcSettingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  setFormBusy(elements.oidcSettingsForm, true);
  saveOidcSettings().catch(showError).finally(() => setFormBusy(elements.oidcSettingsForm, false));
});
elements.folderSelect.addEventListener("change", () => {
  state.folderId = elements.folderSelect.value;
  refresh().catch(showError);
});
elements.searchInput.addEventListener("input", () => {
  state.query = elements.searchInput.value.trim();
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => refresh().catch(showError), 220);
});
elements.favoriteOnlyButton.addEventListener("click", () => {
  if (!state.favoriteOnly && !state.bookmarks.some((bookmark) => bookmark.favorite)) return;
  state.favoriteOnly = !state.favoriteOnly;
  renderFavoriteFilter();
  refresh().catch(showError);
});
elements.folderManageList.addEventListener("click", (event) => {
  const saveButton = (event.target as Element).closest<HTMLButtonElement>("[data-save-folder]");
  if (saveButton) {
    updateManagedFolder(saveButton.dataset.saveFolder ?? "").catch(showError);
    return;
  }
  const deleteButton = (event.target as Element).closest<HTMLButtonElement>("[data-delete-folder]");
  if (deleteButton) deleteFolder(deleteButton.dataset.deleteFolder ?? "").catch(showError);
});
elements.tagManageList.addEventListener("click", (event) => {
  const saveButton = (event.target as Element).closest<HTMLButtonElement>("[data-save-tag]");
  if (saveButton) {
    updateManagedTag(saveButton.dataset.saveTag ?? "").catch(showError);
    return;
  }
  const deleteButton = (event.target as Element).closest<HTMLButtonElement>("[data-delete-tag]");
  if (deleteButton) deleteTag(deleteButton.dataset.deleteTag ?? "").catch(showError);
});
byId<HTMLFormElement>("folderForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  setFormBusy(form, true);
  requestJson("/api/folders", { method: "POST", body: JSON.stringify({ name: new FormData(form).get("name") }) })
    .then(async () => {
      form.reset();
      await refresh();
      showToast(t("folderAdded"));
    })
    .catch(showError)
    .finally(() => setFormBusy(form, false));
});
elements.inlineFolderForm.querySelector("button")?.addEventListener("click", () => createInlineFolder().catch(showError));
byId<HTMLFormElement>("tagForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  setFormBusy(form, true);
  const data = new FormData(form);
  requestJson("/api/tags", { method: "POST", body: JSON.stringify({ name: data.get("name"), primaryColor: data.get("primaryColor") }) })
    .then(async () => {
      form.reset();
      await refresh();
      showToast(t("tagAdded"));
    })
    .catch(showError)
    .finally(() => setFormBusy(form, false));
});
elements.inlineTagForm.querySelector("button")?.addEventListener("click", () => createInlineTag().catch(showError));
elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  const run = async () => {
    const titleInput = formControl<HTMLInputElement>(elements.form, "title");
    if (!titleInput.value.trim()) {
      await fillMetadata(false).catch(() => undefined);
      if (!titleInput.value.trim()) titleInput.value = safeHost(formControl<HTMLInputElement>(elements.form, "url").value) || t("untitled");
    }
    const id = formControl<HTMLInputElement>(elements.form, "id").value;
    await requestJson(id ? `/api/bookmarks/${id}` : "/api/bookmarks", {
      method: id ? "PATCH" : "POST",
      body: JSON.stringify(bookmarkPayload())
    });
    elements.editor.close();
    await refresh();
    showToast(t("saved"));
  };
  setFormBusy(elements.form, true);
  run().catch(showError).finally(() => setFormBusy(elements.form, false));
});
elements.deleteButton.addEventListener("click", () => {
  const id = formControl<HTMLInputElement>(elements.form, "id").value;
  if (!id || !window.confirm(t("confirmDeleteBookmark"))) return;
  setFormBusy(elements.form, true);
  requestJson(`/api/bookmarks/${id}`, { method: "DELETE" })
    .then(async () => {
      elements.editor.close();
      await refresh();
      showToast(t("deleted"));
    })
    .catch(showError)
    .finally(() => setFormBusy(elements.form, false));
});

i18n.apply(i18n.locale);
theme.apply(theme.current());
refresh().catch(showError);
