// Shared API types between the Bun backend and the Vite frontend.

export type ProviderCategory =
  | "banned"
  | "blacklisted"
  | "trusted"
  | "reliable"
  | "average"
  | "underperformer"
  | "new";

export interface ScoreBreakdown {
  efficiency: number; // 0..1
  reliability: number; // 0..1
  volume: number; // 0..1
  banRecency: number; // 0..1
  freshness: number; // 0..1
}

export interface ProviderStats {
  agreements: number;
  agreements24h: number;
  totalWork: number; // attempts (hashes)
  totalWork24h: number;
  totalCost: number; // GLM
  totalCost24h: number;
  totalHours: number; // rented hours
  totalHours24h: number;
  successes: number;
  efficiency: number | null; // lifetime TH per GLM
  avgCostPerHour: number | null; // GLM/h
  avgSpeed: number | null; // H/s
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

export interface ProviderSummary {
  providerId: string;
  name: string | null;
  score: number; // 0..100
  scoreBreakdown: ScoreBreakdown;
  category: ProviderCategory;
  stats: ProviderStats;
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

export interface FleetSummary {
  providersTotal: number;
  providersActive24h: number;
  activeBans: number;
  bans24h: number;
  agreementsTotal: number;
  agreements24h: number;
  work24h: number;
  cost24h: number;
  hours24h: number;
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
