import type {
  ActiveBansResponse,
  BanRow,
  FleetSummary,
  OperatorsResponse,
  ProviderDetail,
  ProviderSummary,
  TargetsResponse,
} from "../shared/types.ts";

const API_BASE: string = import.meta.env.VITE_API_BASE || "";

async function getJson<T>(path: string): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`);
  if (!resp.ok) throw new Error(`API ${path} failed: ${resp.status}`);
  return (await resp.json()) as T;
}

async function sendJson<T>(
  method: "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = (await resp.json().catch(() => ({}))) as T & { error?: string };
  if (!resp.ok) {
    throw new Error(data.error ?? `API ${path} failed: ${resp.status}`);
  }
  return data;
}

export const api = {
  summary: () => getJson<FleetSummary>("/api/v1/summary"),
  providers: (params: {
    sort?: string;
    dir?: string;
    category?: string;
    search?: string;
    window?: string;
    seen?: string;
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
  operators: (window: string) =>
    getJson<OperatorsResponse>(`/api/v1/operators?window=${window}`),
  targets: () => getJson<TargetsResponse>("/api/v1/targets"),
  setTarget: (
    id: string | "global",
    body: {
      efficiencyTarget: number | null;
      speedTarget: number | null;
      note?: string | null;
    },
  ) => sendJson<{ message: string }>("PUT", `/api/v1/targets/${id}`, body),
  clearTarget: (id: string | "global") =>
    sendJson<{ message: string }>("DELETE", `/api/v1/targets/${id}`),
  banProvider: (providerId: string, reason: string, durationHours?: number) =>
    sendJson<{ id?: number; message: string }>("POST", "/api/v1/bans", {
      providerId,
      reason,
      source: "ui",
      durationHours,
    }),
  revokeBan: (banId: number) =>
    sendJson<{ message: string }>("DELETE", `/api/v1/bans/${banId}`),
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
