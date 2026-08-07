import { getSession } from "@/lib/auth/session";
import { trackRequest } from "@/lib/metrics";

// Текущая сессия ЛК: { email } или 401.
async function handleGet() {
  const session = await getSession();
  if (!session.userId || !session.email) {
    return Response.json({ message: "Не авторизован." }, { status: 401 });
  }
  return Response.json({ email: session.email });
}

export async function GET(request: Request) {
  return trackRequest("auth-me", request, () => handleGet());
}
