"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Script from "next/script";

// Футер-баннер Яндекс.РСЯ: ротация блоков каждые 30 сек, крестик закрытия через 5 сек,
// скрыт на экранах < 830px. Без NEXT_PUBLIC_RSY_ID не рендерится.
// ВАЖНО: скрытие — только через visibility (invisible), НЕ display:none: Яндекс отказывается
// рендерить в скрытый контейнер (warning CONTAINER_IS_HIDDEN) и баннер не показывается вовсе.
// visibility:hidden не перехватывает клики, так что фантомного перекрытия нет.

const RSY_ID = process.env.NEXT_PUBLIC_RSY_ID;
const CONTAINER_ID = `yandex_rtb_R-A-${RSY_ID}-4`;
const MIN_WIDTH = 830;
const ROTATION_MS = 30_000;
const COUNTDOWN_SECONDS = 5;

declare global {
  interface Window {
    Ya?: {
      Context?: {
        AdvManager?: {
          render: (options: {
            blockId: string;
            renderTo: string;
            onRender?: () => void;
            onError?: (data: { type: string; code: string; text: string }) => void;
          }) => void;
          destroy?: (blockId: string) => void;
        };
      };
    };
    yaContextCb?: unknown[];
  }
}

export default function RsyBanner() {
  const [open, setOpen] = useState(false);
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const blockIndex = useRef(0);
  const lastBlockId = useRef<string | null>(null);
  const adRendered = useRef(false);
  const rotationTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const startCountdown = useCallback(() => {
    if (countdownTimer.current) clearInterval(countdownTimer.current);
    setCountdown(COUNTDOWN_SECONDS);
    let count = COUNTDOWN_SECONDS;
    countdownTimer.current = setInterval(() => {
      count--;
      if (count <= 0 && countdownTimer.current) clearInterval(countdownTimer.current);
      setCountdown(count);
    }, 1000);
  }, []);

  const renderAd = useCallback(() => {
    if (!RSY_ID || !window.Ya?.Context?.AdvManager) return;
    const advManager = window.Ya.Context.AdvManager;
    const blockId = `R-A-${RSY_ID}-${4 + (blockIndex.current % 5)}`;
    blockIndex.current++;
    lastBlockId.current = blockId;

    adRendered.current = false;
    setOpen(false);
    advManager.destroy?.(blockId);
    const container = document.getElementById(CONTAINER_ID);
    if (container) container.innerHTML = "";

    advManager.render({
      blockId,
      renderTo: CONTAINER_ID,
      onRender: () => {
        adRendered.current = true;
        if (window.innerWidth >= MIN_WIDTH) {
          setOpen(true);
          startCountdown();
        }
      },
      onError: () => {},
    });
  }, [startCountdown]);

  // Скрытие/показ при ресайзе
  useEffect(() => {
    if (!RSY_ID) return;
    let resizeTimer: ReturnType<typeof setTimeout>;
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (window.innerWidth < MIN_WIDTH) setOpen(false);
        else if (adRendered.current) setOpen(true);
      }, 250);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      clearTimeout(resizeTimer);
    };
  }, []);

  useEffect(
    () => () => {
      if (rotationTimer.current) clearInterval(rotationTimer.current);
      if (countdownTimer.current) clearInterval(countdownTimer.current);
    },
    [],
  );

  if (!RSY_ID) return null;

  return (
    <>
      <Script
        src="https://yandex.ru/ads/system/context.js"
        strategy="lazyOnload"
        onLoad={() => {
          renderAd();
          rotationTimer.current = setInterval(renderAd, ROTATION_MS);
        }}
      />
      <div
        className={`fixed inset-x-0 bottom-0 z-40 bg-white dark:bg-zinc-900 shadow-[0_-4px_16px_rgba(0,0,0,0.12)] ${
          open ? "visible" : "invisible"
        }`}
      >
        <button
          onClick={() => {
            if (countdown > 0) return;
            setOpen(false);
            // Креативы RTB ставят себе visibility:visible и игнорируют invisible-родителя
            // (прячется только фон) — поэтому блок уничтожаем, контейнер чистим.
            // Ротация продолжает работать: следующий блок отрендерится и покажется заново.
            if (lastBlockId.current) {
              window.Ya?.Context?.AdvManager?.destroy?.(lastBlockId.current);
            }
            const container = document.getElementById(CONTAINER_ID);
            if (container) container.innerHTML = "";
          }}
          aria-label="Закрыть рекламу"
          className={`absolute -top-9 right-2 flex size-8 items-center justify-center rounded-t-lg text-base ${
            countdown > 0
              ? "cursor-default bg-zinc-700 text-zinc-300"
              : "bg-zinc-900 text-white hover:bg-zinc-700"
          }`}
        >
          {countdown > 0 ? countdown : "✕"}
        </button>
        <div id={CONTAINER_ID} className="mx-auto max-w-4xl" />
      </div>
    </>
  );
}
