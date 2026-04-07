"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useViewRole, hasRole } from "@/components/RoleToggle";
import Link from "next/link";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { ClearInput } from "@/components/ClearInput";

// ── Long press to delete ──
function LongPressDelete({ children, canDelete, onDelete, confirmMessage }: { children: React.ReactNode; canDelete: boolean; onDelete: () => void; confirmMessage: string }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const moved = useRef(false);
  const [pressing, setPressing] = useState(false);

  const onTouchStart = () => {
    if (!canDelete) return;
    moved.current = false;
    setPressing(true);
    timer.current = setTimeout(() => {
      if (!moved.current) {
        setPressing(false);
        if (navigator.vibrate) navigator.vibrate(50);
        if (confirm(confirmMessage)) onDelete();
      }
    }, 600);
  };
  const onTouchMove = () => {
    moved.current = true;
    setPressing(false);
    if (timer.current) clearTimeout(timer.current);
  };
  const onTouchEnd = () => {
    setPressing(false);
    if (timer.current) clearTimeout(timer.current);
  };

  return (
    <div
      className={`group/lp relative select-none rounded-xl transition-all duration-200 ${pressing ? "ring-2 ring-danger/50 bg-red-50/50 scale-[0.98]" : ""}`}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onContextMenu={(e) => { if (canDelete) e.preventDefault(); }}
    >
      {children}
      {/* Desktop hover delete button */}
      {canDelete && (
        <button
          onClick={(e) => { e.stopPropagation(); if (confirm(confirmMessage)) onDelete(); }}
          className="absolute top-2 right-2 hidden group-hover/lp:block text-xs px-2 py-1 rounded-lg bg-red-50 text-danger hover:bg-red-100 opacity-0 group-hover/lp:opacity-100 transition-opacity shadow-sm"
        >
          Delete
        </button>
      )}
    </div>
  );
}

interface Player {
  id: string;
  name: string;
  emoji: string;
  rating: number;
  gender?: string | null;
  phone?: string | null;
  photoUrl?: string | null;
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

interface PostAuthor { id: string; name: string; emoji: string; photoUrl?: string | null }
interface Comment { id: string; authorId: string; content: string; createdAt: string; author: PostAuthor }
interface Post { id: string; content: string; createdAt: string; author: PostAuthor; comments: Comment[]; _count: { comments: number } }

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

interface ClubLocation { id: string; name: string; googleMapsUrl?: string | null }

interface Club {
  id: string;
  name: string;
  emoji: string;
  logoUrl?: string | null;
  coverUrl?: string | null;
  description?: string | null;
  city?: string | null;
  country?: string | null;
  createdById: string | null;
  members: ClubMember[];
  whatsappGroups: WaGroup[];
  locations: ClubLocation[];
  _count: { events: number };
}

type Tab = "feed" | "events" | "members" | "rankings";

// ── Role Pill ──
const ROLE_COLORS: Record<string, string> = {
  owner: "bg-purple-100 text-purple-700",
  admin: "bg-blue-100 text-blue-700",
  member: "bg-gray-100 text-muted",
};

function RolePill({ role, canChange, onChange }: { role: string; canChange: boolean; onChange: (role: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const roles = ["member", "admin", "owner"];

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative w-16" ref={ref}>
      <button
        onClick={(e) => { e.stopPropagation(); if (canChange) setOpen(!open); }}
        className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium capitalize w-full text-center ${ROLE_COLORS[role] || ROLE_COLORS.member} ${canChange ? "cursor-pointer" : ""}`}
      >
        {role}
      </button>
      {open && (
        <div className="absolute right-0 top-6 bg-white rounded-lg shadow-xl border border-border z-50 overflow-hidden min-w-[100px]">
          {roles.map((r) => (
            <button key={r} onClick={(e) => {
              e.stopPropagation();
              if (r === role) { setOpen(false); return; }
              if (r === "owner" ? confirm("Transfer ownership? You will become admin.") : confirm(`Change role to ${r}?`)) {
                onChange(r);
              }
              setOpen(false);
            }}
              className={`w-full text-left px-3 py-1.5 text-xs capitalize hover:bg-gray-50 ${role === r ? "font-bold" : ""}`}>
              {r} {role === r ? "✓" : ""}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

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
      className="group flex items-center gap-2 px-3 py-2 rounded-lg transition-transform select-none bg-card border border-border"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <PlayerAvatar name={p.name} photoUrl={p.photoUrl} size="xs" />
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
      <RolePill role={member.role} canChange={!!(isOwner && member.role !== "owner" && !isSelf)} onChange={onRoleChange} />
      {/* Desktop hover action */}
      {canManage && member.role !== "owner" && !isSelf && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (confirm(`Remove ${p.name} from this club?`)) {
              if (confirm(`Are you sure? This will remove ${p.name} permanently.`)) {
                onRemove();
              }
            }
          }}
          className="hidden group-hover:block text-xs px-2 py-1 rounded bg-red-50 text-danger hover:bg-red-100 opacity-0 group-hover:opacity-100 transition-opacity"
          title="Remove member"
        >
          Remove
        </button>
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
  const { viewRole } = useViewRole();
  const isGlobalAdmin = session?.user?.role === "admin" && hasRole(viewRole, "admin");

  const [club, setClub] = useState<Club | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const t = params.get("tab");
      if (t && ["feed", "events", "members", "rankings"].includes(t)) return t as Tab;
    }
    return "feed";
  });

  // Sync tab from URL on every render (covers soft navigation from header tabs)
  useEffect(() => {
    const check = () => {
      const params = new URLSearchParams(window.location.search);
      const t = params.get("tab");
      if (t && ["feed", "events", "members", "rankings"].includes(t)) {
        setTab((prev) => prev !== t ? t as Tab : prev);
      }
    };
    check();
    // Also listen for popstate (back/forward)
    window.addEventListener("popstate", check);
    return () => window.removeEventListener("popstate", check);
  });
  const [events, setEvents] = useState<EventInfo[]>([]);
  const [allPlayers, setAllPlayers] = useState<Player[]>([]);
  const [showAddMember, setShowAddMember] = useState(false);
  const [addMemberSearch, setAddMemberSearch] = useState("");
  const [showInfo, setShowInfo] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editEmoji, setEditEmoji] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editCity, setEditCity] = useState("");
  const [editCountry, setEditCountry] = useState("");
  const [editLocations, setEditLocations] = useState<{ name: string; googleMapsUrl: string }[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [newPostContent, setNewPostContent] = useState("");
  const [postingComment, setPostingComment] = useState<string | null>(null);
  const [commentContent, setCommentContent] = useState("");
  const [expandedPost, setExpandedPost] = useState<string | null>(null);

  // Join requests
  const [joinRequests, setJoinRequests] = useState<{ id: string; playerId: string; status: string; message?: string | null; createdAt: string; player: { id: string; name: string; emoji: string; gender?: string | null; rating: number } }[]>([]);

  // Event filters
  const [eventSearch, setEventSearch] = useState("");
  const [dateFilter, setDateFilter] = useState("all");
  const [visiblePast, setVisiblePast] = useState(12);
  const [visibleFuture, setVisibleFuture] = useState(13);
  const todayRef = useRef<HTMLDivElement>(null);
  const [scrolledToToday, setScrolledToToday] = useState(false);

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

  const fetchPosts = useCallback(async () => {
    const r = await fetch(`/api/clubs/${id}/posts`);
    if (r.ok) setPosts(await r.json());
  }, [id]);

  useEffect(() => { fetchClub(); fetchEvents(); fetchPosts(); }, [fetchClub, fetchEvents, fetchPosts]);

  const myMembership = club?.members.find((m) => m.playerId === userId);
  const canManage = hasRole(viewRole, "club") && (myMembership?.role === "owner" || myMembership?.role === "admin" || isGlobalAdmin);
  const isOwner = hasRole(viewRole, "club") && (myMembership?.role === "owner" || isGlobalAdmin);

  // Fetch join requests for managers
  useEffect(() => {
    if (!canManage || !club) return;
    fetch(`/api/clubs/${club.id}/join-request`).then((r) => r.ok ? r.json() : []).then(setJoinRequests);
  }, [canManage, club?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
    await fetch(`/api/clubs/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editName,
        emoji: editEmoji,
        description: editDescription,
        city: editCity,
        country: editCountry,
        locations: editLocations.filter((l) => l.name.trim()),
      }),
    });
    setEditing(false);
    fetchClub();
  };

  const startEditing = () => {
    if (!club) return;
    setEditName(club.name);
    setEditEmoji(club.emoji);
    setEditDescription(club.description || "");
    setEditCity(club.city || "");
    setEditCountry(club.country || "");
    setEditLocations(
      club.locations.length > 0
        ? club.locations.map((l) => ({ name: l.name, googleMapsUrl: l.googleMapsUrl || "" }))
        : [{ name: "", googleMapsUrl: "" }]
    );
    setEditing(true);
  };

  const deleteClub = async () => {
    if (!confirm("Delete this club? This cannot be undone.")) return;
    await fetch(`/api/clubs/${id}`, { method: "DELETE" });
    router.push("/clubs");
  };

  // Filtered events — sorted by date ascending
  const filteredEvents = useMemo(() => {
    return events
      .filter((e) => e.name.toLowerCase().includes(eventSearch.toLowerCase()))
      .filter((e) => matchesDateFilter(e.date, dateFilter))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [events, eventSearch, dateFilter]);

  // Split into past and upcoming for "All" view windowing
  const todayStart = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  }, []);

  const { pastEvents, todayAndFutureEvents, windowedEvents, hasMorePast, hasMoreFuture } = useMemo(() => {
    if (dateFilter !== "all") {
      return { pastEvents: [], todayAndFutureEvents: [], windowedEvents: filteredEvents, hasMorePast: false, hasMoreFuture: false };
    }
    const past = filteredEvents.filter((e) => new Date(e.date).getTime() < todayStart);
    const future = filteredEvents.filter((e) => new Date(e.date).getTime() >= todayStart);

    const visiblePastSlice = past.slice(Math.max(0, past.length - visiblePast));
    const visibleFutureSlice = future.slice(0, visibleFuture);

    return {
      pastEvents: past,
      todayAndFutureEvents: future,
      windowedEvents: [...visiblePastSlice, ...visibleFutureSlice],
      hasMorePast: past.length > visiblePast,
      hasMoreFuture: future.length > visibleFuture,
    };
  }, [filteredEvents, dateFilter, todayStart, visiblePast, visibleFuture]);

  // Scroll to today marker when "All" events load
  useEffect(() => {
    if (dateFilter === "all" && todayRef.current && !scrolledToToday && windowedEvents.length > 0) {
      setTimeout(() => {
        todayRef.current?.scrollIntoView({ block: "start", behavior: "instant" });
        setScrolledToToday(true);
      }, 100);
    }
  }, [dateFilter, windowedEvents, scrolledToToday]);

  // Reset scroll state when switching filters
  useEffect(() => {
    setScrolledToToday(false);
    setVisiblePast(12);
    setVisibleFuture(13);
  }, [dateFilter]);

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

  // Portal the tab bar into the header and hide the fallback tabs
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const find = () => {
      const el = document.getElementById("club-tab-bar-portal");
      if (el) {
        setPortalTarget(el);
        // Hide the fallback tabs
        const fallback = document.getElementById("club-tab-bar-fallback");
        if (fallback) fallback.style.display = "none";
        return;
      }
      setTimeout(find, 100);
    };
    find();
    return () => {
      // Show fallback again when leaving club page
      const fallback = document.getElementById("club-tab-bar-fallback");
      if (fallback) fallback.style.display = "";
    };
  }, []);

  if (loading || !club) return <div className="text-center py-12 text-muted">Loading...</div>;

  const getMedal = (i: number) => i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`;

  const tabs: { key: Tab; label: string }[] = [
    { key: "feed", label: "Feed" },
    { key: "events", label: "Events" },
    { key: "members", label: "Members" },
    { key: "rankings", label: "Rankings" },
  ];

  const createPost = async () => {
    if (!newPostContent.trim()) return;
    await fetch(`/api/clubs/${id}/posts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: newPostContent.trim() }),
    });
    setNewPostContent("");
    fetchPosts();
  };

  const deletePost = async (postId: string) => {
    await fetch(`/api/clubs/${id}/posts/${postId}`, { method: "DELETE" });
    fetchPosts();
  };

  const deleteComment = async (postId: string, commentId: string) => {
    await fetch(`/api/clubs/${id}/posts/${postId}/comments`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commentId }),
    });
    fetchPosts();
  };

  const addComment = async (postId: string) => {
    if (!commentContent.trim()) return;
    await fetch(`/api/clubs/${id}/posts/${postId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: commentContent.trim() }),
    });
    setCommentContent("");
    setPostingComment(null);
    fetchPosts();
  };

  function timeAgo(dateStr: string) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "now";
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d`;
    return new Date(dateStr).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  // (portal state moved before early return — see below)

  const tabBar = (
    <div className="flex items-center gap-2">
      <div className={`flex gap-1 ${portalTarget ? "bg-white/10" : "bg-gray-100"} rounded-xl p-1 flex-1`}>
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); setShowInfo(false); }}
            className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-all ${
              !showInfo && tab === t.key
                ? portalTarget ? "bg-white text-black shadow-sm" : "bg-white text-foreground shadow-sm"
                : portalTarget ? "text-white/70 hover:text-white" : "text-muted hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <button
        onClick={() => setShowInfo(!showInfo)}
        className={`w-8 h-8 rounded-xl flex items-center justify-center text-sm font-bold transition-all ${
          showInfo ? "bg-selected text-white" : portalTarget ? "bg-white/10 text-white/70 hover:text-white" : "bg-gray-100 text-muted hover:text-foreground"
          }`}
        >
          ℹ
        </button>
      </div>
  );

  return (
    <div className="space-y-3">
      {/* Tab bar — portaled into header if available, otherwise inline */}
      {portalTarget ? createPortal(tabBar, portalTarget) : tabBar}

      {/* ── Club Info Panel ── */}
      {showInfo && (
        <div className="space-y-4">
          {editing ? (
            <div className="bg-card rounded-xl border border-border p-4 space-y-3">
              <div>
                <label className="block text-sm font-medium text-muted mb-1">Club Name</label>
                <input
                  type="text" value={editName} onChange={(e) => setEditName(e.target.value)}
                  className="w-full border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted mb-1">Logo</label>
                <div className="flex items-center gap-3">
                  {club.logoUrl ? (
                    <img src={club.logoUrl} alt="Logo" className="w-16 h-16 rounded-xl object-cover" />
                  ) : (
                    <span className="text-4xl">{club.emoji}</span>
                  )}
                  <label className="text-xs text-action font-medium cursor-pointer hover:underline">
                    Upload logo
                    <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const fd = new FormData();
                      fd.append("file", file);
                      fd.append("type", "logo");
                      const r = await fetch(`/api/clubs/${club.id}/photo`, { method: "POST", body: fd });
                      if (r.ok) fetchClub();
                      else alert("Upload failed");
                    }} />
                  </label>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-muted mb-1">Cover Photo</label>
                <div>
                  {club.coverUrl && (
                    <img src={club.coverUrl} alt="Cover" className="w-full h-24 rounded-lg object-cover mb-2" />
                  )}
                  <label className="text-xs text-action font-medium cursor-pointer hover:underline">
                    {club.coverUrl ? "Change cover" : "Upload cover photo"}
                    <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const fd = new FormData();
                      fd.append("file", file);
                      fd.append("type", "cover");
                      const r = await fetch(`/api/clubs/${club.id}/photo`, { method: "POST", body: fd });
                      if (r.ok) fetchClub();
                      else alert("Upload failed");
                    }} />
                  </label>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-muted mb-1">City</label>
                  <input type="text" value={editCity} onChange={(e) => setEditCity(e.target.value)}
                    placeholder="e.g. Setúbal"
                    className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                </div>
                <div className="flex-1">
                  <label className="block text-sm font-medium text-muted mb-1">Country</label>
                  <input type="text" value={editCountry} onChange={(e) => setEditCountry(e.target.value)}
                    placeholder="e.g. Portugal"
                    className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-muted mb-1">Description</label>
                <textarea
                  value={editDescription} onChange={(e) => setEditDescription(e.target.value)}
                  rows={3} placeholder="Tell members about this club..."
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted mb-1">Locations</label>
                <div className="space-y-2">
                  {editLocations.map((loc, i) => (
                    <div key={i} className="flex gap-2 items-start">
                      <div className="flex-1 space-y-1">
                        <input
                          type="text" value={loc.name} placeholder="Location name"
                          onChange={(e) => {
                            const next = [...editLocations];
                            next[i] = { ...next[i], name: e.target.value };
                            setEditLocations(next);
                          }}
                          className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                        />
                        <input
                          type="url" value={loc.googleMapsUrl} placeholder="Google Maps URL"
                          onChange={(e) => {
                            const next = [...editLocations];
                            next[i] = { ...next[i], googleMapsUrl: e.target.value };
                            setEditLocations(next);
                          }}
                          className="w-full border border-border rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary/50"
                        />
                      </div>
                      <button
                        onClick={() => setEditLocations(editLocations.filter((_, j) => j !== i))}
                        className="text-xs text-danger px-2 py-2 rounded hover:bg-red-50 mt-1"
                      >✕</button>
                    </div>
                  ))}
                  <button
                    onClick={() => setEditLocations([...editLocations, { name: "", googleMapsUrl: "" }])}
                    className="text-xs text-primary font-medium"
                  >+ Add Location</button>
                </div>
              </div>



              <div className="flex gap-2">
                <button onClick={saveEdit} className="flex-1 bg-action-dark text-white py-2 rounded-lg text-sm font-medium">Save</button>
                <button onClick={() => setEditing(false)} className="flex-1 bg-gray-100 py-2 rounded-lg text-sm font-medium">Cancel</button>
              </div>

              {isOwner && (
                <button onClick={deleteClub} className="w-full py-2 text-xs text-danger font-medium rounded-lg border border-red-200 hover:bg-red-50">
                  Delete Club
                </button>
              )}
            </div>
          ) : (
            <div className="bg-card rounded-xl border border-border overflow-hidden">
              {club.coverUrl && (
                <div className="h-32 w-full bg-gray-100">
                  <img src={club.coverUrl} alt="" className="w-full h-full object-cover" />
                </div>
              )}
              <div className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {club.logoUrl ? (
                    <img src={club.logoUrl} alt="" className="w-10 h-10 rounded-xl object-cover" />
                  ) : (
                    <span className="text-2xl">{club.emoji}</span>
                  )}
                  <div>
                    <h3 className="font-bold">{club.name}</h3>
                    <p className="text-xs text-muted">
                      {club.members.length} members &middot; {club._count.events} events
                      {club.city && ` &middot; ${club.city}`}
                      {club.country && !club.city && ` &middot; ${club.country}`}
                    </p>
                  </div>
                </div>
                {canManage && (
                  <button onClick={startEditing} className="text-xs text-primary px-2 py-1 rounded bg-primary/10">
                    Edit
                  </button>
                )}
              </div>

              {club.description && (
                <p className="text-sm whitespace-pre-wrap">{club.description}</p>
              )}

              {club.locations.length > 0 && (
                <div>
                  <h4 className="text-xs font-medium text-muted mb-1 uppercase tracking-wider">Locations</h4>
                  <div className="space-y-1">
                    {club.locations.map((loc) => (
                      <div key={loc.id} className="flex items-center gap-2 p-2 rounded-lg bg-gray-50">
                        <span className="text-sm">📍</span>
                        <span className="text-sm font-medium flex-1">{loc.name}</span>
                        {loc.googleMapsUrl && (
                          <a
                            href={loc.googleMapsUrl}
                            target="_blank" rel="noopener noreferrer"
                            className="text-xs text-primary font-medium"
                          >
                            Map →
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Feed Tab ── */}
      {tab === "feed" && !showInfo && (
        <div className="space-y-3">
          {/* Join requests alert */}
          {canManage && joinRequests.filter((r) => r.status === "pending").length > 0 && (
            <button onClick={() => setTab("members")}
              className="w-full bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-center gap-2 active:bg-amber-100">
              <span className="text-lg">👋</span>
              <span className="text-sm font-medium text-amber-800 flex-1 text-left">
                {joinRequests.filter((r) => r.status === "pending").length} pending join request{joinRequests.filter((r) => r.status === "pending").length !== 1 ? "s" : ""}
              </span>
              <span className="text-xs text-amber-600">View ›</span>
            </button>
          )}
          {/* New post */}
          <div className="bg-card rounded-xl border border-border p-3 space-y-2">
            <textarea
              value={newPostContent}
              onChange={(e) => setNewPostContent(e.target.value)}
              placeholder="Share something with the club..."
              rows={2}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
            />
            <div className="flex justify-end">
              <button
                onClick={createPost}
                disabled={!newPostContent.trim()}
                className="bg-action text-white px-4 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
              >
                Post
              </button>
            </div>
          </div>

          {posts.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted text-sm">No posts yet. Be the first!</p>
            </div>
          ) : (
            posts.map((post) => {
              const canDeletePost = post.author.id === userId || canManage;
              return (
                <LongPressDelete key={post.id} canDelete={canDeletePost} onDelete={() => deletePost(post.id)}
                  confirmMessage={`Delete this entire post by ${post.author.name}?\n\n"${post.content.slice(0, 80)}${post.content.length > 80 ? "..." : ""}"\n\n${post.comments.length > 0 ? `This will also delete ${post.comments.length} comment${post.comments.length !== 1 ? "s" : ""}.` : ""}This cannot be undone.`}>
                  <div className="bg-card rounded-xl border border-border p-3 space-y-2">
                    {/* Post header */}
                    <div className="flex items-center gap-2">
                      <PlayerAvatar name={post.author.name} photoUrl={post.author.photoUrl} size="sm" />
                      <div className="flex-1 min-w-0">
                        <span className="font-semibold text-sm">{post.author.name}</span>
                        <span className="text-xs text-muted ml-2">{timeAgo(post.createdAt)}</span>
                      </div>
                    </div>

                    {/* Post content */}
                    <p className="text-sm whitespace-pre-wrap">{post.content}</p>

                    {/* Comments */}
                    {post.comments.length > 0 && (
                      <div className="pl-4 border-l-2 border-gray-100 space-y-2 mt-2">
                        {(expandedPost === post.id ? post.comments : post.comments.slice(-2)).map((c) => {
                          const canDeleteComment = c.author.id === userId || canManage;
                          return (
                            <LongPressDelete key={c.id} canDelete={canDeleteComment} onDelete={() => deleteComment(post.id, c.id)}
                              confirmMessage={`Delete this comment by ${c.author.name}?\n\n"${c.content.slice(0, 80)}${c.content.length > 80 ? "..." : ""}"`}>
                              <div className="flex items-start gap-2">
                                <PlayerAvatar name={c.author.name} photoUrl={c.author.photoUrl} size="xs" />
                                <div className="flex-1 min-w-0">
                                  <span className="font-semibold text-xs">{c.author.name}</span>
                                  <span className="text-[10px] text-muted ml-1">{timeAgo(c.createdAt)}</span>
                                  <p className="text-xs">{c.content}</p>
                                </div>
                              </div>
                            </LongPressDelete>
                          );
                        })}
                        {post.comments.length > 2 && expandedPost !== post.id && (
                          <button
                            onClick={() => setExpandedPost(post.id)}
                            className="text-xs text-primary font-medium"
                          >
                            View all {post.comments.length} comments
                          </button>
                        )}
                      </div>
                    )}

                    {/* Add comment */}
                    {postingComment === post.id ? (
                      <div className="flex gap-2 mt-1">
                        <input
                          type="text"
                          value={commentContent}
                          onChange={(e) => setCommentContent(e.target.value)}
                          placeholder="Write a comment..."
                          className="flex-1 border border-border rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/50"
                          autoFocus
                          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); addComment(post.id); } }}
                        />
                        <button
                          onClick={() => addComment(post.id)}
                          disabled={!commentContent.trim()}
                          className="bg-action-dark text-white px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50"
                        >
                          Send
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setPostingComment(post.id); setCommentContent(""); }}
                        className="text-xs text-muted hover:text-foreground"
                      >
                        {post._count.comments > 0 ? "Reply" : "Comment"}
                      </button>
                    )}
                  </div>
                </LongPressDelete>
              );
            })
          )}
        </div>
      )}

      {/* ── Events Tab ── */}
      {tab === "events" && !showInfo && (
        <div className="space-y-3">
          {canManage && (
            <Link
              href={`/events/new?clubId=${id}`}
              className="block w-full py-3 text-center rounded-xl text-sm font-semibold text-white bg-primary active:bg-primary-dark transition-colors shadow-sm"
            >
              + New Event
            </Link>
          )}

          <ClearInput value={eventSearch} onChange={setEventSearch} placeholder="Search events..." className="text-sm" />

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
                  dateFilter === f.value ? "bg-selected text-white" : "bg-gray-100 text-muted hover:bg-gray-200"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {(dateFilter === "all" ? windowedEvents : filteredEvents).length === 0 ? (
            <div className="text-center py-8"><p className="text-muted text-sm">No events found</p></div>
          ) : (
            <>
              {/* Load more past */}
              {dateFilter === "all" && hasMorePast && (
                <button
                  onClick={() => setVisiblePast((p) => p + 25)}
                  className="w-full py-2 rounded-lg text-xs font-medium text-muted border border-border hover:bg-gray-50 transition-all"
                >
                  Load {Math.min(25, pastEvents.length - visiblePast)} older events
                </button>
              )}

              {(dateFilter === "all" ? windowedEvents : filteredEvents).map((event, idx) => {
                const ts = getTimeStatus(event);
                const borderColor = ts === "active" ? "border-l-green-500" : ts === "upcoming" ? "border-l-blue-400" : "border-l-gray-300";
                const cardOpacity = ts === "past" ? "opacity-60" : "";

                // Insert "Today" marker at the boundary
                const eventTime = new Date(event.date).getTime();
                const prevEvent = (dateFilter === "all" ? windowedEvents : filteredEvents)[idx - 1];
                const prevTime = prevEvent ? new Date(prevEvent.date).getTime() : 0;
                const showTodayMarker = dateFilter === "all" && eventTime >= todayStart && prevTime < todayStart;

                return (
                  <div key={event.id}>
                    {showTodayMarker && (
                      <div ref={todayRef} className="flex items-center gap-2 py-2">
                        <div className="flex-1 h-px bg-primary/40" />
                        <span className="text-xs font-semibold text-primary px-2">Today</span>
                        <div className="flex-1 h-px bg-primary/40" />
                      </div>
                    )}
                    <Link
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
                  </div>
                );
              })}

              {/* Load more future */}
              {dateFilter === "all" && hasMoreFuture && (
                <button
                  onClick={() => setVisibleFuture((f) => f + 25)}
                  className="w-full py-2 rounded-lg text-xs font-medium text-muted border border-border hover:bg-gray-50 transition-all"
                >
                  Load {Math.min(25, todayAndFutureEvents.length - visibleFuture)} newer events
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Members Tab ── */}
      {tab === "members" && !showInfo && (
        <div className="space-y-3">
          {/* Join requests */}
          {canManage && joinRequests.filter((r) => r.status === "pending").length > 0 && (
            <div className="bg-card rounded-xl border border-amber-200 overflow-hidden">
              <div className="text-[10px] text-amber-700 px-3 pt-2 pb-1 uppercase tracking-wider font-medium">
                Join Requests ({joinRequests.filter((r) => r.status === "pending").length})
              </div>
              {joinRequests.filter((r) => r.status === "pending").map((req) => (
                <div key={req.id} className="flex items-center gap-2 py-2 px-3 border-b border-amber-100 last:border-b-0 bg-amber-50/50">
                  <span className="text-lg">{req.player.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium">{req.player.name}</span>
                    {req.message && <p className="text-[10px] text-muted truncate">{req.message}</p>}
                  </div>
                  <button onClick={async () => {
                    await fetch(`/api/clubs/${club!.id}/join-request`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ requestId: req.id, action: "accept" }),
                    });
                    setJoinRequests((prev) => prev.map((r) => r.id === req.id ? { ...r, status: "accepted" } : r));
                    fetchClub();
                  }}
                    className="text-[10px] bg-green-600 text-white px-2.5 py-1 rounded font-medium">Accept</button>
                  <button onClick={async () => {
                    await fetch(`/api/clubs/${club!.id}/join-request`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ requestId: req.id, action: "decline" }),
                    });
                    setJoinRequests((prev) => prev.map((r) => r.id === req.id ? { ...r, status: "declined" } : r));
                  }}
                    className="text-[10px] text-danger px-2 py-1 rounded hover:bg-red-50">Decline</button>
                </div>
              ))}
            </div>
          )}
          {/* Filters */}
          <div className="flex gap-2">
            <ClearInput value={memberSearch} onChange={setMemberSearch} placeholder="Search members..." className="text-sm" />
            {(["M", "F"] as const).map((g) => (
              <button
                key={g}
                onClick={() => setMemberGender(memberGender === g ? null : g)}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                  memberGender === g ? "bg-selected text-white" : "bg-gray-100 text-foreground hover:bg-gray-200"
                }`}
              >
                {g === "M" ? "♂" : "♀"}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between">
            <p className="text-xs text-muted">{filteredMembers.length} member{filteredMembers.length !== 1 ? "s" : ""}{canManage ? " · swipe or hover to remove" : ""}</p>
            {canManage && (
              <button onClick={async () => {
                const r = await fetch(`/api/clubs/${club.id}/invite`, { method: "POST" });
                if (r.ok) {
                  const invite = await r.json();
                  const url = `${window.location.origin}/clubs/join/${invite.token}`;
                  if (navigator.clipboard) {
                    await navigator.clipboard.writeText(url);
                    alert("Invite link copied!");
                  } else {
                    prompt("Copy this invite link:", url);
                  }
                }
              }} className="text-xs text-action font-medium">Copy Invite Link</button>
            )}
          </div>

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
                <ClearInput value={addMemberSearch} onChange={setAddMemberSearch} placeholder="Search by name..." className="text-sm" />
                <div className="space-y-1 max-h-64 overflow-y-auto">
                  {nonMembers.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => addMember(p.id)}
                      className="w-full text-left py-2 px-3 rounded-lg hover:bg-gray-50 active:bg-gray-100 flex items-center gap-2 transition-colors"
                    >
                      <PlayerAvatar name={p.name} photoUrl={p.photoUrl} size="xs" />
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
      {tab === "rankings" && !showInfo && (
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
                <PlayerAvatar name={p.name} photoUrl={p.photoUrl} size="sm" />
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
                  <PlayerAvatar name={p.name} photoUrl={p.photoUrl} size="sm" />
                  <span className="font-medium text-sm flex-1">{p.name}</span>
                  <span className="text-sm text-muted">1000</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* Settings tab removed — club info is now via ℹ icon */}
    </div>
  );
}
