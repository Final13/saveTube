// Тарифы подписки (управление числом потоков загрузки)
export interface Rate {
  days: number;
  priceRub: number;
  title: string;
}

export const RATES: Rate[] = [
  { days: 7, priceRub: 39, title: "7 дней" },
  { days: 30, priceRub: 89, title: "30 дней" },
  { days: 365, priceRub: 299, title: "365 дней" },
];

export function getRate(index: number): Rate | null {
  return RATES[index] ?? null;
}
