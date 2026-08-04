// Shared API types between the Bun backend and the Vite frontend.

export type ProviderCategory =
  | "banned"
  | "blacklisted"
  | "trusted"
  | "reliable"
  | "average"
  | "underperformer"
  | "new";

export type WindowKey = "d1" | "d7" | "d30" | "all";

export interface ScoreBreakdown {
  efficiency: number; // 0..1
  reliability: number; // 0..1
  volume: number; // 0..1
  banRecency: number; // 0..1
  freshness: number; // 0..1
}

/** Stats measured inside one history window (24h / 7d / 30d / all time). */
export interface WindowStats {
  agreements: number;
  work: number; // attempts (hashes)
  cost: number; // GLM
  hours: number; // rented hours
  efficiency: number | null; // TH per GLM inside the window
  avgCostPerHour: number | null; // GLM/h
  avgSpeed: number | null; // H/s
  bans: number; // bans issued inside the window
}

/** The provider's most recent agreement and what it delivered. */
export interface LastAgreementInfo {
  agreementId: string;
  node: string | null;
  lastUpdated: string | null;
  work: number; // attempts (hashes)
  successes: number; // PoWs delivered
  durationHours: number;
}

export interface ProviderStats {
  windows: Record<WindowKey, WindowStats>;
  successes: number;
  lastAgreement: LastAgreementInfo | null;
  firstSeen: string | null;
  lastSeen: string | null;
  bansTotal: number;
  bans7d: number;
  lastBanAt: string | null;
  activeBan: ActiveBanInfo | null;
}

export interface ActiveBanInfo {
  id: number;
  source: string;
  reason: string | null;
  bannedAt: string;
  expiresAt: string;
}

/** Enforcement targets: below these a stone terminates the agreement and
 *  bans the provider. Effective value = per-provider override ?? global. */
export interface EffectiveTargets {
  efficiencyTarget: number; // TH/GLM
  speedTarget: number; // H/s
  override: boolean; // true when a per-provider override applies
  note: string | null;
}

export interface TargetOverride {
  providerId: string; // '*' for the global target
  efficiencyTarget: number | null;
  speedTarget: number | null;
  note: string | null;
  updatedAt: string;
}

export interface TargetsResponse {
  // The resolved global target (explicit '*' row or the server defaults).
  global: { efficiencyTarget: number; speedTarget: number; explicit: boolean };
  overrides: TargetOverride[]; // per-provider rows (never contains '*')
  timestamp: string;
}

export interface ProviderSummary {
  providerId: string;
  name: string | null;
  score: number; // 0..100 (always computed from full history)
  scoreBreakdown: ScoreBreakdown;
  category: ProviderCategory;
  stats: ProviderStats;
  targets: EffectiveTargets;
  statsGolemUrl: string;
}

export interface AgreementRow {
  agreementId: string;
  providerId: string;
  node: string | null;
  startedAt: string | null;
  lastUpdated: string | null;
  work: number;
  cost: number;
  efficiency: number | null; // TH/GLM for this agreement
  speed: number | null; // H/s
  costPerHour: number | null; // GLM/h (the price)
  durationHours: number;
  successes: number;
}

export interface BanRow {
  id: number;
  providerId: string;
  providerName: string | null;
  source: string;
  reason: string | null;
  agreementId: string | null;
  bannedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  active: boolean;
}

export interface DailyStat {
  day: string; // YYYY-MM-DD
  agreements: number;
  work: number;
  cost: number;
  hours: number;
}

export interface ProviderDetail extends ProviderSummary {
  agreements: AgreementRow[];
  agreementsTotal: number;
  bans: BanRow[];
  daily: DailyStat[];
}

/** Fleet-level totals inside one history window. */
export interface FleetWindow {
  agreements: number;
  work: number;
  cost: number;
  hours: number;
  bans: number;
  providersActive: number;
}

export interface FleetSummary {
  providersTotal: number;
  activeBans: number;
  windows: Record<WindowKey, FleetWindow>;
  categories: Record<ProviderCategory, number>;
  nodes: NodeStatus[];
  banDurationHours: number;
  collectedAt: string | null;
}

export interface NodeStatus {
  node: string;
  ok: boolean;
  activeEstimators: number;
  bannedReported: number;
  lastError: string | null;
  lastSuccessAt: string | null;
}

export interface ActiveBansResponse {
  bannedProviders: string[];
  count: number;
  timestamp: string;
  bans: BanRow[];
}
