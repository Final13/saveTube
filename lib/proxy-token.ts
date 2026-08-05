import { createHmac, timingSafeEqual } from "crypto";

// Короткоживущий подписанный токен для прокси-роута: выдаётся вместе со списком сегментов,
// без него прокси отказывает — так наш прокси нельзя использовать как открытый релей.
// Формат: `${expiresAtMs}.${hmacSha256Hex}`

const SECRET = process.env.PROXY_TOKEN_SECRET ?? "dev-only-insecure-secret";

const TOKEN_TTL_MS = 3 * 60 * 60 * 1000; // 3 часа — хватает на длинные видео

export function issueProxyToken(): string {
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  const signature = sign(String(expiresAt));
  return `${expiresAt}.${signature}`;
}

export function verifyProxyToken(token: string | null): boolean {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const expiresAtRaw = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;

  const expected = sign(expiresAtRaw);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function sign(payload: string): string {
  return createHmac("sha256", SECRET).update(payload).digest("hex");
}
