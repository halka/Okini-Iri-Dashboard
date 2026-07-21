export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message);
  }
}

export async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");

  const response = await fetch(path, { ...init, headers });
  const payload = (await response.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!response.ok) {
    throw new ApiClientError(payload.error || `Request failed (${response.status})`, response.status, payload.code);
  }
  return payload as T;
}

export async function requestJsonLines<T>(path: string, init: RequestInit, onMessage: (message: T) => void | Promise<void>) {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/x-ndjson, application/json");
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");

  const response = await fetch(path, { ...init, headers });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string; code?: string };
    throw new ApiClientError(payload.error || `Request failed (${response.status})`, response.status, payload.code);
  }
  if (!response.body) throw new ApiClientError("Response stream is unavailable", response.status);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) await onMessage(JSON.parse(line) as T);
    }
    if (done) break;
  }

  if (buffer.trim()) await onMessage(JSON.parse(buffer) as T);
}
