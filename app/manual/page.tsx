import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Легкий способ скачать видео с RuTube бесплатно",
  description:
    "Бесплатный онлайн-загрузчик для скачивания видео с RuTube. Сохраняйте ролики в MP4, MP3, Full HD и 4K без регистрации и программ. Работает на телефонах и ПК.",
  alternates: { canonical: "/manual/" },
  openGraph: {
    title: "Как скачать видео с RuTube — пошаговая инструкция",
    description:
      "Подробная инструкция по скачиванию видео с RuTube: скопируйте ссылку, вставьте её в Save-Tube, выберите качество и скачайте видео.",
  },
};

const STEPS = [
  {
    title: "Шаг 1: Найдите нужное видео",
    text: "Откройте сайт RuTube и скопируйте ссылку на видео, которое хотите скачать.",
  },
  {
    title: "Шаг 2: Вставьте ссылку в Save-Tube",
    text: "Перейдите на наш сайт, вставьте ссылку в специальное поле и нажмите «Конвертировать».",
  },
  {
    title: "Шаг 3: Выберите качество видео",
    text: "После обработки появится список доступных качеств (720p, 1080p и другие). Выберите подходящее качество.",
  },
  {
    title: "Шаг 4: Скачайте видео",
    text: "Нажмите «Скачать», и файл загрузится на ваш компьютер или телефон.",
  },
];

export default function ManualPage() {
  return (
    <section className="py-10 sm:py-14">
      <h1 className="text-3xl font-bold">Как скачать видео с RuTube</h1>
      <p className="mt-4 max-w-2xl text-zinc-600">
        Save-Tube — это удобный онлайн-сервис, который позволяет скачивать видео с RuTube в любом
        качестве. Вам не нужно устанавливать программы — просто вставьте ссылку и скачайте нужное
        видео за несколько секунд.
      </p>

      <ol className="mt-8 space-y-4">
        {STEPS.map((step, i) => (
          <li key={step.title} className="rounded-xl border border-zinc-200 bg-white p-5">
            <h2 className="flex items-center gap-3 text-lg font-semibold">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sky-600 text-sm font-bold text-white">
                {i + 1}
              </span>
              {step.title}
            </h2>
            <p className="mt-2 text-zinc-600">{step.text}</p>
          </li>
        ))}
      </ol>

      <p className="mt-8 text-zinc-600">
        Теперь вы знаете, как легко скачать видео с RuTube!{" "}
        <Link
          href="/download-link/"
          className="font-medium text-sky-700 underline hover:text-sky-800"
        >
          Попробуйте на Save-Tube
        </Link>
        .
      </p>
    </section>
  );
}
