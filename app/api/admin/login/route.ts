import {
  ADMIN_COOKIE,
  ADMIN_SESSION_TTL_SECONDS,
  canLoginWithKey,
  createAdminSession,
  isAdminEmail,
} from "@/lib/admin-auth";
import { trackRequest } from "@/lib/metrics";
import { getClientIp, rateLimit } from "@/lib/rate-limit";

const RATE_LIMIT_PER_MINUTE = 5;

// Логин в админку: email из ADMIN_EMAILS + ключ ADMIN_KEY.
// При успехе — httpOnly-cookie admin_session на 7 дней.
export async function POST(request: Request) {
  return trackRequest("admin-login", request, async () => {
    const ip = getClientIp(request);
    if (!rateLimit(`admin-login:${ip}`, RATE_LIMIT_PER_MINUTE, 60_000)) {
      return Response.json(
        { message: "Слишком много попыток, попробуйте через минуту." },
        { status: 429 },
      );
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return Response.json({ message: "Некорректный запрос." }, { status: 400 });
    }

    const email = String(body?.email ?? "").trim();
    const key = String(body?.key ?? "");

    if (!isAdminEmail(email) || !canLoginWithKey(key)) {
      return Response.json({ message: "Неверный E-Mail или ключ доступа." }, { status: 403 });
    }

    const session = encodeURIComponent(createAdminSession(email));
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    return Response.json(
      { ok: true },
      {
        headers: {
          "Set-Cookie": `${ADMIN_COOKIE}=${session}; Max-Age=${ADMIN_SESSION_TTL_SECONDS}; Path=/; HttpOnly; SameSite=Lax${secure}`,
        },
      },
    );
  });
}
