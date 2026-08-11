import Link from "next/link";
import RsyBanner from "@/components/rsy-banner";
import { SITE_NAME } from "@/lib/site";

// Футер — как в оригинале: центрированное меню ссылок. Почта вынесена на /contacts.
export default function Footer() {
  return (
    <>
      <footer className="mt-auto border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <div className="mx-auto max-w-4xl px-4 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
          <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
            <Link
              href="/privacy-policy"
              className="transition hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              Политика конфиденциальности
            </Link>
            <Link
              href="/agreement"
              className="transition hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              Пользовательское соглашение
            </Link>
            <Link
              href="/contacts"
              className="transition hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              Контакты
            </Link>
          </nav>
          <p className="mt-3">
            © {new Date().getFullYear()} {SITE_NAME} — скачивание видео с RuTube
          </p>
        </div>
      </footer>
      <RsyBanner />
    </>
  );
}
