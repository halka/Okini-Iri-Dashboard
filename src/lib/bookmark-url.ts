export function isSupportedBookmarkUrl(url: string) {
  if (!url.trim() || url.length > 65_536 || /[\u0000-\u001f\u007f]/.test(url)) return false;
  try {
    const parsed = new URL(url);
    return ["http:", "https:", "javascript:", "data:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}
