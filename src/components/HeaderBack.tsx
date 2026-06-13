"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

/**
 * Header-back context — lets any non-hero page register its hierarchical "up"
 * target so the GLOBAL header renders the back link in the exact same top-left
 * slot as the green hero pages. One back-link position across the whole app.
 *
 * Hero / hero-sub pages don't use this — they render their own AppHeader with
 * `back` and are hidden from the global Header. Everyone else (edit pages,
 * alerts, club detail, …) calls `useHeaderBack(...)` and the global LightHeader
 * shows it.
 */
export type HeaderBack = { label: string; href?: string; onClick?: () => void; subtitle?: string };

const Ctx = createContext<{ back: HeaderBack | null; setBack: (b: HeaderBack | null) => void }>({
  back: null,
  setBack: () => {},
});

export function HeaderBackProvider({ children }: { children: ReactNode }) {
  const [back, setBack] = useState<HeaderBack | null>(null);
  return <Ctx.Provider value={{ back, setBack }}>{children}</Ctx.Provider>;
}

/** Read the currently-registered back link (used by Header.tsx). */
export function useHeaderBackValue() {
  return useContext(Ctx).back;
}

/**
 * Register this page's back link in the global header's top-left slot. Pass
 * `null` to explicitly show no back. Clears automatically on unmount / nav.
 *
 * Keyed on the back's label/href/subtitle so re-renders with a fresh object
 * literal don't thrash the context (onClick is captured from the latest render
 * that changed the key — fine for the stable handlers pages use).
 */
export function useHeaderBack(back: HeaderBack | null) {
  const { setBack } = useContext(Ctx);
  const key = back ? `${back.label}|${back.href ?? ""}|${back.subtitle ?? ""}` : "";
  useEffect(() => {
    setBack(back);
    return () => setBack(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, setBack]);
}
