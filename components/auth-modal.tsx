"use client";

import { User, X } from "lucide-react";
import AuthForm from "@/components/auth-form";

// Модалка входа в ЛК (форма по одноразовому коду). Открывается из шапки («Войти»).
// После успешного входа — onSuccess (шапка делает router.refresh, чтобы перейти
// в состояние «Кабинет» без перезагрузки страницы).
export default function AuthModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-md space-y-4 rounded-xl bg-white p-6 shadow-xl dark:bg-zinc-900">
        <div className="flex items-start justify-between">
          <p className="flex items-center gap-2 text-lg font-semibold">
            <User className="size-5 text-sky-600 dark:text-sky-400" /> Личный кабинет
          </p>
          <button onClick={onClose} aria-label="Закрыть">
            <X className="size-5 text-zinc-400 dark:text-zinc-500 transition hover:text-zinc-700" />
          </button>
        </div>
        <AuthForm
          onSuccess={async () => {
            onClose();
            onSuccess();
          }}
        />
      </div>
    </div>
  );
}
