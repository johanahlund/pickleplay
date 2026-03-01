"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface Player {
  id: string;
  name: string;
  emoji: string;
  rating: number;
}

export default function NewEventPage() {
  const router = useRouter();
  const [players, setPlayers] = useState<Player[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [name, setName] = useState("");
  const [numCourts, setNumCourts] = useState(2);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetch("/api/players")
      .then((r) => r.json())
      .then((data) => {
        setPlayers(data);
        setLoading(false);
      });
  }, []);

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

  const createEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || selectedIds.size < 4) return;
    setCreating(true);
    const r = await fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        playerIds: Array.from(selectedIds),
        numCourts,
      }),
    });
    const event = await r.json();
    router.push(`/events/${event.id}`);
  };

  if (loading) {
    return <div className="text-center py-12 text-muted">Loading...</div>;
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">New Event</h2>

      <form onSubmit={createEvent} className="space-y-4">
        <div className="bg-card rounded-xl border border-border p-4 space-y-3">
          <div>
            <label className="block text-sm font-medium text-muted mb-1">
              Event Name
            </label>
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
            <label className="block text-sm font-medium text-muted mb-1">
              Number of Courts
            </label>
            <div className="flex gap-2">
              {[1, 2, 3, 4].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setNumCourts(n)}
                  className={`flex-1 py-2 rounded-lg font-medium transition-all ${
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
        </div>

        <div className="bg-card rounded-xl border border-border p-4 space-y-3">
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
                  <span className="text-sm text-muted">
                    {Math.round(p.rating)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {selectedIds.size > 0 && selectedIds.size < 4 && (
          <p className="text-sm text-danger text-center">
            Need at least 4 players for doubles
          </p>
        )}

        <button
          type="submit"
          disabled={!name.trim() || selectedIds.size < 4 || creating}
          className="w-full bg-primary text-white py-3 rounded-xl font-semibold text-lg shadow-md active:bg-primary-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {creating ? "Creating..." : "Create Event"}
        </button>
      </form>
    </div>
  );
}
