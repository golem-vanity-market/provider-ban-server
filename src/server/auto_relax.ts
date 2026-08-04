import { config } from "./config.ts";
import type { Store } from "./db.ts";

/**
 * Auto-relax: providers that recently proved themselves get more lenient
 * enforcement targets, automatically.
 *
 * Qualify (all of): work in the last 24 h >= autoRelaxMinWork24h, 24 h
 * efficiency >= autoRelaxEffFactor x the global efficiency target, and no
 * active ban. Qualifying providers get an auto override of
 * global / autoRelaxDivisor for both targets; the override is removed as
 * soon as they stop qualifying. Rows set manually (auto = 0) are never
 * created, updated, or removed here.
 *
 * Returns the number of overrides added/updated + removed (0 = no change).
 */
export function applyAutoRelax(store: Store): number {
  if (!config.autoRelaxEnabled) return 0;

  const targetRows = store.listTargets();
  const globalRow = targetRows.find((r) => r.provider_id === "*");
  const globalEff =
    globalRow?.efficiency_target ?? config.defaultEfficiencyTarget;
  const globalSpeed = globalRow?.speed_target ?? config.defaultSpeedTarget;
  const relaxedEff = globalEff / config.autoRelaxDivisor;
  const relaxedSpeed = globalSpeed / config.autoRelaxDivisor;
  const minEff = globalEff * config.autoRelaxEffFactor;

  const manual = new Set<string>();
  const autoRows = new Map<
    string,
    { efficiency_target: number | null; speed_target: number | null }
  >();
  for (const r of targetRows) {
    if (r.provider_id === "*") continue;
    if (r.auto) autoRows.set(r.provider_id, r);
    else manual.add(r.provider_id);
  }

  let changes = 0;
  const note =
    `auto-relaxed: >=${(config.autoRelaxMinWork24h / 1e9).toFixed(0)} GH and ` +
    `>=${config.autoRelaxEffFactor}x global efficiency in the last 24h`;

  for (const agg of store.providerAggregates()) {
    const id = agg.provider_id;
    if (manual.has(id)) continue; // a human decided - leave it alone

    const work = agg.work_1d ?? 0;
    const cost = agg.cost_1d ?? 0;
    const eff = cost > 0 ? work / cost / 1e12 : null;
    const qualifies =
      work >= config.autoRelaxMinWork24h &&
      eff !== null &&
      eff >= minEff &&
      agg.active_ban_id == null;

    const existing = autoRows.get(id);
    autoRows.delete(id);
    if (qualifies) {
      if (
        existing?.efficiency_target === relaxedEff &&
        existing?.speed_target === relaxedSpeed
      ) {
        continue; // already up to date - avoid updated_at churn
      }
      store.setTarget({
        providerId: id,
        efficiencyTarget: relaxedEff,
        speedTarget: relaxedSpeed,
        note,
        auto: true,
      });
      changes++;
      console.log(
        `[auto-relax] ${id}: target -> ${relaxedEff} TH/GLM, ${relaxedSpeed} H/s ` +
          `(24h: ${(work / 1e9).toFixed(1)} GH, ${eff?.toFixed(3)} TH/GLM)`,
      );
    } else if (existing) {
      store.deleteTarget(id);
      changes++;
      console.log(`[auto-relax] ${id}: no longer qualifies, override removed`);
    }
  }

  // Auto rows for providers that vanished from the aggregates entirely.
  for (const id of autoRows.keys()) {
    store.deleteTarget(id);
    changes++;
    console.log(`[auto-relax] ${id}: provider gone, override removed`);
  }

  return changes;
}
