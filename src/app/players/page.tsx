"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";

interface Player {
  id: string;
  name: string;
  emoji: string;
  email?: string | null;
  hasAccount: boolean;
  rating: number;
  wins: number;
  losses: number;
  photoUrl?: string | null;
  _count?: { matchPlayers: number };
}

const EMOJIS = ["🏓", "🎯", "⚡", "🔥", "🌟", "💪", "🦅", "🐉", "🎪", "🍕", "🌊", "🎸"];

export default function PlayersPage() {
  const { data: session } = useSession();
  const [players, setPlayers] = useState<Player[]>([]);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("🏓");
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmoji, setEditEmoji] = useState("");
  const [invitingId, setInvitingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const isAdmin = session?.user?.role === "admin";

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

  const voidPlayer = async (id: string, playerName: string) => {
    if (!confirm(`Remove ${playerName}? If they have match history, they'll be voided (hidden but data preserved).`)) return;
    await fetch(`/api/players/${id}/void`, { method: "POST" });
    fetchPlayers();
  };

  const startEdit = (p: Player) => {
    setEditingId(p.id);
    setEditName(p.name);
    setEditEmoji(p.emoji);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName("");
    setEditEmoji("");
  };

  const saveEdit = async () => {
    if (!editingId || !editName.trim()) return;
    await fetch(`/api/players/${editingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName.trim(), emoji: editEmoji }),
    });
    cancelEdit();
    fetchPlayers();
  };

  const invitePlayer = async (player: Player) => {
    setInvitingId(player.id);
    try {
      const res = await fetch(`/api/players/${player.id}/invite`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Failed to generate invite");
        return;
      }

      const claimUrl = `${window.location.origin}/claim/${data.token}`;
      const shareText = `Hey ${player.name}! You've been added to PicklePlay 🏓 Claim your account to track your stats: ${claimUrl}`;

      // Try Web Share API first (mobile native share sheet)
      if (navigator.share) {
        try {
          await navigator.share({
            title: "Join PicklePlay",
            text: shareText,
          });
          return;
        } catch {
          // User cancelled or share failed — fall through to clipboard
        }
      }

      // Fallback: copy to clipboard
      await navigator.clipboard.writeText(shareText);
      setCopiedId(player.id);
      setTimeout(() => setCopiedId(null), 2000);
    } finally {
      setInvitingId(null);
    }
  };

  const isUnclaimed = (p: Player) => !p.hasAccount;

  if (loading) {
    return <div className="text-center py-12 text-muted">Loading...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Players ({players.length})</h2>
        {isAdmin && (
          <button
            onClick={() => setShowForm(!showForm)}
            className="bg-primary text-white px-4 py-2 rounded-lg font-medium text-sm active:bg-primary-dark transition-colors"
          >
            {showForm ? "Cancel" : "+ Add"}
          </button>
        )}
      </div>

      {showForm && isAdmin && (
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
              className="bg-card rounded-xl border border-border p-3"
            >
              {editingId === p.id ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="flex flex-wrap gap-1">
                      {EMOJIS.map((e) => (
                        <button
                          key={e}
                          type="button"
                          onClick={() => setEditEmoji(e)}
                          className={`text-xl p-0.5 rounded transition-all ${
                            editEmoji === e
                              ? "bg-primary/10 ring-2 ring-primary scale-110"
                              : ""
                          }`}
                        >
                          {e}
                        </button>
                      ))}
                    </div>
                  </div>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50"
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={saveEdit}
                      className="flex-1 bg-primary text-white py-2 rounded-lg font-medium text-sm"
                    >
                      Save
                    </button>
                    <button
                      onClick={cancelEdit}
                      className="flex-1 bg-gray-100 text-foreground py-2 rounded-lg font-medium text-sm"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <span className="text-3xl">{p.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold truncate">{p.name}</span>
                      {isUnclaimed(p) && (
                        <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-medium">
                          Unclaimed
                        </span>
                      )}
                    </div>
                    {p.email && (
                      <div className="text-xs text-muted truncate">{p.email}</div>
                    )}
                    <div className="text-sm text-muted">
                      Rating: {Math.round(p.rating)} &middot; {p.wins}W / {p.losses}L
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {isAdmin && isUnclaimed(p) && (
                      <button
                        onClick={() => invitePlayer(p)}
                        disabled={invitingId === p.id}
                        className="text-primary text-sm px-2 py-1 rounded hover:bg-primary/10 transition-colors disabled:opacity-50"
                      >
                        {copiedId === p.id ? "Copied!" : invitingId === p.id ? "..." : "Invite"}
                      </button>
                    )}
                    {(isAdmin || session?.user?.id === p.id) && (
                      <button
                        onClick={() => startEdit(p)}
                        className="text-muted text-sm px-2 py-1 rounded hover:bg-gray-100 transition-colors"
                      >
                        Edit
                      </button>
                    )}
                    {isAdmin && (
                      <button
                        onClick={() => voidPlayer(p.id, p.name)}
                        className="text-danger text-sm px-2 py-1 rounded hover:bg-red-50 transition-colors"
                      >
                        {(p._count?.matchPlayers ?? 0) > 0 ? "Void" : "Delete"}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
