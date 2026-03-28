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
  gender?: string | null;
  role?: string;
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
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [gender, setGender] = useState<string | null>(null);
  const [editGender, setEditGender] = useState<string | null>(null);

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
      body: JSON.stringify({ name: name.trim(), emoji, ...(gender ? { gender } : {}) }),
    });
    setName("");
    setEmoji("🏓");
    setGender(null);
    setShowForm(false);
    fetchPlayers();
  };

  const voidPlayer = async (id: string, playerName: string) => {
    if (!confirm(`Are you sure you want to remove ${playerName}? If they have match history, they'll be voided (hidden but data preserved).`)) return;
    await fetch(`/api/players/${id}/void`, { method: "POST" });
    fetchPlayers();
  };

  const startEdit = (p: Player) => {
    setEditingId(p.id);
    setEditName(p.name);
    setEditEmoji(p.emoji);
    setEditGender(p.gender || null);
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
      body: JSON.stringify({ name: editName.trim(), emoji: editEmoji, gender: editGender }),
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
      const shareText = `Hey ${player.name}! You've been added to PickleJ 🏓 Claim your account to track your stats: ${claimUrl}`;

      // Try Web Share API first (mobile native share sheet)
      if (navigator.share) {
        try {
          await navigator.share({
            title: "Join PickleJ",
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

  const resetPlayer = async (player: Player) => {
    setResettingId(player.id);
    try {
      const res = await fetch(`/api/players/${player.id}/reset`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Failed to generate reset link");
        return;
      }

      const resetUrl = `${window.location.origin}/reset/${data.token}`;
      const shareText = `Reset your PickleJ password here: ${resetUrl}`;

      if (navigator.share) {
        try {
          await navigator.share({
            title: "PickleJ Password Reset",
            text: shareText,
          });
          return;
        } catch {
          // Fall through to clipboard
        }
      }

      await navigator.clipboard.writeText(shareText);
      setCopiedId(player.id);
      setTimeout(() => setCopiedId(null), 2000);
    } finally {
      setResettingId(null);
    }
  };

  const resetRating = async (player: Player) => {
    if (!confirm(`Are you sure you want to reset ${player.name}'s rating to 1000 and clear W/L record?`)) return;
    const res = await fetch(`/api/players/${player.id}/reset-rating`, { method: "POST" });
    if (!res.ok) {
      alert("Failed to reset rating");
      return;
    }
    fetchPlayers();
  };

  const isUnclaimed = (p: Player) => !p.hasAccount;

  if (loading) {
    return <div className="text-center py-12 text-muted">Loading...</div>;
  }

  const filteredPlayers = players.filter((p) =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Players ({searchQuery ? `${filteredPlayers.length} of ${players.length}` : players.length})</h2>
        {isAdmin && (
          <button
            onClick={() => setShowForm(!showForm)}
            className="bg-primary text-white px-4 py-2 rounded-lg font-medium text-sm active:bg-primary-dark transition-colors"
          >
            {showForm ? "Cancel" : "+ Add"}
          </button>
        )}
      </div>

      <input
        type="text"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="Search players..."
        className="w-full border border-border rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary/50 text-base"
      />

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
          <div>
            <label className="block text-sm font-medium text-muted mb-1">Gender (optional)</label>
            <div className="flex gap-2">
              {[
                { value: null, label: "Skip" },
                { value: "M", label: "♂ Male" },
                { value: "F", label: "♀ Female" },
              ].map((g) => (
                <button
                  key={g.label}
                  type="button"
                  onClick={() => setGender(g.value)}
                  className={`flex-1 py-2 rounded-lg font-medium text-sm transition-all ${
                    gender === g.value
                      ? "bg-primary text-white"
                      : "bg-gray-100 text-foreground hover:bg-gray-200"
                  }`}
                >
                  {g.label}
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
          {filteredPlayers.map((p) => (
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
                  <div>
                    <label className="block text-sm font-medium text-muted mb-1">Gender (optional)</label>
                    <div className="flex gap-2">
                      {[
                        { value: null, label: "Skip" },
                        { value: "M", label: "♂ Male" },
                        { value: "F", label: "♀ Female" },
                      ].map((g) => (
                        <button
                          key={g.label}
                          type="button"
                          onClick={() => setEditGender(g.value)}
                          className={`flex-1 py-2 rounded-lg font-medium text-sm transition-all ${
                            editGender === g.value
                              ? "bg-primary text-white"
                              : "bg-gray-100 text-foreground hover:bg-gray-200"
                          }`}
                        >
                          {g.label}
                        </button>
                      ))}
                    </div>
                  </div>
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
                <div>
                  <div className="flex items-center gap-3">
                    <span className="text-3xl">{p.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-semibold text-lg">{p.name}</span>
                        {p.role === "admin" && (
                          <span className="text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full font-medium">
                            Admin
                          </span>
                        )}
                        {isUnclaimed(p) && (
                          <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-medium">
                            Unclaimed
                          </span>
                        )}
                        {p.gender && (
                          <span className={`text-xs ${p.gender === "M" ? "text-blue-500" : "text-pink-500"}`}>
                            {p.gender === "M" ? "♂" : "♀"}
                          </span>
                        )}
                      </div>
                      <div className="text-base text-muted">
                        {Math.round(p.rating)} &middot; {p.wins}W / {p.losses}L
                        {p.email && <span className="ml-1.5 text-xs">· {p.email}</span>}
                      </div>
                    </div>
                  </div>
                  {isAdmin && (
                    <div className="flex items-center gap-1 mt-2 ml-12 flex-wrap">
                      {isUnclaimed(p) && (
                        <button
                          onClick={() => invitePlayer(p)}
                          disabled={invitingId === p.id}
                          className="text-primary text-xs px-2 py-1 rounded hover:bg-primary/10 transition-colors disabled:opacity-50"
                        >
                          {copiedId === p.id ? "Copied!" : invitingId === p.id ? "..." : "Invite"}
                        </button>
                      )}
                      {!isUnclaimed(p) && (
                        <button
                          onClick={() => resetPlayer(p)}
                          disabled={resettingId === p.id}
                          className="text-amber-600 text-xs px-2 py-1 rounded hover:bg-amber-50 transition-colors disabled:opacity-50"
                        >
                          {copiedId === p.id ? "Copied!" : resettingId === p.id ? "..." : "Reset PW"}
                        </button>
                      )}
                      {(p.wins > 0 || p.losses > 0 || p.rating !== 1000) && (
                        <button
                          onClick={() => resetRating(p)}
                          className="text-blue-600 text-xs px-2 py-1 rounded hover:bg-blue-50 transition-colors"
                        >
                          Reset ELO
                        </button>
                      )}
                      <button
                        onClick={() => startEdit(p)}
                        className="text-muted text-xs px-2 py-1 rounded hover:bg-gray-100 transition-colors"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => voidPlayer(p.id, p.name)}
                        className="text-danger text-xs px-2 py-1 rounded hover:bg-red-50 transition-colors"
                      >
                        {(p._count?.matchPlayers ?? 0) > 0 ? "Void" : "Delete"}
                      </button>
                    </div>
                  )}
                  {!isAdmin && session?.user?.id === p.id && (
                    <div className="mt-2 ml-12">
                      <button
                        onClick={() => startEdit(p)}
                        className="text-muted text-xs px-2 py-1 rounded hover:bg-gray-100 transition-colors"
                      >
                        Edit
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
