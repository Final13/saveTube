import Link from "next/link";

// Переключатель режимов под формой скачивания (как на проде):
// «Обычная форма» — главная (/), «По ссылке» — внутренняя страница (/download-link/).
// Активный пункт — кнопка, неактивный — ссылка.
export default function FormTabs({ active }: { active: "main" | "link" }) {
  const tabs = [
    { key: "main" as const, label: "Обычная форма", href: "/" },
    { key: "link" as const, label: "По ссылке", href: "/download-link/" },
  ];

  return (
    <div className="mt-3 flex justify-center gap-2">
      {tabs.map((tab) =>
        tab.key === active ? (
          <span
            key={tab.key}
            className="rounded-md bg-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700"
          >
            {tab.label}
          </span>
        ) : (
          <Link
            key={tab.key}
            href={tab.href}
            className="rounded-md bg-slate-100 px-3 py-1.5 text-sm text-slate-500 transition hover:bg-slate-200 hover:text-slate-700"
          >
            {tab.label}
          </Link>
        ),
      )}
    </div>
  );
}
