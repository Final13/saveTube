// Тарифы подписки (управление числом потоков загрузки)
export interface Rate {
  days: number;
  priceRub: number;
  title: string;
  /** Зачёркнутая «старая» цена в модалке оплаты (только маркетинг, на списание не влияет) */
  oldPriceRub?: number;
  /** Скрыт из модалки оплаты; запись НЕ удалять и НЕ переставлять — rate_index
   *  хранится в платежах и автопродлениях, старые рекурренты продолжают списываться */
  hidden?: boolean;
}

export const RATES: Rate[] = [
  { days: 7, priceRub: 39, title: "7 дней" },
  { days: 30, priceRub: 89, title: "30 дней", oldPriceRub: 150 },
  { days: 365, priceRub: 299, title: "365 дней" },
];

export function getRate(index: number): Rate | null {
  return RATES[index] ?? null;
}
