"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useViewRole, hasRole } from "@/components/RoleToggle";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { ClearInput } from "@/components/ClearInput";

interface PlayerClub {
  id: string;
  name: string;
  emoji: string;
  role: string;
}

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
  phone?: string | null;
  role?: string;
  clubs?: PlayerClub[];
  _count?: { matchPlayers: number };
}

export default function PlayersPage() {
  const { data: session } = useSession();
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [invitingId, setInvitingId] = useState<string | null>(null);
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [editGender, setEditGender] = useState<string | null>(null);
  const [editPhone, setEditPhone] = useState("");
  const [genderFilter, setGenderFilter] = useState<string | null>(null);
  const [clubFilter, setClubFilter] = useState<string>("");

  const { viewRole } = useViewRole();
  const isAdmin = session?.user?.role === "admin" && hasRole(viewRole, "admin");

  const fetchPlayers = async () => {
    const r = await fetch("/api/players");
    const data = await r.json();
    setPlayers(data);
    setLoading(false);
  };

  useEffect(() => {
    fetchPlayers();
  }, []);


  const voidPlayer = async (id: string, playerName: string) => {
    if (!confirm(`Are you sure you want to remove ${playerName}? If they have match history, they'll be voided (hidden but data preserved).`)) return;
    await fetch(`/api/players/${id}/void`, { method: "POST" });
    fetchPlayers();
  };

  const startEdit = (p: Player) => {
    setEditingId(p.id);
    setEditName(p.name);
    setEditGender(p.gender || null);
    setEditPhone(p.phone || "");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName("");
  };

  const saveEdit = async () => {
    if (!editingId || !editName.trim()) return;
    await fetch(`/api/players/${editingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName.trim(), gender: editGender, phone: editPhone.trim() || null }),
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

  // All distinct clubs that appear in the loaded player list (for the filter dropdown).
  const allClubs = Array.from(
    new Map(
      players.flatMap((p) => p.clubs || []).map((c) => [c.id, c]),
    ).values(),
  ).sort((a, b) => a.name.localeCompare(b.name));

  const filteredPlayers = players
    .filter((p) => p.name.toLowerCase().includes(searchQuery.toLowerCase()))
    .filter((p) => !genderFilter || p.gender === genderFilter)
    .filter((p) => !clubFilter || (p.clubs || []).some((c) => c.id === clubFilter))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Players ({searchQuery ? `${filteredPlayers.length} of ${players.length}` : players.length})</h2>
        {isAdmin && (
          <Link
            href="/players/new"
            className="bg-action text-white px-4 py-2 rounded-lg font-medium text-sm active:bg-action-dark transition-colors"
          >
            + Player
          </Link>
        )}
      </div>

      <ClearInput value={searchQuery} onChange={setSearchQuery} placeholder="Search players..." className="text-base" />
      {allClubs.length > 0 && (
        <select
          value={clubFilter}
          onChange={(e) => setClubFilter(e.target.value)}
          className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white"
        >
          <option value="">All clubs</option>
          {allClubs.map((c) => (
            <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>
          ))}
        </select>
      )}
      <div className="flex gap-2">
        {[
          { value: null, label: "All" },
          { value: "M", label: "♂ Male" },
          { value: "F", label: "♀ Female" },
        ].map((g) => (
          <button
            key={g.label}
            onClick={() => setGenderFilter(g.value)}
            className={`flex-1 py-2 rounded-lg font-medium text-sm transition-all ${
              genderFilter === g.value ? "bg-selected text-white" : "bg-gray-100 text-foreground hover:bg-gray-200"
            }`}
          >
            {g.label}
          </button>
        ))}
      </div>

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
                              ? "bg-selected text-white"
                              : "bg-gray-100 text-foreground hover:bg-gray-200"
                          }`}
                        >
                          {g.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-muted mb-1">WhatsApp (optional)</label>
                    <input
                      type="tel"
                      value={editPhone}
                      onChange={(e) => setEditPhone(e.target.value)}
                      placeholder="+CC 123 456 789"
                      className="w-full border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={saveEdit}
                      className="flex-1 bg-action-dark text-white py-2 rounded-lg font-medium text-sm"
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
                  <div className="flex items-start gap-3">
                    <PlayerAvatar name={p.name} photoUrl={p.photoUrl} size="md" />
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
                        {p.phone && (isAdmin || session?.user?.id === p.id) && (
                          <a
                            href={`https://wa.me/${p.phone.replace(/[^0-9+]/g, "").replace(/^\+/, "")}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-green-500 text-sm hover:text-green-600"
                            onClick={(e) => e.stopPropagation()}
                            title={p.phone}
                          >
                            💬
                          </a>
                        )}
                      </div>
                      <div className="text-base text-muted">
                        {Math.round(p.rating)} &middot; {p.wins}W / {p.losses}L
                        {p.email && (isAdmin || session?.user?.id === p.id) && <span className="ml-1.5 text-xs">· {p.email}</span>}
                      </div>
                    </div>
                    {(p.clubs || []).length > 0 && (
                      <div className="flex flex-col items-end gap-0.5 shrink-0 max-w-[45%]">
                        {(p.clubs || []).map((c) => (
                          <span
                            key={c.id}
                            className="text-[10px] bg-gray-100 text-foreground px-2 py-0.5 rounded-full font-medium truncate"
                            title={`${c.name} (${c.role})`}
                          >
                            {c.emoji} {c.name}
                          </span>
                        ))}
                      </div>
                    )}
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
