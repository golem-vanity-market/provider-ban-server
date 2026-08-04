import type { WindowKey } from "../../shared/types.ts";
import { WINDOW_LABELS, setWindowKey, useWindowKey } from "../window.ts";

const ORDER: WindowKey[] = ["d1", "d7", "d30", "all"];

export default function WindowPicker() {
  const selected = useWindowKey();
  return (
    <div
      className="inline-flex items-center gap-0.5 rounded-lg p-0.5"
      style={{ border: "1px solid var(--grid)", background: "var(--surface-1)" }}
      role="radiogroup"
      aria-label="History window"
    >
      {ORDER.map((w) => (
        <button
          key={w}
          type="button"
          role="radio"
          aria-checked={selected === w}
          onClick={() => setWindowKey(w)}
          className="rounded-md px-2.5 py-1 text-xs font-medium"
          style={
            selected === w
              ? {
                  background:
                    "color-mix(in oklab, var(--series-1) 14%, transparent)",
                  color: "var(--series-1)",
                }
              : { color: "var(--text-secondary)" }
          }
        >
          {selected === w ? "✓ " : ""}
          {WINDOW_LABELS[w]}
        </button>
      ))}
    </div>
  );
}
