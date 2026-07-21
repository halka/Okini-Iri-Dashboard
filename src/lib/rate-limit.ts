type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();
const maxBuckets = 10_000;

export function consumeRateLimit(request: Request, scope: string, maxRequests: number, windowMs: number) {
  const now = Date.now();
  if (buckets.size > maxBuckets) {
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }

  const identity = request.headers.get("cf-connecting-ip") || request.headers.get("x-real-ip") || "anonymous";
  const key = `${scope}:${identity}`;
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfter: 0 };
  }

  current.count += 1;
  if (current.count <= maxRequests) return { allowed: true, retryAfter: 0 };
  return { allowed: false, retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
}
