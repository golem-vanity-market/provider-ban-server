import type { ProviderCategory } from "../../shared/types.ts";

// Status colors always ship with an icon + label - color never carries the
// category alone (dataviz status rule).
const CATEGORY_META: Record<
  ProviderCategory,
  { label: string; icon: string; colorVar: string }
> = {
  banned: { label: "Banned", icon: "✕", colorVar: "--status-critical" },
  risky: {
    label: "Risky",
    icon: "⊘",
    colorVar: "--status-serious",
  },
  underperformer: {
    label: "Underperformer",
    icon: "⚠",
    colorVar: "--status-warning",
  },
  average: { label: "Average", icon: "◐", colorVar: "--text-secondary" },
  reliable: { label: "Reliable", icon: "●", colorVar: "--series-1" },
  trusted: { label: "Trusted", icon: "✓", colorVar: "--status-good" },
  new: { label: "New", icon: "○", colorVar: "--text-muted" },
};

export function categoryLabel(cat: ProviderCategory): string {
  return CATEGORY_META[cat]?.label ?? cat;
}

export default function CategoryBadge({
  category,
}: {
  category: ProviderCategory;
}) {
  const meta = CATEGORY_META[category] ?? CATEGORY_META.new;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
      style={{
        color: `var(${meta.colorVar})`,
        background: `color-mix(in oklab, var(${meta.colorVar}) 12%, transparent)`,
        border: `1px solid color-mix(in oklab, var(${meta.colorVar}) 35%, transparent)`,
      }}
    >
      <span aria-hidden="true">{meta.icon}</span>
      {meta.label}
    </span>
  );
}
