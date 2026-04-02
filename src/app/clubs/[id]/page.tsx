"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";

interface Player {
  id: string;
  name: string;
  emoji: string;
  rating: number;
  gender?: string | null;
  phone?: string | null;
  wins: number;
  losses: number;
  role?: string;
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

interface EventInfo {
  id: string;
  name: string;
  date: string;
  endDate: string | null;
  status: string;
  numCourts: number;
  format: string;
  clubId: string | null;
  players: { playerId: string; player: { name: string; emoji: string } }[];
  _count: { matches: number };
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

type Tab = "events" | "members" | "rankings" | "settings";

export default function ClubDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const isAdmin = session?.user?.role === "admin";

  const [club, setClub] = useState<Club | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("events");
  const [events, setEvents] = useState<EventInfo[]>([]);
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
    setClub(await r.json());
    setLoading(false);
  }, [id, router]);

  const fetchEvents = useCallback(async () => {
    const r = await fetch("/api/events");
    if (r.ok) {
      const all = await r.json();
      setEvents(all.filter((e: EventInfo) => e.clubId === id));
    }
  }, [id]);

  useEffect(() => {
    fetchClub();
    fetchEvents();
  }, [fetchClub, fetchEvents]);

  const myMembership = club?.members.find((m) => m.playerId === userId);
  const canManage = myMembership?.role === "owner" || myMembership?.role === "admin" || isAdmin;
  const isOwner = myMembership?.role === "owner" || isAdmin;

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

  // Rankings: only club members, sorted by rating
  const rankings = useMemo(() => {
    if (!club) return { ranked: [], unranked: [] };
    const members = club.members.map((m) => m.player);
    return {
      ranked: members.filter((p) => p.wins + p.losses > 0).sort((a, b) => b.rating - a.rating),
      unranked: members.filter((p) => p.wins + p.losses === 0).sort((a, b) => a.name.localeCompare(b.name)),
    };
  }, [club]);

  const nonMembers = allPlayers
    .filter((p) => !club?.members.some((m) => m.playerId === p.id))
    .filter((p) => !memberSearch || p.name.toLowerCase().includes(memberSearch.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (loading || !club) {
    return <div className="text-center py-12 text-muted">Loading...</div>;
  }

  const getMedal = (i: number) => {
    if (i === 0) return "🥇";
    if (i === 1) return "🥈";
    if (i === 2) return "🥉";
    return `#${i + 1}`;
  };

  function getTimeStatus(event: EventInfo): "past" | "active" | "upcoming" {
    const now = new Date();
    const start = new Date(event.date);
    const end = event.endDate ? new Date(event.endDate) : null;
    if (end && now > end) return "past";
    if (now >= start && (!end || now <= end)) return "active";
    return "upcoming";
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: "events", label: "Events" },
    { key: "members", label: `Members (${club.members.length})` },
    { key: "rankings", label: "Rankings" },
    ...(canManage ? [{ key: "settings" as Tab, label: "Settings" }] : []),
  ];

  return (
    <div className="space-y-4">
      {/* Tab bar is the first thing — club name is in the header */}

      {/* Tab bar */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${
              tab === t.key
                ? "bg-white text-foreground shadow-sm"
                : "text-muted hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Events Tab ── */}
      {tab === "events" && (
        <div className="space-y-3">
          {canManage && (
            <Link
              href={`/events/new?clubId=${id}`}
              className="block w-full py-3 text-center rounded-xl text-sm font-semibold text-white bg-primary active:bg-primary-dark transition-colors shadow-sm"
            >
              + New Event
            </Link>
          )}

          {events.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted">No events yet</p>
            </div>
          ) : (
            events.map((event) => {
              const ts = getTimeStatus(event);
              const borderColor = ts === "active" ? "border-l-green-500" : ts === "upcoming" ? "border-l-blue-400" : "border-l-gray-300";
              return (
                <Link
                  key={event.id}
                  href={`/events/${event.id}`}
                  className={`block bg-card rounded-xl border border-border border-l-4 ${borderColor} p-4 active:bg-gray-50 transition-colors`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold">{event.name}</h3>
                      <p className="text-sm text-muted">
                        {new Date(event.date).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                        {" "}&middot; {event.players.length} players &middot; {event._count.matches} matches
                      </p>
                    </div>
                    <span className="text-xl text-muted">›</span>
                  </div>
                </Link>
              );
            })
          )}
        </div>
      )}

      {/* ── Members Tab ── */}
      {tab === "members" && (
        <div className="space-y-3">
          <div className="space-y-1">
            {club.members
              .sort((a, b) => a.player.name.localeCompare(b.player.name))
              .map((m) => (
              <div key={m.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-card border border-border">
                <span className="text-xl">{m.player.emoji}</span>
                <span className="font-medium flex-1 text-sm">{m.player.name}</span>
                {m.player.gender && (
                  <span className={`text-xs ${m.player.gender === "M" ? "text-blue-500" : "text-pink-500"}`}>
                    {m.player.gender === "M" ? "♂" : "♀"}
                  </span>
                )}
                {m.player.phone && (isAdmin || m.playerId === userId) && (
                  <a
                    href={`https://wa.me/${m.player.phone.replace(/[^0-9+]/g, "").replace(/^\+/, "")}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-green-500 text-sm"
                  >
                    💬
                  </a>
                )}
                <span className="text-[10px] bg-gray-100 text-muted px-1.5 py-0.5 rounded-full font-medium capitalize">
                  {m.role}
                </span>
                <span className="text-xs text-muted">{Math.round(m.player.rating)}</span>
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

          {canManage && (
            !showAddMember ? (
              <button
                onClick={() => { fetchAllPlayers(); setShowAddMember(true); setMemberSearch(""); }}
                className="w-full py-2.5 rounded-lg text-sm font-medium text-primary border border-primary/30 hover:bg-primary/5 transition-all"
              >
                + Add Member
              </button>
            ) : (
              <div className="bg-card rounded-xl border border-border p-3 space-y-2">
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
      )}

      {/* ── Rankings Tab ── */}
      {tab === "rankings" && (
        <div className="space-y-2">
          {rankings.ranked.length === 0 ? (
            <div className="text-center py-8">
              <div className="text-4xl mb-2">🏆</div>
              <p className="text-muted">No ranked players yet</p>
              <p className="text-sm text-muted">Play some matches!</p>
            </div>
          ) : (
            rankings.ranked.map((p, i) => (
              <div
                key={p.id}
                className={`bg-card rounded-xl border p-3 flex items-center gap-3 ${
                  i === 0 ? "border-yellow-400 bg-yellow-50" :
                  i === 1 ? "border-gray-300 bg-gray-50" :
                  i === 2 ? "border-amber-600/30 bg-amber-50" : "border-border"
                }`}
              >
                <span className="text-xl w-8 text-center font-bold">{getMedal(i)}</span>
                <span className="text-xl">{p.emoji}</span>
                <div className="flex-1 min-w-0">
                  <span className="font-semibold text-sm truncate block">{p.name}</span>
                  <span className="text-xs text-muted">{p.wins}W / {p.losses}L</span>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold text-primary">{Math.round(p.rating)}</div>
                </div>
              </div>
            ))
          )}

          {rankings.unranked.length > 0 && (
            <>
              <h3 className="text-xs font-medium text-muted mt-4">Unranked ({rankings.unranked.length})</h3>
              {rankings.unranked.map((p) => (
                <div key={p.id} className="bg-card rounded-xl border border-border p-3 flex items-center gap-3 opacity-50">
                  <span className="text-xl w-8 text-center">-</span>
                  <span className="text-xl">{p.emoji}</span>
                  <span className="font-medium text-sm flex-1">{p.name}</span>
                  <span className="text-sm text-muted">1000</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* ── Settings Tab ── */}
      {tab === "settings" && canManage && (
        <div className="space-y-4">
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
            <button
              onClick={() => { setEditName(club.name); setEditEmoji(club.emoji); setEditing(true); }}
              className="w-full bg-card rounded-xl border border-border p-4 text-left active:bg-gray-50 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-semibold">Club Name & Icon</span>
                  <p className="text-sm text-muted">{club.emoji} {club.name}</p>
                </div>
                <span className="text-xl text-muted">›</span>
              </div>
            </button>
          )}

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

          {isOwner && (
            <button
              onClick={deleteClub}
              className="w-full py-3 text-sm text-danger font-medium rounded-xl border border-red-200 hover:bg-red-50 active:bg-red-100 transition-colors"
            >
              Delete Club
            </button>
          )}
        </div>
      )}
    </div>
  );
}
