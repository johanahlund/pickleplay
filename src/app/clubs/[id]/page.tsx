"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

interface Player {
  id: string;
  name: string;
  emoji: string;
  rating: number;
  gender?: string | null;
  phone?: string | null;
}

interface ClubMember {
  id: string;
  playerId: string;
  role: string;
  player: Player;
}

interface WaGroup {
  id: string;
  name: string;
}

interface Club {
  id: string;
  name: string;
  emoji: string;
  createdById: string | null;
  members: ClubMember[];
  whatsappGroups: WaGroup[];
  _count: { events: number };
}

export default function ClubDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const userId = (session?.user as { id?: string } | undefined)?.id;

  const [club, setClub] = useState<Club | null>(null);
  const [loading, setLoading] = useState(true);
  const [allPlayers, setAllPlayers] = useState<Player[]>([]);
  const [showAddMember, setShowAddMember] = useState(false);
  const [memberSearch, setMemberSearch] = useState("");
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editEmoji, setEditEmoji] = useState("");

  const EMOJIS = ["🏓", "🎾", "⚡", "🔥", "🌟", "💪", "🏆", "🎯", "🦅", "🐉"];

  const fetchClub = useCallback(async () => {
    const r = await fetch(`/api/clubs/${id}`);
    if (!r.ok) { router.push("/clubs"); return; }
    const data = await r.json();
    setClub(data);
    setLoading(false);
  }, [id, router]);

  useEffect(() => { fetchClub(); }, [fetchClub]);

  const myMembership = club?.members.find((m) => m.playerId === userId);
  const canManage = myMembership?.role === "owner" || myMembership?.role === "admin" || session?.user?.role === "admin";
  const isOwner = myMembership?.role === "owner" || session?.user?.role === "admin";

  const fetchAllPlayers = async () => {
    if (allPlayers.length > 0) return;
    const r = await fetch("/api/players");
    if (r.ok) setAllPlayers(await r.json());
  };

  const addMember = async (playerId: string) => {
    await fetch(`/api/clubs/${id}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId }),
    });
    fetchClub();
  };

  const removeMember = async (playerId: string) => {
    if (!confirm("Remove this member?")) return;
    await fetch(`/api/clubs/${id}/members`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId }),
    });
    fetchClub();
  };

  const updateRole = async (playerId: string, role: string) => {
    await fetch(`/api/clubs/${id}/members`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId, role }),
    });
    fetchClub();
  };

  const saveEdit = async () => {
    await fetch(`/api/clubs/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName, emoji: editEmoji }),
    });
    setEditing(false);
    fetchClub();
  };

  const deleteClub = async () => {
    if (!confirm("Delete this club? This cannot be undone.")) return;
    await fetch(`/api/clubs/${id}`, { method: "DELETE" });
    router.push("/clubs");
  };

  if (loading || !club) {
    return <div className="text-center py-12 text-muted">Loading...</div>;
  }

  const nonMembers = allPlayers
    .filter((p) => !club.members.some((m) => m.playerId === p.id))
    .filter((p) => !memberSearch || p.name.toLowerCase().includes(memberSearch.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="space-y-4">
      {/* Header */}
      <button onClick={() => router.push("/clubs")} className="text-primary text-sm font-medium">
        ← Clubs
      </button>

      {editing ? (
        <div className="bg-card rounded-xl border border-border p-4 space-y-3">
          <input
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            className="w-full border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50 text-lg font-bold"
          />
          <div className="flex flex-wrap gap-2">
            {EMOJIS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => setEditEmoji(e)}
                className={`text-2xl p-1 rounded-lg transition-all ${
                  editEmoji === e ? "bg-primary/10 ring-2 ring-primary scale-110" : "hover:bg-gray-100"
                }`}
              >
                {e}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={saveEdit} className="flex-1 bg-primary text-white py-2 rounded-lg text-sm font-medium">Save</button>
            <button onClick={() => setEditing(false)} className="flex-1 bg-gray-100 py-2 rounded-lg text-sm font-medium">Cancel</button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <span className="text-4xl">{club.emoji}</span>
          <div className="flex-1">
            <h2 className="text-xl font-bold">{club.name}</h2>
            <p className="text-sm text-muted">
              {club.members.length} member{club.members.length !== 1 ? "s" : ""} &middot;{" "}
              {club._count.events} event{club._count.events !== 1 ? "s" : ""}
            </p>
          </div>
          {canManage && (
            <button
              onClick={() => { setEditName(club.name); setEditEmoji(club.emoji); setEditing(true); }}
              className="text-xs text-primary px-2 py-1 rounded bg-primary/10"
            >
              Edit
            </button>
          )}
        </div>
      )}

      {/* Members */}
      <div className="bg-card rounded-xl border border-border p-4 space-y-3">
        <h3 className="text-sm font-medium text-muted">Members ({club.members.length})</h3>
        <div className="space-y-1">
          {club.members.map((m) => (
            <div key={m.id} className="flex items-center gap-3 p-2.5 rounded-lg">
              <span className="text-xl">{m.player.emoji}</span>
              <span className="font-medium flex-1">{m.player.name}</span>
              {m.player.phone && (
                <a
                  href={`https://wa.me/${m.player.phone.replace(/[^0-9+]/g, "").replace(/^\+/, "")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-green-500 text-sm"
                  onClick={(e) => e.stopPropagation()}
                >
                  💬
                </a>
              )}
              <span className="text-[10px] bg-gray-100 text-muted px-1.5 py-0.5 rounded-full font-medium capitalize">
                {m.role}
              </span>
              {canManage && m.role !== "owner" && m.playerId !== userId && (
                <div className="flex gap-1">
                  <select
                    value={m.role}
                    onChange={(e) => updateRole(m.playerId, e.target.value)}
                    className="text-xs border border-border rounded px-1 py-0.5"
                  >
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                  <button
                    onClick={() => removeMember(m.playerId)}
                    className="text-xs text-danger px-1.5 py-0.5 rounded hover:bg-red-50"
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Add member */}
        {canManage && (
          !showAddMember ? (
            <button
              onClick={() => { fetchAllPlayers(); setShowAddMember(true); setMemberSearch(""); }}
              className="w-full py-2.5 rounded-lg text-sm font-medium text-primary border border-primary/30 hover:bg-primary/5 transition-all"
            >
              + Add Member
            </button>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium text-muted">Add Member</h4>
                <button onClick={() => setShowAddMember(false)} className="text-xs text-muted px-2 py-1 rounded bg-gray-100">Close</button>
              </div>
              <input
                type="text"
                value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
                placeholder="Search by name..."
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {nonMembers.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => addMember(p.id)}
                    className="w-full text-left py-2.5 px-3 rounded-lg hover:bg-gray-50 active:bg-gray-100 flex items-center gap-2 transition-colors"
                  >
                    <span className="text-xl">{p.emoji}</span>
                    <span className="text-sm font-medium flex-1">{p.name}</span>
                    {p.gender && (
                      <span className={`text-xs ${p.gender === "M" ? "text-blue-500" : "text-pink-500"}`}>
                        {p.gender === "M" ? "♂" : "♀"}
                      </span>
                    )}
                    <span className="text-xs text-primary">+ Add</span>
                  </button>
                ))}
                {nonMembers.length === 0 && (
                  <p className="text-center py-4 text-muted text-sm">No players to add</p>
                )}
              </div>
            </div>
          )
        )}
      </div>

      {/* WhatsApp Groups */}
      {club.whatsappGroups.length > 0 && (
        <div className="bg-card rounded-xl border border-border p-4 space-y-2">
          <h3 className="text-sm font-medium text-muted">WhatsApp Groups</h3>
          {club.whatsappGroups.map((g) => (
            <div key={g.id} className="flex items-center gap-2 p-2 rounded-lg">
              <span>💬</span>
              <span className="text-sm font-medium">{g.name}</span>
            </div>
          ))}
        </div>
      )}

      {/* Delete club */}
      {isOwner && (
        <button
          onClick={deleteClub}
          className="w-full py-3 text-sm text-danger font-medium rounded-xl border border-red-200 hover:bg-red-50 active:bg-red-100 transition-colors"
        >
          Delete Club
        </button>
      )}
    </div>
  );
}
