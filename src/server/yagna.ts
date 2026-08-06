// Invoice/payment ingestion from the stones' local yagna daemons.
//
// The yagna payment API is the only source of what was actually invoiced and
// paid (estimator cost is the debit-note accrual). Daemon data dirs are
// recreated on redeploys, so this history is fleeting there — the ban server
// keeps its own copy. Credentials come from each stone's vanity/.env
// (YAGNA_APPKEY + YAGNA_API_URL), scanned from the deployer services dir.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.ts";
import type { Store, InvoiceUpsert, PaymentUpsert } from "./db.ts";

export interface StoneDaemon {
  node: string; // "stone-N", same naming the collector uses
  apiUrl: string;
  appkey: string;
}

export function discoverDaemons(servicesDir: string): StoneDaemon[] {
  const daemons: StoneDaemon[] = [];
  let entries: string[] = [];
  try {
    entries = readdirSync(servicesDir);
  } catch {
    return daemons;
  }
  for (const name of entries) {
    if (!/^stone-\d+$/.test(name)) continue;
    try {
      const env = readFileSync(join(servicesDir, name, "vanity", ".env"), "utf-8");
      const get = (key: string): string | null =>
        env.match(new RegExp(`^${key}=(.+)$`, "m"))?.[1]?.trim() ?? null;
      const appkey = get("YAGNA_APPKEY");
      const apiUrl = get("YAGNA_API_URL") ?? get("YAGNA_API_BASEPATH");
      if (appkey && apiUrl) {
        daemons.push({ node: name, apiUrl: apiUrl.replace(/\/$/, ""), appkey });
      }
    } catch {
      // stone without a checkout/.env — skip
    }
  }
  return daemons;
}

interface YagnaInvoice {
  invoiceId: string;
  issuerId?: string;
  payeeAddr?: string;
  agreementId?: string;
  paymentPlatform?: string;
  amount?: string;
  status?: string;
  timestamp?: string;
  paymentDueDate?: string;
}

interface YagnaPayment {
  paymentId: string;
  payeeAddr?: string;
  amount?: string;
  timestamp?: string;
}

function asAmount(v: string | undefined): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export class YagnaIngest {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  public lastPolledAt: string | null = null;
  public lastErrors = new Map<string, string>();

  constructor(private store: Store) {}

  private async fetchList<T>(d: StoneDaemon, path: string): Promise<T[] | null> {
    try {
      const resp = await fetch(`${d.apiUrl}${path}`, {
        headers: { Authorization: `Bearer ${d.appkey}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = (await resp.json()) as T[];
      return Array.isArray(data) ? data : null;
    } catch (e) {
      this.lastErrors.set(`${d.node}${path.split("?")[0]}`, String(e));
      return null;
    }
  }

  private async pollDaemon(d: StoneDaemon): Promise<void> {
    // Overlapping cursor: invoices keep their issue timestamp while status
    // advances, so re-read lookbackHours back and upsert (idempotent).
    const lookback = new Date(
      Date.now() - config.yagnaLookbackHours * 3600_000,
    ).toISOString();
    const cursor = this.store.yagnaCursor(d.node);
    const after = cursor && cursor < lookback ? cursor : lookback;
    const query = `afterTimestamp=${encodeURIComponent(after)}&maxItems=${config.yagnaMaxItems}`;

    const invoices = await this.fetchList<YagnaInvoice>(
      d,
      `/payment-api/v1/invoices?${query}`,
    );
    if (invoices) {
      const rows: InvoiceUpsert[] = [];
      for (const inv of invoices) {
        const amount = asAmount(inv.amount);
        if (!inv.invoiceId || !inv.issuerId || amount === null) continue;
        rows.push({
          invoiceId: inv.invoiceId,
          node: d.node,
          providerId: inv.issuerId.toLowerCase(),
          payeeAddr: inv.payeeAddr?.toLowerCase() ?? null,
          agreementId: inv.agreementId ?? null,
          paymentPlatform: inv.paymentPlatform ?? null,
          amount,
          status: inv.status ?? "RECEIVED",
          issuedAt: inv.timestamp ?? null,
          paymentDueAt: inv.paymentDueDate ?? null,
        });
      }
      this.store.upsertInvoices(rows);
      // The cursor only marks the newest data ever seen; polls always rewind
      // by the lookback so a stale cursor can never skip status updates.
      const newest = rows
        .map((r) => r.issuedAt ?? "")
        .reduce((a, b) => (a > b ? a : b), cursor ?? "");
      if (newest) this.store.setYagnaCursor(d.node, newest);
      this.lastErrors.delete(`${d.node}/payment-api/v1/invoices`);
    }

    const payments = await this.fetchList<YagnaPayment>(
      d,
      `/payment-api/v1/payments?${query}`,
    );
    if (payments) {
      const rows: PaymentUpsert[] = [];
      for (const p of payments) {
        const amount = asAmount(p.amount);
        if (!p.paymentId || amount === null) continue;
        rows.push({
          paymentId: p.paymentId,
          node: d.node,
          payeeAddr: p.payeeAddr?.toLowerCase() ?? null,
          amount,
          paidAt: p.timestamp ?? null,
        });
      }
      this.store.upsertPayments(rows);
      this.lastErrors.delete(`${d.node}/payment-api/v1/payments`);
    }
  }

  async pollOnce(): Promise<void> {
    const daemons = discoverDaemons(config.yagnaServicesDir);
    await Promise.all(daemons.map((d) => this.pollDaemon(d)));
    this.lastPolledAt = new Date().toISOString();
  }

  start(): void {
    if (!config.yagnaEnabled) {
      console.log("[yagna] ingestion disabled (YAGNA_ENABLED=0)");
      return;
    }
    const loop = async (): Promise<void> => {
      if (this.stopped) return;
      try {
        await this.pollOnce();
      } catch (e) {
        console.error("[yagna] poll failed:", e);
      }
      this.timer = setTimeout(loop, config.yagnaPollSecs * 1000);
    };
    void loop();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }
}
