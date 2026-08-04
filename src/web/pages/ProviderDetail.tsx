import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api.ts";
import type { ProviderDetail as Detail } from "../../shared/types.ts";
import CategoryBadge from "../components/CategoryBadge.tsx";
import StatTile from "../components/StatTile.tsx";
import { ColumnChart, HBarList } from "../components/Charts.tsx";
import {
  fmtAgo,
  fmtCompact,
  fmtDate,
  fmtEff,
  fmtGlm,
  fmtHours,
  fmtIn,
  fmtSpeed,
  fmtWork,
  shortId,
} from "../format.ts";

const BREAKDOWN_LABELS: { key: keyof Detail["scoreBreakdown"]; label: string; weight: string }[] = [
  { key: "efficiency", label: "Efficiency vs target", weight: "35%" },
  { key: "reliability", label: "Agreements without ban", weight: "25%" },
  { key: "volume", label: "Delivered volume", weight: "15%" },
  { key: "banRecency", label: "Time since last ban", weight: "15%" },
  { key: "freshness", label: "Recently active", weight: "10%" },
];

export default function ProviderDetail() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [agrLimit, setAgrLimit] = useState(50);

  useEffect(() => {
    if (!id) return;
    let stop = false;
    api
      .provider(id, agrLimit)
      .then((d) => {
        if (!stop) {
          setDetail(d);
          setError(null);
        }
      })
      .catch((e) => !stop && setError(String(e)));
    return () => {
      stop = true;
    };
  }, [id, agrLimit]);

  if (error) {
    return (
      <div className="card p-4 text-sm" style={{ color: "var(--status-critical)" }}>
        ⚠ {error}
      </div>
    );
  }
  if (!detail) {
    return (
      <div className="p-4 text-sm" style={{ color: "var(--text-muted)" }}>
        Loading…
      </div>
    );
  }

  const s = detail.stats;

  return (
    <div className="flex flex-col gap-4">
      <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-semibold">
              {detail.name ?? shortId(detail.providerId)}
            </h2>
            <CategoryBadge category={detail.category} />
          </div>
          <div className="mt-1 text-xs tnum" style={{ color: "var(--text-muted)" }}>
            {detail.providerId}
          </div>
          <div className="mt-2 flex gap-3 text-xs">
            <a
              href={detail.statsGolemUrl}
              target="_blank"
              rel="noreferrer"
              className="ext-link"
            >
              stats.golem.network ↗
            </a>
            <Link to="/providers" className="ext-link">
              ← all providers
            </Link>
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs" style={{ color: "var(--text-muted)" }}>
            Provider score
          </div>
          <div className="text-4xl font-semibold">{detail.score.toFixed(1)}</div>
          <div className="text-xs" style={{ color: "var(--text-secondary)" }}>
            of 100
          </div>
        </div>
      </div>

      {s.activeBan && (
        <div
          className="card p-3 text-sm"
          style={{
            borderColor: "color-mix(in oklab, var(--status-critical) 45%, transparent)",
            color: "var(--status-critical)",
          }}
        >
          ✕ Currently banned fleet-wide — by {s.activeBan.source}, expires{" "}
          {fmtIn(s.activeBan.expiresAt)}
          {s.activeBan.reason && (
            <span style={{ color: "var(--text-secondary)" }}> — {s.activeBan.reason}</span>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Agreements" value={fmtCompact(s.agreements)} sub={`${s.agreements24h} in 24h`} />
        <StatTile label="Total work" value={fmtWork(s.totalWork)} sub={`${fmtWork(s.totalWork24h)} in 24h`} />
        <StatTile label="Rented time" value={fmtHours(s.totalHours)} sub={`${fmtHours(s.totalHours24h)} in 24h`} />
        <StatTile label="Total spend" value={fmtGlm(s.totalCost, 2)} sub={`${fmtGlm(s.totalCost24h, 2)} in 24h`} />
        <StatTile label="Efficiency" value={fmtEff(s.efficiency)} sub={`avg speed ${fmtSpeed(s.avgSpeed)}`} />
        <StatTile
          label="Bans"
          value={
            <span style={{ color: s.bansTotal > 0 ? "var(--status-critical)" : undefined }}>
              {s.bansTotal}
            </span>
          }
          sub={s.lastBanAt ? `last ${fmtAgo(s.lastBanAt)}` : "never banned"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-4">
          <h3 className="mb-3 text-sm font-semibold">Score breakdown</h3>
          <HBarList
            rows={BREAKDOWN_LABELS.map((b) => ({
              label: (
                <span>
                  {b.label}{" "}
                  <span style={{ color: "var(--text-muted)" }}>({b.weight})</span>
                </span>
              ),
              value: detail.scoreBreakdown[b.key],
              display: (detail.scoreBreakdown[b.key] * 100).toFixed(0) + "%",
            }))}
          />
          <div className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
            First seen {fmtAgo(s.firstSeen)} · last seen {fmtAgo(s.lastSeen)}
          </div>
        </div>

        <div className="card p-4">
          <ColumnChart
            title="Work delivered per day (last 14 days)"
            data={detail.daily.map((d) => ({
              label: d.day,
              value: d.work,
              detail: `${d.agreements} agreements · ${fmtGlm(d.cost, 2)} · ${fmtHours(d.hours)}`,
            }))}
            valueFmt={fmtWork}
          />
        </div>
      </div>

      {detail.bans.length > 0 && (
        <div className="card p-4">
          <h3 className="mb-3 text-sm font-semibold">Ban history</h3>
          <div className="overflow-x-auto">
            <table className="data w-full">
              <thead>
                <tr>
                  <th>Banned</th>
                  <th>Source</th>
                  <th>Reason</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {detail.bans.map((b) => (
                  <tr key={b.id}>
                    <td>{fmtDate(b.bannedAt)}</td>
                    <td>{b.source}</td>
                    <td style={{ color: "var(--text-secondary)" }}>{b.reason ?? "—"}</td>
                    <td>
                      {b.active ? (
                        <span style={{ color: "var(--status-critical)" }}>
                          ✕ active, expires {fmtIn(b.expiresAt)}
                        </span>
                      ) : b.revokedAt ? (
                        "revoked"
                      ) : (
                        "expired"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card p-4">
        <h3 className="mb-3 text-sm font-semibold">
          Agreements ({detail.agreementsTotal})
        </h3>
        <div className="overflow-x-auto">
          <table className="data w-full">
            <thead>
              <tr>
                <th>Agreement</th>
                <th>Node</th>
                <th>Last active</th>
                <th>Duration</th>
                <th>Work</th>
                <th>Cost</th>
                <th>Price (GLM/h)</th>
                <th>Efficiency</th>
                <th>Speed</th>
              </tr>
            </thead>
            <tbody>
              {detail.agreements.map((a) => (
                <tr key={a.agreementId}>
                  <td className="tnum" title={a.agreementId}>
                    {shortId(a.agreementId)}
                  </td>
                  <td>{a.node ?? "—"}</td>
                  <td>{fmtDate(a.lastUpdated)}</td>
                  <td className="tnum">{fmtHours(a.durationHours)}</td>
                  <td className="tnum">{fmtWork(a.work)}</td>
                  <td className="tnum">{fmtGlm(a.cost)}</td>
                  <td className="tnum">
                    {a.costPerHour != null ? a.costPerHour.toFixed(3) : "—"}
                  </td>
                  <td className="tnum">{fmtEff(a.efficiency)}</td>
                  <td className="tnum">{fmtSpeed(a.speed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {detail.agreementsTotal > detail.agreements.length && (
          <button
            type="button"
            onClick={() => setAgrLimit((l) => l + 100)}
            className="card mx-auto mt-3 block px-4 py-1.5 text-sm"
          >
            Show more ({detail.agreements.length} / {detail.agreementsTotal})
          </button>
        )}
      </div>
    </div>
  );
}
