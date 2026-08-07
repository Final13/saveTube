import { after } from "next/server";
import { getRate } from "@/lib/rates";
import { getPayment, markPaid } from "@/lib/payments-store";
import { getPaymentState, tbankToken } from "@/lib/tbank";
import { sendPaymentSuccessEmail } from "@/lib/email";
import { trackRequest } from "@/lib/metrics";

// Вебхук T-Bank о статусе платежа.
// Проверки: подпись (Token) -> статус CONFIRMED -> перепроверка через GetState -> идемпотентная активация.
// T-Bank ждёт в ответ ровно "OK".
async function handlePost(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return new Response("ERROR", { status: 400 });
  }

  // 1. Подпись
  const receivedToken = String(body.Token ?? "");
  if (!receivedToken || tbankToken(body) !== receivedToken) {
    return new Response("ERROR", { status: 403 });
  }

  // 2. Нас интересует только успешное списание
  if (body.Status !== "CONFIRMED") {
    return new Response("OK");
  }

  const orderId = Number(body.OrderId);
  const merchantId = String(body.PaymentId ?? "");
  const payment = Number.isFinite(orderId) ? await getPayment(orderId) : null;

  if (!payment || !merchantId) {
    return new Response("ERROR", { status: 404 });
  }

  // 3. Перепроверка статуса напрямую у банка (вебхук мог быть подделан/продублирован)
  try {
    const state = await getPaymentState(merchantId);
    if (!state.Success || state.Status !== "CONFIRMED") {
      return new Response("ERROR", { status: 502 });
    }
  } catch {
    // Банк временно недоступен — вернём ошибку, T-Bank повторит уведомление
    return new Response("ERROR", { status: 502 });
  }

  // 4. Идемпотентная активация подписки
  const rate = getRate(payment.rate_index);
  if (rate) {
    const until = Date.now() + rate.days * 24 * 60 * 60 * 1000;
    const activated = await markPaid(payment.id, until);
    if (activated) {
      // Письмо об оплате — только при реальной активации (повторы вебхука не дублируют),
      // после ответа банку, ошибки SMTP глушим
      after(async () => {
        try {
          await sendPaymentSuccessEmail({ to: payment.email, title: rate.title, until });
        } catch (error) {
          console.error("Failed to send payment success email:", error);
        }
      });
    }
  }

  return new Response("OK");
}

export async function POST(request: Request) {
  return trackRequest("payment-notification", request, () => handlePost(request));
}
