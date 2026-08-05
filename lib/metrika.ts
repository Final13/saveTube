// Яндекс.Метрика: стаб-очередь, чтобы ранние цели не терялись до загрузки скрипта.
export const ymId = process.env.NEXT_PUBLIC_YM_ID;

declare global {
  interface Window {
    ym?: (...args: unknown[]) => void;
  }
}

export function ymGoal(goal: string, params?: Record<string, unknown>) {
  if (typeof window !== "undefined" && window.ym && ymId) {
    window.ym(Number(ymId), "reachGoal", goal, params);
  }
}
