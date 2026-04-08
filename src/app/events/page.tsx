"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useViewRole, hasRole } from "@/components/RoleToggle";
import { ClearInput } from "@/components/ClearInput";
import { PlayerAvatar } from "@/components/PlayerAvatar";

interface Event {
  id: string;
  name: string;
  date: string;
  endDate: string | null;
  status: string;
  numCourts: number;
  format: string;
  scoringFormat: string;
  timedMinutes: number | null;
  pairingMode: string;
  openSignup: boolean;
  visibility: string;
  createdById: string | null;
  clubId: string | null;
  club?: { id: string; name: string; emoji: string; locations?: { id: string; name: string; googleMapsUrl?: string | null }[] } | null;
  classes?: { isDefault: boolean; format: string; scoringFormat: string; pairingMode: string; competitionMode?: string | null; maxPlayers?: number | null }[];
  players: { player: { name: string; emoji: string; photoUrl?: string | null }; playerId: string }[];
  helpers: { playerId: string }[];
  _count: { matches: number };
}

function getTimeStatus(event: Event): "past" | "active" | "upcoming" {
  const now = new Date();
  const start = new Date(event.date);
  const end = event.endDate ? new Date(event.endDate) : new Date(start.getTime() + 2 * 60 * 60 * 1000);
  if (now > end) return "past";
  if (now >= start && now <= end) return "active";
  return "upcoming";
}

export default function EventsPageWrapper() {
  return <Suspense><EventsPage /></Suspense>;
}

function EventsPage() {
  const { data: session } = useSession();
  const searchParams = useSearchParams();
  const clubFilter = searchParams.get("club");
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const { viewRole } = useViewRole();
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === "admin" && hasRole(viewRole, "admin");
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFilter, setDateFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<"all" | "events" | "competitions">("all");

  useEffect(() => {
    fetch("/api/events")
      .then((r) => r.json())
      .then((data) => {
        // Derive format fields from default class
        const enriched = (data || []).map((e: Event & { classes?: { isDefault: boolean; format: string; scoringFormat: string; pairingMode: string }[] }) => {
          const cls = e.classes?.find((c) => c.isDefault) || e.classes?.[0];
          if (cls) {
            e.format = cls.format;
            e.scoringFormat = cls.scoringFormat;
            e.pairingMode = cls.pairingMode;
          }
          return e;
        });
        // Filter by club if query param present
        const filtered = clubFilter
          ? enriched.filter((e: Event) => e.clubId === clubFilter)
          : enriched;
        setEvents(filtered);
        setLoading(false);
      });
  }, [clubFilter]);

  const deleteEvent = async (id: string) => {
    if (!confirm("Are you sure you want to delete this event and all its matches?")) return;
    await fetch(`/api/events/${id}`, { method: "DELETE" });
    setEvents((prev) => prev.filter((e) => e.id !== id));
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case "setup":
        return "bg-blue-100 text-blue-700";
      case "active":
        return "bg-green-100 text-green-700";
      case "completed":
        return "bg-gray-100 text-gray-600";
      default:
        return "bg-gray-100 text-gray-600";
    }
  };

  const matchesDateFilter = (dateStr: string, filter: string) => {
    if (filter === "all") return true;
    const eventDate = new Date(dateStr);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const DAY = 86400000;
    if (filter === "past7") {
      return eventDate >= new Date(today.getTime() - 7 * DAY) && eventDate < today;
    }
    if (filter === "today") {
      return eventDate >= today && eventDate < new Date(today.getTime() + DAY);
    }
    if (filter === "tomorrow") {
      const tmr = new Date(today.getTime() + DAY);
      return eventDate >= tmr && eventDate < new Date(tmr.getTime() + DAY);
    }
    if (filter === "next7") {
      return eventDate >= today && eventDate < new Date(today.getTime() + 7 * DAY);
    }
    if (filter === "next30") {
      return eventDate >= today && eventDate < new Date(today.getTime() + 30 * DAY);
    }
    return true;
  };

  // Club context from sessionStorage
  const activeClubId = typeof window !== "undefined" ? sessionStorage.getItem("activeClubId") : null;

  const filteredEvents = events
    .filter((e) => {
      if (!e.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      if (!matchesDateFilter(e.date, dateFilter)) return false;
      // Club filter
      if (activeClubId && e.clubId !== activeClubId) return false;
      // Type filter
      if (typeFilter === "competitions") {
        const hasCompetition = e.classes?.some((c) => c.competitionMode);
        if (!hasCompetition) return false;
      }
      if (typeFilter === "events") {
        const hasCompetition = e.classes?.some((c) => c.competitionMode);
        if (hasCompetition) return false;
      }
      return true;
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  if (loading) {
    return <div className="text-center py-12 text-muted">Loading...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">{clubFilter ? "My Club Events" : "My Events"}</h2>
        <Link
          href="/events/new"
          className="bg-action text-white px-4 py-2 rounded-lg font-medium text-sm active:bg-action-dark transition-colors"
        >
          + New
        </Link>
      </div>

      <div className="space-y-2">
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
          {([
            { value: "all", label: "All" },
            { value: "events", label: "Events" },
            { value: "competitions", label: "Competitions" },
          ] as const).map((t) => (
            <button key={t.value} onClick={() => setTypeFilter(t.value)}
              className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-all ${
                typeFilter === t.value ? "bg-white text-foreground shadow-sm" : "text-muted hover:text-foreground"
              }`}>
              {t.label}
            </button>
          ))}
        </div>
        <ClearInput value={searchQuery} onChange={setSearchQuery} placeholder="Search events..." className="text-sm" />
        <div className="flex flex-wrap gap-1.5">
          {[
            { value: "all", label: "All" },
            { value: "past7", label: "P7" },
            { value: "today", label: `${new Date().toLocaleDateString(undefined, { day: "numeric", month: "short" })} (Today)` },
            { value: "tomorrow", label: "Tomorrow" },
            { value: "next7", label: "N7" },
            { value: "next30", label: "N30" },
          ].map((f) => (
            <button
              key={f.value}
              onClick={() => setDateFilter(f.value)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                dateFilter === f.value
                  ? "bg-selected text-white"
                  : "bg-gray-100 text-muted hover:bg-gray-200"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {filteredEvents.length === 0 && events.length > 0 ? (
        <div className="text-center py-8">
          <p className="text-muted">No events match your search.</p>
        </div>
      ) : filteredEvents.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-5xl mb-3">🏸</div>
          <p className="text-muted">No events yet.</p>
          <Link href="/events/new" className="text-primary font-medium mt-2 inline-block">
            Create your first event
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredEvents.map((event) => {
            const timeStatus = getTimeStatus(event);
            const borderColor = timeStatus === "active" ? "border-l-green-500" : timeStatus === "upcoming" ? "border-l-blue-400" : "border-l-gray-300";
            const cardOpacity = timeStatus === "past" ? "opacity-60" : "";
            return (
            <div key={event.id} className={`bg-card rounded-xl border border-border border-l-4 ${borderColor} overflow-hidden ${cardOpacity}`}>
              <Link href={`/events/${event.id}`} className="block p-3 active:bg-gray-50 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="text-center min-w-[44px]">
                    <div className="text-xs text-muted uppercase">{new Date(event.date).toLocaleDateString(undefined, { month: "short" })}</div>
                    <div className="text-xl font-bold leading-tight">{new Date(event.date).getDate()}</div>
                    <div className="text-[10px] text-muted">{new Date(event.date).toLocaleDateString(undefined, { weekday: "short" })}</div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <h3 className="font-semibold text-sm truncate flex-1">{event.name}</h3>
                      {timeStatus === "active" && <span className="inline-block w-2 h-2 rounded-full bg-green-500 animate-pulse shrink-0" />}
                      {event.classes?.some((c) => c.competitionMode) ? (
                        <span className="text-[10px] bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded-full font-medium shrink-0">🏆 Comp</span>
                      ) : (
                        <span className="text-[10px] bg-green-50 text-green-700 px-1.5 py-0.5 rounded-full font-medium shrink-0">🎾 Social</span>
                      )}
                    </div>
                    <div className="flex items-center flex-wrap gap-1 mt-0.5">
                      <span className="text-xs text-muted">
                        {new Date(event.date).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                        {event.endDate && ` – ${new Date(event.endDate).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`}
                      </span>
                      {event.club?.locations?.[0] && (
                        event.club.locations[0].googleMapsUrl ? (
                          <a href={event.club.locations[0].googleMapsUrl} target="_blank" rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-[10px] text-action font-medium hover:underline">📍 {event.club.locations[0].name}</a>
                        ) : (
                          <span className="text-[10px] text-muted">📍 {event.club.locations[0].name}</span>
                        )
                      )}
                    </div>
                    <div className="flex items-center gap-1 mt-1">
                      <div className="flex -space-x-1.5">
                        {event.players.slice(0, 8).map((ep, i) => (
                          <div key={i} className="ring-2 ring-white rounded-full">
                            <PlayerAvatar name={ep.player.name} photoUrl={ep.player.photoUrl} size="xs" />
                          </div>
                        ))}
                        {event.players.length > 8 && (
                          <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-[9px] font-bold text-muted ring-2 ring-white">+{event.players.length - 8}</div>
                        )}
                      </div>
                      <span className="text-xs text-muted ml-1">
                        {event.players.length} players
                        {(() => { const cls = event.classes?.find((c) => c.isDefault) || event.classes?.[0]; return cls?.maxPlayers ? ` (max ${cls.maxPlayers})` : ""; })()}
                      </span>
                    </div>
                  </div>
                  <span className="text-xl text-muted">›</span>
                </div>
              </Link>
              {(isAdmin || event.createdById === userId) && (
                <div className="border-t border-border px-3 py-1.5 flex justify-end">
                  <button onClick={() => deleteEvent(event.id)}
                    className="text-danger text-xs px-2 py-1 rounded hover:bg-red-50">Delete</button>
                </div>
              )}
            </div>
          );})}
        </div>
      )}
    </div>
  );
}
