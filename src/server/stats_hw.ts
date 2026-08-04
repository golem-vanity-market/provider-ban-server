// Hardware + price-list scraper for stats.golem.network.
//
// The stats site has no public JSON API anymore (api.stats.golem.network no
// longer resolves), but the provider page is server-rendered: everything we
// need sits in the __NEXT_DATA__ JSON blob (runtime properties with CPU
// cores/threads/brand, memory, storage, the linear pricing coeffs and the
// site's own monthly price quote). One GET per provider, refreshed at a slow
// TTL, a handful of providers per collector cycle.

import { config } from "./config.ts";
import type { Store } from "./db.ts";

interface RuntimeInfo {
  monthly_price_glm?: number;
  properties?: Record<string, unknown>;
}

interface NextDataNode {
  online?: boolean;
  runtimes?: Record<string, RuntimeInfo>;
}

export interface ParsedHw {
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
}

function asNum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function parseProviderPage(html: string): ParsedHw | null {
  const m = html.match(
    /__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s,
  );
  if (!m) return null;
  let node: NextDataNode | undefined;
  try {
    const data = JSON.parse(m[1]) as {
      props?: { pageProps?: { initialData?: NextDataNode[] } };
    };
    node = data.props?.pageProps?.initialData?.[0];
  } catch {
    return null;
  }
  if (!node?.runtimes) return null;
  const rt = node.runtimes["vm"] ?? Object.values(node.runtimes)[0];
  const props = rt?.properties ?? {};

  // Linear pricing: coeffs follow golem.com.usage.vector order, with the
  // fixed start fee appended last.
  let priceEnvHour: number | null = null;
  let priceCpuHour: number | null = null;
  let priceStart: number | null = null;
  const coeffs = props["golem.com.pricing.model.linear.coeffs"];
  const vector = props["golem.com.usage.vector"];
  if (Array.isArray(coeffs) && coeffs.every((c) => typeof c === "number")) {
    if (Array.isArray(vector) && vector.length <= coeffs.length) {
      vector.forEach((name, i) => {
        if (name === "golem.usage.duration_sec") priceEnvHour = coeffs[i] * 3600;
        if (name === "golem.usage.cpu_sec") priceCpuHour = coeffs[i] * 3600;
      });
      if (coeffs.length === vector.length + 1)
        priceStart = coeffs[coeffs.length - 1];
    } else if (coeffs.length === 3) {
      // Conventional order when the vector is absent.
      priceEnvHour = coeffs[0] * 3600;
      priceCpuHour = coeffs[1] * 3600;
      priceStart = coeffs[2];
    }
  }

  return {
    cpuBrand: typeof props["golem.inf.cpu.brand"] === "string"
      ? (props["golem.inf.cpu.brand"] as string)
      : null,
    cpuCores: asNum(props["golem.inf.cpu.cores"]),
    cpuThreads: asNum(props["golem.inf.cpu.threads"]),
    memGib: asNum(props["golem.inf.mem.gib"]),
    storageGib: asNum(props["golem.inf.storage.gib"]),
    monthlyPriceGlm: asNum(rt?.monthly_price_glm),
    priceEnvHour,
    priceCpuHour,
    priceStart,
    online: typeof node.online === "boolean" ? node.online : null,
  };
}

export async function fetchProviderHw(
  providerId: string,
): Promise<ParsedHw | null> {
  const resp = await fetch(`${config.statsGolemProviderUrl}${providerId}`, {
    signal: AbortSignal.timeout(20_000),
    headers: { "User-Agent": "provider-ban-server/0.1 (vanity-market fleet)" },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return parseProviderPage(await resp.text());
}

/** Refresh a few stale/missing providers per call. Returns how many rows
 *  gained or changed data (errors are recorded but don't count). */
export async function refreshProviderHw(store: Store): Promise<number> {
  if (!config.statsHwEnabled) return 0;
  const ids = store.hwFetchCandidates(
    config.statsHwPerCycle,
    config.statsHwTtlHours,
  );
  let updated = 0;
  for (const id of ids) {
    try {
      const hw = await fetchProviderHw(id);
      if (hw) {
        store.upsertProviderHw({ providerId: id, ...hw, error: null });
        updated++;
      } else {
        store.upsertProviderHw({
          providerId: id,
          cpuBrand: null,
          cpuCores: null,
          cpuThreads: null,
          memGib: null,
          storageGib: null,
          monthlyPriceGlm: null,
          priceEnvHour: null,
          priceCpuHour: null,
          priceStart: null,
          online: null,
          error: "no data on stats.golem.network",
        });
      }
    } catch (e) {
      store.upsertProviderHw({
        providerId: id,
        cpuBrand: null,
        cpuCores: null,
        cpuThreads: null,
        memGib: null,
        storageGib: null,
        monthlyPriceGlm: null,
        priceEnvHour: null,
        priceCpuHour: null,
        priceStart: null,
        online: null,
        error: String(e),
      });
    }
    // Be gentle with the public site.
    await new Promise((r) => setTimeout(r, 300));
  }
  if (updated > 0) console.log(`[stats-hw] refreshed ${updated} providers`);
  return updated;
}
