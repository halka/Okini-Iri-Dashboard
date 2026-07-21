import type { Bookmark, BookmarkInput, Tag } from "../domain/bookmarks";
import type { ColorMode } from "../config/preferences";
import type { Locale, MessageKey } from "../i18n/messages";
import { readTextBlob, UnsupportedTextEncodingError } from "../lib/text-encoding";
import { ApiClientError, requestJson, requestJsonLines } from "./lib/api-client";
import { byId, formControl } from "./lib/dom";
import { escapeAttribute, escapeHtml, faviconHtml, faviconMarkup, isHttpBookmarkUrl, safeHost, setupFaviconFallbacks } from "./lib/format";
import { I18nController } from "./lib/i18n-controller";
import { formatStructuredText, renderHighlightedPreview } from "./lib/structured-preview";
import { ThemeController } from "./lib/theme-controller";

type DashboardState = {
  bookmarks: Bookmark[];
  tags: Tag[];
  tagId: string;
  query: string;
  favoriteOnly: boolean;
};

const state: DashboardState = {
  bookmarks: [],
  tags: [],
  tagId: "",
  query: "",
  favoriteOnly: false
};

const elements = {
  bookmarkList: byId<HTMLElement>("bookmarkList"),
  workspaceStatus: byId<HTMLElement>("workspaceStatus"),
  workspace: byId<HTMLElement>("workspace"),
  tagSelect: byId<HTMLSelectElement>("tagSelect"),
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
  editorTags: byId<HTMLElement>("editorTags"),
  deleteButton: byId<HTMLButtonElement>("deleteButton"),
  manager: byId<HTMLDialogElement>("manager"),
  tagManager: byId<HTMLDialogElement>("tagManager"),
  importManager: byId<HTMLDialogElement>("importManager"),
  systemSettings: byId<HTMLDialogElement>("systemSettings"),
  tagManageList: byId<HTMLElement>("tagManageList"),
  bookmarkHtmlInput: byId<HTMLInputElement>("bookmarkHtmlInput"),
  appendImportCheckbox: byId<HTMLInputElement>("appendImportCheckbox"),
  resetDataButton: byId<HTMLButtonElement>("resetDataButton"),
  importOverlay: byId<HTMLElement>("importOverlay"),
  importProgressBar: byId<HTMLProgressElement>("importProgressBar"),
  importProgressCount: byId<HTMLOutputElement>("importProgressCount"),
  importProgressPercent: byId<HTMLOutputElement>("importProgressPercent"),
  metadataStatus: byId<HTMLElement>("metadataStatus"),
  faviconPreview: byId<HTMLElement>("faviconPreview"),
  fetchMetadataButton: byId<HTMLButtonElement>("fetchMetadataButton"),
  faviconUploadInput: byId<HTMLInputElement>("faviconUploadInput"),
  inlineTagForm: byId<HTMLElement>("inlineTagForm"),
  structuredPreview: byId<HTMLDialogElement>("structuredPreview"),
  previewTitle: byId<HTMLElement>("previewTitle"),
  previewStatus: byId<HTMLElement>("previewStatus"),
  previewContent: byId<HTMLElement>("previewContent"),
  previewBack: byId<HTMLButtonElement>("previewBack"),
  previewForward: byId<HTMLButtonElement>("previewForward"),
  previewSearchInput: byId<HTMLInputElement>("previewSearchInput"),
  previewSearchPrevious: byId<HTMLButtonElement>("previewSearchPrevious"),
  previewSearchNext: byId<HTMLButtonElement>("previewSearchNext"),
  bookmarkDetailsDialog: byId<HTMLDialogElement>("bookmarkDetailsDialog"),
  bookmarkDetailsTitle: byId<HTMLElement>("bookmarkDetailsTitle"),
  bookmarkDetailsId: byId<HTMLElement>("bookmarkDetailsId"),
  bookmarkDetailsUrl: byId<HTMLAnchorElement>("bookmarkDetailsUrl"),
  bookmarkDetailsDomain: byId<HTMLElement>("bookmarkDetailsDomain"),
  bookmarkDetailsTags: byId<HTMLElement>("bookmarkDetailsTags"),
  bookmarkDetailsFavorite: byId<HTMLElement>("bookmarkDetailsFavorite"),
  bookmarkDetailsVpnRequired: byId<HTMLElement>("bookmarkDetailsVpnRequired"),
  bookmarkDetailsStructuredPreview: byId<HTMLElement>("bookmarkDetailsStructuredPreview"),
  bookmarkDetailsFavicon: byId<HTMLElement>("bookmarkDetailsFavicon"),
  bookmarkDetailsDescription: byId<HTMLElement>("bookmarkDetailsDescription"),
  bookmarkDetailsNotes: byId<HTMLElement>("bookmarkDetailsNotes"),
  bookmarkDetailsCreatedAt: byId<HTMLElement>("bookmarkDetailsCreatedAt"),
  bookmarkDetailsUpdatedAt: byId<HTMLElement>("bookmarkDetailsUpdatedAt"),
  bookmarkDetailsAddDate: byId<HTMLElement>("bookmarkDetailsAddDate"),
  previewLinkDialog: byId<HTMLDialogElement>("previewLinkDialog"),
  previewLinkUrl: byId<HTMLElement>("previewLinkUrl"),
  openPreviewLinkExternal: byId<HTMLButtonElement>("openPreviewLinkExternal"),
  openPreviewLinkInline: byId<HTMLButtonElement>("openPreviewLinkInline"),
  cancelPreviewLink: byId<HTMLButtonElement>("cancelPreviewLink"),
  confirmDialog: byId<HTMLDialogElement>("confirmDialog"),
  confirmDialogMessage: byId<HTMLElement>("confirmDialogMessage"),
  confirmDialogAccept: byId<HTMLButtonElement>("confirmDialogAccept"),
  confirmDialogCancel: byId<HTMLButtonElement>("confirmDialogCancel"),
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
let pendingConfirm: ((confirmed: boolean) => void) | null = null;
let returnToTopTimer = 0;
let finishReturnToTop: (() => void) | null = null;
let previewHistory: { url: string; title: string }[] = [];
let previewHistoryIndex = -1;
let previewSearchIndex = -1;
let previewSearchComposing = false;
let previewSearchCompositionTimer = 0;

const metadataFetchDelayMs = 5_000;
const maxFaviconUploadBytes = 48 * 1024;
const faviconImageTypes = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/svg+xml",
  "image/vnd.microsoft.icon",
  "image/webp",
  "image/x-icon"
]);

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
  if (state.tagId && !state.query && !state.favoriteOnly) params.set("tagId", state.tagId);
  if (state.favoriteOnly) params.set("favorite", "true");

  try {
    const [{ bookmarks }, { tags }] = await Promise.all([
      requestJson<{ bookmarks: Bookmark[] }>(`/api/bookmarks?${params}`),
      requestJson<{ tags: Tag[] }>("/api/tags")
    ]);
    if (sequence !== refreshSequence) return;
    state.bookmarks = bookmarks;
    state.tags = tags;
    if (state.tagId && !tags.some((tag) => tag.id === state.tagId)) state.tagId = "";
    render();
  } catch (error) {
    elements.workspaceStatus.textContent = error instanceof Error ? error.message : t("genericError");
    throw error;
  } finally {
    if (sequence === refreshSequence) elements.bookmarkList.setAttribute("aria-busy", "false");
  }
}

function render() {
  renderTagFilter();
  renderFavoriteFilter();
  renderManager();
  renderBookmarks();
  renderEditorTags();
}

function renderTagFilter() {
  elements.tagSelect.innerHTML = [
    `<option value="">${escapeHtml(t("all"))}</option>`,
    ...state.tags.map((tag) => `<option value="${escapeAttribute(tag.id)}">${escapeHtml(tag.name)}</option>`)
  ].join("");
  elements.tagSelect.value = state.tagId;
}

function renderFavoriteFilter() {
  elements.favoriteOnlyButton.classList.toggle("is-active", state.favoriteOnly);
  elements.favoriteOnlyButton.setAttribute("aria-pressed", String(state.favoriteOnly));
}

function scrollWorkspaceToTop() {
  finishReturnToTop?.();
  elements.homeFilterButton.classList.add("is-returning");
  window.clearTimeout(returnToTopTimer);
  const finishReturn = () => {
    window.clearTimeout(returnToTopTimer);
    elements.workspace.removeEventListener("scrollend", finishReturn);
    elements.homeFilterButton.classList.remove("is-returning");
    elements.homeFilterButton.blur();
    finishReturnToTop = null;
  };
  finishReturnToTop = finishReturn;
  elements.workspace.addEventListener("scrollend", finishReturn, { once: true });
  elements.workspace.scrollTo({ top: 0, behavior: "smooth" });
  elements.moveToTopButton.hidden = true;
  returnToTopTimer = window.setTimeout(finishReturn, elements.workspace.scrollTop > 0 ? 900 : 0);
}

async function resetFilters() {
  state.tagId = "";
  state.query = "";
  state.favoriteOnly = false;
  elements.tagSelect.value = "";
  elements.searchInput.value = "";
  renderFavoriteFilter();
  await refresh();
  requestAnimationFrame(scrollWorkspaceToTop);
}

function renderManager() {
  elements.tagManageList.innerHTML = state.tags.length
    ? state.tags
        .map(
          (tag) => `<div class="manage-row tag-manage-row" data-tag-id="${escapeAttribute(tag.id)}">
            <label>
              <span class="visually-hidden">${escapeHtml(t("tagNamePlaceholder"))}</span>
              <input name="name" type="text" value="${escapeAttribute(tag.name)}" maxlength="100" />
            </label>
            <div class="tag-manage-actions">
              <button type="button" data-save-tag="${escapeAttribute(tag.id)}">${escapeHtml(t("save"))}</button>
              <button type="button" class="danger" data-delete-tag="${escapeAttribute(tag.id)}">${escapeHtml(t("delete"))}</button>
            </div>
          </div>`
        )
        .join("")
    : `<p class="empty">${escapeHtml(t("noTags"))}</p>`;
}

function renderBookmarks() {
  elements.workspaceStatus.textContent = state.bookmarks.length
    ? t("linksFound", { count: state.bookmarks.length })
    : state.query || state.tagId || state.favoriteOnly
      ? t("noLinks")
      : t("importBookmarks");
  if (!state.bookmarks.length) {
    const isUnfilteredView = !state.query && !state.tagId && !state.favoriteOnly;
    elements.bookmarkList.innerHTML = isUnfilteredView
      ? `<section class="empty-panel first-run-panel">
          <h2>${escapeHtml(t("importBookmarks"))}</h2>
          <p>${escapeHtml(t("importBookmarksHint"))}</p>
          <button type="button" class="file-button first-run-import" data-open-import>${escapeHtml(t("import"))}</button>
          <small>${escapeHtml(t("bookmarkHtmlRequirements"))}</small>
        </section>`
      : `<div class="empty-panel">${escapeHtml(t("noLinks"))}</div>`;
    return;
  }

  const bookmarks = [...state.bookmarks].sort((a, b) => Number(b.favorite) - Number(a.favorite));
  elements.bookmarkList.innerHTML = bookmarks
    .map((bookmark) => {
      const isOpenable = isHttpBookmarkUrl(bookmark.url);
      const previewAction =
        bookmark.structuredPreviewEnabled && isOpenable
          ? `<button type="button" class="ghost-link preview-link" data-preview="${escapeAttribute(bookmark.id)}">${escapeHtml(t("structuredPreview"))}</button>`
          : "";
      const tags = bookmark.tags.map((tag) => `<span class="card-tag">${escapeHtml(tag.name)}</span>`).join("");
      const vpnBadge = bookmark.vpnRequired ? `<span class="card-vpn-badge">${escapeHtml(t("vpnRequired"))}</span>` : "";
      const main = isOpenable
        ? `<a class="card-main-link" href="${escapeAttribute(bookmark.url)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" aria-label="${escapeAttribute(t("openLinkLabel", { title: bookmark.title }))}">
          ${faviconHtml(bookmark)}
          <div>
            <h3>${escapeHtml(bookmark.title)}</h3>
            <span class="card-host">${escapeHtml(safeHost(bookmark.url))}</span>
          </div>
        </a>`
        : `<div class="card-main-link">
          ${faviconHtml(bookmark)}
          <div>
            <h3>${escapeHtml(bookmark.title)}</h3>
            <span class="card-host">${escapeHtml(safeHost(bookmark.url))}</span>
          </div>
        </div>`;
      return `<article class="bookmark-card">
        <div class="card-main">
          ${main}
        </div>
        <div class="card-preview-row">${previewAction}</div>
        <div class="card-footer">
          <div class="card-tags">${vpnBadge}${tags}</div>
          <div class="card-actions">
            <button type="button" class="edit-link" data-edit="${escapeAttribute(bookmark.id)}">${escapeHtml(t("edit"))}</button>
            <button type="button" class="ghost-link" data-details="${escapeAttribute(bookmark.id)}">${escapeHtml(t("descriptionNotes"))}</button>
            <button type="button" class="favorite-toggle${bookmark.favorite ? " is-active" : ""}" data-favorite="${escapeAttribute(bookmark.id)}" aria-label="${escapeAttribute(t(bookmark.favorite ? "removeFavorite" : "addFavorite"))}" title="${escapeAttribute(t(bookmark.favorite ? "removeFavorite" : "addFavorite"))}">${bookmark.favorite ? "★" : "☆"}</button>
          </div>
        </div>
      </article>`;
    })
    .join("");

  setupFaviconFallbacks(elements.bookmarkList.querySelectorAll<HTMLImageElement>(".favicon img"));
}

function renderEditorTags(selectedTagIds?: Set<string>) {
  const selected = selectedTagIds ?? selectedEditorTagIds();
  elements.editorTags.innerHTML = state.tags
    .map(
      (tag) => `<label class="editor-tag-option">
        <input type="checkbox" name="tagIds" value="${escapeAttribute(tag.id)}"${selected.has(tag.id) ? " checked" : ""} />
        <span>${escapeHtml(tag.name)}</span>
      </label>`
    )
    .join("");
}

function selectedEditorTagIds() {
  return new Set(Array.from(elements.editorTags.querySelectorAll<HTMLInputElement>("input[type='checkbox']:checked"), (option) => option.value));
}

function openEditor(bookmark?: Bookmark) {
  window.clearTimeout(metadataTimer);
  metadataController?.abort();
  metadataController = null;
  elements.form.reset();
  elements.editorTitle.textContent = bookmark ? t("linkEdit") : t("newLink");
  elements.deleteButton.toggleAttribute("hidden", !bookmark);
  formControl<HTMLInputElement>(elements.form, "id").value = bookmark?.id ?? "";
  formControl<HTMLInputElement>(elements.form, "title").value = bookmark?.title ?? "";
  formControl<HTMLInputElement>(elements.form, "url").value = bookmark?.url ?? "";
  formControl<HTMLInputElement>(elements.form, "faviconUrl").value = bookmark?.faviconUrl ?? "";
  formControl<HTMLInputElement>(elements.form, "description").value = bookmark?.description ?? "";
  formControl<HTMLTextAreaElement>(elements.form, "notes").value = bookmark?.notes ?? "";
  formControl<HTMLInputElement>(elements.form, "favorite").checked = Boolean(bookmark?.favorite);
  formControl<HTMLInputElement>(elements.form, "vpnRequired").checked = Boolean(bookmark?.vpnRequired);
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
    description: String(data.get("description") ?? ""),
    notes: String(data.get("notes") ?? ""),
    favorite: data.get("favorite") === "on",
    vpnRequired: data.get("vpnRequired") === "on",
    structuredPreviewEnabled: data.get("structuredPreviewEnabled") === "on",
    tagIds: Array.from(elements.editorTags.querySelectorAll<HTMLInputElement>("input[type='checkbox']:checked"), (option) => option.value)
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
    updateFaviconPreview(faviconInput.value.trim(), titleInput.value);
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
  previewHistory = [];
  previewHistoryIndex = -1;
  await openStructuredPreviewUrl(bookmark.url, bookmark.title || safeHost(bookmark.url), { pushHistory: true });
}

function openBookmarkDetails(bookmark: Bookmark) {
  elements.bookmarkDetailsTitle.textContent = bookmark.title || t("bookmarkDetails");
  elements.bookmarkDetailsId.textContent = bookmark.id;
  elements.bookmarkDetailsUrl.textContent = bookmark.url;
  elements.bookmarkDetailsUrl.href = bookmark.url;
  elements.bookmarkDetailsDomain.textContent = safeHost(bookmark.url) || t("emptyValue");
  elements.bookmarkDetailsTags.textContent = bookmark.tags.length ? bookmark.tags.map((tag) => tag.name).join(", ") : t("emptyValue");
  elements.bookmarkDetailsFavorite.textContent = t(bookmark.favorite ? "yes" : "no");
  elements.bookmarkDetailsVpnRequired.textContent = t(bookmark.vpnRequired ? "yes" : "no");
  elements.bookmarkDetailsStructuredPreview.textContent = t(bookmark.structuredPreviewEnabled ? "yes" : "no");
  elements.bookmarkDetailsFavicon.textContent = bookmark.faviconUrl || t("emptyValue");
  elements.bookmarkDetailsDescription.textContent = bookmark.description || t("emptyDescription");
  elements.bookmarkDetailsNotes.textContent = bookmark.notes || t("emptyNotes");
  elements.bookmarkDetailsCreatedAt.textContent = formatDateTime(bookmark.createdAt);
  elements.bookmarkDetailsUpdatedAt.textContent = formatDateTime(bookmark.updatedAt);
  elements.bookmarkDetailsAddDate.textContent = bookmark.addDate ? formatUnixSeconds(bookmark.addDate) : t("emptyValue");
  elements.bookmarkDetailsDialog.showModal();
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value || t("emptyValue") : date.toLocaleString();
}

function formatUnixSeconds(value: number) {
  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

async function openStructuredPreviewUrl(url: string, title: string, options: { pushHistory?: boolean } = {}) {
  if (options.pushHistory) pushPreviewHistory(url, title);
  elements.previewTitle.textContent = url;
  elements.previewStatus.textContent = t("structuredLoading");
  elements.previewContent.replaceChildren();
  elements.previewSearchInput.value = "";
  previewSearchIndex = -1;
  window.getSelection()?.removeAllRanges();
  updatePreviewHistoryButtons();
  if (!elements.structuredPreview.open) {
    elements.structuredPreview.showModal();
    requestAnimationFrame(() => elements.previewSearchInput.focus());
  }

  try {
    const { preview } = await requestJson<{ preview: { url: string; contentType: string; text: string; truncated: boolean } }>(
      "/api/preview",
      { method: "POST", body: JSON.stringify({ url }) }
    );
    elements.previewTitle.textContent = preview.url || url;
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

function pushPreviewHistory(url: string, title: string) {
  const current = previewHistory[previewHistoryIndex];
  if (current?.url === url) {
    current.title = title;
    return;
  }
  previewHistory = previewHistory.slice(0, previewHistoryIndex + 1);
  previewHistory.push({ url, title });
  previewHistoryIndex = previewHistory.length - 1;
}

function updatePreviewHistoryButtons() {
  elements.previewBack.disabled = previewHistoryIndex <= 0;
  elements.previewForward.disabled = previewHistoryIndex >= previewHistory.length - 1;
}

function navigatePreviewHistory(offset: number) {
  const nextIndex = previewHistoryIndex + offset;
  const entry = previewHistory[nextIndex];
  if (!entry) return;
  previewHistoryIndex = nextIndex;
  openStructuredPreviewUrl(entry.url, entry.title).catch(showError);
}

function previewTextNodes() {
  const walker = document.createTreeWalker(elements.previewContent, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    nodes.push(node as Text);
    node = walker.nextNode();
  }
  return nodes;
}

function previewMatchRanges(query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const nodes = previewTextNodes();
  const fullText = nodes.map((node) => node.data).join("");
  const ranges: { start: number; end: number }[] = [];
  let start = fullText.toLowerCase().indexOf(needle);
  while (start !== -1) {
    ranges.push({ start, end: start + needle.length });
    start = fullText.toLowerCase().indexOf(needle, start + needle.length);
  }
  return ranges;
}

function selectPreviewRange(start: number, end: number) {
  const nodes = previewTextNodes();
  let offset = 0;
  let startNode: Text | null = null;
  let endNode: Text | null = null;
  let startOffset = 0;
  let endOffset = 0;
  for (const node of nodes) {
    const nextOffset = offset + node.data.length;
    if (!startNode && start >= offset && start <= nextOffset) {
      startNode = node;
      startOffset = start - offset;
    }
    if (!endNode && end >= offset && end <= nextOffset) {
      endNode = node;
      endOffset = end - offset;
      break;
    }
    offset = nextOffset;
  }
  if (!startNode || !endNode) return false;
  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  range.getBoundingClientRect();
  elements.previewContent.scrollTo({ top: elements.previewContent.scrollTop + range.getBoundingClientRect().top - elements.previewContent.getBoundingClientRect().top - 80 });
  return true;
}

function findPreviewText(direction: 1 | -1) {
  if (previewSearchComposing) return;
  const matches = previewMatchRanges(elements.previewSearchInput.value);
  if (!matches.length) {
    previewSearchIndex = -1;
    window.getSelection()?.removeAllRanges();
    if (elements.previewSearchInput.value.trim()) elements.previewStatus.textContent = t("searchNoMatch");
    return;
  }
  previewSearchIndex = (previewSearchIndex + direction + matches.length) % matches.length;
  const match = matches[previewSearchIndex];
  selectPreviewRange(match.start, match.end);
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

function resolveConfirm(confirmed: boolean) {
  const resolver = pendingConfirm;
  pendingConfirm = null;
  if (elements.confirmDialog.open) elements.confirmDialog.close();
  resolver?.(confirmed);
}

function confirmAction(message: string, acceptLabel = t("delete")) {
  if (pendingConfirm) resolveConfirm(false);
  elements.confirmDialogMessage.textContent = message;
  elements.confirmDialogAccept.textContent = acceptLabel;
  elements.confirmDialogAccept.removeAttribute("data-i18n");
  elements.confirmDialog.showModal();
  elements.confirmDialogCancel.focus();
  return new Promise<boolean>((resolve) => {
    pendingConfirm = resolve;
  });
}

async function createInlineTag() {
  const input = elements.inlineTagForm.querySelector<HTMLInputElement>("[name='name']");
  const button = elements.inlineTagForm.querySelector<HTMLButtonElement>("button");
  if (!input || !button) return;
  const name = input.value.trim();
  if (!name) return;
  button.disabled = true;
  try {
    const result = await requestJson<{ id: string }>("/api/tags", { method: "POST", body: JSON.stringify({ name }) });
    input.value = "";
    await refreshTags(result.id);
    showToast(t("tagAdded"));
  } finally {
    button.disabled = false;
  }
}

async function refreshTags(selectedTagId?: string) {
  const { tags } = await requestJson<{ tags: Tag[] }>("/api/tags");
  const selected = selectedEditorTagIds();
  if (selectedTagId) selected.add(selectedTagId);
  state.tags = tags;
  renderTagFilter();
  renderEditorTags(selected);
  renderManager();
}

async function deleteTag(id: string) {
  const tag = state.tags.find((item) => item.id === id);
  if (!tag || !(await confirmAction(t("confirmDeleteTag", { name: tag.name })))) return;
  await requestJson(`/api/tags/${tag.id}`, { method: "DELETE" });
  await refresh();
  showToast(t("tagDeleted"));
}

async function updateManagedTag(id: string) {
  const row = elements.tagManageList.querySelector<HTMLElement>(`[data-tag-id="${CSS.escape(id)}"]`);
  const nameInput = row?.querySelector<HTMLInputElement>("[name='name']");
  if (!row || !nameInput) return;
  const name = nameInput.value.trim();
  if (!name) return;
  await requestJson(`/api/tags/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ name })
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

  const append = elements.appendImportCheckbox.checked;
  const force = !append && (state.bookmarks.length > 0 || state.tags.length > 0);
  if (force && !(await confirmAction(t("confirmReplaceBookmarks"), t("import")))) {
    input.value = "";
    return;
  }

  if (elements.manager.open) elements.manager.close();
  if (elements.importManager.open) elements.importManager.close();
  updateImportProgress(0, 0, 0);
  elements.importOverlay.hidden = false;
  try {
    const html = await readTextBlob(file);
    let completed = false;
    await requestJsonLines<ImportStreamMessage>(
      "/api/import",
      { method: "POST", body: JSON.stringify({ html, source: file.name, force, append }) },
      (message) => {
        if (message.type === "progress") {
          updateImportProgress(message.completed, message.total, message.percent);
          return;
        }
        if (message.type === "error") throw new ApiClientError(message.error, 500, message.code);
        completed = true;
        updateImportProgress(message.result.bookmarks, message.result.bookmarks, 100);
      }
    );
    if (!completed) throw new ApiClientError("Import response ended before completion", 500, "incomplete_import");
    window.location.reload();
  } catch (error) {
    elements.importOverlay.hidden = true;
    if (error instanceof UnsupportedTextEncodingError) showToast(t("unsupportedBookmarkEncoding"));
    else showError(error);
  } finally {
    input.value = "";
  }
}

type ImportStreamMessage =
  | { type: "progress"; completed: number; total: number; percent: number }
  | { type: "complete"; result: { bookmarks: number; folders: number; skipped: boolean; tags: number } }
  | { type: "error"; error: string; code?: string };

function updateImportProgress(completed: number, total: number, percent: number) {
  const safeTotal = Math.max(0, total);
  const safeCompleted = Math.min(Math.max(0, completed), safeTotal);
  const safePercent = Math.min(100, Math.max(0, Math.round(percent)));
  elements.importProgressBar.value = safePercent;
  elements.importProgressBar.textContent = `${safePercent}%`;
  elements.importProgressBar.setAttribute("aria-valuetext", `${safeCompleted} / ${safeTotal}, ${safePercent}%`);
  elements.importProgressCount.value = `${safeCompleted} / ${safeTotal}`;
  elements.importProgressPercent.value = `${safePercent}%`;
}

async function uploadFavicon(input: HTMLInputElement) {
  const file = input.files?.[0];
  if (!file) return;
  if (file.size > maxFaviconUploadBytes) {
    input.value = "";
    showToast(t("faviconFileTooLarge"));
    return;
  }
  if (!isFaviconFile(file)) {
    input.value = "";
    showToast(t("invalidFaviconFile"));
    return;
  }

  const faviconInput = formControl<HTMLInputElement>(elements.form, "faviconUrl");
  const title = formControl<HTMLInputElement>(elements.form, "title").value;
  const dataUrl = normalizeFaviconDataUrl(await readFileAsDataUrl(file), file);
  faviconInput.value = dataUrl;
  updateFaviconPreview(dataUrl, title);
  input.value = "";
}

function isFaviconFile(file: File) {
  return faviconImageTypes.has(file.type) || /\.ico$/i.test(file.name);
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result ?? "")), { once: true });
    reader.addEventListener("error", () => reject(reader.error ?? new Error("Failed to read favicon")), { once: true });
    reader.readAsDataURL(file);
  });
}

function normalizeFaviconDataUrl(dataUrl: string, file: File) {
  if (/\.ico$/i.test(file.name)) {
    return dataUrl.replace(/^data:(?:application\/octet-stream)?;/i, "data:image/x-icon;");
  }
  return dataUrl;
}

async function resetData() {
  if (!(await confirmAction(t("confirmResetData"), t("resetDataButton")))) return;
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
  if (target.closest<HTMLButtonElement>("[data-open-import]")) {
    elements.importManager.showModal();
    return;
  }
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
document.querySelector<HTMLAnchorElement>(".skip-link")?.addEventListener("click", () => {
  requestAnimationFrame(() => elements.workspace.focus({ preventScroll: true }));
});
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
byId<HTMLButtonElement>("closeEditor").addEventListener("click", () => elements.editor.close());
byId<HTMLButtonElement>("closePreview").addEventListener("click", () => elements.structuredPreview.close());
byId<HTMLButtonElement>("closeBookmarkDetails").addEventListener("click", () => elements.bookmarkDetailsDialog.close());
elements.previewBack.addEventListener("click", () => navigatePreviewHistory(-1));
elements.previewForward.addEventListener("click", () => navigatePreviewHistory(1));
elements.previewSearchInput.addEventListener("input", (event) => {
  previewSearchIndex = -1;
  if (previewSearchComposing || (event as InputEvent).isComposing) return;
  window.getSelection()?.removeAllRanges();
});
elements.previewSearchInput.addEventListener("compositionstart", () => {
  window.clearTimeout(previewSearchCompositionTimer);
  previewSearchComposing = true;
});
elements.previewSearchInput.addEventListener("compositionend", () => {
  window.clearTimeout(previewSearchCompositionTimer);
  previewSearchCompositionTimer = window.setTimeout(() => {
    previewSearchComposing = false;
    previewSearchIndex = -1;
    window.getSelection()?.removeAllRanges();
  }, 0);
});
elements.previewSearchInput.addEventListener("keydown", (event) => {
  if (event.isComposing || previewSearchComposing || event.key === "Process") return;
  if (event.key !== "Enter") return;
  event.preventDefault();
  findPreviewText(event.shiftKey ? -1 : 1);
});
elements.previewSearchPrevious.addEventListener("click", () => findPreviewText(-1));
elements.previewSearchNext.addEventListener("click", () => findPreviewText(1));
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
  if (url) openStructuredPreviewUrl(url, safeHost(url), { pushHistory: true }).catch(showError);
});
elements.cancelPreviewLink.addEventListener("click", () => elements.previewLinkDialog.close());
elements.confirmDialogAccept.addEventListener("click", () => resolveConfirm(true));
elements.confirmDialogCancel.addEventListener("click", () => resolveConfirm(false));
elements.confirmDialog.addEventListener("close", () => {
  if (pendingConfirm) resolveConfirm(false);
});
elements.fetchMetadataButton.addEventListener("click", () => {
  window.clearTimeout(metadataTimer);
  fillMetadata(true).catch(showError);
});
elements.faviconUploadInput.addEventListener("change", () => uploadFavicon(elements.faviconUploadInput).catch(showError));
formControl<HTMLInputElement>(elements.form, "url").addEventListener("input", (event) => {
  window.clearTimeout(metadataTimer);
  const url = (event.currentTarget as HTMLInputElement).value.trim();
  updateMetadataButton(false);
  if (!url) {
    setMetadataStatus(t("metadataIdle"));
    return;
  }
  setMetadataStatus(t("metadataReady"));
  metadataTimer = window.setTimeout(() => fillMetadata(false).catch(showError), metadataFetchDelayMs);
});
formControl<HTMLInputElement>(elements.form, "title").addEventListener("input", (event) => {
  const faviconUrl = formControl<HTMLInputElement>(elements.form, "faviconUrl").value;
  if (!faviconUrl) updateFaviconPreview("", (event.target as HTMLInputElement).value);
});
formControl<HTMLInputElement>(elements.form, "faviconUrl").addEventListener("input", (event) => {
  const title = formControl<HTMLInputElement>(elements.form, "title").value;
  updateFaviconPreview((event.currentTarget as HTMLInputElement).value.trim(), title);
});
formControl<HTMLInputElement>(elements.form, "faviconUrl").addEventListener("blur", (event) => {
  const input = event.currentTarget as HTMLInputElement;
  input.value = input.value.trim();
});
elements.manageDataButton.addEventListener("click", () => {
  elements.manager.showModal();
});
byId<HTMLButtonElement>("closeManager").addEventListener("click", () => elements.manager.close());
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
});
byId<HTMLButtonElement>("closeSystemSettings").addEventListener("click", () => elements.systemSettings.close());
elements.bookmarkHtmlInput.addEventListener("change", () => importBookmarkHtml(elements.bookmarkHtmlInput).catch(showError));
elements.resetDataButton.addEventListener("click", () => resetData().catch(showError));
elements.tagSelect.addEventListener("change", () => {
  state.tagId = elements.tagSelect.value;
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
elements.tagManageList.addEventListener("click", (event) => {
  const saveButton = (event.target as Element).closest<HTMLButtonElement>("[data-save-tag]");
  if (saveButton) {
    updateManagedTag(saveButton.dataset.saveTag ?? "").catch(showError);
    return;
  }
  const deleteButton = (event.target as Element).closest<HTMLButtonElement>("[data-delete-tag]");
  if (deleteButton) deleteTag(deleteButton.dataset.deleteTag ?? "").catch(showError);
});
byId<HTMLFormElement>("tagForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  setFormBusy(form, true);
  const data = new FormData(form);
  requestJson("/api/tags", { method: "POST", body: JSON.stringify({ name: data.get("name") }) })
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
elements.deleteButton.addEventListener("click", async () => {
  const id = formControl<HTMLInputElement>(elements.form, "id").value;
  if (!id || !(await confirmAction(t("confirmDeleteBookmark")))) return;
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
