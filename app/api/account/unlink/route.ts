import { getSession } from "@/lib/auth/session";
import { deleteRecurrent, getRecurrentByEmail } from "@/lib/recurrent-store";
import { deletePaymentMethod } from "@/lib/yookassa";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { trackRequest } from "@/lib/metrics";

const RATE_LIMIT_PER_MINUTE = 5;

// Отвязка карты из ЛК (только по сессии): удаляет запись автопродления у нас,
// удаление способа оплаты в ЮKassa — best-effort (если рекуррент в магазине
// не включён, DELETE там падает 405 — это не должно блокировать отвязку).
// Подписка продолжает действовать до оплаченной даты.
async function handlePost(request: Request) {
  const ip = getClientIp(request);
  if (!rateLimit(`account-unlink:${ip}`, RATE_LIMIT_PER_MINUTE, 60_000)) {
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
  const recurrent = await getRecurrentByEmail(email);
  if (!recurrent) {
    return Response.json({ message: "Привязанная карта не найдена." }, { status: 404 });
  }

  try {
    await deletePaymentMethod(recurrent.yookassa_payment_method_id, email);
  } catch (error) {
    // Ошибку ЮKassa игнорируем: локальная отвязка важнее, подписка до оплаченной даты сохраняется
    console.warn("YooKassa deletePaymentMethod failed (best-effort):", error);
  }
  await deleteRecurrent(email);

  return Response.json({ ok: true });
}

export async function POST(request: Request) {
  return trackRequest("account-unlink", request, () => handlePost(request));
}
