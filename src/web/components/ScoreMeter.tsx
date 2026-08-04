// Meter: series-blue fill on a lighter step of the same ramp (never gray).
export default function ScoreMeter({
  score,
  width = 72,
}: {
  score: number;
  width?: number;
}) {
  const pct = Math.max(0, Math.min(100, score));
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className="inline-block h-1.5 overflow-hidden rounded-full"
        style={{ width, background: "var(--series-1-track)" }}
        role="meter"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="provider score"
      >
        <span
          className="block h-full rounded-full"
          style={{ width: `${pct}%`, background: "var(--series-1)" }}
        />
      </span>
      <span className="tnum text-sm font-semibold">{score.toFixed(1)}</span>
    </span>
  );
}
