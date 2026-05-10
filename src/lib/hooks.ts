"use client";

import { useEffect, useRef } from "react";

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
