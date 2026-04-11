"use client";

import Link from "next/link";
import { Suspense, useEffect, useState, useCallback } from "react";
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
  classes?: { isDefault: boolean; format: string; scoringFormat: string; pairingMode: string; competitionMode?: string | null; maxPlayers?: number | null; skillMin?: number | null; skillMax?: number | null }[];
  players: { player: { name: string; emoji: string; photoUrl?: string | null }; playerId: string; status?: string }[];
  helpers: { playerId: string }[];
  _count: { matches: number };
}

interface UserClub {
  id: string;
  name: string;
  emoji: string;
  logoUrl?: string | null;
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
  const legacyClubFilter = searchParams.get("club"); // backwards compat
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const { viewRole } = useViewRole();
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === "admin" && hasRole(viewRole, "admin");

  const [events, setEvents] = useState<Event[]>([]);
  const [userClubs, setUserClubs] = useState<UserClub[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFilter, setDateFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<"all" | "events" | "competitions">("all");
  const [selectedClubIds, setSelectedClubIds] = useState<Set<string>>(new Set());
  const [showFilters, setShowFilters] = useState(false);
  const [clubsLoaded, setClubsLoaded] = useState(false);

  const fetchEvents = useCallback(() => {
    fetch("/api/events")
      .then((r) => r.json())
      .then((data) => {
        const enriched = (data || []).map((e: Event & { classes?: { isDefault: boolean; format: string; scoringFormat: string; pairingMode: string }[] }) => {
          const cls = e.classes?.find((c) => c.isDefault) || e.classes?.[0];
          if (cls) {
            e.format = cls.format;
            e.scoringFormat = cls.scoringFormat;
            e.pairingMode = cls.pairingMode;
          }
          return e;
        });
        setEvents(enriched);
        setLoading(false);
      });
  }, []);

  // Fetch user's clubs for filter
  useEffect(() => {
    if (!userId) return;
    fetch("/api/clubs").then((r) => r.ok ? r.json() : []).then((clubs) => {
      setUserClubs(clubs || []);
      // Default: select all user's clubs (or legacy single club filter)
      if (legacyClubFilter) {
        setSelectedClubIds(new Set([legacyClubFilter]));
      } else if (!clubsLoaded) {
        setSelectedClubIds(new Set((clubs || []).map((c: UserClub) => c.id)));
      }
      setClubsLoaded(true);
    });
  }, [userId, legacyClubFilter, clubsLoaded]);

  useEffect(() => {
    fetchEvents();
    const interval = setInterval(fetchEvents, 30000);
    const onFocus = () => fetchEvents();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) fetchEvents(); });
    return () => { clearInterval(interval); window.removeEventListener("focus", onFocus); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Save last page
  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem("pickleplay_lastPage", "/events");
  }, []);

  const deleteEvent = async (id: string) => {
    if (!confirm("Delete this event and all its matches?")) return;
    setEvents((prev) => prev.filter((e) => e.id !== id));
    fetch(`/api/events/${id}`, { method: "DELETE" });
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case "setup": case "draft": return "bg-blue-100 text-blue-700";
      case "active": return "bg-green-100 text-green-700";
      case "completed": return "bg-gray-100 text-gray-600";
      default: return "bg-gray-100 text-gray-600";
    }
  };

  const matchesDateFilter = (dateStr: string, filter: string) => {
    if (filter === "all") return true;
    const eventDate = new Date(dateStr);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const DAY = 86400000;
    if (filter === "past7") return eventDate >= new Date(today.getTime() - 7 * DAY) && eventDate < today;
    if (filter === "today") return eventDate >= today && eventDate < new Date(today.getTime() + DAY);
    if (filter === "tomorrow") { const tmr = new Date(today.getTime() + DAY); return eventDate >= tmr && eventDate < new Date(tmr.getTime() + DAY); }
    if (filter === "next7") return eventDate >= today && eventDate < new Date(today.getTime() + 7 * DAY);
    if (filter === "next30") return eventDate >= today && eventDate < new Date(today.getTime() + 30 * DAY);
    return true;
  };

  const toggleClub = (clubId: string) => {
    setSelectedClubIds((prev) => {
      const next = new Set(prev);
      if (next.has(clubId)) next.delete(clubId);
      else next.add(clubId);
      return next;
    });
  };

  const filteredEvents = events
    .filter((e) => {
      if (!e.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      if (!matchesDateFilter(e.date, dateFilter)) return false;
      // Club filter: show events from selected clubs, or events without a club
      if (selectedClubIds.size > 0 && e.clubId && !selectedClubIds.has(e.clubId)) return false;
      // Type filter
      if (typeFilter === "competitions") {
        if (!e.classes?.some((c) => c.competitionMode)) return false;
      }
      if (typeFilter === "events") {
        if (e.classes?.some((c) => c.competitionMode)) return false;
      }
      return true;
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  if (loading) return <div className="text-center py-12 text-muted">Loading...</div>;

  // Active filter summary
  const activeFilters: string[] = [];
  if (selectedClubIds.size > 0 && selectedClubIds.size < userClubs.length) {
    const names = userClubs.filter((c) => selectedClubIds.has(c.id)).map((c) => c.name);
    activeFilters.push(names.length <= 2 ? names.join(", ") : `${names.length} clubs`);
  }
  if (dateFilter !== "all") activeFilters.push(dateFilter === "past7" ? "Past 7d" : dateFilter === "today" ? "Today" : dateFilter === "tomorrow" ? "Tomorrow" : dateFilter === "next7" ? "Next 7d" : "Next 30d");
  if (typeFilter !== "all") activeFilters.push(typeFilter === "competitions" ? "Competitions" : "Social");

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Events</h2>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowFilters(!showFilters)}
            className={`text-sm px-2.5 py-1 rounded-lg transition-colors ${showFilters || activeFilters.length > 0 ? "bg-action/10 text-action" : "bg-gray-100 text-muted"}`}>
            🔍 {activeFilters.length > 0 ? activeFilters.length : ""}
          </button>
          <Link href="/events/new" className="bg-action text-white px-4 py-2 rounded-lg font-medium text-sm">+ New</Link>
        </div>
      </div>

      {/* Active filter summary */}
      {activeFilters.length > 0 && !showFilters && (
        <div className="flex flex-wrap gap-1">
          {activeFilters.map((f, i) => (
            <span key={i} className="text-[10px] bg-action/10 text-action px-2 py-0.5 rounded-full font-medium">{f}</span>
          ))}
          <button onClick={() => { setSelectedClubIds(new Set(userClubs.map((c) => c.id))); setDateFilter("all"); setTypeFilter("all"); setSearchQuery(""); }}
            className="text-[10px] text-muted hover:text-foreground px-1">Clear</button>
        </div>
      )}

      {/* Filter panel */}
      {showFilters && (
        <div className="bg-card rounded-xl border border-border p-3 space-y-3">
          {/* Club filter */}
          {userClubs.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium text-muted">Clubs</span>
                <button onClick={() => setSelectedClubIds(selectedClubIds.size === userClubs.length ? new Set() : new Set(userClubs.map((c) => c.id)))}
                  className="text-[10px] text-action">{selectedClubIds.size === userClubs.length ? "None" : "All"}</button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {userClubs.map((club) => (
                  <button key={club.id} onClick={() => toggleClub(club.id)}
                    className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${
                      selectedClubIds.has(club.id) ? "bg-action text-white" : "bg-gray-100 text-muted"
                    }`}>
                    {club.emoji} {club.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Search */}
          <ClearInput value={searchQuery} onChange={setSearchQuery} placeholder="Search events..." className="text-sm" />

          {/* Date filter */}
          <div className="flex flex-wrap gap-1.5">
            {[
              { value: "all", label: "All dates" },
              { value: "past7", label: "Past 7d" },
              { value: "today", label: "Today" },
              { value: "tomorrow", label: "Tomorrow" },
              { value: "next7", label: "Next 7d" },
              { value: "next30", label: "Next 30d" },
            ].map((f) => (
              <button key={f.value} onClick={() => setDateFilter(f.value)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                  dateFilter === f.value ? "bg-selected text-white" : "bg-gray-100 text-muted"
                }`}>{f.label}</button>
            ))}
          </div>

          {/* Type filter */}
          <div className="flex gap-1">
            {([
              { value: "all", label: "All" },
              { value: "events", label: "🎾 Social" },
              { value: "competitions", label: "🏆 Competition" },
            ] as const).map((t) => (
              <button key={t.value} onClick={() => setTypeFilter(t.value)}
                className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  typeFilter === t.value ? "bg-white text-foreground shadow-sm border border-border" : "text-muted hover:text-foreground"
                }`}>{t.label}</button>
            ))}
          </div>
        </div>
      )}

      {/* Events list */}
      {filteredEvents.length === 0 && events.length > 0 ? (
        <div className="text-center py-8"><p className="text-muted text-sm">No events match your filters.</p></div>
      ) : filteredEvents.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-5xl mb-3">🏸</div>
          <p className="text-muted">No events yet.</p>
          <Link href="/events/new" className="text-primary font-medium mt-2 inline-block">Create your first event</Link>
        </div>
      ) : (
        (() => {
          const now = new Date();
          const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          const tomorrow = new Date(today.getTime() + 86400000);

          const todayEvents = filteredEvents.filter((e) => { const d = new Date(e.date); return d >= today && d < tomorrow; });
          const upcomingEvents = filteredEvents.filter((e) => new Date(e.date) >= tomorrow);
          const pastEvents = filteredEvents.filter((e) => new Date(e.date) < today).reverse(); // most recent past first

          const renderEventCard = (event: Event) => {
            const timeStatus = getTimeStatus(event);
            const borderColor = timeStatus === "active" ? "border-l-green-500" : timeStatus === "past" ? "border-l-gray-300" : "border-l-blue-400";
            const cardOpacity = "";
            return (
            <div key={event.id} className={`bg-white rounded-xl border border-border border-l-4 ${borderColor} overflow-hidden ${cardOpacity}`}>
              <div className="p-3">
                <div className="flex items-center gap-3">
                  <div className="text-center min-w-[44px]">
                    <div className="text-xs text-muted uppercase">{new Date(event.date).toLocaleDateString(undefined, { month: "short" })}</div>
                    <div className="text-xl font-bold leading-tight">{new Date(event.date).getDate()}</div>
                    <div className="text-[10px] text-muted">{new Date(event.date).toLocaleDateString(undefined, { weekday: "short" })}</div>
                  </div>
                  <div className="flex-1 min-w-0">
                    {!legacyClubFilter && event.club && (
                      <div className="text-[10px] text-muted font-medium mb-0.5">{event.club.emoji} {event.club.name}</div>
                    )}
                    <div className="flex items-center gap-1.5">
                      <h3 className="font-semibold text-sm truncate flex-1">{event.name}</h3>
                      {timeStatus === "active" && <span className="inline-block w-2 h-2 rounded-full bg-green-500 animate-pulse shrink-0" />}
                      {event.classes?.some((c) => c.competitionMode) ? (
                        <span className="text-[10px] bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded-full font-medium shrink-0">🏆 Comp</span>
                      ) : (
                        <span className="text-[10px] bg-green-50 text-green-700 px-1.5 py-0.5 rounded-full font-medium shrink-0">🎾 Social</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 mt-0.5">
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
                      {(() => {
                        const cls = event.classes?.find((c) => c.isDefault) || event.classes?.[0];
                        if (!cls?.skillMin && !cls?.skillMax) return null;
                        const label = cls.skillMin && cls.skillMax
                          ? `${cls.skillMin.toFixed(1)}–${cls.skillMax.toFixed(1)}`
                          : cls.skillMin ? `${cls.skillMin.toFixed(1)}+`
                          : `≤${cls.skillMax!.toFixed(1)}`;
                        return <span className="text-[10px] bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded-full font-medium ml-auto shrink-0">DUPR {label}</span>;
                      })()}
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
                        {(() => {
                          const total = event.players.length;
                          const waitlisted = event.players.filter((p) => p.status === "waitlisted").length;
                          const registered = total - waitlisted;
                          const cls = event.classes?.find((c) => c.isDefault) || event.classes?.[0];
                          const max = cls?.maxPlayers;
                          const isFull = max && registered >= max;
                          return <>
                            {total} players
                            {isFull ? <span className="text-amber-600 font-medium"> · Full</span> : max ? ` (max ${max})` : ""}
                            {waitlisted > 0 && <span className="text-amber-600"> · {waitlisted} wl</span>}
                          </>;
                        })()}
                      </span>
                    </div>
                  </div>
                  <Link href={`/events/${event.id}`} className="flex items-center pl-2 self-stretch hover:bg-gray-50 active:bg-gray-100 transition-colors -my-3 -mr-3 pr-3 rounded-r-xl">
                    <span className="text-xl text-muted">›</span>
                  </Link>
                </div>
              </div>
              {(isAdmin || event.createdById === userId) && (
                <div className="border-t border-border px-3 py-1.5 flex justify-end">
                  <button onClick={() => deleteEvent(event.id)} className="text-danger text-xs px-2 py-1 rounded hover:bg-red-50">Delete</button>
                </div>
              )}
            </div>
          );};

          return (
            <div className="space-y-4">
              {/* Today's events — green background */}
              {todayEvents.length > 0 && (
                <div className="bg-green-100 -mx-4 px-4 py-3 border-y border-green-200">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                    <span className="text-xs font-bold text-green-700 uppercase tracking-wider">Today</span>
                  </div>
                  <div className="space-y-2">
                    {todayEvents.map(renderEventCard)}
                  </div>
                </div>
              )}

              {/* Upcoming events — normal background */}
              {upcomingEvents.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-bold text-blue-600 uppercase tracking-wider">Upcoming</span>
                  </div>
                  <div className="space-y-2">
                    {upcomingEvents.map(renderEventCard)}
                  </div>
                </div>
              )}

              {/* Past events — grey background */}
              {pastEvents.length > 0 && (
                <div className="bg-gray-100 -mx-4 px-4 py-3 border-y border-gray-200">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-bold text-muted uppercase tracking-wider">Past</span>
                  </div>
                  <div className="space-y-2">
                    {pastEvents.map(renderEventCard)}
                  </div>
                </div>
              )}
            </div>
          );
        })()
      )}
    </div>
  );
}
