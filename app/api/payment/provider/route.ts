import { getPaymentProvider } from "@/lib/settings-store";
import { trackRequest } from "@/lib/metrics";

// Активный платёжный провайдер (переключается в админке) — публичное значение для фронта:
// модалка оплаты по нему решает, показывать ли фразу об автопродлении (рекуррент только у ЮKassa)
async function handleGet() {
  const provider = await getPaymentProvider();
  return Response.json({ provider });
}

export async function GET(request: Request) {
  return trackRequest("payment-provider", request, () => handleGet());
}
