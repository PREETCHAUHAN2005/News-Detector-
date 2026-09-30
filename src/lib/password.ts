/**
 * Password hashing with Node's built-in scrypt — deliberately zero external
 * dependencies (safest option; no native modules, no supply-chain surface).
 */
import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [salt, hash] = stored.split(":");
    if (!salt || !hash) return false;
    const candidate = scryptSync(password, salt, 64);
    return timingSafeEqual(Buffer.from(hash, "hex"), candidate);
  } catch {
    return false;
  }
}
