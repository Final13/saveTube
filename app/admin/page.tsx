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
    <div className="py-10">
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
