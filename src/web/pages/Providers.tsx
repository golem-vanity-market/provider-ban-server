import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnSizingState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
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
  fmtIn,
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

const SEEN_OPTIONS = [
  { value: "1d", label: "Active in 24 hours" },
  { value: "7d", label: "Active in 7 days" },
  { value: "30d", label: "Active in 30 days" },
  { value: "all", label: "All providers" },
];

// Columns whose data the backend can sort on (sorting stays server-side).
const SORT_KEYS: Record<string, string> = {
  score: "score",
  efficiency: "efficiency",
  work: "work",
  hours: "hours",
  cost: "cost",
  agreements: "agreements",
  bans: "bans",
  lastSeen: "lastSeen",
  lastAgreement: "lastAgreement",
};

const SIZES_KEY = "banserver.providers.colsizes.v1";
const ROW_HEIGHT = 52;

function loadSizes(): ColumnSizingState {
  try {
    return JSON.parse(localStorage.getItem(SIZES_KEY) ?? "{}");
  } catch {
    return {};
  }
}

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
      limit: 5000, // virtualized grid renders only visible rows — load everything
      window: WINDOW_PARAM[windowKey],
    }),
    [search, category, seen, sort, dir, windowKey],
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

  const columns = useMemo<ColumnDef<ProviderSummary>[]>(
    () => [
      {
        id: "provider",
        header: "Provider",
        size: 190,
        cell: ({ row }) => (
          <div className="min-w-0">
            <Link
              to={`/providers/${row.original.providerId}`}
              className="ext-link"
            >
              <span className="font-medium">
                {row.original.name ?? shortId(row.original.providerId)}
              </span>
            </Link>{" "}
            <a
              href={row.original.statsGolemUrl}
              target="_blank"
              rel="noreferrer"
              className="ext-link text-xs"
              title="Provider on stats.golem.network"
            >
              ↗
            </a>
            <div className="truncate text-xs" style={{ color: "var(--text-muted)" }}>
              {shortId(row.original.providerId)}
            </div>
          </div>
        ),
      },
      {
        id: "category",
        header: "Category",
        size: 112,
        cell: ({ row }) => <CategoryBadge category={row.original.category} />,
      },
      {
        id: "score",
        header: "Score",
        size: 110,
        cell: ({ row }) => <ScoreMeter score={row.original.score} />,
      },
      {
        id: "efficiency",
        header: `Efficiency${suffix}`,
        size: 118,
        cell: ({ row }) => (
          <span className="tnum">
            {fmtEff(row.original.stats.windows[windowKey].efficiency)}
          </span>
        ),
      },
      {
        id: "work",
        header: `Work${suffix}`,
        size: 92,
        cell: ({ row }) => (
          <span className="tnum">
            {fmtWork(row.original.stats.windows[windowKey].work)}
          </span>
        ),
      },
      {
        id: "speed",
        header: `Speed${suffix}`,
        size: 100,
        cell: ({ row }) => (
          <span className="tnum">
            {fmtSpeed(row.original.stats.windows[windowKey].avgSpeed)}
          </span>
        ),
      },
      {
        id: "hours",
        header: `Hours${suffix}`,
        size: 84,
        cell: ({ row }) => (
          <span className="tnum">
            {fmtHours(row.original.stats.windows[windowKey].hours)}
          </span>
        ),
      },
      {
        id: "cost",
        header: `Spend${suffix}`,
        size: 100,
        cell: ({ row }) => (
          <span className="tnum">
            {fmtGlm(row.original.stats.windows[windowKey].cost, 2)}
          </span>
        ),
      },
      {
        id: "price",
        header: `Price${suffix}`,
        size: 104,
        cell: ({ row }) => {
          const p = row.original.stats.windows[windowKey].avgCostPerHour;
          return (
            <span className="tnum">
              {p == null ? "—" : `${fmtGlm(p, 3).replace(" GLM", "")} GLM/h`}
            </span>
          );
        },
      },
      {
        id: "cpu",
        header: "CPU",
        size: 150,
        cell: ({ row }) => {
          const hw = row.original.hw;
          if (!hw || (hw.cpuThreads == null && hw.cpuCores == null))
            return <span style={{ color: "var(--text-muted)" }}>—</span>;
          return (
            <div title={hw.cpuBrand ?? undefined} className="min-w-0">
              <span className="tnum">
                {hw.cpuThreads ?? hw.cpuCores} threads
                {hw.cpuCores != null ? ` · ${hw.cpuCores} cores` : ""}
              </span>
              <div
                className="truncate text-xs"
                style={{ color: "var(--text-muted)" }}
              >
                {hw.cpuBrand ?? "—"}
              </div>
            </div>
          );
        },
      },
      {
        id: "memDisk",
        header: "Mem / disk",
        size: 96,
        cell: ({ row }) => {
          const hw = row.original.hw;
          if (!hw || (hw.memGib == null && hw.storageGib == null))
            return <span style={{ color: "var(--text-muted)" }}>—</span>;
          return (
            <div>
              <span className="tnum">
                {hw.memGib != null ? `${Math.round(hw.memGib)} GiB` : "—"}
              </span>
              <div className="text-xs tnum" style={{ color: "var(--text-muted)" }}>
                {hw.storageGib != null
                  ? `${Math.round(hw.storageGib)} GiB disk`
                  : "—"}
              </div>
            </div>
          );
        },
      },
      {
        id: "listPrice",
        header: "List price",
        size: 118,
        cell: ({ row }) => {
          const hw = row.original.hw;
          if (!hw) return <span style={{ color: "var(--text-muted)" }}>—</span>;
          const full =
            hw.priceEnvHour != null &&
            hw.priceCpuHour != null &&
            hw.cpuThreads != null
              ? hw.priceEnvHour + hw.priceCpuHour * hw.cpuThreads
              : null;
          if (full == null && hw.monthlyPriceGlm == null)
            return <span style={{ color: "var(--text-muted)" }}>—</span>;
          return (
            <div
              title={
                hw.priceEnvHour != null
                  ? `env ${hw.priceEnvHour.toFixed(4)} GLM/h + cpu ${hw.priceCpuHour?.toFixed(4) ?? "?"} GLM/thread-h + start ${hw.priceStart ?? 0} GLM`
                  : undefined
              }
            >
              <span className="tnum">
                {full != null ? `${full.toFixed(3)} GLM/h` : "—"}
              </span>
              <div className="text-xs tnum" style={{ color: "var(--text-muted)" }}>
                {hw.monthlyPriceGlm != null
                  ? `${hw.monthlyPriceGlm.toFixed(0)} GLM/mo`
                  : "at full load"}
              </div>
            </div>
          );
        },
      },
      {
        id: "agreements",
        header: `Agreements${suffix}`,
        size: 118,
        cell: ({ row }) => (
          <span className="tnum">
            {row.original.stats.windows[windowKey].agreements}
          </span>
        ),
      },
      {
        id: "pows",
        header: "PoW (all)",
        size: 84,
        cell: ({ row }) => (
          <span className="tnum">{row.original.stats.successes}</span>
        ),
      },
      {
        id: "bans",
        header: `Bans${suffix}`,
        size: 76,
        cell: ({ row }) => {
          const b = row.original.stats.windows[windowKey].bans;
          return b > 0 ? (
            <span className="tnum" style={{ color: "var(--status-critical)" }}>
              {b}
            </span>
          ) : (
            <span className="tnum">0</span>
          );
        },
      },
      {
        id: "dailyBans",
        header: "Bans today",
        size: 100,
        cell: ({ row }) => (
          <div>
            <span className="tnum">{row.original.stats.dailyBans}</span>
            <div className="text-xs tnum" style={{ color: "var(--text-muted)" }}>
              next {row.original.stats.nextBanHours}h
            </div>
          </div>
        ),
      },
      {
        id: "activeBan",
        header: "Active ban",
        size: 130,
        cell: ({ row }) => {
          const b = row.original.stats.activeBan;
          if (!b) return <span style={{ color: "var(--text-muted)" }}>—</span>;
          return (
            <div>
              <span style={{ color: "var(--status-critical)" }}>
                by {b.source}
              </span>
              <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                expires {fmtIn(b.expiresAt)}
              </div>
            </div>
          );
        },
      },
      {
        id: "lastSeen",
        header: "Last seen",
        size: 96,
        cell: ({ row }) => fmtAgo(row.original.stats.lastSeen),
      },
      {
        id: "lastAgreement",
        header: "Last agreement",
        size: 168,
        cell: ({ row }) => {
          const la = row.original.stats.lastAgreement;
          if (!la) return "—";
          return (
            <div>
              {fmtAgo(la.lastUpdated)}
              <div className="text-xs tnum" style={{ color: "var(--text-muted)" }}>
                {fmtWork(la.work)}
              </div>
            </div>
          );
        },
      },
      {
        id: "firstSeen",
        header: "First seen",
        size: 96,
        cell: ({ row }) => fmtAgo(row.original.stats.firstSeen),
      },
      {
        id: "target",
        header: "Target",
        size: 140,
        cell: ({ row }) => {
          const t = row.original.targets;
          return (
            <div>
              <span className="tnum">{fmtEff(t.efficiencyTarget)}</span>
              <div
                className="text-xs tnum"
                style={{
                  color: !t.override
                    ? "var(--text-muted)"
                    : t.auto
                      ? "var(--status-good)"
                      : "var(--status-warning)",
                }}
              >
                {fmtSpeed(t.speedTarget)}
                {t.override ? (t.auto ? " · auto" : " · override") : ""}
              </div>
            </div>
          );
        },
      },
      {
        id: "links",
        header: "Links",
        size: 70,
        cell: ({ row }) => (
          <a
            href={row.original.statsGolemUrl}
            target="_blank"
            rel="noreferrer"
            className="ext-link text-xs"
            title="Provider on stats.golem.network"
          >
            stats ↗
          </a>
        ),
      },
    ],
    [windowKey, suffix],
  );

  // Hand-resized column widths, persisted across sessions.
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>(loadSizes);
  useEffect(() => {
    try {
      localStorage.setItem(SIZES_KEY, JSON.stringify(columnSizing));
    } catch {
      /* private mode etc. — resizing still works for the session */
    }
  }, [columnSizing]);

  const table = useReactTable({
    data: providers,
    columns,
    state: { columnSizing },
    onColumnSizingChange: setColumnSizing,
    columnResizeMode: "onChange",
    getCoreRowModel: getCoreRowModel(),
    defaultColumn: { minSize: 56, maxSize: 600 },
  });

  const { rows } = table.getRowModel();

  // The grid gets its own scrollbar, sized to fill the rest of the viewport.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [gridHeight, setGridHeight] = useState(480);
  useEffect(() => {
    const update = () => {
      const el = scrollRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      setGridHeight(Math.max(240, window.innerHeight - top - 16));
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  const totalWidth = table.getTotalSize();

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
        <span className="grow" />
        {Object.keys(columnSizing).length > 0 && (
          <button
            type="button"
            className="card px-3 py-1 text-xs"
            title="Reset hand-resized column widths"
            onClick={() => setColumnSizing({})}
          >
            Reset columns
          </button>
        )}
      </div>

      <div
        ref={scrollRef}
        className="card gt-scroll"
        style={{ height: gridHeight, opacity: loading ? 0.6 : 1 }}
      >
        <div style={{ width: totalWidth, minWidth: "100%" }}>
          <div className="gt-head">
            {table.getHeaderGroups().map((hg) =>
              hg.headers.map((header) => {
                const sortKey = SORT_KEYS[header.column.id];
                return (
                  <div
                    key={header.id}
                    className={`gt-th ${sortKey ? "cursor-pointer select-none" : ""}`}
                    style={{ width: header.getSize() }}
                    onClick={sortKey ? () => clickSort(sortKey) : undefined}
                    title={sortKey ? "Click to sort (server-side)" : undefined}
                  >
                    <span className="truncate">
                      {flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                      {sortKey === sort ? (dir === "desc" ? " ↓" : " ↑") : ""}
                    </span>
                    <div
                      className={`gt-resizer ${
                        header.column.getIsResizing() ? "is-resizing" : ""
                      }`}
                      onMouseDown={header.getResizeHandler()}
                      onTouchStart={header.getResizeHandler()}
                      onClick={(e) => e.stopPropagation()}
                      onDoubleClick={() => header.column.resetSize()}
                      title="Drag to resize · double-click to reset"
                    />
                  </div>
                );
              }),
            )}
          </div>
          <div
            style={{
              height: rowVirtualizer.getTotalSize(),
              position: "relative",
            }}
          >
            {rowVirtualizer.getVirtualItems().map((vi) => {
              const row = rows[vi.index];
              return (
                <div
                  key={row.id}
                  className="gt-tr"
                  style={{
                    height: vi.size,
                    transform: `translateY(${vi.start}px)`,
                    width: totalWidth,
                  }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <div
                      key={cell.id}
                      className="gt-td"
                      style={{ width: cell.column.getSize() }}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
