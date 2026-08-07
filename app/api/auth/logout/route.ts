import { destroySession } from "@/lib/auth/session";
import { trackRequest } from "@/lib/metrics";

// Выход из ЛК: уничтожает iron-session cookie.
async function handlePost() {
  await destroySession();
  return Response.json({ ok: true });
}

export async function POST(request: Request) {
  return trackRequest("auth-logout", request, () => handlePost());
}
