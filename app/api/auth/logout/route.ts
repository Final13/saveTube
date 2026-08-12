import { cookies } from "next/headers";
import { destroySession } from "@/lib/auth/session";
import { trackRequest } from "@/lib/metrics";

// Выход из ЛК: уничтожает iron-session cookie + cookie user_email (прем-маркер
// устройства для download-form). Иначе после выхода управление потоками продолжало
// работать по активной подписке email'а. Вернуть прем без логина — «Я уже купил
// подписку» (status-эндпоинт поставит user_email заново).
async function handlePost() {
  await destroySession();
  const store = await cookies();
  store.delete("user_email");
  return Response.json({ ok: true });
}

export async function POST(request: Request) {
  return trackRequest("auth-logout", request, () => handlePost());
}
