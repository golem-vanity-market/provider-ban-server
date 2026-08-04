import { useState } from "react";

// Marks follow the dataviz specs: bars ≤24px, 4px rounded data-end square at
// the baseline, 2px surface gaps, hairline solid grid, selective labels,
// per-mark hover tooltip (values also available in the table view).

interface Point {
  label: string;
  value: number;
  detail?: string;
}

function roundedTopRect(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): string {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`;
}

function niceTicks(max: number): number[] {
  if (max <= 0) return [0];
  const raw = max / 2;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag;
  return [0, step, step * 2].filter((t) => t <= max * 1.35);
}

export function ColumnChart({
  data,
  valueFmt,
  title,
}: {
  data: Point[];
  valueFmt: (v: number) => string;
  title: string;
}) {
  const [tip, setTip] = useState<{
    x: number;
    y: number;
    label: string;
    value: string;
    detail?: string;
  } | null>(null);
  const [showTable, setShowTable] = useState(false);
  const [hovered, setHovered] = useState<number | null>(null);

  const W = 560;
  const plotH = 120;
  const axisBand = 18;
  const leftPad = 8;
  const rightPad = 8;
  const topPad = 14;
  const H = topPad + plotH + axisBand;
  const max = Math.max(...data.map((d) => d.value), 0);
  const ticks = niceTicks(max);
  const tickMax = Math.max(max, ticks[ticks.length - 1] ?? 0, 1);
  const innerW = W - leftPad - rightPad;
  const n = data.length;
  const slot = n > 0 ? innerW / n : innerW;
  const barW = Math.min(24, Math.max(4, slot - 2)); // 2px surface gap minimum
  const maxIdx = data.findIndex((d) => d.value === max);

  if (data.length === 0) {
    return (
      <div className="text-sm" style={{ color: "var(--text-muted)" }}>
        No data yet.
      </div>
    );
  }

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <div
          className="text-xs font-medium"
          style={{ color: "var(--text-secondary)" }}
        >
          {title}
        </div>
        <button
          type="button"
          onClick={() => setShowTable((s) => !s)}
          className="rounded px-1.5 py-0.5 text-xs"
          style={{ color: "var(--text-muted)", border: "1px solid var(--grid)" }}
        >
          {showTable ? "Chart" : "Table"}
        </button>
      </div>
      {showTable ? (
        <div className="max-h-48 overflow-auto">
          <table className="data w-full">
            <thead>
              <tr>
                <th>Day</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.label}>
                  <td>{d.label}</td>
                  <td className="tnum">{valueFmt(d.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          role="img"
          aria-label={title}
          onMouseLeave={() => {
            setTip(null);
            setHovered(null);
          }}
        >
          {ticks.map((t) => {
            const y = topPad + plotH - (t / tickMax) * plotH;
            return (
              <g key={t}>
                <line
                  x1={leftPad}
                  x2={W - rightPad}
                  y1={y}
                  y2={y}
                  stroke="var(--grid)"
                  strokeWidth={1}
                />
                <text
                  x={leftPad + 2}
                  y={y - 3}
                  fontSize={9}
                  fill="var(--text-muted)"
                  className="tnum"
                >
                  {t > 0 ? valueFmt(t) : ""}
                </text>
              </g>
            );
          })}
          <line
            x1={leftPad}
            x2={W - rightPad}
            y1={topPad + plotH}
            y2={topPad + plotH}
            stroke="var(--baseline)"
            strokeWidth={1}
          />
          {data.map((d, i) => {
            const h = tickMax > 0 ? (d.value / tickMax) * plotH : 0;
            const x = leftPad + i * slot + (slot - barW) / 2;
            const y = topPad + plotH - h;
            return (
              <g key={d.label}>
                <path
                  d={roundedTopRect(x, y, barW, Math.max(h, 0.5), 4)}
                  fill="var(--series-1)"
                  opacity={hovered === null || hovered === i ? 1 : 0.55}
                />
                {i === maxIdx && d.value > 0 && (
                  <text
                    x={x + barW / 2}
                    y={y - 4}
                    fontSize={9}
                    textAnchor="middle"
                    fill="var(--text-secondary)"
                    className="tnum"
                  >
                    {valueFmt(d.value)}
                  </text>
                )}
                {(n <= 16 || i % Math.ceil(n / 16) === 0) && (
                  <text
                    x={x + barW / 2}
                    y={topPad + plotH + 12}
                    fontSize={8.5}
                    textAnchor="middle"
                    fill="var(--text-muted)"
                  >
                    {d.label.slice(5)}
                  </text>
                )}
                {/* hit target wider than the mark */}
                <rect
                  x={leftPad + i * slot}
                  y={topPad}
                  width={slot}
                  height={plotH}
                  fill="transparent"
                  onMouseMove={(e) => {
                    setHovered(i);
                    setTip({
                      x: e.clientX,
                      y: e.clientY,
                      label: d.label,
                      value: valueFmt(d.value),
                      detail: d.detail,
                    });
                  }}
                />
              </g>
            );
          })}
        </svg>
      )}
      {tip && !showTable && (
        <div
          className="viz-tooltip"
          style={{ left: tip.x + 12, top: tip.y + 12 }}
        >
          <div className="font-semibold tnum">{tip.value}</div>
          <div style={{ color: "var(--text-secondary)" }}>{tip.label}</div>
          {tip.detail && (
            <div style={{ color: "var(--text-muted)" }}>{tip.detail}</div>
          )}
        </div>
      )}
    </div>
  );
}

export function HBarList({
  rows,
}: {
  rows: { label: React.ReactNode; value: number; display: string }[];
}) {
  const max = Math.max(...rows.map((r) => r.value), 0.0001);
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="w-36 shrink-0 text-xs">{r.label}</div>
          <div className="h-3.5 grow">
            <div
              className="h-full"
              style={{
                width: `${(r.value / max) * 100}%`,
                minWidth: r.value > 0 ? 3 : 0,
                background: "var(--series-1)",
                borderRadius: "0 4px 4px 0",
              }}
            />
          </div>
          <div className="w-16 shrink-0 text-right text-xs tnum">
            {r.display}
          </div>
        </div>
      ))}
    </div>
  );
}
