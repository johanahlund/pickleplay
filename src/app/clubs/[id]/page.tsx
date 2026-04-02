"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
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

interface WaGroup { id: string; name: string }

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

// ── Swipeable Member Row ──
function SwipeableMemberRow({
  member,
  canManage,
  isOwner,
  isSelf,
  showContact,
  onRemove,
  onRoleChange,
}: {
  member: ClubMember;
  canManage: boolean;
  isOwner: boolean;
  isSelf: boolean;
  showContact: boolean;
  onRemove: () => void;
  onRoleChange: (role: string) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const swipeOffset = useRef(0);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (!canManage || member.role === "owner" || isSelf) return;
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    swipeOffset.current = 0;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!canManage || member.role === "owner" || isSelf) return;
    const dx = e.touches[0].clientX - touchStartX.current;
    const dy = e.touches[0].clientY - touchStartY.current;
    if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) return;
    if (dx < 0) {
      swipeOffset.current = dx;
      if (rowRef.current) {
        rowRef.current.style.transform = `translateX(${Math.max(dx, -100)}px)`;
      }
    }
  };

  const handleTouchEnd = () => {
    if (swipeOffset.current < -80 && canManage && member.role !== "owner" && !isSelf) {
      if (confirm(`Remove ${member.player.name} from this club?`)) {
        if (confirm(`Are you sure? This will remove ${member.player.name} permanently.`)) {
          onRemove();
          return;
        }
      }
    }
    if (rowRef.current) rowRef.current.style.transform = "";
    swipeOffset.current = 0;
  };

  const p = member.player;

  return (
    <div
      ref={rowRef}
      className="flex items-center gap-2 px-3 py-2 rounded-lg transition-transform select-none bg-card border border-border"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <span className="text-lg w-8 text-center">{p.emoji}</span>
      <span className="font-medium text-sm flex-1 min-w-0 truncate">{p.name}</span>
      {p.gender && (
        <span className={`text-xs w-4 text-center ${p.gender === "M" ? "text-blue-500" : "text-pink-500"}`}>
          {p.gender === "M" ? "♂" : "♀"}
        </span>
      )}
      {p.phone && showContact && (
        <a
          href={`https://wa.me/${p.phone.replace(/[^0-9+]/g, "").replace(/^\+/, "")}`}
          target="_blank" rel="noopener noreferrer"
          className="text-green-500 text-sm w-6 text-center"
          onClick={(e) => e.stopPropagation()}
        >💬</a>
      )}
      <span className="text-xs text-muted w-10 text-right tabular-nums">{Math.round(p.rating)}</span>
      <span className="text-xs text-muted w-12 text-right tabular-nums">{p.wins}W {p.losses}L</span>
      {canManage && member.role !== "owner" && !isSelf ? (
        <select
          value={member.role}
          onChange={(e) => onRoleChange(e.target.value)}
          className="text-[10px] border border-border rounded px-1 py-0.5 w-16 bg-white"
          onClick={(e) => e.stopPropagation()}
        >
          <option value="member">Member</option>
          <option value="admin">Admin</option>
          {isOwner && <option value="owner">Owner</option>}
        </select>
      ) : (
        <span className="text-[10px] bg-gray-100 text-muted px-1.5 py-0.5 rounded-full font-medium capitalize w-16 text-center">
          {member.role}
        </span>
      )}
    </div>
  );
}

// ── Date filter logic ──
function matchesDateFilter(dateStr: string, filter: string) {
  if (filter === "all") return true;
  const eventDate = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const DAY = 86400000;
  if (filter === "past7") return eventDate >= new Date(today.getTime() - 7 * DAY) && eventDate < today;
  if (filter === "today") return eventDate >= today && eventDate < new Date(today.getTime() + DAY);
  if (filter === "tomorrow") { const t = new Date(today.getTime() + DAY); return eventDate >= t && eventDate < new Date(t.getTime() + DAY); }
  if (filter === "next7") return eventDate >= today && eventDate < new Date(today.getTime() + 7 * DAY);
  if (filter === "next30") return eventDate >= today && eventDate < new Date(today.getTime() + 30 * DAY);
  return true;
}

function getTimeStatus(event: EventInfo): "past" | "active" | "upcoming" {
  const now = new Date();
  const start = new Date(event.date);
  const end = event.endDate ? new Date(event.endDate) : null;
  if (end && now > end) return "past";
  if (now >= start && (!end || now <= end)) return "active";
  return "upcoming";
}

export default function ClubDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const isGlobalAdmin = session?.user?.role === "admin";

  const [club, setClub] = useState<Club | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("events");
  const [events, setEvents] = useState<EventInfo[]>([]);
  const [allPlayers, setAllPlayers] = useState<Player[]>([]);
  const [showAddMember, setShowAddMember] = useState(false);
  const [addMemberSearch, setAddMemberSearch] = useState("");
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editEmoji, setEditEmoji] = useState("");

  // Event filters
  const [eventSearch, setEventSearch] = useState("");
  const [dateFilter, setDateFilter] = useState("all");

  // Member filters
  const [memberSearch, setMemberSearch] = useState("");
  const [memberGender, setMemberGender] = useState<string | null>(null);

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

  useEffect(() => { fetchClub(); fetchEvents(); }, [fetchClub, fetchEvents]);

  const myMembership = club?.members.find((m) => m.playerId === userId);
  const canManage = myMembership?.role === "owner" || myMembership?.role === "admin" || isGlobalAdmin;
  const isOwner = myMembership?.role === "owner" || isGlobalAdmin;

  const fetchAllPlayers = async () => {
    if (allPlayers.length > 0) return;
    const r = await fetch("/api/players");
    if (r.ok) setAllPlayers(await r.json());
  };

  const addMember = async (playerId: string) => {
    await fetch(`/api/clubs/${id}/members`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ playerId }) });
    fetchClub();
  };

  const removeMember = async (playerId: string) => {
    await fetch(`/api/clubs/${id}/members`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ playerId }) });
    fetchClub();
  };

  const updateRole = async (playerId: string, role: string) => {
    await fetch(`/api/clubs/${id}/members`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ playerId, role }) });
    fetchClub();
  };

  const saveEdit = async () => {
    await fetch(`/api/clubs/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: editName, emoji: editEmoji }) });
    setEditing(false);
    fetchClub();
  };

  const deleteClub = async () => {
    if (!confirm("Delete this club? This cannot be undone.")) return;
    await fetch(`/api/clubs/${id}`, { method: "DELETE" });
    router.push("/clubs");
  };

  // Filtered events
  const filteredEvents = useMemo(() => {
    return events
      .filter((e) => e.name.toLowerCase().includes(eventSearch.toLowerCase()))
      .filter((e) => matchesDateFilter(e.date, dateFilter));
  }, [events, eventSearch, dateFilter]);

  // Filtered members
  const filteredMembers = useMemo(() => {
    if (!club) return [];
    return club.members
      .filter((m) => !memberSearch || m.player.name.toLowerCase().includes(memberSearch.toLowerCase()))
      .filter((m) => !memberGender || m.player.gender === memberGender)
      .sort((a, b) => a.player.name.localeCompare(b.player.name));
  }, [club, memberSearch, memberGender]);

  // Rankings
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
    .filter((p) => !addMemberSearch || p.name.toLowerCase().includes(addMemberSearch.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (loading || !club) return <div className="text-center py-12 text-muted">Loading...</div>;

  const getMedal = (i: number) => i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`;

  const tabs: { key: Tab; label: string }[] = [
    { key: "events", label: "Events" },
    { key: "members", label: `Members` },
    { key: "rankings", label: "Rankings" },
    ...(canManage ? [{ key: "settings" as Tab, label: "Settings" }] : []),
  ];

  return (
    <div className="space-y-3">
      {/* Tab bar */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${
              tab === t.key ? "bg-white text-foreground shadow-sm" : "text-muted hover:text-foreground"
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

          <input
            type="text"
            value={eventSearch}
            onChange={(e) => setEventSearch(e.target.value)}
            placeholder="Search events..."
            className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          />

          <div className="flex flex-wrap gap-1.5">
            {[
              { value: "all", label: "All" },
              { value: "past7", label: "P7" },
              { value: "today", label: "Today" },
              { value: "tomorrow", label: "Tomorrow" },
              { value: "next7", label: "N7" },
              { value: "next30", label: "N30" },
            ].map((f) => (
              <button
                key={f.value}
                onClick={() => setDateFilter(f.value)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  dateFilter === f.value ? "bg-primary text-white" : "bg-gray-100 text-muted hover:bg-gray-200"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {filteredEvents.length === 0 ? (
            <div className="text-center py-8"><p className="text-muted text-sm">No events found</p></div>
          ) : (
            filteredEvents.map((event) => {
              const ts = getTimeStatus(event);
              const borderColor = ts === "active" ? "border-l-green-500" : ts === "upcoming" ? "border-l-blue-400" : "border-l-gray-300";
              const cardOpacity = ts === "past" ? "opacity-60" : "";
              return (
                <Link
                  key={event.id}
                  href={`/events/${event.id}`}
                  className={`block bg-card rounded-xl border border-border border-l-4 ${borderColor} ${cardOpacity} p-3 active:bg-gray-50 transition-colors`}
                >
                  <div className="flex items-center gap-3">
                    <div className="text-center min-w-[44px]">
                      <div className="text-xs text-muted uppercase">{new Date(event.date).toLocaleDateString(undefined, { month: "short" })}</div>
                      <div className="text-xl font-bold leading-tight">{new Date(event.date).getDate()}</div>
                      <div className="text-[10px] text-muted">{new Date(event.date).toLocaleDateString(undefined, { weekday: "short" })}</div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-sm flex items-center gap-2 truncate">
                        {event.name}
                        {ts === "active" && <span className="inline-block w-2 h-2 rounded-full bg-green-500 animate-pulse" />}
                      </h3>
                      <p className="text-xs text-muted">
                        {event.players.length} players &middot; {event._count.matches} matches &middot; {event.format}
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
          {/* Filters */}
          <div className="flex gap-2">
            <input
              type="text"
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
              placeholder="Search members..."
              className="flex-1 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            {(["M", "F"] as const).map((g) => (
              <button
                key={g}
                onClick={() => setMemberGender(memberGender === g ? null : g)}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                  memberGender === g ? "bg-primary text-white" : "bg-gray-100 text-foreground hover:bg-gray-200"
                }`}
              >
                {g === "M" ? "♂" : "♀"}
              </button>
            ))}
          </div>

          <p className="text-xs text-muted">{filteredMembers.length} member{filteredMembers.length !== 1 ? "s" : ""}{canManage ? " · swipe left to remove" : ""}</p>

          {/* Column header */}
          <div className="flex items-center gap-2 px-3 py-1 text-[10px] text-muted uppercase tracking-wider">
            <span className="w-8" />
            <span className="flex-1">Name</span>
            <span className="w-4" />
            <span className="w-6" />
            <span className="w-10 text-right">Rating</span>
            <span className="w-12 text-right">W/L</span>
            <span className="w-16 text-center">Role</span>
          </div>

          <div className="space-y-1">
            {filteredMembers.map((m) => (
              <SwipeableMemberRow
                key={m.id}
                member={m}
                canManage={canManage}
                isOwner={isOwner}
                isSelf={m.playerId === userId}
                showContact={isGlobalAdmin || m.playerId === userId}
                onRemove={() => removeMember(m.playerId)}
                onRoleChange={(role) => updateRole(m.playerId, role)}
              />
            ))}
          </div>

          {canManage && (
            !showAddMember ? (
              <button
                onClick={() => { fetchAllPlayers(); setShowAddMember(true); setAddMemberSearch(""); }}
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
                  value={addMemberSearch}
                  onChange={(e) => setAddMemberSearch(e.target.value)}
                  placeholder="Search by name..."
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                <div className="space-y-1 max-h-64 overflow-y-auto">
                  {nonMembers.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => addMember(p.id)}
                      className="w-full text-left py-2 px-3 rounded-lg hover:bg-gray-50 active:bg-gray-100 flex items-center gap-2 transition-colors"
                    >
                      <span className="text-lg">{p.emoji}</span>
                      <span className="text-sm font-medium flex-1">{p.name}</span>
                      {p.gender && (
                        <span className={`text-xs ${p.gender === "M" ? "text-blue-500" : "text-pink-500"}`}>
                          {p.gender === "M" ? "♂" : "♀"}
                        </span>
                      )}
                      <span className="text-xs text-primary">+ Add</span>
                    </button>
                  ))}
                  {nonMembers.length === 0 && <p className="text-center py-4 text-muted text-sm">No players to add</p>}
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
                  <span className="text-xs text-muted">{p.wins}W / {p.losses}L &middot; {p.wins + p.losses > 0 ? Math.round((p.wins / (p.wins + p.losses)) * 100) : 0}%</span>
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
                type="text" value={editName} onChange={(e) => setEditName(e.target.value)}
                className="w-full border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50 text-lg font-bold"
              />
              <div className="flex flex-wrap gap-2">
                {EMOJIS.map((e) => (
                  <button key={e} type="button" onClick={() => setEditEmoji(e)}
                    className={`text-2xl p-1 rounded-lg transition-all ${editEmoji === e ? "bg-primary/10 ring-2 ring-primary scale-110" : "hover:bg-gray-100"}`}
                  >{e}</button>
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
