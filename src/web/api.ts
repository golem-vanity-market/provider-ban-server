import type {
  ActiveBansResponse,
  BanRow,
  FleetSummary,
  ProviderDetail,
  ProviderSummary,
} from "../shared/types.ts";

const API_BASE: string = import.meta.env.VITE_API_BASE || "";

async function getJson<T>(path: string): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`);
  if (!resp.ok) throw new Error(`API ${path} failed: ${resp.status}`);
  return (await resp.json()) as T;
}

export const api = {
  summary: () => getJson<FleetSummary>("/api/v1/summary"),
  providers: (params: {
    sort?: string;
    dir?: string;
    category?: string;
    search?: string;
    window?: string;
    limit?: number;
    offset?: number;
  }) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") q.set(k, String(v));
    }
    return getJson<{ providers: ProviderSummary[]; total: number }>(
      `/api/v1/providers?${q.toString()}`,
    );
  },
  provider: (id: string, limit = 50, offset = 0) =>
    getJson<ProviderDetail>(
      `/api/v1/providers/${id}?limit=${limit}&offset=${offset}`,
    ),
  activeBans: () => getJson<ActiveBansResponse>("/api/v1/bans/active"),
  banHistory: (
    limit = 100,
    offset = 0,
    providerId?: string,
    sinceHours?: number,
  ) => {
    const q = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
    });
    if (providerId) q.set("providerId", providerId);
    if (sinceHours !== undefined) q.set("sinceHours", String(sinceHours));
    return getJson<{ bans: BanRow[]; total: number }>(
      `/api/v1/bans?${q.toString()}`,
    );
  },
};
