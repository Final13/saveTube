import type { Metadata } from "next";
import Link from "next/link";
import DownloadForm from "@/components/download-form";
import { SITE_DESCRIPTION } from "@/lib/site";

export const metadata: Metadata = {
  title: "Скачать видео с RuTube бесплатно – Быстрый онлайн-загрузчик",
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    title: "Скачать видео с RuTube бесплатно – Быстрый онлайн-загрузчик",
    description: SITE_DESCRIPTION,
  },
};

export default function HomePage() {
  return (
    <>
      <section className="py-10 text-center sm:py-14">
        <h1 className="mx-auto max-w-3xl text-3xl font-bold sm:text-4xl">
          Скачать видео с RuTube бесплатно и без программ
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-zinc-600">
          Вставьте ссылку на видео в указанное поле и нажмите «Конвертировать». Система предложит
          доступные форматы, после чего вы сможете загрузить файл на своё устройство.
        </p>
        <div className="mx-auto mt-8 max-w-2xl">
          <DownloadForm />
        </div>
        <p className="mt-4 text-sm text-zinc-500">
          Скачивая видео, вы соглашаетесь с{" "}
          <Link href="/agreement/" className="text-sky-700 underline hover:text-sky-800">
            условиями использования сайта
          </Link>
        </p>
      </section>

      <div className="mb-10 rounded-xl bg-slate-100 p-6 sm:p-10">
        <section>
          <h2 className="text-2xl font-bold">О сервисе</h2>
          <div className="mt-4 space-y-4 text-zinc-600">
            <p>
              Многие пользователи RuTube задаются вопросом: как скачать видео с RuTube? Это
              неудивительно, ведь доступ к интернету есть не всегда, а иногда хочется сохранить
              любимое шоу, клип или видеоролик, чтобы смотреть его без рекламы и в любое время.
            </p>
            <p>
              Скачивание видео с RuTube позволяет вам наслаждаться контентом оффлайн. Save-Tube.ru —
              это быстрый и удобный сервис для загрузки видео. Вам не нужно устанавливать
              дополнительные программы или платить за услуги. Всего несколько кликов — и ролик уже
              сохранён на вашем устройстве.
            </p>
          </div>
        </section>

        <section className="mt-10">
          <h2 className="text-2xl font-bold">Совместимость</h2>
          <p className="mt-4 text-zinc-600">
            Сервис save-tube.ru совместим со всеми популярными устройствами и операционными
            системами. Вы можете скачать видео с RuTube на:
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-6 text-zinc-600">
            <li>Настольный компьютер или ноутбук (Windows, macOS, Linux);</li>
            <li>Смартфон или планшет (Android, iOS);</li>
            <li>Даже на смарт-телевизор.</li>
          </ul>
          <p className="mt-4 text-zinc-600">
            Единственное, что требуется для работы — наличие веб-браузера. Видео сохраняются в
            наиболее популярных форматах, таких как MP4 и MP3, и могут быть воспроизведены на любом
            устройстве без необходимости установки дополнительных кодеков.
          </p>
        </section>

        <section className="mt-10">
          <h2 className="text-2xl font-bold">Преимущества</h2>
          <ul className="mt-4 list-disc space-y-2 pl-6 text-zinc-600">
            <li>Можете скачивать видео в разном качестве: HD, FullHD, 2K, 4K;</li>
            <li>Поддержка всех популярных браузеров;</li>
            <li>Совместимость с любыми устройствами, включая старые модели;</li>
            <li>Возможность конвертировать видео в аудио форматы (MP3);</li>
            <li>Простота использования без установки программ;</li>
            <li>Быстрая загрузка без ограничения по длине роликов.</li>
          </ul>
          <p className="mt-6 text-zinc-600">
            Полная инструкция доступна по{" "}
            <Link href="/manual/" className="font-medium text-sky-700 underline hover:text-sky-800">
              данной ссылке
            </Link>
            .
          </p>
        </section>
      </div>
    </>
  );
}
