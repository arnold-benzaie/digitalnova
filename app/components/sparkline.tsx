import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";

const WIDTH = 96;
const HEIGHT = 28;

/**
 * Static trend sparkline for a stat tile — single series, so no legend or
 * hover per the stat-tile contract (dataviz skill: marks-and-anatomy.md).
 */
export function Sparkline({ data, color, locale }: { data: number[]; color: string; locale: Locale }) {
  if (data.length < 2) return null;
  const t = dictionaries[locale].dashboard.chart;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const points = data.map((value, index) => {
    const x = (index / (data.length - 1)) * WIDTH;
    const y = HEIGHT - ((value - min) / range) * HEIGHT;
    return [x, y] as const;
  });

  const path = points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [lastX, lastY] = points[points.length - 1];

  return (
    <svg
      width={WIDTH}
      height={HEIGHT}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="mt-2"
      role="img"
      aria-label={t.trendAriaLabel(data.length)}
    >
      <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lastX} cy={lastY} r={2.5} fill={color} />
    </svg>
  );
}
