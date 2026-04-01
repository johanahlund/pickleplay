"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";

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
  const now = new Date();
  const mins = now.getMinutes();
  const roundedMins = mins < 30 ? 30 : 0;
  const hours = mins < 30 ? now.getHours() : now.getHours() + 1;
  return `${String(hours % 24).padStart(2, "0")}:${String(roundedMins).padStart(2, "0")}`;
}

const TOTAL_STEPS = 7;

export default function NewEventPage() {
  const router = useRouter();
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
  const [endTime, setEndTime] = useState(() => {
    const t = getDefaultTime();
    const [h, m] = t.split(":").map(Number);
    return `${String((h + 2) % 24).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  });
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [numSets, setNumSets] = useState(1);
  const [scoringType, setScoringType] = useState("normal_11");
  const [pairingMode, setPairingMode] = useState("random");
  const [helperId, setHelperId] = useState<string | null>(null);
  const [helperSearch, setHelperSearch] = useState("");
  const [helperGenderFilter, setHelperGenderFilter] = useState<string | null>(null);
  const [defaultsApplied, setDefaultsApplied] = useState(false);
  const [allWaGroups, setAllWaGroups] = useState<{ id: string; name: string }[]>([]);
  const [selectedWaGroupIds, setSelectedWaGroupIds] = useState<Set<string>>(new Set());
  const [newGroupName, setNewGroupName] = useState("");
  const [recentPlayerIds, setRecentPlayerIds] = useState<Set<string>>(new Set());
  const [playerSearch, setPlayerSearch] = useState("");
  const [playerGenderFilter, setPlayerGenderFilter] = useState<string | null>(null);
  const [showAllPlayers, setShowAllPlayers] = useState(false);
  const [returnToReview, setReturnToReview] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/players").then((r) => r.json()),
      fetch("/api/events").then((r) => r.json()),
      fetch("/api/whatsapp-groups").then((r) => r.json()),
    ]).then(([playersData, eventsData, waGroupsData]) => {
      setPlayers(playersData);
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
      setLoading(false);
    });
  }, [userId]);

  // Auto-select owner + helper as players once data is ready
  useEffect(() => {
    if (defaultsApplied || players.length === 0) return;
    const defaults = new Set<string>();
    if (userId && players.some((p) => p.id === userId)) defaults.add(userId);
    if (helperId && players.some((p) => p.id === helperId)) defaults.add(helperId);
    if (defaults.size > 0) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        defaults.forEach((id) => next.add(id));
        return next;
      });
    }
    setDefaultsApplied(true);
  }, [players, userId, helperId, defaultsApplied]);

  // When helper changes, ensure they're added to selected players
  useEffect(() => {
    if (helperId && players.some((p) => p.id === helperId)) {
      setSelectedIds((prev) => {
        if (prev.has(helperId)) return prev;
        const next = new Set(prev);
        next.add(helperId);
        return next;
      });
    }
  }, [helperId, players]);

  const togglePlayer = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const getFilteredPlayers = () => {
    return players
      .filter((p) => {
        if (!showAllPlayers && recentPlayerIds.size > 0 && !recentPlayerIds.has(p.id)) return false;
        if (playerSearch && !p.name.toLowerCase().includes(playerSearch.toLowerCase())) return false;
        if (playerGenderFilter && p.gender !== playerGenderFilter) return false;
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
        numCourts,
        format,
        date: eventDate.toISOString(),
        endDate: eventEndDate.toISOString(),
        numSets,
        scoringType,
        pairingMode,
      }),
    });
    const event = await r.json();

    if (helperId) {
      await fetch(`/api/events/${event.id}/helpers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: helperId }),
      });
    }

    for (const gid of selectedWaGroupIds) {
      await fetch(`/api/events/${event.id}/whatsapp-groups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ whatsappGroupId: gid }),
      });
    }

    router.push(`/events/${event.id}`);
  };

  const canAdvance = () => {
    switch (step) {
      case 1: return name.trim().length > 0;
      default: return true;
    }
  };

  const stepTitles = ["Name & When", "Helper", "Format", "Scoring", "Pairing", "Players", "Review"];

  if (loading) {
    return <div className="text-center py-12 text-muted">Loading...</div>;
  }

  const helperPlayer = helperId ? players.find((p) => p.id === helperId) : null;

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
    <div className="space-y-4">
      {/* Header with nav buttons */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">New Event</h2>
        <span className="text-sm text-muted">{step} / {TOTAL_STEPS}</span>
      </div>

      {/* Progress bar + nav buttons */}
      <div className="flex items-center gap-2">
        {returnToReview && step !== TOTAL_STEPS ? (
          <>
            <div className="flex gap-1 flex-1">
              {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
                <div
                  key={i}
                  className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${
                    i < step ? "bg-primary" : "bg-gray-200"
                  }`}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={() => { setReturnToReview(false); setStep(TOTAL_STEPS); }}
              className="bg-primary text-white px-4 py-1.5 rounded-lg text-sm font-medium shadow-sm active:bg-primary-dark transition-colors"
            >
              Review
            </button>
          </>
        ) : (
          <>
            {step > 1 && (
              <button
                type="button"
                onClick={() => setStep(step - 1)}
                className="px-3 py-1.5 rounded-lg text-sm font-medium border border-border text-foreground active:bg-gray-100 transition-colors"
              >
                Back
              </button>
            )}
            <div className="flex gap-1 flex-1">
              {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
                <div
                  key={i}
                  className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${
                    i < step ? "bg-primary" : "bg-gray-200"
                  }`}
                />
              ))}
            </div>
            {step < TOTAL_STEPS ? (
              <button
                type="button"
                onClick={() => canAdvance() && setStep(step + 1)}
                disabled={!canAdvance()}
                className="bg-primary text-white px-4 py-1.5 rounded-lg text-sm font-medium shadow-sm active:bg-primary-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
              </button>
            ) : (
              <button
                type="button"
                onClick={createEvent}
                disabled={!name.trim() || creating}
                className="bg-primary text-white px-4 py-1.5 rounded-lg text-sm font-medium shadow-sm active:bg-primary-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {creating ? "..." : "Create"}
              </button>
            )}
          </>
        )}
      </div>

      {/* Step title */}
      <p className="text-sm text-muted font-medium">{stepTitles[step - 1]}</p>

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
              <label className="block text-sm font-medium text-muted mb-1">WhatsApp Groups</label>
              {allWaGroups.length > 0 && (
                <div className="space-y-1 mb-2">
                  {allWaGroups.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => {
                        setSelectedWaGroupIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(g.id)) next.delete(g.id);
                          else next.add(g.id);
                          return next;
                        });
                      }}
                      className={`w-full flex items-center gap-2 p-2.5 rounded-lg transition-all text-sm ${
                        selectedWaGroupIds.has(g.id)
                          ? "bg-primary/10 border border-primary/30"
                          : "hover:bg-gray-50 border border-transparent"
                      }`}
                    >
                      <span
                        className={`w-5 h-5 rounded-md border-2 flex items-center justify-center text-xs font-bold transition-colors ${
                          selectedWaGroupIds.has(g.id)
                            ? "bg-primary border-primary text-white"
                            : "border-gray-300"
                        }`}
                      >
                        {selectedWaGroupIds.has(g.id) ? "✓" : ""}
                      </span>
                      <span>💬</span>
                      <span className="font-medium">{g.name}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder="Create new group..."
                  className="flex-1 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                <button
                  type="button"
                  onClick={async () => {
                    if (!newGroupName.trim()) return;
                    const r = await fetch("/api/whatsapp-groups", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ name: newGroupName.trim() }),
                    });
                    const group = await r.json();
                    setAllWaGroups((prev) => [...prev, group]);
                    setSelectedWaGroupIds((prev) => {
                      const next = new Set(prev);
                      next.add(group.id);
                      return next;
                    });
                    setNewGroupName("");
                  }}
                  disabled={!newGroupName.trim()}
                  className="bg-primary text-white px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
                >
                  Create
                </button>
              </div>
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
          </>
        )}

        {/* Step 2: Helper */}
        {step === 2 && (
          <>
            {helperPlayer ? (
              <div className="flex items-center gap-2 p-2.5 bg-primary/10 border border-primary/30 rounded-lg">
                <span className="text-xl">{helperPlayer.emoji}</span>
                <span className="font-medium flex-1">{helperPlayer.name}</span>
                <button
                  type="button"
                  onClick={() => { setHelperId(null); setHelperSearch(""); setHelperGenderFilter(null); }}
                  className="text-xs text-muted hover:text-foreground px-2 py-1 rounded bg-gray-100"
                >
                  Change
                </button>
              </div>
            ) : (
              <>
                <div className="flex gap-2 mb-2">
                  <input
                    type="text"
                    value={helperSearch}
                    onChange={(e) => setHelperSearch(e.target.value)}
                    placeholder="Search by name..."
                    className="flex-1 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                  {(["M", "F"] as const).map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setHelperGenderFilter(helperGenderFilter === g ? null : g)}
                      className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                        helperGenderFilter === g
                          ? "bg-primary text-white"
                          : "bg-gray-100 text-foreground hover:bg-gray-200"
                      }`}
                    >
                      {g === "M" ? "♂" : "♀"}
                    </button>
                  ))}
                </div>
                <div className="space-y-1 max-h-64 overflow-y-auto">
                  <button
                    type="button"
                    onClick={() => { setHelperId(null); setHelperSearch(""); setHelperGenderFilter(null); }}
                    className={`w-full text-left p-2.5 rounded-lg transition-all text-sm text-muted ${
                      !helperId ? "bg-primary/10 border border-primary/30" : "hover:bg-gray-50 border border-transparent"
                    }`}
                  >
                    None
                  </button>
                  {players
                    .filter((p) => p.id !== userId)
                    .filter((p) => !helperSearch || p.name.toLowerCase().includes(helperSearch.toLowerCase()))
                    .filter((p) => !helperGenderFilter || p.gender === helperGenderFilter)
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => { setHelperId(p.id); setHelperSearch(""); setHelperGenderFilter(null); }}
                        className="w-full flex items-center gap-3 p-2.5 rounded-lg transition-all hover:bg-gray-50 border border-transparent"
                      >
                        <span className="text-xl">{p.emoji}</span>
                        <span className="font-medium flex-1 text-left text-sm">{p.name}</span>
                        {p.gender && (
                          <span className={`text-xs ${p.gender === "M" ? "text-blue-500" : "text-pink-500"}`}>
                            {p.gender === "M" ? "♂" : "♀"}
                          </span>
                        )}
                      </button>
                    ))}
                </div>
              </>
            )}
            <p className="text-xs text-muted">Can manage this event alongside you</p>
          </>
        )}

        {/* Step 3: Format */}
        {step === 3 && (
          <>
            <div>
              <label className="block text-sm font-medium text-muted mb-1">Format</label>
              <div className="flex gap-2">
                {(["doubles", "singles"] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFormat(f)}
                    className={`flex-1 py-3 rounded-lg font-medium transition-all capitalize ${
                      format === f
                        ? "bg-primary text-white"
                        : "bg-gray-100 text-foreground hover:bg-gray-200"
                    }`}
                  >
                    {f === "doubles" ? "🤝 Doubles" : "👤 Singles"}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-muted mb-1">Number of Courts</label>
              <div className="flex gap-2">
                {[1, 2, 3, 4].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setNumCourts(n)}
                    className={`flex-1 py-3 rounded-lg font-medium transition-all ${
                      numCourts === n
                        ? "bg-primary text-white"
                        : "bg-gray-100 text-foreground hover:bg-gray-200"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Step 4: Scoring */}
        {step === 4 && (
          <>
            <div>
              <label className="block text-sm font-medium text-muted mb-1">Sets per Match</label>
              <div className="flex gap-2">
                {[1, 3].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setNumSets(n)}
                    className={`flex-1 py-3 rounded-lg font-medium transition-all ${
                      numSets === n
                        ? "bg-primary text-white"
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
              <div className="grid grid-cols-2 gap-2">
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
                    className={`py-3 px-3 rounded-lg font-medium transition-all text-sm ${
                      scoringType === s.value
                        ? "bg-primary text-white"
                        : "bg-gray-100 text-foreground hover:bg-gray-200"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Step 5: Pairing Mode */}
        {step === 5 && (
          <div className="space-y-1.5">
            {[
              { value: "random", label: "🎲 Random", desc: "Random matchups, everyone plays" },
              { value: "skill_balanced", label: "📊 Skill Balanced", desc: "Similar ratings play each other" },
              { value: "mixed_gender", label: "👫 Mixed Gender", desc: "Each team has M + F" },
              { value: "skill_mixed_gender", label: "📊👫 Skill + Mixed", desc: "Balanced ratings with M + F teams" },
              { value: "king_of_court", label: "👑 King of Court", desc: "Winners stay, losers rotate" },
              { value: "swiss", label: "🏆 Swiss", desc: "Pair by win/loss record" },
              { value: "manual", label: "✏️ Manual", desc: "Add matches one by one" },
            ].map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => setPairingMode(m.value)}
                className={`w-full text-left py-2.5 px-3 rounded-lg transition-all ${
                  pairingMode === m.value
                    ? "bg-primary/10 border border-primary/30"
                    : "bg-gray-50 border border-transparent hover:bg-gray-100"
                }`}
              >
                <div className="font-medium text-sm">{m.label}</div>
                <div className="text-xs text-muted">{m.desc}</div>
              </button>
            ))}
          </div>
        )}

        {/* Step 6: Players */}
        {step === 6 && (() => {
          const filtered = getFilteredPlayers();
          const allVisibleSelected = filtered.length > 0 && filtered.every((p) => selectedIds.has(p.id));
          return (
            <>
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-muted">
                  Select Players ({selectedIds.size} selected)
                </label>
                <button
                  type="button"
                  onClick={selectAll}
                  className="text-primary text-sm font-medium"
                >
                  {allVisibleSelected ? "Deselect All" : "Select All"}
                </button>
              </div>

              {/* Filters */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={playerSearch}
                  onChange={(e) => setPlayerSearch(e.target.value)}
                  placeholder="Search by name..."
                  className="flex-1 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                {(["M", "F"] as const).map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setPlayerGenderFilter(playerGenderFilter === g ? null : g)}
                    className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                      playerGenderFilter === g
                        ? "bg-primary text-white"
                        : "bg-gray-100 text-foreground hover:bg-gray-200"
                    }`}
                  >
                    {g === "M" ? "♂" : "♀"}
                  </button>
                ))}
              </div>

              {/* Context label */}
              {recentPlayerIds.size > 0 && !showAllPlayers && (
                <p className="text-xs text-muted">Showing players from your last 2 events</p>
              )}

              {players.length === 0 ? (
                <p className="text-sm text-muted py-4 text-center">
                  No players registered yet. Add players first!
                </p>
              ) : filtered.length === 0 ? (
                <p className="text-sm text-muted py-4 text-center">
                  No players match your filters
                </p>
              ) : (
                <div className="space-y-1 max-h-80 overflow-y-auto">
                  {filtered.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => togglePlayer(p.id)}
                      className={`w-full flex items-center gap-3 p-2.5 rounded-lg transition-all ${
                        selectedIds.has(p.id)
                          ? "bg-primary/10 border border-primary/30"
                          : "hover:bg-gray-50 border border-transparent"
                      }`}
                    >
                      <span
                        className={`w-5 h-5 rounded-md border-2 flex items-center justify-center text-xs font-bold transition-colors ${
                          selectedIds.has(p.id)
                            ? "bg-primary border-primary text-white"
                            : "border-gray-300"
                        }`}
                      >
                        {selectedIds.has(p.id) ? "✓" : ""}
                      </span>
                      <span className="text-xl">{p.emoji}</span>
                      <span className="font-medium flex-1 text-left">{p.name}</span>
                      {p.gender && (
                        <span className={`text-xs ${p.gender === "M" ? "text-blue-500" : "text-pink-500"}`}>
                          {p.gender === "M" ? "♂" : "♀"}
                        </span>
                      )}
                      <span className="text-sm text-muted">{Math.round(p.rating)}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* Search All / Show Recent */}
              {recentPlayerIds.size > 0 && !showAllPlayers && (
                <button
                  type="button"
                  onClick={() => setShowAllPlayers(true)}
                  className="w-full py-2.5 rounded-lg text-sm font-medium text-primary border border-primary/30 hover:bg-primary/5 transition-all mt-1"
                >
                  Search All Players
                </button>
              )}
              {showAllPlayers && recentPlayerIds.size > 0 && (
                <button
                  type="button"
                  onClick={() => { setShowAllPlayers(false); setPlayerSearch(""); setPlayerGenderFilter(null); }}
                  className="w-full py-2.5 rounded-lg text-sm font-medium text-muted border border-border hover:bg-gray-50 transition-all mt-1"
                >
                  Show Recent Only
                </button>
              )}
            </>
          );
        })()}

        {/* Step 7: Review */}
        {step === 7 && (() => {
          const goEdit = (targetStep: number) => {
            setReturnToReview(true);
            setStep(targetStep);
          };
          const rowClass = "flex justify-between items-center py-2.5 px-2 -mx-2 border-b border-border rounded-lg hover:bg-gray-50 active:bg-gray-100 cursor-pointer transition-colors";
          return (
            <div className="space-y-1">
              <p className="text-xs text-muted mb-2">Tap any row to edit</p>
              <button type="button" onClick={() => goEdit(1)} className={rowClass + " w-full"}>
                <span className="text-sm text-muted">Name</span>
                <span className="text-sm font-medium">{name}</span>
              </button>
              <button type="button" onClick={() => goEdit(2)} className={rowClass + " w-full"}>
                <span className="text-sm text-muted">Helper</span>
                <span className="text-sm font-medium">{helperPlayer ? `${helperPlayer.emoji} ${helperPlayer.name}` : "None"}</span>
              </button>
              <button type="button" onClick={() => goEdit(1)} className={rowClass + " w-full"}>
                <span className="text-sm text-muted">WhatsApp</span>
                <span className="text-sm font-medium">
                  {selectedWaGroupIds.size > 0
                    ? `${selectedWaGroupIds.size} group${selectedWaGroupIds.size > 1 ? "s" : ""}`
                    : "None"}
                </span>
              </button>
              <button type="button" onClick={() => goEdit(1)} className={rowClass + " w-full"}>
                <span className="text-sm text-muted">Date</span>
                <span className="text-sm font-medium">{new Date(date).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</span>
              </button>
              <button type="button" onClick={() => goEdit(1)} className={rowClass + " w-full"}>
                <span className="text-sm text-muted">Time</span>
                <span className="text-sm font-medium">{time} – {endTime}</span>
              </button>
              <button type="button" onClick={() => goEdit(3)} className={rowClass + " w-full"}>
                <span className="text-sm text-muted">Format</span>
                <span className="text-sm font-medium capitalize">{format}</span>
              </button>
              <button type="button" onClick={() => goEdit(3)} className={rowClass + " w-full"}>
                <span className="text-sm text-muted">Courts</span>
                <span className="text-sm font-medium">{numCourts}</span>
              </button>
              <button type="button" onClick={() => goEdit(4)} className={rowClass + " w-full"}>
                <span className="text-sm text-muted">Sets</span>
                <span className="text-sm font-medium">{numSets === 1 ? "1 Set" : "Best of 3"}</span>
              </button>
              <button type="button" onClick={() => goEdit(4)} className={rowClass + " w-full"}>
                <span className="text-sm text-muted">Scoring</span>
                <span className="text-sm font-medium">{scoringLabel(scoringType)}</span>
              </button>
              <button type="button" onClick={() => goEdit(5)} className={rowClass + " w-full"}>
                <span className="text-sm text-muted">Pairing</span>
                <span className="text-sm font-medium">{pairingLabel(pairingMode)}</span>
              </button>
              <button type="button" onClick={() => goEdit(6)} className={rowClass + " w-full border-b-0"}>
                <span className="text-sm text-muted">Players</span>
                <span className="text-sm font-medium">{selectedIds.size} selected</span>
              </button>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
