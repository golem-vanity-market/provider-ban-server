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
  activeNow: number; // agreements computing right now (estimator updated <2.5 min ago)
  successes: number;
  lastAgreement: LastAgreementInfo | null;
  firstSeen: string | null;
  lastSeen: string | null;
  bansTotal: number;
  bans7d: number;
  dailyBans: number; // non-revoked bans in the last 24h (escalation counter)
  nextBanHours: number; // duration the provider's next ban would get
  lastBanAt: string | null;
  lastBanReason: string | null; // reason of the most recent ban (any status)
  lastBanSource: string | null;
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
  auto: boolean; // override was set by the auto-relax tuner, not a human
  note: string | null;
}

export interface TargetOverride {
  providerId: string; // '*' for the global target
  efficiencyTarget: number | null;
  speedTarget: number | null;
  note: string | null;
  auto: boolean;
  updatedAt: string;
}

export interface TargetsResponse {
  // The resolved global target (explicit '*' row or the server defaults).
  global: { efficiencyTarget: number; speedTarget: number; explicit: boolean };
  overrides: TargetOverride[]; // per-provider rows (never contains '*')
  timestamp: string;
}

/** Hardware + offered price list, scraped from stats.golem.network. */
export interface ProviderHw {
  cpuBrand: string | null;
  cpuCores: number | null;
  cpuThreads: number | null;
  memGib: number | null;
  storageGib: number | null;
  monthlyPriceGlm: number | null; // stats.golem.network's own monthly quote
  priceEnvHour: number | null; // GLM/h for the environment (duration coeff)
  priceCpuHour: number | null; // GLM/h per busy CPU thread (cpu_sec coeff)
  priceStart: number | null; // fixed start fee in GLM
  online: boolean | null;
  wallet: string | null; // operator payout wallet
  fetchedAt: string;
}

export interface ProviderSummary {
  providerId: string;
  name: string | null;
  score: number; // 0..100 (always computed from full history)
  scoreBreakdown: ScoreBreakdown;
  category: ProviderCategory;
  stats: ProviderStats;
  targets: EffectiveTargets;
  hw: ProviderHw | null; // null until fetched from stats.golem.network
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
  banMaxHours: number; // escalating bans: 1h, 2h, ... capped here
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

/** One provider's computed/invoiced/paid numbers inside a window
 *  (Operators tab). Money from the yagna payment API; work/cost from the
 *  estimator history. */
export interface OperatorProviderReport {
  providerId: string;
  name: string | null;
  lastSeen: string | null;
  agreements: number;
  work: number; // attempts (hashes)
  cost: number; // GLM accrued per the estimators (debit notes)
  hours: number;
  efficiency: number | null; // TH/GLM inside the window
  invoiceCount: number;
  invoiced: number; // GLM invoiced by the provider
  accepted: number; // GLM in ACCEPTED or SETTLED invoices
  settled: number; // GLM in SETTLED (actually paid) invoices
  lastInvoiceAt: string | null;
}

export interface OperatorReport {
  wallet: string | null; // null = providers with no known payout wallet yet
  providers: OperatorProviderReport[];
  agreements: number;
  work: number;
  cost: number;
  hours: number;
  efficiency: number | null;
  invoiceCount: number;
  invoiced: number;
  accepted: number;
  settled: number;
  /** On-chain GLM transferred to this wallet inside the window (payments
   *  are batched per wallet, so this exists only at the operator level). */
  paid: number;
}

export interface OperatorsResponse {
  operators: OperatorReport[];
  totals: {
    operators: number;
    providers: number;
    work: number;
    cost: number;
    invoiced: number;
    accepted: number;
    settled: number;
    paid: number;
  };
  timestamp: string;
}

export interface ActiveBansResponse {
  bannedProviders: string[];
  count: number;
  timestamp: string;
  bans: BanRow[];
}

/** One actionable hint shown to a provider on the public stats portal. */
export interface PortalHint {
  id:
    | "banned"
    | "ban-escalation"
    | "price-too-high"
    | "headroom"
    | "speed-below-target"
    | "stale"
    | "ok";
  severity: "info" | "warning" | "critical";
  message: string;
  data?: Record<string, number | string | null>;
}

/** Compact per-provider report for the public stats portal
 *  (GET /api/v1/portal/providers/:id). Field names carry their units. */
export interface PortalProviderReport {
  providerId: string;
  name: string | null;
  score: number;
  category: ProviderCategory;
  statsGolemUrl: string;
  status: {
    banned: boolean;
    activeBan: ActiveBanInfo | null;
    bansLast24h: number;
    nextBanHours: number;
    lastBanAt: string | null;
    lastBanReason: string | null;
    activeAgreements: number;
    lastSeen: string | null;
  };
  targets: {
    efficiencyTarget: number; // TH/GLM
    speedTarget: number; // H/s
    relaxed: boolean; // a per-provider override applies
  };
  performance: {
    window: WindowKey; // freshest window with billing data
    agreements: number;
    workHashes: number;
    costGlm: number;
    hours: number;
    efficiencyThPerGlm: number | null;
    avgSpeedHps: number | null;
    avgCostPerHourGlm: number | null;
    bans: number;
  };
  pricing: {
    priceCpuHour: number | null; // GLM/h per busy CPU thread
    priceEnvHour: number | null; // GLM/h for the environment
    priceStart: number | null; // fixed start fee, GLM
    monthlyPriceGlm: number | null;
    fetchedAt: string;
  } | null;
  hints: PortalHint[];
  timestamp: string;
}
