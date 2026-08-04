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

  // OPERATIONS.md 6b: a failing provider waits 8 hours until its next chance
  // anywhere in the fleet.
  banDurationHours: num("BAN_DURATION_HOURS", 8),

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
  defaultEfficiencyTarget: num("DEFAULT_EFFICIENCY_TARGET", 0.07), // TH/GLM
  defaultSpeedTarget: num("DEFAULT_SPEED_TARGET", 500_000), // H/s

  // Scoring / categorization knobs.
  effTarget: num("EFF_TARGET", 0.15), // TH/GLM considered "full marks"
  volumeTargetHours: num("VOLUME_TARGET_HOURS", 200),
  trustedMinHours: num("TRUSTED_MIN_HOURS", 50),
  trustedMinScore: num("TRUSTED_MIN_SCORE", 75),
  reliableMinScore: num("RELIABLE_MIN_SCORE", 60),
  averageMinScore: num("AVERAGE_MIN_SCORE", 40),
  blacklistBans7d: num("BLACKLIST_BANS_7D", 5),
  newMaxAgreements: num("NEW_MAX_AGREEMENTS", 3),

  statsGolemProviderUrl: str(
    "STATS_GOLEM_PROVIDER_URL",
    "https://stats.golem.network/network/provider/",
  ),

  staticDir: str("STATIC_DIR", "dist"),
};

export type Config = typeof config;
