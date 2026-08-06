import { getRate } from "@/lib/rates";
import { createPayment, setMerchantId } from "@/lib/payments-store";
import { initPayment } from "@/lib/tbank";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { trackRequest } from "@/lib/metrics";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RATE_LIMIT_PER_MINUTE = 5;

// Создание платежа: запись в БД + Init в T-Bank, возвращает ссылку на оплату.
async function handleGet(request: Request) {
  const ip = getClientIp(request);
  if (!rateLimit(`payment:${ip}`, RATE_LIMIT_PER_MINUTE, 60_000)) {
    return Response.json(
      { message: "Слишком много запросов, попробуйте через минуту." },
      { status: 429 },
    );
  }

  const { searchParams } = new URL(request.url);
  const email = (searchParams.get("email") ?? "").trim();
  const rateIndex = Number(searchParams.get("rate"));

  if (!EMAIL_REGEX.test(email)) {
    return Response.json(
      { message: "Пожалуйста, введите корректный E-Mail адрес" },
      { status: 400 },
    );
  }

  const rate = getRate(rateIndex);
  if (!rate) {
    return Response.json({ message: "Некорректный тариф." }, { status: 400 });
  }

  const amount = rate.priceRub * 100; // копейки для банка
  const title = `Подписка ${rate.title}`;
  const paymentId = await createPayment({
    email,
    rateIndex,
    amountRub: rate.priceRub,
    title,
  });

  try {
    const result = await initPayment({
      orderId: String(paymentId),
      amount,
      description: title,
      email,
    });

    if (!result.Success || !result.PaymentURL || !result.PaymentId) {
      return Response.json(
        { message: result.Message || "Банк отклонил платёж, попробуйте позже." },
        { status: 502 },
      );
    }

    await setMerchantId(paymentId, result.PaymentId);
    return Response.json({ url: result.PaymentURL, payment_id: paymentId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ошибка сервера, попробуйте позже.";
    return Response.json({ message }, { status: 502 });
  }
}

export async function GET(request: Request) {
  return trackRequest("payment", request, () => handleGet(request));
}
