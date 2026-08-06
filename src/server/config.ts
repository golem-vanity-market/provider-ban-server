function num(name: string, def: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function str(name: string, def: string): string {
  const v = process.env[name];
  return v === undefined || v === "" ? def : v;
}

export const config = {
  port: num("PORT", 7710),
  host: str("HOST", "127.0.0.1"),
  dbPath: str("DB_PATH", "data/banserver.sqlite"),

  // Escalating bans: the Nth ban of a provider's day lasts N hours (1h, 2h,
  // 3h, ...), counted over the last 24h (non-revoked bans only), capped here.
  banMaxHours: num("BAN_MAX_HOURS", 24),

  collectIntervalSecs: num("COLLECT_INTERVAL_SECS", 30),
  nodesFile: str(
    "NODES_FILE",
    "/home/ubuntu/golem-vanity-market/vanity-nodes-orchestrator/nodes.json",
  ),
  nodesUrl: str("NODES_URL", "https://stone.vanity.market/expose/nodes.json"),
  // Stones run on this box at 6200 + N; fall back to the public proxy.
  stonePortBase: num("STONE_PORT_BASE", 6200),
  stonePublicBase: str(
    "STONE_PUBLIC_BASE",
    "https://stone.vanity.market/nmpdmxzhrm",
  ),

  seedEstimatorsPath: str(
    "SEED_ESTIMATORS_PATH",
    "/home/ubuntu/golem-vanity-market/vanity-nodes-gatherer/estimators.json",
  ),

  // Fleet-wide enforcement targets served to the stones when no explicit
  // global target is set in the UI. Keep in sync with the stones' .env
  // (EFFICIENCY_LOWER_THRESHOLD / SPEED_LOWER_THRESHOLD).
  defaultEfficiencyTarget: num("DEFAULT_EFFICIENCY_TARGET", 0.05), // TH/GLM
  defaultSpeedTarget: num("DEFAULT_SPEED_TARGET", 500_000), // H/s

  // Auto-relax: proven providers (enough recent work at well-above-baseline
  // efficiency) automatically get their enforcement targets lowered to
  // global / autoRelaxDivisor, and lose the relaxation when they stop
  // qualifying. Manual overrides are never touched.
  autoRelaxEnabled: num("AUTO_RELAX_ENABLED", 1) !== 0,
  autoRelaxMinWork24h: num("AUTO_RELAX_MIN_WORK_24H", 100e9), // hashes
  autoRelaxEffFactor: num("AUTO_RELAX_EFF_FACTOR", 2), // × global eff target
  autoRelaxDivisor: num("AUTO_RELAX_DIVISOR", 2),

  // Scoring / categorization knobs.
  effTarget: num("EFF_TARGET", 0.15), // TH/GLM considered "full marks"
  volumeTargetHours: num("VOLUME_TARGET_HOURS", 200),
  trustedMinHours: num("TRUSTED_MIN_HOURS", 50),
  trustedMinScore: num("TRUSTED_MIN_SCORE", 75),
  reliableMinScore: num("RELIABLE_MIN_SCORE", 60),
  averageMinScore: num("AVERAGE_MIN_SCORE", 40),
  blacklistBans7d: num("BLACKLIST_BANS_7D", 5),
  newMaxAgreements: num("NEW_MAX_AGREEMENTS", 3),

  // Invoice/payment ingestion from the stones' yagna daemons (payment API).
  // The daemons keep little history (their data dirs are recreated on
  // redeploys), so the ban server persists everything it sees. Appkeys and
  // API urls are read from each stone's vanity/.env under yagnaServicesDir.
  yagnaEnabled: num("YAGNA_ENABLED", 1) !== 0,
  yagnaServicesDir: str(
    "YAGNA_SERVICES_DIR",
    "/home/ubuntu/golem-vanity-market/vanity-nodes-deployer/services",
  ),
  yagnaPollSecs: num("YAGNA_POLL_SECS", 60),
  // Re-fetch window: invoices keep their issue timestamp while their status
  // advances (RECEIVED -> ACCEPTED -> SETTLED), so each poll re-reads this
  // many hours back and upserts to catch status changes.
  yagnaLookbackHours: num("YAGNA_LOOKBACK_HOURS", 72),
  yagnaMaxItems: num("YAGNA_MAX_ITEMS", 2000),

  // Hardware/price-list scraping from stats.golem.network provider pages.
  statsHwEnabled: num("STATS_HW_ENABLED", 1) !== 0,
  statsHwTtlHours: num("STATS_HW_TTL_HOURS", 12),
  statsHwPerCycle: num("STATS_HW_PER_CYCLE", 8),

  statsGolemProviderUrl: str(
    "STATS_GOLEM_PROVIDER_URL",
    "https://stats.golem.network/network/provider/",
  ),

  staticDir: str("STATIC_DIR", "dist"),
};

export type Config = typeof config;
