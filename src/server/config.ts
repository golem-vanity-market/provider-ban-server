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

  // Periodic fleet-wide ban reset: every N hours revoke all active bans and
  // clear every stone's local list (which also zeroes the escalation clocks,
  // since revoked bans count nowhere). 0 disables.
  banResetIntervalHours: num("BAN_RESET_INTERVAL_HOURS", 4),

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

  // The gatherer splits its 7-day history across two files (cold + recent) so
  // it does not rewrite the whole thing every minute; seed reads both.
  seedEstimatorsPath: str(
    "SEED_ESTIMATORS_PATH",
    "/home/ubuntu/golem-vanity-market/vanity-nodes-gatherer/estimators.json",
  ),
  seedEstimatorsHotPath: str(
    "SEED_ESTIMATORS_HOT_PATH",
    "/home/ubuntu/golem-vanity-market/vanity-nodes-gatherer/estimators-hot.json",
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

  // Rotation scheduler (the ban system's replacement): /api/v1/ranking serves
  // per-provider lottery weight, session TTL and rest state to the stones.
  // Score v2 (no ban terms): efficiency 40% / session reliability 25% /
  // volume 15% / speed 10% / freshness 10%. Tier thresholds on that score.
  rotTierA: num("ROT_TIER_A", 70),
  rotTierB: num("ROT_TIER_B", 40),
  rotTierC: num("ROT_TIER_C", 20),
  // Lottery weight = max(eps, (score/100)^gamma); "new" providers (not
  // enough measured hours yet) get a fixed exploration weight instead.
  rotWeightEps: num("ROT_WEIGHT_EPS", 0.05),
  rotWeightGamma: num("ROT_WEIGHT_GAMMA", 2),
  rotNewWeight: num("ROT_NEW_WEIGHT", 0.1),
  // Confidence gate: below this many measured hours in 7d a provider is
  // "new" — audition-length sessions regardless of provisional score.
  rotConfMinHours7d: num("ROT_CONF_MIN_HOURS_7D", 2),
  // Session TTL minutes per tier (0 = run until the 6h cycle restart) and
  // rest minutes started when a provider's session ends.
  rotTtlA: num("ROT_TTL_A_MIN", 0),
  rotTtlB: num("ROT_TTL_B_MIN", 120),
  rotTtlC: num("ROT_TTL_C_MIN", 45),
  rotTtlD: num("ROT_TTL_D_MIN", 15),
  rotTtlNew: num("ROT_TTL_NEW_MIN", 20),
  rotRestA: num("ROT_REST_A_MIN", 0),
  rotRestB: num("ROT_REST_B_MIN", 10),
  rotRestC: num("ROT_REST_C_MIN", 60),
  rotRestD: num("ROT_REST_D_MIN", 240),
  rotRestNew: num("ROT_REST_NEW_MIN", 45),
  // A provider whose newest agreement updated within this window is treated
  // as holding a slot right now (> the 4 min debit-note interval, so a
  // zero-work session doesn't flicker in and out of "active").
  rotActiveSecs: num("ROT_ACTIVE_SECS", 360),
  // Max concurrent slots per operator payout wallet (the anti-oversubscription
  // lever — score is per identity and identities are cheap, the wallet isn't).
  rotWalletMaxActive: num("ROT_WALLET_MAX_ACTIVE", 5),
  // What the stones should assume for providers the ranking has never seen:
  // a modest exploration weight and an audition-length TTL.
  rotUnknownWeight: num("ROT_UNKNOWN_WEIGHT", 0.3),
  rotUnknownTtlMin: num("ROT_UNKNOWN_TTL_MIN", 20),
  // Only providers seen within this window are listed (absent = unknown).
  rotSeenDays: num("ROT_SEEN_DAYS", 30),

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
