/**
 * In-memory token-bucket rate limiter (BRD §8 abuse resistance).
 * Single-process deployment → in-memory is sufficient and auditable.
 */
type Bucket = { tokens: number; last: number };

const buckets = new Map<string, Bucket>();

export function rateLimit(
  key: string,
  capacity = 10,
  refillPerMinute = 10
): { ok: boolean; remaining: number; retryAfterMs: number } {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { tokens: capacity, last: now };
    buckets.set(key, bucket);
  }
  const elapsedMin = (now - bucket.last) / 60_000;
  bucket.tokens = Math.min(capacity, bucket.tokens + elapsedMin * refillPerMinute);
  bucket.last = now;

  if (bucket.tokens < 1) {
    const retryAfterMs = Math.ceil(((1 - bucket.tokens) / refillPerMinute) * 60_000);
    return { ok: false, remaining: 0, retryAfterMs };
  }
  bucket.tokens -= 1;

  // opportunistic cleanup of stale buckets (keeps memory bounded)
  if (buckets.size > 5000) {
    const cutoff = now - 60_000 * 10;
    for (const [k, v] of buckets) if (v.last < cutoff) buckets.delete(k);
  }
  return { ok: true, remaining: Math.floor(bucket.tokens), retryAfterMs: 0 };
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "local";
}
