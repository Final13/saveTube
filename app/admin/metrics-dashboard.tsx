"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

interface MetricsData {
  window: string;
  summary: {
    total: number;
    blocked: number;
    forbidden: number;
    errors: number;
    avg_ms: number;
    unique_ips: number;
  };
  timeseries: Array<{
    bucket: number;
    total: number;
    blocked: number;
    forbidden: number;
    errors: number;
    avg_ms: number;
  }>;
  topIps: Array<{ ip: string; total: number; blocked: number; forbidden: number }>;
  suspiciousIps: Array<{ ip: string; total: number; blocked: number; forbidden: number }>;
  routes: Array<{ route: string; total: number; errors: number; avg_ms: number }>;
  live: { streams: Array<{ key: string; count: number }>; uptimeSec: number };
}

const WINDOWS = [
  { key: "15m", label: "15 минут" },
  { key: "1h", label: "Час" },
  { key: "6h", label: "6 часов" },
  { key: "24h", label: "Сутки" },
  { key: "3d", label: "3 дня" },
];

const REFRESH_MS = 30_000;

export default function MetricsDashboard({ email }: { email: string }) {
  const router = useRouter();
  const [windowKey, setWindowKey] = useState("1h");
  const [data, setData] = useState<MetricsData | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async (w: string) => {
    try {
      const response = await fetch(`/api/admin/metrics?window=${w}`, { cache: "no-store" });
      if (!response.ok) {
        setError(response.status === 403 ? "Сессия истекла, войдите снова." : "Ошибка загрузки.");
        return;
      }
      setData((await response.json()) as MetricsData);
      setError("");
    } catch {
      setError("Ошибка сети.");
    }
  }, []);

  useEffect(() => {
    // Первый запрос — через setTimeout, чтобы не дёргать setState прямо в теле эффекта (lint)
    const initial = setTimeout(() => void load(windowKey), 0);
    const timer = setInterval(() => void load(windowKey), REFRESH_MS);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [windowKey, load]);

  async function handleLogout() {
    await fetch("/api/admin/logout", { method: "POST" });
    router.refresh();
  }

  const activeStreams = data?.live.streams.reduce((sum, s) => sum + s.count, 0) ?? 0;

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-slate-200 bg-white p-1">
          {WINDOWS.map((w) => (
            <button
              key={w.key}
              onClick={() => setWindowKey(w.key)}
              className={`rounded-md px-3 py-1.5 text-sm ${
                windowKey === w.key
                  ? "bg-sky-600 font-semibold text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
        <span className="text-xs text-slate-400">обновляется каждые 30 с</span>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-sm text-slate-500">{email}</span>
          <button
            onClick={handleLogout}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
          >
            Выйти
          </button>
        </div>
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {!data && !error && <p className="mt-6 text-sm text-slate-500">Загрузка…</p>}

      {data && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
            <Card label="Запросов" value={String(data.summary.total)} />
            <Card label="Уникальных IP" value={String(data.summary.unique_ips)} />
            <Card
              label="Отклонено (429)"
              value={String(data.summary.blocked)}
              tone={data.summary.blocked > 0 ? "warn" : undefined}
            />
            <Card
              label="Отказы (403)"
              value={String(data.summary.forbidden)}
              tone={data.summary.forbidden > 0 ? "warn" : undefined}
            />
            <Card
              label="Ошибки (5xx)"
              value={String(data.summary.errors)}
              tone={data.summary.errors > 0 ? "bad" : undefined}
            />
            <Card label="Среднее время" value={`${data.summary.avg_ms} мс`} />
            <Card
              label="Стримов сейчас"
              value={String(activeStreams)}
              tone={activeStreams > 0 ? "ok" : undefined}
            />
            <Card label="Аптайм" value={formatUptime(data.live.uptimeSec)} />
          </div>

          <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-700">Нагрузка по времени</h2>
            <Chart series={data.timeseries} windowKey={windowKey} />
            <div className="mt-2 flex gap-4 text-xs text-slate-500">
              <Legend color="#0284c7" label="все запросы" />
              <Legend color="#d97706" label="429 + 403 (лимиты/отказы)" />
              <Legend color="#dc2626" label="5xx (ошибки)" />
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <IpTable
              title="Подозрительные IP (много отказов)"
              rows={data.suspiciousIps}
              highlight
            />
            <IpTable title="Топ IP по запросам" rows={data.topIps} />
          </div>

          <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-700">Роуты</h2>
            <table className="mt-2 w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400">
                  <th className="py-1 pr-4 font-medium">Роут</th>
                  <th className="py-1 pr-4 font-medium">Запросов</th>
                  <th className="py-1 pr-4 font-medium">Ошибки</th>
                  <th className="py-1 font-medium">Среднее время</th>
                </tr>
              </thead>
              <tbody>
                {data.routes.map((r) => (
                  <tr key={r.route} className="border-t border-slate-100 text-slate-700">
                    <td className="py-1.5 pr-4 font-mono text-xs">{r.route}</td>
                    <td className="py-1.5 pr-4">{r.total}</td>
                    <td
                      className={`py-1.5 pr-4 ${r.errors > 0 ? "font-semibold text-red-600" : ""}`}
                    >
                      {r.errors}
                    </td>
                    <td className="py-1.5">{r.avg_ms} мс</td>
                  </tr>
                ))}
                {data.routes.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-3 text-center text-slate-400">
                      Нет данных за выбранный период
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Card({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warn" | "bad" | "ok";
}) {
  const color =
    tone === "bad"
      ? "text-red-600"
      : tone === "warn"
        ? "text-amber-600"
        : tone === "ok"
          ? "text-emerald-600"
          : "text-slate-900";
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <p className="text-xs text-slate-400">{label}</p>
      <p className={`mt-1 text-lg font-bold ${color}`}>{value}</p>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block h-0.5 w-4" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

function IpTable({
  title,
  rows,
  highlight,
}: {
  title: string;
  rows: Array<{ ip: string; total: number; blocked: number; forbidden: number }>;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border bg-white p-4 shadow-sm ${
        highlight ? "border-amber-200" : "border-slate-200"
      }`}
    >
      <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
      <table className="mt-2 w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-400">
            <th className="py-1 pr-4 font-medium">IP</th>
            <th className="py-1 pr-4 font-medium">Запросов</th>
            <th className="py-1 pr-4 font-medium">429</th>
            <th className="py-1 font-medium">403</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.ip} className="border-t border-slate-100 text-slate-700">
              <td className="py-1.5 pr-4 font-mono text-xs">{r.ip}</td>
              <td className="py-1.5 pr-4">{r.total}</td>
              <td className={`py-1.5 pr-4 ${r.blocked > 0 ? "font-semibold text-amber-600" : ""}`}>
                {r.blocked}
              </td>
              <td className={`py-1.5 ${r.forbidden > 0 ? "font-semibold text-red-600" : ""}`}>
                {r.forbidden}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={4} className="py-3 text-center text-slate-400">
                Нет данных за выбранный период
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

const CHART_W = 760;
const CHART_H = 200;
const PAD = { top: 10, right: 10, bottom: 24, left: 40 };

// Простой SVG-график без внешних зависимостей: все запросы, отказы (429+403), ошибки (5xx)
function Chart({ series, windowKey }: { series: MetricsData["timeseries"]; windowKey: string }) {
  if (series.length === 0) {
    return (
      <p className="mt-4 text-center text-sm text-slate-400">Нет данных за выбранный период</p>
    );
  }

  const plotW = CHART_W - PAD.left - PAD.right;
  const plotH = CHART_H - PAD.top - PAD.bottom;
  const maxY = Math.max(1, ...series.map((p) => p.total));
  const minX = series[0].bucket;
  const maxX = series[series.length - 1].bucket;
  const spanX = Math.max(1, maxX - minX);

  const x = (bucket: number) => PAD.left + ((bucket - minX) / spanX) * plotW;
  const y = (value: number) => PAD.top + plotH - (value / maxY) * plotH;

  const line = (pick: (p: MetricsData["timeseries"][number]) => number) =>
    series.map((p) => `${x(p.bucket).toFixed(1)},${y(pick(p)).toFixed(1)}`).join(" ");

  const gridValues = [0.25, 0.5, 0.75, 1].map((f) => Math.round(maxY * f));
  const showDate = windowKey === "24h" || windowKey === "3d";

  return (
    <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="mt-2 w-full">
      {gridValues.map((v) => (
        <g key={v}>
          <line
            x1={PAD.left}
            x2={CHART_W - PAD.right}
            y1={y(v)}
            y2={y(v)}
            stroke="#e2e8f0"
            strokeWidth="1"
          />
          <text x={PAD.left - 6} y={y(v) + 3} textAnchor="end" fontSize="10" fill="#94a3b8">
            {v}
          </text>
        </g>
      ))}
      <text x={PAD.left} y={CHART_H - 6} fontSize="10" fill="#94a3b8">
        {formatTime(minX, showDate)}
      </text>
      <text x={CHART_W - PAD.right} y={CHART_H - 6} textAnchor="end" fontSize="10" fill="#94a3b8">
        {formatTime(maxX, showDate)}
      </text>
      <polyline points={line((p) => p.total)} fill="none" stroke="#0284c7" strokeWidth="2" />
      <polyline
        points={line((p) => p.blocked + p.forbidden)}
        fill="none"
        stroke="#d97706"
        strokeWidth="2"
      />
      <polyline points={line((p) => p.errors)} fill="none" stroke="#dc2626" strokeWidth="2" />
    </svg>
  );
}

function formatTime(ms: number, withDate: boolean): string {
  const date = new Date(ms);
  const time = date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  if (!withDate) return time;
  return `${date.toLocaleDateString("ru-RU", { day: "numeric", month: "numeric" })} ${time}`;
}

function formatUptime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours >= 24) return `${Math.floor(hours / 24)}д ${hours % 24}ч`;
  if (hours > 0) return `${hours}ч ${minutes}м`;
  return `${minutes}м`;
}
