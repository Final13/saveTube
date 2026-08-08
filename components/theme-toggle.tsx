"use client";

import { useEffect, useState } from "react";
import { Moon, Star, Sun } from "lucide-react";
import { useTheme } from "@/lib/theme";

// Свитчер светлой/тёмной темы как на playerok: pill-трек с круглым ползунком,
// внутри ползунка солнце (светлая) или луна с двумя звёздочками (тёмная).
// Выбор — в cookie theme. initialTheme приходит с SSR (layout), поэтому при явной
// куке ползунок и иконка рендерятся сразу в правильной позиции — без дёрганья.
// При system/без куки ползунок появляется после mount уже в конечной позиции.
export default function ThemeToggle({ initialTheme }: { initialTheme?: "light" | "dark" }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 0);
    return () => clearTimeout(timer);
  }, []);

  const dark = mounted ? resolvedTheme === "dark" : initialTheme === "dark";
  const showKnob = mounted || initialTheme !== undefined;
  const toggle = () => setTheme(resolvedTheme === "dark" ? "light" : "dark");

  return (
    <button
      onClick={toggle}
      role="switch"
      aria-checked={dark}
      aria-label="Переключить тему"
      title="Переключить тему"
      className="relative h-6 w-11 shrink-0 cursor-pointer rounded-full bg-slate-200 transition-colors dark:bg-slate-600"
    >
      {showKnob && (
        <span
          className={`absolute top-0.5 left-0.5 flex size-5 items-center justify-center rounded-full bg-white shadow transition-transform duration-200 dark:bg-zinc-900 ${
            dark ? "translate-x-5" : "translate-x-0"
          }`}
        >
          {dark ? (
            // Луна с двумя звёздочками
            <span className="relative block h-3.5 w-4">
              <Moon className="absolute left-0 top-0 size-3.5 text-white" />
              <Star className="absolute right-0 top-0 size-1.5 fill-white text-white" />
              <Star className="absolute bottom-0 right-0.5 size-1 fill-white text-white" />
            </span>
          ) : (
            <Sun className="size-3.5 fill-amber-400 text-amber-400" />
          )}
        </span>
      )}
    </button>
  );
}
