/**
 * Sliding Window IP Rate Limiter for Supabase Edge Functions
 */

interface RateLimitRecord {
  timestamps: number[];
}

const ipHistory = new Map<string, RateLimitRecord>();

// Clean up stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  const windowMs = 60 * 1000;
  for (const [ip, record] of ipHistory.entries()) {
    record.timestamps = record.timestamps.filter(ts => now - ts < windowMs);
    if (record.timestamps.length === 0) {
      ipHistory.delete(ip);
    }
  }
}, 5 * 60 * 1000);

export function checkRateLimit(req: Request, maxRequestsPerMinute = 15): { allowed: boolean; remaining: number } {
  const clientIp = 
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-real-ip") ||
    "127.0.0.1";

  const now = Date.now();
  const windowMs = 60 * 1000;

  let record = ipHistory.get(clientIp);
  if (!record) {
    record = { timestamps: [] };
    ipHistory.set(clientIp, record);
  }

  // Filter timestamps within window
  record.timestamps = record.timestamps.filter(ts => now - ts < windowMs);

  if (record.timestamps.length >= maxRequestsPerMinute) {
    return { allowed: false, remaining: 0 };
  }

  record.timestamps.push(now);
  return { allowed: true, remaining: maxRequestsPerMinute - record.timestamps.length };
}
