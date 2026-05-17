"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

/**
 * Hide the bottom navigation bar while a fullscreen / focused-flow page
 * is mounted. Replaces the brittle DOM-hack `nav.fixed.bottom-0` lookup
 * that was copy-pasted across 7 pages.
 *
 * The bottom nav is rendered globally with the `nav.fixed.bottom-0`
 * class. When this hook fires we add the `hidden` class; on unmount we
 * remove it. Idempotent across component re-renders.
 */
export function useHideBottomNav(active: boolean = true) {
  useEffect(() => {
    if (!active) return;
    const nav = document.querySelector("nav.fixed.bottom-0");
    if (!nav) return;
    nav.classList.add("hidden");
    return () => { nav.classList.remove("hidden"); };
  }, [active]);
}

/**
 * Poll an async function on a fixed interval. Pauses while the tab is
 * hidden and re-fires immediately on focus, so background tabs don't
 * burn API quota or battery. Refs guard the callback so callers don't
 * have to memoise.
 *
 *   usePollingRefresh(() => fetchEvent(), 30000);
 *   usePollingRefresh(() => fetchLineup(), 15000, !saving && !pickerOpen);
 *
 * The optional `enabled` flag short-circuits the timer entirely (e.g.
 * disable polling while a save is in flight or a picker is open).
 */
export function usePollingRefresh(
  fn: () => void | Promise<void>,
  intervalMs: number = 30000,
  enabled: boolean = true,
) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    if (!enabled) return;
    const tick = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      if (!enabledRef.current) return;
      void fnRef.current();
    };
    const interval = setInterval(tick, intervalMs);
    const onVisible = () => { if (!document.hidden) tick(); };
    const onFocus = () => tick();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  }, [intervalMs, enabled]);
}

/**
 * Filter / tab state that survives back navigation.
 *
 * Behaves like useState, but reads its initial value from a URL search
 * param and writes every update back to the URL via router.replace
 * (no history entry — replacing means the back button moves to the
 * page you came from, not through every filter tweak).
 *
 *   const [search, setSearch] = useUrlState("q", "");
 *   const [tab, setTab] = useUrlState<Tab>("tab", "overview");
 *
 * The page re-renders whenever the URL changes (e.g. browser back),
 * so a chain of "list → detail → back" lands you on the same filter
 * state you left, for free, courtesy of Next.js Router Cache + SWR.
 *
 * For complex types pass `serialize` / `deserialize`:
 *   const [clubs, setClubs] = useUrlState<Set<string>>(
 *     "clubs",
 *     new Set(),
 *     {
 *       serialize: (s) => Array.from(s).join(","),
 *       deserialize: (v) => new Set(v ? v.split(",") : []),
 *     }
 *   );
 *
 * When a value equals the default it is removed from the URL — keeps
 * URLs short and the "all defaults" state matches a bare path.
 */
export function useUrlState<T>(
  key: string,
  defaultValue: T,
  options?: {
    serialize?: (v: T) => string;
    deserialize?: (raw: string) => T;
  },
): [T, (next: T) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const serialize = options?.serialize ?? ((v: T) => String(v));
  const deserialize = options?.deserialize ?? ((raw: string) => raw as unknown as T);

  const raw = searchParams.get(key);
  const value: T = raw == null ? defaultValue : deserialize(raw);

  const set = useCallback((next: T) => {
    const params = new URLSearchParams(Array.from(searchParams.entries()));
    const serialized = serialize(next);
    const isDefault = serialized === serialize(defaultValue);
    if (!serialized || isDefault) params.delete(key);
    else params.set(key, serialized);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [router, pathname, searchParams, key, serialize, defaultValue]);

  return [value, set];
}
