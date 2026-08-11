import type { Metadata } from "next";
import { SUPPORT_EMAIL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Контакты",
  description:
    "Контакты Save-Tube.ru: почта поддержки и реквизиты. Пишите — ответим на вопросы о работе сервиса, подписке и оплате.",
  alternates: { canonical: "/contacts" },
};

export default function ContactsPage() {
  return (
    <article className="prose-savetube py-10">
      <h1>Контакты</h1>
      <p>
        По всем вопросам — о работе сервиса, подписке, оплате или сотрудничестве — пишите на почту
        поддержки. Отвечаем, как правило, в течение суток.
      </p>
      <p>
        <a
          href={`mailto:${SUPPORT_EMAIL}`}
          className="text-lg font-medium text-sky-700 dark:text-sky-400 underline hover:text-sky-800 dark:hover:text-sky-300"
        >
          {SUPPORT_EMAIL}
        </a>
      </p>
    </article>
  );
}
