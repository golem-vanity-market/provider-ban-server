import { config } from "./config.ts";
import type {
  ProviderAggRow,
} from "./db.ts";
import type {
  ProviderCategory,
  ProviderStats,
  ProviderSummary,
  ScoreBreakdown,
} from "../shared/types.ts";

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

export function statsFromAgg(row: ProviderAggRow): ProviderStats {
  const work = row.total_work ?? 0;
  const cost = row.total_cost ?? 0;
  const hours = row.total_hours ?? 0;
  return {
    agreements: row.agreements,
    agreements24h: row.agreements_24h,
    totalWork: work,
    totalWork24h: row.total_work_24h ?? 0,
    totalCost: cost,
    totalCost24h: row.total_cost_24h ?? 0,
    totalHours: hours,
    totalHours24h: row.total_hours_24h ?? 0,
    successes: row.successes ?? 0,
    efficiency: cost > 0 ? work / cost / 1e12 : null, // TH per GLM
    avgCostPerHour: hours > 0 ? cost / hours : null,
    avgSpeed: hours > 0 ? work / (hours * 3600) : null,
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
    bansTotal: row.bans_total,
    bans7d: row.bans_7d,
    lastBanAt: row.last_ban_at,
    activeBan:
      row.active_ban_id != null
        ? {
            id: row.active_ban_id,
            source: row.active_ban_source ?? "unknown",
            reason: row.active_ban_reason,
            bannedAt: row.active_ban_banned_at ?? "",
            expiresAt: row.active_ban_expires_at ?? "",
          }
        : null,
  };
}

export function computeScore(stats: ProviderStats): {
  score: number;
  breakdown: ScoreBreakdown;
} {
  // Efficiency: measured TH/GLM against the configured target.
  const efficiency =
    stats.efficiency === null
      ? 0.5 // no billing data yet: neutral
      : clamp01(stats.efficiency / config.effTarget);

  // Reliability: share of agreements that did not end in a ban.
  const denom = stats.agreements + stats.bansTotal;
  const reliability = denom === 0 ? 0.5 : clamp01(stats.agreements / denom);

  // Volume: log-scaled delivered rental hours.
  const volume = clamp01(
    Math.log10(1 + stats.totalHours) / Math.log10(1 + config.volumeTargetHours),
  );

  // Ban recency: full marks after 7 clean days.
  let banRecency = 1;
  if (stats.lastBanAt) {
    const hoursSince = (Date.now() - Date.parse(stats.lastBanAt)) / 3600_000;
    banRecency = clamp01(hoursSince / (7 * 24));
  }

  // Freshness: recently seen providers carry current information.
  let freshness = 0;
  if (stats.lastSeen) {
    const hoursSince = (Date.now() - Date.parse(stats.lastSeen)) / 3600_000;
    if (hoursSince <= 24) freshness = 1;
    else if (hoursSince <= 7 * 24)
      freshness = 1 - (0.8 * (hoursSince - 24)) / (6 * 24);
    else freshness = 0.2;
  }

  const breakdown: ScoreBreakdown = {
    efficiency,
    reliability,
    volume,
    banRecency,
    freshness,
  };
  const score =
    100 *
    (0.35 * efficiency +
      0.25 * reliability +
      0.15 * volume +
      0.15 * banRecency +
      0.1 * freshness);
  return { score: Math.round(score * 10) / 10, breakdown };
}

export function categorize(
  stats: ProviderStats,
  score: number,
): ProviderCategory {
  if (stats.activeBan) return "banned";
  if (stats.bans7d >= config.blacklistBans7d) return "blacklisted";
  if (stats.agreements < config.newMaxAgreements && stats.totalHours < 1)
    return "new";
  if (
    score >= config.trustedMinScore &&
    stats.totalHours >= config.trustedMinHours &&
    stats.bans7d === 0
  )
    return "trusted";
  if (score >= config.reliableMinScore) return "reliable";
  if (score >= config.averageMinScore) return "average";
  return "underperformer";
}

export function summarizeProvider(row: ProviderAggRow): ProviderSummary {
  const stats = statsFromAgg(row);
  const { score, breakdown } = computeScore(stats);
  const category = categorize(stats, score);
  return {
    providerId: row.provider_id,
    name: row.name,
    score,
    scoreBreakdown: breakdown,
    category,
    stats,
    statsGolemUrl: `${config.statsGolemProviderUrl}${row.provider_id}`,
  };
}
