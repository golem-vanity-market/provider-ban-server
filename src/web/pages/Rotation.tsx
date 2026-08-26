import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.ts";
import type { RankingEntry, RankingResponse } from "../../shared/types.ts";
import { fmtIn, shortId } from "../format.ts";

const TIER_COLORS: Record<string, string> = {
  A: "var(--status-ok, #16a34a)",
  B: "var(--series-1)",
  C: "var(--status-warn, #d97706)",
  D: "var(--status-critical)",
  new: "var(--text-muted)",
};

const STATE_LABEL: Record<string, string> = {
  active: "● active",
  resting: "◦ resting",
  eligible: "✓ eligible",
  suspended: "⊘ suspended",
};

const STATE_COLOR: Record<string, string> = {
  active: "var(--series-1)",
  resting: "var(--text-muted)",
  eligible: "var(--status-ok, #16a34a)",
  suspended: "var(--status-critical)",
};

function fmtTtl(min: number): string {
  if (min === 0) return "full shift";
  if (min >= 60) return `${min / 60} h`;
  return `${min} min`;
}

function fmtEff(eff: number | null): string {
  return eff === null ? "—" : eff.toFixed(4);
}

export default function Rotation() {
  const [data, setData] = useState<RankingResponse | null>(null);
  const [stateFilter, setStateFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(200);

  useEffect(() => {
    let stop = false;
    const load = () => {
      api
        .ranking()
        .then((r) => !stop && setData(r))
        .catch(() => {});
    };
    load();
    const t = setInterval(load, 30_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);

  const filtered = useMemo(() => {
    if (!data) return [];
    let list: RankingEntry[] = data.providers;
    if (stateFilter !== "all") {
      list = list.filter((p) => p.state === stateFilter);
    }
    const s = search.trim().toLowerCase();
    if (s) {
      list = list.filter(
        (p) =>
          p.providerId.includes(s) ||
          (p.name ?? "").toLowerCase().includes(s) ||
          (p.wallet ?? "").includes(s),
      );
    }
    return list;
  }, [data, stateFilter, search]);

  if (!data) {
    return (
      <div className="text-sm" style={{ color: "var(--text-muted)" }}>
        Loading ranking…
      </div>
    );
  }

  const chips: [string, number][] = [
    ["all", data.counts.listed],
    ["active", data.counts.active],
    ["eligible", data.counts.eligible],
    ["resting", data.counts.resting],
    ["suspended", data.counts.suspended],
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {chips.map(([st, count]) => (
          <button
            key={st}
            type="button"
            onClick={() => setStateFilter(st)}
            className="rounded-md px-3 py-1.5 text-sm font-medium"
            style={
              stateFilter === st
                ? {
                    background:
                      "color-mix(in oklab, var(--series-1) 14%, transparent)",
                    color: "var(--series-1)",
                  }
                : { color: "var(--text-secondary)" }
            }
          >
            {st} ({count})
          </button>
        ))}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="search name / id / wallet"
          className="card ml-auto px-3 py-1.5 text-sm"
        />
      </div>
      <div className="text-xs" style={{ color: "var(--text-muted)" }}>
        Weighted slot lottery replaces bans: weight = how often a provider wins
        a freed slot, TTL = how long it keeps one, rest = pause after each
        session. Unknown providers draw at weight {data.unknown.weight} with a{" "}
        {data.unknown.ttlMinutes} min audition; max {data.walletMaxActive}{" "}
        concurrent slots per operator wallet.
      </div>
      <div className="card p-4">
        <div className="overflow-x-auto">
          <table className="data w-full">
            <thead>
              <tr>
                <th>Provider</th>
                <th>Score</th>
                <th>Tier</th>
                <th>Weight</th>
                <th>Session TTL</th>
                <th>Rest</th>
                <th>State</th>
                <th>7d hours</th>
                <th>7d TH/GLM</th>
                <th>Wallet</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, limit).map((p) => (
                <tr key={p.providerId}>
                  <td>
                    <Link
                      to={`/providers/${p.providerId}`}
                      className="ext-link"
                    >
                      {p.name ?? shortId(p.providerId)}
                    </Link>
                    <div
                      className="text-xs"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {shortId(p.providerId)}
                    </div>
                  </td>
                  <td>{p.score.toFixed(1)}</td>
                  <td>
                    <span
                      className="rounded-full px-2 py-0.5 text-xs font-medium"
                      style={{
                        color: TIER_COLORS[p.tier],
                        border: "1px solid var(--grid)",
                      }}
                    >
                      {p.tier}
                    </span>
                  </td>
                  <td>{p.weight.toFixed(3)}</td>
                  <td>{fmtTtl(p.ttlMinutes)}</td>
                  <td>{p.restMinutes === 0 ? "none" : `${p.restMinutes} min`}</td>
                  <td style={{ color: STATE_COLOR[p.state] }}>
                    {STATE_LABEL[p.state]}
                    {p.state === "resting" && p.restingUntil && (
                      <span
                        className="text-xs"
                        style={{ color: "var(--text-muted)" }}
                      >
                        {" "}
                        · until {fmtIn(p.restingUntil)}
                      </span>
                    )}
                    {p.state === "resting" && p.walletAtCap && (
                      <span
                        className="text-xs"
                        style={{ color: "var(--text-muted)" }}
                      >
                        {" "}
                        · wallet cap
                      </span>
                    )}
                  </td>
                  <td>{p.hours7d.toFixed(1)}</td>
                  <td>{fmtEff(p.efficiency7d)}</td>
                  <td
                    className="text-xs"
                    style={{ color: "var(--text-muted)" }}
                    title={p.wallet ?? undefined}
                  >
                    {p.wallet ? shortId(p.wallet) : "—"}
                    {p.walletActive > 0 && ` (${p.walletActive} active)`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length > limit && (
          <button
            type="button"
            onClick={() => setLimit((l) => l + 200)}
            className="card mx-auto mt-3 block px-4 py-1.5 text-sm"
          >
            Show more ({Math.min(limit, filtered.length)} / {filtered.length})
          </button>
        )}
      </div>
    </div>
  );
}
