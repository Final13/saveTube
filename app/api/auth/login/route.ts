import { verifyPassword } from "@/lib/auth/password";
import { findUserByEmail } from "@/lib/auth/user-store";
import { setSession } from "@/lib/auth/session";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { trackRequest } from "@/lib/metrics";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RATE_LIMIT_PER_MINUTE = 5;

// Вход в ЛК по email+паролю (аккаунт создаётся автоматически при первой оплате,
// пароль приходит письмом). Одинаковый ответ на «нет юзера» и «неверный пароль».
async function handlePost(request: Request) {
  const ip = getClientIp(request);
  if (!rateLimit(`auth-login:${ip}`, RATE_LIMIT_PER_MINUTE, 60_000)) {
    return Response.json(
      { message: "Слишком много попыток, попробуйте через минуту." },
      { status: 429 },
    );
  }

  let email: string;
  let password: string;
  try {
    const body = await request.json();
    email = String(body?.email ?? "").trim();
    password = String(body?.password ?? "");
  } catch {
    return Response.json({ message: "Некорректный запрос." }, { status: 400 });
  }

  if (!EMAIL_REGEX.test(email) || !password) {
    return Response.json({ message: "Укажите E-Mail и пароль." }, { status: 400 });
  }

  const user = await findUserByEmail(email);
  const valid = user ? await verifyPassword(password, user.password_hash) : false;
  if (!user || !valid) {
    return Response.json({ message: "Неверный E-Mail или пароль." }, { status: 401 });
  }

  await setSession({ id: user.id, email: user.email });
  return Response.json({ ok: true, email: user.email });
}

export async function POST(request: Request) {
  return trackRequest("auth-login", request, () => handlePost(request));
}
