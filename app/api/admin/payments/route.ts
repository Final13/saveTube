import { getAdminEmail } from "@/lib/admin-auth";
import { getPaymentMethodStats, listPaidYookassaWithoutMethod, listPayments, setPaymentMethod } from "@/lib/payments-store";
import { getYookassaPayment, paymentMethodLabel } from "@/lib/yookassa";
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
    methodStats: await getPaymentMethodStats(),
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

  // Разовый бэкфилл способов оплаты для старых оплаченных платежей ЮKassa:
  // дотягиваем payment_method из API по merchant_id (до 200 за раз, идемпотентно)
  if (body.action === "backfill-methods") {
    const missing = await listPaidYookassaWithoutMethod(200);
    let updated = 0;
    let failed = 0;
    for (const payment of missing) {
      try {
        let yk;
        try {
          yk = await getYookassaPayment(payment.merchant_id, payment.email);
        } catch {
          // Платёж мог быть в другом магазине (боевой/тестовый) — перепробуем оба
          yk = await getYookassaPayment(payment.merchant_id);
        }
        const label = paymentMethodLabel(yk.payment_method);
        if (!label) throw new Error("no method");
        await setPaymentMethod(payment.id, label);
        updated++;
      } catch {
        failed++;
      }
    }
    return Response.json({ ok: true, updated, failed, remaining: missing.length - updated });
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
