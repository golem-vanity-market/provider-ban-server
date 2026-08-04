import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config.ts";

export interface AgreementUpsert {
  agreementId: string;
  providerId: string;
  providerName: string | null;
  node: string | null;
  startedAt: string | null;
  lastUpdated: string | null;
  work: number;
  cost: number;
  efficiency: number | null;
  speed: number | null;
  costPerHour: number | null;
  durationHours: number;
  successes: number;
}

export interface ProviderAggRow {
  provider_id: string;
  name: string | null;
  first_seen: string | null;
  last_seen: string | null;
  agreements: number;
  agreements_24h: number;
  total_work: number | null;
  total_work_24h: number | null;
  total_cost: number | null;
  total_cost_24h: number | null;
  total_hours: number | null;
  total_hours_24h: number | null;
  successes: number | null;
  bans_total: number;
  bans_7d: number;
  last_ban_at: string | null;
  active_ban_id: number | null;
  active_ban_source: string | null;
  active_ban_reason: string | null;
  active_ban_banned_at: string | null;
  active_ban_expires_at: string | null;
}

export function openDb(path = config.dbPath): Database {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS providers (
      provider_id TEXT PRIMARY KEY,
      name TEXT,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agreements (
      agreement_id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      node TEXT,
      started_at TEXT,
      last_updated TEXT,
      work REAL NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0,
      efficiency REAL,
      speed REAL,
      cost_per_hour REAL,
      duration_hours REAL NOT NULL DEFAULT 0,
      successes INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_agreements_provider
      ON agreements(provider_id, last_updated);
    CREATE INDEX IF NOT EXISTS idx_agreements_last_updated
      ON agreements(last_updated);
    CREATE TABLE IF NOT EXISTS bans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider_id TEXT NOT NULL,
      source TEXT NOT NULL,
      reason TEXT,
      agreement_id TEXT,
      banned_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_bans_provider ON bans(provider_id, banned_at);
    CREATE INDEX IF NOT EXISTS idx_bans_expires ON bans(expires_at);
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
  return db;
}

export class Store {
  constructor(public db: Database) {}

  private upsertProviderStmt = () =>
    this.db.query(`
      INSERT INTO providers (provider_id, name, first_seen, last_seen)
      VALUES ($id, $name, $seen, $seen)
      ON CONFLICT(provider_id) DO UPDATE SET
        name = COALESCE(excluded.name, providers.name),
        first_seen = MIN(providers.first_seen, excluded.first_seen),
        last_seen = MAX(providers.last_seen, excluded.last_seen)
    `);

  upsertProvider(id: string, name: string | null, seenAt: string): void {
    this.upsertProviderStmt().run({ $id: id, $name: name, $seen: seenAt });
  }

  upsertAgreements(rows: AgreementUpsert[]): void {
    if (rows.length === 0) return;
    const provStmt = this.upsertProviderStmt();
    const agrStmt = this.db.query(`
      INSERT INTO agreements (
        agreement_id, provider_id, node, started_at, last_updated,
        work, cost, efficiency, speed, cost_per_hour, duration_hours, successes
      ) VALUES (
        $agreementId, $providerId, $node, $startedAt, $lastUpdated,
        $work, $cost, $efficiency, $speed, $costPerHour, $durationHours, $successes
      )
      ON CONFLICT(agreement_id) DO UPDATE SET
        provider_id = excluded.provider_id,
        node = COALESCE(excluded.node, agreements.node),
        started_at = COALESCE(MIN(agreements.started_at, excluded.started_at), excluded.started_at),
        last_updated = MAX(agreements.last_updated, excluded.last_updated),
        work = MAX(agreements.work, excluded.work),
        cost = MAX(agreements.cost, excluded.cost),
        efficiency = COALESCE(excluded.efficiency, agreements.efficiency),
        speed = COALESCE(excluded.speed, agreements.speed),
        cost_per_hour = COALESCE(excluded.cost_per_hour, agreements.cost_per_hour),
        duration_hours = MAX(agreements.duration_hours, excluded.duration_hours),
        successes = MAX(agreements.successes, excluded.successes)
    `);
    const tx = this.db.transaction((batch: AgreementUpsert[]) => {
      for (const r of batch) {
        provStmt.run({
          $id: r.providerId,
          $name: r.providerName,
          $seen: r.lastUpdated ?? new Date().toISOString(),
        });
        agrStmt.run({
          $agreementId: r.agreementId,
          $providerId: r.providerId,
          $node: r.node,
          $startedAt: r.startedAt,
          $lastUpdated: r.lastUpdated,
          $work: r.work,
          $cost: r.cost,
          $efficiency: r.efficiency,
          $speed: r.speed,
          $costPerHour: r.costPerHour,
          $durationHours: r.durationHours,
          $successes: r.successes,
        });
      }
    });
    tx(rows);
  }

  hasActiveBan(providerId: string, source?: string): boolean {
    const now = new Date().toISOString();
    if (source !== undefined) {
      const row = this.db
        .query(
          `SELECT id FROM bans
           WHERE provider_id = $id AND source = $source
             AND revoked_at IS NULL AND expires_at > $now
           LIMIT 1`,
        )
        .get({ $id: providerId, $source: source, $now: now });
      return row !== null;
    }
    const row = this.db
      .query(
        `SELECT id FROM bans
         WHERE provider_id = $id AND revoked_at IS NULL AND expires_at > $now
         LIMIT 1`,
      )
      .get({ $id: providerId, $now: now });
    return row !== null;
  }

  insertBan(params: {
    providerId: string;
    source: string;
    reason: string | null;
    agreementId: string | null;
    durationHours?: number;
  }): number {
    const now = new Date();
    const hours = params.durationHours ?? config.banDurationHours;
    const expires = new Date(now.getTime() + hours * 3600_000);
    this.upsertProvider(params.providerId, null, now.toISOString());
    const res = this.db
      .query(
        `INSERT INTO bans (provider_id, source, reason, agreement_id, banned_at, expires_at)
         VALUES ($id, $source, $reason, $agreementId, $bannedAt, $expiresAt)`,
      )
      .run({
        $id: params.providerId,
        $source: params.source,
        $reason: params.reason,
        $agreementId: params.agreementId,
        $bannedAt: now.toISOString(),
        $expiresAt: expires.toISOString(),
      });
    return Number(res.lastInsertRowid);
  }

  revokeBan(banId: number): boolean {
    const res = this.db
      .query(
        `UPDATE bans SET revoked_at = $now WHERE id = $id AND revoked_at IS NULL`,
      )
      .run({ $now: new Date().toISOString(), $id: banId });
    return res.changes > 0;
  }

  revokeActiveBansForProvider(providerId: string): number {
    const now = new Date().toISOString();
    const res = this.db
      .query(
        `UPDATE bans SET revoked_at = $now
         WHERE provider_id = $id AND revoked_at IS NULL AND expires_at > $now`,
      )
      .run({ $now: now, $id: providerId });
    return res.changes;
  }

  activeBans(): {
    id: number;
    provider_id: string;
    name: string | null;
    source: string;
    reason: string | null;
    agreement_id: string | null;
    banned_at: string;
    expires_at: string;
  }[] {
    const now = new Date().toISOString();
    return this.db
      .query(
        `SELECT b.id, b.provider_id, p.name, b.source, b.reason, b.agreement_id,
                b.banned_at, b.expires_at
         FROM bans b LEFT JOIN providers p ON p.provider_id = b.provider_id
         WHERE b.revoked_at IS NULL AND b.expires_at > $now
         ORDER BY b.banned_at DESC`,
      )
      .all({ $now: now }) as ReturnType<Store["activeBans"]>;
  }

  banHistory(opts: {
    providerId?: string;
    limit: number;
    offset: number;
  }): { rows: unknown[]; total: number } {
    const where = opts.providerId ? "WHERE b.provider_id = $id" : "";
    const params: Record<string, string | number> = opts.providerId
      ? { $id: opts.providerId }
      : {};
    const total = (
      this.db
        .query(`SELECT COUNT(*) AS c FROM bans b ${where}`)
        .get(params) as { c: number }
    ).c;
    const rows = this.db
      .query(
        `SELECT b.id, b.provider_id, p.name, b.source, b.reason, b.agreement_id,
                b.banned_at, b.expires_at, b.revoked_at
         FROM bans b LEFT JOIN providers p ON p.provider_id = b.provider_id
         ${where}
         ORDER BY b.banned_at DESC
         LIMIT $limit OFFSET $offset`,
      )
      .all({ ...params, $limit: opts.limit, $offset: opts.offset });
    return { rows, total };
  }

  providerAggregates(providerId?: string): ProviderAggRow[] {
    const dayAgo = new Date(Date.now() - 24 * 3600_000).toISOString();
    const weekAgo = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
    const now = new Date().toISOString();
    const where = providerId ? "WHERE p.provider_id = $pid" : "";
    const params: Record<string, string | number> = {
      $dayAgo: dayAgo,
      $weekAgo: weekAgo,
      $now: now,
    };
    if (providerId) params.$pid = providerId;
    return this.db
      .query(
        `
      SELECT
        p.provider_id, p.name, p.first_seen, p.last_seen,
        COUNT(a.agreement_id) AS agreements,
        COUNT(a.agreement_id) FILTER (WHERE a.last_updated > $dayAgo) AS agreements_24h,
        SUM(a.work) AS total_work,
        SUM(a.work) FILTER (WHERE a.last_updated > $dayAgo) AS total_work_24h,
        SUM(a.cost) AS total_cost,
        SUM(a.cost) FILTER (WHERE a.last_updated > $dayAgo) AS total_cost_24h,
        SUM(a.duration_hours) AS total_hours,
        SUM(a.duration_hours) FILTER (WHERE a.last_updated > $dayAgo) AS total_hours_24h,
        SUM(a.successes) AS successes,
        (SELECT COUNT(*) FROM bans b WHERE b.provider_id = p.provider_id) AS bans_total,
        (SELECT COUNT(*) FROM bans b WHERE b.provider_id = p.provider_id
           AND b.banned_at > $weekAgo) AS bans_7d,
        (SELECT MAX(b.banned_at) FROM bans b WHERE b.provider_id = p.provider_id) AS last_ban_at,
        ab.id AS active_ban_id,
        ab.source AS active_ban_source,
        ab.reason AS active_ban_reason,
        ab.banned_at AS active_ban_banned_at,
        ab.expires_at AS active_ban_expires_at
      FROM providers p
      LEFT JOIN agreements a ON a.provider_id = p.provider_id
      LEFT JOIN (
        SELECT b1.* FROM bans b1
        WHERE b1.revoked_at IS NULL AND b1.expires_at > $now
          AND b1.id = (
            SELECT b2.id FROM bans b2
            WHERE b2.provider_id = b1.provider_id
              AND b2.revoked_at IS NULL AND b2.expires_at > $now
            ORDER BY b2.expires_at DESC LIMIT 1
          )
      ) ab ON ab.provider_id = p.provider_id
      ${where}
      GROUP BY p.provider_id
      `,
      )
      .all(params) as ProviderAggRow[];
  }

  agreementsForProvider(
    providerId: string,
    limit: number,
    offset: number,
  ): { rows: unknown[]; total: number } {
    const total = (
      this.db
        .query(`SELECT COUNT(*) AS c FROM agreements WHERE provider_id = $id`)
        .get({ $id: providerId }) as { c: number }
    ).c;
    const rows = this.db
      .query(
        `SELECT agreement_id, provider_id, node, started_at, last_updated,
                work, cost, efficiency, speed, cost_per_hour, duration_hours, successes
         FROM agreements
         WHERE provider_id = $id
         ORDER BY last_updated DESC
         LIMIT $limit OFFSET $offset`,
      )
      .all({ $id: providerId, $limit: limit, $offset: offset });
    return { rows, total };
  }

  dailyStats(providerId: string, days: number): unknown[] {
    const cutoff = new Date(Date.now() - days * 24 * 3600_000).toISOString();
    return this.db
      .query(
        `SELECT substr(last_updated, 1, 10) AS day,
                COUNT(*) AS agreements,
                SUM(work) AS work,
                SUM(cost) AS cost,
                SUM(duration_hours) AS hours
         FROM agreements
         WHERE provider_id = $id AND last_updated > $cutoff
         GROUP BY day ORDER BY day`,
      )
      .all({ $id: providerId, $cutoff: cutoff });
  }

  fleetCounts(): {
    providersTotal: number;
    providersActive24h: number;
    activeBans: number;
    bans24h: number;
    agreementsTotal: number;
    agreements24h: number;
    work24h: number;
    cost24h: number;
    hours24h: number;
  } {
    const dayAgo = new Date(Date.now() - 24 * 3600_000).toISOString();
    const now = new Date().toISOString();
    const one = <T>(
      sql: string,
      params: Record<string, string | number> = {},
    ): T => this.db.query(sql).get(params) as T;
    const prov = one<{ c: number }>(`SELECT COUNT(*) AS c FROM providers`);
    const provAct = one<{ c: number }>(
      `SELECT COUNT(*) AS c FROM providers WHERE last_seen > $dayAgo`,
      { $dayAgo: dayAgo },
    );
    const activeBans = one<{ c: number }>(
      `SELECT COUNT(*) AS c FROM bans WHERE revoked_at IS NULL AND expires_at > $now`,
      { $now: now },
    );
    const bans24h = one<{ c: number }>(
      `SELECT COUNT(*) AS c FROM bans WHERE banned_at > $dayAgo`,
      { $dayAgo: dayAgo },
    );
    const agr = one<{ c: number }>(`SELECT COUNT(*) AS c FROM agreements`);
    const agr24 = one<{
      c: number;
      w: number | null;
      co: number | null;
      h: number | null;
    }>(
      `SELECT COUNT(*) AS c, SUM(work) AS w, SUM(cost) AS co, SUM(duration_hours) AS h
       FROM agreements WHERE last_updated > $dayAgo`,
      { $dayAgo: dayAgo },
    );
    return {
      providersTotal: prov.c,
      providersActive24h: provAct.c,
      activeBans: activeBans.c,
      bans24h: bans24h.c,
      agreementsTotal: agr.c,
      agreements24h: agr24.c,
      work24h: agr24.w ?? 0,
      cost24h: agr24.co ?? 0,
      hours24h: agr24.h ?? 0,
    };
  }

  agreementCount(): number {
    return (
      this.db.query(`SELECT COUNT(*) AS c FROM agreements`).get() as {
        c: number;
      }
    ).c;
  }

  getMeta(key: string): string | null {
    const row = this.db
      .query(`SELECT value FROM meta WHERE key = $key`)
      .get({ $key: key }) as { value: string } | null;
    return row?.value ?? null;
  }

  setMeta(key: string, value: string): void {
    this.db
      .query(
        `INSERT INTO meta (key, value) VALUES ($key, $value)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run({ $key: key, $value: value });
  }
}
