import { config } from "./config.ts";
import type { ProviderAggRow, Store } from "./db.ts";
import type {
  RankingEntry,
  RankingResponse,
  RankingScoreBreakdown,
  RotationState,
  RotationTier,
} from "../shared/types.ts";

/**
 * Rotation scheduler — the ban system's replacement.
 *
 * Instead of a binary shared ban list, every provider gets a continuous rank
 * that shapes three knobs the stones consume via GET /api/v1/ranking:
 *   - weight: how often they win a freed slot (weighted lottery),
 *   - ttlMinutes: how long they keep it (full shift vs short audition),
 *   - eligibility: rest period after each session + one-slot-per-identity +
 *     a per-operator-wallet concurrency cap.
 * Nobody is ever excluded outright: the worst tier still gets an audition
 * every rest period, and every audition is the path back up. Manual
 * suspensions (an active row in the bans table, e.g. the UI's "Stop work"
 * button) are the only hard exclusion and are ops-only.
 *
 * Score v2 deliberately has no ban-derived components (there are no more
 * automatic bans to count): efficiency 40% / session reliability 25% /
 * volume 15% / speed 10% / freshness 10%.
 */

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

function tierOf(score: number, confident: boolean): RotationTier {
  if (!confident) return "new";
  if (score >= config.rotTierA) return "A";
  if (score >= config.rotTierB) return "B";
  if (score >= config.rotTierC) return "C";
  return "D";
}

const TTL_BY_TIER: Record<RotationTier, () => number> = {
  A: () => config.rotTtlA,
  B: () => config.rotTtlB,
  C: () => config.rotTtlC,
  D: () => config.rotTtlD,
  new: () => config.rotTtlNew,
};

const REST_BY_TIER: Record<RotationTier, () => number> = {
  A: () => config.rotRestA,
  B: () => config.rotRestB,
  C: () => config.rotRestC,
  D: () => config.rotRestD,
  new: () => config.rotRestNew,
};

function scoreV2(row: ProviderAggRow): {
  score: number;
  breakdown: RankingScoreBreakdown;
  eff7: number | null;
} {
  const work1 = row.work_1d ?? 0;
  const cost1 = row.cost_1d ?? 0;
  const work7 = row.work_7d ?? 0;
  const cost7 = row.cost_7d ?? 0;
  const hours7 = row.hours_7d ?? 0;

  // Efficiency: freshest window with enough billing data to mean anything.
  const eff1 = cost1 >= 0.05 ? work1 / cost1 / 1e12 : null;
  const eff7 = cost7 >= 0.05 ? work7 / cost7 / 1e12 : null;
  const eff = eff1 ?? eff7;
  const sEff = eff === null ? 0.5 : clamp01(eff / config.effTarget);

  // Reliability: share of recent sessions that were not "paid for nothing".
  const sessions7 = row.agr_7d;
  const zero7 = row.agr_7d_zero ?? 0;
  const sRel = sessions7 > 0 ? clamp01(1 - zero7 / sessions7) : 0.5;

  // Volume: log-scaled measured hours over 7d — sustained contribution
  // counts, whales don't dominate.
  const sVol = clamp01(Math.log10(1 + hours7) / Math.log10(1 + 50));

  // Speed: average over 7d against the "full marks" bar (the pre-relaxation
  // code-default speed target).
  const speed7 = hours7 > 0.05 ? work7 / (hours7 * 3600) : null;
  const sSpeed = speed7 === null ? 0.5 : clamp01(speed7 / 500_000);

  // Freshness: same curve the v1 score used.
  let sFresh = 0;
  if (row.last_seen) {
    const hoursSince = (Date.now() - Date.parse(row.last_seen)) / 3600_000;
    if (hoursSince <= 24) sFresh = 1;
    else if (hoursSince <= 7 * 24)
      sFresh = 1 - (0.8 * (hoursSince - 24)) / (6 * 24);
    else sFresh = 0.2;
  }

  const breakdown: RankingScoreBreakdown = {
    efficiency: sEff,
    reliability: sRel,
    volume: sVol,
    speed: sSpeed,
    freshness: sFresh,
  };
  const score =
    100 *
    (0.4 * sEff + 0.25 * sRel + 0.15 * sVol + 0.1 * sSpeed + 0.1 * sFresh);
  return { score: Math.round(score * 10) / 10, breakdown, eff7 };
}

export function computeRanking(
  rows: ProviderAggRow[],
  wallets: Map<string, string>,
  globalEffTarget: number,
): RankingResponse {
  const now = Date.now();
  const seenCutoff = now - config.rotSeenDays * 24 * 3600_000;
  const activeCutoff = now - config.rotActiveSecs * 1000;

  interface Draft {
    row: ProviderAggRow;
    score: number;
    breakdown: RankingScoreBreakdown;
    eff7: number | null;
    tier: RotationTier;
    weight: number;
    ttl: number;
    rest: number;
    active: boolean;
    restingUntil: number | null;
    suspended: boolean;
    wallet: string | null;
  }

  const drafts: Draft[] = [];
  const walletActive = new Map<string, number>();
  for (const row of rows) {
    const lastSeenMs = row.last_seen ? Date.parse(row.last_seen) : NaN;
    if (!Number.isFinite(lastSeenMs) || lastSeenMs < seenCutoff) continue;

    const { score, breakdown, eff7 } = scoreV2(row);
    const confident = (row.hours_7d ?? 0) >= config.rotConfMinHours7d;
    let tier = tierOf(score, confident);
    // Hard efficiency cap on top of the blended score: neutral components
    // (reliability, volume, freshness) must never carry a provider that
    // measurably delivers below the fleet's enforcement target — that is
    // exactly the oversubscribed-operator shape (huge volume, always fresh,
    // 4-5x worse TH/GLM). Below target => auditions only; below 2x => at
    // most tier C. "new" providers are exempt (no reliable data yet).
    const effMeasured = eff7;
    if (tier !== "new" && effMeasured !== null && globalEffTarget > 0) {
      const ratio = effMeasured / globalEffTarget;
      if (ratio < 1) tier = "D";
      else if (ratio < 2 && (tier === "A" || tier === "B")) tier = "C";
    }
    let weight: number;
    if (tier === "new") weight = config.rotNewWeight;
    else if (tier === "D") weight = config.rotWeightEps;
    else {
      weight = Math.max(
        config.rotWeightEps,
        Math.pow(score / 100, config.rotWeightGamma),
      );
      if (tier === "C") weight = Math.min(weight, 0.2);
    }

    const lastEndMs = row.last_agr_last_updated
      ? Date.parse(row.last_agr_last_updated)
      : NaN;
    const active = Number.isFinite(lastEndMs) && lastEndMs > activeCutoff;
    const rest = REST_BY_TIER[tier]();
    let restingUntil: number | null = null;
    if (!active && Number.isFinite(lastEndMs) && rest > 0) {
      const until = lastEndMs + rest * 60_000;
      if (until > now) restingUntil = until;
    }

    const wallet = wallets.get(row.provider_id) ?? null;
    if (active && wallet) {
      walletActive.set(wallet, (walletActive.get(wallet) ?? 0) + 1);
    }

    drafts.push({
      row,
      score,
      breakdown,
      eff7,
      tier,
      weight,
      ttl: TTL_BY_TIER[tier](),
      rest,
      active,
      restingUntil,
      suspended: row.active_ban_id != null,
      wallet,
    });
  }

  const counts = { listed: 0, active: 0, resting: 0, eligible: 0, suspended: 0 };
  const providers: RankingEntry[] = drafts.map((d) => {
    const wActive = d.wallet ? (walletActive.get(d.wallet) ?? 0) : 0;
    const walletAtCap = !d.active && wActive >= config.rotWalletMaxActive;
    let state: RotationState;
    if (d.suspended) state = "suspended";
    else if (d.active) state = "active";
    else if (d.restingUntil !== null || walletAtCap) state = "resting";
    else state = "eligible";
    counts.listed++;
    if (state === "suspended") counts.suspended++;
    else if (state === "active") counts.active++;
    else if (state === "resting") counts.resting++;
    else counts.eligible++;
    return {
      providerId: d.row.provider_id,
      name: d.row.name,
      score: d.score,
      tier: d.tier,
      weight: Math.round(d.weight * 1000) / 1000,
      ttlMinutes: d.ttl,
      restMinutes: d.rest,
      state,
      eligible: state === "eligible",
      restingUntil:
        d.restingUntil !== null ? new Date(d.restingUntil).toISOString() : null,
      wallet: d.wallet,
      walletActive: wActive,
      walletAtCap,
      breakdown: d.breakdown,
      lastSeen: d.row.last_seen,
      hours7d: Math.round((d.row.hours_7d ?? 0) * 100) / 100,
      efficiency7d: d.eff7,
    };
  });

  providers.sort((a, b) => b.score - a.score);
  return {
    timestamp: new Date().toISOString(),
    unknown: {
      weight: config.rotUnknownWeight,
      ttlMinutes: config.rotUnknownTtlMin,
    },
    walletMaxActive: config.rotWalletMaxActive,
    counts,
    providers,
  };
}

// The stones poll every 30 s from 10 processes; the aggregate sweep behind
// this costs ~0.65 s of synchronous event-loop time, so serve from a short
// cache and reuse the wallet map for 10 minutes (wallets change rarely).
let rankingCache: { at: number; resp: RankingResponse; body: string } | null =
  null;
let walletCache: { at: number; map: Map<string, string> } | null = null;

export function invalidateRanking(): void {
  rankingCache = null;
}

export function rankingFor(
  store: Store,
  aggs: () => ProviderAggRow[],
): { resp: RankingResponse; body: string } {
  if (rankingCache && Date.now() - rankingCache.at < 15_000) {
    return rankingCache;
  }
  if (!walletCache || Date.now() - walletCache.at > 600_000) {
    walletCache = { at: Date.now(), map: store.providerWalletMap() };
  }
  const globalEff =
    store.listTargets().find((r) => r.provider_id === "*")
      ?.efficiency_target ?? config.defaultEfficiencyTarget;
  const resp = computeRanking(aggs(), walletCache.map, globalEff);
  const body = JSON.stringify(resp);
  rankingCache = { at: Date.now(), resp, body };
  return rankingCache;
}
