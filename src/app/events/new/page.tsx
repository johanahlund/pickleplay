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

const TOTAL_STEPS = 6;

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
  const [defaultsApplied, setDefaultsApplied] = useState(false);

  useEffect(() => {
    fetch("/api/players")
      .then((r) => r.json())
      .then((data) => {
        setPlayers(data);
        setLoading(false);
      });
  }, []);

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

  const selectAll = () => {
    if (selectedIds.size === players.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(players.map((p) => p.id)));
    }
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

    // Add helper after event creation
    if (helperId) {
      await fetch(`/api/events/${event.id}/helpers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: helperId }),
      });
    }

    router.push(`/events/${event.id}`);
  };

  const canAdvance = () => {
    switch (step) {
      case 1: return name.trim().length > 0;
      case 2: return true;
      case 3: return true;
      case 4: return true;
      case 5: return true;
      case 6: return true;
      default: return false;
    }
  };

  const stepTitles = ["Name & When", "Format", "Scoring", "Pairing", "Players", "Review"];

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
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">New Event</h2>
        <span className="text-sm text-muted">{step} / {TOTAL_STEPS}</span>
      </div>

      {/* Progress bar */}
      <div className="flex gap-1.5">
        {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
          <div
            key={i}
            className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${
              i < step ? "bg-primary" : "bg-gray-200"
            }`}
          />
        ))}
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
              <label className="block text-sm font-medium text-muted mb-1">Event Helper</label>
              <select
                value={helperId || ""}
                onChange={(e) => setHelperId(e.target.value || null)}
                className="w-full border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50 bg-white"
              >
                <option value="">None</option>
                {players
                  .filter((p) => p.id !== userId)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.emoji} {p.name}
                    </option>
                  ))}
              </select>
              <p className="text-xs text-muted mt-1">Can manage this event alongside you</p>
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

        {/* Step 2: Format */}
        {step === 2 && (
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

        {/* Step 3: Scoring */}
        {step === 3 && (
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

        {/* Step 4: Pairing Mode */}
        {step === 4 && (
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

        {/* Step 5: Players */}
        {step === 5 && (
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
                {selectedIds.size === players.length ? "Deselect All" : "Select All"}
              </button>
            </div>

            {players.length === 0 ? (
              <p className="text-sm text-muted py-4 text-center">
                No players registered yet. Add players first!
              </p>
            ) : (
              <div className="space-y-1">
                {players.map((p) => (
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
          </>
        )}

        {/* Step 6: Review */}
        {step === 6 && (
          <div className="space-y-3">
            <div className="flex justify-between py-1.5 border-b border-border">
              <span className="text-sm text-muted">Name</span>
              <span className="text-sm font-medium">{name}</span>
            </div>
            {helperPlayer && (
              <div className="flex justify-between py-1.5 border-b border-border">
                <span className="text-sm text-muted">Helper</span>
                <span className="text-sm font-medium">{helperPlayer.emoji} {helperPlayer.name}</span>
              </div>
            )}
            <div className="flex justify-between py-1.5 border-b border-border">
              <span className="text-sm text-muted">Date</span>
              <span className="text-sm font-medium">{new Date(date).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-border">
              <span className="text-sm text-muted">Time</span>
              <span className="text-sm font-medium">{time} – {endTime}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-border">
              <span className="text-sm text-muted">Format</span>
              <span className="text-sm font-medium capitalize">{format}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-border">
              <span className="text-sm text-muted">Courts</span>
              <span className="text-sm font-medium">{numCourts}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-border">
              <span className="text-sm text-muted">Sets</span>
              <span className="text-sm font-medium">{numSets === 1 ? "1 Set" : "Best of 3"}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-border">
              <span className="text-sm text-muted">Scoring</span>
              <span className="text-sm font-medium">{scoringLabel(scoringType)}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-border">
              <span className="text-sm text-muted">Pairing</span>
              <span className="text-sm font-medium">{pairingLabel(pairingMode)}</span>
            </div>
            <div className="flex justify-between py-1.5">
              <span className="text-sm text-muted">Players</span>
              <span className="text-sm font-medium">{selectedIds.size} selected</span>
            </div>
          </div>
        )}
      </div>

      {/* Navigation buttons */}
      <div className="flex gap-3">
        {step > 1 && (
          <button
            type="button"
            onClick={() => setStep(step - 1)}
            className="flex-1 py-3 rounded-xl font-semibold text-lg border border-border text-foreground active:bg-gray-100 transition-colors"
          >
            Back
          </button>
        )}

        {step < TOTAL_STEPS ? (
          <button
            type="button"
            onClick={() => canAdvance() && setStep(step + 1)}
            disabled={!canAdvance()}
            className="flex-1 bg-primary text-white py-3 rounded-xl font-semibold text-lg shadow-md active:bg-primary-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Next
          </button>
        ) : (
          <button
            type="button"
            onClick={createEvent}
            disabled={!name.trim() || creating}
            className="flex-1 bg-primary text-white py-3 rounded-xl font-semibold text-lg shadow-md active:bg-primary-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {creating ? "Creating..." : "Create Event"}
          </button>
        )}
      </div>
    </div>
  );
}
