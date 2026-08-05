import Link from "next/link";
import { SITE_NAME } from "@/lib/site";

const NAV = [
  { href: "/", label: "Главная" },
  { href: "/download-link/", label: "Скачать видео" },
  { href: "/manual/", label: "Инструкция" },
];

export default function Header() {
  return (
    <header className="sticky top-0 z-40 bg-slate-700">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4">
        <Link href="/" className="text-xl font-bold italic text-white">
          {SITE_NAME.replace(".ru", "")}
          <span className="not-italic text-sky-300">.ru</span>
        </Link>
        <nav className="flex items-center gap-1 sm:gap-2">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-lg px-3 py-2 text-sm font-medium text-slate-200 transition hover:bg-slate-600 hover:text-white"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
