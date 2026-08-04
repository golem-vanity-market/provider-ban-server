import { existsSync } from "node:fs";
import { join, normalize } from "node:path";
import { config } from "./config.ts";
import type { Store } from "./db.ts";
import type { Collector } from "./collector.ts";
import { summarizeProvider } from "./scoring.ts";
import type {
  ActiveBansResponse,
  BanRow,
  EffectiveTargets,
  FleetSummary,
  ProviderCategory,
  ProviderDetail,
  ProviderSummary,
  TargetsResponse,
} from "../shared/types.ts";

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

const sendJSON = (status: number, data: unknown): Response =>
  new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });

interface DbBanRow {
  id: number;
  provider_id: string;
  name: string | null;
  source: string;
  reason: string | null;
  agreement_id: string | null;
  banned_at: string;
  expires_at: string;
  revoked_at?: string | null;
}

function toBanRow(r: DbBanRow): BanRow {
  const revokedAt = r.revoked_at ?? null;
  return {
    id: r.id,
    providerId: r.provider_id,
    providerName: r.name,
    source: r.source,
    reason: r.reason,
    agreementId: r.agreement_id,
    bannedAt: r.banned_at,
    expiresAt: r.expires_at,
    revokedAt,
    active: revokedAt === null && Date.parse(r.expires_at) > Date.now(),
  };
}

interface DbAgreementRow {
  agreement_id: string;
  provider_id: string;
  node: string | null;
  started_at: string | null;
  last_updated: string | null;
  work: number;
  cost: number;
  efficiency: number | null;
  speed: number | null;
  cost_per_hour: number | null;
  duration_hours: number;
  successes: number;
}

function toAgreementRow(r: DbAgreementRow) {
  return {
    agreementId: r.agreement_id,
    providerId: r.provider_id,
    node: r.node,
    startedAt: r.started_at,
    lastUpdated: r.last_updated,
    work: r.work,
    cost: r.cost,
    efficiency: r.efficiency,
    speed: r.speed,
    costPerHour: r.cost_per_hour,
    durationHours: r.duration_hours,
    successes: r.successes,
  };
}

interface TargetsIndex {
  global: TargetsResponse["global"];
  overrides: TargetsResponse["overrides"];
  effectiveFor: (providerId: string) => EffectiveTargets;
}

function targetsIndex(store: Store): TargetsIndex {
  const rows = store.listTargets();
  const globalRow = rows.find((r) => r.provider_id === "*");
  const global = {
    efficiencyTarget:
      globalRow?.efficiency_target ?? config.defaultEfficiencyTarget,
    speedTarget: globalRow?.speed_target ?? config.defaultSpeedTarget,
    explicit: globalRow !== undefined,
  };
  const perProvider = rows.filter((r) => r.provider_id !== "*");
  const map = new Map(perProvider.map((r) => [r.provider_id, r]));
  return {
    global,
    overrides: perProvider.map((r) => ({
      providerId: r.provider_id,
      efficiencyTarget: r.efficiency_target,
      speedTarget: r.speed_target,
      note: r.note,
      auto: r.auto === 1,
      updatedAt: r.updated_at,
    })),
    effectiveFor: (providerId: string): EffectiveTargets => {
      const o = map.get(providerId);
      return {
        efficiencyTarget: o?.efficiency_target ?? global.efficiencyTarget,
        speedTarget: o?.speed_target ?? global.speedTarget,
        override:
          o !== undefined &&
          (o.efficiency_target != null || o.speed_target != null),
        auto: o?.auto === 1,
        note: o?.note ?? null,
      };
    },
  };
}

// Provider summaries are recomputed at most every 15 seconds.
let summariesCache: { at: number; list: ProviderSummary[] } | null = null;

function providerSummaries(store: Store): ProviderSummary[] {
  if (summariesCache && Date.now() - summariesCache.at < 15_000) {
    return summariesCache.list;
  }
  const targets = targetsIndex(store);
  const list = store
    .providerAggregates()
    .map((row) => summarizeProvider(row, targets.effectiveFor(row.provider_id)));
  summariesCache = { at: Date.now(), list };
  return list;
}

export function invalidateSummaries(): void {
  summariesCache = null;
}

const startedAt = Date.now();

export function createHandler(store: Store, collector: Collector) {
  return async function handler(req: Request): Promise<Response> {
    const url = new URL(req.url);
    let pathname = url.pathname;

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: JSON_HEADERS });
    }

    // Allow the API to be mounted behind a path-stripping or path-keeping
    // proxy: /nmpdmxzhrm/ban-server/api/... arrives either way.
    const apiIdx = pathname.indexOf("/api/v1/");
    if (apiIdx > 0) pathname = pathname.slice(apiIdx);

    try {
      if (pathname.startsWith("/api/v1/")) {
        return await handleApi(req, url, pathname.slice("/api/v1".length));
      }
      // Compatibility endpoint mirroring the stone requestor API shape.
      if (req.method === "GET" && pathname.endsWith("/providers/banned")) {
        const bans = store.activeBans();
        return sendJSON(200, {
          bannedProviders: [...new Set(bans.map((b) => b.provider_id))],
          timestamp: new Date().toISOString(),
        });
      }
      return serveStatic(pathname);
    } catch (e) {
      console.error("[api] error handling", pathname, e);
      return sendJSON(500, { error: "Internal Server Error" });
    }
  };

  async function handleApi(
    req: Request,
    url: URL,
    path: string,
  ): Promise<Response> {
    const q = url.searchParams;

    if (req.method === "GET" && path === "/health") {
      return sendJSON(200, {
        status: "ok",
        uptimeSecs: Math.round((Date.now() - startedAt) / 1000),
        lastCollectedAt: collector.lastCollectedAt,
        agreements: store.agreementCount(),
        timestamp: new Date().toISOString(),
      });
    }

    if (req.method === "GET" && path === "/summary") {
      const counts = store.fleetCounts();
      const categories: Record<ProviderCategory, number> = {
        banned: 0,
        blacklisted: 0,
        trusted: 0,
        reliable: 0,
        average: 0,
        underperformer: 0,
        new: 0,
      };
      for (const p of providerSummaries(store)) categories[p.category]++;
      const summary: FleetSummary = {
        providersTotal: counts.providersTotal,
        activeBans: counts.activeBans,
        windows: counts.windows,
        categories,
        nodes: [...collector.nodeStatus.values()].sort((a, b) =>
          a.node.localeCompare(b.node, undefined, { numeric: true }),
        ),
        banDurationHours: config.banDurationHours,
        collectedAt: collector.lastCollectedAt,
      };
      return sendJSON(200, summary);
    }

    if (req.method === "GET" && path === "/bans/active") {
      const bans = store.activeBans();
      const resp: ActiveBansResponse = {
        bannedProviders: [...new Set(bans.map((b) => b.provider_id))],
        count: bans.length,
        timestamp: new Date().toISOString(),
        bans: bans.map((b) => toBanRow(b as DbBanRow)),
      };
      return sendJSON(200, resp);
    }

    if (req.method === "GET" && path === "/bans") {
      const limit = Math.min(Number(q.get("limit") ?? 100), 1000);
      const offset = Math.max(Number(q.get("offset") ?? 0), 0);
      const providerId = q.get("providerId")?.toLowerCase() ?? undefined;
      const sinceHoursRaw = Number(q.get("sinceHours"));
      const since =
        Number.isFinite(sinceHoursRaw) && sinceHoursRaw > 0
          ? new Date(Date.now() - sinceHoursRaw * 3600_000).toISOString()
          : undefined;
      const { rows, total } = store.banHistory({
        providerId,
        since,
        limit,
        offset,
      });
      return sendJSON(200, {
        bans: (rows as DbBanRow[]).map(toBanRow),
        total,
        limit,
        offset,
      });
    }

    if (req.method === "POST" && path === "/bans") {
      let body: {
        providerId?: string;
        reason?: string;
        source?: string;
        agreementId?: string;
        durationHours?: number;
      };
      try {
        body = (await req.json()) as typeof body;
      } catch {
        return sendJSON(400, { error: "Invalid JSON" });
      }
      const providerId = body.providerId?.toLowerCase();
      if (!providerId || !/^0x[0-9a-f]{40}$/.test(providerId)) {
        return sendJSON(400, {
          error: "providerId must be a 0x-prefixed 40-hex-char id",
        });
      }
      const source = (body.source ?? "api").slice(0, 64);
      const durationHours =
        typeof body.durationHours === "number" &&
        body.durationHours > 0 &&
        body.durationHours <= 24 * 30
          ? body.durationHours
          : undefined;
      if (store.hasActiveBan(providerId, source)) {
        return sendJSON(200, {
          message: "Provider already banned by this source",
          alreadyBanned: true,
        });
      }
      const id = store.insertBan({
        providerId,
        source,
        reason: body.reason?.slice(0, 500) ?? null,
        agreementId: body.agreementId?.slice(0, 128) ?? null,
        durationHours,
      });
      invalidateSummaries();
      return sendJSON(201, { id, message: "Ban recorded" });
    }

    const revokeMatch = path.match(/^\/bans\/(\d+)(\/revoke)?$/);
    if (
      revokeMatch &&
      (req.method === "DELETE" ||
        (req.method === "POST" && revokeMatch[2] === "/revoke"))
    ) {
      const ok = store.revokeBan(Number(revokeMatch[1]));
      invalidateSummaries();
      return ok
        ? sendJSON(200, { message: "Ban revoked" })
        : sendJSON(404, { error: "Active ban not found" });
    }

    if (req.method === "GET" && path === "/targets") {
      const t = targetsIndex(store);
      const resp: TargetsResponse = {
        global: t.global,
        overrides: t.overrides,
        timestamp: new Date().toISOString(),
      };
      return sendJSON(200, resp);
    }

    const targetMatch = path.match(/^\/targets\/(global|0x[0-9a-fA-F]{40})$/);
    if (targetMatch && (req.method === "PUT" || req.method === "POST")) {
      let body: {
        efficiencyTarget?: number | null;
        speedTarget?: number | null;
        note?: string | null;
      };
      try {
        body = (await req.json()) as typeof body;
      } catch {
        return sendJSON(400, { error: "Invalid JSON" });
      }
      const check = (v: number | null | undefined, max: number): boolean =>
        v == null || (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max);
      if (!check(body.efficiencyTarget, 1000) || !check(body.speedTarget, 1e12)) {
        return sendJSON(400, {
          error:
            "efficiencyTarget (TH/GLM) and speedTarget (H/s) must be non-negative numbers or null",
        });
      }
      const isGlobal = targetMatch[1] === "global";
      if (isGlobal && (body.efficiencyTarget == null || body.speedTarget == null)) {
        return sendJSON(400, {
          error: "The global target needs both efficiencyTarget and speedTarget",
        });
      }
      store.setTarget({
        providerId: isGlobal ? "*" : targetMatch[1].toLowerCase(),
        efficiencyTarget: body.efficiencyTarget ?? null,
        speedTarget: body.speedTarget ?? null,
        note: body.note?.slice(0, 500) ?? null,
      });
      invalidateSummaries();
      return sendJSON(200, { message: "Target set" });
    }

    if (targetMatch && req.method === "DELETE") {
      if (targetMatch[1] === "global") {
        store.deleteTarget("*"); // fall back to the server defaults
        invalidateSummaries();
        return sendJSON(200, { message: "Global target reset to defaults" });
      }
      const ok = store.deleteTarget(targetMatch[1].toLowerCase());
      invalidateSummaries();
      return ok
        ? sendJSON(200, { message: "Override removed" })
        : sendJSON(404, { error: "No override for this provider" });
    }

    if (req.method === "GET" && path === "/providers") {
      let list = providerSummaries(store);
      // seen=1d|7d|30d|all - keep only providers seen within that period
      const seenParam = q.get("seen") ?? "all";
      const seenHours = { "1d": 24, "7d": 7 * 24, "30d": 30 * 24 }[seenParam];
      if (seenHours !== undefined) {
        const cutoff = Date.now() - seenHours * 3600_000;
        list = list.filter(
          (p) => p.stats.lastSeen && Date.parse(p.stats.lastSeen) > cutoff,
        );
      }
      const search = q.get("search")?.toLowerCase();
      if (search) {
        list = list.filter(
          (p) =>
            p.providerId.includes(search) ||
            (p.name ?? "").toLowerCase().includes(search),
        );
      }
      const category = q.get("category");
      if (category) list = list.filter((p) => p.category === category);
      const sort = q.get("sort") ?? "score";
      const dir = q.get("dir") === "asc" ? 1 : -1;
      const windowParam = q.get("window") ?? "1d";
      const windowKey = (
        { "1d": "d1", "7d": "d7", "30d": "d30", all: "all" } as const
      )[windowParam] ?? "d1";
      const key = (p: ProviderSummary): number | string => {
        const w = p.stats.windows[windowKey];
        switch (sort) {
          case "name":
            return p.name ?? "";
          case "efficiency":
            return w.efficiency ?? -1;
          case "work":
            return w.work;
          case "cost":
            return w.cost;
          case "hours":
            return w.hours;
          case "agreements":
            return w.agreements;
          case "bans":
            return w.bans;
          case "lastSeen":
            return p.stats.lastSeen ?? "";
          case "lastAgreement":
            return p.stats.lastAgreement?.lastUpdated ?? "";
          default:
            return p.score;
        }
      };
      list = [...list].sort((a, b) => {
        const ka = key(a);
        const kb = key(b);
        if (ka < kb) return -1 * dir;
        if (ka > kb) return 1 * dir;
        return 0;
      });
      const total = list.length;
      const limit = Math.min(Number(q.get("limit") ?? 100), 2000);
      const offset = Math.max(Number(q.get("offset") ?? 0), 0);
      return sendJSON(200, {
        providers: list.slice(offset, offset + limit),
        total,
        limit,
        offset,
        timestamp: new Date().toISOString(),
      });
    }

    const provMatch = path.match(/^\/providers\/(0x[0-9a-fA-F]{40})$/);
    if (req.method === "GET" && provMatch) {
      const id = provMatch[1].toLowerCase();
      const agg = store.providerAggregates(id);
      if (agg.length === 0)
        return sendJSON(404, { error: "Provider not found" });
      const summary = summarizeProvider(agg[0], targetsIndex(store).effectiveFor(id));
      const limit = Math.min(Number(q.get("limit") ?? 50), 500);
      const offset = Math.max(Number(q.get("offset") ?? 0), 0);
      const { rows, total } = store.agreementsForProvider(id, limit, offset);
      const bans = store.banHistory({ providerId: id, limit: 50, offset: 0 });
      const detail: ProviderDetail = {
        ...summary,
        agreements: (rows as DbAgreementRow[]).map(toAgreementRow),
        agreementsTotal: total,
        bans: (bans.rows as DbBanRow[]).map(toBanRow),
        daily: store.dailyStats(id, 30) as ProviderDetail["daily"],
      };
      return sendJSON(200, detail);
    }

    const provAgrMatch = path.match(
      /^\/providers\/(0x[0-9a-fA-F]{40})\/agreements$/,
    );
    if (req.method === "GET" && provAgrMatch) {
      const id = provAgrMatch[1].toLowerCase();
      const limit = Math.min(Number(q.get("limit") ?? 50), 500);
      const offset = Math.max(Number(q.get("offset") ?? 0), 0);
      const { rows, total } = store.agreementsForProvider(id, limit, offset);
      return sendJSON(200, {
        agreements: (rows as DbAgreementRow[]).map(toAgreementRow),
        total,
        limit,
        offset,
      });
    }

    return sendJSON(404, { error: "Not Found" });
  }

  function serveStatic(pathname: string): Response {
    // Static UI (the Vite build). Also reachable behind the hidden path.
    let rel = pathname;
    const hiddenIdx = rel.indexOf("/", 1);
    if (rel !== "/" && !existsSync(join(config.staticDir, rel.slice(1)))) {
      // allow /<hidden-prefix>/asset paths by stripping the first segment
      if (hiddenIdx > 0) rel = rel.slice(hiddenIdx);
    }
    if (rel === "/" || rel === "") rel = "/index.html";
    const safe = normalize(rel).replace(/^([./\\])+/, "");
    let filePath = join(config.staticDir, safe);
    if (!existsSync(filePath)) {
      filePath = join(config.staticDir, "index.html");
      if (!existsSync(filePath)) {
        return sendJSON(404, { error: "Not Found (UI not built)" });
      }
    }
    return new Response(Bun.file(filePath), {
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  }
}
