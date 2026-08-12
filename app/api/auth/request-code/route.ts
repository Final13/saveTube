import crypto from "crypto";
import { after } from "next/server";
import { getRedisClient } from "@/lib/redis";
import { sendOtpEmail } from "@/lib/email";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { trackRequest } from "@/lib/metrics";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RATE_LIMIT_PER_MINUTE = 5;
const OTP_TTL_SECONDS = 300; // 5 минут
const RESEND_COOLDOWN_SECONDS = 60;

// Запрос одноразового кода для входа/регистрации: 6 цифр в Redis (otp:{email},
// EX 300), письмо с кодом. Ответ ВСЕГДА {ok:true} — по ответу нельзя перебрать
// зарегистрированные email. Антиспам по email: не чаще 1 кода в 60 сек
// (otp-sent:{email}, SET NX EX 60).
async function handlePost(request: Request) {
  const ip = getClientIp(request);
  if (!rateLimit(`auth-request-code:${ip}`, RATE_LIMIT_PER_MINUTE, 60_000)) {
    return Response.json(
      { message: "Слишком много запросов, попробуйте через минуту." },
      { status: 429 },
    );
  }

  let email: string;
  try {
    const body = await request.json();
    email = String(body?.email ?? "").trim().toLowerCase();
  } catch {
    return Response.json({ message: "Некорректный запрос." }, { status: 400 });
  }
  if (!EMAIL_REGEX.test(email)) {
    return Response.json({ message: "E-Mail указан неверно!" }, { status: 400 });
  }

  const redis = getRedisClient();
  if (!redis) {
    return Response.json({ message: "Сервис временно недоступен." }, { status: 503 });
  }

  // Антиспам: один код в минуту на email. Маркер alreadySent — фронт по нему
  // переключается на шаг ввода кода (действующий код уже в почте), а не показывает ошибку.
  const acquired = await redis.set(`otp-sent:${email}`, "1", "EX", RESEND_COOLDOWN_SECONDS, "NX");
  if (!acquired) {
    return Response.json(
      { message: "Код уже отправлен, проверьте почту.", alreadySent: true },
      { status: 429 },
    );
  }

  const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
  try {
    await redis.set(`otp:${email}`, code, "EX", OTP_TTL_SECONDS);
  } catch (error) {
    // Код не сохранился — снимаем антиспам, чтобы юзер мог повторить сразу
    await redis.del(`otp-sent:${email}`).catch(() => {});
    throw error;
  }

  // Письмо после ответа: медленный/упавший SMTP не ломает запрос кода
  after(async () => {
    try {
      await sendOtpEmail({ to: email, code });
    } catch (error) {
      console.error("Failed to send OTP email:", error);
    }
  });

  return Response.json({ ok: true });
}

export async function POST(request: Request) {
  return trackRequest("auth-request-code", request, () => handlePost(request));
}
