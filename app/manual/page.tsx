import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Легкий способ скачать видео с RuTube бесплатно",
  description:
    "Бесплатный онлайн-загрузчик для скачивания видео с RuTube. Сохраняйте ролики в MP4, MP3, Full HD и 4K без регистрации и программ. Работает на телефонах и ПК.",
  alternates: { canonical: "/manual" },
  openGraph: {
    title: "Как скачать видео с RuTube — пошаговая инструкция",
    description:
      "Подробная инструкция по скачиванию видео с RuTube: скопируйте ссылку, вставьте её в Save-Tube, выберите качество и скачайте видео.",
  },
};

const LINK_CLASS =
  "font-medium text-sky-700 dark:text-sky-400 underline hover:text-sky-800 dark:hover:text-sky-300";

// Контент — 1:1 как на оригинальном save-tube.ru/manual (включая видеоинструкцию),
// оформление — текущее (карточки шагов). Ссылки оригинала на save-tube.ru — внутренние («/»).
const STEPS = [
  {
    title: "Шаг 1: Найдите нужное видео",
    text: (
      <>
        Откройте сайт{" "}
        <a href="https://rutube.ru/" target="_blank" rel="noopener" className={LINK_CLASS}>
          RuTube
        </a>{" "}
        и скопируйте ссылку на видео, которое хотите скачать.
      </>
    ),
  },
  {
    title: (
      <>
        Шаг 2: Вставьте ссылку в{" "}
        <Link href="/" className={LINK_CLASS}>
          Save-Tube.ru
        </Link>
      </>
    ),
    text: (
      <>
        Перейдите на наш сайт, вставьте ссылку в специальное поле и нажмите{" "}
        <strong>«Конвертировать»</strong>.
      </>
    ),
  },
  {
    title: "Шаг 3: Выберите качество видео",
    text: "После обработки появится список доступных качеств (720p, 1080p и другие). Выберите подходящее качество.",
  },
  {
    title: "Шаг 4: Скачайте видео",
    text: (
      <>
        Нажмите <strong>«Скачать»</strong>, и файл загрузится на ваш компьютер или телефон.
      </>
    ),
  },
];

export default function ManualPage() {
  return (
    <section className="py-10 sm:py-14">
      <h1 className="text-3xl font-bold">Как скачать видео с RuTube бесплатно</h1>
      <p className="mt-4 max-w-2xl text-zinc-600 dark:text-zinc-400">
        Save-Tube.ru — это удобный онлайн-сервис, который позволяет скачивать видео с RuTube в
        любом качестве. Вам не нужно устанавливать программы — просто вставьте ссылку и скачайте
        нужное видео за несколько секунд.
      </p>

      <ol className="mt-8 space-y-4">
        {STEPS.map((step, i) => (
          <li
            key={i}
            className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5"
          >
            <h2 className="flex items-center gap-3 text-lg font-semibold">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sky-600 text-sm font-bold text-white">
                {i + 1}
              </span>
              {step.title}
            </h2>
            <p className="mt-2 text-zinc-600 dark:text-zinc-400">{step.text}</p>
          </li>
        ))}
      </ol>

      <div className="mt-8 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
        <h2 className="text-lg font-semibold">Видеоинструкция: Как скачать видео с RuTube</h2>
        <div className="relative mt-4 aspect-video w-full max-w-[720px] overflow-hidden rounded-lg">
          <iframe
            src="https://rutube.ru/play/embed/98b353633842aa8c68992d81c93e8595"
            title="Видеоинструкция: Как скачать видео с RuTube"
            loading="lazy"
            allowFullScreen
            className="absolute inset-0 size-full border-0"
          />
        </div>
        <p className="mt-4 text-zinc-600 dark:text-zinc-400">
          В этом видео подробно показано, как быстро скачать видео с RuTube.
        </p>
      </div>

      <p className="mt-8 text-zinc-600 dark:text-zinc-400">
        Теперь вы знаете, как легко скачать видео с RuTube! Попробуйте на{" "}
        <Link href="/" className={LINK_CLASS}>
          Save-Tube.ru
        </Link>
        .
      </p>
    </section>
  );
}
