"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useViewRole, hasRole } from "./RoleToggle";
import { useEffect, useState } from "react";
import Icon from "./Icon";

const defaultTabs = [
  { href: "/clubs", label: "Clubs", iconName: "clubs" },
  { href: "/leagues", label: "Leagues", iconName: "trophy" },
  { href: "/events", label: "Events", iconName: "calendar" },
  { href: "/matches", label: "My Matches", iconName: "paddle" },
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
  const { viewRole } = useViewRole();
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === "admin" && hasRole(viewRole, "admin");
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

        // Find events the user participates in, owns, or helps with
        const myEvents = events.filter((e: { createdById?: string; players?: { playerId?: string; player?: { id: string } }[]; helpers?: { playerId?: string }[] }) =>
          e.createdById === userId ||
          e.players?.some((p: { playerId?: string; player?: { id: string } }) => (p.playerId || p.player?.id) === userId) ||
          e.helpers?.some((h: { playerId?: string }) => h.playerId === userId)
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

          // 0) Draft event being set up by user
          if (e.status === "draft" && e.createdById === userId) {
            if (!best || 110 > best.priority) best = { event: e, priority: 110 };
            continue;
          }

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

  // Detect club context from URL
  const clubMatch = pathname.match(/^\/clubs\/([^/]+)/);
  const clubId = clubMatch ? clubMatch[1] : null;

  const tabs = defaultTabs;

  const allTabs = isAdmin && !clubId
    ? [{ href: "/players", label: "Players", iconName: "players" }, ...tabs]
    : tabs;

  const isOnActiveEvent = activeEvent && pathname === `/events/${activeEvent.id}`;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-border pb-[env(safe-area-inset-bottom)]">
      <div className="max-w-[600px] mx-auto flex justify-around items-center h-16">
        {allTabs.map((tab) => {
          const tabPath = tab.href.split("?")[0];
          const isActive =
            tabPath === "/"
              ? pathname === "/"
              : pathname === tabPath || pathname.startsWith(tabPath + "/");
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
              <Icon name={tab.iconName} size={24} color={isActive ? "#2563EB" : "#6B7280"} />
              <span className="text-[11px]">{tab.label}</span>
            </Link>
          );
        })}
        {/* Active event — right of My Events */}
        {activeEvent && !isOnActiveEvent && (
          <Link
            href={`/events/${activeEvent.id}`}
            className={`flex flex-col items-center gap-0.5 px-2 py-1 rounded-lg text-white shadow-md ${
              activeEvent.status === "draft" ? "bg-blue-600" : "bg-green-600 animate-pulse-slow"
            }`}
            aria-label={`Active event: ${activeEvent.name}`}
          >
            <Icon name={activeEvent.status === "draft" ? "edit" : "pickleball"} size={20} color="white" />
            <span className="text-[9px] font-bold truncate max-w-[50px]">{activeEvent.status === "draft" ? "Draft" : "Live"}</span>
          </Link>
        )}
      </div>
    </nav>
  );
}
