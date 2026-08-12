"use client";

import Script from "next/script";
import { ymId } from "@/lib/metrika";

// Яндекс.Метрика — сниппет 1:1 с оригинального сайта (ya.html), id счётчика из env.
// lazyOnload — не блокирует загрузку; стаб-очередь ym.a в lib/metrika.ts ловит ранние цели.
export default function Metrika() {
  if (!ymId) return null;
  return (
    <>
      <Script id="yandex-metrika" strategy="lazyOnload">
        {`
          (function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
          m[i].l=1*new Date();for (var j = 0; j < document.scripts.length; j++) {if (document.scripts[j].src === r) { return; }}
          k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})
          (window, document,'script','https://mc.yandex.ru/metrika/tag.js', 'ym');
          ym(${Number(ymId)}, 'init', {webvisor:true, clickmap:true, referrer: document.referrer, url: location.href, accurateTrackBounce:true, trackLinks:true});
        `}
      </Script>
      <noscript>
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element -- пиксель метрики */}
          <img
            src={`https://mc.yandex.ru/watch/${Number(ymId)}`}
            className="absolute -left-[9999px]"
            alt=""
          />
        </div>
      </noscript>
    </>
  );
}
