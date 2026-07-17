import hljs from "highlight.js/lib/core";
import jsonLanguage from "highlight.js/lib/languages/json";
import xmlLanguage from "highlight.js/lib/languages/xml";
import "highlight.js/styles/github.css";

hljs.registerLanguage("json", jsonLanguage);
hljs.registerLanguage("xml", xmlLanguage);

export type StructuredLanguage = "json" | "xml";

export function formatStructuredText(
  text: string,
  contentType: string,
  url: string,
  errors: { unknown: string; invalidXml: string }
) {
  const trimmed = text.trim();
  const lowerType = contentType.toLowerCase();
  const lowerPath = url.toLowerCase();
  if (lowerType.includes("json") || lowerPath.endsWith(".json") || trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return { kind: "JSON", language: "json" as const, text: JSON.stringify(JSON.parse(trimmed), null, 2) };
  }
  if (lowerType.includes("xml") || lowerPath.endsWith(".xml") || trimmed.startsWith("<?xml") || trimmed.startsWith("<")) {
    return { kind: "XML", language: "xml" as const, text: formatXml(trimmed, errors.invalidXml) };
  }
  throw new Error(errors.unknown);
}

export function renderHighlightedPreview(container: HTMLElement, text: string, language: StructuredLanguage) {
  const highlighted = hljs.highlight(text, { language }).value;
  container.innerHTML = `<code class="hljs language-${language}">${linkifyHighlightedHtml(highlighted)}</code>`;
}

function linkifyHighlightedHtml(html: string) {
  const template = document.createElement("template");
  template.innerHTML = html;
  const urlPattern = /https?:\/\/[^\s<>"'`\\]+/g;
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);

  for (const node of textNodes) {
    const value = node.nodeValue ?? "";
    const matches = Array.from(value.matchAll(urlPattern));
    if (!matches.length) continue;
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    for (const match of matches) {
      const index = match.index ?? 0;
      const url = trimTrailingUrlPunctuation(match[0]);
      fragment.append(document.createTextNode(value.slice(cursor, index)));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.textContent = url;
      anchor.dataset.previewUrl = url;
      anchor.rel = "noreferrer";
      fragment.append(anchor);
      cursor = index + match[0].length;
      const trailing = match[0].slice(url.length);
      if (trailing) fragment.append(document.createTextNode(trailing));
    }
    fragment.append(document.createTextNode(value.slice(cursor)));
    node.replaceWith(fragment);
  }

  return template.innerHTML;
}

function trimTrailingUrlPunctuation(url: string) {
  return url.replace(/[),.;\]}]+$/g, "");
}

function formatXml(xml: string, errorMessage: string) {
  const parser = new DOMParser();
  const document = parser.parseFromString(xml, "application/xml");
  if (document.querySelector("parsererror")) throw new Error(errorMessage);
  const compact = new XMLSerializer().serializeToString(document).replace(/>\s+</g, "><");
  const tokens = compact.replace(/></g, ">\n<").split("\n");
  let depth = 0;
  return tokens
    .map((token) => {
      if (/^<\/[^>]+>/.test(token)) depth = Math.max(depth - 1, 0);
      const line = `${"  ".repeat(depth)}${token}`;
      if (/^<[^!?/][^>]*[^/]?>$/.test(token) && !token.includes("</")) depth += 1;
      return line;
    })
    .join("\n");
}
