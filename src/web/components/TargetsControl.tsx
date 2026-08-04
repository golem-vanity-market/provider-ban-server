import { useState } from "react";
import { api } from "../api.ts";
import type { ProviderDetail } from "../../shared/types.ts";
import { fmtEff, fmtSpeed } from "../format.ts";

/**
 * Per-provider enforcement targets + the emergency stop.
 *
 * The stones stop work (terminate the agreement and ban) when a provider
 * falls below its effective efficiency/speed target. Trusted providers with
 * a proven track record can get a lower (more lenient) override; a manual
 * ban from here stops the whole fleet from renting the provider.
 */
export default function TargetsControl({
  detail,
  onChanged,
}: {
  detail: ProviderDetail;
  onChanged: () => void;
}) {
  const t = detail.targets;
  const [editing, setEditing] = useState(false);
  const [eff, setEff] = useState("");
  const [speed, setSpeed] = useState("");
  const [note, setNote] = useState("");
  const [banning, setBanning] = useState(false);
  const [banReason, setBanReason] = useState("");
  const [banHours, setBanHours] = useState(""); // empty = escalating auto
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setEditing(false);
      setBanning(false);
      onChanged();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const parseOptional = (v: string): number | null | false => {
    if (v.trim() === "") return null;
    const n = parseFloat(v);
    return Number.isFinite(n) && n >= 0 ? n : false;
  };

  const saveOverride = () => {
    const effN = parseOptional(eff);
    const speedN = parseOptional(speed);
    if (effN === false || speedN === false) {
      setError("Targets must be non-negative numbers (empty = inherit global)");
      return;
    }
    if (effN === null && speedN === null) {
      setError("Set at least one of the two targets");
      return;
    }
    void run(() =>
      api.setTarget(detail.providerId, {
        efficiencyTarget: effN,
        speedTarget: speedN,
        note: note.trim() || null,
      }),
    );
  };

  const banNow = () => {
    const hours = parseFloat(banHours);
    void run(() =>
      api.banProvider(
        detail.providerId,
        banReason.trim() || "manual stop from ban server UI",
        Number.isFinite(hours) && hours > 0 ? hours : undefined,
      ),
    );
  };

  return (
    <div className="card flex flex-col gap-2 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">
          Enforcement target{" "}
          <span className="font-normal" style={{ color: "var(--text-muted)" }}>
            — stones stop work &amp; ban below this
          </span>
        </h3>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="tnum font-medium">
          {fmtEff(t.efficiencyTarget)} · {fmtSpeed(t.speedTarget)}
        </span>
        <span
          className="text-xs"
          style={{
            color: !t.override
              ? "var(--text-muted)"
              : t.auto
                ? "var(--status-good)"
                : "var(--status-warning)",
          }}
        >
          {t.override
            ? t.auto
              ? "auto-relaxed (proven 24h performance)"
              : "provider override"
            : "global target"}
          {t.note ? ` — ${t.note}` : ""}
        </span>
        {!editing && (
          <button
            type="button"
            className="card px-3 py-1"
            onClick={() => {
              setEff(String(t.efficiencyTarget));
              setSpeed(String(t.speedTarget));
              setNote(t.note ?? "");
              setEditing(true);
              setBanning(false);
            }}
          >
            {t.override ? "Edit override" : "Set override"}
          </button>
        )}
        {t.override && !t.auto && !editing && (
          <button
            type="button"
            className="card px-3 py-1"
            disabled={busy}
            onClick={() => void run(() => api.clearTarget(detail.providerId))}
          >
            Remove override
          </button>
        )}
        {t.override && t.auto && !editing && (
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            (managed automatically — set a manual override to pin)
          </span>
        )}
        <span className="grow" />
        {detail.stats.activeBan ? (
          <button
            type="button"
            className="card px-3 py-1"
            disabled={busy}
            style={{ color: "var(--status-good)" }}
            onClick={() =>
              void run(() => api.revokeBan(detail.stats.activeBan!.id))
            }
          >
            ✓ Revoke ban (resume work)
          </button>
        ) : banning ? null : (
          <button
            type="button"
            className="card px-3 py-1"
            style={{ color: "var(--status-critical)" }}
            onClick={() => {
              setBanning(true);
              setEditing(false);
            }}
          >
            ⊘ Stop work (ban now)
          </button>
        )}
      </div>

      {editing && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <input
            value={eff}
            onChange={(e) => setEff(e.target.value)}
            className="card w-24 px-2 py-1 tnum outline-none"
            placeholder="TH/GLM"
            aria-label="Efficiency target (TH/GLM)"
          />
          <span style={{ color: "var(--text-muted)" }}>TH/GLM ·</span>
          <input
            value={speed}
            onChange={(e) => setSpeed(e.target.value)}
            className="card w-28 px-2 py-1 tnum outline-none"
            placeholder="H/s"
            aria-label="Speed target (H/s)"
          />
          <span style={{ color: "var(--text-muted)" }}>H/s</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="card w-64 px-2 py-1 outline-none"
            placeholder="Note (why, e.g. trusted since 2026-07)"
          />
          <button
            type="button"
            className="card px-3 py-1"
            disabled={busy}
            onClick={saveOverride}
          >
            Save override
          </button>
          <button
            type="button"
            className="card px-3 py-1"
            onClick={() => {
              setEditing(false);
              setError(null);
            }}
          >
            Cancel
          </button>
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            Empty field = inherit the global value
          </span>
        </div>
      )}

      {banning && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <input
            value={banReason}
            onChange={(e) => setBanReason(e.target.value)}
            className="card w-72 px-2 py-1 outline-none"
            placeholder="Reason (shown fleet-wide)"
          />
          <input
            value={banHours}
            onChange={(e) => setBanHours(e.target.value)}
            className="card w-24 px-2 py-1 tnum outline-none"
            placeholder={`auto (${detail.stats.nextBanHours}h)`}
            aria-label="Ban duration in hours (empty = escalating auto)"
          />
          <span style={{ color: "var(--text-muted)" }}>hours</span>
          <button
            type="button"
            className="card px-3 py-1"
            disabled={busy}
            style={{ color: "var(--status-critical)" }}
            onClick={banNow}
          >
            Confirm ban
          </button>
          <button
            type="button"
            className="card px-3 py-1"
            onClick={() => {
              setBanning(false);
              setError(null);
            }}
          >
            Cancel
          </button>
        </div>
      )}

      {error && (
        <div className="text-xs" style={{ color: "var(--status-critical)" }}>
          {error}
        </div>
      )}
    </div>
  );
}
