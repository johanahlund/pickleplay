"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useViewRole, hasRole } from "@/components/RoleToggle";
import { useConfirm } from "@/components/ConfirmDialog";
import Link from "next/link";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { ClearInput } from "@/components/ClearInput";
import { COUNTRIES } from "@/lib/countries";
import { getPreview, setPreview } from "@/lib/entityPreview";
import { useHideBottomNav, usePollingRefresh } from "@/lib/hooks";
import { PenIcon } from "@/components/PenIcon";
import { frameClass } from "@/components/Card";
import { clubLabel, clubRoleLabel } from "@/lib/clubLabel";
import { nameMatchesSearch } from "@/lib/searchUtil";
import { copyText } from "@/lib/clipboard";

// ── Long press to delete ──
// `onDelete` is responsible for confirming via useConfirm before mutating;
// this component just triggers it after a 600ms hold (mobile) or hover-Delete
// click (desktop).
function LongPressDelete({ children, canDelete, onDelete }: { children: React.ReactNode; canDelete: boolean; onDelete: () => void }) {
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
        onDelete();
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
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
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
  country?: string | null;
  /** Club memberships from /api/players. Used to disambiguate players
   *  with similar names in the Add Member picker. */
  clubs?: { id: string; name: string; emoji: string; role: string }[];
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

interface ClubLocation { id: string; name: string; googleMapsUrl?: string | null; numCourts?: number }

interface Club {
  id: string;
  name: string;
  shortName?: string | null;
  emoji: string;
  logoUrl?: string | null;
  coverUrl?: string | null;
  description?: string | null;
  city?: string | null;
  country?: string | null;
  status?: string | null;
  createdById: string | null;
  members: ClubMember[];
  whatsappGroups: WaGroup[];
  locations: ClubLocation[];
  _count: { events: number };
}

type Tab = "feed" | "events" | "members" | "requests" | "rankings";

// ── Role Pill ──
const ROLE_COLORS: Record<string, string> = {
  owner: "bg-purple-100 text-purple-700",
  admin: "bg-blue-100 text-blue-700",
  member: "bg-gray-100 text-muted",
};

// `onChange` should already include any confirmation step — this pill
// just opens the dropdown and forwards the selected role.
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
        className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium w-full text-center ${ROLE_COLORS[role] || ROLE_COLORS.member} ${canChange ? "cursor-pointer" : ""}`}
      >
        {clubRoleLabel(role)}
      </button>
      {open && (
        <div className="absolute right-0 top-6 bg-white rounded-lg shadow-xl border border-border z-50 overflow-hidden min-w-[100px]">
          {roles.map((r) => (
            <button key={r} onClick={(e) => {
              e.stopPropagation();
              if (r === role) { setOpen(false); return; }
              onChange(r);
              setOpen(false);
            }}
              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 ${role === r ? "font-bold" : ""}`}>
              {clubRoleLabel(r)} {role === r ? "✓" : ""}
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
  isGlobalAdmin,
  isSelf,
  showContact,
  onRemove,
  onRoleChange,
}: {
  member: ClubMember;
  canManage: boolean;
  isOwner: boolean;
  isGlobalAdmin: boolean;
  isSelf: boolean;
  showContact: boolean;
  onRemove: () => void;
  onRoleChange: (role: string) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const swipeOffset = useRef(0);

  // Can this member row be removed by the current viewer?
  //   - App admin can remove anyone, including themselves
  //   - Club owner/admin can remove non-owner members other than themselves
  //   - Any non-owner member can remove THEMSELVES (leave the club)
  //   - The owner can't leave without transferring ownership first
  //     (the API enforces this); only app admin can remove the owner
  const canRemove = isSelf
    ? (member.role !== "owner" || isGlobalAdmin)
    : (canManage && (member.role !== "owner" || isGlobalAdmin));

  const handleTouchStart = (e: React.TouchEvent) => {
    if (!canRemove) return;
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    swipeOffset.current = 0;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!canRemove) return;
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
    if (swipeOffset.current < -80 && canRemove) {
      // Parent's onRemove already handles the confirm dialog.
      onRemove();
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
      {p.gender && (
        <span className={`text-xs w-4 text-center shrink-0 ${p.gender === "M" ? "text-blue-500" : "text-pink-500"}`}>
          {p.gender === "M" ? "♂" : "♀"}
        </span>
      )}
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm truncate">{p.name}</div>
        {/*
          Render the role pill for ALL members when the viewer is the
          club owner (so they can promote a member directly to admin or
          even owner — required for ownership transfer). For
          admin/owner members the pill always renders so their status
          is visible.
        */}
        {((member.role === "owner" || member.role === "admin") || (isOwner && !isSelf)) && (
          <div className="mt-0.5">
            <RolePill role={member.role} canChange={!!(isOwner && !isSelf && (member.role !== "owner" || isGlobalAdmin))} onChange={onRoleChange} />
          </div>
        )}
      </div>
      {p.phone && showContact && (
        <a
          href={`https://wa.me/${p.phone.replace(/[^0-9+]/g, "").replace(/^\+/, "")}`}
          target="_blank" rel="noopener noreferrer"
          className="text-green-500 text-sm w-6 text-center"
          onClick={(e) => e.stopPropagation()}
        >💬</a>
      )}
      {/* Rating shown only after the member has played at least 20
          matches. Before that the rating isn't statistically meaningful;
          show a placeholder dash so the column stays aligned. */}
      <span className="text-xs text-muted w-10 text-right tabular-nums">
        {(p.wins + p.losses) >= 20 ? Math.round(p.rating) : <span className="text-muted/50">—</span>}
      </span>
      {/* Wins / Losses stacked, each on its own line, smaller font,
          coloured. Replaces the old "3W 2L" inline pair. */}
      <span className="flex flex-col items-end leading-tight tabular-nums w-10 shrink-0">
        <span className="text-[10px] font-semibold text-green-600">{p.wins}</span>
        <span className="text-[10px] font-semibold text-orange-500">{p.losses}</span>
      </span>
      {/* Always-visible remove button (touch: also swipe-left works).
          Hidden on the viewer's own row — they leave the club via the
          dedicated "Leave club" link in the club header instead. */}
      {canRemove && !isSelf && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="w-7 h-7 rounded-full text-danger hover:bg-red-50 active:bg-red-100 flex items-center justify-center transition-colors shrink-0"
          title={`Remove ${p.name}`}
          aria-label={`Remove ${p.name}`}
        >
          ✕
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
  const { confirm: confirmDialog, alert: alertDialog } = useConfirm();
  const [transferTargetId, setTransferTargetId] = useState<string>("");
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const { viewRole } = useViewRole();
  const isGlobalAdmin = session?.user?.role === "admin" && hasRole(viewRole, "admin");

  const [club, setClub] = useState<Club | null>(null);
  const [loading, setLoading] = useState(true);
  // Tab is URL-synced via useSearchParams. setTab writes via
  // history.replaceState; the effect below reflects URL → state on
  // soft navigation (back/forward, header tab links).
  const searchParams = useSearchParams();
  const tabFromUrl = (() => {
    const t = searchParams.get("tab");
    return t && ["feed", "events", "members", "requests", "rankings"].includes(t) ? (t as Tab) : "feed";
  })();
  const [tab, setTab] = useState<Tab>(tabFromUrl);
  useEffect(() => { setTab(tabFromUrl); }, [tabFromUrl]);
  const [events, setEvents] = useState<EventInfo[]>([]);
  const [allPlayers, setAllPlayers] = useState<Player[]>([]);
  const [showAddMember, setShowAddMember] = useState(false);
  const [addMemberSearch, setAddMemberSearch] = useState("");
  // Gender filter is a M/F toggle (null = both). No "All" button — the
  // selected pill is tapped again to clear.
  const [addMemberGender, setAddMemberGender] = useState<"M" | "F" | null>(null);
  // Country filter. Defaults applied from session.user.country on first
  // open (see effect below). Empty string = all countries.
  const [addMemberCountry, setAddMemberCountry] = useState<string>("");
  // Staging tray of player ids the admin has picked but not yet saved.
  // Persists across taps until they click "Add N members" or close.
  const [pendingMemberIds, setPendingMemberIds] = useState<Set<string>>(new Set());
  const [addedMemberIds, setAddedMemberIds] = useState<Set<string>>(new Set());
  const [savingMembers, setSavingMembers] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [editing, setEditing] = useState(false);
  const [clubDirty, setClubDirty] = useState(false);

  useHideBottomNav(editing);
  const [editName, setEditName] = useState("");
  const [editShortName, setEditShortName] = useState("");
  const [editEmoji, setEditEmoji] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editCity, setEditCity] = useState("");
  const [editCountry, setEditCountry] = useState("");
  const [editStatus, setEditStatus] = useState<"draft" | "active" | "closed">("active");
  const [editLocations, setEditLocations] = useState<{ name: string; googleMapsUrl: string; numCourts: number }[]>([]);
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

  // Preview cache lookup for instant render-on-navigation. Reading
  // sessionStorage at render time causes a hydration mismatch (the
  // server has no sessionStorage so it sees null, but the client
  // sees the cached preview). Defer to useEffect so the initial
  // client render matches the server render — then we replace null
  // with the cached preview after mount.
  type ClubPreview = { id: string; name: string; emoji: string; logoUrl?: string | null; coverUrl?: string | null; description?: string | null; city?: string | null; country?: string | null; myRole?: string; _count?: { members?: number; events?: number } };
  const [clubPreview, setClubPreview] = useState<ClubPreview | null>(null);
  useEffect(() => {
    if (typeof id === "string") {
      setClubPreview(getPreview<ClubPreview>("club", id));
    }
  }, [id]);

  const fetchClub = useCallback(async () => {
    const r = await fetch(`/api/clubs/${id}`);
    if (!r.ok) { router.push("/clubs"); return; }
    const data = await r.json();
    setClub(data);
    setLoading(false);
    if (typeof id === "string") setPreview("club", id, data);
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
  // Real club owners/admins always have manage authority over their own
  // club — the view-role toggle is admin-only and shouldn't strip a club
  // owner of the ability to edit their own data.
  // App admins in "club" view-role simulate being THE club director on
  // whichever club they're looking at — they get the same UX affordances
  // (edit, transfer, manage roles). Strict owner-protection overrides
  // (e.g. removing the actual owner) stay reserved for "admin" view via
  // `isGlobalAdmin` above.
  const isAppAdmin = session?.user?.role === "admin";
  const simulatesClubDirector = isAppAdmin && hasRole(viewRole, "club") && !isGlobalAdmin;
  const canManage = myMembership?.role === "owner" || myMembership?.role === "admin" || isGlobalAdmin || simulatesClubDirector;
  const isOwner = myMembership?.role === "owner" || isGlobalAdmin || simulatesClubDirector;

  const [myPendingRequest, setMyPendingRequest] = useState(false);

  // Fetch join requests for managers
  const fetchJoinRequests = async () => {
    if (!canManage || !club) return;
    const r = await fetch(`/api/clubs/${club.id}/join-request`);
    if (r.ok) setJoinRequests(await r.json());
  };
  useEffect(() => {
    fetchJoinRequests();
  }, [canManage, club?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Check if current user has a pending join request
  const fetchMyPendingRequest = async () => {
    if (!userId || !club || myMembership) return;
    try {
      const r = await fetch(`/api/clubs/${club.id}/join-request/mine`);
      if (r.ok) {
        const data = await r.json();
        setMyPendingRequest(data?.pending || false);
      }
    } catch { /* ignore */ }
  };
  useEffect(() => {
    fetchMyPendingRequest();
  }, [userId, club?.id, myMembership]); // eslint-disable-line react-hooks/exhaustive-deps

  // Background refresh — admins see new join requests appear, and a
  // member who's been kicked sees their access drop. 60s base interval
  // plus tab focus, via usePollingRefresh.
  usePollingRefresh(
    async () => {
      if (!club) return;
      await fetchClub();
      await fetchJoinRequests();
      await fetchMyPendingRequest();
    },
    60000,
    !!club,
  );

  const fetchAllPlayers = async () => {
    // Always refetch when the picker opens — the cached snapshot can
    // become stale after a member is removed/added elsewhere, which
    // leaves the wrong club pills showing on player rows.
    // High limit so every candidate is available client-side.
    const r = await fetch("/api/players?limit=5000");
    if (r.ok) setAllPlayers(await r.json());
  };

  const addMember = async (playerId: string) => {
    await fetch(`/api/clubs/${id}/members`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ playerId }) });
    fetchClub();
  };

  // Batch save: persist every staged player as a member. Used by the
  // "Add N members" button in the add-member picker. Each call is fired
  // in parallel; the tray clears at the end and the picker stays open
  // so the admin can do another batch.
  const addPendingMembers = async () => {
    if (pendingMemberIds.size === 0) return;
    setSavingMembers(true);
    try {
      const ids = [...pendingMemberIds];
      await Promise.all(
        ids.map((playerId) =>
          fetch(`/api/clubs/${id}/members`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerId }),
          }),
        ),
      );
      setAddedMemberIds((s) => {
        const n = new Set(s);
        ids.forEach((pid) => n.add(pid));
        return n;
      });
      setPendingMemberIds(new Set());
      fetchClub();
    } finally {
      setSavingMembers(false);
    }
  };

  const removeMember = async (playerId: string, playerName?: string) => {
    const removingSelf = playerId === userId;
    const ok = await confirmDialog({
      title: removingSelf ? "Leave club" : "Remove member",
      message: removingSelf
        ? `Leave ${club?.name || "the club"}? You can rejoin later if invited.`
        : `Remove ${playerName || "this member"} from the club? They can always be added back later.`,
      danger: true,
      confirmText: removingSelf ? "Leave" : "Remove",
    });
    if (!ok) return;
    const r = await fetch(`/api/clubs/${id}/members`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId }),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      await alertDialog(d.error || "Failed to remove member", "Error");
      return;
    }
    if (removingSelf && !isGlobalAdmin) {
      // Non-admin user removed themselves — they no longer have access.
      router.push("/clubs");
      return;
    }
    fetchClub();
  };

  const updateRole = async (playerId: string, role: string) => {
    // The PATCH handler auto-demotes whoever is currently owner when the
    // role transfer assigns ownership. Tailor the confirm message based
    // on whether the caller is the current owner (typical "You become
    // admin" hand-off) or an app admin acting on behalf of the club
    // (no demotion of the caller — only the current director moves).
    const callerIsOwner = myMembership?.role === "owner";
    const target = club?.members.find((m) => m.playerId === playerId);
    const targetName = target?.player.name || "this member";
    let title = "";
    let message = "";
    if (role === "owner") {
      title = "Transfer directorship?";
      message = callerIsOwner
        ? `${targetName} becomes the new director. You will become admin.`
        : `${targetName} becomes the new director. The current director will be demoted to admin.`;
    } else if (role === "admin") {
      title = "Make admin?";
      message = `${targetName} will gain admin powers (edit club, manage members, approve join requests).`;
    } else {
      title = "Change to member?";
      message = `${targetName} will lose admin powers but stays in the club.`;
    }
    const ok = await confirmDialog({
      title,
      message,
      confirmText: role === "owner" ? "Transfer" : "Change",
      danger: role === "owner",
    });
    if (!ok) return;
    const r = await fetch(`/api/clubs/${id}/members`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ playerId, role }) });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      await alertDialog(d.error || "Failed to change role", "Error");
      return;
    }
    fetchClub();
  };

  const saveEdit = async () => {
    await fetch(`/api/clubs/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editName,
        shortName: editShortName.trim() || null,
        emoji: editEmoji,
        description: editDescription,
        city: editCity,
        country: editCountry,
        status: editStatus,
        locations: editLocations.filter((l) => l.name.trim()),
      }),
    });
    setEditing(false);
    fetchClub();
  };

  const startEditing = () => {
    if (!club) return;
    setEditName(club.name);
    setEditShortName(club.shortName || "");
    setEditEmoji(club.emoji);
    setEditDescription(club.description || "");
    setEditCity(club.city || "");
    setEditCountry(club.country || "");
    setEditStatus((club.status as "draft" | "active" | "closed") || "active");
    setEditLocations(
      club.locations.length > 0
        ? club.locations.map((l) => ({
            name: l.name,
            googleMapsUrl: l.googleMapsUrl || "",
            numCourts: (l as unknown as { numCourts?: number }).numCourts ?? 2,
          }))
        : [{ name: "", googleMapsUrl: "", numCourts: 2 }]
    );
    setClubDirty(false);
    setEditing(true);
  };

  const deleteClub = async () => {
    if (!club) return;
    const memberCount = club.members.length;
    const ok = await confirmDialog({
      title: "Delete this club?",
      message:
        `This permanently deletes ${club.name}.\n\n` +
        `· ${memberCount} member${memberCount === 1 ? "" : "s"} will lose access\n` +
        `· Posts, comments, locations and join requests are erased\n` +
        `· Any events/leagues hosted here become orphaned\n\n` +
        `This cannot be undone.`,
      confirmText: "Delete forever",
      cancelText: "Cancel",
      danger: true,
      requireType: club.name,
    });
    if (!ok) return;
    const r = await fetch(`/api/clubs/${id}`, { method: "DELETE" });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      await alertDialog(d.error || "Failed to delete club", "Error");
      return;
    }
    router.push("/clubs");
  };

  // Filtered events — sorted by date ascending
  const filteredEvents = useMemo(() => {
    return events
      .filter((e) => nameMatchesSearch(e.name, eventSearch))
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
    const rank = (role: string) => role === "owner" ? 0 : role === "admin" ? 1 : 2;
    return club.members
      .filter((m) => !memberSearch || nameMatchesSearch(m.player.name, memberSearch))
      .filter((m) => !memberGender || m.player.gender === memberGender)
      .sort((a, b) => {
        const ra = rank(a.role); const rb = rank(b.role);
        if (ra !== rb) return ra - rb;
        return a.player.name.localeCompare(b.player.name);
      });
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
    .filter((p) => !addMemberSearch || nameMatchesSearch(p.name, addMemberSearch))
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

  if (loading || !club) {
    // If we have a cached preview from the clubs list, render an instant
    // header card (cover, logo, name, city, role) while the full club
    // detail loads in the background.
    if (clubPreview) {
      return (
        <div className="space-y-3 animate-in fade-in duration-200">
          <Link href="/clubs" className="text-sm text-action">&larr; Clubs</Link>
          <div className={`${frameClass} overflow-hidden`}>
            {clubPreview.coverUrl && (
              <div className="h-32 w-full bg-gray-100">
                <img src={clubPreview.coverUrl} alt="" className="w-full h-full object-cover" />
              </div>
            )}
            <div className="p-4">
              <div className="flex items-center gap-3">
                {clubPreview.logoUrl ? (
                  <img src={clubPreview.logoUrl} alt="" className="w-12 h-12 rounded-xl object-cover" />
                ) : (
                  <span className="text-3xl">{clubPreview.emoji}</span>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="text-xl font-bold">{clubPreview.name}</h2>
                    {clubPreview.myRole && (
                      <span className="text-[10px] bg-gray-100 text-muted px-1.5 py-0.5 rounded-full font-medium">{clubRoleLabel(clubPreview.myRole)}</span>
                    )}
                  </div>
                  {(clubPreview.city || clubPreview.country) && (
                    <p className="text-sm text-muted mt-0.5">
                      {[clubPreview.city, clubPreview.country].filter(Boolean).join(", ")}
                    </p>
                  )}
                </div>
              </div>
              {clubPreview.description && (
                <p className="text-sm text-muted mt-3 line-clamp-2">{clubPreview.description}</p>
              )}
            </div>
          </div>
          <div className={`${frameClass} p-6 animate-pulse`}>
            <div className="h-3 bg-gray-200 rounded w-1/3 mb-3" />
            <div className="h-3 bg-gray-200 rounded w-2/3 mb-3" />
            <div className="h-3 bg-gray-200 rounded w-1/2" />
          </div>
        </div>
      );
    }
    return (
      <div className="flex justify-center py-8">
        <div className="w-5 h-5 border-2 border-action border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const getMedal = (i: number) => i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`;

  // The "Requests" tab is admin-only and only shown when at least one
  // pending join request exists. Keeps the tab bar tidy for the common
  // case where there's nothing waiting.
  const pendingCount = joinRequests.filter((r) => r.status === "pending").length;
  const tabs: { key: Tab; label: string }[] = [
    { key: "feed", label: "Feed" },
    { key: "events", label: "Events" },
    { key: "members", label: "Members" },
    ...(canManage && pendingCount > 0 ? [{ key: "requests" as Tab, label: `Requests (${pendingCount})` }] : []),
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
    const post = posts.find((p) => p.id === postId);
    const ok = await confirmDialog({
      title: "Delete post?",
      message: post ? `${post.author.name}'s post${post.comments.length > 0 ? ` and ${post.comments.length} comment${post.comments.length !== 1 ? "s" : ""}` : ""}. This cannot be undone.` : "This cannot be undone.",
      confirmText: "Delete",
      danger: true,
    });
    if (!ok) return;
    await fetch(`/api/clubs/${id}/posts/${postId}`, { method: "DELETE" });
    fetchPosts();
  };

  const deleteComment = async (postId: string, commentId: string) => {
    const ok = await confirmDialog({
      title: "Delete comment?",
      message: "This cannot be undone.",
      confirmText: "Delete",
      danger: true,
    });
    if (!ok) return;
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
            onClick={() => { setTab(t.key); setShowInfo(false); window.history.replaceState(null, "", `?tab=${t.key}`); }}
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

  if (showAddMember && club) {
    // Filter chain — search box + gender toggle + country dropdown +
    // not-already-staged. The staging tray sits at the top; tapping a
    // row puts the player in the tray; tapping a tray chip removes them.
    // Applies all picker filters (search, gender, country) to a list.
    // Used both for the eligible list and the "already-member" tail.
    const applyPickerFilters = (list: Player[]) => list
      .filter((p) => !addMemberSearch || nameMatchesSearch(p.name, addMemberSearch))
      .filter((p) => !addMemberGender || p.gender === addMemberGender)
      // Country filter only excludes players with an EXPLICIT different
      // country. Players with country=null (never set their profile)
      // pass every filter — they could be anyone, and hiding them makes
      // them invisible to admins trying to add them.
      .filter((p) => !addMemberCountry || !p.country || p.country === addMemberCountry);

    const filtered = applyPickerFilters(nonMembers)
      .filter((p) => !pendingMemberIds.has(p.id))
      .filter((p) => !addedMemberIds.has(p.id));
    const pendingPlayers = nonMembers.filter((p) => pendingMemberIds.has(p.id));

    // Players from the full pool who DO match the current filters but
    // are already in this club — rendered as a faded tail under the
    // eligible list so an admin searching for "Nuno" sees both
    // pickable-Nunos and "Nuno · already a member" with one glance.
    const memberIds = new Set((club.members || []).map((m) => m.playerId));
    const alreadyMembersMatching = applyPickerFilters(
      allPlayers.filter((p) => memberIds.has(p.id)),
    ).sort((a, b) => a.name.localeCompare(b.name));
    const togglePending = (pid: string) => {
      setPendingMemberIds((s) => {
        const n = new Set(s);
        if (n.has(pid)) n.delete(pid);
        else n.add(pid);
        return n;
      });
    };
    const closePicker = () => {
      setShowAddMember(false);
      setPendingMemberIds(new Set());
      setAddedMemberIds(new Set());
    };
    return (
      // Same outer wrapper as the Members-tab return below so the back
      // link sits at the same Y position in both views (no sticky shadow
      // card, no extra padding — just `space-y-3` like the main page).
      <div className="space-y-3">
        <button onClick={closePicker} className="text-sm text-action font-medium">
          ← Members <span className="text-xs text-muted font-normal">({clubLabel(club)})</span>
        </button>
        <div className={`${frameClass} p-4 space-y-3`}>
          {/* Title + Add button on the same row. The button moved up
              from the sticky-bottom bar so it's always reachable
              alongside the staging tray. */}
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold truncate">Add Members to {club.name}</h3>
            <button
              type="button"
              onClick={addPendingMembers}
              disabled={pendingPlayers.length === 0 || savingMembers}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-action text-white disabled:opacity-40 active:bg-action-dark transition-colors shrink-0"
            >
              {savingMembers
                ? "Adding..."
                : pendingPlayers.length === 0
                  ? "Add"
                  : `Add ${pendingPlayers.length}`}
            </button>
          </div>

          {/* Staging tray — sits at the top so the admin can see who
              they've already picked. Tap an X-chip to remove someone. */}
          <div className="rounded-lg border border-border bg-gray-50 px-2 py-1.5">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] uppercase tracking-wide text-muted">
                Selected ({pendingPlayers.length})
              </span>
              {pendingPlayers.length > 0 && (
                <button
                  type="button"
                  onClick={() => setPendingMemberIds(new Set())}
                  className="text-[11px] text-danger font-medium hover:underline"
                >Clear all</button>
              )}
            </div>
            {pendingPlayers.length === 0 ? (
              <div className="text-[11px] text-muted italic">
                Tap players below to add them here, then press <span className="not-italic">&quot;Add&quot;</span>.
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {pendingPlayers.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => togglePending(p.id)}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-action/10 text-foreground text-xs border border-action/30 hover:bg-action/15"
                    title="Tap to remove"
                  >
                    <span className="font-medium">{p.name}</span>
                    {p.gender && (
                      <span className={p.gender === "F" ? "text-pink-500" : "text-blue-500"}>
                        {p.gender === "F" ? "♀" : "♂"}
                      </span>
                    )}
                    <span className="text-muted">×</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Filter row — country first, then gender. Same order as the
              event Add Players picker so the two surfaces feel
              consistent. No "All" gender pill; tap selected to clear. */}
          <div className="flex items-center gap-2">
            <select
              value={addMemberCountry}
              onChange={(e) => setAddMemberCountry(e.target.value)}
              className="flex-1 border border-border rounded-lg px-2 py-1.5 text-xs bg-white"
            >
              <option value="">All countries</option>
              {COUNTRIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            {(["M", "F"] as const).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setAddMemberGender((cur) => (cur === g ? null : g))}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
                  addMemberGender === g ? "bg-selected text-white" : "bg-gray-100 text-foreground"
                }`}
              >
                <span className={addMemberGender === g ? "text-white" : g === "M" ? "text-blue-500" : "text-pink-500"}>
                  {g === "M" ? "♂" : "♀"}
                </span>
              </button>
            ))}
          </div>

          <ClearInput value={addMemberSearch} onChange={setAddMemberSearch} placeholder="Search by name..." className="text-sm" />
          <div className="text-[11px] text-muted">
            {filtered.length} available
            {addedMemberIds.size > 0 && ` · ${addedMemberIds.size} added so far`}
          </div>

          {filtered.length === 0 && alreadyMembersMatching.length === 0 ? (
            <p className="text-xs text-muted text-center py-6">No players match these filters</p>
          ) : (
            <>
              <div className="space-y-0.5">
                {filtered.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => togglePending(p.id)}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left hover:bg-gray-50 active:bg-gray-100 transition-colors"
                  >
                    <PlayerAvatar name={p.name} photoUrl={p.photoUrl} size="sm" />
                    {p.gender && (
                      <span className={`text-xs shrink-0 ${p.gender === "F" ? "text-pink-500" : "text-blue-500"}`}>
                        {p.gender === "F" ? "♀" : "♂"}
                      </span>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{p.name}</div>
                      {/* Country (plain text) + club pills. Matches the
                          chip style used in the players list and disambiguates
                          same-named players. The default 🏓 / 🏟️ emoji is
                          dropped — the pill itself carries the visual weight. */}
                      {(p.country || (p.clubs && p.clubs.length > 0)) && (
                        <div className="mt-0.5 flex items-center gap-1 flex-wrap">
                          {p.country && (
                            <span className="text-[10px] text-muted">{p.country}</span>
                          )}
                          {p.clubs?.map((c) => (
                            <span
                              key={c.id}
                              className="text-[10px] bg-gray-100 text-foreground px-1.5 py-0.5 rounded-full font-medium truncate max-w-[140px]"
                              title={`${c.name} (${c.role})`}
                            >
                              {c.role === "owner" ? "👑 " : c.role === "admin" ? "⭐ " : ""}{c.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
              {/* Already-a-member tail. Faded, non-clickable. Tells the
                  admin "yes, the person you're searching for IS in this
                  club already" so they don't keep hunting. */}
              {alreadyMembersMatching.length > 0 && (
                <div className="mt-3 pt-3 border-t border-dashed border-border">
                  <div className="text-[10px] uppercase tracking-wide text-muted mb-1.5">
                    Already in this club ({alreadyMembersMatching.length})
                  </div>
                  <div className="space-y-0.5">
                    {alreadyMembersMatching.map((p) => (
                      <div
                        key={p.id}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg opacity-50 cursor-default select-none"
                      >
                        <PlayerAvatar name={p.name} photoUrl={p.photoUrl} size="sm" />
                        {p.gender && (
                          <span className={`text-xs shrink-0 ${p.gender === "F" ? "text-pink-500" : "text-blue-500"}`}>
                            {p.gender === "F" ? "♀" : "♂"}
                          </span>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{p.name}</div>
                        </div>
                        <span className="text-[10px] text-muted font-medium">✓ member</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Bottom action bar — just "Done" now. The primary Add
              action lives next to the title above. */}
          <div className="sticky bottom-0 -mx-4 -mb-4 px-4 py-3 bg-white border-t border-border flex justify-end">
            <button
              type="button"
              onClick={closePicker}
              className="px-4 py-2.5 rounded-lg text-sm font-medium text-muted bg-gray-100 hover:bg-gray-200"
            >Done</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Back navigation. Always reads "← Clubs" to match the quick-view
          card shown before data finishes loading. Avoids the flash where
          the label changes from "Clubs" → "Back". */}
      {tab === "feed" ? (
        <button onClick={async () => {
          if (editing && clubDirty) {
            const ok = await confirmDialog({ title: "Unsaved changes", message: "You have unsaved changes. Discard them?", confirmText: "Discard", danger: true });
            if (!ok) return;
            setClubDirty(false); setEditing(false);
          }
          router.push("/clubs");
        }} className="text-sm text-action font-medium">← Clubs</button>
      ) : (
        <button onClick={async () => {
          if (editing && clubDirty) {
            const ok = await confirmDialog({ title: "Unsaved changes", message: "You have unsaved changes. Discard them?", confirmText: "Discard", danger: true });
            if (!ok) return;
            setClubDirty(false); setEditing(false);
          }
          setTab("feed"); setShowInfo(false); window.history.replaceState(null, "", `?tab=feed`);
        }} className="text-sm text-action font-medium">← {clubLabel(club)}</button>
      )}

      {/* ── Club Info Panel ── */}
      {showInfo && (
        <div className="space-y-4">
          {editing ? (
            <div className={`${frameClass} p-4 space-y-3`}>
              <div>
                <label className="block text-sm font-medium text-muted mb-1">Club Name</label>
                <input
                  type="text" value={editName} onChange={(e) => { setEditName(e.target.value); setClubDirty(true); }}
                  className="w-full border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted mb-1">Short Name <span className="text-muted font-normal">(≤10 chars, used in pills)</span></label>
                <input
                  type="text" value={editShortName} maxLength={10}
                  onChange={(e) => { setEditShortName(e.target.value.slice(0, 10)); setClubDirty(true); }}
                  placeholder={editName.slice(0, 10)}
                  className="w-full border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted mb-1">Logo</label>
                <div className="flex items-center gap-3">
                  {club.logoUrl ? (
                    <img src={club.logoUrl} alt="Logo" className="w-16 h-16 rounded-xl object-cover" />
                  ) : (
                    <div className="w-16 h-16 rounded-xl bg-gray-100 border border-border" aria-hidden />
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
                      else await alertDialog("Upload failed");
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
                      else await alertDialog("Upload failed");
                    }} />
                  </label>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-muted mb-1">City</label>
                  <input type="text" value={editCity} onChange={(e) => { setEditCity(e.target.value); setClubDirty(true); }}
                    placeholder="e.g. Setúbal"
                    className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                </div>
                <div className="flex-1">
                  <label className="block text-sm font-medium text-muted mb-1">Country</label>
                  <select value={editCountry} onChange={(e) => { setEditCountry(e.target.value); setClubDirty(true); }}
                    className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 bg-white">
                    <option value="">Select country...</option>
                    {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-muted mb-1">Status</label>
                <select value={editStatus} onChange={(e) => { setEditStatus(e.target.value as "draft" | "active" | "closed"); setClubDirty(true); }}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 bg-white">
                  <option value="draft">Draft</option>
                  <option value="active">Active</option>
                  <option value="closed">Closed</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-muted mb-1">Description</label>
                <textarea
                  value={editDescription} onChange={(e) => { setEditDescription(e.target.value); setClubDirty(true); }}
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
                            setClubDirty(true);
                          }}
                          className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                        />
                        <input
                          type="url" value={loc.googleMapsUrl} placeholder="Google Maps URL"
                          onChange={(e) => {
                            const next = [...editLocations];
                            next[i] = { ...next[i], googleMapsUrl: e.target.value };
                            setEditLocations(next);
                            setClubDirty(true);
                          }}
                          className="w-full border border-border rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary/50"
                        />
                        <div className="flex items-center gap-2">
                          <label className="text-[11px] text-muted">Courts:</label>
                          <input
                            type="number" min={1} max={20}
                            value={loc.numCourts}
                            onChange={(e) => {
                              const n = parseInt(e.target.value) || 1;
                              const next = [...editLocations];
                              next[i] = { ...next[i], numCourts: Math.min(Math.max(1, n), 20) };
                              setEditLocations(next);
                              setClubDirty(true);
                            }}
                            className="w-20 border border-border rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-primary/50"
                          />
                        </div>
                      </div>
                      <button
                        onClick={() => { setEditLocations(editLocations.filter((_, j) => j !== i)); setClubDirty(true); }}
                        className="text-xs text-danger px-2 py-2 rounded hover:bg-red-50 mt-1"
                      >✕</button>
                    </div>
                  ))}
                  <button
                    onClick={() => { setEditLocations([...editLocations, { name: "", googleMapsUrl: "", numCourts: 2 }]); setClubDirty(true); }}
                    className="text-xs text-primary font-medium"
                  >+ Add Location</button>
                </div>
              </div>



              {clubDirty && (
                <div className="flex gap-2">
                  <button onClick={saveEdit} className="flex-1 bg-action-dark text-white py-2 rounded-lg text-sm font-medium">Save</button>
                  <button onClick={() => { setClubDirty(false); setEditing(false); }} className="flex-1 bg-gray-100 py-2 rounded-lg text-sm font-medium">Cancel</button>
                </div>
              )}

              {(() => {
                const owner = club.members.find((m) => m.role === "owner");
                if (!owner) return null;
                return (
                  <div className="pt-2 border-t border-border">
                    <label className="block text-sm font-medium text-muted mb-1">Director</label>
                    <div className="flex items-center gap-2 text-sm">
                      <PlayerAvatar name={owner.player.name} photoUrl={owner.player.photoUrl} size="xs" />
                      <span className="font-medium">{owner.player.name}</span>
                    </div>
                  </div>
                );
              })()}
              {isOwner && (() => {
                const eligibleMembers = club.members.filter((m) => m.playerId !== userId && m.role !== "owner");
                return (
                  <div className="space-y-2 pt-2 border-t border-border">
                    <div>
                      <label className="block text-sm font-medium text-muted mb-1">Transfer directorship</label>
                      {eligibleMembers.length === 0 ? (
                        <p className="text-xs text-muted italic">
                          No other members to transfer to. Add members to the club first.
                        </p>
                      ) : (
                        <>
                          <div className="flex gap-2">
                            <select
                              value={transferTargetId}
                              onChange={(e) => setTransferTargetId(e.target.value)}
                              className="flex-1 border border-border rounded-lg px-3 py-2 text-sm bg-white"
                            >
                              <option value="">Select new owner...</option>
                              {eligibleMembers.map((m) => (
                                <option key={m.playerId} value={m.playerId}>
                                  {m.player.name} ({m.role})
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              disabled={!transferTargetId}
                              onClick={async () => {
                                if (!transferTargetId) return;
                                const target = club.members.find((m) => m.playerId === transferTargetId);
                                const ok = await confirmDialog({
                                  title: "Transfer directorship",
                                  message: `Transfer directorship of ${club.name} to ${target?.player.name || "this member"}? You will become an admin.`,
                                  danger: true,
                                  confirmText: "Transfer",
                                });
                                if (!ok) return;
                                const r = await fetch(`/api/clubs/${id}/members`, {
                                  method: "PATCH",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ playerId: transferTargetId, role: "owner" }),
                                });
                                if (r.ok) {
                                  setTransferTargetId("");
                                  await alertDialog("Ownership transferred.", "Done");
                                  fetchClub();
                                  setEditing(false);
                                } else {
                                  const d = await r.json().catch(() => ({}));
                                  await alertDialog(d.error || "Failed to transfer ownership", "Error");
                                }
                              }}
                              className="bg-action text-white px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              Transfer
                            </button>
                          </div>
                          <p className="text-[11px] text-muted mt-1">
                            You&apos;ll be demoted to admin. The new owner gets full control of the club.
                          </p>
                        </>
                      )}
                    </div>
                    <button onClick={deleteClub} className="w-full py-2 text-xs text-danger font-medium rounded-lg border border-red-200 hover:bg-red-50">
                      Delete Club
                    </button>
                  </div>
                );
              })()}
            </div>
          ) : (
            <div className={`${frameClass} overflow-hidden`}>
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
                    <div className="w-10 h-10 rounded-xl bg-gray-100 border border-border" aria-hidden />
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
          {/* Club overview */}
          <div className={`${frameClass} overflow-hidden`}>
            <div className="flex items-stretch gap-3 px-3 py-2.5 bg-white">
              {club.logoUrl
                ? <img src={club.logoUrl} alt="" className="w-10 h-10 rounded-xl object-cover shrink-0 self-center" />
                : <div className="w-10 h-10 rounded-xl bg-gray-100 border border-border shrink-0 self-center" aria-hidden />}
              <div className="flex-1 min-w-0 self-center">
                <h3 className="font-bold text-lg">{club.name}</h3>
                {(() => {
                  const owner = club.members.find((m) => m.role === "owner");
                  return owner ? (
                    <div className="text-[11px] text-muted">Director: <span className="text-foreground font-medium">{owner.player.name}</span></div>
                  ) : null;
                })()}
                {myMembership ? (
                  <span className="text-xs">
                    <span className="text-green-600 font-medium">✓ Member</span>
                    {myMembership.role !== "member" && <span className="text-muted"> ({myMembership.role})</span>}
                  </span>
                ) : userId ? (
                  myPendingRequest ? (
                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-[11px] text-amber-700">⏳ Waiting for review</span>
                      <button
                        type="button"
                        onClick={async () => {
                          const director = club.members.find((m) => m.role === "owner");
                          const ok = await confirmDialog({
                            title: "Cancel join request?",
                            message: `${club.name} won't be notified — your pending request is just withdrawn. You can request again later${director ? ` (the director ${director.player.name} can also accept it any time before you cancel)` : ""}.`,
                            confirmText: "Cancel request",
                            cancelText: "Keep waiting",
                            danger: true,
                          });
                          if (!ok) return;
                          const r = await fetch(`/api/clubs/${id}/join-request`, { method: "DELETE" });
                          if (r.ok) { setMyPendingRequest(false); fetchClub(); }
                          else { const d = await r.json().catch(() => ({})); await alertDialog(d.error || "Failed to cancel request", "Error"); }
                        }}
                        className="text-[11px] text-amber-700 font-medium bg-amber-50 hover:bg-amber-100 px-2 py-1 rounded-lg underline"
                      >cancel</button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={async () => {
                        const director = club.members.find((m) => m.role === "owner");
                        const ok = await confirmDialog({
                          title: `Request to join ${club.name}?`,
                          message:
                            `Your name and profile will be sent to ${director ? director.player.name : "the club director"} for approval. ` +
                            `You'll get access to the club's members, events and feed once they accept. ` +
                            `You can cancel this request any time before it's reviewed.`,
                          confirmText: "Send request",
                          cancelText: "Not now",
                        });
                        if (!ok) return;
                        const r = await fetch(`/api/clubs/${id}/join-request`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
                        if (r.ok) { setMyPendingRequest(true); fetchClub(); }
                        else { const d = await r.json().catch(() => ({})); await alertDialog(d.error || "Failed", "Error"); }
                      }}
                      className="mt-1 text-xs text-action font-medium px-3 py-1.5 rounded-lg border border-action/30 hover:bg-action/5"
                    >Request to Join</button>
                  )
                ) : null}
              </div>
              {/* Right column: Edit at the top, Leave at the bottom.
                  Both live in the header area above the cover photo so
                  the user has the destructive action far away from the
                  editing action. Hidden for the owner — they need to
                  transfer directorship first (API enforces). */}
              <div className="flex flex-col justify-between items-end shrink-0">
                {canManage ? (
                  <button onClick={() => { setShowInfo(true); startEditing(); }} className="text-muted hover:text-foreground p-1">
                    <PenIcon />
                  </button>
                ) : <span />}
                {myMembership && myMembership.role !== "owner" && userId ? (
                  <button
                    type="button"
                    onClick={() => removeMember(userId, session?.user?.name || undefined)}
                    className="text-[11px] text-danger hover:underline"
                  >Leave club</button>
                ) : <span />}
              </div>
            </div>
            {club.coverUrl && <img src={club.coverUrl} alt="" className="w-full h-28 object-cover" />}
            <div className="p-3 space-y-2">
              {club.description && <p className="text-sm text-muted">{club.description}</p>}
              {(club.city || club.country) && <p className="text-sm text-muted">{[club.city, club.country].filter(Boolean).join(", ")}</p>}
              {club.locations && club.locations.length > 0 && (
                <div className="space-y-1">
                  {club.locations.map((loc: { id: string; name: string; googleMapsUrl?: string | null }) => (
                    <div key={loc.id}>
                      {loc.googleMapsUrl ? (
                        <a href={loc.googleMapsUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-action hover:underline">📍 {loc.name}</a>
                      ) : (
                        <span className="text-sm text-muted">📍 {loc.name}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Clickable sections */}
          <div className="space-y-1.5">
            <div className={`w-full ${frameClass} p-3 flex items-center gap-3`}>
              <Link href={`/events?club=${id}`} className="flex items-center gap-3 flex-1 active:opacity-70">
                <span className="text-xl">📅</span>
                <span className="text-sm font-semibold flex-1 text-left">Club Events</span>
                <span className="text-xs text-muted">{events.length}</span>
                <span className="text-muted">›</span>
              </Link>
              {canManage && (
                <Link href={`/events/new?clubId=${id}`} className="text-xs text-action font-medium px-2 py-1 rounded-lg border border-action/30 hover:bg-action/5 shrink-0">+ Add</Link>
              )}
            </div>
            <button onClick={() => { setTab("members"); window.history.replaceState(null, "", `?tab=members`); }}
              className={`w-full ${frameClass} p-3 flex items-center gap-3 active:bg-gray-50 transition-colors`}>
              <span className="text-xl">👥</span>
              <span className="text-sm font-semibold flex-1 text-left">Club Members</span>
              {/* Total + male / female counts. The colours mirror the
                  gender icon in the member row (blue ♂ / pink ♀). */}
              {(() => {
                const total = club.members.length;
                const males = club.members.filter((m) => m.player.gender === "M").length;
                const females = club.members.filter((m) => m.player.gender === "F").length;
                return (
                  <span className="text-xs text-muted flex items-center gap-1.5">
                    <span className="tabular-nums">{total}</span>
                    {(males > 0 || females > 0) && (
                      <>
                        <span className="text-blue-500 tabular-nums">{males}♂</span>
                        <span className="text-pink-500 tabular-nums">{females}♀</span>
                      </>
                    )}
                  </span>
                );
              })()}
              <span className="text-muted">›</span>
            </button>
            <button onClick={() => { setTab("rankings"); window.history.replaceState(null, "", `?tab=rankings`); }}
              className={`w-full ${frameClass} p-3 flex items-center gap-3 active:bg-gray-50 transition-colors`}>
              <span className="text-xl">📊</span>
              <span className="text-sm font-semibold flex-1 text-left">Club Rankings</span>
              <span className="text-xs text-muted">{rankings.ranked.length} ranked</span>
              <span className="text-muted">›</span>
            </button>
          </div>

          {/* Join requests alert — links to the dedicated Requests tab */}
          {canManage && pendingCount > 0 && (
            <button onClick={() => { setTab("requests"); window.history.replaceState(null, "", `?tab=requests`); }}
              className="w-full bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-center gap-2 active:bg-amber-100">
              <span className="text-lg">👋</span>
              <span className="text-sm font-medium text-amber-800 flex-1 text-left">
                {pendingCount} pending join request{pendingCount !== 1 ? "s" : ""}
              </span>
              <span className="text-xs text-amber-600">View ›</span>
            </button>
          )}
          {/* New post */}
          <div className={`${frameClass} p-3 space-y-2`}>
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
                <LongPressDelete key={post.id} canDelete={canDeletePost} onDelete={() => deletePost(post.id)}>
                  <div className={`${frameClass} p-3 space-y-2`}>
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
                            <LongPressDelete key={c.id} canDelete={canDeleteComment} onDelete={() => deleteComment(post.id, c.id)}>
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
          <Link href={`/events?club=${id}`}
            className="block w-full py-2.5 text-center rounded-xl text-sm font-medium text-primary border border-primary/30 hover:bg-primary/5 transition-colors">
            View all {club.name} events →
          </Link>
        </div>
      )}

      {/* ── Members Tab ── */}
      {tab === "members" && !showInfo && (
        <div className="space-y-3">
          {/* Header row: "Members" title always visible; the + Member
              action is admin-only. Right side gets an empty spacer for
              normal users so the title sits at the same Y as in the
              manager view. */}
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-foreground">Members</h3>
            {canManage && (
              <button
                onClick={() => {
                  fetchAllPlayers();
                  setAddMemberSearch("");
                  setAddMemberGender(null);
                  // Default country filter to the signed-in user's country
                  // when known; falls back to "all countries" otherwise.
                  setAddMemberCountry(
                    (session?.user as { country?: string | null } | undefined)?.country || "",
                  );
                  setPendingMemberIds(new Set());
                  setAddedMemberIds(new Set());
                  setShowAddMember(true);
                }}
                className="text-action border border-action/30 px-4 py-2 rounded-lg font-medium text-sm hover:bg-action/5 active:bg-action/10 transition-colors"
              >
                + Member
              </button>
            )}
          </div>
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
            <p className="text-xs text-muted">
              {filteredMembers.length} member{filteredMembers.length !== 1 ? "s" : ""}
            </p>
            {canManage && (
              <button onClick={async () => {
                const r = await fetch(`/api/clubs/${club.id}/invite`, { method: "POST" });
                if (!r.ok) return;
                const invite = await r.json();
                const url = `${window.location.origin}/clubs/join/${invite.token}`;
                const inviterName = session?.user?.name || "A club member";
                // Pre-formatted message — what actually lands on the
                // clipboard. Includes who is inviting, the club, and the
                // join URL so recipients have full context.
                const message =
                  `${inviterName} invites you to join the club "${club.name}" on FriendlyBall — the pickleball app.\n\n` +
                  `Tap the link to accept:\n${url}`;
                const copied = await copyText(message);
                // Show a how-to popup with the exact text that was copied,
                // plus a quick guide on where to paste it.
                await alertDialog(
                  copied
                    ? `${message}\n\n— — — — — — — — —\n\nCopied to your clipboard. Paste into WhatsApp, email, SMS, or any chat. The link is specific to "${club.name}" — the recipient lands directly on this club's join page.`
                    : `${message}\n\n— — — — — — — — —\n\nSelect and copy the text above, then paste into WhatsApp, email, SMS, or any chat. The link is specific to "${club.name}".`,
                  "Invite link ready",
                  { messageSize: "xs" },
                );
              }} className="text-xs text-action font-medium">Copy_Invite_Link</button>
            )}
          </div>

          <div className="space-y-1">
            {filteredMembers.map((m) => (
              <SwipeableMemberRow
                key={m.id}
                member={m}
                canManage={canManage}
                isOwner={isOwner}
                isGlobalAdmin={isGlobalAdmin}
                isSelf={m.playerId === userId}
                showContact={isGlobalAdmin || m.playerId === userId}
                onRemove={() => removeMember(m.playerId, m.player.name)}
                onRoleChange={(role) => updateRole(m.playerId, role)}
              />
            ))}
          </div>

        </div>
      )}

      {/* ── Requests Tab — admin-only, lists pending join requests so
           directors can accept/decline without scrolling the members
           list. Falls back to Members tab if requests no longer exist
           (e.g. all handled). ── */}
      {tab === "requests" && !showInfo && canManage && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-foreground">Pending join requests</h3>
            <span className="text-[11px] text-muted">{pendingCount}</span>
          </div>
          {pendingCount === 0 ? (
            <div className={`${frameClass} p-4 text-center text-sm text-muted`}>
              No pending requests. They&apos;ll show up here automatically.
            </div>
          ) : (
            <div className="space-y-2">
              {joinRequests.filter((r) => r.status === "pending").map((req) => (
                <div key={req.id} className={`${frameClass} p-3 flex items-center gap-2`}>
                  <PlayerAvatar name={req.player.name} size="sm" />
                  {req.player.gender && (
                    <span className={`text-xs shrink-0 ${req.player.gender === "F" ? "text-pink-500" : "text-blue-500"}`}>
                      {req.player.gender === "F" ? "♀" : "♂"}
                    </span>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{req.player.name}</div>
                    {req.message && <p className="text-[11px] text-muted truncate">{req.message}</p>}
                  </div>
                  <button
                    onClick={async () => {
                      const r = await fetch(`/api/clubs/${club!.id}/join-request`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ requestId: req.id, action: "accept" }),
                      });
                      if (!r.ok) { const d = await r.json().catch(() => ({})); await alertDialog(d.error || "Failed", "Error"); return; }
                      setJoinRequests((prev) => prev.map((rr) => rr.id === req.id ? { ...rr, status: "accepted" } : rr));
                      fetchClub();
                    }}
                    className="text-xs bg-green-600 text-white px-3 py-1.5 rounded-lg font-medium"
                  >Accept</button>
                  <button
                    onClick={async () => {
                      const ok = await confirmDialog({
                        title: `Decline ${req.player.name}?`,
                        message: `${req.player.name} won't be notified, but they can request again later.`,
                        confirmText: "Decline",
                        cancelText: "Cancel",
                        danger: true,
                      });
                      if (!ok) return;
                      const r = await fetch(`/api/clubs/${club!.id}/join-request`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ requestId: req.id, action: "decline" }),
                      });
                      if (!r.ok) { const d = await r.json().catch(() => ({})); await alertDialog(d.error || "Failed", "Error"); return; }
                      setJoinRequests((prev) => prev.map((rr) => rr.id === req.id ? { ...rr, status: "declined" } : rr));
                    }}
                    className="text-xs text-danger px-3 py-1.5 rounded-lg hover:bg-red-50"
                  >Decline</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Rankings Tab ── */}
      {tab === "rankings" && !showInfo && (
        <div className="space-y-2">
          {/* Filters — same as members */}
          <div className="flex gap-2">
            <ClearInput value={memberSearch} onChange={setMemberSearch} placeholder="Search players..." className="text-sm" />
            {(["M", "F"] as const).map((g) => (
              <button key={g} onClick={() => setMemberGender(memberGender === g ? null : g)}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                  memberGender === g ? "bg-selected text-white" : "bg-gray-100 text-foreground hover:bg-gray-200"
                }`}>{g === "M" ? "♂" : "♀"}</button>
            ))}
          </div>
          {(() => {
            const filterPlayer = (p: { name: string; gender?: string | null }) =>
              (!memberSearch || nameMatchesSearch(p.name, memberSearch)) &&
              (!memberGender || p.gender === memberGender);
            const filteredRanked = rankings.ranked.filter(filterPlayer);
            const filteredUnranked = rankings.unranked.filter(filterPlayer);
            return filteredRanked.length === 0 && filteredUnranked.length === 0 ? (
            <div className="text-center py-8">
              <div className="text-4xl mb-2">🏆</div>
              <p className="text-muted">{rankings.ranked.length === 0 ? "No ranked players yet" : "No players match filter"}</p>
            </div>
          ) : (
            <>
            {filteredRanked.map((p, i) => (
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
            ))}

          {filteredUnranked.length > 0 && (
            <>
              <h3 className="text-xs font-medium text-muted mt-4">Unranked ({filteredUnranked.length})</h3>
              {filteredUnranked.map((p) => (
                <div key={p.id} className={`${frameClass} p-3 flex items-center gap-3 opacity-50`}>
                  <span className="text-xl w-8 text-center">-</span>
                  <PlayerAvatar name={p.name} photoUrl={p.photoUrl} size="sm" />
                  <span className="font-medium text-sm flex-1">{p.name}</span>
                  <span className="text-sm text-muted">1000</span>
                </div>
              ))}
            </>
          )}
          </>
          );
          })()}
        </div>
      )}

      {/* Settings tab removed — club info is now via ℹ icon */}
    </div>
  );
}
