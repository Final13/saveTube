import crypto from "crypto";
import { after } from "next/server";
import { hashPassword } from "@/lib/auth/password";
import { findUserByEmail, updateUserPassword } from "@/lib/auth/user-store";
import { sendPasswordResetEmail } from "@/lib/email";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { trackRequest } from "@/lib/metrics";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RATE_LIMIT_PER_MINUTE = 5;

// Восстановление пароля: генерируем новый случайный пароль и шлём письмом.
// Ответ ВСЕГДА {ok:true} — по ответу нельзя перебрать зарегистрированные email.
async function handlePost(request: Request) {
  const ip = getClientIp(request);
  if (!rateLimit(`auth-forgot:${ip}`, RATE_LIMIT_PER_MINUTE, 60_000)) {
    return Response.json(
      { message: "Слишком много запросов, попробуйте через минуту." },
      { status: 429 },
    );
  }

  let email: string;
  try {
    const body = await request.json();
    email = String(body?.email ?? "").trim();
  } catch {
    return Response.json({ message: "Некорректный запрос." }, { status: 400 });
  }
  if (!EMAIL_REGEX.test(email)) {
    return Response.json({ message: "E-Mail указан неверно!" }, { status: 400 });
  }

  const user = await findUserByEmail(email);
  if (user) {
    const newPassword = crypto.randomBytes(12).toString("hex");
    await updateUserPassword(user.id, await hashPassword(newPassword));

    // Письмо после ответа: медленный/упавший SMTP не ломает восстановление
    after(async () => {
      try {
        await sendPasswordResetEmail({ to: user.email, password: newPassword });
      } catch (error) {
        console.error("Failed to send password reset email:", error);
      }
    });
  }

  return Response.json({ ok: true });
}

export async function POST(request: Request) {
  return trackRequest("auth-forgot-password", request, () => handlePost(request));
}
