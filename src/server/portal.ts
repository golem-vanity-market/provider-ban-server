// Portal-facing provider report: a compact, stable shape for the public
// stats portal, plus human-readable hints (price too high, ban escalation,
// speed under target, ...). Read-only view over the same data the UI uses.
import type {
  PortalHint,
  PortalProviderReport,
  ProviderSummary,
  WindowKey,
  WindowStats,
} from "../shared/types.ts";

const round = (x: number, digits: number): number => {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
};

/** Pick the freshest window that has billing data (24h, else 7d, else all). */
function pickWindow(s: ProviderSummary): { key: WindowKey; w: WindowStats } {
  for (const key of ["d1", "d7", "all"] as const) {
    if (s.stats.windows[key].cost > 0) return { key, w: s.stats.windows[key] };
  }
  return { key: "d1", w: s.stats.windows.d1 };
}

function buildHints(
  s: ProviderSummary,
  key: WindowKey,
  w: WindowStats,
): PortalHint[] {
  const hints: PortalHint[] = [];
  const windowLabel = { d1: "24h", d7: "7d", d30: "30d", all: "all-time" }[key];
  const { efficiencyTarget, speedTarget } = s.targets;

  if (s.stats.activeBan) {
    hints.push({
      id: "banned",
      severity: "critical",
      message:
        `Currently banned until ${s.stats.activeBan.expiresAt}` +
        (s.stats.activeBan.reason ? ` — ${s.stats.activeBan.reason}` : "") +
        ". Bans expire automatically; fixing the cause below prevents the next one.",
    });
  }

  if (s.stats.dailyBans > 0) {
    hints.push({
      id: "ban-escalation",
      severity: "warning",
      message:
        `${s.stats.dailyBans} ban(s) in the last 24h — ban durations escalate, ` +
        `the next one would last ${s.stats.nextBanHours}h. ` +
        "A clean 24h resets the escalation.",
    });
  }

  const eff = w.efficiency;
  if (eff !== null && efficiencyTarget > 0) {
    const ratio = eff / efficiencyTarget;
    if (ratio < 1) {
      // efficiency = work / cost, so at unchanged speed the price cut needed
      // to reach the target is exactly the efficiency shortfall.
      const cutPct = Math.round((1 - ratio) * 100);
      const priceNow = w.avgCostPerHour;
      const priceMax =
        priceNow !== null ? round(priceNow * ratio, 6) : null;
      hints.push({
        id: "price-too-high",
        severity: ratio < 0.8 ? "critical" : "warning",
        message:
          `Measured efficiency (${windowLabel}) is ${round(eff, 4)} TH/GLM, below the ` +
          `enforced target of ${efficiencyTarget} TH/GLM. At your current speed you are ` +
          `overpriced by ~${cutPct}%` +
          (priceNow !== null && priceMax !== null
            ? `: you bill ~${round(priceNow, 6)} GLM/h, but at most ` +
              `${priceMax} GLM/h would meet the target`
            : "") +
          ". Lower your price list (mainly the per-thread CPU price) or deliver more hashes for the same cost.",
        data: {
          efficiency: eff,
          efficiencyTarget,
          suggestedPriceCutPct: cutPct,
          currentCostPerHour: priceNow,
          suggestedMaxCostPerHour: priceMax,
        },
      });
    } else if (ratio >= 2 && !s.targets.override) {
      hints.push({
        id: "headroom",
        severity: "info",
        message:
          `Efficiency (${windowLabel}) is ${round(ratio, 1)}x the target — you have pricing ` +
          "headroom, and sustained work at ≥2x the target earns an automatic relaxed target.",
        data: { efficiency: eff, efficiencyTarget },
      });
    }
  }

  if (
    w.avgSpeed !== null &&
    speedTarget > 0 &&
    w.avgSpeed < speedTarget
  ) {
    hints.push({
      id: "speed-below-target",
      severity: "warning",
      message:
        `Average per-agreement speed (${windowLabel}) is ${Math.round(w.avgSpeed)} H/s, below the ` +
        `enforced ${speedTarget} H/s. This is usually capacity split across too many ` +
        "concurrent agreements rather than pricing — reduce parallel agreements or add CPU.",
      data: { avgSpeed: w.avgSpeed, speedTarget },
    });
  }

  const lastSeen = s.stats.lastSeen ? Date.parse(s.stats.lastSeen) : null;
  if (lastSeen === null || Date.now() - lastSeen > 24 * 3600_000) {
    hints.push({
      id: "stale",
      severity: "info",
      message:
        "No agreements with this fleet in the last 24h — stats and hints may be outdated.",
    });
  }

  if (hints.length === 0) {
    hints.push({
      id: "ok",
      severity: "info",
      message: "Meeting all enforced targets — no action needed.",
    });
  }
  return hints;
}

export function portalProviderReport(s: ProviderSummary): PortalProviderReport {
  const { key, w } = pickWindow(s);
  return {
    providerId: s.providerId,
    name: s.name,
    score: s.score,
    category: s.category,
    statsGolemUrl: s.statsGolemUrl,
    status: {
      banned: s.stats.activeBan !== null,
      activeBan: s.stats.activeBan,
      bansLast24h: s.stats.dailyBans,
      nextBanHours: s.stats.nextBanHours,
      lastBanAt: s.stats.lastBanAt,
      lastBanReason: s.stats.lastBanReason,
      activeAgreements: s.stats.activeNow,
      lastSeen: s.stats.lastSeen,
    },
    targets: {
      efficiencyTarget: s.targets.efficiencyTarget,
      speedTarget: s.targets.speedTarget,
      relaxed: s.targets.override,
    },
    performance: {
      window: key,
      agreements: w.agreements,
      workHashes: w.work,
      costGlm: w.cost,
      hours: w.hours,
      efficiencyThPerGlm: w.efficiency,
      avgSpeedHps: w.avgSpeed,
      avgCostPerHourGlm: w.avgCostPerHour,
      bans: w.bans,
    },
    pricing: s.hw
      ? {
          priceCpuHour: s.hw.priceCpuHour,
          priceEnvHour: s.hw.priceEnvHour,
          priceStart: s.hw.priceStart,
          monthlyPriceGlm: s.hw.monthlyPriceGlm,
          fetchedAt: s.hw.fetchedAt,
        }
      : null,
    hints: buildHints(s, key, w),
    timestamp: new Date().toISOString(),
  };
}
