"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { ClearInput } from "@/components/ClearInput";
import { generatePairs, PairPlayer } from "@/lib/pairgen";

interface Player {
  id: string;
  name: string;
  emoji: string;
  rating: number;
  gender?: string;
}

function getDefaultDate() {
  const now = new Date();
  return now.toISOString().split("T")[0];
}

function getDefaultTime() {
  return "09:00";
}

function getDefaultEndTime() {
  return "11:00";
}

// TOTAL_STEPS is dynamic based on competitionEnabled

export default function NewEventPageWrapper() {
  return (
    <Suspense fallback={<div className="text-center py-12 text-muted">Loading...</div>}>
      <NewEventPage />
    </Suspense>
  );
}

function NewEventPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const [step, setStep] = useState(1);
  const [players, setPlayers] = useState<Player[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [name, setName] = useState("");
  const [numCourts, setNumCourts] = useState(2);
  const [format, setFormat] = useState<"doubles" | "singles">("doubles");
  const [date, setDate] = useState(getDefaultDate);
  const [time, setTime] = useState(getDefaultTime);
  const [endTime, setEndTime] = useState(getDefaultEndTime);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState(false);
  const [createdEventId, setCreatedEventId] = useState<string | null>(null);
  const [numSets, setNumSets] = useState(1);
  const [scoringType, setScoringType] = useState("normal_11");
  const [pairingMode, setPairingMode] = useState("random");
  const [playMode, setPlayMode] = useState<"round_based" | "continuous">("round_based");
  const [prioSpeed, setPrioSpeed] = useState(true);
  const [prioFairness, setPrioFairness] = useState(true);
  const [prioSkill, setPrioSkill] = useState(false);
  const [rankingMode, setRankingMode] = useState("ranked");
  const [genderMode, setGenderMode] = useState<"mix" | "random">("random");
  const [memoryPairs, setMemoryPairs] = useState<{ player1Id: string; player2Id: string }[]>([]);
  const [pairBuildMode, setPairBuildMode] = useState<"rating" | "random">("rating");
  const [pairPreferMixed, setPairPreferMixed] = useState(false);
  const [manualPairFirst, setManualPairFirst] = useState<string | null>(null);
  const [fixedPairs, setFixedPairs] = useState(false);
  const [competitionEnabled, setCompetitionEnabled] = useState(false);
  const [minPlayers, setMinPlayers] = useState<string>("4");
  const [maxPlayers, setMaxPlayers] = useState<string>("10");
  const [helperIds, setHelperIds] = useState<Set<string>>(new Set());
  const [helperSearch, setHelperSearch] = useState("");
  const [helperGenderFilter, setHelperGenderFilter] = useState<string | null>(null);
  const [showAllHelpers, setShowAllHelpers] = useState(false);
  const [defaultsApplied, setDefaultsApplied] = useState(false);
  const [allWaGroups, setAllWaGroups] = useState<{ id: string; name: string }[]>([]);
  const [selectedWaGroupIds, setSelectedWaGroupIds] = useState<Set<string>>(new Set());
  const [newGroupName, setNewGroupName] = useState("");
  const [recentPlayerIds, setRecentPlayerIds] = useState<Set<string>>(new Set());
  const [playerSearch, setPlayerSearch] = useState("");
  const [playerGenderFilter, setPlayerGenderFilter] = useState<string | null>(null);
  const [showAllPlayers, setShowAllPlayers] = useState(false);
  const [showClubPlayers, setShowClubPlayers] = useState(false);
  const [returnToReview, setReturnToReview] = useState(false);
  const [clubs, setClubs] = useState<{ id: string; name: string; emoji: string; memberIds: string[] }[]>([]);
  const [selectedClubId, setSelectedClubId] = useState<string | null>(null);
  // Same for helper tier
  const [showClubHelpers, setShowClubHelpers] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/players").then((r) => r.ok ? r.json() : []),
      fetch("/api/events").then((r) => r.ok ? r.json() : []),
      fetch("/api/whatsapp-groups").then((r) => r.ok ? r.json() : []),
      fetch("/api/clubs").then((r) => r.ok ? r.json() : []),
    ]).then(([playersData, eventsData, waGroupsData, clubsData]) => {
      if (Array.isArray(playersData)) setPlayers(playersData);
      if (userId && Array.isArray(eventsData)) {
        const myEvents = eventsData
          .filter((e: { createdById?: string }) => e.createdById === userId)
          .slice(0, 2);
        const ids = new Set<string>();
        for (const ev of myEvents) {
          for (const ep of ev.players || []) {
            ids.add(ep.playerId || ep.player?.id);
          }
        }
        setRecentPlayerIds(ids);
      }
      if (Array.isArray(waGroupsData)) setAllWaGroups(waGroupsData);
      if (Array.isArray(clubsData)) {
        // Fetch member IDs for each club
        const clubList = clubsData.map((c: { id: string; name: string; emoji: string }) => ({
          id: c.id, name: c.name, emoji: c.emoji, memberIds: [] as string[],
        }));
        setClubs(clubList);
        // Auto-select from URL param, or first club if only one
        const urlClubId = searchParams.get("clubId");
        if (urlClubId && clubList.some((c: { id: string }) => c.id === urlClubId)) {
          setSelectedClubId(urlClubId);
        } else if (clubList.length === 1) {
          setSelectedClubId(clubList[0].id);
        }
        // Fetch members for each club
        Promise.all(
          clubList.map((c: { id: string }) =>
            fetch(`/api/clubs/${c.id}`).then((r) => r.ok ? r.json() : null)
          )
        ).then((details) => {
          setClubs(clubList.map((c: { id: string; name: string; emoji: string }, i: number) => ({
            ...c,
            memberIds: details[i]?.members?.map((m: { playerId: string }) => m.playerId) || [],
          })));
        });
      }
      setLoading(false);
    }).catch(() => {
      setLoading(false);
    });
  }, [userId]);

  // Auto-select owner + helper as players once data is ready
  useEffect(() => {
    if (defaultsApplied || players.length === 0) return;
    const defaults = new Set<string>();
    if (userId && players.some((p) => p.id === userId)) defaults.add(userId);
    for (const hid of helperIds) {
      if (players.some((p) => p.id === hid)) defaults.add(hid);
    }
    if (defaults.size > 0) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        defaults.forEach((id) => next.add(id));
        return next;
      });
    }
    setDefaultsApplied(true);
  }, [players, userId, helperIds, defaultsApplied]);

  // When helpers change, ensure they're added to selected players
  useEffect(() => {
    setSelectedIds((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const hid of helperIds) {
        if (players.some((p) => p.id === hid) && !next.has(hid)) {
          next.add(hid);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [helperIds, players]);

  const togglePlayer = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedClub = clubs.find((c) => c.id === selectedClubId);
  const clubMemberIds = selectedClub?.memberIds || [];

  const getFilteredPlayers = () => {
    return players
      .filter((p) => {
        // Tier: recent → club → all
        if (!showAllPlayers && !showClubPlayers) {
          // Show recent only (if we have recent data)
          if (recentPlayerIds.size > 0 && !recentPlayerIds.has(p.id)) return false;
        } else if (showClubPlayers && !showAllPlayers) {
          // Show club members
          if (clubMemberIds.length > 0 && !clubMemberIds.includes(p.id)) return false;
        }
        // showAllPlayers = no pool filter
        if (playerSearch && !p.name.toLowerCase().includes(playerSearch.toLowerCase())) return false;
        if (playerGenderFilter && p.gender !== playerGenderFilter) return false;
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  };

  const getFilteredHelperCandidates = () => {
    return players
      .filter((p) => p.id !== userId)
      .filter((p) => {
        if (!showAllHelpers && !showClubHelpers) {
          if (recentPlayerIds.size > 0 && !recentPlayerIds.has(p.id)) return false;
        } else if (showClubHelpers && !showAllHelpers) {
          if (clubMemberIds.length > 0 && !clubMemberIds.includes(p.id)) return false;
        }
        if (helperSearch && !p.name.toLowerCase().includes(helperSearch.toLowerCase())) return false;
        if (helperGenderFilter && p.gender !== helperGenderFilter) return false;
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  };

  const selectAll = () => {
    const visible = getFilteredPlayers();
    const allVisible = visible.every((p) => selectedIds.has(p.id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisible) {
        visible.forEach((p) => next.delete(p.id));
      } else {
        visible.forEach((p) => next.add(p.id));
      }
      return next;
    });
  };

  const createEvent = async () => {
    if (!name.trim()) return;
    setCreating(true);
    const eventDate = new Date(`${date}T${time}`);
    const eventEndDate = new Date(`${date}T${endTime}`);
    if (eventEndDate <= eventDate) eventEndDate.setDate(eventEndDate.getDate() + 1);
    const r = await fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        playerIds: Array.from(selectedIds),
        ...(selectedClubId ? { clubId: selectedClubId } : {}),
        numCourts,
        format,
        date: eventDate.toISOString(),
        endDate: eventEndDate.toISOString(),
        numSets,
        scoringType,
        pairingMode,
        playMode,
        prioSpeed,
        prioFairness,
        prioSkill,
        rankingMode,
        ...(minPlayers ? { minPlayers: parseInt(minPlayers) } : {}),
        ...(maxPlayers ? { maxPlayers: parseInt(maxPlayers) } : {}),
      }),
    });
    const event = await r.json();

    for (const hid of helperIds) {
      await fetch(`/api/events/${event.id}/helpers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: hid }),
      });
    }

    for (const gid of selectedWaGroupIds) {
      await fetch(`/api/events/${event.id}/whatsapp-groups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ whatsappGroupId: gid }),
      });
    }

    // Save in-memory pairs
    for (const pair of memoryPairs) {
      await fetch(`/api/events/${event.id}/pairs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ player1Id: pair.player1Id, player2Id: pair.player2Id }),
      });
    }

    // Enable competition mode if selected
    if (competitionEnabled) {
      await fetch(`/api/events/${event.id}/competition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "enable" }),
      });
    }

    setCreatedEventId(event.id);
    setCreated(true);
    setTimeout(() => router.push(`/events/${event.id}`), 1500);
  };

  const canAdvance = () => {
    switch (step) {
      case 1: return name.trim().length > 0;
      default: return true;
    }
  };

  const baseSteps = fixedPairs
    ? ["When", "Helper", "Courts", "Format", "Players", "Pairs"]
    : ["When", "Helper", "Courts", "Format", "Players"];
  const stepTitles = competitionEnabled
    ? [...baseSteps, "Competition", "Review"]
    : [...baseSteps, "Review"];
  const TOTAL_STEPS = stepTitles.length;
  const stepNum = (name: string) => stepTitles.indexOf(name) + 1;

  if (created) {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-4">
        <div className="text-6xl animate-bounce">🎉</div>
        <h2 className="text-2xl font-bold text-foreground">Event Created!</h2>
        <p className="text-muted text-sm">{name}</p>
        <p className="text-xs text-muted">
          {selectedIds.size} player{selectedIds.size !== 1 ? "s" : ""}
          {memoryPairs.length > 0 ? ` · ${memoryPairs.length} pairs` : ""}
          {competitionEnabled ? " · Competition" : ""}
        </p>
        <p className="text-xs text-muted animate-pulse">Opening event...</p>
        <button
          onClick={() => createdEventId && router.push(`/events/${createdEventId}`)}
          className="text-sm text-action font-medium mt-2"
        >
          Go to event now
        </button>
      </div>
    );
  }

  if (loading) {
    return <div className="text-center py-12 text-muted">Loading...</div>;
  }

  const helperPlayers = players.filter((p) => helperIds.has(p.id));

  const scoringLabel = (v: string) =>
    ({ normal_11: "To 11", normal_15: "To 15", rally_21: "Rally 21", timed: "Timed" }[v] || v);

  const pairingLabel = (v: string) =>
    ({
      random: "🎲 Random",
      skill_balanced: "📊 Skill Balanced",
      mixed_gender: "👫 Mixed Gender",
      skill_mixed_gender: "📊👫 Skill + Mixed",
      king_of_court: "👑 King of Court",
      swiss: "🏆 Swiss",
      manual: "✏️ Manual",
    }[v] || v);

  return (
    <div className="space-y-3">
      {/* Sticky header: title + progress with labels + nav */}
      <div className="sticky z-40 bg-background pb-2 -mx-4 px-4 pt-2 shadow-sm" style={{ top: "var(--header-height, 0px)" }}>
        <p className="text-xs text-action font-medium italic text-center mb-1.5">New Event</p>
        <div className="flex items-center gap-2">
          {step > 1 && !returnToReview && (
            <button type="button" onClick={() => setStep(step - 1)}
              className="px-2.5 py-1 rounded-lg text-xs font-medium border border-border text-foreground active:bg-gray-100 transition-colors shrink-0">
              Back
            </button>
          )}
          <div className="flex-1">
            <div className="flex gap-1">
              {stepTitles.map((title, i) => (
                <div key={i} className="flex-1 text-center">
                  <div className={`h-1 rounded-full transition-all duration-300 ${
                    returnToReview ? (i === step - 1 ? "bg-action" : "bg-gray-200") : (i < step ? "bg-action" : "bg-gray-200")
                  }`} />
                  <span className={`text-[9px] leading-tight mt-0.5 block ${
                    i === step - 1 ? "text-action font-semibold" : i < step && !returnToReview ? "text-muted" : "text-gray-300"
                  }`}>{title}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between mt-1.5">
          <span className="w-12" />
          <p className="text-sm font-bold text-foreground">
            {stepTitles[step - 1] === "Format" ? "Default Format" : stepTitles[step - 1]}
          </p>
          {returnToReview && step !== TOTAL_STEPS ? (
            <button type="button" onClick={() => { setReturnToReview(false); setStep(TOTAL_STEPS); }}
              className="bg-action text-white px-3 py-1 rounded-lg text-xs font-medium shadow-sm active:bg-action-dark transition-colors shrink-0">
              Review
            </button>
          ) : step < TOTAL_STEPS ? (
            <button type="button" onClick={() => canAdvance() && setStep(step + 1)} disabled={!canAdvance()}
              className="bg-action text-white px-3 py-1 rounded-lg text-xs font-medium shadow-sm active:bg-action-dark transition-colors disabled:opacity-50 shrink-0">
              Next
            </button>
          ) : (
            <button type="button" onClick={createEvent} disabled={!name.trim() || creating}
              className="bg-action-dark text-white px-3 py-1 rounded-lg text-xs font-medium shadow-sm transition-colors disabled:opacity-50 shrink-0">
              {creating ? "..." : "Create"}
            </button>
          )}
        </div>
      </div>

      {/* Step content */}
      <div className="bg-card rounded-xl border border-border p-4 space-y-3">

        {/* Step 1: Name & When */}
        {step === 1 && (
          <>
            <div>
              <label className="block text-sm font-medium text-muted mb-1">Event Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Saturday Session"
                className="w-full border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50"
                autoFocus
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
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
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

            {selectedClub && (
              <p className="text-xs text-muted">Club: {selectedClub.emoji} {selectedClub.name}</p>
            )}
          </>
        )}

        {/* Step 2: Helper */}
        {step === 2 && (() => {
          const helperCandidates = getFilteredHelperCandidates();
          const helperTier = showAllHelpers ? "all" : showClubHelpers ? "club" : "recent";
          const toggleHelper = (pid: string) => {
            setHelperIds((prev) => {
              const next = new Set(prev);
              if (next.has(pid)) next.delete(pid); else next.add(pid);
              return next;
            });
          };
          return (
            <>
              {/* Selected helpers */}
              {helperPlayers.length > 0 && (
                <div className="space-y-1 mb-1">
                  {helperPlayers.map((hp) => (
                    <div key={hp.id} className="flex items-center gap-2 p-2 bg-selected/10 border border-selected/30 rounded-lg">
                      <PlayerAvatar name={hp.name} size="sm" />
                      <span className="font-medium flex-1 text-sm">{hp.name}</span>
                      <button type="button" onClick={() => toggleHelper(hp.id)}
                        className="text-xs text-danger hover:text-foreground px-2 py-1 rounded bg-gray-100">Remove</button>
                    </div>
                  ))}
                </div>
              )}

              {/* Filters */}
              <div className="flex gap-2">
                <ClearInput value={helperSearch} onChange={setHelperSearch} placeholder="Search by name..." className="text-sm" />
                {(["M", "F"] as const).map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setHelperGenderFilter(helperGenderFilter === g ? null : g)}
                    className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                      helperGenderFilter === g
                        ? "bg-selected text-white"
                        : "bg-gray-100 text-foreground hover:bg-gray-200"
                    }`}
                  >
                    {g === "M" ? "♂" : "♀"}
                  </button>
                ))}
              </div>

              {/* Recent / All toggle */}
              {recentPlayerIds.size > 0 && (
                <div className="flex gap-1">
                  {(["recent", "all"] as const).map((t) => (
                    <button key={t} type="button"
                      onClick={() => { setShowAllHelpers(t === "all"); setShowClubHelpers(false); }}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-all ${
                        helperTier === t ? "bg-selected text-white" : "bg-gray-100 text-foreground"
                      }`}>
                      {t === "recent" ? "Recent" : "All"}
                    </button>
                  ))}
                </div>
              )}

              <div className="space-y-1 max-h-64 overflow-y-auto">
                {helperCandidates.length === 0 ? (
                  <p className="text-sm text-muted py-4 text-center">No players match your filters</p>
                ) : (
                  helperCandidates.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => toggleHelper(p.id)}
                      className={`w-full flex items-center gap-3 p-2.5 rounded-lg transition-all ${
                        helperIds.has(p.id)
                          ? "bg-selected/10 border border-selected/30"
                          : "hover:bg-gray-50 border border-transparent"
                      }`}
                    >
                      <span
                        className={`w-5 h-5 rounded-md border-2 flex items-center justify-center text-xs font-bold transition-colors ${
                          helperIds.has(p.id)
                            ? "bg-selected border-selected text-white"
                            : "border-gray-300"
                        }`}
                      >
                        {helperIds.has(p.id) ? "✓" : ""}
                      </span>
                      <PlayerAvatar name={p.name} size="sm" />
                      <span className="font-medium flex-1 text-left">{p.name}</span>
                      {p.gender && (
                        <span className={`text-xs ${p.gender === "M" ? "text-blue-500" : "text-pink-500"}`}>
                          {p.gender === "M" ? "♂" : "♀"}
                        </span>
                      )}
                    </button>
                  ))
                )}
              </div>
            </>
          );
        })()}

        {/* Step 3: Courts & Players */}
        {step === 3 && (
          <>
            <div>
              <label className="block text-sm font-medium text-muted mb-1">Number of Courts</label>
              <div className="flex gap-2">
                {[1, 2, 3, 4].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => { setNumCourts(n); setMaxPlayers(String(n * 4 + 2)); }}
                    className={`flex-1 py-3 rounded-lg font-medium transition-all ${
                      numCourts === n
                        ? "bg-selected text-white"
                        : "bg-gray-100 text-foreground hover:bg-gray-200"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-sm font-medium text-muted mb-1">Min Players</label>
                <input
                  type="number"
                  value={minPlayers}
                  onChange={(e) => setMinPlayers(e.target.value)}
                  placeholder="No min"
                  min="1"
                  className="w-full border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
              <div className="flex-1">
                <label className="block text-sm font-medium text-muted mb-1">Max Players</label>
                <input
                  type="number"
                  value={maxPlayers}
                  onChange={(e) => setMaxPlayers(e.target.value)}
                  placeholder="No max"
                  min="1"
                  className="w-full border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
            </div>
            <p className="text-xs text-muted">Players beyond max will be waitlisted</p>
          </>
        )}

        {/* Step 4: Main Format */}
        {step === 4 && (
          <>
            <div>
              <label className="block text-sm font-medium text-muted mb-1">Format</label>
              <div className="flex gap-2">
                {(["doubles", "singles"] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFormat(f)}
                    className={`flex-1 py-2.5 rounded-lg font-medium transition-all text-sm ${
                      format === f
                        ? "bg-selected text-white"
                        : "bg-gray-100 text-foreground hover:bg-gray-200"
                    }`}
                  >
                    {f === "doubles" ? "🤝 Doubles" : "👤 Singles"}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-muted mb-1">Gender</label>
              <div className="flex gap-2">
                {([
                  { value: "mix", label: "👫 Mix" },
                  { value: "random", label: "🎲 Random" },
                ] as const).map((g) => (
                  <button
                    key={g.value}
                    type="button"
                    onClick={() => setGenderMode(g.value)}
                    className={`flex-1 py-2.5 rounded-lg font-medium transition-all text-sm ${
                      genderMode === g.value
                        ? "bg-selected text-white"
                        : "bg-gray-100 text-foreground hover:bg-gray-200"
                    }`}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
            </div>
            {format === "doubles" && (
              <div>
                <label className="block text-sm font-medium text-muted mb-1">Pairs</label>
                <div className="flex gap-2">
                  {([
                    { value: false, label: "New teams each round" },
                    { value: true, label: "Fixed pairs" },
                  ] as const).map((p) => (
                    <button
                      key={String(p.value)}
                      type="button"
                      onClick={() => {
                        setFixedPairs(p.value);
                        // If switching away from fixed pairs and Swiss is selected, reset to random
                        if (!p.value && pairingMode === "swiss") setPairingMode("random");
                      }}
                      className={`flex-1 py-2.5 rounded-lg font-medium transition-all text-sm ${
                        fixedPairs === p.value
                          ? "bg-selected text-white"
                          : "bg-gray-100 text-foreground hover:bg-gray-200"
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-muted mb-1">Sets</label>
              <div className="flex gap-2">
                {[1, 3].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setNumSets(n)}
                    className={`flex-1 py-2.5 rounded-lg font-medium transition-all text-sm ${
                      numSets === n
                        ? "bg-selected text-white"
                        : "bg-gray-100 text-foreground hover:bg-gray-200"
                    }`}
                  >
                    {n === 1 ? "1 Set" : "Best of 3"}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-muted mb-1">Scoring</label>
              <div className="flex gap-2">
                {[
                  { value: "normal_11", label: "11" },
                  { value: "normal_15", label: "15" },
                  { value: "rally_21", label: "R21" },
                  { value: "timed", label: "Time" },
                ].map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => setScoringType(s.value)}
                    className={`flex-1 py-2.5 rounded-lg font-medium transition-all text-sm ${
                      scoringType === s.value
                        ? "bg-selected text-white"
                        : "bg-gray-100 text-foreground hover:bg-gray-200"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-muted mb-1">Pairing</label>
              <div className="flex gap-1.5">
                {[
                  { value: "random", icon: "🎲", label: "Random", desc: "Random matchups, everyone plays" },
                  { value: "skill_balanced", icon: "📊", label: "Skill", desc: "Similar ratings play each other" },
                  { value: "mixed_gender", icon: "👫", label: "Mixed", desc: "Each team has one male + one female" },
                  { value: "skill_mixed_gender", icon: "📊👫", label: "Skill + Mix", desc: "Balanced ratings with mixed gender teams" },
                  { value: "king_of_court", icon: "👑", label: "King", desc: "Winners move up courts, losers move down" },
                  ...(fixedPairs ? [{ value: "swiss", icon: "🇨🇭", label: "Swiss", desc: "Fixed pairs matched by win/loss record" }] : []),
                  { value: "manual", icon: "✏️", label: "Manual", desc: "Create matches one by one" },
                ].map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => setPairingMode(m.value)}
                    className={`flex-1 py-2 rounded-lg text-center transition-all ${
                      pairingMode === m.value
                        ? "bg-selected text-white ring-1 ring-selected/50"
                        : "bg-gray-100 hover:bg-gray-200"
                    }`}
                    title={m.label}
                  >
                    <span className="text-lg">{m.icon}</span>
                  </button>
                ))}
              </div>
              {(() => {
                const selected = [
                  { value: "random", label: "Random", desc: "Random matchups, everyone plays" },
                  { value: "skill_balanced", label: "Skill Balanced", desc: "Similar ratings play each other" },
                  { value: "mixed_gender", label: "Mixed Gender", desc: "Each team has one male + one female" },
                  { value: "skill_mixed_gender", label: "Skill + Mixed", desc: "Balanced ratings with mixed gender teams" },
                  { value: "king_of_court", label: "King of Court", desc: "Winners move up courts, losers move down" },
                  { value: "swiss", label: "Swiss", desc: "Teams with similar records play each other" },
                  { value: "manual", label: "Manual", desc: "Create matches one by one" },
                ].find((m) => m.value === pairingMode);
                return selected ? (
                  <div className="mt-1.5">
                    <span className="text-sm font-medium">{selected.label}</span>
                    <span className="text-xs text-muted ml-1.5">{selected.desc}</span>
                  </div>
                ) : null;
              })()}
            </div>
            {/* Play mode */}
            <div className="border-t border-border pt-3 mt-1">
              <label className="block text-sm font-medium text-muted mb-1">Play Mode</label>
              <div className="flex gap-2">
                {([
                  { value: "round_based", label: "Round-based" },
                  { value: "continuous", label: "Continuous" },
                ] as const).map((m) => (
                  <button key={m.value} type="button" onClick={() => setPlayMode(m.value)}
                    className={`flex-1 py-2.5 rounded-lg font-medium transition-all text-sm ${
                      playMode === m.value ? "bg-selected text-white" : "bg-gray-100 text-foreground hover:bg-gray-200"
                    }`}>{m.label}</button>
                ))}
              </div>
              <p className="text-xs text-muted mt-1">
                {playMode === "round_based" ? "All matches finish before next round starts." : "New match starts immediately when a court is free."}
              </p>
            </div>

            {/* Priority toggles — shown for continuous mode */}
            {playMode === "continuous" && (
              <div className="space-y-2">
                <label className="block text-sm font-medium text-muted">Prioritize</label>
                {[
                  { key: "speed", value: prioSpeed, set: setPrioSpeed, label: "Speed", desc: "Fill courts immediately" },
                  { key: "fairness", value: prioFairness, set: setPrioFairness, label: "Fairness", desc: "Equal matches for everyone" },
                  { key: "skill", value: prioSkill, set: setPrioSkill, label: "Skill", desc: "Group by level" },
                ].map((p) => (
                  <button key={p.key} type="button" onClick={() => p.set(!p.value)}
                    className={`w-full flex items-center gap-3 py-2 px-3 rounded-lg transition-all ${
                      p.value ? "bg-selected/10 border border-selected/30" : "bg-gray-50 border border-transparent"
                    }`}>
                    <div className={`w-5 h-5 rounded border-2 flex items-center justify-center text-xs font-bold ${
                      p.value ? "bg-selected border-selected text-white" : "border-gray-300"
                    }`}>{p.value ? "✓" : ""}</div>
                    <div className="text-left">
                      <span className="text-sm font-medium">{p.label}</span>
                      <span className="text-xs text-muted ml-1.5">{p.desc}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Rankings */}
            <div className="border-t border-border pt-3 mt-1">
              <label className="block text-sm font-medium text-foreground mb-0.5">Rankings</label>
              <p className="text-xs text-muted mb-2">Will matches count towards app player rankings?</p>
              <div className="flex gap-2">
                {[
                  { value: "ranked", label: "Ranked" },
                  { value: "approval", label: "Approval" },
                  { value: "none", label: "Unranked" },
                ].map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => setRankingMode(m.value)}
                    className={`flex-1 py-2.5 rounded-lg font-medium transition-all text-sm ${
                      rankingMode === m.value
                        ? "bg-selected text-white"
                        : "bg-gray-100 text-foreground hover:bg-gray-200"
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted mt-1.5">
                {rankingMode === "ranked" && "Scores count towards player ratings immediately after each match."}
                {rankingMode === "approval" && "Scores are recorded but need confirmation before affecting ratings."}
                {rankingMode === "none" && "Scores are recorded for the event but don't affect player ratings."}
              </p>
            </div>

            {/* Competition toggle */}
            {format === "doubles" && (
              <div className="border-t border-border pt-3">
                <label className="flex items-center gap-3 cursor-pointer">
                  <div className={`w-11 h-6 rounded-full transition-colors relative ${competitionEnabled ? "bg-action" : "bg-gray-200"}`}
                    onClick={() => setCompetitionEnabled(!competitionEnabled)}>
                    <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform`}
                      style={{ transform: competitionEnabled ? "translateX(22px)" : "translateX(0)" }} />
                  </div>
                  <div>
                    <span className="text-sm font-medium">Competition Mode</span>
                    <p className="text-xs text-muted">Groups → Elimination tournament</p>
                  </div>
                </label>
              </div>
            )}
          </>
        )}

        {/* Step 5: Players */}
        {step === stepNum("Players") && (() => {
          const filtered = getFilteredPlayers();
          const allVisibleSelected = filtered.length > 0 && filtered.every((p) => selectedIds.has(p.id));
          const selectedPlayersList = players.filter((p) => selectedIds.has(p.id)).sort((a, b) => a.name.localeCompare(b.name));
          return (
            <div className="flex gap-2 -mx-1">
              {/* Left column: filter + select */}
              <div className="flex-1 min-w-0 space-y-1.5">
                <div className="flex gap-1">
                  {(["M", "F"] as const).map((g) => (
                    <button key={g} type="button"
                      onClick={() => setPlayerGenderFilter(playerGenderFilter === g ? null : g)}
                      className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${
                        playerGenderFilter === g ? "bg-selected text-white" : "bg-gray-100 text-foreground"
                      }`}>
                      {g === "M" ? "♂" : "♀"}
                    </button>
                  ))}
                  {recentPlayerIds.size > 0 && (
                    <>
                      <button type="button"
                        onClick={() => { setShowAllPlayers(false); setShowClubPlayers(false); }}
                        className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${!showAllPlayers ? "bg-selected text-white" : "bg-gray-100 text-foreground"}`}>
                        Recent
                      </button>
                      <button type="button"
                        onClick={() => { setShowAllPlayers(true); setShowClubPlayers(false); }}
                        className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${showAllPlayers ? "bg-selected text-white" : "bg-gray-100 text-foreground"}`}>
                        All
                      </button>
                    </>
                  )}
                  <button type="button" onClick={selectAll} className="text-primary text-[10px] font-medium ml-auto">
                    {allVisibleSelected ? "None" : "All"}
                  </button>
                </div>
                <ClearInput value={playerSearch} onChange={setPlayerSearch} placeholder="Search..." className="text-xs" />
                <div className="space-y-0 max-h-72 overflow-y-auto">
                  {filtered.map((p) => (
                    <button key={p.id} type="button" onClick={() => togglePlayer(p.id)}
                      className={`w-full flex items-center gap-1.5 py-1.5 px-2 rounded transition-all ${
                        selectedIds.has(p.id) ? "bg-selected/10" : "hover:bg-gray-50"
                      }`}>
                      <span className={`w-3.5 h-3.5 rounded border-[1.5px] flex items-center justify-center text-[8px] font-bold shrink-0 ${
                        selectedIds.has(p.id) ? "bg-selected border-selected text-white" : "border-gray-300"
                      }`}>
                        {selectedIds.has(p.id) ? "✓" : ""}
                      </span>
                      <span className="text-xs font-medium flex-1 text-left leading-tight truncate">{p.name}</span>
                      {p.gender && (
                        <span className={`text-[9px] ${p.gender === "M" ? "text-blue-500" : "text-pink-500"}`}>
                          {p.gender === "M" ? "♂" : "♀"}
                        </span>
                      )}
                    </button>
                  ))}
                  {filtered.length === 0 && <p className="text-xs text-muted py-3 text-center">No matches</p>}
                </div>
              </div>

              {/* Right column: selected players */}
              <div className="w-[42%] shrink-0 bg-gray-50 rounded-lg p-2 space-y-1">
                <span className="text-[10px] font-semibold text-muted uppercase tracking-wider">Selected ({selectedPlayersList.length})</span>
                <div className="max-h-80 overflow-y-auto space-y-0">
                  {selectedPlayersList.map((p) => (
                    <button key={p.id} type="button" onClick={() => togglePlayer(p.id)}
                      className="w-full flex items-center gap-1 py-1 px-1.5 rounded hover:bg-red-50 hover:text-danger transition-colors group">
                      <span className="text-xs font-medium flex-1 text-left leading-tight truncate">{p.name}</span>
                      {p.gender && (
                        <span className={`text-[9px] ${p.gender === "M" ? "text-blue-500" : "text-pink-500"} group-hover:hidden`}>
                          {p.gender === "M" ? "♂" : "♀"}
                        </span>
                      )}
                      <span className="text-[9px] text-danger hidden group-hover:block">✕</span>
                    </button>
                  ))}
                  {selectedPlayersList.length === 0 && <p className="text-[10px] text-muted py-2 text-center">None selected</p>}
                </div>
              </div>
            </div>
          );
        })()}

        {/* Step 6: Pairs */}
        {step === stepNum("Pairs") && fixedPairs && format === "doubles" && (() => {
          const selectedPlayers = players.filter((p) => selectedIds.has(p.id));
          const pairedIds = new Set(memoryPairs.flatMap((p) => [p.player1Id, p.player2Id]));
          const unpaired = selectedPlayers.filter((p) => !pairedIds.has(p.id)).sort((a, b) => a.name.localeCompare(b.name));

          const autoGenerate = () => {
            const pairPlayers: PairPlayer[] = selectedPlayers.map((p) => ({
              id: p.id, name: p.name, rating: p.rating, gender: p.gender,
            }));
            const result = generatePairs(pairPlayers, { mode: pairBuildMode, preferMixed: pairPreferMixed });
            setMemoryPairs(result);
            setManualPairFirst(null);
          };

          return (
            <div className="space-y-3">
              {selectedPlayers.length < 4 ? (
                <p className="text-sm text-muted text-center py-4">Need at least 4 players to build pairs. You can skip this step.</p>
              ) : (
                <>
                  {/* Current pairs */}
                  {memoryPairs.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-muted">Pairs ({memoryPairs.length})</span>
                        <button type="button" onClick={() => { setMemoryPairs([]); setManualPairFirst(null); }}
                          className="text-xs text-danger px-2 py-1 rounded hover:bg-red-50">Clear all</button>
                      </div>
                      {memoryPairs.map((pair, i) => {
                        const p1 = players.find((p) => p.id === pair.player1Id);
                        const p2 = players.find((p) => p.id === pair.player2Id);
                        if (!p1 || !p2) return null;
                        return (
                          <div key={i} className="flex items-center gap-2 bg-gray-50 rounded-lg p-2.5">
                            <div className="flex-1 flex items-center gap-1.5 text-sm">
                              <span>{p1.emoji}</span>
                              <span className="font-medium">{p1.name}</span>
                            </div>
                            <span className="text-xs text-muted">+</span>
                            <div className="flex-1 flex items-center gap-1.5 text-sm">
                              <span>{p2.emoji}</span>
                              <span className="font-medium">{p2.name}</span>
                            </div>
                            <span className="text-xs text-muted">{Math.round(p1.rating + p2.rating)}</span>
                            <button type="button" onClick={() => setMemoryPairs(memoryPairs.filter((_, j) => j !== i))}
                              className="text-xs text-danger px-1.5 py-0.5 rounded hover:bg-red-50">✕</button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Unpaired — tap to pair manually */}
                  {unpaired.length > 0 && (
                    <div className="space-y-1">
                      <span className="text-xs text-muted">
                        {manualPairFirst ? "Tap a second player to complete the pair" : "Tap two players to pair them"}
                      </span>
                      {unpaired.map((p) => (
                        <button key={p.id} type="button"
                          onClick={() => {
                            if (manualPairFirst === p.id) {
                              setManualPairFirst(null);
                            } else if (manualPairFirst) {
                              setMemoryPairs([...memoryPairs, { player1Id: manualPairFirst, player2Id: p.id }]);
                              setManualPairFirst(null);
                            } else {
                              setManualPairFirst(p.id);
                            }
                          }}
                          className={`w-full text-left py-2 px-3 rounded-lg flex items-center gap-2 transition-colors text-sm ${
                            manualPairFirst === p.id
                              ? "bg-selected/10 border border-selected/30"
                              : manualPairFirst
                                ? "hover:bg-green-50 active:bg-green-100 border border-transparent"
                                : "hover:bg-gray-50 border border-transparent"
                          }`}>
                          <span className="text-lg">{p.emoji}</span>
                          <span className="font-medium flex-1">{p.name}</span>
                          {p.gender && <span className={`text-xs ${p.gender === "M" ? "text-blue-500" : "text-pink-500"}`}>{p.gender === "M" ? "\u2642" : "\u2640"}</span>}
                          <span className="text-xs text-muted">{Math.round(p.rating)}</span>
                          {manualPairFirst === p.id && <span className="text-xs text-selected font-medium">Selected</span>}
                          {manualPairFirst && manualPairFirst !== p.id && <span className="text-xs text-green-600">Tap to pair</span>}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Auto-generate */}
                  {unpaired.length >= 2 && (
                    <div className="border-t border-border pt-3 space-y-2">
                      <span className="text-xs text-muted font-medium">Auto-generate</span>
                      <div className="flex gap-2">
                        {(["rating", "random"] as const).map((m) => (
                          <button key={m} type="button" onClick={() => setPairBuildMode(m)}
                            className={`flex-1 py-2 rounded-lg font-medium text-sm transition-all ${pairBuildMode === m ? "bg-selected text-white" : "bg-gray-100 text-foreground"}`}>
                            {m === "rating" ? "By Rating" : "Random"}
                          </button>
                        ))}
                      </div>
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={pairPreferMixed} onChange={(e) => setPairPreferMixed(e.target.checked)}
                          className="rounded border-border" />
                        Prefer mixed gender (M + F)
                      </label>
                      <button type="button" onClick={autoGenerate}
                        className="w-full bg-action text-white py-2.5 rounded-xl font-semibold text-sm active:bg-action-dark">
                        {memoryPairs.length > 0 ? "Regenerate All Pairs" : "Generate Pairs"}
                      </button>
                    </div>
                  )}

                  {unpaired.length === 0 && memoryPairs.length > 0 && (
                    <p className="text-xs text-green-600 text-center font-medium">All players paired!</p>
                  )}
                  {unpaired.length === 1 && (
                    <p className="text-xs text-amber-600 text-center">1 player left unpaired (odd number)</p>
                  )}
                </>
              )}
              <p className="text-xs text-muted text-center">You can also set up or adjust pairs after creating the event.</p>
            </div>
          );
        })()}
        {/* Competition step */}
        {competitionEnabled && step === stepNum("Competition") && (
          <div className="space-y-3">
            <p className="text-sm text-muted">
              Competition settings will be configured after creating the event.
              The competition section on the event page lets you set up groups,
              advancement rules, and bracket formats.
            </p>
            <div className="bg-card rounded-xl border border-border p-3 space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-muted">Mode</span><span className="font-medium">Groups → Elimination</span></div>
              <div className="flex justify-between"><span className="text-muted">Pairs</span><span className="font-medium">{memoryPairs.length} pair{memoryPairs.length !== 1 ? "s" : ""}</span></div>
            </div>
            {memoryPairs.length < 4 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
                You need at least 4 pairs for competition mode. Add more players and pairs in the previous steps.
              </div>
            )}
          </div>
        )}

        {/* Review (always last step) */}
        {step === TOTAL_STEPS && (() => {
          const goEdit = (targetStep: number) => {
            setReturnToReview(true);
            setStep(targetStep);
          };
          const rowClass = "flex justify-between items-center py-2.5 px-3 border-b border-border last:border-b-0 hover:bg-gray-50 active:bg-gray-100 cursor-pointer transition-colors w-full";
          const frameClass = "bg-card rounded-xl border border-border overflow-hidden";
          const frameTitleClass = "text-[10px] text-muted px-3 pt-2 pb-1 uppercase tracking-wider font-medium";
          const genderLabel = genderMode === "mix" ? "Mixed" : "Random";
          const scoringDisplay = `${numSets === 1 ? "1 set" : "Best of 3"} ${scoringLabel(scoringType).toLowerCase()}`;
          return (
            <div className="space-y-3">
              <p className="text-xs text-muted">Tap any row to edit</p>

              {/* Organizer & Courts */}
              <div className={frameClass}>
                <button type="button" onClick={() => goEdit(stepNum("When"))} className={rowClass}>
                  <span className="text-sm text-muted">Name</span>
                  <span className="text-sm font-medium">{name}</span>
                </button>
                <button type="button" onClick={() => goEdit(stepNum("When"))} className={rowClass}>
                  <span className="text-sm text-muted">When</span>
                  <span className="text-sm font-medium">
                    {new Date(date).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} {time} – {endTime}
                  </span>
                </button>
                <button type="button" onClick={() => goEdit(stepNum("Helper"))} className={rowClass}>
                  <span className="text-sm text-muted">Organizer</span>
                  <span className="text-sm font-medium text-right">
                    <span>{session?.user?.name || "You"}</span>
                    {helperPlayers.length > 0 && (
                      <span className="block text-xs text-muted">({helperPlayers.map((hp) => hp.name).join(", ")})</span>
                    )}
                  </span>
                </button>
                <button type="button" onClick={() => goEdit(stepNum("Courts"))} className={rowClass}>
                  <span className="text-sm text-muted">Courts</span>
                  <span className="text-sm font-medium">{numCourts}</span>
                </button>
              </div>

              {/* Players & Pairs */}
              <div className={frameClass}>
                <button type="button" onClick={() => goEdit(stepNum("Players"))} className={rowClass}>
                  <span className="text-sm text-muted">Players</span>
                  <span className="text-sm font-medium">{selectedIds.size} selected</span>
                </button>
                {format === "doubles" && (
                  <button type="button" onClick={() => goEdit(stepNum("Pairs"))} className={rowClass}>
                    <span className="text-sm text-muted">Pairs</span>
                    <span className="text-sm font-medium">
                      {memoryPairs.length === 0 ? "Not set" : `${memoryPairs.length} pair${memoryPairs.length !== 1 ? "s" : ""}`}
                    </span>
                  </button>
                )}
                {competitionEnabled && (
                  <button type="button" onClick={() => goEdit(stepNum("Competition"))} className={rowClass}>
                    <span className="text-sm text-muted">Competition</span>
                    <span className="text-sm font-medium">Enabled</span>
                  </button>
                )}
              </div>

              {/* Default Format */}
              <div className={frameClass}>
                <p className={frameTitleClass}>Default Format</p>
                <button type="button" onClick={() => goEdit(stepNum("Format"))} className={rowClass}>
                  <span className="text-sm text-muted">Format</span>
                  <span className="text-sm font-medium capitalize">{format}</span>
                </button>
                <button type="button" onClick={() => goEdit(stepNum("Format"))} className={rowClass}>
                  <span className="text-sm text-muted">Gender</span>
                  <span className="text-sm font-medium">{genderLabel}</span>
                </button>
                <button type="button" onClick={() => goEdit(stepNum("Format"))} className={rowClass}>
                  <span className="text-sm text-muted">Scoring</span>
                  <span className="text-sm font-medium">{scoringDisplay}</span>
                </button>
                <button type="button" onClick={() => goEdit(stepNum("Format"))} className={rowClass}>
                  <span className="text-sm text-muted">Pairing</span>
                  <span className="text-sm font-medium">{pairingLabel(pairingMode)}</span>
                </button>
                <button type="button" onClick={() => goEdit(stepNum("Format"))} className={rowClass}>
                  <span className="text-sm text-muted">Rankings</span>
                  <span className="text-sm font-medium">
                    {rankingMode === "ranked" ? "Ranked" : rankingMode === "approval" ? "Approval" : "Unranked"}
                  </span>
                </button>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
