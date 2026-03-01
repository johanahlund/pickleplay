"use client";

import { useEffect, useState } from "react";

interface Player {
  id: string;
  name: string;
  emoji: string;
  rating: number;
  wins: number;
  losses: number;
}

const EMOJIS = ["🏓", "🎯", "⚡", "🔥", "🌟", "💪", "🦅", "🐉", "🎪", "🍕", "🌊", "🎸"];

export default function PlayersPage() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("🏓");
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const fetchPlayers = async () => {
    const r = await fetch("/api/players");
    const data = await r.json();
    setPlayers(data);
    setLoading(false);
  };

  useEffect(() => {
    fetchPlayers();
  }, []);

  const addPlayer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    await fetch("/api/players", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), emoji }),
    });
    setName("");
    setEmoji("🏓");
    setShowForm(false);
    fetchPlayers();
  };

  const deletePlayer = async (id: string) => {
    if (!confirm("Remove this player?")) return;
    await fetch(`/api/players/${id}`, { method: "DELETE" });
    fetchPlayers();
  };

  if (loading) {
    return <div className="text-center py-12 text-muted">Loading...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Players ({players.length})</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-primary text-white px-4 py-2 rounded-lg font-medium text-sm active:bg-primary-dark transition-colors"
        >
          {showForm ? "Cancel" : "+ Add"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={addPlayer} className="bg-card rounded-xl border border-border p-4 space-y-3">
          <div>
            <label className="block text-sm font-medium text-muted mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Player name"
              className="w-full border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-muted mb-1">Avatar</label>
            <div className="flex flex-wrap gap-2">
              {EMOJIS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => setEmoji(e)}
                  className={`text-2xl p-1 rounded-lg transition-all ${
                    emoji === e
                      ? "bg-primary/10 ring-2 ring-primary scale-110"
                      : "hover:bg-gray-100"
                  }`}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
          <button
            type="submit"
            className="w-full bg-primary text-white py-2.5 rounded-lg font-semibold active:bg-primary-dark transition-colors"
          >
            Add Player
          </button>
        </form>
      )}

      {players.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-5xl mb-3">👥</div>
          <p className="text-muted">No players yet. Add some!</p>
        </div>
      ) : (
        <div className="space-y-2">
          {players.map((p) => (
            <div
              key={p.id}
              className="bg-card rounded-xl border border-border p-3 flex items-center gap-3"
            >
              <span className="text-3xl">{p.emoji}</span>
              <div className="flex-1 min-w-0">
                <div className="font-semibold truncate">{p.name}</div>
                <div className="text-sm text-muted">
                  Rating: {Math.round(p.rating)} &middot; {p.wins}W / {p.losses}L
                </div>
              </div>
              <button
                onClick={() => deletePlayer(p.id)}
                className="text-danger text-sm px-2 py-1 rounded hover:bg-red-50 transition-colors"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
