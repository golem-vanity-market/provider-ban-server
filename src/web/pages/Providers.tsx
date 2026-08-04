import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.ts";
import type {
  ProviderCategory,
  ProviderSummary,
  TargetsResponse,
} from "../../shared/types.ts";
import CategoryBadge from "../components/CategoryBadge.tsx";
import ScoreMeter from "../components/ScoreMeter.tsx";
import WindowPicker from "../components/WindowPicker.tsx";
import {
  fmtAgo,
  fmtEff,
  fmtGlm,
  fmtHours,
  fmtSpeed,
  fmtWork,
  shortId,
} from "../format.ts";
import { WINDOW_PARAM, WINDOW_SHORT, useWindowKey } from "../window.ts";

const CATEGORIES: (ProviderCategory | "")[] = [
  "",
  "trusted",
  "reliable",
  "average",
  "underperformer",
  "new",
  "blacklisted",
  "banned",
];

// score, name and lastSeen are window-independent; the rest follow the window
const SEEN_OPTIONS = [
  { value: "1d", label: "Active in 24 hours" },
  { value: "7d", label: "Active in 7 days" },
  { value: "30d", label: "Active in 30 days" },
  { value: "all", label: "All providers" },
];

const SORTS = [
  { key: "score", label: "Score", windowed: false },
  { key: "efficiency", label: "Efficiency", windowed: true },
  { key: "work", label: "Work", windowed: true },
  { key: "hours", label: "Hours", windowed: true },
  { key: "cost", label: "Spend", windowed: true },
  { key: "agreements", label: "Agreements", windowed: true },
  { key: "bans", label: "Bans", windowed: true },
  { key: "lastSeen", label: "Last seen", windowed: false },
  { key: "lastAgreement", label: "Last agreement", windowed: false },
];

/** View + edit the fleet-wide enforcement target (stones terminate & ban
 *  below it; per-provider overrides win over this). */
function GlobalTargets({ onChanged }: { onChanged: () => void }) {
  const [targets, setTargets] = useState<TargetsResponse | null>(null);
  const [editing, setEditing] = useState(false);
  const [eff, setEff] = useState("");
  const [speed, setSpeed] = useState("");
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    api.targets().then(setTargets).catch(() => {});
  }, []);
  useEffect(reload, [reload]);

  if (!targets) return null;
  const g = targets.global;

  const save = async () => {
    const effN = parseFloat(eff);
    const speedN = parseFloat(speed);
    if (!Number.isFinite(effN) || effN < 0 || !Number.isFinite(speedN) || speedN < 0) {
      setError("Both targets must be non-negative numbers");
      return;
    }
    try {
      await api.setTarget("global", { efficiencyTarget: effN, speedTarget: speedN });
      setEditing(false);
      setError(null);
      reload();
      onChanged();
    } catch (e) {
      setError(String(e));
    }
  };

  const reset = async () => {
    try {
      await api.clearTarget("global");
      setEditing(false);
      setError(null);
      reload();
      onChanged();
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="card flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
      <span style={{ color: "var(--text-muted)" }}>
        Global target (stop &amp; ban below):
      </span>
      {editing ? (
        <>
          <input
            value={eff}
            onChange={(e) => setEff(e.target.value)}
            className="card w-24 px-2 py-1 text-sm tnum outline-none"
            placeholder="TH/GLM"
            aria-label="Global efficiency target (TH/GLM)"
          />
          <span style={{ color: "var(--text-muted)" }}>TH/GLM ·</span>
          <input
            value={speed}
            onChange={(e) => setSpeed(e.target.value)}
            className="card w-28 px-2 py-1 text-sm tnum outline-none"
            placeholder="H/s"
            aria-label="Global speed target (H/s)"
          />
          <span style={{ color: "var(--text-muted)" }}>H/s</span>
          <button type="button" onClick={save} className="card px-3 py-1">
            Save
          </button>
          {g.explicit && (
            <button type="button" onClick={reset} className="card px-3 py-1">
              Reset to defaults
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setError(null);
            }}
            className="card px-3 py-1"
          >
            Cancel
          </button>
        </>
      ) : (
        <>
          <span className="tnum font-medium">
            {fmtEff(g.efficiencyTarget)} · {fmtSpeed(g.speedTarget)}
          </span>
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            {g.explicit ? "set via UI" : "server default"}
            {" · "}
            {targets.overrides.length} provider override
            {targets.overrides.length === 1 ? "" : "s"}
          </span>
          <button
            type="button"
            onClick={() => {
              setEff(String(g.efficiencyTarget));
              setSpeed(String(g.speedTarget));
              setEditing(true);
            }}
            className="card px-3 py-1"
          >
            Edit
          </button>
        </>
      )}
      {error && (
        <span className="text-xs" style={{ color: "var(--status-critical)" }}>
          {error}
        </span>
      )}
    </div>
  );
}

export default function Providers() {
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [seen, setSeen] = useState("1d");
  const [sort, setSort] = useState("score");
  const [dir, setDir] = useState<"desc" | "asc">("desc");
  const [limit, setLimit] = useState(50);
  const [loading, setLoading] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);
  const windowKey = useWindowKey();

  const query = useMemo(
    () => ({
      search,
      category,
      seen,
      sort,
      dir,
      limit,
      window: WINDOW_PARAM[windowKey],
    }),
    [search, category, seen, sort, dir, limit, windowKey],
  );

  useEffect(() => {
    let stop = false;
    setLoading(true);
    const t = setTimeout(() => {
      api
        .providers(query)
        .then((r) => {
          if (!stop) {
            setProviders(r.providers);
            setTotal(r.total);
          }
        })
        .catch(() => {})
        .finally(() => !stop && setLoading(false));
    }, 200);
    return () => {
      stop = true;
      clearTimeout(t);
    };
  }, [query, refreshTick]);

  const clickSort = (key: string) => {
    if (sort === key) setDir((d) => (d === "desc" ? "asc" : "desc"));
    else {
      setSort(key);
      setDir("desc");
    }
  };

  const suffix = ` (${WINDOW_SHORT[windowKey]})`;

  return (
    <div className="flex flex-col gap-3">
      <GlobalTargets onChanged={() => setRefreshTick((t) => t + 1)} />
      <div className="flex flex-wrap items-center gap-2">
        <WindowPicker />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or 0x id…"
          className="card w-64 px-3 py-1.5 text-sm outline-none"
        />
        <select
          value={seen}
          onChange={(e) => setSeen(e.target.value)}
          className="card px-2 py-1.5 text-sm"
          aria-label="Filter by last activity"
        >
          {SEEN_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="card px-2 py-1.5 text-sm"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c === "" ? "All categories" : c}
            </option>
          ))}
        </select>
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          {loading ? "Loading…" : `${total} providers`}
        </span>
      </div>

      <div
        className="card overflow-x-auto"
        style={{ opacity: loading ? 0.6 : 1 }}
      >
        <table className="data w-full">
          <thead>
            <tr>
              <th>Provider</th>
              <th>Category</th>
              {SORTS.map((s) => (
                <th
                  key={s.key}
                  onClick={() => clickSort(s.key)}
                  className="cursor-pointer select-none"
                  title={`Sort by ${s.label}`}
                >
                  {s.label}
                  {s.windowed ? suffix : ""}
                  {sort === s.key ? (dir === "desc" ? " ↓" : " ↑") : ""}
                </th>
              ))}
              <th title="Enforcement target: stones stop work and ban below this">
                Target
              </th>
              <th>Links</th>
            </tr>
          </thead>
          <tbody>
            {providers.map((p) => {
              const w = p.stats.windows[windowKey];
              return (
                <tr key={p.providerId}>
                  <td>
                    <Link to={`/providers/${p.providerId}`} className="ext-link">
                      <span className="font-medium">
                        {p.name ?? shortId(p.providerId)}
                      </span>
                    </Link>
                    <div
                      className="text-xs"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {shortId(p.providerId)}
                    </div>
                  </td>
                  <td>
                    <CategoryBadge category={p.category} />
                  </td>
                  <td>
                    <ScoreMeter score={p.score} />
                  </td>
                  <td className="tnum">{fmtEff(w.efficiency)}</td>
                  <td className="tnum">{fmtWork(w.work)}</td>
                  <td className="tnum">{fmtHours(w.hours)}</td>
                  <td className="tnum">{fmtGlm(w.cost, 2)}</td>
                  <td className="tnum">{w.agreements}</td>
                  <td className="tnum">
                    {w.bans > 0 ? (
                      <span style={{ color: "var(--status-critical)" }}>
                        {w.bans}
                      </span>
                    ) : (
                      0
                    )}
                  </td>
                  <td>{fmtAgo(p.stats.lastSeen)}</td>
                  <td>
                    {p.stats.lastAgreement ? (
                      <>
                        {fmtAgo(p.stats.lastAgreement.lastUpdated)}
                        <div
                          className="text-xs tnum whitespace-nowrap"
                          style={{ color: "var(--text-muted)" }}
                        >
                          {p.stats.lastAgreement.successes} PoW ·{" "}
                          {fmtWork(p.stats.lastAgreement.work)} ·{" "}
                          {fmtHours(p.stats.lastAgreement.durationHours)}
                        </div>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="tnum">
                    {fmtEff(p.targets.efficiencyTarget)}
                    <div
                      className="text-xs whitespace-nowrap"
                      style={{
                        color: p.targets.override
                          ? "var(--status-warning)"
                          : "var(--text-muted)",
                      }}
                    >
                      {fmtSpeed(p.targets.speedTarget)}
                      {p.targets.override ? " · override" : ""}
                    </div>
                  </td>
                  <td>
                    <a
                      href={p.statsGolemUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="ext-link text-xs"
                      title="Provider on stats.golem.network"
                    >
                      stats ↗
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {total > providers.length && (
        <button
          type="button"
          onClick={() => setLimit((l) => l + 100)}
          className="card mx-auto px-4 py-1.5 text-sm"
        >
          Show more ({providers.length} / {total})
        </button>
      )}
    </div>
  );
}
