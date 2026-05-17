"use client";

import Link from "next/link";
import { ClubBadge } from "@/components/ClubBadge";
import { Suspense, useEffect, useState, useCallback, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useViewRole, hasRole } from "@/components/RoleToggle";
import { ClearInput } from "@/components/ClearInput";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { setPreview } from "@/lib/entityPreview";
import { useConfirm } from "@/components/ConfirmDialog";
import { usePollingRefresh } from "@/lib/hooks";
import { eventDisplayLabel } from "@/lib/statusDisplay";
import { eventStatusBadgeClass } from "@/lib/statusBadge";
import { frameClass } from "@/components/Card";
import { nameMatchesSearch } from "@/lib/searchUtil";

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
  createdBy?: { id: string; name: string; emoji?: string | null; photoUrl?: string | null } | null;
  clubId: string | null;
  roundId?: string | null; // present when this event is attached to a league round
  club?: { id: string; name: string; shortName?: string | null; emoji: string; locations?: { id: string; name: string; googleMapsUrl?: string | null }[] } | null;
  classes?: { isDefault: boolean; format: string; scoringFormat: string; pairingMode: string; competitionMode?: string | null; maxPlayers?: number | null; skillMin?: number | null; skillMax?: number | null }[];
  players: { player: { name: string; emoji: string; photoUrl?: string | null; gender?: string | null }; playerId: string; status?: string }[];
  helpers: { playerId: string }[];
  _count: { matches: number };
}

interface UserClub {
  id: string;
  name: string;
  shortName?: string | null;
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const legacyClubFilter = searchParams.get("club"); // backwards compat
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const { viewRole } = useViewRole();
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === "admin" && hasRole(viewRole, "admin");
  const { confirm: confirmDialog } = useConfirm();

  // Cache the events list in sessionStorage so navigating back from a
  // detail page renders the list instantly. The list is still refreshed
  // in the background when fetchEvents runs on mount.
  const [events, setEvents] = useState<Event[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const cached = window.sessionStorage.getItem("events-list-cache");
      return cached ? JSON.parse(cached) : [];
    } catch {
      return [];
    }
  });
  const [userClubs, setUserClubs] = useState<UserClub[]>([]);
  const [loading, setLoading] = useState(true); // always true on first render to avoid hydration mismatch
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFilter, setDateFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<"all" | "events" | "competitions" | "liga">("all");
  const [selectedClubIds, setSelectedClubIds] = useState<Set<string>>(new Set());
  const [myEventsOnly, setMyEventsOnly] = useState(false);
  const [activeOnly, setActiveOnly] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [clubsLoaded, setClubsLoaded] = useState(false);
  const [hoveredEventId, setHoveredEventId] = useState<string | null>(null);
  const todayRef = useRef<HTMLDivElement>(null);
  // Jump-link targets for the new "↓ PAST" / "↑ UPCOMING" links on
  // the section header rows.
  const upcomingRef = useRef<HTMLDivElement>(null);
  const pastRef = useRef<HTMLDivElement>(null);
  const [scrolledToToday, setScrolledToToday] = useState(false);

  const fetchEvents = useCallback(async () => {
    // Defensive fetch: any non-OK response (401 session expired, 500,
    // network error, etc.) must NOT leave the page stuck on "loading".
    // Previously a 401 would return a `{error: ...}` object, .map()
    // would crash silently, and loading stayed true → blank page.
    try {
      const r = await fetch("/api/events");
      if (!r.ok) {
        console.warn("[events] fetch failed", r.status);
        setLoading(false);
        return;
      }
      const data = await r.json().catch(() => null);
      if (!Array.isArray(data)) {
        console.warn("[events] non-array response", data);
        setLoading(false);
        return;
      }
      const enriched = data.map((e: Event & { classes?: { isDefault: boolean; format: string; scoringFormat: string; pairingMode: string }[] }) => {
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
      // Refresh the cache so next navigation shows the latest data instantly.
      try {
        window.sessionStorage.setItem("events-list-cache", JSON.stringify(enriched));
      } catch {
        // ignore quota
      }
    } catch (err) {
      console.warn("[events] fetch threw", err);
      setLoading(false);
    }
  }, []);

  // Fetch user's clubs for filter
  useEffect(() => {
    if (!userId) return;
    fetch("/api/clubs").then((r) => r.ok ? r.json() : []).then((clubs) => {
      setUserClubs(clubs || []);
      // Default: NO club filter — show every event the user has access
      // to. Auto-filtering to "my clubs" hid public events from clubs
      // the user isn't in (or events with no club at all when the user
      // had clubs). The filter is still available via the Filters panel.
      if (legacyClubFilter) {
        setSelectedClubIds(new Set([legacyClubFilter]));
      }
      setClubsLoaded(true);
    });
  }, [userId, legacyClubFilter, clubsLoaded]);

  useEffect(() => { fetchEvents(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  usePollingRefresh(fetchEvents, 30000);

  // Save last page
  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem("pickleplay_lastPage", "/events");
  }, []);

  // Scroll to Today section on first load
  useEffect(() => {
    if (!loading && !scrolledToToday && todayRef.current) {
      setTimeout(() => {
        todayRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        setScrolledToToday(true);
      }, 100);
    }
  }, [loading, scrolledToToday]);

  const deleteEvent = async (id: string) => {
    const ok = await confirmDialog({
      title: "Delete event?",
      message: "All matches will also be deleted. This cannot be undone.",
      confirmText: "Delete",
      danger: true,
    });
    if (!ok) return;
    setEvents((prev) => prev.filter((e) => e.id !== id));
    fetch(`/api/events/${id}`, { method: "DELETE" });
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
        // Social = non-competition AND non-league.
        if (e.classes?.some((c) => c.competitionMode)) return false;
        if (e.roundId) return false;
      }
      if (typeFilter === "liga") {
        if (!e.roundId) return false;
      }
      // My events only
      if (myEventsOnly && userId) {
        const isPlayer = e.players.some((p) => p.playerId === userId);
        const isCreator = e.createdById === userId;
        const isHelper = e.helpers?.some((h) => h.playerId === userId);
        if (!isPlayer && !isCreator && !isHelper) return false;
      }
      // Active only
      if (activeOnly) {
        const ts = getTimeStatus(e);
        if (ts !== "active") return false;
      }
      return true;
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // Loading handled inline below — header always shows

  // Active filter summary
  const activeFilters: string[] = [];
  if (selectedClubIds.size > 0 && selectedClubIds.size >= userClubs.length) {
    activeFilters.push("All Clubs");
  } else if (selectedClubIds.size > 0) {
    const names = userClubs.filter((c) => selectedClubIds.has(c.id)).map((c) => c.name);
    activeFilters.push(names.length <= 2 ? names.join(", ") : `${names.length} clubs`);
  }
  if (searchQuery) activeFilters.push(`"${searchQuery}"`);
  if (dateFilter !== "all") activeFilters.push(dateFilter === "past7" ? "Past 7d" : dateFilter === "today" ? "Today" : dateFilter === "tomorrow" ? "Tomorrow" : dateFilter === "next7" ? "Next 7d" : "Next 30d");
  if (typeFilter !== "all") activeFilters.push(
    typeFilter === "competitions" ? "Competitions" :
    typeFilter === "liga" ? "Liga" :
    "Social",
  );
  if (myEventsOnly) activeFilters.push("My events");
  if (activeOnly) activeFilters.push("Live");

  return (
    <div className="space-y-4">
      {/* Back link when filtered by club */}
      {legacyClubFilter && (
        <button onClick={() => window.history.back()} className="text-sm text-action font-medium">← Club <span className="text-xs text-muted font-normal">({userClubs.find((c) => c.id === legacyClubFilter)?.name || ""})</span></button>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">
          {showFilters ? "Filter Events" : legacyClubFilter ? "Club Events" : "Events"}
        </h2>
        {/* Right-side action: Apply (when filtering) or Add (when browsing) */}
        {showFilters ? (
          <button
            onClick={() => setShowFilters(false)}
            className="bg-action text-white px-4 py-2 rounded-lg font-medium text-sm active:bg-action-dark transition-colors"
          >
            Apply
          </button>
        ) : session?.user ? (
          <Link
            href="/events/new"
            className="text-action border border-action/30 px-4 py-2 rounded-lg font-medium text-sm hover:bg-action/5 active:bg-action/10 transition-colors"
          >
            + Event
          </Link>
        ) : null}
      </div>

      {/* Filter rows — wrapped in an outer frame so it reads as a
          single cluster. Three rows:
            1) search + date selector
            2) framed: My clubs pills
            3) framed: type icons + My Events (right)
          None selected = no constraint. Club pills are multi-select
          (OR); type icons are single-select. */}
      {!showFilters && (
        <div className="border border-gray-200 rounded-xl p-2 space-y-1.5 bg-white">
          {/* Row 1: search (flex-1) + date selector (right) */}
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search events..."
              className="flex-1 min-w-0 text-xs border border-border rounded-lg px-3 py-1.5 bg-white"
            />
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="text-xs border border-border rounded-lg px-2 py-1.5 bg-white shrink-0"
            >
              <option value="all">All dates</option>
              <option value="past7">Past 7 days</option>
              <option value="today">Today</option>
              <option value="tomorrow">Tomorrow</option>
              <option value="next7">Next 7 days</option>
              <option value="next30">Next 30 days</option>
            </select>
          </div>
          {/* Row 2: clubs (framed) */}
          {userClubs.length > 0 && (
            <div className="border border-gray-300 rounded-lg p-1 flex flex-wrap items-center gap-1">
              {userClubs.map((c) => {
                const selected = selectedClubIds.has(c.id);
                return (
                  <button key={c.id}
                    onClick={() => toggleClub(c.id)}
                    className={`text-xs px-2 py-0.5 rounded-md font-medium transition-colors inline-flex items-center gap-1 ${
                      selected ? "bg-action text-white" : "text-foreground hover:bg-gray-100"
                    }`}
                  >
                    <ClubBadge logoUrl={c.logoUrl} size={14} />
                    {(c.shortName?.trim() || c.name.slice(0, 10))}
                  </button>
                );
              })}
            </div>
          )}
          {/* Row 3: type icons (framed) + My Events (right) */}
          <div className="flex items-center gap-1.5">
            <div className="border border-gray-300 rounded-lg p-0.5 flex gap-0.5">
              {([
                { value: "events", label: "🎾", title: "Social" },
                { value: "competitions", label: "🏆", title: "Competition" },
                { value: "liga", label: "🥇", title: "Liga" },
              ] as const).map((t) => (
                <button key={t.value}
                  onClick={() => setTypeFilter(typeFilter === t.value ? "all" : t.value)}
                  title={t.title}
                  aria-label={t.title}
                  className={`w-9 h-7 rounded-md text-base font-medium transition-colors inline-flex items-center justify-center ${
                    typeFilter === t.value ? "bg-selected text-white" : "text-foreground hover:bg-gray-100"
                  }`}
                >{t.label}</button>
              ))}
            </div>
            <button onClick={() => setMyEventsOnly(!myEventsOnly)}
              className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ml-auto ${
                myEventsOnly ? "bg-action text-white" : "bg-gray-100 text-muted hover:bg-gray-200"
              }`}
            >👤 My Events</button>
          </div>
          {activeFilters.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
              {activeFilters.map((f, i) => (
                <span key={i} className="text-[10px] bg-action/10 text-action px-2 py-0.5 rounded-full font-medium">{f}</span>
              ))}
              <button onClick={() => { setSelectedClubIds(new Set()); setDateFilter("all"); setTypeFilter("all"); setSearchQuery(""); setMyEventsOnly(false); setActiveOnly(false); }}
                className="text-[10px] text-muted hover:text-foreground px-1">✕ Clear</button>
            </div>
          )}
        </div>
      )}

      {/* Filter panel */}
      {showFilters && (
        <div className={`${frameClass} p-3 space-y-3`}>
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
                    className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors inline-flex items-center gap-1 ${
                      selectedClubIds.has(club.id) ? "bg-action text-white" : "bg-gray-100 text-muted"
                    }`}>
                    <ClubBadge logoUrl={club.logoUrl} size={14} />
                    {(club.shortName?.trim() || club.name.slice(0, 10))}
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
          <div className="flex flex-wrap gap-1.5">
            {([
              { value: "all", label: "All types" },
              { value: "events", label: "🎾 Social" },
              { value: "competitions", label: "🏆 Competition" },
              { value: "liga", label: "🥇 Liga" },
            ] as const).map((t) => (
              <button key={t.value} onClick={() => setTypeFilter(t.value)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                  typeFilter === t.value ? "bg-selected text-white" : "bg-gray-100 text-muted"
                }`}>{t.label}</button>
            ))}
          </div>

          {/* Quick toggles */}
          <div className="flex gap-2 pt-1">
            <button onClick={() => setMyEventsOnly(!myEventsOnly)}
              className={`flex-1 py-2 rounded-xl text-xs font-semibold border transition-colors ${
                myEventsOnly ? "bg-action/10 border-action text-action" : "border-border text-muted hover:text-foreground"
              }`}>👤 My events</button>
            <button onClick={() => setActiveOnly(!activeOnly)}
              className={`flex-1 py-2 rounded-xl text-xs font-semibold border transition-colors ${
                activeOnly ? "bg-green-50 border-green-500 text-green-700" : "border-border text-muted hover:text-foreground"
              }`}>🟢 Live now</button>
          </div>
        </div>
      )}

      {/* Events list — hidden when filter panel is open */}
      {loading ? (
        <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-action border-t-transparent rounded-full animate-spin" /></div>
      ) : !showFilters && (filteredEvents.length === 0 && events.length > 0 ? (
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
            const cardBg = timeStatus === "past" ? "bg-gray-50" : "bg-white";
            const canDelete = isAdmin || event.createdById === userId;
            return (
            <div key={event.id} className="relative">
            <Link
              href={`/events/${event.id}`}
              onClick={() => setPreview("event", event.id, event)}
              className={`block ${cardBg} rounded-xl border border-border border-l-4 ${borderColor} overflow-hidden active:bg-gray-50 transition-colors`}
            >
              <div className="p-3">
                <div className="flex items-center gap-3">
                  <div className="text-center min-w-[44px]">
                    <div className="text-xs text-muted uppercase">{new Date(event.date).toLocaleDateString(undefined, { month: "short" })}</div>
                    <div className="text-xl font-bold leading-tight">{new Date(event.date).getDate()}</div>
                    <div className="text-[10px] text-muted">{new Date(event.date).toLocaleDateString(undefined, { weekday: "short" })}</div>
                  </div>
                  <div className="flex-1 min-w-0">
                    {/* Club + Location row */}
                    {event.club && (
                      <div className="flex items-center gap-1 mb-0.5 text-[10px]">
                        <span onClick={(e) => { e.preventDefault(); e.stopPropagation(); router.push(`/clubs/${event.club!.id}`); }}
                          className="text-muted font-medium hover:text-action cursor-pointer">{(event.club.shortName?.trim() || event.club.name.slice(0, 10))}</span>
                        {event.club?.locations?.[0] && (
                          <>
                            <span className="text-muted">·</span>
                            {event.club.locations[0].googleMapsUrl ? (
                              <span onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.open(event.club!.locations![0].googleMapsUrl!, "_blank"); }}
                                className="text-action hover:underline cursor-pointer">📍 {event.club.locations[0].name}</span>
                            ) : (
                              <span className="text-muted">📍 {event.club.locations[0].name}</span>
                            )}
                          </>
                        )}
                      </div>
                    )}
                    {/* Event name + type + status */}
                    <div className="flex items-center gap-1.5">
                      <h3 className="font-semibold text-sm truncate flex-1">{event.name}</h3>
                      {timeStatus === "active" && <span className="inline-block w-2 h-2 rounded-full bg-green-500 animate-pulse shrink-0" />}
                      {event.roundId ? (
                        <span className="text-[10px] bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded-full font-medium shrink-0">🏆 League</span>
                      ) : event.classes?.some((c) => c.competitionMode) ? (
                        <span className="text-[10px] bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded-full font-medium shrink-0">🏆 Comp</span>
                      ) : (
                        <span className="text-[10px] bg-green-50 text-green-700 px-1.5 py-0.5 rounded-full font-medium shrink-0">🎾 Social</span>
                      )}
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${eventStatusBadgeClass(event)}`}>
                        {eventDisplayLabel(event)}
                      </span>
                    </div>
                    {/* Time + Organizer + DUPR (all same small font) */}
                    <div className="flex items-center gap-1 mt-0.5 min-w-0">
                      <span className="text-[10px] text-muted shrink-0">
                        {new Date(event.date).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                        {event.endDate && ` – ${new Date(event.endDate).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`}
                      </span>
                      {event.createdBy && (
                        <span className="text-[10px] text-muted truncate">
                          · Organizer: <span className="text-foreground font-medium">{event.createdBy.name}</span>
                        </span>
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
                          const males = event.players.filter((p) => p.player.gender === "M").length;
                          const females = event.players.filter((p) => p.player.gender === "F").length;
                          const cls = event.classes?.find((c) => c.isDefault) || event.classes?.[0];
                          const max = cls?.maxPlayers;
                          const isFull = max && registered >= max;
                          return <>
                            {total} players
                            <span className="text-blue-500"> · {males}♂</span>
                            <span className="text-pink-500"> · {females}♀</span>
                            {isFull ? <span className="text-amber-600 font-medium"> · Full</span> : max ? ` (max ${max})` : ""}
                            {waitlisted > 0 && <span className="text-amber-600"> · {waitlisted} wl</span>}
                          </>;
                        })()}
                      </span>
                    </div>
                  </div>
                  <span className="text-xl text-muted shrink-0">›</span>
                </div>
              </div>
            </Link>
            </div>
          );};

          return (
            <div className="space-y-4">
              {/* Today's events — green background */}
              {todayEvents.length > 0 && (
                <div ref={todayRef} className="bg-green-100 -mx-4 px-4 py-3 border-y border-green-200">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                    <span className="text-xs font-bold text-green-700 uppercase tracking-wider">Today</span>
                  </div>
                  <div className="space-y-2">
                    {todayEvents.map(renderEventCard)}
                  </div>
                </div>
              )}

              {/* Upcoming events — sticky header with jump-to-Past */}
              {upcomingEvents.length > 0 && (
                <div ref={upcomingRef}>
                  <div
                    className="flex items-center gap-2 mb-2 sticky z-20 bg-white -mx-4 px-4 py-2 border-b border-border"
                    style={{ top: "var(--header-height, 0px)" }}
                  >
                    <button
                      type="button"
                      onClick={() => upcomingRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
                      title="Jump to start of Upcoming"
                      className="text-xs font-bold text-blue-600 hover:text-blue-700 uppercase tracking-wider"
                    >Upcoming</button>
                    {pastEvents.length > 0 && (
                      <button
                        type="button"
                        onClick={() => pastRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
                        className="ml-auto text-xs font-bold text-muted hover:text-foreground uppercase tracking-wider"
                      >Past ↓</button>
                    )}
                  </div>
                  <div className="space-y-2">
                    {upcomingEvents.map(renderEventCard)}
                  </div>
                </div>
              )}

              {/* Past events — sticky header with jump-to-Upcoming */}
              {pastEvents.length > 0 && (
                <div ref={pastRef} className="bg-gray-100 -mx-4 px-4 py-3 border-y border-gray-200">
                  <div
                    className="flex items-center gap-2 mb-2 sticky z-20 bg-gray-100 -mx-4 px-4 py-2 border-b border-gray-200"
                    style={{ top: "var(--header-height, 0px)" }}
                  >
                    <button
                      type="button"
                      onClick={() => pastRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
                      title="Jump to start of Past"
                      className="text-xs font-bold text-muted hover:text-foreground uppercase tracking-wider"
                    >Past</button>
                    {upcomingEvents.length > 0 && (
                      <button
                        type="button"
                        onClick={() => upcomingRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
                        className="ml-auto text-xs font-bold text-blue-600 hover:text-blue-700 uppercase tracking-wider"
                      >↑ Upcoming</button>
                    )}
                  </div>
                  <div className="space-y-2">
                    {pastEvents.map(renderEventCard)}
                  </div>
                </div>
              )}
            </div>
          );
        })()
      ))}
    </div>
  );
}
