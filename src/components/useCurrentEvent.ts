"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { usePathname } from "next/navigation";
import { preloadEvent } from "@/lib/swr";

/**
 * "Current event" resolver — powers the bottom-right quick-jump FAB.
 *
 * Manual pin WINS: if the user tapped "Set as current" on an event (stored in
 * localStorage), that's the current event until it completes or is cleared.
 * Otherwise we auto-detect from the user's events with the same heuristic the
 * nav badge used: a setup event they're preparing > a live event > one that
 * just ended > the next upcoming.
 */
const PIN_KEY = "pickleplay_currentEventPin";
const PIN_EVENT = "currentEventPin:changed";

export interface CurrentEvent {
  id: string;
  name: string;
  status: string;
}

interface RawEvent {
  id: string;
  name: string;
  status: string;
  date: string;
  endDate?: string | null;
  createdById?: string;
  players?: { playerId?: string; player?: { id: string } }[];
  helpers?: { playerId?: string }[];
}

export function readPin(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(PIN_KEY);
}

/** Pin / unpin the current event. Broadcasts so any mounted hook updates. */
export function setCurrentEventPin(id: string | null) {
  if (typeof window === "undefined") return;
  if (id) window.localStorage.setItem(PIN_KEY, id);
  else window.localStorage.removeItem(PIN_KEY);
  window.dispatchEvent(new Event(PIN_EVENT));
}

function autoBest(events: RawEvent[], userId: string): RawEvent | null {
  const now = Date.now();
  const HOUR = 3600000;
  const mine = events.filter(
    (e) =>
      e.createdById === userId ||
      e.players?.some((p) => (p.playerId || p.player?.id) === userId) ||
      e.helpers?.some((h) => h.playerId === userId),
  );
  const future = mine
    .filter((e) => new Date(e.date).getTime() > now)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const nextEvent = future[0];
  const nextStartsIn2h = nextEvent && new Date(nextEvent.date).getTime() - now < 2 * HOUR;

  let best: { event: RawEvent; priority: number } | null = null;
  for (const e of mine) {
    const start = new Date(e.date).getTime();
    const end = e.endDate ? new Date(e.endDate).getTime() : start + 2 * HOUR;
    if ((e.status === "setup" || e.status === "draft") && e.createdById === userId) {
      if (!best || 110 > best.priority) best = { event: e, priority: 110 };
      continue;
    }
    if (now >= start && now <= end) {
      if (!best || 100 > best.priority) best = { event: e, priority: 100 };
      continue;
    }
    if (now > end && now - end < 4 * HOUR && !nextStartsIn2h) {
      if (!best || 50 > best.priority) best = { event: e, priority: 50 };
      continue;
    }
  }
  if (!best && nextEvent) best = { event: nextEvent, priority: 30 };
  return best?.event ?? null;
}

export function useCurrentEvent() {
  const { data: session } = useSession();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const pathname = usePathname();
  const [event, setEvent] = useState<CurrentEvent | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const lastPreloaded = useRef<string | null>(null);

  useEffect(() => {
    const read = () => setPinnedId(readPin());
    read();
    window.addEventListener("storage", read);
    window.addEventListener(PIN_EVENT, read);
    return () => {
      window.removeEventListener("storage", read);
      window.removeEventListener(PIN_EVENT, read);
    };
  }, []);

  useEffect(() => {
    if (!userId) {
      setEvent(null);
      return;
    }
    fetch("/api/events")
      .then((r) => (r.ok ? r.json() : []))
      .then((events: RawEvent[]) => {
        if (!Array.isArray(events)) return;
        // Manual pin wins — as long as it still exists and isn't completed.
        const pinned = pinnedId ? events.find((e) => e.id === pinnedId) : null;
        const pinnedValid = pinned && pinned.status !== "completed" && pinned.status !== "complete";
        const chosen = pinnedValid ? pinned : autoBest(events, userId);
        // Warm the current event's detail once so the FAB tap is instant.
        if (chosen && chosen.id !== lastPreloaded.current) {
          lastPreloaded.current = chosen.id;
          preloadEvent(chosen.id);
        }
        setEvent(chosen ? { id: chosen.id, name: chosen.name, status: chosen.status } : null);
      })
      .catch(() => {});
  }, [userId, pathname, pinnedId]);

  const pin = useCallback((id: string) => setCurrentEventPin(id), []);
  const unpin = useCallback(() => setCurrentEventPin(null), []);

  return { event, pinnedId, isPinned: !!pinnedId, pin, unpin };
}
