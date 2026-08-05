import { ADMIN_COOKIE } from "@/lib/admin-auth";

// Выход из админки: гасим cookie сессии.
export async function POST() {
  return Response.json(
    { ok: true },
    {
      headers: {
        "Set-Cookie": `${ADMIN_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`,
      },
    },
  );
}
