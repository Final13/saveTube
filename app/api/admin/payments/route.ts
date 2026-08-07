import { getAdminEmail } from "@/lib/admin-auth";
import { listPayments } from "@/lib/payments-store";
import { listRecurrent } from "@/lib/recurrent-store";
import { getPaymentProvider, setPaymentProvider } from "@/lib/settings-store";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { trackRequest } from "@/lib/metrics";

const RATE_LIMIT_PER_MINUTE = 30;

// Данные раздела «Оплата» в админке: активный провайдер, последние платежи,
// рекуррентные подписки ЮKassa. Только для админа (cookie admin_session).
async function handleGet() {
  const admin = await getAdminEmail();
  if (!admin) {
    return Response.json({ message: "Forbidden" }, { status: 403 });
  }

  return Response.json({
    provider: await getPaymentProvider(),
    payments: await listPayments(50),
    recurrent: await listRecurrent(),
  });
}

// Переключение платёжного провайдера: tbank (разовые) <-> yookassa (рекуррент).
// Переключение влияет только на новые платежи — активные подписки живут в общей
// таблице и продолжают работать независимо от провайдера.
async function handlePost(request: Request) {
  const admin = await getAdminEmail();
  if (!admin) {
    return Response.json({ message: "Forbidden" }, { status: 403 });
  }

  const ip = getClientIp(request);
  if (!rateLimit(`admin-payments:${ip}`, RATE_LIMIT_PER_MINUTE, 60_000)) {
    return Response.json({ message: "Слишком много запросов." }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ message: "Некорректный запрос." }, { status: 400 });
  }

  const provider = body.provider === "yookassa" ? "yookassa" : body.provider === "tbank" ? "tbank" : null;
  if (!provider) {
    return Response.json({ message: "Неизвестный провайдер." }, { status: 400 });
  }

  try {
    await setPaymentProvider(provider);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ошибка сохранения.";
    return Response.json({ message }, { status: 502 });
  }

  return Response.json({ ok: true, provider });
}

export async function GET(request: Request) {
  return trackRequest("admin-payments", request, () => handleGet());
}

export async function POST(request: Request) {
  return trackRequest("admin-payments", request, () => handlePost(request));
}
