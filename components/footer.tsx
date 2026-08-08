import Link from "next/link";
import RsyBanner from "@/components/rsy-banner";
import { SITE_NAME, SUPPORT_EMAIL } from "@/lib/site";

export default function Footer() {
  return (
    <>
      <footer className="mt-auto border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-3 px-4 py-8 text-sm text-zinc-500 dark:text-zinc-400 sm:flex-row sm:justify-between">
          <p>
            © {new Date().getFullYear()} {SITE_NAME} — скачивание видео с RuTube
          </p>
          <nav className="flex items-center gap-4">
            <a href={`mailto:${SUPPORT_EMAIL}`} className="transition hover:text-zinc-900 dark:hover:text-zinc-100">
              {SUPPORT_EMAIL}
            </a>
            <Link href="/privacy-policy" className="transition hover:text-zinc-900 dark:hover:text-zinc-100">
              Политика конфиденциальности
            </Link>
            <Link href="/agreement" className="transition hover:text-zinc-900 dark:hover:text-zinc-100">
              Пользовательское соглашение
            </Link>
          </nav>
        </div>
      </footer>
      <RsyBanner />
    </>
  );
}
