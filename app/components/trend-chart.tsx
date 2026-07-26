"use client";

import { useMemo, useState } from "react";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { formatDate as formatDateIntl, formatNumber } from "@/lib/i18n/format";

const WIDTH = 640;
const HEIGHT = 220;
const PADDING = { top: 16, right: 16, bottom: 28, left: 40 };
const COLOR = "#3b6fd1"; // validated categorical blue — see dataviz palette check
const SURFACE = "#ffffff";

function niceMax(value: number): number {
  if (value <= 0) return 10;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

export function TrendChart({ data, label, locale }: { data: { date: string; value: number }[]; label: string; locale: Locale }) {
  const t = dictionaries[locale].dashboard.chart;
  const formatDate = (iso: string) => formatDateIntl(iso, locale, { day: "numeric", month: "short" });
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const { path, points, yTicks, maxValue } = useMemo(() => {
    const plotWidth = WIDTH - PADDING.left - PADDING.right;
    const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;
    const max = niceMax(Math.max(...data.map((d) => d.value), 1));

    const pts = data.map((d, index) => {
      const x = PADDING.left + (data.length === 1 ? 0 : (index / (data.length - 1)) * plotWidth);
      const y = PADDING.top + plotHeight - (d.value / max) * plotHeight;
      return { x, y, ...d };
    });

    const linePath = pts.map((p, index) => `${index === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
    const ticks = [0, 0.5, 1].map((fraction) => ({
      value: Math.round(max * fraction),
      y: PADDING.top + plotHeight - fraction * plotHeight,
    }));

    return { path: linePath, points: pts, yTicks: ticks, maxValue: max };
  }, [data]);

  const hovered = hoverIndex !== null ? points[hoverIndex] : null;

  function handlePointerMove(event: React.PointerEvent<SVGSVGElement>) {
    const svg = event.currentTarget;
    const rect = svg.getBoundingClientRect();
    const relativeX = ((event.clientX - rect.left) / rect.width) * WIDTH;
    let closest = 0;
    let closestDistance = Infinity;
    points.forEach((p, index) => {
      const distance = Math.abs(p.x - relativeX);
      if (distance < closestDistance) {
        closestDistance = distance;
        closest = index;
      }
    });
    setHoverIndex(closest);
  }

  return (
    <div className="rounded-2xl border border-pm-gris-2 bg-white p-5">
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COLOR }} />
        <p className="text-sm font-medium text-pm-noir">{label}</p>
      </div>

      <svg
        width="100%"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={t.evolutionAriaLabel(label)}
        className="mt-3 touch-none"
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setHoverIndex(null)}
      >
        {yTicks.map((tick) => (
          <g key={tick.value}>
            <line
              x1={PADDING.left}
              x2={WIDTH - PADDING.right}
              y1={tick.y}
              y2={tick.y}
              stroke="var(--pm-gris-2)"
              strokeWidth={1}
            />
            <text x={PADDING.left - 8} y={tick.y} textAnchor="end" dominantBaseline="middle" className="fill-pm-gris text-[10px]">
              {formatNumber(tick.value, locale)}
            </text>
          </g>
        ))}

        <path d={path} fill="none" stroke={COLOR} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

        {points.length > 0 && (
          <>
            <circle
              cx={points[points.length - 1].x}
              cy={points[points.length - 1].y}
              r={4}
              fill={COLOR}
              stroke={SURFACE}
              strokeWidth={2}
            />
            <text
              x={points[points.length - 1].x}
              y={points[points.length - 1].y - 10}
              textAnchor="end"
              className="fill-pm-noir text-[11px] font-medium"
            >
              {formatNumber(points[points.length - 1].value, locale)}
            </text>
          </>
        )}

        {hovered && (
          <>
            <line
              x1={hovered.x}
              x2={hovered.x}
              y1={PADDING.top}
              y2={HEIGHT - PADDING.bottom}
              stroke="var(--pm-gris)"
              strokeWidth={1}
              strokeDasharray="3,3"
            />
            <circle cx={hovered.x} cy={hovered.y} r={4} fill={COLOR} stroke={SURFACE} strokeWidth={2} />
          </>
        )}
      </svg>

      {hovered ? (
        <p className="mt-1 text-xs text-pm-gris">
          {formatDate(hovered.date)} ·{" "}
          <span className="font-medium text-pm-noir">{formatNumber(hovered.value, locale)}</span>
        </p>
      ) : (
        <p className="mt-1 text-xs text-pm-gris">{t.hoverHint}</p>
      )}

      <details className="mt-3">
        <summary className="cursor-pointer text-xs text-pm-gris hover:text-pm-noir">{t.viewAsTable}</summary>
        <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-pm-gris-2">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-pm-gris-2/30 text-pm-gris">
              <tr>
                <th className="px-3 py-2">{t.dateColumn}</th>
                <th className="px-3 py-2">{label}</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.date} className="border-t border-pm-gris-2">
                  <td className="px-3 py-1.5 text-pm-gris">{formatDate(d.date)}</td>
                  <td className="px-3 py-1.5 text-pm-noir">{formatNumber(d.value, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <p className="sr-only">{t.maxValueSr(maxValue)}</p>
    </div>
  );
}
