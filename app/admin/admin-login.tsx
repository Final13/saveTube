"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// Форма входа в админку: email из ADMIN_EMAILS + ключ доступа (ADMIN_KEY).
export default function AdminLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, key }),
      });
      const data = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) {
        setError(data.message ?? "Ошибка входа, попробуйте позже.");
        return;
      }
      router.refresh();
    } catch {
      setError("Ошибка сети, попробуйте позже.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-6 max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
    >
      <p className="text-sm text-slate-600">
        Доступ только для администратора. Укажите E-Mail и ключ доступа.
      </p>
      <label className="mt-4 block text-sm font-medium text-slate-700">
        E-Mail
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500"
          placeholder="admin@example.com"
        />
      </label>
      <label className="mt-3 block text-sm font-medium text-slate-700">
        Ключ доступа
        <input
          type="password"
          required
          value={key}
          onChange={(e) => setKey(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500"
          placeholder="••••••••"
        />
      </label>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={loading}
        className="mt-4 w-full rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
      >
        {loading ? "Вход…" : "Войти"}
      </button>
    </form>
  );
}
