import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.ts";
import type { BanRow } from "../../shared/types.ts";
import { fmtAgo, fmtDate, fmtIn, shortId } from "../format.ts";

function BanTable({ bans }: { bans: BanRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="data w-full">
        <thead>
          <tr>
            <th>Provider</th>
            <th>Source</th>
            <th>Reason</th>
            <th>Banned</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {bans.map((b) => (
            <tr key={b.id}>
              <td>
                <Link to={`/providers/${b.providerId}`} className="ext-link">
                  {b.providerName ?? shortId(b.providerId)}
                </Link>
                <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {shortId(b.providerId)}
                </div>
              </td>
              <td>{b.source}</td>
              <td
                className="max-w-72 truncate"
                style={{ color: "var(--text-secondary)" }}
                title={b.reason ?? undefined}
              >
                {b.reason ?? "—"}
              </td>
              <td title={fmtDate(b.bannedAt)}>{fmtAgo(b.bannedAt)}</td>
              <td>
                {b.active ? (
                  <span style={{ color: "var(--status-critical)" }}>
                    ✕ active · expires {fmtIn(b.expiresAt)}
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
  );
}

export default function Bans() {
  const [tab, setTab] = useState<"active" | "history">("active");
  const [active, setActive] = useState<BanRow[]>([]);
  const [history, setHistory] = useState<BanRow[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [limit, setLimit] = useState(100);

  useEffect(() => {
    let stop = false;
    const load = () => {
      api
        .activeBans()
        .then((r) => !stop && setActive(r.bans))
        .catch(() => {});
      api
        .banHistory(limit)
        .then((r) => {
          if (!stop) {
            setHistory(r.bans);
            setHistoryTotal(r.total);
          }
        })
        .catch(() => {});
    };
    load();
    const t = setInterval(load, 30_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [limit]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        {(["active", "history"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className="rounded-md px-3 py-1.5 text-sm font-medium"
            style={
              tab === t
                ? {
                    background:
                      "color-mix(in oklab, var(--series-1) 14%, transparent)",
                    color: "var(--series-1)",
                  }
                : { color: "var(--text-secondary)" }
            }
          >
            {t === "active" ? `Active (${active.length})` : `History (${historyTotal})`}
          </button>
        ))}
      </div>
      <div className="card p-4">
        {tab === "active" ? (
          active.length > 0 ? (
            <BanTable bans={active} />
          ) : (
            <div className="text-sm" style={{ color: "var(--text-muted)" }}>
              No active bans.
            </div>
          )
        ) : (
          <>
            <BanTable bans={history} />
            {historyTotal > history.length && (
              <button
                type="button"
                onClick={() => setLimit((l) => l + 200)}
                className="card mx-auto mt-3 block px-4 py-1.5 text-sm"
              >
                Show more ({history.length} / {historyTotal})
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
