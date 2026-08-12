import { getSession } from "@/lib/auth/session";
import { trackRequest } from "@/lib/metrics";

// Текущая сессия ЛК: { email, auto } или 401.
// auto=true — сессия создана авто-регистрацией при покупке (не явным входом по коду).
async function handleGet() {
  const session = await getSession();
  if (!session.userId || !session.email) {
    return Response.json({ message: "Не авторизован." }, { status: 401 });
  }
  return Response.json({ email: session.email, auto: session.auto === true });
}

export async function GET(request: Request) {
  return trackRequest("auth-me", request, () => handleGet());
}
