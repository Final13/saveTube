import { after } from "next/server";
import { getRate } from "@/lib/rates";
import { createPayment, setMerchantId } from "@/lib/payments-store";
import { initPayment } from "@/lib/tbank";
import { createRedirectPayment } from "@/lib/yookassa";
import { getPaymentProvider } from "@/lib/settings-store";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { trackRequest } from "@/lib/metrics";
import { createUser, findUserByEmail } from "@/lib/auth/user-store";
import { setSession } from "@/lib/auth/session";
import { sendWelcomeEmail } from "@/lib/email";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RATE_LIMIT_PER_MINUTE = 5;

// Создание платежа: запись в БД + платёж у активного провайдера (T-Bank или ЮKassa —
// переключается в админке), возвращает ссылку на оплату. Контракт ответа одинаковый
// для обоих провайдеров: { url, payment_id }.
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

  // Авто-регистрация: если юзера с таким email нет — создаём без пароля,
  // ставим сессию и шлём welcome-письмо после ответа (fire-and-forget).
  // Если юзер уже есть — НЕ логиним (вход только по коду из письма).
  // Ошибки БД/SMTP не должны ломать оплату.
  let registered = false;
  try {
    const existing = await findUserByEmail(email);
    if (!existing) {
      const userId = await createUser({ email });
      await setSession({ id: userId, email: email.toLowerCase() });
      registered = true;
    }
  } catch (error) {
    registered = false;
    console.error("Auto-registration failed (payment continues):", error);
  }

  if (registered) {
    after(async () => {
      try {
        await sendWelcomeEmail({ to: email });
      } catch (error) {
        console.error("Failed to send welcome email:", error);
      }
    });
  }

  const title = `Подписка ${rate.title}`;
  const provider = await getPaymentProvider();

  try {
    if (provider === "yookassa") {
      const paymentId = await createPayment({
        email,
        rateIndex,
        amountRub: rate.priceRub,
        title,
        provider: "yookassa",
      });
      let yk;
      try {
        yk = await createRedirectPayment({
          paymentId,
          amountRub: rate.priceRub,
          title,
          email,
        });
      } catch (error) {
        // В магазине не включён рекуррент — проводим как разовый платёж
        // (автопродление само заработает, когда менеджер ЮKassa включит повторные платежи)
        const message = error instanceof Error ? error.message : "";
        if (!message.includes("recurring payments")) throw error;
        yk = await createRedirectPayment(
          { paymentId, amountRub: rate.priceRub, title, email },
          { saveMethod: false, idempotenceKey: `create-${paymentId}-plain` },
        );
      }
      if (!yk.confirmation?.confirmation_url) {
        return Response.json(
          { message: "Банк отклонил платёж, попробуйте позже." },
          { status: 502 },
        );
      }
      await setMerchantId(paymentId, yk.id);
      return Response.json({ url: yk.confirmation.confirmation_url, payment_id: paymentId });
    }

    const amount = rate.priceRub * 100; // копейки для банка
    const paymentId = await createPayment({
      email,
      rateIndex,
      amountRub: rate.priceRub,
      title,
      provider: "tbank",
    });
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
