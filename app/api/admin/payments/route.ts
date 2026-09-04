import { getAdminEmail } from "@/lib/admin-auth";
import { getPaymentMethodStats, getSubscriptionStats, listPaidYookassaWithoutMethod, listPayments, setPaymentMethod } from "@/lib/payments-store";
import { getYookassaPayment, paymentMethodLabel } from "@/lib/yookassa";
import { recurrentActiveStats, listRecurrent, backfillRecurrentStreaks } from "@/lib/recurrent-store";
import { getPaymentProvider, setPaymentProvider } from "@/lib/settings-store";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { trackRequest } from "@/lib/metrics";

const RATE_LIMIT_PER_MINUTE = 30;

// Данные раздела «Оплата» в админке: активный провайдер, платежи и рекуррентные
// подписки ЮKassa постранично (по 10, курсор ?payments_before=/?recurrent_before= —
// id последней показанной записи). Только для админа (cookie admin_session).
async function handleGet(request: Request) {
  const admin = await getAdminEmail();
  if (!admin) {
    return Response.json({ message: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const paymentsBefore = Number(searchParams.get("payments_before")) || null;
  const recurrentBefore = Number(searchParams.get("recurrent_before")) || null;
  // Догрузка одной таблицы по курсору
  if (paymentsBefore) {
    return Response.json({ payments: await listPayments(10, paymentsBefore) });
  }
  if (recurrentBefore) {
    return Response.json({ recurrent: await listRecurrent(10, recurrentBefore) });
  }
  // Полная выгрузка автопродлений для сортировки на клиенте (админка, записей немного)
  if (searchParams.get("recurrent_all")) {
    return Response.json({ recurrent: await listRecurrent(1000) });
  }
  // Переключение окна графиков подписок без перезагрузки остальных данных
  const statsDays = Number(searchParams.get("stats_days")) || null;
  if (statsDays) {
    return Response.json({ subscriptionStats: await getSubscriptionStats(statsDays) });
  }

  return Response.json({
    provider: await getPaymentProvider(),
    payments: await listPayments(10),
    recurrent: await listRecurrent(10),
    recurrentActive: await recurrentActiveStats(),
    methodStats: await getPaymentMethodStats(),
    subscriptionStats: await getSubscriptionStats(30),
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

  // Разовый бэкфилл серий успешных автосписаний: пересчёт success_streak
  // по прошлым оплаченным платежам «(автопродление)» (колонка появилась позже)
  if (body.action === "backfill-streaks") {
    try {
      const updated = await backfillRecurrentStreaks();
      if (updated === null) {
        return Response.json({ message: "MySQL недоступна." }, { status: 503 });
      }
      return Response.json({ ok: true, updated });
    } catch (error) {
      // Текст ошибки — в админку и pm2-лог (роут только для админа)
      console.error("Backfill streaks failed:", error);
      const message = error instanceof Error ? error.message : "Ошибка бэкфилла.";
      return Response.json({ message }, { status: 502 });
    }
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
  return trackRequest("admin-payments", request, () => handleGet(request));
}

export async function POST(request: Request) {
  return trackRequest("admin-payments", request, () => handlePost(request));
}
