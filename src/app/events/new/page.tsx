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

  const [clubs, setClubs] = useState<ClubOption[]>([]);
  const [loadingClubs, setLoadingClubs] = useState(true);
  const [clubId, setClubId] = useState<string>("");
  const [locationId, setLocationId] = useState<string>("");

  // Step 3 form state
  const [name, setName] = useState("");
  const [date, setDate] = useState(todayDate());
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("11:00");
  const [numCourts, setNumCourts] = useState(2);
  const [duprMin, setDuprMin] = useState("");
  const [duprMax, setDuprMax] = useState("");
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
            setNumCourts(withLocations[0].locations[0].numCourts);
          }
        }
        setLoadingClubs(false);
      });
  }, []);

  const currentClub = clubs.find((c) => c.id === clubId);
  const currentLocation = currentClub?.locations.find((l) => l.id === locationId);

  // When location changes, default the numCourts to the location's numCourts.
  useEffect(() => {
    if (currentLocation) {
      setNumCourts(currentLocation.numCourts);
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
        skillMin: duprMin ? parseFloat(duprMin) : undefined,
        skillMax: duprMax ? parseFloat(duprMax) : undefined,
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

  if (loadingClubs) return <div className="p-4 text-sm text-muted">Loading...</div>;

  // ── Step 1: No clubs at all
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
        <div className="space-y-2">
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
          <div className="text-xs text-muted">{currentClub.emoji} {currentClub.name}</div>
          <div className="space-y-2">
            {currentClub.locations.map((l) => (
              <button
                key={l.id}
                onClick={() => {
                  setLocationId(l.id);
                  setNumCourts(l.numCourts);
                }}
                className="w-full bg-card rounded-xl border border-border p-4 text-left hover:border-action transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-base font-bold">{l.name}</div>
                    <div className="text-xs text-muted">{l.numCourts} court{l.numCourts === 1 ? "" : "s"}</div>
                  </div>
                </div>
              </button>
            ))}
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
                    (max {currentLocation.numCourts} at {currentLocation.name})
                  </span>
                )}
              </label>
              <input
                type="number"
                value={numCourts}
                min={1}
                max={currentLocation?.numCourts || 20}
                onChange={(e) => {
                  const v = parseInt(e.target.value) || 1;
                  const cap = currentLocation?.numCourts || 20;
                  setNumCourts(Math.min(Math.max(1, v), cap));
                }}
                className="w-full border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-muted mb-1">DUPR range (optional)</label>
              <div className="flex gap-3 items-center">
                <input
                  type="number"
                  step="0.1"
                  min="2"
                  max="6"
                  value={duprMin}
                  onChange={(e) => setDuprMin(e.target.value)}
                  placeholder="Min"
                  className="flex-1 border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                <span className="text-muted text-sm">to</span>
                <input
                  type="number"
                  step="0.1"
                  min="2"
                  max="6"
                  value={duprMax}
                  onChange={(e) => setDuprMax(e.target.value)}
                  placeholder="Max"
                  className="flex-1 border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
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
    </div>
  );
}
