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
  agr_1d: number;
  agr_7d: number;
  agr_30d: number;
  agr_all: number;
  work_1d: number | null;
  work_7d: number | null;
  work_30d: number | null;
  work_all: number | null;
  cost_1d: number | null;
  cost_7d: number | null;
  cost_30d: number | null;
  cost_all: number | null;
  hours_1d: number | null;
  hours_7d: number | null;
  hours_30d: number | null;
  hours_all: number | null;
  successes: number | null;
  last_agr_id: string | null;
  last_agr_node: string | null;
  last_agr_last_updated: string | null;
  last_agr_work: number | null;
  last_agr_successes: number | null;
  last_agr_duration_hours: number | null;
  bans_1d: number;
  bans_7d: number;
  bans_30d: number;
  bans_total: number;
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
    since?: string;
    limit: number;
    offset: number;
  }): { rows: unknown[]; total: number } {
    const conds: string[] = [];
    const params: Record<string, string | number> = {};
    if (opts.providerId) {
      conds.push("b.provider_id = $id");
      params.$id = opts.providerId;
    }
    if (opts.since) {
      conds.push("b.banned_at > $since");
      params.$since = opts.since;
    }
    const where = conds.length > 0 ? `WHERE ${conds.join(" AND ")}` : "";
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
    const monthAgo = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();
    const now = new Date().toISOString();
    const where = providerId ? "WHERE p.provider_id = $pid" : "";
    const params: Record<string, string | number> = {
      $dayAgo: dayAgo,
      $weekAgo: weekAgo,
      $monthAgo: monthAgo,
      $now: now,
    };
    if (providerId) params.$pid = providerId;
    return this.db
      .query(
        `
      SELECT
        p.provider_id, p.name, p.first_seen, p.last_seen,
        COUNT(a.agreement_id) FILTER (WHERE a.last_updated > $dayAgo) AS agr_1d,
        COUNT(a.agreement_id) FILTER (WHERE a.last_updated > $weekAgo) AS agr_7d,
        COUNT(a.agreement_id) FILTER (WHERE a.last_updated > $monthAgo) AS agr_30d,
        COUNT(a.agreement_id) AS agr_all,
        SUM(a.work) FILTER (WHERE a.last_updated > $dayAgo) AS work_1d,
        SUM(a.work) FILTER (WHERE a.last_updated > $weekAgo) AS work_7d,
        SUM(a.work) FILTER (WHERE a.last_updated > $monthAgo) AS work_30d,
        SUM(a.work) AS work_all,
        SUM(a.cost) FILTER (WHERE a.last_updated > $dayAgo) AS cost_1d,
        SUM(a.cost) FILTER (WHERE a.last_updated > $weekAgo) AS cost_7d,
        SUM(a.cost) FILTER (WHERE a.last_updated > $monthAgo) AS cost_30d,
        SUM(a.cost) AS cost_all,
        SUM(a.duration_hours) FILTER (WHERE a.last_updated > $dayAgo) AS hours_1d,
        SUM(a.duration_hours) FILTER (WHERE a.last_updated > $weekAgo) AS hours_7d,
        SUM(a.duration_hours) FILTER (WHERE a.last_updated > $monthAgo) AS hours_30d,
        SUM(a.duration_hours) AS hours_all,
        SUM(a.successes) AS successes,
        la.agreement_id AS last_agr_id,
        la.node AS last_agr_node,
        la.last_updated AS last_agr_last_updated,
        la.work AS last_agr_work,
        la.successes AS last_agr_successes,
        la.duration_hours AS last_agr_duration_hours,
        (SELECT COUNT(*) FROM bans b WHERE b.provider_id = p.provider_id
           AND b.banned_at > $dayAgo) AS bans_1d,
        (SELECT COUNT(*) FROM bans b WHERE b.provider_id = p.provider_id
           AND b.banned_at > $weekAgo) AS bans_7d,
        (SELECT COUNT(*) FROM bans b WHERE b.provider_id = p.provider_id
           AND b.banned_at > $monthAgo) AS bans_30d,
        (SELECT COUNT(*) FROM bans b WHERE b.provider_id = p.provider_id) AS bans_total,
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
      LEFT JOIN (
        SELECT a1.* FROM agreements a1
        WHERE a1.rowid = (
          SELECT a2.rowid FROM agreements a2
          WHERE a2.provider_id = a1.provider_id
          ORDER BY a2.last_updated DESC LIMIT 1
        )
      ) la ON la.provider_id = p.provider_id
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
    activeBans: number;
    windows: Record<
      "d1" | "d7" | "d30" | "all",
      {
        agreements: number;
        work: number;
        cost: number;
        hours: number;
        bans: number;
        providersActive: number;
      }
    >;
  } {
    const now = new Date().toISOString();
    const one = <T>(
      sql: string,
      params: Record<string, string | number> = {},
    ): T => this.db.query(sql).get(params) as T;
    const prov = one<{ c: number }>(`SELECT COUNT(*) AS c FROM providers`);
    const activeBans = one<{ c: number }>(
      `SELECT COUNT(*) AS c FROM bans WHERE revoked_at IS NULL AND expires_at > $now`,
      { $now: now },
    );
    const windowFor = (days: number | null) => {
      const cutoff = days
        ? new Date(Date.now() - days * 24 * 3600_000).toISOString()
        : "0000";
      const agr = one<{
        c: number;
        w: number | null;
        co: number | null;
        h: number | null;
      }>(
        `SELECT COUNT(*) AS c, SUM(work) AS w, SUM(cost) AS co, SUM(duration_hours) AS h
         FROM agreements WHERE last_updated > $cutoff`,
        { $cutoff: cutoff },
      );
      const bans = one<{ c: number }>(
        `SELECT COUNT(*) AS c FROM bans WHERE banned_at > $cutoff`,
        { $cutoff: cutoff },
      );
      const provAct = one<{ c: number }>(
        `SELECT COUNT(*) AS c FROM providers WHERE last_seen > $cutoff`,
        { $cutoff: cutoff },
      );
      return {
        agreements: agr.c,
        work: agr.w ?? 0,
        cost: agr.co ?? 0,
        hours: agr.h ?? 0,
        bans: bans.c,
        providersActive: provAct.c,
      };
    };
    return {
      providersTotal: prov.c,
      activeBans: activeBans.c,
      windows: {
        d1: windowFor(1),
        d7: windowFor(7),
        d30: windowFor(30),
        all: windowFor(null),
      },
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
