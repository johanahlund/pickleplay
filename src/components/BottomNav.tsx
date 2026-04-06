"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";

const tabs = [
  { href: "/clubs", label: "Clubs", icon: "🏟️" },
  { href: "/events", label: "My Events", icon: "📅" },
  { href: "/matches", label: "My Matches", icon: "🏓" },
];

const HIDDEN_PATHS = ["/signin", "/register", "/claim", "/reset"];

interface ActiveEvent {
  id: string;
  name: string;
  status: string;
}

export function BottomNav() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === "admin";
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const [activeEvent, setActiveEvent] = useState<ActiveEvent | null>(null);

  // Fetch user's active/next event
  useEffect(() => {
    if (!userId) return;
    fetch("/api/events")
      .then((r) => r.ok ? r.json() : [])
      .then((events) => {
        if (!Array.isArray(events)) return;
        const now = Date.now();
        const HOUR = 3600000;

        // Find events the user participates in
        const myEvents = events.filter((e: { players?: { playerId?: string; player?: { id: string } }[] }) =>
          e.players?.some((p: { playerId?: string; player?: { id: string } }) => (p.playerId || p.player?.id) === userId)
        );

        // Priority: 1) Currently running, 2) Ended within 4h (unless next starts in 2h), 3) Next upcoming
        let best: { event: typeof myEvents[0]; priority: number } | null = null;

        // Find next upcoming event (closest future start)
        const futureEvents = myEvents
          .filter((e: { date: string }) => new Date(e.date).getTime() > now)
          .sort((a: { date: string }, b: { date: string }) => new Date(a.date).getTime() - new Date(b.date).getTime());
        const nextEvent = futureEvents[0];
        const nextStartsIn2h = nextEvent && new Date(nextEvent.date).getTime() - now < 2 * HOUR;

        for (const e of myEvents) {
          const start = new Date(e.date).getTime();
          const end = e.endDate ? new Date(e.endDate).getTime() : start + 2 * HOUR;

          // 1) Currently active (between start and end)
          if (now >= start && now <= end) {
            if (!best || 100 > best.priority) best = { event: e, priority: 100 };
            continue;
          }

          // 2) Ended within last 4 hours — but not if next event starts within 2h
          if (now > end && now - end < 4 * HOUR && !nextStartsIn2h) {
            if (!best || 50 > best.priority) best = { event: e, priority: 50 };
            continue;
          }
        }

        // 3) Next upcoming event (if nothing active or recent)
        if (!best && nextEvent) {
          best = { event: nextEvent, priority: 30 };
        }

        if (best) {
          setActiveEvent({ id: best.event.id, name: best.event.name, status: best.event.status });
        } else {
          setActiveEvent(null);
        }
      })
      .catch(() => {});
  }, [userId, pathname]); // refetch on navigation

  if (HIDDEN_PATHS.some((p) => pathname.startsWith(p))) return null;

  const allTabs = isAdmin
    ? [...tabs, { href: "/players", label: "Players", icon: "👤" }]
    : tabs;

  const isOnActiveEvent = activeEvent && pathname === `/events/${activeEvent.id}`;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-border pb-[env(safe-area-inset-bottom)]">
      <div className="max-w-[600px] mx-auto flex justify-around items-center h-16">
        {allTabs.map((tab) => {
          const isActive =
            tab.href === "/"
              ? pathname === "/"
              : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg transition-colors ${
                isActive
                  ? "text-primary font-semibold"
                  : "text-muted hover:text-foreground"
              }`}
            >
              <span className="text-xl">{tab.icon}</span>
              <span className="text-[11px]">{tab.label}</span>
            </Link>
          );
        })}
        {/* Active event — right of My Events */}
        {activeEvent && !isOnActiveEvent && (
          <Link
            href={`/events/${activeEvent.id}`}
            className="flex flex-col items-center gap-0.5 px-2 py-1 rounded-lg text-white bg-green-600 shadow-md animate-pulse-slow"
          >
            <span className="text-lg">⚡</span>
            <span className="text-[9px] font-bold truncate max-w-[50px]">Live</span>
          </Link>
        )}
      </div>
    </nav>
  );
}
