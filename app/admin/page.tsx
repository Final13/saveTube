import type { Metadata } from "next";
import { getAdminEmail } from "@/lib/admin-auth";
import AdminLogin from "./admin-login";
import MetricsDashboard from "./metrics-dashboard";
import PaymentsPanel from "./payments-panel";

export const metadata: Metadata = {
  title: "Админка",
  robots: { index: false, follow: false },
};

// Страница зависит от cookie — рендерим динамически
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const email = await getAdminEmail();

  return (
    // Шире основного контейнера (max-w-4xl в layout): breakout на всю ширину до 6xl
    <div className="relative left-1/2 w-[calc(100vw-2rem)] max-w-6xl -translate-x-1/2 py-10">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-zinc-100">Метрики сервиса</h1>
      {email ? (
        <>
          <PaymentsPanel />
          <MetricsDashboard email={email} />
        </>
      ) : (
        <AdminLogin />
      )}
    </div>
  );
}
