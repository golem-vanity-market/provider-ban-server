import { existsSync, readFileSync } from "node:fs";
import { config } from "./config.ts";
import type { Store, AgreementUpsert } from "./db.ts";
import { agreementFromEstimator, type EstimatorEntry } from "./collector.ts";

interface SeedFileEntry {
  node?: string;
  estimator?: EstimatorEntry;
}

/**
 * One-time import of the gatherer's estimators.json (per-agreement records,
 * ~7 days of history) so the ban server starts with meaningful statistics.
 */
export function seedFromEstimatorsFile(store: Store): void {
  if (store.getMeta("seeded_at") !== null) return;
  if (store.agreementCount() > 0) {
    store.setMeta("seeded_at", new Date().toISOString());
    return;
  }
  const path = config.seedEstimatorsPath;
  if (!path || !existsSync(path)) {
    console.log(`[seed] no estimators file at '${path}', skipping seed`);
    store.setMeta("seeded_at", new Date().toISOString());
    return;
  }
  const paths = [path, config.seedEstimatorsHotPath].filter(
    (p) => p && existsSync(p),
  );
  console.log(
    `[seed] importing historical agreements from ${paths.join(", ")} ...`,
  );
  const started = Date.now();
  const data: Record<string, SeedFileEntry> = {};
  for (const p of paths) {
    try {
      Object.assign(
        data,
        JSON.parse(readFileSync(p, "utf-8")) as Record<string, SeedFileEntry>,
      );
    } catch (e) {
      console.error(`[seed] failed to read/parse ${p}:`, e);
      return;
    }
  }
  const rows: AgreementUpsert[] = [];
  for (const entry of Object.values(data)) {
    if (!entry?.estimator) continue;
    // node is stored as a URL like ".../nmpdmxzhrm/stone-3" - keep the last part
    const nodeName = entry.node ? (entry.node.split("/").pop() ?? null) : null;
    const row = agreementFromEstimator(nodeName, entry.estimator);
    if (row) rows.push(row);
  }
  store.upsertAgreements(rows);
  store.setMeta("seeded_at", new Date().toISOString());
  console.log(
    `[seed] imported ${rows.length} agreements in ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
}
