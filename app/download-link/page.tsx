import type { Metadata } from "next";
import Link from "next/link";
import DownloadForm from "@/components/download-form";
import FormTabs from "@/components/form-tabs";

export const metadata: Metadata = {
  title: "Скачать видео с RuTube по ссылке",
  description:
    "Бесплатный онлайн-загрузчик для скачивания видео с RuTube по ссылке. Сохраняйте ролики в разных форматах без регистрации и программ.",
  alternates: { canonical: "/download-link" },
  openGraph: {
    title: "Скачать видео с RuTube по ссылке",
    description:
      "Бесплатный онлайн-загрузчик для скачивания видео с RuTube по ссылке. Сохраняйте ролики в разных форматах без регистрации и программ.",
  },
};

export default function DownloadLinkPage() {
  return (
    <>
      <section className="py-10 text-center sm:py-14">
        <h1 className="mx-auto max-w-3xl text-3xl font-bold sm:text-4xl">
          Скачать видео с RuTube по ссылке
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-zinc-600 dark:text-zinc-400">
          Вставьте ссылку на видео в указанное поле и нажмите «Скачать видео». Система предложит
          доступные форматы, после чего вы сможете загрузить файл на своё устройство.
        </p>
        <div className="mx-auto mt-8 max-w-2xl text-left">
          <DownloadForm />
        </div>
        <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
          Скачивая видео, вы соглашаетесь с{" "}
          <Link href="/agreement" className="text-sky-700 dark:text-sky-400 underline hover:text-sky-800 dark:hover:text-sky-300">
            условиями использования сайта
          </Link>
        </p>
        <FormTabs active="link" />
      </section>

      <section className="mb-10 rounded-xl bg-slate-100 dark:bg-zinc-900 p-6 sm:p-10">
        <h2 className="text-2xl font-bold">Краткая инструкция</h2>
        <p className="mt-4 text-zinc-600 dark:text-zinc-400">
          В форме выше вы можете указать ссылку на видео с Rutube, далее просто выберите качество
          видео, и нажмите скачать.
        </p>
        <p className="mt-4 text-zinc-600 dark:text-zinc-400">
          Для быстрой загрузки убедитесь что у вас нет проблем с интернетом.
        </p>
        <p className="mt-4 text-zinc-600 dark:text-zinc-400">
          Полная инструкция доступа по{" "}
          <Link href="/manual" className="font-medium text-sky-700 dark:text-sky-400 underline hover:text-sky-800 dark:hover:text-sky-300">
            этой ссылке
          </Link>
          .
        </p>
      </section>
    </>
  );
}
