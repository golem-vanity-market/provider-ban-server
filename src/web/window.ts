import { useSyncExternalStore } from "react";
import type { WindowKey } from "../shared/types.ts";

// One shared history-window selection for the whole app (dataviz rule: the
// date-range filter scopes everything below it). Persisted across visits.

const STORAGE_KEY = "ban-server-window";
const VALID: WindowKey[] = ["d1", "d7", "d30", "all"];

export const WINDOW_LABELS: Record<WindowKey, string> = {
  d1: "24 hours",
  d7: "7 days",
  d30: "30 days",
  all: "All time",
};

export const WINDOW_SHORT: Record<WindowKey, string> = {
  d1: "24h",
  d7: "7d",
  d30: "30d",
  all: "all",
};

/** API query-param value for a window key. */
export const WINDOW_PARAM: Record<WindowKey, string> = {
  d1: "1d",
  d7: "7d",
  d30: "30d",
  all: "all",
};

export const WINDOW_HOURS: Record<WindowKey, number | undefined> = {
  d1: 24,
  d7: 7 * 24,
  d30: 30 * 24,
  all: undefined,
};

let current: WindowKey = (() => {
  try {
    const v = localStorage.getItem(STORAGE_KEY) as WindowKey | null;
    return v && VALID.includes(v) ? v : "d1";
  } catch {
    return "d1";
  }
})();

const listeners = new Set<() => void>();

export function setWindowKey(w: WindowKey): void {
  current = w;
  try {
    localStorage.setItem(STORAGE_KEY, w);
  } catch {
    // private mode etc. - selection still works for the session
  }
  listeners.forEach((l) => l());
}

export function useWindowKey(): WindowKey {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}
