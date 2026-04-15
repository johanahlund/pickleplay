"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useConfirm } from "@/components/ConfirmDialog";

/**
 * Streamlined event creation wizard.
 *
 * Three-step flow, each on the same page (no route changes):
 *   1. Pick a club (skipped if the user is only in one club)
 *   2. Pick a location (skipped if the selected club has 0 or 1 location)
 *   3. When + courts + DUPR range → Save
 *
 * After save, we navigate to the event overview where the organizer can
 * edit format, pairing, players, etc. This page is intentionally minimal.
 */

interface Location {
  id: string;
  name: string;
  numCourts: number;
}

interface ClubOption {
  id: string;
  name: string;
  emoji: string;
  locations: Location[];
  myRole: string;
}

function todayDate() {
  return new Date().toISOString().split("T")[0];
}

export default function NewEventPage() {
  const router = useRouter();
  const { alert } = useConfirm();

  // Seed from sessionStorage so repeated visits to the wizard render
  // the club list on first paint. Fresh data is still fetched below and
  // replaces the cache on success.
  const [clubs, setClubs] = useState<ClubOption[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const cached = window.sessionStorage.getItem("new-event-clubs-cache");
      return cached ? JSON.parse(cached) : [];
    } catch {
      return [];
    }
  });
  const [loadingClubs, setLoadingClubs] = useState(() => {
    if (typeof window === "undefined") return true;
    return !window.sessionStorage.getItem("new-event-clubs-cache");
  });
  const [clubId, setClubId] = useState<string>(() => {
    // If we have exactly one cached club, pre-select it on first render.
    if (typeof window === "undefined") return "";
    try {
      const cached = window.sessionStorage.getItem("new-event-clubs-cache");
      if (!cached) return "";
      const list = JSON.parse(cached) as ClubOption[];
      return list.length === 1 ? list[0].id : "";
    } catch {
      return "";
    }
  });
  const [locationId, setLocationId] = useState<string>(() => {
    // Same for a pre-selected single location.
    if (typeof window === "undefined") return "";
    try {
      const cached = window.sessionStorage.getItem("new-event-clubs-cache");
      if (!cached) return "";
      const list = JSON.parse(cached) as ClubOption[];
      if (list.length === 1 && list[0].locations.length === 1) {
        return list[0].locations[0].id;
      }
      return "";
    } catch {
      return "";
    }
  });

  // Step 3 form state
  const [name, setName] = useState("");
  const [date, setDate] = useState(todayDate());
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("11:00");
  const [numCourts, setNumCourts] = useState(2);
  const [duprMin, setDuprMin] = useState<number | null>(null);
  const [duprMax, setDuprMax] = useState<number | null>(null);
  const [duprPhase, setDuprPhase] = useState<"closed" | "min" | "max">("closed");
  const [competition, setCompetition] = useState(false);
  const [saving, setSaving] = useState(false);

  // Load clubs where the current user can create events (owner/admin/member).
  useEffect(() => {
    fetch("/api/clubs")
      .then((r) => (r.ok ? r.json() : []))
      .then(async (myClubs: { id: string; name: string; emoji: string; myRole: string }[]) => {
        // Fetch each club's detail to get locations. /api/clubs only returns
        // the basic club record without locations.
        const withLocations = await Promise.all(
          myClubs.map(async (c) => {
            const r = await fetch(`/api/clubs/${c.id}`);
            if (!r.ok) return { ...c, locations: [] };
            const detail = await r.json();
            return { ...c, locations: detail.locations || [] };
          }),
        );
        setClubs(withLocations);
        // If the user is in exactly one club, auto-select it.
        if (withLocations.length === 1) {
          setClubId(withLocations[0].id);
          // And if that one club has one location, auto-select it too.
          if (withLocations[0].locations.length === 1) {
            setLocationId(withLocations[0].locations[0].id);
            const c = withLocations[0].locations[0].numCourts;
            if (typeof c === "number") setNumCourts(c);
          }
        }
        setLoadingClubs(false);
        // Refresh the cache for the next visit.
        try {
          window.sessionStorage.setItem("new-event-clubs-cache", JSON.stringify(withLocations));
        } catch {
          // ignore
        }
      });
  }, []);

  const currentClub = clubs.find((c) => c.id === clubId);
  const currentLocation = currentClub?.locations.find((l) => l.id === locationId);

  // When location changes, default numCourts to the location's configured
  // maximum (or 2 if not configured). Also clamp if the current selection
  // exceeds the new location's max.
  useEffect(() => {
    if (currentLocation) {
      const max = typeof currentLocation.numCourts === "number" ? currentLocation.numCourts : 2;
      setNumCourts(max);
    }
  }, [currentLocation]);

  // Figure out which step to show
  const needsClub = clubs.length > 1 && !clubId;
  const needsLocation =
    !needsClub && currentClub && currentClub.locations.length > 1 && !locationId;

  const handleSave = async () => {
    if (!name.trim()) {
      await alert("Event name is required", "Missing name");
      return;
    }
    setSaving(true);
    const startISO = `${date}T${startTime}:00`;
    const endISO = `${date}T${endTime}:00`;
    const r = await fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        clubId: clubId || undefined,
        locationId: locationId || undefined,
        numCourts,
        date: startISO,
        endDate: endISO,
        skillMin: duprMin ?? undefined,
        skillMax: duprMax ?? undefined,
        competitionMode: competition ? "groups_elimination" : undefined,
      }),
    });
    if (r.ok) {
      const event = await r.json();
      router.push(`/events/${event.id}`);
    } else {
      setSaving(false);
      const d = await r.json().catch(() => ({}));
      await alert(d.error || "Failed to create event", "Error");
    }
  };

  // Loading state: render header immediately + skeleton for the list below.
  if (loadingClubs && clubs.length === 0) {
    return (
      <div className="space-y-4">
        <Link href="/events" className="text-sm text-action">&larr; Events</Link>
        <h2 className="text-xl font-bold">Create Event</h2>
        <div className="bg-card rounded-xl border border-border p-4 animate-pulse space-y-3">
          <div className="h-4 bg-gray-200 rounded w-1/3" />
          <div className="h-3 bg-gray-200 rounded w-1/2" />
          <div className="h-3 bg-gray-200 rounded w-2/5" />
        </div>
      </div>
    );
  }

  // No clubs at all
  if (clubs.length === 0) {
    return (
      <div className="space-y-4">
        <Link href="/events" className="text-sm text-action">&larr; Events</Link>
        <h2 className="text-xl font-bold">Create Event</h2>
        <div className="bg-card rounded-xl border border-border p-4">
          <p className="text-sm">You need to be a member of at least one club to create an event.</p>
          <p className="text-xs text-muted mt-2">
            Go to the Clubs page to create or join one.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Link href="/events" className="text-sm text-action">&larr; Events</Link>
      <h2 className="text-xl font-bold">Create Event</h2>

      {/* Step 1: Club selection */}
      {needsClub && (
        <div className="space-y-2">
          <h3 className="text-base font-bold text-foreground">Choose a club</h3>
          <div className="space-y-2">
            {clubs.map((c) => (
              <button
                key={c.id}
                onClick={() => {
                  setClubId(c.id);
                  // If the chosen club has exactly one location, auto-select it.
                  if (c.locations.length === 1) {
                    setLocationId(c.locations[0].id);
                    setNumCourts(c.locations[0].numCourts);
                  }
                }}
                className="w-full bg-card rounded-xl border border-border p-4 text-left hover:border-action transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{c.emoji}</span>
                  <div className="flex-1">
                    <div className="text-base font-bold">{c.name}</div>
                    <div className="text-xs text-muted">
                      {c.locations.length === 0
                        ? "No locations yet"
                        : `${c.locations.length} location${c.locations.length > 1 ? "s" : ""}`}
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Step 2: Location selection */}
      {!needsClub && needsLocation && currentClub && (
        <div className="space-y-3">
          <h2 className="text-2xl font-bold text-foreground">{currentClub.name}</h2>
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-foreground">Choose a location</h3>
            {clubs.length > 1 && (
              <button
                onClick={() => {
                  setClubId("");
                  setLocationId("");
                }}
                className="text-xs text-muted hover:text-foreground"
              >
                ← Back
              </button>
            )}
          </div>
          <div className="space-y-2">
            {currentClub.locations.map((l) => {
              const courts = typeof l.numCourts === "number" ? l.numCourts : 2;
              return (
              <button
                key={l.id}
                onClick={() => {
                  setLocationId(l.id);
                  setNumCourts(courts);
                }}
                className="w-full bg-card rounded-xl border border-border p-4 text-left hover:border-action transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-base font-bold">{l.name}</div>
                    <div className="text-xs text-muted">{courts} court{courts === 1 ? "" : "s"}</div>
                  </div>
                </div>
              </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Step 3: When + courts + DUPR range */}
      {!needsClub && !needsLocation && (
        <div className="space-y-4">
          {/* Breadcrumbs */}
          <div className="bg-gray-50 rounded-xl p-3 text-xs">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-muted">Club:</span>
              {currentClub ? (
                <>
                  <span className="font-medium">{currentClub.emoji} {currentClub.name}</span>
                  {clubs.length > 1 && (
                    <button onClick={() => { setClubId(""); setLocationId(""); }} className="text-action">change</button>
                  )}
                </>
              ) : (
                <span className="text-muted">—</span>
              )}
              {currentLocation && (
                <>
                  <span className="text-muted mx-1">·</span>
                  <span className="text-muted">Location:</span>
                  <span className="font-medium">{currentLocation.name}</span>
                  {currentClub && currentClub.locations.length > 1 && (
                    <button onClick={() => setLocationId("")} className="text-action">change</button>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="bg-card rounded-xl border border-border p-4 space-y-3">
            <div>
              <label className="block text-sm font-medium text-muted mb-1">Event name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Wednesday Social"
                autoFocus
                className="w-full border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-muted mb-1">Date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-sm font-medium text-muted mb-1">From</label>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
              <div className="flex-1">
                <label className="block text-sm font-medium text-muted mb-1">To</label>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-full border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-muted mb-1">
                Courts
                {currentLocation && (
                  <span className="text-xs text-muted font-normal ml-1">
                    (max {currentLocation.numCourts ?? 2} at {currentLocation.name})
                  </span>
                )}
              </label>
              {/* One button per court, wrapping to multiple rows if needed.
                 Default max = 2 when the location has no numCourts configured. */}
              <div className="flex flex-wrap gap-2">
                {Array.from(
                  { length: (typeof currentLocation?.numCourts === "number" ? currentLocation.numCourts : 2) },
                  (_, i) => i + 1,
                ).map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setNumCourts(n)}
                    className={`min-w-[52px] h-12 px-3 rounded-xl text-lg font-bold transition-all ${
                      numCourts === n
                        ? "bg-action text-white"
                        : "bg-gray-100 text-foreground hover:bg-gray-200"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {/* Competition toggle */}
            <div>
              <label className="block text-sm font-medium text-muted mb-1">Competition</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setCompetition(false)}
                  className={`flex-1 py-2.5 rounded-lg font-medium text-sm transition-all ${
                    !competition ? "bg-action text-white" : "bg-gray-100 text-foreground"
                  }`}
                >
                  Social
                </button>
                <button
                  type="button"
                  onClick={() => setCompetition(true)}
                  className={`flex-1 py-2.5 rounded-lg font-medium text-sm transition-all ${
                    competition ? "bg-action text-white" : "bg-gray-100 text-foreground"
                  }`}
                >
                  🏆 Competition
                </button>
              </div>
              <p className="text-[10px] text-muted mt-1">
                {competition
                  ? "Groups → elimination bracket. Configure on the event page after creating."
                  : "Regular match play with ranking."}
              </p>
            </div>

            {/* DUPR range */}
            <div>
              <label className="block text-sm font-medium text-muted mb-1">DUPR range (optional)</label>
              <button
                type="button"
                onClick={() => {
                  setDuprPhase("min");
                }}
                className={`w-full h-12 rounded-xl text-base font-semibold border transition-all ${
                  duprMin != null || duprMax != null
                    ? "border-action bg-action/5 text-action"
                    : "border-border text-muted"
                }`}
              >
                {duprMin == null && duprMax == null
                  ? "Tap to set range"
                  : `${duprMin ?? "?"} – ${duprMax ?? "?"}`}
              </button>
              {(duprMin != null || duprMax != null) && (
                <button
                  type="button"
                  onClick={() => { setDuprMin(null); setDuprMax(null); }}
                  className="text-[11px] text-muted mt-1 hover:text-danger"
                >
                  Clear range
                </button>
              )}
              <p className="text-[10px] text-muted mt-1">
                Players outside this range won&apos;t be allowed to join.
              </p>
            </div>

            <button
              onClick={handleSave}
              disabled={saving || !name.trim()}
              className="w-full bg-action-dark text-white py-3 rounded-xl font-semibold disabled:opacity-50"
            >
              {saving ? "Creating..." : "Save"}
            </button>
            <p className="text-[10px] text-muted text-center">
              You can set format, pairing, players, and the rest from the event page after creating.
            </p>
          </div>
        </div>
      )}

      {/* DUPR range picker modal — two-phase: pick min, then max */}
      {duprPhase !== "closed" && (() => {
        const values = [2.0, 2.25, 2.5, 2.75, 3.0, 3.25, 3.5, 3.75, 4.0, 4.25, 4.5, 4.75, 5.0];
        const phase = duprPhase;
        const selectableMax = phase === "max" && duprMin != null ? values.filter((v) => v >= duprMin) : values;
        const title = phase === "min" ? "Pick minimum DUPR" : "Pick maximum DUPR";
        const currentValue = phase === "min" ? duprMin : duprMax;
        return (
          <div
            className="fixed inset-0 z-[80] bg-black/60 flex items-center justify-center p-4"
            onClick={() => setDuprPhase("closed")}
          >
            <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
              <div className="text-center mb-4">
                <span className="font-bold text-lg">{title}</span>
                {phase === "max" && duprMin != null && (
                  <p className="text-xs text-muted mt-1">Min: {duprMin}</p>
                )}
              </div>
              <div className="grid grid-cols-4 gap-2.5">
                {(phase === "min" ? values : selectableMax).map((v) => (
                  <button
                    key={v}
                    onClick={() => {
                      if (phase === "min") {
                        setDuprMin(v);
                        // If max is now less than new min, clear it
                        if (duprMax != null && duprMax < v) setDuprMax(null);
                        setDuprPhase("max");
                      } else {
                        setDuprMax(v);
                        setDuprPhase("closed");
                      }
                    }}
                    className={`h-14 rounded-xl text-base font-bold transition-all ${
                      currentValue === v ? "bg-action text-white ring-2 ring-action/50 scale-110" : "bg-gray-100 text-foreground hover:bg-gray-200"
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
              <div className="flex justify-between mt-4 text-xs">
                {phase === "max" && (
                  <button onClick={() => setDuprPhase("min")} className="text-action font-medium">← Change min</button>
                )}
                <button onClick={() => setDuprPhase("closed")} className="text-muted ml-auto">Cancel</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
