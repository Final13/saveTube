import { hasActiveSubscription, isPaymentActive } from "@/lib/payments-store";
import { trackRequest } from "@/lib/metrics";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const YEAR_SECONDS = 365 * 24 * 60 * 60;

// Проверка активной подписки: по паре payment_id+email (поллинг после оплаты)
// или только по email ("я уже купил подписку"). При активной подписке ставит cookie user_email.
async function handleGet(request: Request) {
  const { searchParams } = new URL(request.url);
  const email = (searchParams.get("email") ?? "").trim();
  const paymentIdParam = searchParams.get("payment_id");

  if (!EMAIL_REGEX.test(email)) {
    return Response.json({ message: "E-Mail указан неверно!", status: false }, { status: 400 });
  }

  const active =
    paymentIdParam !== null
      ? isPaymentActive(Number(paymentIdParam), email)
      : hasActiveSubscription(email);

  return Response.json(
    { status: active },
    {
      headers: active
        ? {
            "Set-Cookie": `user_email=${encodeURIComponent(email)}; Max-Age=${YEAR_SECONDS}; Path=/; SameSite=Lax`,
          }
        : {},
    },
  );
}

export async function GET(request: Request) {
  return trackRequest("payment-status", request, () => handleGet(request));
}
