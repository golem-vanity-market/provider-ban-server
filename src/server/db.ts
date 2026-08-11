import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config.ts";
import type { ProviderHw } from "../shared/types.ts";

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
  agr_active: number;
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
  daily_bans: number; // non-revoked, last 24h, after the escalation cutoff
  last_ban_at: string | null;
  last_ban_reason: string | null;
  last_ban_source: string | null;
  active_ban_id: number | null;
  active_ban_source: string | null;
  active_ban_reason: string | null;
  active_ban_banned_at: string | null;
  active_ban_expires_at: string | null;
}

export interface TargetRow {
  provider_id: string;
  efficiency_target: number | null;
  speed_target: number | null;
  note: string | null;
  auto: number; // 1 = managed by the auto-relax tuner, 0 = set manually
  updated_at: string;
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
    CREATE TABLE IF NOT EXISTS targets (
      provider_id TEXT PRIMARY KEY, -- '*' holds the global target
      efficiency_target REAL,
      speed_target REAL,
      note TEXT,
      auto INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS invoices (
      invoice_id TEXT PRIMARY KEY, -- yagna invoice id
      node TEXT,                   -- stone whose daemon reported it
      provider_id TEXT NOT NULL,   -- issuerId
      payee_addr TEXT,             -- the operator wallet the money goes to
      agreement_id TEXT,
      payment_platform TEXT,
      amount REAL NOT NULL,
      status TEXT NOT NULL,        -- RECEIVED/ACCEPTED/SETTLED/REJECTED/...
      issued_at TEXT,
      payment_due_at TEXT,
      first_seen TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_invoices_provider
      ON invoices(provider_id, issued_at);
    CREATE INDEX IF NOT EXISTS idx_invoices_issued ON invoices(issued_at);
    CREATE TABLE IF NOT EXISTS payments (
      payment_id TEXT PRIMARY KEY, -- yagna payment (on-chain transfer batch)
      node TEXT,
      payee_addr TEXT,
      amount REAL NOT NULL,
      paid_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_payments_payee ON payments(payee_addr);
    CREATE TABLE IF NOT EXISTS provider_hw (
      provider_id TEXT PRIMARY KEY, -- scraped from stats.golem.network
      cpu_brand TEXT,
      cpu_cores REAL,
      cpu_threads REAL,
      mem_gib REAL,
      storage_gib REAL,
      monthly_price_glm REAL,
      price_env_hour REAL,
      price_cpu_hour REAL,
      price_start REAL,
      online INTEGER,
      fetched_at TEXT NOT NULL,
      error TEXT
    );
  `);
  const targetCols = db
    .query(`PRAGMA table_info(targets)`)
    .all() as { name: string }[];
  if (!targetCols.some((c) => c.name === "auto")) {
    db.exec(`ALTER TABLE targets ADD COLUMN auto INTEGER NOT NULL DEFAULT 0;`);
  }
  const hwCols = db
    .query(`PRAGMA table_info(provider_hw)`)
    .all() as { name: string }[];
  if (!hwCols.some((c) => c.name === "wallet")) {
    db.exec(`ALTER TABLE provider_hw ADD COLUMN wallet TEXT;`);
  }
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

  /** True when a ban from this source ran out naturally (not revoked) at or
   *  after `sinceIso`. Used by the collector to recognize expiry echoes: the
   *  stone's local list still holds the provider after the server ban
   *  expired, and re-ingesting it would silently extend the cooldown as a
   *  fresh "no detail" row. */
  hadBanExpiringSince(
    providerId: string,
    source: string,
    sinceIso: string,
  ): boolean {
    const now = new Date().toISOString();
    const row = this.db
      .query(
        `SELECT id FROM bans
         WHERE provider_id = $id AND source = $source
           AND revoked_at IS NULL
           AND expires_at <= $now AND expires_at >= $since
         LIMIT 1`,
      )
      .get({ $id: providerId, $source: source, $now: now, $since: sinceIso });
    return row !== null;
  }

  /** Non-revoked bans of this provider within the last 24h (and after the
   *  escalation cutoff set when the escalating-ban logic was introduced). */
  dailyBans(providerId: string): number {
    const dayAgo = new Date(Date.now() - 24 * 3600_000).toISOString();
    const cutoff = this.getMeta("ban_count_cutoff") ?? "";
    const since = cutoff > dayAgo ? cutoff : dayAgo;
    return (
      this.db
        .query(
          `SELECT COUNT(*) AS c FROM bans
           WHERE provider_id = $id AND revoked_at IS NULL AND banned_at > $since`,
        )
        .get({ $id: providerId, $since: since }) as { c: number }
    ).c;
  }

  /** Duration the next ban of this provider would get (escalation). */
  nextBanHours(providerId: string): number {
    return Math.min(this.dailyBans(providerId) + 1, config.banMaxHours);
  }

  insertBan(params: {
    providerId: string;
    source: string;
    reason: string | null;
    agreementId: string | null;
    durationHours?: number;
  }): number {
    const now = new Date();
    // Escalation: 1st ban of the day = 1h, 2nd = 2h, ... unless the caller
    // pinned an explicit duration.
    const hours = params.durationHours ?? this.nextBanHours(params.providerId);
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

  /** Fleet-wide reset: revoke every active ban (used when switching ban
   *  policies). Returns the number of bans revoked. */
  revokeAllActiveBans(): number {
    const now = new Date().toISOString();
    const res = this.db
      .query(
        `UPDATE bans SET revoked_at = $now
         WHERE revoked_at IS NULL AND expires_at > $now`,
      )
      .run({ $now: now });
    return res.changes;
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
    const cutoff = this.getMeta("ban_count_cutoff") ?? "";
    // "Computing right now": the stone's estimator updated within the last
    // few collector cycles.
    const activeCutoff = new Date(Date.now() - 150_000).toISOString();
    const params: Record<string, string | number> = {
      $activeCutoff: activeCutoff,
      $dayAgo: dayAgo,
      $weekAgo: weekAgo,
      $monthAgo: monthAgo,
      $now: now,
      $sinceDaily: cutoff > dayAgo ? cutoff : dayAgo,
    };
    if (providerId) params.$pid = providerId;
    return this.db
      .query(
        `
      SELECT
        p.provider_id, p.name, p.first_seen, p.last_seen,
        COUNT(a.agreement_id) FILTER (WHERE a.last_updated > $activeCutoff) AS agr_active,
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
        -- Revoked bans count nowhere: a revoke (manual forgiveness or a
        -- fleet-wide reset) must not keep providers blacklisted or hurt
        -- their score. Full history stays visible in the bans table.
        (SELECT COUNT(*) FROM bans b WHERE b.provider_id = p.provider_id
           AND b.revoked_at IS NULL AND b.banned_at > $dayAgo) AS bans_1d,
        (SELECT COUNT(*) FROM bans b WHERE b.provider_id = p.provider_id
           AND b.revoked_at IS NULL AND b.banned_at > $weekAgo) AS bans_7d,
        (SELECT COUNT(*) FROM bans b WHERE b.provider_id = p.provider_id
           AND b.revoked_at IS NULL AND b.banned_at > $monthAgo) AS bans_30d,
        (SELECT COUNT(*) FROM bans b WHERE b.provider_id = p.provider_id
           AND b.revoked_at IS NULL) AS bans_total,
        (SELECT COUNT(*) FROM bans b WHERE b.provider_id = p.provider_id
           AND b.revoked_at IS NULL AND b.banned_at > $sinceDaily) AS daily_bans,
        (SELECT MAX(b.banned_at) FROM bans b WHERE b.provider_id = p.provider_id
           AND b.revoked_at IS NULL) AS last_ban_at,
        (SELECT b.reason FROM bans b WHERE b.provider_id = p.provider_id
           AND b.revoked_at IS NULL ORDER BY b.banned_at DESC LIMIT 1) AS last_ban_reason,
        (SELECT b.source FROM bans b WHERE b.provider_id = p.provider_id
           AND b.revoked_at IS NULL ORDER BY b.banned_at DESC LIMIT 1) AS last_ban_source,
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

  listTargets(): TargetRow[] {
    return this.db
      .query(
        `SELECT provider_id, efficiency_target, speed_target, note, auto, updated_at
         FROM targets ORDER BY provider_id`,
      )
      .all() as TargetRow[];
  }

  setTarget(params: {
    providerId: string; // '*' for the global target
    efficiencyTarget: number | null;
    speedTarget: number | null;
    note: string | null;
    auto?: boolean;
  }): void {
    this.db
      .query(
        `INSERT INTO targets (provider_id, efficiency_target, speed_target, note, auto, updated_at)
         VALUES ($id, $eff, $speed, $note, $auto, $now)
         ON CONFLICT(provider_id) DO UPDATE SET
           efficiency_target = excluded.efficiency_target,
           speed_target = excluded.speed_target,
           note = excluded.note,
           auto = excluded.auto,
           updated_at = excluded.updated_at`,
      )
      .run({
        $id: params.providerId,
        $eff: params.efficiencyTarget,
        $speed: params.speedTarget,
        $note: params.note,
        $auto: params.auto ? 1 : 0,
        $now: new Date().toISOString(),
      });
  }

  deleteTarget(providerId: string): boolean {
    const res = this.db
      .query(`DELETE FROM targets WHERE provider_id = $id`)
      .run({ $id: providerId });
    return res.changes > 0;
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

  upsertProviderHw(row: {
    providerId: string;
    cpuBrand: string | null;
    cpuCores: number | null;
    cpuThreads: number | null;
    memGib: number | null;
    storageGib: number | null;
    monthlyPriceGlm: number | null;
    priceEnvHour: number | null;
    priceCpuHour: number | null;
    priceStart: number | null;
    online: boolean | null;
    wallet: string | null;
    error: string | null;
  }): void {
    this.db
      .query(
        `INSERT INTO provider_hw (provider_id, cpu_brand, cpu_cores, cpu_threads,
           mem_gib, storage_gib, monthly_price_glm, price_env_hour,
           price_cpu_hour, price_start, online, wallet, fetched_at, error)
         VALUES ($id, $brand, $cores, $threads, $mem, $storage, $monthly,
           $envH, $cpuH, $start, $online, $wallet, $now, $error)
         ON CONFLICT(provider_id) DO UPDATE SET
           cpu_brand = COALESCE(excluded.cpu_brand, provider_hw.cpu_brand),
           cpu_cores = COALESCE(excluded.cpu_cores, provider_hw.cpu_cores),
           cpu_threads = COALESCE(excluded.cpu_threads, provider_hw.cpu_threads),
           mem_gib = COALESCE(excluded.mem_gib, provider_hw.mem_gib),
           storage_gib = COALESCE(excluded.storage_gib, provider_hw.storage_gib),
           monthly_price_glm = COALESCE(excluded.monthly_price_glm, provider_hw.monthly_price_glm),
           price_env_hour = COALESCE(excluded.price_env_hour, provider_hw.price_env_hour),
           price_cpu_hour = COALESCE(excluded.price_cpu_hour, provider_hw.price_cpu_hour),
           price_start = COALESCE(excluded.price_start, provider_hw.price_start),
           online = excluded.online,
           wallet = COALESCE(excluded.wallet, provider_hw.wallet),
           fetched_at = excluded.fetched_at,
           error = excluded.error`,
      )
      .run({
        $id: row.providerId,
        $brand: row.cpuBrand,
        $cores: row.cpuCores,
        $threads: row.cpuThreads,
        $mem: row.memGib,
        $storage: row.storageGib,
        $monthly: row.monthlyPriceGlm,
        $envH: row.priceEnvHour,
        $cpuH: row.priceCpuHour,
        $start: row.priceStart,
        $online: row.online == null ? null : row.online ? 1 : 0,
        $wallet: row.wallet,
        $now: new Date().toISOString(),
        $error: row.error,
      });
  }

  hwMap(): Map<string, ProviderHw> {
    const rows = this.db
      .query(`SELECT * FROM provider_hw`)
      .all() as ProviderHwRow[];
    const map = new Map<string, ProviderHw>();
    for (const r of rows) {
      // Rows that never yielded any data (only errors) stay invisible.
      if (
        r.cpu_threads == null &&
        r.cpu_cores == null &&
        r.monthly_price_glm == null &&
        r.price_env_hour == null
      )
        continue;
      map.set(r.provider_id, {
        cpuBrand: r.cpu_brand,
        cpuCores: r.cpu_cores,
        cpuThreads: r.cpu_threads,
        memGib: r.mem_gib,
        storageGib: r.storage_gib,
        monthlyPriceGlm: r.monthly_price_glm,
        priceEnvHour: r.price_env_hour,
        priceCpuHour: r.price_cpu_hour,
        priceStart: r.price_start,
        online: r.online == null ? null : r.online === 1,
        wallet: r.wallet,
        fetchedAt: r.fetched_at,
      });
    }
    return map;
  }

  /** Providers worth (re)fetching from stats.golem.network: active in the
   *  last 7 days and never fetched (first) or fetched longer than the TTL
   *  ago. */
  hwFetchCandidates(limit: number, ttlHours: number): string[] {
    const cutoff = new Date(Date.now() - ttlHours * 3600_000).toISOString();
    const weekAgo = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
    const rows = this.db
      .query(
        `SELECT p.provider_id AS id FROM providers p
         LEFT JOIN provider_hw h ON h.provider_id = p.provider_id
         WHERE p.last_seen > $weekAgo
           AND (h.provider_id IS NULL OR h.fetched_at < $cutoff
                -- one-time backfill: rows scraped before the wallet column
                -- existed get re-fetched ahead of the TTL
                OR (h.wallet IS NULL AND h.error IS NULL))
         ORDER BY h.fetched_at IS NOT NULL, h.fetched_at ASC
         LIMIT $limit`,
      )
      .all({ $weekAgo: weekAgo, $cutoff: cutoff, $limit: limit }) as {
      id: string;
    }[];
    return rows.map((r) => r.id);
  }

  upsertInvoices(rows: InvoiceUpsert[]): void {
    if (rows.length === 0) return;
    const stmt = this.db.query(`
      INSERT INTO invoices (invoice_id, node, provider_id, payee_addr,
        agreement_id, payment_platform, amount, status, issued_at,
        payment_due_at, first_seen, updated_at)
      VALUES ($invoiceId, $node, $providerId, $payeeAddr, $agreementId,
        $platform, $amount, $status, $issuedAt, $dueAt, $now, $now)
      ON CONFLICT(invoice_id) DO UPDATE SET
        status = excluded.status,
        amount = excluded.amount,
        payee_addr = COALESCE(excluded.payee_addr, invoices.payee_addr),
        updated_at = CASE WHEN excluded.status != invoices.status
          THEN excluded.updated_at ELSE invoices.updated_at END
    `);
    const now = new Date().toISOString();
    const tx = this.db.transaction((batch: InvoiceUpsert[]) => {
      for (const r of batch) {
        stmt.run({
          $invoiceId: r.invoiceId,
          $node: r.node,
          $providerId: r.providerId,
          $payeeAddr: r.payeeAddr,
          $agreementId: r.agreementId,
          $platform: r.paymentPlatform,
          $amount: r.amount,
          $status: r.status,
          $issuedAt: r.issuedAt,
          $dueAt: r.paymentDueAt,
          $now: now,
        });
      }
    });
    tx(rows);
  }

  upsertPayments(rows: PaymentUpsert[]): void {
    if (rows.length === 0) return;
    const stmt = this.db.query(`
      INSERT INTO payments (payment_id, node, payee_addr, amount, paid_at)
      VALUES ($paymentId, $node, $payeeAddr, $amount, $paidAt)
      ON CONFLICT(payment_id) DO UPDATE SET amount = excluded.amount
    `);
    const tx = this.db.transaction((batch: PaymentUpsert[]) => {
      for (const r of batch) {
        stmt.run({
          $paymentId: r.paymentId,
          $node: r.node,
          $payeeAddr: r.payeeAddr,
          $amount: r.amount,
          $paidAt: r.paidAt,
        });
      }
    });
    tx(rows);
  }

  /** Latest ingest cursor per stone daemon (meta-table backed). */
  yagnaCursor(node: string): string | null {
    return this.getMeta(`yagna_cursor_${node}`);
  }

  setYagnaCursor(node: string, iso: string): void {
    this.setMeta(`yagna_cursor_${node}`, iso);
  }

  /** Per-provider computed/invoiced/paid aggregates inside a window, plus
   *  the operator wallet each provider pays out to. Grouping into operators
   *  happens in the API layer. */
  operatorProviderRows(since: string | null): OperatorProviderRow[] {
    const params: Record<string, string | number> = { $since: since ?? "0000" };
    return this.db
      .query(
        `
      SELECT
        p.provider_id,
        p.name,
        p.last_seen,
        -- newest payee wins when an operator rotates wallets
        (SELECT i.payee_addr FROM invoices i
          WHERE i.provider_id = p.provider_id AND i.payee_addr IS NOT NULL
          ORDER BY i.issued_at DESC LIMIT 1) AS invoice_wallet,
        h.wallet AS hw_wallet,
        (SELECT COUNT(*) FROM agreements a
          WHERE a.provider_id = p.provider_id AND a.last_updated > $since) AS agreements,
        (SELECT SUM(a.work) FROM agreements a
          WHERE a.provider_id = p.provider_id AND a.last_updated > $since) AS work,
        (SELECT SUM(a.cost) FROM agreements a
          WHERE a.provider_id = p.provider_id AND a.last_updated > $since) AS cost,
        (SELECT SUM(a.duration_hours) FROM agreements a
          WHERE a.provider_id = p.provider_id AND a.last_updated > $since) AS hours,
        (SELECT COUNT(*) FROM invoices i
          WHERE i.provider_id = p.provider_id AND i.issued_at > $since) AS invoice_count,
        (SELECT SUM(i.amount) FROM invoices i
          WHERE i.provider_id = p.provider_id AND i.issued_at > $since) AS invoiced,
        (SELECT SUM(i.amount) FROM invoices i
          WHERE i.provider_id = p.provider_id AND i.issued_at > $since
            AND i.status IN ('ACCEPTED', 'SETTLED')) AS accepted,
        (SELECT SUM(i.amount) FROM invoices i
          WHERE i.provider_id = p.provider_id AND i.issued_at > $since
            AND i.status = 'SETTLED') AS settled,
        (SELECT MAX(i.issued_at) FROM invoices i
          WHERE i.provider_id = p.provider_id) AS last_invoice_at
      FROM providers p
      LEFT JOIN provider_hw h ON h.provider_id = p.provider_id
      `,
      )
      .all(params) as OperatorProviderRow[];
  }

  /** On-chain transfers per operator wallet inside a window (ground truth
   *  of what was actually paid, across all stones' daemons). */
  paymentsByWallet(since: string | null): { payee_addr: string; paid: number }[] {
    return this.db
      .query(
        `SELECT payee_addr, SUM(amount) AS paid FROM payments
         WHERE payee_addr IS NOT NULL AND paid_at > $since
         GROUP BY payee_addr`,
      )
      .all({ $since: since ?? "0000" }) as {
      payee_addr: string;
      paid: number;
    }[];
  }
}

export interface InvoiceUpsert {
  invoiceId: string;
  node: string | null;
  providerId: string;
  payeeAddr: string | null;
  agreementId: string | null;
  paymentPlatform: string | null;
  amount: number;
  status: string;
  issuedAt: string | null;
  paymentDueAt: string | null;
}

export interface PaymentUpsert {
  paymentId: string;
  node: string | null;
  payeeAddr: string | null;
  amount: number;
  paidAt: string | null;
}

export interface OperatorProviderRow {
  provider_id: string;
  name: string | null;
  last_seen: string | null;
  invoice_wallet: string | null;
  hw_wallet: string | null;
  agreements: number;
  work: number | null;
  cost: number | null;
  hours: number | null;
  invoice_count: number;
  invoiced: number | null;
  accepted: number | null;
  settled: number | null;
  last_invoice_at: string | null;
}

interface ProviderHwRow {
  provider_id: string;
  cpu_brand: string | null;
  cpu_cores: number | null;
  cpu_threads: number | null;
  mem_gib: number | null;
  storage_gib: number | null;
  monthly_price_glm: number | null;
  price_env_hour: number | null;
  price_cpu_hour: number | null;
  price_start: number | null;
  online: number | null;
  wallet: string | null;
  fetched_at: string;
  error: string | null;
}
