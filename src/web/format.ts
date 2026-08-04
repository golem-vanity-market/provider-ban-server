export function fmtWork(attempts: number | null | undefined): string {
  if (attempts == null || !Number.isFinite(attempts)) return "—";
  if (attempts >= 1e12) return `${(attempts / 1e12).toFixed(2)} TH`;
  if (attempts >= 1e9) return `${(attempts / 1e9).toFixed(2)} GH`;
  if (attempts >= 1e6) return `${(attempts / 1e6).toFixed(2)} MH`;
  if (attempts >= 1e3) return `${(attempts / 1e3).toFixed(1)} kH`;
  return `${Math.round(attempts)} H`;
}

export function fmtSpeed(hps: number | null | undefined): string {
  if (hps == null || !Number.isFinite(hps) || hps <= 0) return "—";
  if (hps >= 1e9) return `${(hps / 1e9).toFixed(2)} GH/s`;
  if (hps >= 1e6) return `${(hps / 1e6).toFixed(2)} MH/s`;
  if (hps >= 1e3) return `${(hps / 1e3).toFixed(1)} kH/s`;
  return `${Math.round(hps)} H/s`;
}

export function fmtGlm(v: number | null | undefined, digits = 3): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (v !== 0 && Math.abs(v) < 0.001) return `${v.toExponential(1)} GLM`;
  return `${v.toFixed(digits)} GLM`;
}

export function fmtEff(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(3)} TH/GLM`;
}

export function fmtHours(h: number | null | undefined): string {
  if (h == null || !Number.isFinite(h)) return "—";
  if (h >= 48) return `${(h / 24).toFixed(1)} d`;
  if (h >= 1) return `${h.toFixed(1)} h`;
  return `${Math.round(h * 60)} min`;
}

export function fmtAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  if (ms < 0) return "now";
  const mins = ms / 60_000;
  if (mins < 1) return "just now";
  if (mins < 60) return `${Math.round(mins)}m ago`;
  const hours = mins / 60;
  if (hours < 48) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function fmtIn(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.parse(iso) - Date.now();
  if (!Number.isFinite(ms)) return "—";
  if (ms <= 0) return "expired";
  const mins = ms / 60_000;
  if (mins < 60) return `in ${Math.round(mins)}m`;
  return `in ${(mins / 60).toFixed(1)}h`;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function shortId(id: string): string {
  if (id.length <= 14) return id;
  return `${id.slice(0, 8)}…${id.slice(-6)}`;
}

export function fmtCompact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}
