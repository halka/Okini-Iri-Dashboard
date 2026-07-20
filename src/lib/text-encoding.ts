import Encoding from "encoding-japanese";

const supportedEncodings = ["UTF16", "JIS", "UTF8", "EUCJP", "SJIS"] as const;
type SupportedEncoding = (typeof supportedEncodings)[number];

const charsetAliases: Record<string, SupportedEncoding> = {
  "utf-8": "UTF8",
  utf8: "UTF8",
  "euc-jp": "EUCJP",
  "euc_jp": "EUCJP",
  eucjp: "EUCJP",
  "x-euc-jp": "EUCJP",
  "shift-jis": "SJIS",
  "shift_jis": "SJIS",
  sjis: "SJIS",
  "x-sjis": "SJIS",
  "windows-31j": "SJIS",
  windows31j: "SJIS",
  cp932: "SJIS",
  ms932: "SJIS",
  "ms_kanji": "SJIS",
  "iso-2022-jp": "JIS",
  iso2022jp: "JIS",
  "utf-16": "UTF16",
  utf16: "UTF16"
};

export class UnsupportedTextEncodingError extends Error {}

export function normalizeUtf8Text(value: string) {
  return new TextDecoder("utf-8").decode(new TextEncoder().encode(value));
}

export async function readTextBlob(blob: Blob) {
  return decodeText(new Uint8Array(await blob.arrayBuffer()));
}

export async function readResponseText(response: Response, maxBytes: number) {
  const { bytes, truncated } = await readResponseBytes(response, maxBytes);
  return {
    text: decodeText(bytes, response.headers.get("content-type") ?? ""),
    truncated
  };
}

export function decodeText(bytes: Uint8Array, contentType = "") {
  if (bytes.byteLength === 0) return "";
  const encoding = detectEncoding(bytes, contentType);
  if (!encoding) throw new UnsupportedTextEncodingError();

  const decoded = Encoding.convert(bytes, {
    to: "UNICODE",
    from: encoding,
    type: "string"
  });
  if (typeof decoded !== "string") throw new UnsupportedTextEncodingError();
  return normalizeUtf8Text(decoded.replace(/^\uFEFF/, ""));
}

async function readResponseBytes(response: Response, maxBytes: number) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new RangeError("maxBytes must be a positive integer");
  if (!response.body) return { bytes: new Uint8Array(), truncated: false };

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  let truncated = false;

  while (true) {
    const result = await reader.read();
    if (result.done) break;

    const remaining = maxBytes - byteLength;
    if (result.value.byteLength > remaining) {
      if (remaining > 0) {
        chunks.push(result.value.subarray(0, remaining));
        byteLength += remaining;
      }
      truncated = true;
      await reader.cancel();
      break;
    }

    chunks.push(result.value);
    byteLength += result.value.byteLength;
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, truncated };
}

function detectEncoding(bytes: Uint8Array, contentType: string) {
  const bomEncoding = detectBom(bytes);
  if (bomEncoding) return bomEncoding;

  const declaredEncoding = detectDeclaredEncoding(bytes, contentType);
  if (declaredEncoding && Encoding.detect(bytes, declaredEncoding)) return declaredEncoding;

  const detected = Encoding.detect(bytes, [...supportedEncodings]);
  return typeof detected === "string" ? detected : null;
}

function detectBom(bytes: Uint8Array): SupportedEncoding | null {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return "UTF8";
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) return "UTF16";
  return null;
}

function detectDeclaredEncoding(bytes: Uint8Array, contentType: string) {
  const headerCharset = extractCharset(contentType);
  if (headerCharset) return charsetAliases[headerCharset] ?? null;

  const head = Array.from(bytes.subarray(0, 4096), (byte) => (byte < 0x80 ? String.fromCharCode(byte) : " ")).join("");
  const documentCharset = extractCharset(head);
  return documentCharset ? charsetAliases[documentCharset] ?? null : null;
}

function extractCharset(value: string) {
  return value.match(/charset\s*=\s*["']?\s*([a-z0-9._-]+)/i)?.[1]?.toLowerCase() ?? "";
}
