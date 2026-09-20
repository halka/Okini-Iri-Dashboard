const namedEntities: Record<string, string> = {
  quot: '"', apos: "'", amp: "&", lt: "<", gt: ">"
};

export function decodeHtml(value: string) {
  return value.replace(/&(quot|apos|amp|lt|gt|#\d+|#x[0-9a-f]+);/gi, (entity, code: string) => {
    if (!code.startsWith("#")) return namedEntities[code.toLowerCase()] ?? entity;
    const point = code[1].toLowerCase() === "x" ? Number.parseInt(code.slice(2), 16) : Number(code.slice(1));
    if (point === 0 || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) return "\ufffd";
    return String.fromCodePoint(point);
  }).replace(/\s+/g, " ").trim();
}
