"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

/**
 * Header context — lets a page drive the GLOBAL header's top-left slot:
 *   - a hierarchical back link (sub-pages), OR
 *   - a page title (main list pages, which have no back button).
 *
 * The back link is rendered in the exact same top-left position as the green
 * hero pages, so it's consistent app-wide. Main lists (Events, Leagues, …)
 * have no back, so they put their TITLE there instead of in the page body.
 *
 * Hero / hero-sub pages don't use this — they render their own AppHeader.
 */
export type HeaderBack = { label: string; href?: string; onClick?: () => void; subtitle?: string };

const Ctx = createContext<{
  back: HeaderBack | null;
  title: string | null;
  setBack: (b: HeaderBack | null) => void;
  setTitle: (t: string | null) => void;
}>({
  back: null,
  title: null,
  setBack: () => {},
  setTitle: () => {},
});

export function HeaderBackProvider({ children }: { children: ReactNode }) {
  const [back, setBack] = useState<HeaderBack | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  return <Ctx.Provider value={{ back, title, setBack, setTitle }}>{children}</Ctx.Provider>;
}

/** Read the currently-registered back link / title (used by Header.tsx). */
export function useHeaderBackValue() {
  return useContext(Ctx).back;
}
export function useHeaderTitleValue() {
  return useContext(Ctx).title;
}

/**
 * Register this page's back link in the global header's top-left slot. Pass
 * `null` to explicitly show no back. Clears automatically on unmount / nav.
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

/**
 * Register this page's title in the global header's top-left slot — for main
 * list pages that have no back button. Clears on unmount / nav.
 */
export function useHeaderTitle(title: string | null) {
  const { setTitle } = useContext(Ctx);
  useEffect(() => {
    setTitle(title);
    return () => setTitle(null);
  }, [title, setTitle]);
}
