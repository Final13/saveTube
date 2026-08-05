import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

// Доступ в админку (/admin): email должен быть в ADMIN_EMAILS + знание ключа ADMIN_KEY.
// После логина ставится httpOnly-cookie admin_session = `${email}.${expiresAt}.${hmac}` —
// без БД и сессий, подпись на ADMIN_KEY.

export const ADMIN_COOKIE = "admin_session";
export const ADMIN_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 дней

function getSecret(): string {
  // Пустой ключ = админка закрыта полностью (логин невозможен)
  return process.env.ADMIN_KEY ?? "";
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const admins = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return admins.includes(email.toLowerCase());
}

export function canLoginWithKey(key: string): boolean {
  const expected = getSecret();
  if (!expected) return false;
  const a = Buffer.from(key);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createAdminSession(email: string): string {
  const expiresAt = Date.now() + ADMIN_SESSION_TTL_SECONDS * 1000;
  const payload = `${email}.${expiresAt}`;
  return `${payload}.${sign(payload)}`;
}

/** Возвращает email, если cookie валидна и email всё ещё в ADMIN_EMAILS, иначе null. */
export function verifyAdminSession(value: string | undefined): string | null {
  if (!value || !getSecret()) return null;
  // Парсим с конца: email может содержать точки, expiresAt и подпись — нет
  const lastDot = value.lastIndexOf(".");
  if (lastDot <= 0) return null;
  const rest = value.slice(0, lastDot);
  const signature = value.slice(lastDot + 1);
  const midDot = rest.lastIndexOf(".");
  if (midDot <= 0) return null;
  const email = rest.slice(0, midDot);
  const expiresAtRaw = rest.slice(midDot + 1);
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return null;

  const expected = sign(`${email}.${expiresAtRaw}`);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  return isAdminEmail(email) ? email : null;
}

function sign(payload: string): string {
  return createHmac("sha256", getSecret()).update(payload).digest("hex");
}

/** Email админа из cookie текущего запроса (server components и route handlers). */
export async function getAdminEmail(): Promise<string | null> {
  const store = await cookies();
  return verifyAdminSession(store.get(ADMIN_COOKIE)?.value);
}
