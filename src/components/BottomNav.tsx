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

        // Find active event: currently running or ended within 4 hours
        // Unless a new event starts within 2 hours
        let best: { event: typeof myEvents[0]; priority: number } | null = null;

        for (const e of myEvents) {
          const start = new Date(e.date).getTime();
          const end = e.endDate ? new Date(e.endDate).getTime() : start + 2 * HOUR;

          // Currently active (between start and end)
          if (now >= start && now <= end) {
            const priority = 100;
            if (!best || priority > best.priority) best = { event: e, priority };
            continue;
          }

          // Ended within last 4 hours
          if (now > end && now - end < 4 * HOUR) {
            // But check if another event starts within 2 hours
            const upcomingSoon = myEvents.some((other: { date: string }) => {
              const otherStart = new Date(other.date).getTime();
              return otherStart > now && otherStart - now < 2 * HOUR;
            });
            if (!upcomingSoon) {
              const priority = 50;
              if (!best || priority > best.priority) best = { event: e, priority };
            }
            continue;
          }

          // Starting within 2 hours
          if (start > now && start - now < 2 * HOUR) {
            const priority = 80;
            if (!best || priority > best.priority) best = { event: e, priority };
          }
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
        {/* Active event button — prominent */}
        {activeEvent && !isOnActiveEvent && (
          <Link
            href={`/events/${activeEvent.id}`}
            className="flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg text-white bg-green-600 shadow-md animate-pulse-slow relative"
          >
            <span className="text-xl">⚡</span>
            <span className="text-[10px] font-bold truncate max-w-[60px]">{activeEvent.name}</span>
          </Link>
        )}
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
      </div>
    </nav>
  );
}
