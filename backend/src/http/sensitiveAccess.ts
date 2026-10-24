/** Sensitive API and recording media routes require a dedicated internal token.
 * The token is deliberately NOT the JWT_SECRET, SIP password or the WavoIP token.
 * Deployed instances without a configured token deny these endpoints (fail closed).
 */
import { timingSafeEqual } from "node:crypto";

export function requiresSensitivePabxAuth(method: string, rawUrl: string): boolean {
  const m = method.toUpperCase();
  let path = (rawUrl || "/").split("?")[0];
  // The static handler can decode URL-encoded slashes; our guard must not
  // accidentally exempt an encoded variant of a protected path.
  try {
    for (let i = 0; i < 5; i++) {
      const next = decodeURIComponent(path);
      if (next === path) break;
      path = next;
    }
  } catch {
    return /^\/(?:media|calls|summaries|uploads)(?:\/|$)/i.test(path);
  }
  path = path.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  if (/^\/media\/recordings(?:\/|$)/i.test(path)) return true;
  if (/^(?:\/summaries|\/uploads)\/?$/i.test(path) && (m === "GET" || m === "HEAD")) return true;
  if (/^\/calls\/(?:\d+\/summary|recording)\/?$/i.test(path)) return true;
  return false;
}

export function checkSensitivePabxToken(configured: string | undefined, supplied: unknown): boolean {
  if (!configured || configured.length < 32 || typeof supplied !== "string") return false;
  const a = Buffer.from(configured, "utf8");
  const b = Buffer.from(supplied, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
