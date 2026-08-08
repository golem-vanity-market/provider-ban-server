import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.ts";
import type {
  BanRow,
  FleetSummary,
  ProviderCategory,
} from "../../shared/types.ts";
import StatTile from "../components/StatTile.tsx";
import CategoryBadge from "../components/CategoryBadge.tsx";
import WindowPicker from "../components/WindowPicker.tsx";
import { HBarList } from "../components/Charts.tsx";
import {
  fmtAgo,
  fmtCompact,
  fmtGlm,
  fmtIn,
  fmtWork,
  shortId,
} from "../format.ts";
import { WINDOW_LABELS, useWindowKey } from "../window.ts";

const CATEGORY_ORDER: ProviderCategory[] = [
  "trusted",
  "reliable",
  "average",
  "underperformer",
  "new",
  "risky",
  "banned",
];

export default function Dashboard() {
  const [summary, setSummary] = useState<FleetSummary | null>(null);
  const [recentBans, setRecentBans] = useState<BanRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const windowKey = useWindowKey();

  useEffect(() => {
    let stop = false;
    const load = () => {
      api
        .summary()
        .then((s) => {
          if (!stop) {
            setSummary(s);
            setError(null);
          }
        })
        .catch((e) => !stop && setError(String(e)));
      api
        .banHistory(8)
        .then((r) => !stop && setRecentBans(r.bans))
        .catch(() => {});
    };
    load();
    const t = setInterval(load, 30_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);

  if (error && !summary) {
    return (
      <div
        className="card p-4 text-sm"
        style={{ color: "var(--status-critical)" }}
      >
        ⚠ Failed to load summary: {error}
      </div>
    );
  }
  if (!summary) {
    return (
      <div className="p-4 text-sm" style={{ color: "var(--text-muted)" }}>
        Loading…
      </div>
    );
  }

  const w = summary.windows[windowKey];
  const wLabel = WINDOW_LABELS[windowKey].toLowerCase();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <WindowPicker />
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          stats below are scoped to the selected window
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile
          label="Active fleet-wide bans"
          value={
            <span
              style={{
                color:
                  summary.activeBans > 0 ? "var(--status-critical)" : undefined,
              }}
            >
              {summary.activeBans}
            </span>
          }
          sub={`live · escalating 1h+ bans (max ${summary.banMaxHours}h)`}
        />
        <StatTile
          label={`Providers (${wLabel})`}
          value={w.providersActive}
          sub={`${summary.providersTotal} known all-time`}
        />
        <StatTile
          label={`Agreements (${wLabel})`}
          value={fmtCompact(w.agreements)}
          sub={`${fmtCompact(summary.windows.all.agreements)} all-time`}
        />
        <StatTile
          label={`Work (${wLabel})`}
          value={fmtWork(w.work)}
          sub={`${w.hours.toFixed(0)} rented hours`}
        />
        <StatTile
          label={`Spend (${wLabel})`}
          value={fmtGlm(w.cost, 2)}
          sub={`${fmtGlm(summary.windows.all.cost, 0)} all-time`}
        />
        <StatTile
          label={`Bans issued (${wLabel})`}
          value={
            <span
              style={{ color: w.bans > 0 ? "var(--status-critical)" : undefined }}
            >
              {w.bans}
            </span>
          }
          sub={`${summary.windows.all.bans} all-time`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-4">
          <h2 className="mb-3 text-sm font-semibold">Providers by category</h2>
          <HBarList
            rows={CATEGORY_ORDER.map((cat) => ({
              label: <CategoryBadge category={cat} />,
              value: summary.categories[cat] ?? 0,
              display: String(summary.categories[cat] ?? 0),
            }))}
          />
        </div>

        <div className="card p-4">
          <h2 className="mb-3 text-sm font-semibold">Requestor nodes (live)</h2>
          <table className="data w-full">
            <thead>
              <tr>
                <th>Node</th>
                <th>Status</th>
                <th>Active agreements</th>
                <th>Bans reported</th>
              </tr>
            </thead>
            <tbody>
              {summary.nodes.map((n) => (
                <tr key={n.node}>
                  <td className="font-medium">{n.node}</td>
                  <td>
                    {n.ok ? (
                      <span style={{ color: "var(--status-good)" }}>✓ ok</span>
                    ) : (
                      <span style={{ color: "var(--status-critical)" }}>
                        ✕ {n.lastError ?? "unreachable"}
                      </span>
                    )}
                  </td>
                  <td className="tnum">{n.activeEstimators}</td>
                  <td className="tnum">{n.bannedReported}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
            Last collection: {fmtAgo(summary.collectedAt)}
          </div>
        </div>
      </div>

      <div className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Recent bans</h2>
          <Link to="/bans" className="ext-link text-xs">
            View all →
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="data w-full">
            <thead>
              <tr>
                <th>Provider</th>
                <th>Source</th>
                <th>Reason</th>
                <th>Banned</th>
                <th>Expires</th>
              </tr>
            </thead>
            <tbody>
              {recentBans.map((b) => (
                <tr key={b.id}>
                  <td>
                    <Link to={`/providers/${b.providerId}`} className="ext-link">
                      {b.providerName ?? shortId(b.providerId)}
                    </Link>
                  </td>
                  <td>{b.source}</td>
                  <td
                    className="max-w-64 truncate"
                    style={{ color: "var(--text-secondary)" }}
                    title={b.reason ?? undefined}
                  >
                    {b.reason ?? "—"}
                  </td>
                  <td>{fmtAgo(b.bannedAt)}</td>
                  <td>
                    {b.active
                      ? fmtIn(b.expiresAt)
                      : b.revokedAt
                        ? "revoked"
                        : "expired"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
