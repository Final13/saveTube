import { getRedisClient } from "@/lib/redis";
import { createUser, findUserByEmail } from "@/lib/auth/user-store";
import { setSession } from "@/lib/auth/session";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { trackRequest } from "@/lib/metrics";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_REGEX = /^\d{6}$/;
const RATE_LIMIT_PER_MINUTE = 5;

// Вход/регистрация по одноразовому коду: код верен — юзер есть? вход :
// создаём юзера; ставим сессию на год; код удаляем (одноразовый).
// Код неверен/просрочен — 400 с expired:true (фронт предлагает выслать код повторно).
async function handlePost(request: Request) {
  const ip = getClientIp(request);
  if (!rateLimit(`auth-verify-code:${ip}`, RATE_LIMIT_PER_MINUTE, 60_000)) {
    return Response.json(
      { message: "Слишком много попыток, попробуйте через минуту." },
      { status: 429 },
    );
  }

  let email: string;
  let code: string;
  try {
    const body = await request.json();
    email = String(body?.email ?? "").trim().toLowerCase();
    code = String(body?.code ?? "").trim();
  } catch {
    return Response.json({ message: "Некорректный запрос." }, { status: 400 });
  }

  if (!EMAIL_REGEX.test(email) || !CODE_REGEX.test(code)) {
    return Response.json({ message: "Укажите E-Mail и код из письма." }, { status: 400 });
  }

  const redis = getRedisClient();
  if (!redis) {
    return Response.json({ message: "Сервис временно недоступен." }, { status: 503 });
  }

  const stored = await redis.get(`otp:${email}`);
  if (!stored || stored !== code) {
    return Response.json(
      { message: "Код недействителен или просрочен.", expired: true },
      { status: 400 },
    );
  }
  await redis.del(`otp:${email}`);

  let user = await findUserByEmail(email);
  if (!user) {
    const id = await createUser({ email });
    user = { id, email, created_at: Date.now() };
  }

  await setSession({ id: user.id, email: user.email });
  return Response.json({ ok: true, email: user.email });
}

export async function POST(request: Request) {
  return trackRequest("auth-verify-code", request, () => handlePost(request));
}
