import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.ts";
import type { ProviderCategory, ProviderSummary } from "../../shared/types.ts";
import CategoryBadge from "../components/CategoryBadge.tsx";
import ScoreMeter from "../components/ScoreMeter.tsx";
import {
  fmtAgo,
  fmtEff,
  fmtGlm,
  fmtHours,
  fmtWork,
  shortId,
} from "../format.ts";

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

const SORTS = [
  { key: "score", label: "Score" },
  { key: "efficiency", label: "Efficiency" },
  { key: "work", label: "Work" },
  { key: "work24h", label: "Work 24h" },
  { key: "hours", label: "Hours" },
  { key: "cost", label: "Spend" },
  { key: "agreements", label: "Agreements" },
  { key: "bans", label: "Bans" },
  { key: "lastSeen", label: "Last seen" },
];

export default function Providers() {
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState("score");
  const [dir, setDir] = useState<"desc" | "asc">("desc");
  const [limit, setLimit] = useState(50);
  const [loading, setLoading] = useState(true);

  const query = useMemo(
    () => ({ search, category, sort, dir, limit }),
    [search, category, sort, dir, limit],
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

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or 0x id…"
          className="card w-64 px-3 py-1.5 text-sm outline-none"
        />
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

      <div className="card overflow-x-auto" style={{ opacity: loading ? 0.6 : 1 }}>
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
                  {sort === s.key ? (dir === "desc" ? " ↓" : " ↑") : ""}
                </th>
              ))}
              <th>Links</th>
            </tr>
          </thead>
          <tbody>
            {providers.map((p) => (
              <tr key={p.providerId}>
                <td>
                  <Link to={`/providers/${p.providerId}`} className="ext-link">
                    <span className="font-medium">
                      {p.name ?? shortId(p.providerId)}
                    </span>
                  </Link>
                  <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {shortId(p.providerId)}
                  </div>
                </td>
                <td>
                  <CategoryBadge category={p.category} />
                </td>
                <td>
                  <ScoreMeter score={p.score} />
                </td>
                <td className="tnum">{fmtEff(p.stats.efficiency)}</td>
                <td className="tnum">{fmtWork(p.stats.totalWork)}</td>
                <td className="tnum">{fmtWork(p.stats.totalWork24h)}</td>
                <td className="tnum">{fmtHours(p.stats.totalHours)}</td>
                <td className="tnum">{fmtGlm(p.stats.totalCost, 2)}</td>
                <td className="tnum">{p.stats.agreements}</td>
                <td className="tnum">
                  {p.stats.bansTotal > 0 ? (
                    <span style={{ color: "var(--status-critical)" }}>
                      {p.stats.bansTotal}
                    </span>
                  ) : (
                    0
                  )}
                </td>
                <td>{fmtAgo(p.stats.lastSeen)}</td>
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
            ))}
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
