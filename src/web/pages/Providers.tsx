import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.ts";
import type { ProviderCategory, ProviderSummary } from "../../shared/types.ts";
import CategoryBadge from "../components/CategoryBadge.tsx";
import ScoreMeter from "../components/ScoreMeter.tsx";
import WindowPicker from "../components/WindowPicker.tsx";
import {
  fmtAgo,
  fmtEff,
  fmtGlm,
  fmtHours,
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
  }, [query]);

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
