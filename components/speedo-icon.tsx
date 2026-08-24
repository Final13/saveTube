// Анимированный спидометр: стрелка качается -55° → +55° → назад (2.2с, задержка на пике).
// Кейфрейм и transform-origin — в globals.css (.speedo-needle). Цвет — через currentColor.
export default function SpeedoIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M4.5 17.5a8 8 0 1 1 15 0"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        opacity=".75"
      />
      <line
        className="speedo-needle"
        x1="12"
        y1="16.5"
        x2="12"
        y2="9.5"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <circle cx="12" cy="16.5" r="1.8" fill="currentColor" />
    </svg>
  );
}
