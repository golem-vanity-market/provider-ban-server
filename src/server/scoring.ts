import { config } from "./config.ts";
import type { ProviderAggRow } from "./db.ts";
import type {
  EffectiveTargets,
  ProviderCategory,
  ProviderHw,
  ProviderStats,
  ProviderSummary,
  ScoreBreakdown,
  WindowStats,
} from "../shared/types.ts";

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

function windowStats(
  agreements: number,
  work: number | null,
  cost: number | null,
  hours: number | null,
  bans: number,
): WindowStats {
  const w = work ?? 0;
  const c = cost ?? 0;
  const h = hours ?? 0;
  return {
    agreements,
    work: w,
    cost: c,
    hours: h,
    efficiency: c > 0 ? w / c / 1e12 : null, // TH per GLM
    avgCostPerHour: h > 0 ? c / h : null,
    avgSpeed: h > 0 ? w / (h * 3600) : null,
    bans,
  };
}

export function statsFromAgg(row: ProviderAggRow): ProviderStats {
  return {
    windows: {
      d1: windowStats(
        row.agr_1d,
        row.work_1d,
        row.cost_1d,
        row.hours_1d,
        row.bans_1d,
      ),
      d7: windowStats(
        row.agr_7d,
        row.work_7d,
        row.cost_7d,
        row.hours_7d,
        row.bans_7d,
      ),
      d30: windowStats(
        row.agr_30d,
        row.work_30d,
        row.cost_30d,
        row.hours_30d,
        row.bans_30d,
      ),
      all: windowStats(
        row.agr_all,
        row.work_all,
        row.cost_all,
        row.hours_all,
        row.bans_total,
      ),
    },
    activeNow: row.agr_active ?? 0,
    successes: row.successes ?? 0,
    lastAgreement:
      row.last_agr_id != null
        ? {
            agreementId: row.last_agr_id,
            node: row.last_agr_node,
            lastUpdated: row.last_agr_last_updated,
            work: row.last_agr_work ?? 0,
            successes: row.last_agr_successes ?? 0,
            durationHours: row.last_agr_duration_hours ?? 0,
          }
        : null,
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
    bansTotal: row.bans_total,
    bans7d: row.bans_7d,
    dailyBans: row.daily_bans,
    nextBanHours: Math.min(row.daily_bans + 1, config.banMaxHours),
    lastBanAt: row.last_ban_at,
    lastBanReason: row.last_ban_reason,
    lastBanSource: row.last_ban_source,
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

/** The score always looks at the full history (the reference windows are a
 *  display concern) - recency is one weighted component, not a filter. */
export function computeScore(stats: ProviderStats): {
  score: number;
  breakdown: ScoreBreakdown;
} {
  const all = stats.windows.all;

  // Efficiency: measured TH/GLM against the configured target.
  const efficiency =
    all.efficiency === null
      ? 0.5 // no billing data yet: neutral
      : clamp01(all.efficiency / config.effTarget);

  // Reliability: share of agreements that did not end in a ban.
  const denom = all.agreements + stats.bansTotal;
  const reliability = denom === 0 ? 0.5 : clamp01(all.agreements / denom);

  // Volume: log-scaled delivered rental hours.
  const volume = clamp01(
    Math.log10(1 + all.hours) / Math.log10(1 + config.volumeTargetHours),
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
  const all = stats.windows.all;
  if (stats.activeBan) return "banned";
  // Not currently banned (that case returned above) but banned so often
  // this week that another ban is likely.
  if (stats.bans7d >= config.blacklistBans7d) return "risky";
  if (all.agreements < config.newMaxAgreements && all.hours < 1) return "new";
  if (
    score >= config.trustedMinScore &&
    all.hours >= config.trustedMinHours &&
    stats.bans7d === 0
  )
    return "trusted";
  if (score >= config.reliableMinScore) return "reliable";
  if (score >= config.averageMinScore) return "average";
  return "underperformer";
}

export function summarizeProvider(
  row: ProviderAggRow,
  targets: EffectiveTargets,
  hw: ProviderHw | null = null,
): ProviderSummary {
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
    targets,
    hw,
    statsGolemUrl: `${config.statsGolemProviderUrl}${row.provider_id}`,
  };
}
