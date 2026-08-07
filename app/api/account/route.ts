import { getSession } from "@/lib/auth/session";
import { listPaymentsByEmail } from "@/lib/payments-store";
import { getRecurrentByEmail } from "@/lib/recurrent-store";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { trackRequest } from "@/lib/metrics";

const RATE_LIMIT_PER_MINUTE = 30;

// Данные личного кабинета: статус подписки, привязанная карта (автопродление),
// последние платежи. Доступ только по сессии (email из savetube_session).
async function handleGet(request: Request) {
  const ip = getClientIp(request);
  if (!rateLimit(`account:${ip}`, RATE_LIMIT_PER_MINUTE, 60_000)) {
    return Response.json(
      { message: "Слишком много запросов, попробуйте через минуту." },
      { status: 429 },
    );
  }

  const session = await getSession();
  if (!session.userId || !session.email) {
    return Response.json({ message: "Не авторизован." }, { status: 401 });
  }

  const email = session.email;
  const [payments, recurrent] = await Promise.all([
    listPaymentsByEmail(email, 10),
    getRecurrentByEmail(email),
  ]);

  const now = Date.now();
  const premiumUntil = payments
    .filter((p) => p.status === 1 && p.subscription_until && p.subscription_until > now)
    .reduce<number | null>((max, p) => Math.max(max ?? 0, p.subscription_until!), null);

  return Response.json({
    email,
    premium_until: premiumUntil,
    recurrent: recurrent
      ? {
          rate_index: recurrent.rate_index,
          card_type: recurrent.card_type,
          card_last4: recurrent.card_last4,
          next_billing_at: recurrent.next_billing_at,
          active: recurrent.active,
        }
      : null,
    payments,
  });
}

export async function GET(request: Request) {
  return trackRequest("account", request, () => handleGet(request));
}
