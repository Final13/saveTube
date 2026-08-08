import type { Metadata } from "next";
import AccountPanel from "./account-panel";

export const metadata: Metadata = {
  title: "Личный кабинет",
  robots: { index: false, follow: false },
};

export default function AccountPage() {
  return (
    <div className="py-10">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-zinc-100">Личный кабинет</h1>
      <AccountPanel />
    </div>
  );
}
