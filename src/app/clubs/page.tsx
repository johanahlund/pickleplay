"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Club {
  id: string;
  name: string;
  emoji: string;
  myRole: string;
  _count: { members: number; events: number };
}

export default function ClubsPage() {
  const [clubs, setClubs] = useState<Club[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmoji, setNewEmoji] = useState("🏓");
  const [creating, setCreating] = useState(false);

  const EMOJIS = ["🏓", "🎾", "⚡", "🔥", "🌟", "💪", "🏆", "🎯", "🦅", "🐉"];

  const fetchClubs = async () => {
    const r = await fetch("/api/clubs");
    if (r.ok) setClubs(await r.json());
    setLoading(false);
  };

  useEffect(() => { fetchClubs(); }, []);

  const createClub = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    await fetch("/api/clubs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim(), emoji: newEmoji }),
    });
    setNewName("");
    setNewEmoji("🏓");
    setShowCreate(false);
    setCreating(false);
    fetchClubs();
  };

  if (loading) {
    return <div className="text-center py-12 text-muted">Loading...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">My Clubs</h2>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="text-primary text-sm font-medium"
        >
          {showCreate ? "Cancel" : "+ New Club"}
        </button>
      </div>

      {showCreate && (
        <form onSubmit={createClub} className="bg-card rounded-xl border border-border p-4 space-y-3">
          <div>
            <label className="block text-sm font-medium text-muted mb-1">Club Name</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Tuesday Crew"
              className="w-full border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-muted mb-1">Icon</label>
            <div className="flex flex-wrap gap-2">
              {EMOJIS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => setNewEmoji(e)}
                  className={`text-2xl p-1 rounded-lg transition-all ${
                    newEmoji === e ? "bg-primary/10 ring-2 ring-primary scale-110" : "hover:bg-gray-100"
                  }`}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
          <button
            type="submit"
            disabled={!newName.trim() || creating}
            className="w-full bg-action-dark text-white py-2.5 rounded-lg font-semibold transition-colors disabled:opacity-50"
          >
            {creating ? "Creating..." : "Create Club"}
          </button>
        </form>
      )}

      {clubs.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-5xl mb-3">🏟️</div>
          <p className="text-muted">No clubs yet. Create one!</p>
        </div>
      ) : (
        <div className="space-y-2">
          {clubs.map((club) => (
            <Link
              key={club.id}
              href={`/clubs/${club.id}`}
              className="block bg-card rounded-xl border border-border p-4 active:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="text-3xl">{club.emoji}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-lg">{club.name}</span>
                    <span className="text-[10px] bg-gray-100 text-muted px-1.5 py-0.5 rounded-full font-medium capitalize">
                      {club.myRole}
                    </span>
                  </div>
                  <p className="text-sm text-muted">
                    {club._count.members} member{club._count.members !== 1 ? "s" : ""} &middot;{" "}
                    {club._count.events} event{club._count.events !== 1 ? "s" : ""}
                  </p>
                </div>
                <span className="text-2xl text-muted">›</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
