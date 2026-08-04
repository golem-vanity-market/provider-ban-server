import { readFileSync } from "node:fs";
import { config } from "./config.ts";
import { applyAutoRelax } from "./auto_relax.ts";
import { refreshProviderHw } from "./stats_hw.ts";
import { invalidateSummaries } from "./api.ts";
import type { Store, AgreementUpsert } from "./db.ts";
import type { NodeStatus } from "../shared/types.ts";

interface NodeDef {
  nodeName: string;
  nodeId: string;
}

export interface EstimatorEntry {
  jobId: string;
  currentInfo: {
    totalSuccesses?: number;
    providerName?: string;
    providerId?: string;
    cost?: number;
    lastUpdated?: string;
    totalEfficiency?: number | null;
    estimatedSpeed1y?: {
      currentTimePoint?: string;
      startTimePoint?: string;
      currentAttempts?: number;
      currentCost?: number;
    };
    estimatedSpeed?: {
      speed?: number;
      costPerHour?: number;
    };
  };
}

const MAX_SANE_ATTEMPTS = 1e20; // same guard the gatherer applies

export function agreementFromEstimator(
  node: string | null,
  est: EstimatorEntry,
): AgreementUpsert | null {
  const info = est.currentInfo;
  if (!info || !info.providerId || !est.jobId) return null;
  const sp = info.estimatedSpeed1y;
  const work = sp?.currentAttempts ?? 0;
  if (!Number.isFinite(work) || work < 0 || work > MAX_SANE_ATTEMPTS)
    return null;
  const cost = info.cost ?? sp?.currentCost ?? 0;
  const startedAt = sp?.startTimePoint ?? null;
  const lastUpdated = info.lastUpdated ?? sp?.currentTimePoint ?? null;
  let durationHours = 0;
  if (startedAt && lastUpdated) {
    const ms = Date.parse(lastUpdated) - Date.parse(startedAt);
    if (Number.isFinite(ms) && ms > 0) durationHours = ms / 3600_000;
  }
  const efficiency =
    info.totalEfficiency ?? (cost > 0 ? work / cost / 1e12 : null);
  const speed =
    info.estimatedSpeed?.speed && info.estimatedSpeed.speed > 0
      ? info.estimatedSpeed.speed
      : durationHours > 0
        ? work / (durationHours * 3600)
        : null;
  const costPerHour = durationHours > 0 ? cost / durationHours : null;
  return {
    agreementId: est.jobId,
    providerId: info.providerId.toLowerCase(),
    providerName: info.providerName ?? null,
    node,
    startedAt,
    lastUpdated,
    work,
    cost,
    efficiency,
    speed,
    costPerHour,
    durationHours,
    successes: info.totalSuccesses ?? 0,
  };
}

export class Collector {
  private nodes: NodeDef[] = [];
  private nodesLoadedAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  public nodeStatus = new Map<string, NodeStatus>();
  public lastCollectedAt: string | null = null;

  constructor(private store: Store) {}

  private async loadNodes(): Promise<void> {
    // Refresh the node list at most every 10 minutes.
    if (this.nodes.length > 0 && Date.now() - this.nodesLoadedAt < 600_000)
      return;
    let defs: NodeDef[] | null = null;
    try {
      const parsed = JSON.parse(readFileSync(config.nodesFile, "utf-8")) as {
        nodes: NodeDef[];
      };
      defs = parsed.nodes;
    } catch {
      try {
        const resp = await fetch(config.nodesUrl, {
          signal: AbortSignal.timeout(10_000),
        });
        if (resp.ok) {
          const parsed = (await resp.json()) as { nodes: NodeDef[] };
          defs = parsed.nodes;
        }
      } catch {
        // keep previous list
      }
    }
    if (defs && defs.length > 0) {
      this.nodes = defs;
      this.nodesLoadedAt = Date.now();
    }
  }

  private nodeUrls(nodeName: string): string[] {
    const urls: string[] = [];
    const m = nodeName.match(/(\d+)$/);
    if (m) {
      urls.push(`http://127.0.0.1:${config.stonePortBase + Number(m[1])}`);
    }
    urls.push(`${config.stonePublicBase}/${nodeName}`);
    return urls;
  }

  private async fetchJson(
    nodeName: string,
    path: string,
  ): Promise<unknown | null> {
    for (const base of this.nodeUrls(nodeName)) {
      try {
        const resp = await fetch(`${base}${path}`, {
          signal: AbortSignal.timeout(15_000),
        });
        if (resp.ok) return await resp.json();
      } catch {
        // try next url
      }
    }
    return null;
  }

  private status(node: string): NodeStatus {
    let st = this.nodeStatus.get(node);
    if (!st) {
      st = {
        node,
        ok: false,
        activeEstimators: 0,
        bannedReported: 0,
        lastError: null,
        lastSuccessAt: null,
      };
      this.nodeStatus.set(node, st);
    }
    return st;
  }

  private async collectNode(node: NodeDef): Promise<void> {
    const st = this.status(node.nodeName);
    const statusJson = (await this.fetchJson(node.nodeName, "/status")) as {
      sessions?: { estimators?: EstimatorEntry[] };
    } | null;
    if (statusJson?.sessions?.estimators) {
      const rows: AgreementUpsert[] = [];
      for (const est of statusJson.sessions.estimators) {
        const row = agreementFromEstimator(node.nodeName, est);
        if (row) rows.push(row);
      }
      this.store.upsertAgreements(rows);
      st.activeEstimators = rows.length;
      st.ok = true;
      st.lastError = null;
      st.lastSuccessAt = new Date().toISOString();
    } else {
      st.ok = false;
      st.lastError = "failed to fetch /status";
    }

    const bansJson = (await this.fetchJson(
      node.nodeName,
      "/providers/banned",
    )) as { bannedProviders?: string[] } | null;
    if (bansJson?.bannedProviders && Array.isArray(bansJson.bannedProviders)) {
      st.bannedReported = bansJson.bannedProviders.length;
      for (const rawId of bansJson.bannedProviders) {
        if (typeof rawId !== "string" || !rawId.startsWith("0x")) continue;
        const providerId = rawId.toLowerCase();
        // Idempotent: one active ban per (provider, reporting node). When a
        // stone resets its own list at cycle end the fleet-wide clock keeps
        // running (OPERATIONS.md 6b).
        if (!this.store.hasActiveBan(providerId, node.nodeName)) {
          this.store.insertBan({
            providerId,
            source: node.nodeName,
            reason: `reported by ${node.nodeName} (efficiency below requirement or failed command)`,
            agreementId: null,
          });
        }
      }
    }
  }

  async collectOnce(): Promise<void> {
    await this.loadNodes();
    await Promise.all(this.nodes.map((n) => this.collectNode(n)));
    this.lastCollectedAt = new Date().toISOString();
    let changed = applyAutoRelax(this.store) > 0;
    try {
      changed = (await refreshProviderHw(this.store)) > 0 || changed;
    } catch (e) {
      console.error("[stats-hw] refresh failed:", e);
    }
    if (changed) {
      invalidateSummaries();
    }
  }

  start(): void {
    const loop = async (): Promise<void> => {
      if (this.stopped) return;
      try {
        await this.collectOnce();
      } catch (e) {
        console.error("[collector] cycle failed:", e);
      }
      this.timer = setTimeout(loop, config.collectIntervalSecs * 1000);
    };
    void loop();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }
}
