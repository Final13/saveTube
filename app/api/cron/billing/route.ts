import { getRate } from "@/lib/rates";
import { createPayment, setMerchantId } from "@/lib/payments-store";
import {
  getDueRecurrent,
  postponeRecurrent,
} from "@/lib/recurrent-store";
import { getPaymentProvider } from "@/lib/settings-store";
import { activateYookassaPayment, createRecurrentCharge } from "@/lib/yookassa";
import { trackRequest } from "@/lib/metrics";

const RETRY_FAILED_MS = 24 * 60 * 60 * 1000; // после неудачного списания — ретрай через сутки
const MAX_PER_RUN = 50;

// Крон автопродлений ЮKassa. Вызывается системным cron'ом на VPS (раз в час):
//   curl -s -H "Authorization: Bearer $CRON_SECRET" https://save-tube.ru/api/cron/billing
// Списания идут только пока активный провайдер — yookassa (иначе автопродления выключены).
async function handleGet(request: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const auth = request.headers.get("authorization") ?? "";
  if (!secret || auth !== `Bearer ${secret}`) {
    return Response.json({ message: "Forbidden" }, { status: 403 });
  }

  const provider = await getPaymentProvider();
  if (provider !== "yookassa") {
    return Response.json({ skipped: true, reason: "provider is not yookassa" });
  }

  const due = (await getDueRecurrent()).slice(0, MAX_PER_RUN);
  const results: Array<{ id: number; email: string; result: string }> = [];

  for (const sub of due) {
    const rate = getRate(sub.rate_index);
    if (!rate) {
      await postponeRecurrent(sub.id, RETRY_FAILED_MS);
      results.push({ id: sub.id, email: sub.email, result: "unknown rate" });
      continue;
    }

    try {
      const title = `Подписка ${rate.title} (автопродление)`;
      const paymentId = await createPayment({
        email: sub.email,
        rateIndex: sub.rate_index,
        amountRub: rate.priceRub,
        title,
        provider: "yookassa",
      });
      const yk = await createRecurrentCharge({
        paymentId,
        amountRub: rate.priceRub,
        title,
        email: sub.email,
        paymentMethodId: sub.yookassa_payment_method_id,
        idempotenceKey: `renew-${sub.id}-${paymentId}`,
      });
      await setMerchantId(paymentId, yk.id);

      if (yk.status === "succeeded" && yk.paid) {
        // Списание прошло сразу — активируем без ожидания вебхука
        await activateYookassaPayment(yk);
        results.push({ id: sub.id, email: sub.email, result: "charged" });
      } else if (yk.status === "pending") {
        // Ждём вебхук; следующая проверка — через час, вебхук сдвинет дату при успехе
        await postponeRecurrent(sub.id, 60 * 60 * 1000);
        results.push({ id: sub.id, email: sub.email, result: "pending" });
      } else {
        await postponeRecurrent(sub.id, RETRY_FAILED_MS);
        results.push({ id: sub.id, email: sub.email, result: `status ${yk.status}` });
      }
    } catch (error) {
      await postponeRecurrent(sub.id, RETRY_FAILED_MS);
      results.push({
        id: sub.id,
        email: sub.email,
        result: `error: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  return Response.json({ processed: results.length, results });
}

export async function GET(request: Request) {
  return trackRequest("cron-billing", request, () => handleGet(request));
}
