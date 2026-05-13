"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useEffect, useState, useCallback, useRef, type ReactNode } from "react";
import { useSession } from "next-auth/react";
import { useConfirm } from "@/components/ConfirmDialog";
import useSWR from "swr";
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { getPreview, setPreview } from "@/lib/entityPreview";
import { eventDisplayLabel, normalizeEventStatus } from "@/lib/statusDisplay";
import { leagueShortName } from "@/lib/leagueDisplay";
import { ShareSheet, type ShareRecipient } from "@/components/ShareSheet";
import { ShareInviteModal } from "@/components/ShareInviteModal";
import { buildEventInviteGroup, buildEventInvitePersonal, buildMatchDayShare, type EventInviteContext, type MatchDayShareGame } from "@/lib/inviteShare";
import { useHideBottomNav, usePollingRefresh } from "@/lib/hooks";
import { PenIcon } from "@/components/PenIcon";
import { useViewRole, hasRole } from "@/components/RoleToggle";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { ClearInput } from "@/components/ClearInput";
import { PlayerSelector } from "@/components/PlayerSelector";
import { ClubBadge } from "@/components/ClubBadge";
import { CompetitionView } from "@/components/CompetitionView";
import { SpeakerMode, sendAnnouncement, formatMatchAnnouncement, stopAnnouncement } from "@/components/SpeakerMode";
import { ClassesManager } from "@/components/ClassesManager";
import { ClassStepFlow } from "@/components/class-steps/ClassStepFlow";
import { SessionsManager } from "@/components/SessionsManager";
import { CompetitionResults } from "@/components/CompetitionResults";
import { ScorerTracker } from "@/components/ScorerTracker";
import Logo from "@/components/Logo";
import { ScorePicker, isValidPair } from "@/components/ScorePicker";
import { AppHeader, type HeaderStatus } from "@/components/AppHeader";
import { frameClass } from "@/components/Card";
import { DurationStepper } from "@/components/DurationStepper";
import { WhatsAppIcon } from "@/components/WhatsAppIcon";
import { nameMatchesSearch } from "@/lib/searchUtil";
import { copyText } from "@/lib/clipboard";
import { COUNTRIES } from "@/lib/countries";

interface Player {
  id: string;
  name: string;
  emoji: string;
  photoUrl?: string | null;
  rating: number;
  globalRating?: number | null;
  globalRatingConfidence?: number;
  duprRating?: number | null;
  role?: string;
  gender?: string | null;
  phone?: string | null;
  hasAccount?: boolean;
  country?: string | null;
  clubs?: { id: string; name: string; emoji: string; role: string }[];
}

interface MatchPlayer {
  id: string;
  playerId: string;
  team: number;
  score: number;
  player: Player;
}

interface Match {
  id: string;
  courtNum: number;
  round: number;
  status: string;
  players: MatchPlayer[];
  scoreConfirmed?: boolean;
  team1Confirmed?: boolean;
  team2Confirmed?: boolean;
  startedAt?: string | null;
  completedAt?: string | null;
  rankingMode?: string;
  matchFormat?: string | null;
  classId?: string | null;
  scorerId?: string | null;
  scorer?: { id: string; name: string; photoUrl?: string | null } | null;
  leagueGame?: { id: string; kind: "principal" | "league" | "extra"; slotNumber: number; scheduledAt?: string | null; courtNum?: number | null; category: { id: string; name: string } } | null;
}

// In the new model the Event itself is the match-day. `round` is on Event,
// and the two playing teams hang off Event.leagueTeams.
interface LeagueRoundLink {
  id: string; roundNumber: number; name: string | null;
  matchDurationMin?: number | null;
  league: {
    id: string; name: string; shortName?: string | null; season: string | null;
    createdById: string | null; deputyId: string | null;
    matchDurationMin?: number | null;
    categories?: { id: string; name: string; format: string; gender: string; matchDurationMin?: number | null }[];
    teams?: {
      id: string;
      name: string;
      captainId: string | null;
      viceCaptainId: string | null;
      players: { playerId: string; player: { id: string; name: string; photoUrl: string | null; gender: string | null } }[];
    }[];
    helpers?: { playerId: string }[];
  };
}
interface LeagueEventTeamLink {
  teamId: string;
  lineupReady?: boolean;
  team: { id: string; name: string; logoUrl: string | null };
}

interface EventHelper {
  playerId: string;
  player: Player;
}

interface PairPlayer {
  id: string;
  name: string;
  emoji: string;
  rating: number;
  gender?: string | null;
}

interface EventPair {
  id: string;
  player1: PairPlayer;
  player2: PairPlayer;
}

interface ClubLocation {
  id: string;
  name: string;
  googleMapsUrl?: string | null;
}

interface EventClassData {
  id: string;
  name: string;
  isDefault: boolean;
  format: string;
  gender: string;
  ageGroup: string;
  scoringFormat: string;
  winBy?: string;
  pairingMode: string;
  playMode?: string;
  prioSpeed?: boolean;
  prioFairness?: boolean;
  prioSkill?: boolean;
  rankingMode: string;
  minPlayers?: number | null;
  maxPlayers?: number | null;
  competitionMode?: string | null;
  competitionConfig?: Record<string, unknown> | null;
  competitionPhase?: string | null;
}

interface Event {
  id: string;
  name: string;
  date: string;
  endDate: string | null;
  status: string;
  numCourts: number;
  openSignup: boolean;
  visibility: string;
  createdById: string | null;
  createdBy?: { id: string; name: string; emoji: string } | null;
  players: { playerId?: string; player: Player; classId?: string | null; status: string; skillLevel?: number | null; signupPreferences?: Record<string, { level: "prefer" | "ok" | "no"; note?: string }> | null }[];
  matches: Match[];
  helpers: EventHelper[];
  pairs: EventPair[];
  classes: EventClassData[];
  locationId?: string | null;
  club?: { id: string; name: string; shortName?: string | null; emoji: string; logoUrl?: string | null; locations: ClubLocation[] } | null;
  // Legacy compat — derived from default class
  format: string;
  scoringFormat: string;
  pairingMode: string;
  rankingMode?: string;
  competitionMode?: string | null;
  competitionConfig?: Record<string, unknown> | null;
  competitionPhase?: string | null;
  round?: LeagueRoundLink | null;
  leagueTeams?: LeagueEventTeamLink[];
  hostTeamId?: string | null;
  lineupTotalLocked?: boolean;
  // Flat list of league games (per-category match slots) for this event.
  // Used by the participants list to flag who is/isn't in a lineup yet.
  // gamePlayers is filtered server-side to the viewer's side until both
  // teams flip lineupReady, so this stays privacy-safe.
  leagueGames?: {
    id: string;
    categoryId: string;
    team1Id: string;
    team2Id: string;
    team1Wants?: boolean | null;
    team2Wants?: boolean | null;
    slotNumber?: number;
    kind?: "principal" | "league" | "extra";
    scheduledAt?: string | null;
    courtNum?: number | null;
    displayOrder?: number | null;
    winnerId?: string | null;
    scheduleAnchored?: boolean;
    gamePlayers: { playerId: string; team?: number | null; player?: { id: string; name: string } }[];
  }[];
  matchDurationMin?: number | null;
  /** Per-event per-category match-duration overrides. */
  categoryDurationOverrides?: Record<string, number> | null;
  /** Per-court start times, keyed by court number as a string. */
  courtStartTimes?: Record<string, string> | null;
  // Linked social side event. Present (single item) on league events
  // where the operator opted into running a parallel social event.
  socialEvents?: { id: string; name: string; status: string }[];
  // Inverse: when this event IS a social side, link back to its league
  // parent so the page can show a "← back to league event" affordance.
  socialOf?: { id: string; name: string } | null;
}

function toDateInput(iso: string) {
  return new Date(iso).toISOString().split("T")[0];
}

function toTimeInput(iso: string) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// Compact label for a league category in narrow UI ("Mixed Doubles" →
// "Mixed", "Men's Doubles" → "Men's"). "Singles"-style names are left
// alone since the noun is already unambiguous.
function shortCategoryName(name: string): string {
  return name.replace(/\s+Doubles\s*$/i, "").trim() || name;
}

function speakMatch(match: Match, event: Event) {
  if (!("speechSynthesis" in window)) return;
  const team1 = match.players.filter((p) => p.team === 1);
  const team2 = match.players.filter((p) => p.team === 2);
  const team1Names = team1.map((p) => p.player.name).join(" and ");
  const team2Names = team2.map((p) => p.player.name).join(" and ");
  const courtLabel = event.pairingMode === "king_of_court" && match.courtNum === 1
    ? "King Court"
    : `Court ${match.courtNum}`;
  const text = `${courtLabel}: ${team1Names} versus ${team2Names}`;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.9;
  utterance.lang = "en-US";
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
}

function speakRound(matches: Match[], event: Event) {
  if (!("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const parts: string[] = [];
  for (const match of matches.sort((a, b) => a.courtNum - b.courtNum)) {
    const team1 = match.players.filter((p) => p.team === 1);
    const team2 = match.players.filter((p) => p.team === 2);
    const team1Names = team1.map((p) => p.player.name).join(" and ");
    const team2Names = team2.map((p) => p.player.name).join(" and ");
    const courtLabel = event.pairingMode === "king_of_court" && match.courtNum === 1
      ? "King Court"
      : `Court ${match.courtNum}`;
    parts.push(`${courtLabel}: ${team1Names} versus ${team2Names}`);
  }
  const utterance = new SpeechSynthesisUtterance(parts.join(". "));
  utterance.rate = 0.9;
  utterance.lang = "en-US";
  speechSynthesis.speak(utterance);
}

function SwipeablePlayerRow({
  ep,
  canManage,
  hasMatches,
  onPause,
  onRemove,
  onCheckIn,
  skillLevel,
  onSkillLevel,
  isSelf,
}: {
  ep: { player: Player; status: string; skillLevel?: number | null };
  canManage: boolean;
  hasMatches: boolean;
  onPause: () => void;
  onRemove: () => void;
  onCheckIn?: () => void;
  skillLevel?: number | null;
  onSkillLevel?: (level: number | null) => void;
  isSelf?: boolean;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const swipeOffset = useRef(0);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLongPress = useRef(false);
  const [localPaused, setLocalPaused] = useState(ep.status === "paused");

  // Sync with prop when it changes (after API response)
  useEffect(() => {
    setLocalPaused(ep.status === "paused");
  }, [ep.status]);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (!canManage) return;
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    swipeOffset.current = 0;
    isLongPress.current = false;
    longPressTimer.current = setTimeout(() => {
      isLongPress.current = true;
      // Instantly toggle visual state
      setLocalPaused((prev) => !prev);
      if (navigator.vibrate) navigator.vibrate(50);
      // Then fire the API call
      onPause();
    }, 600);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!canManage) return;
    const dx = e.touches[0].clientX - touchStartX.current;
    const dy = e.touches[0].clientY - touchStartY.current;
    // If scrolling vertically, cancel gestures
    if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
      return;
    }
    // Cancel long-press if finger moves
    if (Math.abs(dx) > 10) {
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
    }
    if (dx < 0 && !hasMatches) {
      swipeOffset.current = dx;
      if (rowRef.current) {
        rowRef.current.style.transform = `translateX(${Math.max(dx, -100)}px)`;
      }
    }
  };

  const handleTouchEnd = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    if (isLongPress.current) return;
    if (swipeOffset.current < -80 && !hasMatches && canManage) {
      if (confirm(`Remove ${ep.player.name} from this event?`)) {
        onRemove();
      }
    }
    if (rowRef.current) {
      rowRef.current.style.transform = "";
    }
    swipeOffset.current = 0;
  };

  return (
    <div
      ref={rowRef}
      className={`group flex items-center gap-2 rounded-lg px-3 py-1 transition-all select-none ${
        localPaused ? "opacity-40 bg-gray-100" : ep.status === "registered" ? "opacity-60" : ""
      }`}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <span className={`relative shrink-0 ${ep.status === "registered" ? "opacity-40" : ""}`}>
        <PlayerAvatar name={ep.player.name} photoUrl={ep.player.photoUrl} size="sm" />
        {(ep.status === "checked_in" || localPaused) && (
          <span className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full flex items-center justify-center text-[8px] font-bold ${
            localPaused ? "bg-green-300 text-white" : "bg-green-500 text-white"
          }`}>✓</span>
        )}
      </span>
      {/* Name + role pill inline */}
      <span className={`text-lg flex-1 flex items-center gap-1.5 ${localPaused ? "line-through text-muted" : ep.status === "registered" ? "text-muted" : ""} ${isSelf ? "text-action font-bold" : "font-medium"}`}>
        {ep.player.name}
        {ep.player.role === "admin" && (
          <span className="text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full font-medium">Admin</span>
        )}
      </span>
      {/* Rating column */}
      <span className="text-xs text-muted tabular-nums w-8 text-right shrink-0">
        {typeof ep.player.rating === "number" ? Math.round(ep.player.rating) : ""}
      </span>
      {/* Status column */}
      <span className="w-14 shrink-0 text-right">
        {localPaused ? (
          <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-medium">Paused</span>
        ) : ep.status === "checked_in" ? (
          <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-medium">In</span>
        ) : ep.status === "waitlisted" ? (
          <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-medium">Wait</span>
        ) : ep.status === "registered" && canManage && onCheckIn ? (
          <button onClick={(e) => { e.stopPropagation(); onCheckIn(); }} className="text-[10px] bg-green-50 text-green-700 border border-green-300 px-1.5 py-0.5 rounded-full font-medium active:bg-green-200">Check in</button>
        ) : null}
      </span>
      {ep.player.phone && (
        <a
          href={`https://wa.me/${ep.player.phone.replace(/[^0-9+]/g, "").replace(/^\+/, "")}`}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 inline-flex"
          onClick={(e) => e.stopPropagation()}
          aria-label={`WhatsApp ${ep.player.name}`}
        >
          <WhatsAppIcon />
        </a>
      )}
      {/* Skill level */}
      {canManage && onSkillLevel && (
        <div className="flex gap-0.5">
          {[1, 2, 3].map((lvl) => (
            <button key={lvl} onClick={(e) => { e.stopPropagation(); onSkillLevel(skillLevel === lvl ? null : lvl); }}
              className={`w-5 h-5 rounded text-[9px] font-bold ${skillLevel === lvl ? "bg-selected text-white" : "bg-gray-100 text-muted"}`}>{lvl}</button>
          ))}
        </div>
      )}
      {!canManage && skillLevel && (
        <span className="text-[9px] text-muted bg-gray-100 px-1.5 py-0.5 rounded">Lvl {skillLevel}</span>
      )}
      {/* Desktop hover actions (hidden on touch) */}
      {canManage && (
        <div className="hidden group-hover:flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={(e) => { e.stopPropagation(); onPause(); setLocalPaused((p) => !p); }}
            className="text-xs px-2 py-1 rounded bg-amber-50 text-amber-700 hover:bg-amber-100" title={localPaused ? "Unpause" : "Pause"}>
            {localPaused ? "Unpause" : "Pause"}
          </button>
          {!hasMatches && (
            <button onClick={(e) => { e.stopPropagation(); if (confirm(`Remove ${ep.player.name} from this event?`)) onRemove(); }}
              className="text-xs px-2 py-1 rounded bg-red-50 text-danger hover:bg-red-100" title="Remove">
              Remove
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── DnD helpers for the league-event Schedule card (touch-friendly via
// @dnd-kit). Each match card is a `ScheduleDraggable` that takes a grip
// handle on the left edge; each court column is a `ScheduleDroppable`.
function ScheduleDraggable({ id, children, dragging, enabled }: { id: string; children: ReactNode; dragging?: boolean; enabled?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id, disabled: !enabled });
  const isMe = isDragging || !!dragging;
  const style: React.CSSProperties = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: isMe ? 50 : undefined }
    : {};
  return (
    <div ref={setNodeRef} style={style} className={`relative ${isMe ? "opacity-40" : ""}`}>
      {/* Grip — the @dnd-kit activator. Only rendered when `enabled` so
          read-only viewers (e.g. away-team captain) can't initiate
          drag. touchAction: none lets the handle start a touch drag
          without the browser scrolling the page. */}
      {enabled && (
        <div
          {...attributes}
          {...listeners}
          style={{ touchAction: "none" }}
          title="Drag to move"
          className="absolute left-0 top-0 bottom-0 w-6 z-10 flex items-center justify-center text-muted cursor-grab active:cursor-grabbing select-none rounded-l-lg hover:bg-gray-50"
        >
          <span className="text-[14px] leading-none">⠿</span>
        </div>
      )}
      {children}
    </div>
  );
}

function ScheduleDroppable({ id, children, className, highlightClass }: { id: string; children: ReactNode; className?: string; highlightClass?: string }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={`${className || ""} ${isOver ? (highlightClass || "ring-2 ring-blue-300 bg-blue-50") : ""}`}>
      {children}
    </div>
  );
}

export default function EventDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { confirm: confirmDialog, alert: alertDialog } = useConfirm();
  const { data: session } = useSession();
  const { viewRole } = useViewRole();
  const isAdmin = session?.user?.role === "admin" && hasRole(viewRole, "admin");

  // Notification count for the hero header (mirrors Header.tsx polling).
  const [heroUnread, setHeroUnread] = useState(0);
  const checkUnread = useCallback(async () => {
    if (!session?.user) return;
    try {
      const r = await fetch("/api/notifications");
      if (!r.ok) return;
      const data = await r.json();
      if (Array.isArray(data)) setHeroUnread(data.filter((n: { read: boolean }) => !n.read).length);
    } catch { /* ignore */ }
  }, [session?.user]);
  useEffect(() => { checkUnread(); }, [checkUnread]);
  usePollingRefresh(checkUnread, 30000, !!session?.user);

  // Remember last visited page + read referrer
  useEffect(() => {
    if (typeof window !== "undefined" && id) localStorage.setItem("pickleplay_lastPage", `/events/${id}`);
  }, [id]);

  const userId = (session?.user as { id?: string } | undefined)?.id;

  // Preview cache lookup. When a user clicks on an event card, the list
  // page stores a minimal event summary under `event:<id>`. We read it here
  // so the detail page can render a header card immediately on first paint
  // instead of showing "Loading..." for the full round-trip. The preview is
  // used ONLY for the loading state's header — the main render still waits
  // for the full /api/events/[id] response because many sections (matches,
  // players, pairs) need fields that aren't in the list response.
  const preview = typeof id === "string" ? getPreview<Event>("event", id) : null;
  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [focusedMatchId, setFocusedMatchId] = useState<string | null>(null);
  const swrEvent = useSWR(
    id ? `/api/events/${id}` : null,
    async (url: string) => {
      const r = await fetch(url);
      if (!r.ok) {
        // Bubble up the actual status + server message so the error
        // card can show real diagnostics (500 vs 404 vs 401).
        let msg = `HTTP ${r.status}`;
        try {
          const d = await r.json();
          if (d?.error) msg = `${d.error} (HTTP ${r.status})`;
        } catch { /* response wasn't JSON — keep status-only message */ }
        throw new Error(msg);
      }
      return r.json();
    },
    { revalidateOnFocus: true, dedupingInterval: 2000, refreshInterval: focusedMatchId ? 5000 : 30000 },
  );
  const [generating, setGenerating] = useState(false);
  const [scores, setScores] = useState<Record<string, { team1: string; team2: string }>>({});
  const [editingEvent, setEditingEvent] = useState(false);
  const [hasEdits, setHasEdits] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editName, setEditName] = useState("");
  const [editStatus, setEditStatus] = useState("setup");
  const [editCourts, setEditCourts] = useState(2);
  const [editLocationId, setEditLocationId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editTime, setEditTime] = useState("");
  const [editEndTime, setEditEndTime] = useState("");
  const [editEndDate, setEditEndDate] = useState("");
  const [editingMatchId, setEditingMatchId] = useState<string | null>(null);
  const [playerSearch, setPlayerSearch] = useState("");
  const [playerGenderFilter, setPlayerGenderFilter] = useState<string | null>(null);
  // For league events: filter the participants list by which team they're on.
  // null = both teams. "home" = host team (first leagueTeam if no hostTeamId).
  // "away" = the other team.
  const [playerTeamFilter, setPlayerTeamFilter] = useState<"home" | "away" | null>(null);
  const [showAddPlayer, setShowAddPlayer] = useState(false);
  const [bulkSelectMode, setBulkSelectMode] = useState(false);
  // Multi-select state for the captain's "+ Add player" picker on the
  // league participants list. Player ids only — keyed by team is unnecessary
  // since playerIds are globally unique.
  const [rosterAddSelected, setRosterAddSelected] = useState<Set<string>>(new Set());
  const [rosterAddSaving, setRosterAddSaving] = useState(false);
  // Guest add — full-page picker. Mirrors the Add Players UX (country +
  // club + gender filters, search, staging tray with batch save). One
  // picker is open at a time; addGuestTeamId says which team the staged
  // guests are tagged to. Intent ("social" | "attending") is per staged
  // player (default "social"), toggleable on each chip.
  const [showAddGuest, setShowAddGuest] = useState(false);
  const [addGuestTeamId, setAddGuestTeamId] = useState<string | null>(null);
  const [addGuestSearch, setAddGuestSearch] = useState("");
  const [addGuestGender, setAddGuestGender] = useState<"M" | "F" | null>(null);
  const [addGuestCountry, setAddGuestCountry] = useState<string>("");
  const [addGuestClubFilter, setAddGuestClubFilter] = useState<"all" | "club">("club");
  const [pendingGuestEntries, setPendingGuestEntries] = useState<Map<string, "social" | "attending">>(new Map());
  const [addedGuestIds, setAddedGuestIds] = useState<Set<string>>(new Set());
  const [savingGuests, setSavingGuests] = useState(false);
  // Players who have signed up to ANY prior match-day in this league.
  // Drives the "Recent" scope of the guest picker. Populated once when
  // the event has a league context (see useEffect below).
  const [leagueRecentPlayerIds, setLeagueRecentPlayerIds] = useState<Set<string>>(new Set());
  const [bulkGenderFilter, setBulkGenderFilter] = useState<string | null>(null);
  const [bulkSearch, setBulkSearch] = useState("");
  const [allPlayers, setAllPlayers] = useState<Player[]>([]);
  const [addPlayerSearch, setAddPlayerSearch] = useState("");
  const [addPlayerGender, setAddPlayerGender] = useState<"M" | "F" | null>(null);
  const [addPlayerClubFilter, setAddPlayerClubFilter] = useState<"all" | "club">("club");
  // Country filter — defaults to the signed-in user's country on open.
  const [addPlayerCountry, setAddPlayerCountry] = useState<string>("");
  // Staging tray for the new picker pattern. Tap a row → adds the
  // player id here. Tap "Add N players" → POSTs everything in one go.
  const [pendingPlayerIds, setPendingPlayerIds] = useState<Set<string>>(new Set());
  const [addedPlayerIds, setAddedPlayerIds] = useState<Set<string>>(new Set());
  const [savingPlayers, setSavingPlayers] = useState(false);
  const [editFormat, setEditFormat] = useState("doubles");
  const [editScoringFormat, setEditScoringFormat] = useState("1x11");
  const [editWinBy, setEditWinBy] = useState("2");
  // Empty string = no cap. Numeric string (e.g., "15") = cap minutes per match.
  const [editMaxMinutes, setEditMaxMinutes] = useState<string>("");
  const [editPairingMode, setEditPairingMode] = useState("random");
  const [editPlayMode, setEditPlayMode] = useState("round_based");
  // New pairing fields, persisted as EventClass.pairingSettings JSON.
  const [editBaseMode, setEditBaseMode] = useState<"king" | "random" | "skill" | "manual">("king");
  const [editTeams, setEditTeams] = useState<"rotating" | "fixed">("rotating");
  const [editGender, setEditGender] = useState<"random" | "mixed" | "same">("random");
  const [editSkillWindow, setEditSkillWindow] = useState<number | "inf">(1);
  const [editPrioSpeed, setEditPrioSpeed] = useState(true);
  const [editPrioFairness, setEditPrioFairness] = useState(true);
  const [editPrioSkill, setEditPrioSkill] = useState(true);
  const [editPrioVariety, setEditPrioVariety] = useState(false);
  const [editRankingMode, setEditRankingMode] = useState("ranked");
  const [editCompetitionMode, setEditCompetitionMode] = useState<boolean>(false);
  const [editSkillSource, setEditSkillSource] = useState<"rating" | "manual">("rating");
  const [levelDragId, setLevelDragId] = useState<string | null>(null);
  const [levelDragOver, setLevelDragOver] = useState<number | "unset" | null>(null);
  const [levelSelectedIds, setLevelSelectedIds] = useState<Set<string>>(new Set());
  const [expandedEmptyLevels, setExpandedEmptyLevels] = useState<Set<number | "unset">>(new Set());
  const [levelEditMode, setLevelEditMode] = useState(false);
  // "Remove Player" mode mirrors the Add picker's staging pattern. When
  // on, tapping a player row's 🗑️ stages them in `pendingRemoveIds` —
  // no row is removed until the manager clicks the red "Remove N"
  // confirm button at the top. Toggle lives next to "Edit levels".
  const [removeMode, setRemoveMode] = useState(false);
  const [pendingRemoveIds, setPendingRemoveIds] = useState<Set<string>>(new Set());
  const [removingPlayers, setRemovingPlayers] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [matchTab, setMatchTab] = useState<"current" | "previous" | "paused" | "future">("current");
  // Match filters on the Matches tab. Empty Set / null = no filter (show
  // all). Kinds is multi-select via pills; gender + format are single-
  // toggle (click again to clear).
  const [matchKindFilter, setMatchKindFilter] = useState<Set<"principal" | "friendly" | "non-league">>(new Set());
  const [matchGenderFilter, setMatchGenderFilter] = useState<"M" | "F" | null>(null);
  const [matchFormatFilter, setMatchFormatFilter] = useState<"singles" | "doubles" | null>(null);
  const [matchPlayerSearch, setMatchPlayerSearch] = useState("");
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [editOpenSignup, setEditOpenSignup] = useState(true);
  const [editVisibility, setEditVisibility] = useState("visible");
  // Share-invite sheet (event sign-up scenario). Holds the open flag —
  // recipient pool + message text are derived from `event` at render
  // time so they always reflect current data.
  const [shareSheetOpen, setShareSheetOpen] = useState(false);
  // Match-day schedule share — opens ShareInviteModal pre-populated
  // with a court-grouped, time-sorted text version of the schedule.
  // Audience is the existing WhatsApp group; payload differs from the
  // invite (which is targeted at unclaimed/cold prospects).
  const [scheduleShare, setScheduleShare] = useState<{ message: string; title: string } | null>(null);
  // Schedule view — effective default match duration. Initialized from
  // the persisted cascade (event override → round override → league
  // default → 45). User edits write back to Event.matchDurationMin,
  // which triggers the server-side auto-recalc of every court.
  const [scheduleDurationMin, setScheduleDurationMin] = useState(45);
  // Event-level explicit override of matchDurationMin, separate from
  // the effective `scheduleDurationMin` (which always carries a usable
  // number via the round→league→45 cascade). null = "inherit"; the
  // stepper renders that as "–" with the inherited value as a hint.
  const [eventDurationOverride, setEventDurationOverride] = useState<number | null>(null);
  const [inheritedDurationMin, setInheritedDurationMin] = useState<number>(45);
  // Drag-and-drop state for the league schedule. `scheduleDragId` is the
  // game being dragged; `scheduleDragOverCol` is the court key (1..N or
  // "unassigned") the cursor is currently over — used to highlight the
  // drop target.
  // The card the user is currently moving via the inline ↑↓←→ D-pad.
  // Replaces the previous drag-and-drop affordance which was unreliable
  // on iPad Safari and fought with horizontal scroll.
  const [movingScheduleId, setMovingScheduleId] = useState<string | null>(null);
  // Per-category duration overrides panel state. Edits are buffered
  // locally until the operator clicks Save (different from the general
  // duration stepper which auto-saves on debounce).
  const [catOverridesOpen, setCatOverridesOpen] = useState(false);
  const [editedCatOverrides, setEditedCatOverrides] = useState<Record<string, number>>({});
  const [savingCatOverrides, setSavingCatOverrides] = useState(false);
  // Optimistic overlay for per-court start times. Keys are the court
  // number as a string; value `null` means "user just cleared this".
  // The displayed courtStartTimes merges these on top of the server
  // copy so picker changes take effect immediately while the PATCH +
  // server-side recalc finishes in the background.
  const [optimisticCourtStartTimes, setOptimisticCourtStartTimes] =
    useState<Record<string, string | null>>({});
  // Counter for schedule-affecting mutations in flight. When >0, the
  // matches view shows a "Recalculating schedule…" spinner so the
  // operator knows the server is reflowing court timelines.
  const [recalcInFlight, setRecalcInFlight] = useState(0);
  // Debounce + abort plumbing for the schedule recalc. We don't fire
  // the PATCH right when the operator twiddles a start-time select —
  // they often touch several pickers in a row. Instead, snapshot the
  // latest desired courtStartTimes payload and start a 1 s timer; if
  // they click again, reset it. If they click any match's "move"
  // (reposition) icon, abandon the pending PATCH entirely — the
  // server-side recalc would clobber their manual placement.
  const recalcTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recalcAbortRef = useRef<AbortController | null>(null);
  const pendingCourtStartTimesRef = useRef<Record<string, string> | null>(null);
  const cancelPendingRecalc = useCallback(() => {
    if (recalcTimerRef.current) {
      clearTimeout(recalcTimerRef.current);
      recalcTimerRef.current = null;
    }
    if (recalcAbortRef.current) {
      recalcAbortRef.current.abort();
      recalcAbortRef.current = null;
    }
    pendingCourtStartTimesRef.current = null;
    // Don't touch the optimistic court-start overlay — the operator's
    // entered times stay visible until SWR mutate replaces them.
    setRecalcInFlight(0);
  }, []);
  // Auto-arrange (deterministic schedule planner) state.
  // policy: how to order the kind buckets. Friendly is always last.
  // preview: per-gameId override map. When non-null the schedule grid
  //   renders the proposed assignment, with Approve/Cancel banner.
  const [arrangePolicy, setArrangePolicy] = useState<"principal-first" | "league-first">("principal-first");
  const [arrangePreview, setArrangePreview] = useState<Record<string, { courtNum: number; displayOrder: number }> | null>(null);
  const [arrangeApplying, setArrangeApplying] = useState(false);
  // Game id currently showing the court-picker popup. Null = no popup open.
  const [courtPickerGameId, setCourtPickerGameId] = useState<string | null>(null);
  const [showAddMatch, setShowAddMatch] = useState(false);
  const [manualTeam1, setManualTeam1] = useState<string[]>([]);
  const [manualTeam2, setManualTeam2] = useState<string[]>([]);
  const [manualCourt, setManualCourt] = useState(1);
  const [editingManualMatchId, setEditingManualMatchId] = useState<string | null>(null);
  const [numRounds, setNumRounds] = useState(1);
  // Initial section: read from `?section=...` so a back link from the
  // sign-up page (or anywhere else) can land the user directly on the
  // Participants/Matches sub-view instead of bouncing them to the
  // overview. We default to overview during SSR and reconcile in a
  // useEffect once searchParams resolves on the client — otherwise the
  // server-rendered HTML for ?section=players hydrates as overview and
  // sticks there.
  const [activeSection, setActiveSection] = useState<"overview" | "when" | "admins" | "scoring" | "pairing" | "players" | "pairs" | "competition" | "rounds" | "manual">("overview");

  // Hide bottom nav on edit/add sub-flows — keep the overview tidy.
  useHideBottomNav(activeSection !== "overview" || showAddPlayer || showAddGuest || bulkSelectMode);

  const [adminSearch, setAdminSearch] = useState("");
  const [pairMode, setPairMode] = useState<"rating" | "level" | "random" | "manual">("rating");
  const [pairMixed, setPairMixed] = useState(false);
  const [generatingPairs, setGeneratingPairs] = useState(false);
  const [manualPairSelect, setManualPairSelect] = useState<string | null>(null);
  const [manualMatchFormat, setManualMatchFormat] = useState("");
  const [manualRankingMode, setManualRankingMode] = useState("");
  const [manualWinBy, setManualWinBy] = useState("");
  const [manualFriendlyInLeague, setManualFriendlyInLeague] = useState(false);
  const [manualLeagueCategoryId, setManualLeagueCategoryId] = useState("");
  const [pairingInProgress, setPairingInProgress] = useState<Set<string>>(new Set());
  const [waGroups, setWaGroups] = useState<{ id: string; name: string }[]>([]);
  const [allWaGroups, setAllWaGroups] = useState<{ id: string; name: string }[]>([]);
  const [newGroupName, setNewGroupName] = useState("");
  const [copiedGroupId, setCopiedGroupId] = useState<string | null>(null);
  const [scorerMatchId, setScorerMatchId] = useState<string | null>(null);
  const [actionSheetMatchId, setActionSheetMatchId] = useState<string | null>(null);
  const [autoOpenScoreTeam, setAutoOpenScoreTeam] = useState<{ matchId: string; team: "team1" | "team2" } | null>(null);
  const [scorerVisible, setScorerVisible] = useState(false);
  const [scorerLiveScore, setScorerLiveScore] = useState<{ team1: number; team2: number; serverId?: string; receiverId?: string } | null>(null);
  const [showAddHelper, setShowAddHelper] = useState(false);

  const isOwner = !!(event && userId && event.createdById === userId) && hasRole(viewRole, "event");
  const isHelper = !!(event && userId && event.helpers?.some((h) => h.playerId === userId)) && hasRole(viewRole, "event");
  // League director/deputy of the league this event is linked to also gets manage rights.
  const leagueOfEvent = event?.round?.league;
  const isLeagueOrganizerOfEvent = !!(userId && leagueOfEvent && (leagueOfEvent.createdById === userId || leagueOfEvent.deputyId === userId)) && hasRole(viewRole, "league");
  const canManage = isAdmin || isOwner || isHelper || isLeagueOrganizerOfEvent;

  // Sync SWR data → local event state with derived fields.
  // Don't silently redirect on error — that masks the real cause
  // (404, 401, 500) and made it look like clicks were "opening the
  // events list". Render an in-place error card instead (see below).
  useEffect(() => {
    if (swrEvent.error) { return; }
    if (!swrEvent.data) return;
    const data = { ...swrEvent.data };
    const defaultClass = data.classes?.find((c: EventClassData) => c.isDefault) || data.classes?.[0];
    if (defaultClass) {
      data.format = defaultClass.format;
      data.scoringFormat = defaultClass.scoringFormat;
      data.pairingMode = defaultClass.pairingMode;
      data.rankingMode = defaultClass.rankingMode;
      data.competitionMode = defaultClass.competitionMode;
      data.competitionConfig = defaultClass.competitionConfig;
      data.competitionPhase = defaultClass.competitionPhase;
    }
    setEvent(data);
    setLoading(false);
    // Refresh the preview cache so navigating away and back uses the latest
    // data as the preview.
    if (typeof id === "string") setPreview("event", id, data);
  }, [swrEvent.data, swrEvent.error, router, id]);

  // fetchEvent = trigger SWR revalidation (used by existing code)
  const fetchEvent = useCallback(() => { swrEvent.mutate(); }, [swrEvent]);

  // Sync the local duration slider from the persisted cascade whenever
  // we load an event. Inheritance: event override → round override →
  // league default → built-in 45. Refs guard against re-syncing once
  // the user starts editing locally.
  const durationLastServerRef = useRef<number | null>(null);
  useEffect(() => {
    const evt = swrEvent.data as Event | undefined;
    if (!evt) return;
    const inherited = evt.round?.matchDurationMin
      ?? evt.round?.league?.matchDurationMin
      ?? 45;
    setInheritedDurationMin(inherited);
    setEventDurationOverride(evt.matchDurationMin ?? null);
    const effective = evt.matchDurationMin ?? inherited;
    if (durationLastServerRef.current !== effective) {
      durationLastServerRef.current = effective;
      setScheduleDurationMin(effective);
    }
  }, [swrEvent.data]);
  // Debounced save: when the explicit override diverges from server
  // truth, PATCH the event after 600ms of stillness. Override = null
  // means "clear", and the server's effective duration falls back to
  // the round/league cascade automatically.
  const overrideLastServerRef = useRef<number | null | undefined>(undefined);
  useEffect(() => {
    const evt = swrEvent.data as Event | undefined;
    if (!evt) return;
    const serverOverride = evt.matchDurationMin ?? null;
    if (overrideLastServerRef.current === undefined) {
      overrideLastServerRef.current = serverOverride;
    }
  }, [swrEvent.data]);
  useEffect(() => {
    if (overrideLastServerRef.current === undefined) return;
    if (overrideLastServerRef.current === eventDurationOverride) return;
    const t = setTimeout(async () => {
      try {
        await fetch(`/api/events/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ matchDurationMin: eventDurationOverride }),
        });
        overrideLastServerRef.current = eventDurationOverride;
        // Effective duration follows the override; otherwise inherited.
        const effective = eventDurationOverride ?? inheritedDurationMin;
        durationLastServerRef.current = effective;
        setScheduleDurationMin(effective);
        fetchEvent();
      } catch { /* silent — user can adjust again if it didn't take */ }
    }, 600);
    return () => clearTimeout(t);
  }, [eventDurationOverride, inheritedDurationMin, id, fetchEvent]);

  // Re-open the Add Players picker when returning from "+ New App
  // User". The API has already attached the new player; we just need
  // to (a) flip to the Players section, (b) seed the picker filters,
  // and (c) flip showAddPlayer=true so renderAddPlayers() takes over.
  // Order matters: activeSection must change BEFORE the picker render
  // branch can run, so we sequence with two effects (one to switch
  // section, one to open the picker).
  const handledOpenAddPlayerRef = useRef(false);
  const [pendingOpenAddPlayer, setPendingOpenAddPlayer] = useState(false);
  // Name of the player just added via "+ New App User" — surfaced as
  // a transient green banner in the picker. Cleared after a short
  // delay below.
  const [addedToast, setAddedToast] = useState<string | null>(null);
  useEffect(() => {
    if (!searchParams || handledOpenAddPlayerRef.current) return;
    if (searchParams.get("openAddPlayer") !== "1") return;
    handledOpenAddPlayerRef.current = true;
    setActiveSection("players");
    setPendingOpenAddPlayer(true);
    const name = searchParams.get("addedName");
    // Sentinel still present = /players/new didn't substitute (probably
    // because POST didn't return a name). Skip the toast in that case.
    if (name && name !== "__NEW_NAME__") {
      setAddedToast(decodeURIComponent(name));
    }
    if (typeof id === "string") router.replace(`/events/${id}`);
  }, [searchParams, id, router]);
  // Sync activeSection from ?section=... once on mount. A returning link
  // from the sign-up page lands here with ?section=players — we honour
  // that and then strip the param so a subsequent back-to-overview gesture
  // doesn't reapply it.
  const handledInitialSectionRef = useRef(false);
  // Pending share-flag captured from the URL on first mount. We can't
  // open the share modal until `event` is loaded, so we stash the
  // request here and a separate effect fires it once the event is
  // ready.
  const pendingShareRef = useRef<string | null>(null);
  // Bridge so the URL-share auto-open effect can call
  // openScheduleShare without violating the temporal dead zone — the
  // function is defined further down in the component body. We
  // re-assign on every render so the ref always points at the
  // latest closure (which captures the freshest `event`).
  const openScheduleShareRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!searchParams || handledInitialSectionRef.current) return;
    const s = searchParams.get("section");
    const share = searchParams.get("share");
    if (!s && !share) return;
    handledInitialSectionRef.current = true;
    const allowed = ["overview", "when", "admins", "scoring", "pairing", "players", "pairs", "competition", "rounds", "manual"] as const;
    if (s && (allowed as readonly string[]).includes(s)) {
      setActiveSection(s as typeof allowed[number]);
    }
    if (share) pendingShareRef.current = share;
    if (typeof id === "string") router.replace(`/events/${id}`);
  }, [searchParams, id, router]);
  // Auto-open the schedule share when arriving with `?share=schedule`
  // in the URL (e.g. tapped 📣 on the lineup page). Waits for `event`
  // to be loaded since openScheduleShare reads from it. Fires once
  // then clears the ref so a later state change doesn't re-open.
  // MUST live above the loading/error early returns — calling it
  // conditionally tripped React error #310 (rendered more hooks than
  // during the previous render).
  useEffect(() => {
    const evt = swrEvent.data as Event | undefined;
    if (!evt || !evt.round || !pendingShareRef.current) return;
    if (pendingShareRef.current === "schedule") {
      pendingShareRef.current = null;
      // Defer to a microtask so openScheduleShare is in scope and
      // reads the up-to-date `event` snapshot.
      queueMicrotask(() => openScheduleShareRef.current?.());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swrEvent.data]);
  // Auto-dismiss the green banner ~4s after it appears.
  useEffect(() => {
    if (!addedToast) return;
    const t = setTimeout(() => setAddedToast(null), 4000);
    return () => clearTimeout(t);
  }, [addedToast]);
  // Once we've landed on the Players section and the event is loaded,
  // actually open the picker with sensible defaults.
  useEffect(() => {
    if (!pendingOpenAddPlayer || activeSection !== "players" || !event) return;
    setPendingOpenAddPlayer(false);
    fetchAllPlayers();
    setAddPlayerSearch("");
    setAddPlayerGender(null);
    setAddPlayerCountry(
      (session?.user as { country?: string | null } | undefined)?.country || "",
    );
    setAddPlayerClubFilter(event.club ? "club" : "all");
    setPendingPlayerIds(new Set());
    setAddedPlayerIds(new Set());
    setShowAddPlayer(true);
    // session/event are read non-reactively for one-shot initialisation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingOpenAddPlayer, activeSection, event]);

  const fetchWaGroups = useCallback(async () => {
    const [linked, all] = await Promise.all([
      fetch(`/api/events/${id}/whatsapp-groups`).then((r) => r.json()),
      fetch("/api/whatsapp-groups").then((r) => r.json()),
    ]);
    if (Array.isArray(linked)) setWaGroups(linked);
    if (Array.isArray(all)) setAllWaGroups(all);
  }, [id]);

  useEffect(() => { fetchWaGroups(); }, [fetchWaGroups]);

  // Build the "Recent" player set for the guest picker: anyone signed
  // up to any earlier match-day event in this league. Skipped for
  // non-league events. Uses the league's full rounds list — one fetch
  // when the event's league id is known.
  const leagueIdForRecent = event?.round?.league?.id ?? null;
  useEffect(() => {
    if (!leagueIdForRecent) { setLeagueRecentPlayerIds(new Set()); return; }
    let cancelled = false;
    (async () => {
      const r = await fetch(`/api/leagues/${leagueIdForRecent}`);
      if (!r.ok || cancelled) return;
      const data = await r.json().catch(() => null);
      if (!data || cancelled) return;
      const ids = new Set<string>();
      type Ev = { id: string; players?: { playerId?: string; player?: { id?: string } }[] };
      type Round = { events?: Ev[] };
      const rounds: Round[] = (data.rounds as Round[]) ?? [];
      for (const r of rounds) {
        for (const ev of r.events ?? []) {
          if (ev.id === id) continue; // skip the current event
          for (const ep of ev.players ?? []) {
            const pid = ep.playerId ?? ep.player?.id;
            if (pid) ids.add(pid);
          }
        }
      }
      setLeagueRecentPlayerIds(ids);
    })();
    return () => { cancelled = true; };
  }, [leagueIdForRecent, id]);

  const buildWhatsAppMessage = () => {
    if (!event) return "";
    const date = new Date(event.date).toLocaleDateString(undefined, {
      weekday: "long",
      month: "short",
      day: "numeric",
    });
    const time = new Date(event.date).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
    const endTime = event.endDate
      ? new Date(event.endDate).toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
        })
      : "";
    const playerList = event.players
      .filter((ep) => ep.status === "registered" || ep.status === "checked_in")
      .map((ep) => ep.player.name)
      .join("\n");
    const checkedInCount = event.players.filter((ep) => ep.status === "registered" || ep.status === "checked_in").length;

    return `🏓 *${event.name}*\n📅 ${date}\n⏰ ${time}${endTime ? ` – ${endTime}` : ""}\n🏟️ ${event.numCourts} court${event.numCourts > 1 ? "s" : ""} · ${event.format}\n\n👥 Players (${checkedInCount}):\n${playerList}`;
  };

  const sendToWhatsApp = (groupName: string) => {
    const text = buildWhatsAppMessage();
    const encoded = encodeURIComponent(text);
    // Copy to clipboard as fallback (fire-and-forget — WhatsApp opens regardless)
    copyText(text).then((ok) => {
      if (ok) {
        setCopiedGroupId(groupName);
        setTimeout(() => setCopiedGroupId(null), 2000);
      }
    });
    // Open WhatsApp with pre-filled text
    window.open(`https://wa.me/?text=${encoded}`, "_blank");
  };

  const deleteEvent = async () => {
    const participants = event?.players?.length ?? 0;
    const matches = event?.matches?.length ?? 0;
    // First confirm — always.
    const okFirst = await confirmDialog({
      title: "Delete Event",
      message:
        matches > 0
          ? `This event has ${participants} participant${participants === 1 ? "" : "s"} and ${matches} match${matches === 1 ? "" : "es"} with recorded data.`
          : participants > 0
            ? `This event has ${participants} signed-up participant${participants === 1 ? "" : "s"}.`
            : "Delete this event? This cannot be undone.",
      confirmText: matches > 0 || participants > 0 ? "Continue" : "Delete",
      danger: true,
    });
    if (!okFirst) return;
    // Second confirm only when the event isn't empty. For events with
    // recorded matches the second step requires typing DELETE — this
    // tier of destruction loses results that aren't recoverable.
    if (matches > 0) {
      const okStrong = await confirmDialog({
        title: "Permanently delete event + matches?",
        message: `${matches} recorded match${matches === 1 ? "" : "es"} will be lost forever, including scores. Type DELETE to confirm.`,
        confirmText: "Delete",
        danger: true,
        requireType: "DELETE",
      });
      if (!okStrong) return;
    } else if (participants > 0) {
      const okSecond = await confirmDialog({
        title: "Remove sign-ups + delete?",
        message: `${participants} sign-up${participants === 1 ? "" : "s"} will be removed.`,
        confirmText: "Delete",
        danger: true,
      });
      if (!okSecond) return;
    }
    await fetch(`/api/events/${id}`, { method: "DELETE" });
    router.push("/events");
  };

  const generateMatches = async () => {
    setGenerating(true);
    await fetch(`/api/events/${id}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ numRounds }),
    });
    await fetchEvent();
    setGenerating(false);
  };

  const submitScore = async (matchId: string) => {
    const s = scores[matchId];
    if (!s || s.team1 === "" || s.team2 === "") return;
    const team1Score = parseInt(s.team1);
    const team2Score = parseInt(s.team2);
    if (isNaN(team1Score) || isNaN(team2Score)) return;
    if (team1Score < 0 || team2Score < 0) {
      alertDialog("Scores cannot be negative!");
      return;
    }
    if (team1Score === team2Score) {
      alertDialog("Scores cannot be tied!");
      return;
    }
    // Validate against match scoring rules
    const match = event?.matches.find((m) => m.id === matchId);
    if (match && event) {
      const cls = match.classId ? event.classes?.find((c: { id: string }) => c.id === match.classId) : event.classes?.[0];
      const fmt = match.matchFormat || cls?.scoringFormat || event.scoringFormat || "1x11";
      const target = parseInt(fmt.replace(/^[13]x/, "").replace("R", "")) || 11;
      const wb = parseInt(cls?.winBy || "2") || 2;
      if (!isValidPair(team1Score, team2Score, target, wb)) {
        const winner = Math.max(team1Score, team2Score);
        if (winner < target) {
          alertDialog(`Invalid score: winner must reach at least ${target}`);
        } else {
          alertDialog(`Invalid score: ${team1Score}-${team2Score} doesn't follow win-by-${wb} rules`);
        }
        return;
      }
    }
    // Optimistic: mark completed immediately
    setEvent((prev) => prev ? { ...prev, matches: prev.matches.map((m) => {
      if (m.id !== matchId) return m;
      return { ...m, status: "completed", players: m.players.map((p) => ({ ...p, score: p.team === 1 ? team1Score : team2Score })) };
    }) } : prev);
    setScores((prev) => { const next = { ...prev }; delete next[matchId]; return next; });
    fetch(`/api/matches/${matchId}/score`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ team1Score, team2Score }),
    }).then(() => fetchEvent());
  };

  const editScore = async (matchId: string) => {
    const s = scores[matchId];
    if (!s || s.team1 === "" || s.team2 === "") return;
    const team1Score = parseInt(s.team1);
    const team2Score = parseInt(s.team2);
    if (isNaN(team1Score) || isNaN(team2Score)) return;
    if (team1Score < 0 || team2Score < 0) {
      alertDialog("Scores cannot be negative!");
      return;
    }
    if (team1Score === team2Score) {
      alertDialog("Scores cannot be tied!");
      return;
    }
    if (!await confirmDialog({ message: "Edit score? This will recalculate rankings.", confirmText: "Edit" })) return;
    await fetch(`/api/matches/${matchId}/score`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ team1Score, team2Score }),
    });
    setEditingMatchId(null);
    setScores((prev) => {
      const next = { ...prev };
      delete next[matchId];
      return next;
    });
    await fetchEvent();
  };

  const setMatchScore = (matchId: string, team: "team1" | "team2", value: string) => {
    setScores((prev) => ({
      ...prev,
      [matchId]: {
        ...prev[matchId],
        team1: prev[matchId]?.team1 ?? "",
        team2: prev[matchId]?.team2 ?? "",
        [team]: value,
      },
    }));
  };

  const fetchAllPlayers = async () => {
    // High limit so every candidate is available for the Add Players
    // picker. The default 100 cap on /api/players caused players outside
    // the top-100 by rating to be invisible.
    const r = await fetch("/api/players?limit=5000");
    const data = await r.json();
    setAllPlayers(data);
  };

  const signupForEvent = async () => {
    await fetch(`/api/events/${id}/signup`, { method: "POST" });
    await fetchEvent();
  };

  const unsignFromEvent = async () => {
    if (!await confirmDialog({
      title: "Leave event?",
      message: "Do you no longer want to participate in this event?",
      confirmText: "Leave event",
      danger: true,
    })) return;
    const r = await fetch(`/api/events/${id}/signup`, { method: "DELETE" });
    if (!r.ok) {
      const data = await r.json();
      await alertDialog(data.error || "Cannot leave event");
      return;
    }
    await fetchEvent();
  };

  const addPlayerToEvent = async (playerId: string) => {
    await fetch(`/api/events/${id}/players`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId }),
    });
    await fetchEvent();
  };

  const togglePausePlayer = async (playerId: string) => {
    setEvent((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        players: prev.players.map((ep) =>
          ep.player.id === playerId ? { ...ep, status: ep.status === "paused" ? "checked_in" : "paused" } : ep,
        ),
      };
    });
    await fetch(`/api/events/${id}/players/${playerId}/pause`, { method: "POST" });
    await fetchEvent();
  };

  const checkInPlayer = async (playerId: string) => {
    setEvent((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        players: prev.players.map((ep) =>
          ep.player.id === playerId ? { ...ep, status: ep.status === "checked_in" ? "registered" : "checked_in" } : ep,
        ),
      };
    });
    await fetch(`/api/events/${id}/players/${playerId}/checkin`, { method: "POST" });
    await fetchEvent();
  };

  const swapMatchPlayer = async (matchId: string, oldPlayerId: string, newPlayerId: string) => {
    await fetch(`/api/matches/${matchId}/players`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ oldPlayerId, newPlayerId }),
    });
    await fetchEvent();
  };

  const deleteMatch = async (matchId: string) => {
    const match = event?.matches.find((m) => m.id === matchId);
    const isScored = match?.status === "completed";
    if (isScored) {
      if (!await confirmDialog({ title: "Delete scored match?", message: "This match has scores. Rankings will be reversed.", confirmText: "Continue", danger: true })) return;
      if (!await confirmDialog({ message: "Are you absolutely sure? This cannot be undone.", confirmText: "Delete", danger: true })) return;
    } else {
      if (!await confirmDialog({ message: "Delete this match?", confirmText: "Delete", danger: true })) return;
    }
    // Optimistic: remove from UI immediately
    setEvent((prev) => prev ? { ...prev, matches: prev.matches.filter((m) => m.id !== matchId) } : prev);
    fetch(`/api/matches/${matchId}/players`, { method: "DELETE" }).then(() => fetchEvent());
  };

  // Flip a guest's intent between "social" and "attending" without leaving
  // the team column. Uses the same signup-prefs POST endpoint that the
  // guest-add picker uses, which preserves _guestTeamId because the server
  // re-writes the sentinel from { intent, teamId } in the body.
  const toggleGuestIntent = async (playerId: string, currentIntent: "social" | "attending", teamId: string) => {
    const newIntent: "social" | "attending" = currentIntent === "social" ? "attending" : "social";
    const r = await fetch(`/api/events/${id}/signup-prefs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerIds: [playerId], intent: newIntent, teamId }),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      await alertDialog(d.error || "Failed to update guest", "Error");
      return;
    }
    await fetchEvent();
  };

  const removeGuest = async (playerId: string, playerName: string) => {
    const ok = await confirmDialog({
      title: `Remove ${playerName}?`,
      message: `${playerName}'s guest sign-up will be cancelled.`,
      confirmText: "Remove",
      cancelText: "Cancel",
      danger: true,
    });
    if (!ok) return;
    await removePlayer(playerId, playerName);
  };

  const removePlayer = async (playerId: string, _playerName?: string) => {
    // Check if player is in any match — block removal with clear message
    const inMatch = event?.matches.some((m) => m.players.some((p) => p.playerId === playerId));
    if (inMatch) {
      const playerName = event?.players.find((ep) => ep.player.id === playerId)?.player.name || "This player";
      await alertDialog(`${playerName} is in a match. Delete the match first before removing.`, "Cannot remove");
      return;
    }
    // Optimistic: remove immediately from UI
    setEvent((prev) => {
      if (!prev) return prev;
      return { ...prev, players: prev.players.filter((ep) => ep.player.id !== playerId) };
    });
    const r = await fetch(`/api/events/${id}/players/${playerId}`, { method: "DELETE" });
    if (!r.ok) {
      const data = await r.json().catch(() => ({ error: "Failed to remove" }));
      await alertDialog(data.error || "Cannot remove player", "Error");
    }
    await fetchEvent();
  };

  // Batch-remove the staged players. Skips anyone currently in a match
  // (the per-player removePlayer handles that case with a confirmation
  // already). Confirms once for the whole batch.
  const removePendingPlayers = async () => {
    const ids = [...pendingRemoveIds];
    if (ids.length === 0) return;
    const names = ids
      .map((pid) => event?.players.find((ep) => ep.player.id === pid)?.player.name)
      .filter(Boolean) as string[];
    const ok = await confirmDialog({
      title: ids.length === 1 ? `Remove ${names[0] || "player"}?` : `Remove ${ids.length} players?`,
      message:
        ids.length === 1
          ? `${names[0] || "This player"} will be removed from the event. Any matches they're in must be deleted first.`
          : `${ids.length} players will be removed from the event:\n\n${names.join(", ")}\n\nPlayers currently in matches will be skipped (delete those matches first to remove them).`,
      confirmText: "Remove",
      danger: true,
    });
    if (!ok) return;
    setRemovingPlayers(true);
    try {
      // Skip players currently in matches; surface the count after.
      const inMatchIds = new Set(
        ids.filter((pid) =>
          event?.matches.some((m) => m.players.some((p) => p.playerId === pid)),
        ),
      );
      const removable = ids.filter((pid) => !inMatchIds.has(pid));
      await Promise.all(
        removable.map((pid) =>
          fetch(`/api/events/${id}/players/${pid}`, { method: "DELETE" }),
        ),
      );
      setPendingRemoveIds(new Set());
      // Auto-exit remove mode after a successful batch — no point
      // leaving the destructive UI armed once the admin has committed.
      setRemoveMode(false);
      await fetchEvent();
      if (inMatchIds.size > 0) {
        await alertDialog(
          `${inMatchIds.size} ${inMatchIds.size === 1 ? "player was" : "players were"} skipped because they're in a match. Delete the match first to remove them.`,
          "Some players skipped",
        );
      }
    } finally {
      setRemovingPlayers(false);
    }
  };

  // Sections that need explicit Save (edit fields + save button)
  const saveSections = new Set(["when", "scoring", "pairing", "competition"]);

  const startEditEvent = () => {
    if (!event) return;
    setHasEdits(false);
    setEditName(event.name);
    setEditStatus(normalizeEventStatus(event.status));
    setEditCourts(event.numCourts);
    setEditDate(toDateInput(event.date));
    setEditTime(toTimeInput(event.date));
    setEditFormat(event.format || "doubles");
    setEditScoringFormat(event.scoringFormat || "1x11");
    setEditWinBy(event.classes?.[0]?.winBy || "2");
    {
      const cls0fmt = event.classes?.[0] as unknown as { maxMinutes?: number | null };
      const mm = cls0fmt?.maxMinutes;
      setEditMaxMinutes(mm ? String(mm) : "");
    }
    setEditPairingMode(event.pairingMode);
    // Hydrate new pairing-settings fields from the first class's JSON.
    {
      const cls0 = event.classes?.[0] as unknown as {
        pairingSettings?: {
          base?: string; teams?: string; gender?: string;
          skillWindow?: number | "inf" | "infinity";
        } | null;
      } | undefined;
      const ps = cls0?.pairingSettings || null;
      const baseRaw = ps?.base ?? "king";
      const knownBases = ["king", "random", "skill", "manual"] as const;
      setEditBaseMode((knownBases as readonly string[]).includes(baseRaw) ? (baseRaw as typeof knownBases[number]) : "king");
      setEditTeams(ps?.teams === "fixed" ? "fixed" : "rotating");
      const g = ps?.gender;
      setEditGender(g === "mixed" || g === "same" ? g : "random");
      const sw = ps?.skillWindow;
      setEditSkillWindow(sw === "inf" || sw === "infinity" ? "inf" : typeof sw === "number" ? sw : 1);
    }
    const cls = event.classes?.[0];
    setEditPlayMode(cls?.playMode || "round_based");
    setEditPrioSpeed(cls?.prioSpeed ?? true);
    setEditPrioFairness(cls?.prioFairness ?? true);
    setEditPrioSkill(cls?.prioSkill ?? false);
    setEditPrioVariety((cls as unknown as Record<string, boolean>)?.prioVariety ?? false);
    setEditRankingMode(event.rankingMode || "ranked");
    setEditCompetitionMode(!!event.competitionMode);
    setEditOpenSignup(event.openSignup);
    setEditVisibility(event.visibility);
    setEditLocationId(event.locationId || event.club?.locations?.[0]?.id || null);
    if (event.endDate) {
      setEditEndDate(toDateInput(event.endDate));
      setEditEndTime(toTimeInput(event.endDate));
    } else {
      // Default: same date, 2 hours after start
      setEditEndDate(toDateInput(event.date));
      const end = new Date(event.date);
      end.setHours(end.getHours() + 2);
      setEditEndTime(toTimeInput(end.toISOString()));
    }
    setEditingEvent(true);
  };

  const saveEditEvent = async () => {
    if (!editName.trim()) return;
    const eventDate = new Date(`${editDate}T${editTime}`);
    const eventEndDate = new Date(`${editEndDate || editDate}T${editEndTime}`);
    if (eventEndDate <= eventDate) eventEndDate.setDate(eventEndDate.getDate() + 1);
    await fetch(`/api/events/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editName.trim(),
        status: editStatus,
        numCourts: editCourts,
        date: eventDate.toISOString(),
        endDate: eventEndDate.toISOString(),
        format: editFormat,
        scoringFormat: editScoringFormat,
        winBy: editWinBy,
        maxMinutes: editMaxMinutes.trim() === "" ? null : Math.max(1, Math.min(60, parseInt(editMaxMinutes, 10) || 0)) || null,
        pairingMode: editPairingMode,
        playMode: editPlayMode,
        prioSpeed: editPrioSpeed,
        prioFairness: editPrioFairness,
        prioSkill: editPrioSkill,
        prioVariety: editPrioVariety,
        rankingMode: editRankingMode,
        openSignup: editOpenSignup,
        visibility: editVisibility,
        locationId: editLocationId,
      }),
    });
    // Persist the new Mode & Teams settings via the pairing settings
    // endpoint. The endpoint takes a class id; we update each class.
    if (event?.classes?.length) {
      const payload = {
        base: editBaseMode,
        teams: editTeams,
        gender: editGender,
        skillWindow: editSkillWindow,
        // The window settings below are baked into the mode but we still
        // send sensible defaults so the persisted JSON is complete.
        varietyWindow: 0,
        matchCountWindow: 1,
        maxWaitWindow: 1,
      };
      await Promise.all(event.classes.map((c) =>
        fetch(`/api/events/${id}/pairing/settings`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ classId: c.id, settings: payload }),
        }),
      ));
    }
    // If competition mode changed, persist via the dedicated competition endpoint
    const currentCompetition = !!event?.competitionMode;
    if (currentCompetition !== editCompetitionMode) {
      await fetch(`/api/events/${id}/competition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: editCompetitionMode ? "enable" : "disable" }),
      });
    }
    setEditingEvent(false);
    await fetchEvent();
  };

  const startEditMatch = (matchId: string, team1Score: number, team2Score: number) => {
    setEditingMatchId(matchId);
    setScores((prev) => ({
      ...prev,
      [matchId]: {
        team1: String(team1Score),
        team2: String(team2Score),
      },
    }));
  };

  const cancelEditMatch = () => {
    if (editingMatchId) {
      setScores((prev) => {
        const next = { ...prev };
        delete next[editingMatchId];
        return next;
      });
    }
    setEditingMatchId(null);
  };

  const resetEvent = async () => {
    if (!await confirmDialog({ title: "Reset Event", message: "This will delete ALL matches and reverse all ranking changes. Cannot be undone.", confirmText: "Reset", danger: true })) return;
    setResetting(true);
    await fetch(`/api/events/${id}/reset`, { method: "POST" });
    await fetchEvent();
    setResetting(false);
  };

  const addHelper = async (playerId: string) => {
    await fetch(`/api/events/${id}/helpers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId }),
    });
    await fetchEvent();
  };

  const removeHelper = async (playerId: string) => {
    const helper = event?.helpers.find((h) => h.playerId === playerId);
    const name = helper?.player.name || "this helper";
    const ok = await confirmDialog({
      title: `Remove ${name} as helper?`,
      message: `${name} will lose helper access to this event (managing players, matches, settings). They stay signed up as a player if they were.`,
      confirmText: "Remove helper",
      cancelText: "Cancel",
      danger: true,
    });
    if (!ok) return;
    const r = await fetch(`/api/events/${id}/helpers`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId }),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      await alertDialog(d.error || "Failed to remove helper", "Error");
      return;
    }
    await fetchEvent();
  };

  const generatePairsAuto = async () => {
    setGeneratingPairs(true);
    await fetch(`/api/events/${id}/pairs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: pairMode, preferMixed: pairMixed }),
    });
    await fetchEvent();
    setGeneratingPairs(false);
  };

  const createManualPair = async (player1Id: string, player2Id: string) => {
    // Instant visual feedback
    setPairingInProgress(new Set([player1Id, player2Id]));
    setManualPairSelect(null);
    await fetch(`/api/events/${id}/pairs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ player1Id, player2Id }),
    });
    setPairingInProgress(new Set());
    await fetchEvent();
  };

  const removePair = async (pairId: string) => {
    await fetch(`/api/events/${id}/pairs`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pairId }),
    });
    await fetchEvent();
  };

  const clearAllPairs = async () => {
    if (!await confirmDialog({ message: "Remove all pairs?", danger: true })) return;
    await fetch(`/api/events/${id}/pairs`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    await fetchEvent();
  };

  const setSkillLevel = async (playerId: string, skillLevel: number | null) => {
    // Optimistic update
    setEvent((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        players: prev.players.map((ep) =>
          ep.player.id === playerId ? { ...ep, skillLevel } : ep
        ),
      };
    });
    // Save in background
    fetch(`/api/events/${id}/players/${playerId}/level`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skillLevel }),
    });
  };

  const openEditMatch = (matchId: string) => {
    const match = event?.matches.find((m) => m.id === matchId);
    if (!match) return;
    setEditingManualMatchId(matchId);
    setManualCourt(match.courtNum);
    setManualTeam1(match.players.filter((p) => p.team === 1).map((p) => p.playerId));
    setManualTeam2(match.players.filter((p) => p.team === 2).map((p) => p.playerId));
    setManualMatchFormat(match.matchFormat || "");
    setManualRankingMode(match.rankingMode !== (event?.rankingMode || "ranked") ? match.rankingMode || "" : "");
    setManualWinBy("");
    setActiveSection("manual");
  };

  const addManualMatch = async () => {
    if (manualTeam1.length === 0 || manualTeam2.length === 0) return;
    // Warn if uneven teams
    if (manualTeam1.length !== manualTeam2.length) {
      if (!await confirmDialog({ message: `Teams are uneven (${manualTeam1.length} vs ${manualTeam2.length}). Create match anyway?` })) return;
    }
    // Warn if singles in a doubles event
    const isSingles = manualTeam1.length === 1 && manualTeam2.length === 1;
    if (isSingles && event?.format === "doubles") {
      if (!await confirmDialog({ message: "This is a doubles event. Create a singles match?" })) return;
    }
    if (editingManualMatchId) {
      // Update existing match
      await fetch(`/api/events/${id}/matches`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          matchId: editingManualMatchId,
          team1PlayerIds: manualTeam1,
          team2PlayerIds: manualTeam2,
          courtNum: manualCourt,
          ...(manualMatchFormat ? { matchFormat: manualMatchFormat } : {}),
          ...(manualRankingMode ? { rankingMode: manualRankingMode } : {}),
        }),
      });
    } else {
      // Create new match
      const r = await fetch(`/api/events/${id}/matches`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          team1PlayerIds: manualTeam1,
          team2PlayerIds: manualTeam2,
          courtNum: manualCourt,
          ...(manualMatchFormat ? { matchFormat: manualMatchFormat } : {}),
          ...(manualRankingMode ? { rankingMode: manualRankingMode } : {}),
        }),
      });
      // If "Friendly in league" toggle is on AND event is league-attached,
      // also create a non-principal LeagueGame referencing the new match.
      if (r.ok && manualFriendlyInLeague && event?.round && manualLeagueCategoryId) {
        const newMatch = await r.json().catch(() => null);
        const teams = event.leagueTeams || [];
        if (newMatch?.id && teams.length === 2) {
          await fetch(`/api/leagues/${event.round.league.id}/events/${event.id}/games`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "create_extra",
              categoryId: manualLeagueCategoryId,
              team1Id: teams[0].teamId,
              team2Id: teams[1].teamId,
              matchId: newMatch.id,
            }),
          });
        }
      }
    }
    setShowAddMatch(false);
    setManualTeam1([]);
    setManualTeam2([]);
    setManualCourt(1);
    setManualMatchFormat("");
    setManualRankingMode("");
    setManualWinBy("");
    setManualFriendlyInLeague(false);
    setManualLeagueCategoryId("");
    setEditingManualMatchId(null);
    setActiveSection("rounds");
    await fetchEvent();
  };

  const toggleManualPlayer = (playerId: string, team: 1 | 2) => {
    const maxPerTeam = event?.format === "singles" ? 1 : 2;
    if (team === 1) {
      setManualTeam1((prev) =>
        prev.includes(playerId) ? prev.filter((id) => id !== playerId) : prev.length >= maxPerTeam ? prev : [...prev, playerId]
      );
      setManualTeam2((prev) => prev.filter((id) => id !== playerId));
    } else {
      setManualTeam2((prev) =>
        prev.includes(playerId) ? prev.filter((id) => id !== playerId) : prev.length >= maxPerTeam ? prev : [...prev, playerId]
      );
      setManualTeam1((prev) => prev.filter((id) => id !== playerId));
    }
  };

  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // Error state — surfaces the actual SWR error (404 / 401 / 500) so we
  // can tell why the event isn't loading instead of silently bouncing
  // to /events.
  if (swrEvent.error && !event) {
    const err = swrEvent.error as Error;
    return (
      <div className="px-4 pt-6 max-w-md mx-auto">
        <div className={`${frameClass} p-4 text-center space-y-3`}>
          <div className="text-base font-bold text-foreground">Can&apos;t open this event</div>
          <div className="text-sm text-muted">{err?.message || "Unknown error"}</div>
          <div className="flex gap-2 justify-center">
            <button
              onClick={() => swrEvent.mutate()}
              className="text-sm bg-action text-white font-semibold px-3 py-1.5 rounded-lg"
            >Retry</button>
            <Link href="/events" className="text-sm bg-gray-100 text-foreground font-medium px-3 py-1.5 rounded-lg">All events</Link>
          </div>
        </div>
      </div>
    );
  }

  if (loading || !event) {
    // Show preview skeleton only after mount (sessionStorage is client-only).
    // Before mount, show spinner to match server render and avoid hydration mismatch.
    const showPreview = mounted && preview;
    return (
      <div className="-mx-4 -mt-2">
        {/* Hero header skeleton — green background */}
        <div style={{ background: "linear-gradient(180deg, #15803d 0%, #14532d 100%)", color: "#fff", paddingBottom: 18, paddingTop: "max(env(safe-area-inset-top, 0px), 12px)" }}>
          <div className="flex items-center justify-between px-3.5" style={{ height: 48 }}>
            <Logo size={20} color="#fff" ball="pickle" ballAlign="midline" />
          </div>
          {/* Back link: mirror the loaded view's logic — league events
              link back to the league's Rounds tab with the short league
              name; otherwise back to /events. Otherwise the skeleton
              flashes "Events" before swapping to "[LeagueShort]". */}
          <div className="px-4 pt-0.5">
            {showPreview && preview.round?.league ? (
              <Link href={`/leagues/${preview.round.league.id}?tab=rounds`} className="inline-flex items-center gap-1 text-[15px] font-medium no-underline" style={{ color: "#d9f99d" }}>
                <svg width={10} height={16} viewBox="0 0 10 16"><path d="M8 2 L2 8 L8 14" fill="none" stroke="#d9f99d" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" /></svg>
                {leagueShortName(preview.round.league)}
              </Link>
            ) : (
              <Link href="/events" className="inline-flex items-center gap-1 text-[15px] font-medium no-underline" style={{ color: "#d9f99d" }}>
                <svg width={10} height={16} viewBox="0 0 10 16"><path d="M8 2 L2 8 L8 14" fill="none" stroke="#d9f99d" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" /></svg>
                Events
              </Link>
            )}
          </div>
          <div className="px-4 pt-1 pb-2">
            {showPreview ? (
              <>
                {/* Title: for league events the stored event.name is the
                    long "{league}: {teams} — {round}" string. The league
                    is already in the back chevron, so the hero only
                    needs the match-day-specific bit. */}
                <h2 className="text-2xl font-extrabold" style={{ letterSpacing: "-0.02em" }}>
                  {preview.round
                    ? (() => {
                        const teamNames = (preview.leagueTeams || []).map((t) => t.team.name).join(" vs ");
                        const roundLabel = preview.round.name || `Round ${preview.round.roundNumber}`;
                        return teamNames ? `${teamNames} — ${roundLabel}` : roundLabel;
                      })()
                    : preview.name}
                </h2>
                <p className="text-sm text-white/80 mt-2">
                  {preview.club && `${(preview.club.shortName?.trim() || preview.club.name)} · `}
                  {new Date(preview.date).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}
                  {" · "}
                  {new Date(preview.date).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                  {" · "}
                  {preview.numCourts} court{preview.numCourts !== 1 ? "s" : ""}
                </p>
              </>
            ) : (
              <div className="animate-pulse space-y-2 py-1">
                <div className="h-6 bg-white/20 rounded w-2/3" />
                <div className="h-4 bg-white/10 rounded w-1/2" />
              </div>
            )}
          </div>
        </div>
        {/* Content skeleton */}
        <div className="px-4 pt-4 space-y-3">
          <div className={`${frameClass} p-4 animate-pulse`}>
            <div className="h-3 bg-gray-200 rounded w-1/3 mb-3" />
            <div className="h-3 bg-gray-200 rounded w-2/3 mb-3" />
            <div className="h-3 bg-gray-200 rounded w-1/2" />
          </div>
          <div className={`${frameClass} p-4 animate-pulse`}>
            <div className="h-3 bg-gray-200 rounded w-1/4 mb-3" />
            <div className="h-3 bg-gray-200 rounded w-3/4" />
          </div>
        </div>
      </div>
    );
  }

  // Group matches by round
  const matchesByRound = event.matches.reduce<Record<number, Match[]>>((acc, m) => {
    if (!acc[m.round]) acc[m.round] = [];
    acc[m.round].push(m);
    return acc;
  }, {});

  const rounds = Object.keys(matchesByRound)
    .map(Number)
    .sort((a, b) => a - b);

  const allCompleted =
    event.matches.length > 0 &&
    event.matches.every((m) => m.status === "completed");

  const hasMatches = event.matches.length > 0;
  const minPlayers = event.format === "singles" ? 2 : 4;
  const activePlayers = event.players.filter((ep) => ep.status === "registered" || ep.status === "checked_in");
  const pausedPlayers = event.players.filter((ep) => ep.status === "paused");
  const waitlistedPlayers = event.players.filter((ep) => ep.status === "waitlisted");
  const isIncremental = event.pairingMode === "king_of_court" || event.pairingMode === "swiss";

  // Courts currently in use (active match being played)
  const activeCourts = new Set(
    event.matches.filter((m) => m.status === "active").map((m) => m.courtNum)
  );
  // Next pending matches ready to play
  const pendingReadyMatches = event.matches
    .filter((m) => m.status === "pending" && m.players.length >= 2)
    .sort((a, b) => a.round - b.round || a.courtNum - b.courtNum);
  const nextMatchIdSet = new Set(pendingReadyMatches.slice(0, event.numCourts).map((m) => m.id));
  const courtFreeMatchIds = new Set(
    pendingReadyMatches.filter((m) => !activeCourts.has(m.courtNum)).map((m) => m.id)
  );

  // Navigate back to club events or global events list
  const closeEvent = () => {
    const clubId = typeof window !== "undefined" ? sessionStorage.getItem("activeClubId") : null;
    if (clubId) {
      router.push(`/clubs/${clubId}`);
    } else {
      router.push("/events");
    }
  };

  const penIcon = <PenIcon />;
  const location = event.locationId
    ? event.club?.locations?.find((l) => l.id === event.locationId) || event.club?.locations?.[0]
    : event.club?.locations?.[0];

  const ownerName = event.createdBy?.name;
  const helperNames = event.helpers.map((h) => h.player.name);

  // Use the club's shortName when set so the loaded header matches the
  // pre-load preview chip (which already prefers shortName). Keeps the
  // hero from shifting between loading and loaded states.
  const heroMeta = [
    event.club?.shortName?.trim() || event.club?.name,
    new Date(event.date).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }),
    new Date(event.date).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
      + (event.endDate ? ` — ${new Date(event.endDate).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}` : ""),
    `${event.numCourts} court${event.numCourts !== 1 ? "s" : ""}`,
  ].filter(Boolean).join(" · ");

  const heroStatus = (event.status !== "setup" ? event.status : undefined) as HeaderStatus | undefined;
  const userInitial = session?.user?.name?.[0]?.toUpperCase() ?? "?";

  // For league-attached events, the user almost certainly arrived from the
  // league's Rounds tab. Send them back there instead of the global events
  // list so navigation matches the entry point.
  const backLink = event.round
    ? { label: leagueShortName(event.round.league), href: `/leagues/${event.round.league.id}?tab=rounds` }
    : { label: "Events", href: "/events" };
  // For league events the stored event.name is the long
  // "{league.name}: {teams} — {round}" string — too long for a hero title.
  // The league is already in the back chevron, so the title only needs
  // the match-day-specific bit (teams + round).
  const heroTitle = event.round
    ? (() => {
        const teamNames = (event.leagueTeams || []).map((t) => t.team.name).join(" vs ");
        const roundLabel = event.round.name || `Round ${event.round.roundNumber}`;
        return teamNames ? `${teamNames} — ${roundLabel}` : roundLabel;
      })()
    : event.name;

  /**
   * Build the WhatsApp-ready match-day schedule and open the share
   * chooser. League events only. Anyone with view access can share.
   * Data is read straight off the loaded `event` payload — no API call.
   */
  const openScheduleShare = () => {
    if (!event.round) return;
    const league = event.round.league;
    const teams = league.teams || [];
    const categories = league.categories || [];
    // Build lookup maps so we can resolve playerId → name and
    // categoryId → display name without nested .find() per game.
    const playerById = new Map<string, string>();
    for (const t of teams) {
      for (const tp of t.players) playerById.set(tp.playerId, tp.player.name);
    }
    // Also index event sign-ups so non-roster friendly extras (people
    // who signed up to the event but aren't on either team's roster)
    // resolve to their real names instead of "?".
    for (const ep of event.players) playerById.set(ep.player.id, ep.player.name);
    const categoryById = new Map<string, string>();
    for (const c of categories) categoryById.set(c.id, c.name);
    // Match-by-leagueGame lookup for the score line on completed games.
    type MatchLite = { leagueGame?: { id: string } | null; players: { team: number; score: number }[] };
    const matchByGame = new Map<string, MatchLite>();
    for (const m of event.matches as MatchLite[]) {
      if (m.leagueGame?.id) matchByGame.set(m.leagueGame.id, m);
    }

    // Format a full name as "First L." — strip any parenthesised
    // qualifier first (e.g. "Lloyd (Captain)" → "Lloyd"), and skip
    // tokens that don't begin with a letter so a stray "(" can't end
    // up as the initial.
    const shortName = (full: string): string => {
      const cleaned = full.replace(/\([^)]*\)/g, " ").trim();
      const parts = cleaned.split(/\s+/).filter((p) => /^\p{L}/u.test(p));
      if (parts.length === 0) return full;
      if (parts.length === 1) return parts[0];
      const last = parts[parts.length - 1];
      return `${parts[0]} ${last[0]}.`;
    };

    // Resolve a gamePlayer to a short name, falling back through three
    // sources: the prebuilt playerById map (rosters + sign-ups), the
    // included player record on the row itself, and finally "?".
    const resolveName = (gp: { playerId: string; player?: { name: string } }) =>
      shortName(playerById.get(gp.playerId) || gp.player?.name || "?");
    // Per-team roster lookup so we can attribute legacy null-team
    // LeagueGamePlayer rows (written before the `team` field existed)
    // to the correct side based on roster membership. New rows always
    // have an explicit team set by the assign_players endpoint.
    const rosterByTeamId = new Map<string, Set<string>>();
    for (const t of teams) {
      rosterByTeamId.set(t.id, new Set(t.players.map((tp) => tp.playerId)));
    }
    type GP = { playerId: string; team?: number | null; player?: { id: string; name: string } };
    const games: MatchDayShareGame[] = (event.leagueGames || []).map((g) => {
      const t1Roster = rosterByTeamId.get(g.team1Id) ?? new Set<string>();
      const t2Roster = rosterByTeamId.get(g.team2Id) ?? new Set<string>();
      const sideOf = (gp: GP): 1 | 2 => {
        if (gp.team === 1) return 1;
        if (gp.team === 2) return 2;
        if (t1Roster.has(gp.playerId)) return 1;
        if (t2Roster.has(gp.playerId)) return 2;
        // Orphan: non-roster + no team tag (legacy friendly extra).
        // Show on side 1 so they appear somewhere rather than vanish.
        return 1;
      };
      const t1Names = g.gamePlayers.filter((gp) => sideOf(gp) === 1).map(resolveName);
      const t2Names = g.gamePlayers.filter((gp) => sideOf(gp) === 2).map(resolveName);
      const match = matchByGame.get(g.id);
      const team1Score = match ? Math.max(0, ...match.players.filter((p) => p.team === 1).map((p) => p.score)) : null;
      const team2Score = match ? Math.max(0, ...match.players.filter((p) => p.team === 2).map((p) => p.score)) : null;
      // winnerTeam: prefer LeagueGame.winnerId (organizer-set) — map
      // winner team id back to 1/2; fall back to score comparison only
      // when a match exists with a strictly-greater score.
      let winnerTeam: 1 | 2 | null = null;
      if (g.winnerId) {
        winnerTeam = g.winnerId === g.team1Id ? 1 : g.winnerId === g.team2Id ? 2 : null;
      } else if (match && team1Score != null && team2Score != null && team1Score !== team2Score) {
        winnerTeam = team1Score > team2Score ? 1 : 2;
      }
      return {
        courtNum: g.courtNum ?? null,
        scheduledAt: g.scheduledAt ?? null,
        categoryName: categoryById.get(g.categoryId) || "—",
        slotNumber: g.slotNumber ?? null,
        team1PlayerNames: t1Names,
        team2PlayerNames: t2Names,
        team1Score,
        team2Score,
        winnerTeam,
      };
    });

    // Earliest scheduledAt across all games → "doors" time hint.
    const allTimes = games
      .map((g) => g.scheduledAt ? new Date(g.scheduledAt).getTime() : null)
      .filter((t): t is number => t !== null);
    const doorsTimeText = allTimes.length > 0
      ? new Date(Math.min(...allTimes)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : null;

    const dateText = new Date(event.date).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
    // Pick the location actually selected for the event (via
    // event.locationId). If the location is just the club's HQ /
    // unspecified, fall back to the club name alone. Avoids the
    // previous "Club · LocationA, Club · LocationB" duplication.
    const selectedLocation = event.locationId
      ? event.club?.locations?.find((l) => l.id === event.locationId)
      : null;
    const locationText = selectedLocation?.name
      ? (event.club?.name && selectedLocation.name !== event.club.name
          ? `${event.club.name} · ${selectedLocation.name}`
          : selectedLocation.name)
      : event.club?.name ?? null;
    const team1Name = event.leagueTeams?.[0]?.team.name ?? null;
    const team2Name = event.leagueTeams?.[1]?.team.name ?? null;
    const roundLabel = event.round.name || `Round ${event.round.roundNumber}`;
    const origin = typeof window !== "undefined" ? window.location.origin : "";

    const message = buildMatchDayShare({
      leagueName: league.name,
      roundLabel,
      team1Name,
      team2Name,
      dateText,
      doorsTimeText,
      locationText,
      eventUrl: `${origin}/events/${event.id}`,
      games,
    });
    setScheduleShare({
      message,
      title: `Share match-day · ${roundLabel}`,
    });
  };
  // Expose the current closure to the URL-share auto-open effect that
  // had to be hoisted above the early-return guards (React #310 fix).
  openScheduleShareRef.current = openScheduleShare;
  const eventHeroHeader = (
    <div className="-mx-4 -mt-2">
      <AppHeader
        variant="hero"
        back={backLink}
        title={heroTitle}
        meta={heroMeta}
        status={heroStatus}
        notifications={heroUnread}
        user={{ initial: userInitial, href: "/profile" }}
        onInvite={canManage && event.round ? () => setShareSheetOpen(true) : undefined}
        inviteKind={canManage && event.round ? "E" : undefined}
        inviteLabel={canManage && event.round ? "Share event invite" : undefined}
        onShareSchedule={event.round ? openScheduleShare : undefined}
        shareScheduleLabel={event.round ? "Share match-day schedule" : undefined}
      />
    </div>
  );

  const managerCard = (
    <div onClick={() => { if (canManage) { fetchAllPlayers(); setActiveSection("admins"); } }}
      className={`${frameClass} p-3 flex items-center gap-2 ${canManage ? "active:opacity-70 cursor-pointer" : ""}`}>
      <div className="flex-1 min-w-0">
        <p className="text-base font-bold text-foreground">Event Organizer</p>
        <p className="text-sm font-medium truncate">
          {ownerName || "—"}
          {helperNames.length > 0 && <span className="text-muted font-normal"> + {helperNames.join(", ")}</span>}
        </p>
      </div>
      {canManage && <span className="text-muted shrink-0">{penIcon}</span>}
    </div>
  );

  const sectionLabels: Record<string, string> = {
    when: "Event Data",
    admins: "Organizer",
    scoring: "Format",
    pairing: "Pairing",
    players: "Participants",
    pairs: "Pairs",
    competition: event.competitionMode ? "Competition" : "Ranked",
    rounds: "Matches",
  };

  const sectionOrder = event.competitionMode
    ? ["when", "admins", "scoring", "pairing", "players", "competition", "rounds"]
    : ["when", "admins", "scoring", "pairing", "players", "pairs", "rounds"];

  const sectionBar = (
    <div className="sticky z-30 bg-background pb-2 -mx-4 px-4 pt-1 shadow-sm" style={{ top: "var(--header-height, 0px)" }}>
      <div className="text-center pb-1">
        <div className="text-sm font-bold">{event.name}</div>
      </div>
      <div className="flex gap-1">
        {sectionOrder
          .filter((s) => {
            if (s === "pairs" && (event.competitionMode || event.format !== "doubles" || event.pairs.length === 0)) return false;
            // competition section always visible (contains ranking)
            return true;
          })
          .map((s) => (
            <button key={s} className="flex-1 text-center" onClick={async () => {
              if (s === activeSection) return;
              if (hasEdits && saveSections.has(activeSection)) {
                const save = await confirmDialog({ title: "Unsaved changes", message: "Save them before switching section?", confirmText: "Save", cancelText: "Discard" });
                if (save) {
                  await saveEditEvent();
                  startEditEvent();
                  setActiveSection(s as typeof activeSection);
                } else {
                  startEditEvent(); setActiveSection(s as typeof activeSection);
                }
              } else {
                if (saveSections.has(s)) startEditEvent();
                setActiveSection(s as typeof activeSection);
              }
            }}>
              <div className={`h-1 rounded-full transition-all duration-300 ${s === activeSection ? "bg-action" : "bg-gray-200"}`} />
              <span className={`text-[8px] leading-tight mt-0.5 block ${s === activeSection ? "text-action font-bold" : "text-foreground/60 hover:text-foreground"}`}>
                {sectionLabels[s]}
              </span>
            </button>
          ))}
      </div>
      <div className="flex items-center justify-between mt-1.5">
        <span className="w-16" />
        <span className="text-sm font-bold text-foreground">{sectionLabels[activeSection] || activeSection}</span>
        {saving ? (
          <span className="text-xs font-medium text-green-600 px-3 py-1 shrink-0">Saved ✓</span>
        ) : saveSections.has(activeSection) && hasEdits ? (
          <button onClick={async () => {
            setSaving(true);
            await saveEditEvent();
            setTimeout(() => { setSaving(false); setActiveSection("overview"); }, 800);
          }}
            className="bg-action-dark text-white px-3 py-1 rounded-lg text-xs font-medium shadow-sm shrink-0">
            Save
          </button>
        ) : (
          <button onClick={async () => {
            if (hasEdits && saveSections.has(activeSection)) {
              const save = await confirmDialog({ title: "Unsaved changes", message: "Save them before leaving the section?", confirmText: "Save", cancelText: "Discard" });
              if (save) {
                await saveEditEvent();
                setActiveSection("overview");
              } else {
                setActiveSection("overview");
              }
            } else {
              setActiveSection("overview");
            }
          }}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-action text-action active:bg-action/10 shrink-0 leading-tight text-center">
            Event<br/>Overview
          </button>
        )}
      </div>
    </div>
  );

  // ── Section: When (name + date/time) ──
  const edit = <T,>(setter: (v: T) => void) => (v: T) => { setter(v); setHasEdits(true); };

  // Always render the action row in edit sections. Save is disabled +
  // faded until there are unsaved changes; Cancel is always available
  // as a clear way back to the overview. The sections themselves are
  // already gated by canManage at the section-activation level — only
  // users with edit permission ever see these forms.
  const editButtons = (
    <div className="flex gap-2 mt-4">
      <button
        onClick={() => {
          // Snap back to overview RIGHT AWAY so the operator isn't
          // staring at the form while three sequential fetches run.
          // The PATCH + pairing + competition writes fire-and-forget;
          // SWR mutate at the end of saveEditEvent reconciles the
          // overview once the server confirms.
          setEditingEvent(false);
          setActiveSection("overview");
          void saveEditEvent();
        }}
        disabled={!hasEdits}
        className="flex-1 bg-action text-white py-2.5 rounded-xl font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed"
      >Save</button>
      <button
        onClick={() => { startEditEvent(); setActiveSection("overview"); }}
        className="flex-1 bg-gray-100 text-foreground py-2.5 rounded-xl font-medium text-sm"
      >Cancel</button>
    </div>
  );

  const renderWhen = () => (
    <div className={`${frameClass} p-4 space-y-3`}>
      {/* Status is first — it's the most actionable knob and what
          organizers come here to change most often (open/close
          registration, override the league auto-advance, etc.). */}
      <div>
        <label className="block text-sm font-medium text-muted mb-1">Status</label>
        {/* For LEAGUE events past Setup, the Setup option is hidden
            from non-admin users — they can't push the event back into
            the hidden state once the round has been published. App
            admin gets the full list for incident recovery. */}
        {(() => {
          const isLeague = !!event.round;
          const hideSetup = isLeague && editStatus !== "setup" && !isAdmin;
          return (
            <select value={editStatus} onChange={(e) => { setEditStatus(e.target.value); setHasEdits(true); }}
              className="w-full border border-border rounded-lg px-3 py-2.5 text-sm font-medium">
              {!hideSetup && <option value="setup">Setup</option>}
              <option value="open">Open</option>
              <option value="closed">Closed</option>
            </select>
          );
        })()}
        {/* Tiny explainer below the field, tailored to the current
            selection. League events get extra context about the auto
            transitions driven by the parent Round. */}
        <p className="text-[11px] text-muted mt-1">
          {editStatus === "setup"
            ? (event.round
                ? "Hidden from everyone except league admin. Auto-flips to Open when the round is published."
                : "Hidden from players. Only you can see the event while shaping it.")
            : editStatus === "open"
              ? "Registration is open — players can sign up."
              : editStatus === "closed"
                ? "Sign-ups are locked. Lineup-locking is handled separately on the lineup page."
                : ""}
        </p>
      </div>
      <div>
        <label className="block text-sm font-medium text-muted mb-1">Event Name</label>
        <input type="text" value={editName} onChange={(e) => { setEditName(e.target.value); setHasEdits(true); }}
          className="w-full border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50" />
      </div>
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="block text-sm font-medium text-muted mb-1">Start Date</label>
          <input type="date" value={editDate} onChange={(e) => { setEditDate(e.target.value); if (!editEndDate) setEditEndDate(e.target.value); setHasEdits(true); }}
            className="w-full border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50" />
        </div>
        <div className="flex-1">
          <label className="block text-sm font-medium text-muted mb-1">End Date</label>
          <input type="date" value={editEndDate} onChange={(e) => { setEditEndDate(e.target.value); setHasEdits(true); }}
            min={editDate}
            className="w-full border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50" />
        </div>
      </div>
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="block text-sm font-medium text-muted mb-1">From</label>
          <input type="time" value={editTime} step={300} onChange={(e) => { setEditTime(e.target.value); setHasEdits(true); }}
            className="w-full border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50" />
        </div>
        <div className="flex-1">
          <label className="block text-sm font-medium text-muted mb-1">To</label>
          <input type="time" value={editEndTime} step={300} onChange={(e) => { setEditEndTime(e.target.value); setHasEdits(true); }}
            className="w-full border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50" />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-muted mb-1">Courts</label>
        <select value={editCourts} onChange={(e) => { setEditCourts(parseInt(e.target.value)); setHasEdits(true); }}
          className="w-full border border-border rounded-lg px-3 py-2.5 text-sm font-medium">
          {[1, 2, 3, 4, 5, 6, 8, 10, 12].map((n) => (
            <option key={n} value={n}>{n} court{n !== 1 ? "s" : ""}</option>
          ))}
        </select>
      </div>
      {event.club?.locations && event.club.locations.length > 0 && (
        <div>
          <label className="block text-sm font-medium text-muted mb-1">Location</label>
          {event.club.locations.length === 1 ? (
            <div className="flex items-center gap-2 py-2 px-3 rounded-lg bg-gray-50 text-sm">
              <span>📍</span>
              <span className="font-medium">{event.club.locations[0].name}</span>
            </div>
          ) : (
            <select
              value={editLocationId || ""}
              onChange={(e) => {
                const nextId = e.target.value || null;
                // Smart-mirror Event.numCourts onto the new location's
                // default — but ONLY when the operator hasn't manually
                // overridden. Heuristic: if editCourts currently matches
                // the OLD location's numCourts (or matches no location
                // when there isn't one), assume default-tracking and
                // adopt the new location's numCourts. Otherwise leave
                // their manual override alone.
                const locs = (event.club?.locations ?? []) as { id: string; numCourts?: number | null }[];
                const prevLoc = locs.find((l) => l.id === editLocationId);
                const nextLoc = locs.find((l) => l.id === nextId);
                const prevDefault = (prevLoc?.numCourts ?? null);
                if (nextLoc && (prevDefault === null || editCourts === prevDefault)) {
                  const next = typeof nextLoc.numCourts === "number" && nextLoc.numCourts > 0 ? nextLoc.numCourts : editCourts;
                  if (next !== editCourts) setEditCourts(next);
                }
                setEditLocationId(nextId);
                setHasEdits(true);
              }}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              {(event.club.locations as { id: string; name: string; numCourts?: number | null }[]).map((loc) => (
                <option key={loc.id} value={loc.id}>📍 {loc.name}{typeof loc.numCourts === "number" ? ` · ${loc.numCourts} courts` : ""}</option>
              ))}
            </select>
          )}
        </div>
      )}
      {/* Competition toggle — local state + Save/Cancel flow */}
      <div className="border-t border-border pt-3">
        <label className="flex items-center gap-3 cursor-pointer">
          <div
            className={`w-11 h-6 rounded-full transition-colors relative ${editCompetitionMode ? "bg-action" : "bg-gray-200"}`}
            onClick={() => {
              setEditCompetitionMode((v) => !v);
              setHasEdits(true);
            }}
          >
            <div className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform"
              style={{ transform: editCompetitionMode ? "translateX(22px)" : "translateX(0)" }} />
          </div>
          <div>
            <span className={`text-sm font-bold ${editCompetitionMode ? "text-foreground" : "text-muted/60"}`}>
              {editCompetitionMode ? "🏆 Competition Mode" : "Competition Mode"}
            </span>
            <p className={`text-xs ${editCompetitionMode ? "text-muted" : "text-muted/50"}`}>
              Groups → Elimination tournament
            </p>
          </div>
        </label>
      </div>
      {/* Speaker — moved here from the overview. Lives with the rest of
          the per-event configuration so the overview stays clean. */}
      <div className="border-t border-border pt-3">
        <SpeakerMode eventId={id as string} userId={userId || ""} userName={session?.user?.name || ""} isManager={canManage} />
      </div>
      {editButtons}
    </div>
  );

  // ── Section: Event Format (scoring + mode + ranking) ──
  const renderScoring = () => (
    <div className={`${frameClass} p-4 space-y-3`}>
      <p className="text-xs text-muted -mt-1">
        Default format and pairing mode during the event.
      </p>
      <select value={editFormat} onChange={(e) => { setEditFormat(e.target.value); setHasEdits(true); }}
        className="w-full border border-border rounded-lg px-3 py-2.5 text-sm font-medium">
        <option value="doubles">Doubles</option>
        <option value="singles">Singles</option>
      </select>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="block text-xs font-medium text-muted mb-1">Scoring</label>
          <select value={editScoringFormat} onChange={(e) => { setEditScoringFormat(e.target.value); setHasEdits(true); }}
            className="w-full border border-border rounded-lg px-2 py-2 text-xs font-medium">
            <option value="timed">Open / timed</option>
            <optgroup label="Normal — 1 Set">
              <option value="1x7">1 to 7</option>
              <option value="1x9">1 to 9</option>
              <option value="1x11">1 to 11</option>
              <option value="1x15">1 to 15</option>
            </optgroup>
            <optgroup label="Normal — Best of 3">
              <option value="3x11">Bo3 to 11</option>
              <option value="3x15">Bo3 to 15</option>
            </optgroup>
            <optgroup label="Rally — 1 Set">
              <option value="1xR15">1 rally to 15</option>
              <option value="1xR21">1 rally to 21</option>
            </optgroup>
            <optgroup label="Rally — Best of 3">
              <option value="3xR15">Bo3 rally to 15</option>
              <option value="3xR21">Bo3 rally to 21</option>
            </optgroup>
          </select>
        </div>
        <div>
          {/* Win-by hides itself when Scoring = "timed" — there's no
              target, so no win-by to define. The empty slot keeps the
              Max-min field anchored in column 3. */}
          {editScoringFormat !== "timed" ? (
            <>
              <label className="block text-xs font-medium text-muted mb-1">Win by</label>
              <select value={editWinBy} onChange={(e) => { setEditWinBy(e.target.value); setHasEdits(true); }}
                className="w-full border border-border rounded-lg px-2 py-2 text-xs font-medium">
                <option value="1">1</option>
                <option value="2">2</option>
                <optgroup label="Win by 2 — golden point at N">
                  {Array.from({ length: 14 }, (_, i) => i + 12).map((n) => (
                    <option key={`gp${n}`} value={`2_gp${n}`}>2 (GP @{n})</option>
                  ))}
                </optgroup>
                <optgroup label="Cap to N (first to N wins)">
                  {Array.from({ length: 14 }, (_, i) => i + 12).map((n) => (
                    <option key={`cap${n}`} value={`cap${n}`}>Cap {n}</option>
                  ))}
                </optgroup>
              </select>
            </>
          ) : (
            <div aria-hidden className="invisible">
              <label className="block text-xs font-medium mb-1">·</label>
              <div className="px-2 py-2 text-xs">·</div>
            </div>
          )}
        </div>
        <div>
          <label className="block text-xs font-medium text-muted mb-1">Max min</label>
          <input
            type="number"
            min={1}
            max={60}
            placeholder="—"
            value={editMaxMinutes}
            onChange={(e) => { setEditMaxMinutes(e.target.value); setHasEdits(true); }}
            className="w-full border border-border rounded-lg px-2 py-2 text-xs font-medium"
          />
        </div>
      </div>
      {/* Single explainer line that describes how scoring + timer
          combine. Scoring rules always apply implicitly; the timer is a
          safety cap so a match can also end before the target is hit. */}
      {(() => {
        const isTimed = editScoringFormat === "timed";
        if (isTimed) {
          if (editMaxMinutes.trim() === "") {
            return <p className="text-xs text-muted -mt-1">Open / timed — no target, no timer. Players submit whatever score they end on.</p>;
          }
          return <p className="text-xs text-muted -mt-1">Open / timed — match runs for {editMaxMinutes} min. Players submit whatever score they end on; the leading team wins.</p>;
        }
        const target = parseInt(editScoringFormat.replace(/^[13]x/, "").replace("R", ""), 10) || 11;
        const wbLabel = editWinBy === "1" ? "first to target" : editWinBy.startsWith("cap") ? `cap ${editWinBy.replace("cap", "")}` : editWinBy.startsWith("2_gp") ? `win by 2 (golden point @${editWinBy.split("gp")[1]})` : "win by 2";
        if (editMaxMinutes.trim() === "") {
          return <p className="text-xs text-muted -mt-1">Matches play out to {target}, {wbLabel}. No timer.</p>;
        }
        return <p className="text-xs text-muted -mt-1">Matches play to {target}, {wbLabel}. After {editMaxMinutes} min the timer auto-finalises at whatever the score is — the leading team wins.</p>;
      })()}
      {/* ── Mode & Teams (was on the pairing settings sub-page) ────── */}
      <div className="border-t border-border pt-3 space-y-3">
        <div>
          <label className="block text-xs font-medium text-muted mb-1">Pairing mode</label>
          <div className="grid grid-cols-4 gap-1">
            {([
              { v: "king", label: "King", icon: "👑" },
              { v: "random", label: "Random", icon: "🎲" },
              { v: "skill", label: "Skill", icon: "🎯" },
              { v: "manual", label: "Manual", icon: "✋" },
            ] as const).map(({ v, label, icon }) => (
              <button
                key={v}
                type="button"
                onClick={() => { setEditBaseMode(v); setHasEdits(true); }}
                className={`px-2 py-1.5 rounded-lg text-[11px] font-semibold border ${
                  editBaseMode === v ? "bg-action text-white border-action" : "bg-white text-foreground border-border"
                }`}
              >
                <span className="mr-0.5">{icon}</span>{label}
              </button>
            ))}
          </div>
        </div>
        {editBaseMode !== "manual" && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-medium text-muted">Teams</label>
              <Link href={`/events/${id}/pairing`}
                className="text-[10px] text-action font-medium px-2 py-0.5 rounded hover:bg-action/10"
              >
                Set pairs →
              </Link>
            </div>
            <div className="flex gap-1">
              {([["rotating", "Rotating"], ["fixed", "Fixed"]] as const).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => { setEditTeams(v); setHasEdits(true); }}
                  className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium ${
                    editTeams === v ? "bg-selected text-white" : "bg-gray-100 text-foreground"
                  }`}
                >{label}</button>
              ))}
            </div>
          </div>
        )}
        {editBaseMode !== "manual" && (
          <div>
            <label className="block text-xs font-medium text-muted mb-1">Gender rule</label>
            <div className="flex gap-1">
              {([
                { v: "random", label: "Any" },
                { v: "mixed", label: "Mixed" },
                { v: "same", label: "Same Gender" },
              ] as const).map(({ v, label }) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => { setEditGender(v); setHasEdits(true); }}
                  className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-medium ${
                    editGender === v ? "bg-selected text-white" : "bg-gray-100 text-foreground"
                  }`}
                >{label}</button>
              ))}
            </div>
            {editBaseMode === "king" && editGender === "mixed" && (
              <p className="text-[11px] text-muted mt-1">
                In King, teams on each court are formed 1M + 1F when possible. Court placement still follows winners-up / losers-down, so opposing teams may have different gender mixes. For strict separation, use two classes.
              </p>
            )}
            {editBaseMode === "king" && editGender === "same" && (
              <p className="text-[11px] text-muted mt-1">
                In King, each team is kept same-gender within a court when possible (M+M or F+F), but the opposing team may be the other gender. For strict M / F brackets, use two classes.
              </p>
            )}
          </div>
        )}
        {editBaseMode === "skill" && (
          <div>
            <label className="block text-xs font-medium text-muted mb-1">Skill window</label>
            <div className="flex gap-1">
              {([0, 1, 2, "inf"] as const).map((v) => (
                <button
                  key={String(v)}
                  type="button"
                  onClick={() => { setEditSkillWindow(v); setHasEdits(true); }}
                  className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-medium ${
                    editSkillWindow === v ? "bg-selected text-white" : "bg-gray-100 text-foreground"
                  }`}
                >±{v === "inf" ? "∞" : v}</button>
              ))}
            </div>
            <p className="text-[11px] text-muted mt-1">Max skill-level spread across the 4 players on a court.</p>
          </div>
        )}
      </div>
      <div className="border-t border-border pt-3">
        <label className="block text-sm font-medium text-muted mb-1">Ranking</label>
        <select value={editRankingMode} onChange={(e) => { setEditRankingMode(e.target.value); setHasEdits(true); }}
          className="w-full border border-border rounded-lg px-3 py-2.5 text-sm font-medium">
          <option value="ranked">Auto Ranked</option>
          <option value="approval">Approval Ranked</option>
          <option value="none">Unranked</option>
        </select>
        <p className="text-xs text-muted mt-1">
          {editRankingMode === "ranked" ? "Scores count towards player rankings immediately." : editRankingMode === "approval" ? "Scores need confirmation by both teams or event admin before counting." : "Scores recorded but don't affect rankings."}
        </p>
      </div>
      {editButtons}
    </div>
  );

  // ── Section: Pairing ──
  const pairingOptions = [
    { value: "random", icon: "🎲", label: "Random", desc: "Random matchups, everyone plays" },
    { value: "skill_balanced", icon: "📊", label: "Skill", desc: "Similar ratings play each other" },
    { value: "mixed_gender", icon: "👫", label: "Mixed", desc: "Each team has one male + one female" },
    { value: "skill_mixed_gender", icon: "📊👫", label: "Skill + Mix", desc: "Balanced ratings with mixed gender teams" },
    { value: "king_of_court", icon: "👑", label: "King", desc: "Winners move up courts, losers move down" },
    { value: "swiss", icon: "🇨🇭", label: "Swiss", desc: "Fixed pairs matched by win/loss record" },
    { value: "manual", icon: "✏️", label: "Manual", desc: "Create matches one by one" },
  ];

  const renderPairing = () => (
    <div className={`${frameClass} p-4 space-y-3`}>
      <Link
        href={`/events/${id}/pairing`}
        className="block bg-primary/5 border border-primary/30 rounded-lg px-3 py-2.5 text-sm font-medium text-primary hover:bg-primary/10 transition-colors"
      >
        Try the new pairing configurator →
        <span className="block text-[11px] font-normal text-muted mt-0.5">
          Live feasibility analyzer, per-event skill levels, manual pair locks, and a unified solver.
        </span>
      </Link>
      <div>
        <label className="block text-sm font-medium text-muted mb-1">Match Pairing</label>
        <select value={editPairingMode} onChange={(e) => { setEditPairingMode(e.target.value); setHasEdits(true); }}
          className="w-full border border-border rounded-lg px-3 py-2.5 text-sm font-medium">
          {pairingOptions.map((m) => (
            <option key={m.value} value={m.value}>{m.icon} {m.label}</option>
          ))}
        </select>
        <p className="text-xs text-muted mt-1">{pairingOptions.find((p) => p.value === editPairingMode)?.desc}</p>
      </div>
      <div>
        <label className="block text-sm font-medium text-muted mb-1">Skill Source</label>
        <select value={editSkillSource} onChange={(e) => { setEditSkillSource(e.target.value as "rating" | "manual"); setHasEdits(true); }}
          className="w-full border border-border rounded-lg px-3 py-2.5 text-sm font-medium">
          <option value="rating">App Rating</option>
          <option value="manual">Manual Level (1-3)</option>
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium text-muted mb-1">Play Mode</label>
        <select value={editPlayMode} onChange={(e) => { setEditPlayMode(e.target.value); setHasEdits(true); }}
          className="w-full border border-border rounded-lg px-3 py-2.5 text-sm font-medium">
          <option value="round_based">🔄 Round-based</option>
          <option value="continuous">⚡ Continuous</option>
        </select>
        <p className="text-xs text-muted mt-1">{editPlayMode === "round_based" ? "All matches finish before generating next round" : "New match starts as soon as a court is free"}</p>
      </div>

      {/* Priority toggles — only for continuous */}
      {editPlayMode === "continuous" && (
        <div className="space-y-2">
          <label className="block text-sm font-medium text-muted">Prioritize</label>
          {[
            { key: "speed", value: editPrioSpeed, set: setEditPrioSpeed, label: "⚡ Speed", desc: "Fill courts immediately" },
            { key: "fairness", value: editPrioFairness, set: setEditPrioFairness, label: "⚖️ Fairness", desc: "Equal play time for everyone" },
            { key: "skill", value: editPrioSkill, set: setEditPrioSkill, label: "📊 Skill", desc: "Group by level" },
            { key: "variety", value: editPrioVariety, set: setEditPrioVariety, label: "🔀 Variety", desc: "Play with and against everybody" },
          ].map((p) => (
            <label key={p.key} className={`flex items-center gap-3 py-2 px-3 rounded-lg cursor-pointer transition-all ${
                p.value ? "bg-selected/10 border border-selected/30" : "bg-gray-50 border border-transparent"
              }`}>
              <input type="checkbox" checked={p.value} onChange={() => { p.set(!p.value); setHasEdits(true); }}
                className="rounded border-border" />
              <div>
                <span className="text-sm font-medium">{p.label}</span>
                <span className="text-xs text-muted ml-1.5">{p.desc}</span>
              </div>
            </label>
          ))}
        </div>
      )}
      {editButtons}
    </div>
  );

  // ── Section: Ranking ──
  const renderRanking = () => (
    <div className={`${frameClass} p-4 space-y-3`}>
      <p className="text-xs text-muted">Do matches count towards app player rankings?</p>
      <div className="flex gap-2">
        {[
          { value: "ranked", label: "Ranked" },
          { value: "approval", label: "Approval" },
          { value: "none", label: "Unranked" },
        ].map((m) => (
          <button key={m.value} type="button" onClick={() => { setEditRankingMode(m.value); setHasEdits(true); }}
            className={`flex-1 py-2.5 rounded-lg font-medium transition-all text-sm ${
              editRankingMode === m.value ? "bg-selected text-white" : "bg-gray-100 text-foreground hover:bg-gray-200"
            }`}>
            {m.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted">
        {editRankingMode === "ranked" && "Scores count towards player rankings immediately after each match."}
        {editRankingMode === "approval" && "Scores are recorded but need confirmation before affecting rankings."}
        {editRankingMode === "none" && "Scores are recorded for the event but don't affect player rankings."}
      </p>
    </div>
  );

  // ── Section: Administrators ──
  const renderAdmins = () => {
    const availablePlayers = allPlayers
      .filter((p) => p.id !== event.createdById && !event.helpers.some((h) => h.playerId === p.id))
      .filter((p) => nameMatchesSearch(p.name, adminSearch))
      .sort((a, b) => a.name.localeCompare(b.name));

    const owner = event.createdById
      ? event.players.find((ep) => ep.player.id === event.createdById)?.player
        ?? allPlayers.find((p) => p.id === event.createdById)
      : null;

    return (
      <div className="space-y-3">
        {/* Organizer */}
        {owner && (
          <div>
            <h4 className="text-sm font-medium text-muted mb-1">Organizer</h4>
            <div className="flex items-center gap-2 rounded-lg px-3 py-2 bg-purple-50">
              <PlayerAvatar name={owner.name} photoUrl={owner.photoUrl} size="sm" />
              <span className="text-lg font-medium">{owner.name}</span>
              <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full font-medium ml-auto">Organizer</span>
            </div>
            {(isOwner || isAdmin) && (
              <details className="mt-1">
                <summary className="text-[10px] text-muted cursor-pointer">Transfer to other organizer</summary>
                <select className="w-full mt-1 border border-border rounded-lg px-3 py-2 text-sm"
                  defaultValue=""
                  onChange={async (e) => {
                    const newOwnerId = e.target.value;
                    if (!newOwnerId) return;
                    const newOwner = [...event.helpers.map((h) => h.player), ...event.players.map((ep) => ep.player)].find((p) => p.id === newOwnerId);
                    if (!await confirmDialog({
                      title: "Transfer to other organizer?",
                      message: `${newOwner?.name || "This person"} becomes the new event organizer. You'll be added as a helper.`,
                      confirmText: "Transfer",
                      cancelText: "Cancel",
                      danger: true,
                    })) { e.target.value = ""; return; }
                    await fetch(`/api/events/${id}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ createdById: newOwnerId }),
                    });
                    fetchEvent();
                  }}>
                  <option value="">Select new organizer...</option>
                  {event.helpers.map((h) => (
                    <option key={h.playerId} value={h.playerId}>{h.player.name} (helper)</option>
                  ))}
                  {event.players.filter((ep) => ep.player.id !== event.createdById && !event.helpers.some((h) => h.playerId === ep.player.id)).map((ep) => (
                    <option key={ep.player.id} value={ep.player.id}>{ep.player.name}</option>
                  ))}
                </select>
              </details>
            )}
          </div>
        )}

        {/* Current helpers */}
        <div>
          <h4 className="text-sm font-medium text-muted mb-1">Helpers ({event.helpers.length})</h4>
          {event.helpers.length > 0 ? (
            <div className="space-y-1">
              {event.helpers.map((h) => (
                <div key={h.playerId} className="flex items-center gap-2 rounded-lg px-3 py-2">
                  <PlayerAvatar name={h.player.name} photoUrl={h.player.photoUrl} size="sm" />
                  <span className="text-lg font-medium flex-1">{h.player.name}</span>
                  {(isOwner || isAdmin) && (
                    <button onClick={() => removeHelper(h.playerId)}
                      className="text-sm text-danger px-3 py-1.5 rounded-lg hover:bg-red-50 font-medium">Remove</button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted py-2">No helpers added yet</p>
          )}
        </div>

        {/* Add helper — owner/admin only */}
        {(isOwner || isAdmin) && (
          <div>
            {!showAddHelper ? (
              <button
                onClick={() => { fetchAllPlayers(); setShowAddHelper(true); setAdminSearch(""); }}
                className="w-full py-2.5 rounded-lg text-sm font-medium text-primary border border-primary/30 hover:bg-primary/5 transition-all"
              >
                + Add Helper
              </button>
            ) : (
              <>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-medium text-muted">Add Helper</h4>
                  <button
                    onClick={() => setShowAddHelper(false)}
                    className="text-xs text-muted hover:text-foreground px-2 py-1 rounded bg-gray-100"
                  >
                    Close
                  </button>
                </div>
                {allPlayers.length === 0 ? (
                  <p className="text-sm text-muted py-2">Loading players...</p>
                ) : (
                  <>
                    <ClearInput value={adminSearch} onChange={setAdminSearch} placeholder="Search by name..." className="text-base mb-2" />
                    <div className="space-y-1 max-h-64 overflow-y-auto">
                      {availablePlayers.map((p) => (
                        <button key={p.id} onClick={async () => { await addHelper(p.id); setShowAddHelper(false); }}
                          className="w-full text-left py-2.5 px-3 rounded-lg hover:bg-gray-50 active:bg-gray-100 flex items-center gap-2 transition-colors">
                          <PlayerAvatar name={p.name} size="sm" />
                          <span className="text-lg font-medium">{p.name}</span>
                        </button>
                      ))}
                      {availablePlayers.length === 0 && (
                        <p className="text-center py-4 text-muted text-sm">No players available to add</p>
                      )}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        )}
        {/* WhatsApp Groups hidden from UI */}
      </div>
    );
  };

  // ── Section: Pairs ──
  const renderPairs = () => {
    const pairedPlayerIds = new Set<string>();
    event.pairs.forEach((p) => { pairedPlayerIds.add(p.player1.id); pairedPlayerIds.add(p.player2.id); });
    const activePlayers2 = event.players.filter((ep) => ep.status === "registered" || ep.status === "checked_in");
    const unpaired = activePlayers2.filter((ep) => !pairedPlayerIds.has(ep.player.id) && !pairingInProgress.has(ep.player.id))
      .sort((a, b) => a.player.name.localeCompare(b.player.name));

    return (
      <div className="space-y-4">
        {/* Selected Pairs */}
        {event.pairs.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium text-muted">Selected Pairs ({event.pairs.length})</h4>
              {canManage && (
                <button onClick={clearAllPairs} className="text-xs text-danger px-2 py-1 rounded hover:bg-red-50">Clear All</button>
              )}
            </div>
            {event.pairs.map((pair) => {
              const ep1 = event.players.find((ep) => ep.player.id === pair.player1.id);
              const ep2 = event.players.find((ep) => ep.player.id === pair.player2.id);
              const lvl1 = ep1?.skillLevel;
              const lvl2 = ep2?.skillLevel;
              const pairLevel = lvl1 && lvl2 ? Math.round((lvl1 + lvl2) / 2) : lvl1 || lvl2 || null;
              return (
                <div key={pair.id} className="group flex items-center gap-2 bg-card rounded-lg border border-border px-3 py-2">
                  <span className="text-sm shrink-0">{pair.player1.emoji}</span>
                  <span className="text-xs font-medium truncate">{pair.player1.name}</span>
                  <span className="text-[10px] text-muted">+</span>
                  <span className="text-sm shrink-0">{pair.player2.emoji}</span>
                  <span className="text-xs font-medium truncate">{pair.player2.name}</span>
                  {editSkillSource === "manual" && pairLevel && (
                    <span className="text-[9px] bg-gray-100 text-muted px-1 py-0.5 rounded">L{pairLevel}</span>
                  )}
                  <span className="text-[10px] text-muted ml-auto">{Math.round(pair.player1.rating + pair.player2.rating)}</span>
                  {canManage && (
                    <button onClick={() => removePair(pair.id)}
                      className="hidden group-hover:block text-xs text-danger px-1.5 py-0.5 rounded hover:bg-red-50 shrink-0">Remove</button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Generation Method */}
        {canManage && (
          <div className={`${frameClass} p-4 space-y-3`}>
            <h4 className="text-sm font-semibold">Generation Method</h4>
            <div className="flex gap-2">
              {([["rating", "Rating"], ["level", "Skill"], ["random", "Random"], ["manual", "Manual"]] as const).map(([val, label]) => (
                <button key={val} onClick={() => setPairMode(val as "rating" | "random")}
                  className={`flex-1 py-2 rounded-lg font-medium text-sm transition-all ${pairMode === val ? "bg-selected text-white" : "bg-gray-100 text-foreground"}`}>
                  {label}
                </button>
              ))}
            </div>

            {/* Prefer mixed — not for Manual */}
            {pairMode !== "manual" && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={pairMixed} onChange={(e) => setPairMixed(e.target.checked)} className="rounded border-border" />
                Prefer mixed gender (M + F)
              </label>
            )}

            {/* Rating or Random → Generate button */}
            {(pairMode === "rating" || pairMode === "random") && (
              <button onClick={generatePairsAuto} disabled={generatingPairs || activePlayers2.length < 2}
                className="w-full bg-action text-white py-2.5 rounded-xl font-semibold text-base active:bg-action-dark disabled:opacity-50">
                {generatingPairs ? "Generating..." : event.pairs.length > 0 ? "Regenerate Pairs" : "Generate Pairs"}
              </button>
            )}

            {/* Skill → show players with level selectors then generate */}
            {pairMode === "level" && (
              <div className="space-y-1.5">
                <p className="text-xs text-muted">Assign skill levels, then generate:</p>
                {unpaired.map((ep) => {
                  const currentLevel = event.players.find((p) => p.player.id === ep.player.id)?.skillLevel;
                  return (
                    <div key={ep.player.id} className="flex items-center gap-2 py-1">
                      <span className="text-xs font-medium flex-1 truncate">{ep.player.emoji} {ep.player.name}</span>
                      {[1, 2, 3].map((lvl) => (
                        <button key={lvl} onClick={() => setSkillLevel(ep.player.id, currentLevel === lvl ? null : lvl)}
                          className={`w-7 h-7 rounded text-xs font-bold transition-all ${currentLevel === lvl ? "bg-selected text-white" : "bg-gray-100 text-foreground"}`}>{lvl}</button>
                      ))}
                    </div>
                  );
                })}
                <button onClick={generatePairsAuto} disabled={generatingPairs || unpaired.length < 2}
                  className="w-full bg-action text-white py-2.5 rounded-xl font-semibold text-sm active:bg-action-dark disabled:opacity-50 mt-2">
                  {generatingPairs ? "Generating..." : event.pairs.length > 0 ? "Regenerate Pairs" : "Generate Pairs"}
                </button>
              </div>
            )}

            {/* Manual → show unpaired players to tap-pair */}
            {pairMode === "manual" && unpaired.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs text-muted">{manualPairSelect ? "Tap second player to pair" : "Tap two players to pair them"}</p>
                {unpaired.map((ep) => (
                  <button key={ep.player.id}
                    disabled={pairingInProgress.size > 0}
                    onClick={() => {
                      if (manualPairSelect === ep.player.id) { setManualPairSelect(null); }
                      else if (manualPairSelect) { createManualPair(manualPairSelect, ep.player.id); }
                      else { setManualPairSelect(ep.player.id); }
                    }}
                    className={`w-full text-left py-2 px-3 rounded-lg flex items-center gap-2 transition-colors ${
                      manualPairSelect === ep.player.id ? "bg-selected/10 border border-selected/30" : manualPairSelect ? "hover:bg-green-50 border border-transparent" : "hover:bg-gray-50 border border-transparent"
                    }`}>
                    <span className="text-lg">{ep.player.emoji}</span>
                    <span className="text-sm font-medium flex-1">{ep.player.name}</span>
                    {ep.player.gender && <span className={`text-[10px] ${ep.player.gender === "M" ? "text-blue-500" : "text-pink-500"}`}>{ep.player.gender === "M" ? "♂" : "♀"}</span>}
                    {manualPairSelect === ep.player.id && <span className="text-xs text-selected font-medium">Selected</span>}
                    {manualPairSelect && manualPairSelect !== ep.player.id && <span className="text-xs text-green-600">Pair</span>}
                  </button>
                ))}
              </div>
            )}

            {pairMode === "manual" && unpaired.length === 0 && event.pairs.length > 0 && (
              <p className="text-xs text-green-600 text-center font-medium">All players paired!</p>
            )}
          </div>
        )}

        {!canManage && unpaired.length > 0 && (
          <div className="space-y-1">
            <h4 className="text-sm font-medium text-muted">Unpaired ({unpaired.length})</h4>
            {unpaired.map((ep) => (
              <div key={ep.player.id} className="flex items-center gap-2 px-3 py-1.5">
                <span className="text-lg">{ep.player.emoji}</span>
                <span className="text-sm font-medium">{ep.player.name}</span>
              </div>
            ))}
          </div>
        )}

        {event.pairs.length === 0 && unpaired.length < 2 && (
          <p className="text-center py-6 text-muted text-sm">Need at least 2 active players to build pairs</p>
        )}
      </div>
    );
  };

  // ── Section: Players — Add Players picker ──
  // Mirrors the club Add Member picker (staging tray, batch save) plus
  // a faded "already in this event" tail so admins searching for a name
  // don't keep hunting when the player is already signed up.
  const renderAddPlayers = () => {
    const eventClubId = event.club?.id || (event as unknown as { clubId?: string }).clubId || null;
    const eventPlayerIds = new Set(event.players.map((ep) => ep.player.id));

    // Shared filter chain — applied to both the eligible list and the
    // "already in event" tail so the tail respects gender/country/club
    // and search just like the main list.
    const passesFilters = (p: Player) =>
      (!addPlayerSearch || nameMatchesSearch(p.name, addPlayerSearch)) &&
      (!addPlayerGender || p.gender === addPlayerGender) &&
      (!addPlayerCountry || !p.country || p.country === addPlayerCountry) &&
      (addPlayerClubFilter !== "club" || !eventClubId
        ? true
        : ((p as unknown as { clubs?: { id: string }[] }).clubs?.some((c) => c.id === eventClubId) ?? false));

    const available = allPlayers
      .filter((p) => !eventPlayerIds.has(p.id))
      .filter((p) => !pendingPlayerIds.has(p.id))
      .filter((p) => !addedPlayerIds.has(p.id))
      .filter(passesFilters)
      .sort((a, b) => a.name.localeCompare(b.name));

    const alreadyInEvent = allPlayers
      .filter((p) => eventPlayerIds.has(p.id))
      .filter(passesFilters)
      .sort((a, b) => a.name.localeCompare(b.name));

    const pendingPlayers = allPlayers.filter((p) => pendingPlayerIds.has(p.id));

    const togglePending = (pid: string) => {
      setPendingPlayerIds((s) => {
        const n = new Set(s);
        if (n.has(pid)) n.delete(pid);
        else n.add(pid);
        return n;
      });
    };

    const closePicker = () => {
      setShowAddPlayer(false);
      setAddPlayerSearch("");
      setAddPlayerGender(null);
      setPendingPlayerIds(new Set());
      setAddedPlayerIds(new Set());
    };

    const savePending = async () => {
      if (pendingPlayerIds.size === 0) return;
      setSavingPlayers(true);
      try {
        const ids = [...pendingPlayerIds];
        await Promise.all(
          ids.map((playerId) =>
            fetch(`/api/events/${id}/players`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ playerId }),
            }),
          ),
        );
        setAddedPlayerIds((s) => {
          const n = new Set(s);
          ids.forEach((pid) => n.add(pid));
          return n;
        });
        setPendingPlayerIds(new Set());
        await fetchEvent();
      } finally {
        setSavingPlayers(false);
      }
    };

    return (
      <div className="space-y-3">
        {/* Blue back link in the content area. The event name itself is
            displayed (non-clickable) in the green hero header above. */}
        <button onClick={closePicker} className="text-sm text-action font-medium">
          ← Players
        </button>
        {/* Transient confirmation toast after a "+ New App User" add.
            Auto-dismisses on its own; tap × to clear immediately. */}
        {addedToast && (
          <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg px-3 py-2 text-sm">
            <span aria-hidden>✓</span>
            <span className="flex-1">
              <strong>{addedToast}</strong> was added to this event.
            </span>
            <button
              type="button"
              onClick={() => setAddedToast(null)}
              className="text-emerald-700 hover:text-emerald-900 px-1"
              aria-label="Dismiss"
            >×</button>
          </div>
        )}
        <div className={`${frameClass} p-4 space-y-3`}>
          {/* Title + Add button on one row */}
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold truncate">Add Players to {heroTitle}</h3>
            <button
              type="button"
              onClick={savePending}
              disabled={pendingPlayers.length === 0 || savingPlayers}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-action text-white disabled:opacity-40 active:bg-action-dark transition-colors shrink-0"
            >
              {savingPlayers
                ? "Adding..."
                : pendingPlayers.length === 0
                  ? "Add"
                  : `Add ${pendingPlayers.length}`}
            </button>
          </div>

          {/* Staging tray */}
          <div className="rounded-lg border border-border bg-gray-50 px-2 py-1.5">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] uppercase tracking-wide text-muted">
                Selected ({pendingPlayers.length})
              </span>
              {pendingPlayers.length > 0 && (
                <button
                  type="button"
                  onClick={() => setPendingPlayerIds(new Set())}
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

          {/* Filter row, left → right: country, club, gender icons.
              Country goes first because it's the broadest filter and is
              defaulted from the session; gender icons go last so the
              line still reads naturally if scanned right-to-left. */}
          <div className="flex items-center gap-2">
            <select
              value={addPlayerCountry}
              onChange={(e) => setAddPlayerCountry(e.target.value)}
              className="flex-1 border border-border rounded-lg px-2 py-1.5 text-xs bg-white"
            >
              <option value="">All countries</option>
              {COUNTRIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            {eventClubId && (
              <button
                type="button"
                onClick={() => setAddPlayerClubFilter((cur) => (cur === "club" ? "all" : "club"))}
                title={`Only members of ${event.club?.name || "the club"}`}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
                  addPlayerClubFilter === "club"
                    ? "bg-black text-white"
                    : "bg-gray-100 text-foreground"
                }`}
              >
                Club
              </button>
            )}
            {(["M", "F"] as const).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setAddPlayerGender((cur) => (cur === g ? null : g))}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
                  addPlayerGender === g ? "bg-selected text-white" : "bg-gray-100 text-foreground"
                }`}
              >
                <span className={addPlayerGender === g ? "text-white" : g === "M" ? "text-blue-500" : "text-pink-500"}>
                  {g === "M" ? "♂" : "♀"}
                </span>
              </button>
            ))}
          </div>

          <ClearInput value={addPlayerSearch} onChange={setAddPlayerSearch} placeholder="Search by name..." className="text-sm" />

          <div className="flex items-center justify-between text-[11px] text-muted">
            <span>
              {available.length} available
              {addedPlayerIds.size > 0 && ` · ${addedPlayerIds.size} added so far`}
            </span>
            {/* "Add a player who doesn't have an account yet". The
                API auto-attaches the new player to this event. The
                returnTo encodes a `__NEW_NAME__` sentinel which
                /players/new substitutes after a successful POST, so
                the event page can show a "Foo added" toast. */}
            <Link
              href={`/players/new?eventId=${event.id}&returnTo=${encodeURIComponent(`/events/${event.id}?openAddPlayer=1&addedName=__NEW_NAME__`)}`}
              className="text-action font-medium"
            >+ New App User</Link>
          </div>

          {available.length === 0 && alreadyInEvent.length === 0 ? (
            <p className="text-xs text-muted text-center py-6">No players match these filters</p>
          ) : (
            <>
              <div className="space-y-0.5">
                {available.map((p) => (
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
              {/* Already-in-event tail. Faded, non-clickable. Confirms
                  to the admin "yes, this person is already signed up". */}
              {alreadyInEvent.length > 0 && (
                <div className="mt-3 pt-3 border-t border-dashed border-border">
                  <div className="text-[10px] uppercase tracking-wide text-muted mb-1.5">
                    Already in this event ({alreadyInEvent.length})
                  </div>
                  <div className="space-y-0.5">
                    {alreadyInEvent.map((p) => (
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
                        <span className="text-[10px] text-muted font-medium">✓ signed up</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Sticky bottom — just Done. Primary "Add N" lives next to the title. */}
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
  };

  const renderAddGuests = () => {
    const eventClubId = event.club?.id || (event as unknown as { clubId?: string }).clubId || null;
    const eventPlayerIds = new Set(event.players.map((ep) => ep.player.id));
    const teamId = addGuestTeamId;
    // The league's full team list lives on event.round.league.teams. Each
    // team carries its full roster (team.players) which we use to exclude
    // already-rostered players of the PLAYING teams.
    const allLeagueTeamsLocal = (event.round?.league?.teams || []) as Array<{ id: string; name: string; players?: { playerId: string }[] }>;
    const team = teamId ? allLeagueTeamsLocal.find((t) => t.id === teamId) : null;
    const teamName = team?.name || (event.leagueTeams?.find((lt) => lt.team.id === teamId)?.team.name ?? "team");

    // Exclude rosters of the two PLAYING teams — those go through the
    // regular roster picker. Players on OTHER league teams ARE eligible
    // as guests.
    const playingRosterIds = new Set<string>();
    for (const lt of (event.leagueTeams || [])) {
      const full = allLeagueTeamsLocal.find((t) => t.id === lt.team.id);
      for (const tp of (full?.players ?? [])) playingRosterIds.add(tp.playerId);
    }
    const passesFilters = (p: Player) =>
      (!addGuestSearch || nameMatchesSearch(p.name, addGuestSearch)) &&
      (!addGuestGender || p.gender === addGuestGender) &&
      (!addGuestCountry || !p.country || p.country === addGuestCountry) &&
      (addGuestClubFilter !== "club" || !eventClubId
        ? true
        : ((p as unknown as { clubs?: { id: string }[] }).clubs?.some((c) => c.id === eventClubId) ?? false));

    const stagedIds = new Set(pendingGuestEntries.keys());
    const available = allPlayers
      .filter((p) => !eventPlayerIds.has(p.id) && !playingRosterIds.has(p.id))
      .filter((p) => !stagedIds.has(p.id))
      .filter((p) => !addedGuestIds.has(p.id))
      .filter(passesFilters)
      .sort((a, b) => a.name.localeCompare(b.name));
    const pendingPlayers = allPlayers.filter((p) => stagedIds.has(p.id));

    const stagePlayer = (pid: string) => {
      setPendingGuestEntries((prev) => {
        const next = new Map(prev);
        if (next.has(pid)) next.delete(pid);
        else next.set(pid, "social");
        return next;
      });
    };
    const toggleIntent = (pid: string) => {
      setPendingGuestEntries((prev) => {
        const next = new Map(prev);
        const cur = next.get(pid);
        next.set(pid, cur === "social" ? "attending" : "social");
        return next;
      });
    };
    const closePicker = () => {
      setShowAddGuest(false);
      setAddGuestTeamId(null);
      setAddGuestSearch("");
      setAddGuestGender(null);
      setAddGuestCountry("");
      setAddGuestClubFilter("club");
      setPendingGuestEntries(new Map());
      setAddedGuestIds(new Set());
    };
    const savePending = async () => {
      if (pendingGuestEntries.size === 0 || !teamId) return;
      setSavingGuests(true);
      try {
        // API takes ONE intent per call, so batch by intent.
        const entries = [...pendingGuestEntries.entries()];
        const socialIds = entries.filter(([, i]) => i === "social").map(([pid]) => pid);
        const attendIds = entries.filter(([, i]) => i === "attending").map(([pid]) => pid);
        const calls: Promise<Response>[] = [];
        if (socialIds.length > 0) {
          calls.push(fetch(`/api/events/${event.id}/signup-prefs`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerIds: socialIds, intent: "social", teamId }),
          }));
        }
        if (attendIds.length > 0) {
          calls.push(fetch(`/api/events/${event.id}/signup-prefs`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerIds: attendIds, intent: "attending", teamId }),
          }));
        }
        const results = await Promise.all(calls);
        if (results.some((r) => !r.ok)) {
          await alertDialog("Failed to add some guests", "Error");
        }
        const allIds = entries.map(([pid]) => pid);
        setAddedGuestIds((s) => {
          const n = new Set(s);
          allIds.forEach((pid) => n.add(pid));
          return n;
        });
        setPendingGuestEntries(new Map());
        await fetchEvent();
      } finally {
        setSavingGuests(false);
      }
    };

    return (
      <div className="space-y-3">
        <button onClick={closePicker} className="text-sm text-action font-medium">
          ← Players
        </button>
        <div className={`${frameClass} p-4 space-y-3`}>
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold truncate">Add Guests to {teamName}</h3>
            <button
              type="button"
              onClick={savePending}
              disabled={pendingGuestEntries.size === 0 || savingGuests}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-action text-white disabled:opacity-40 active:bg-action-dark transition-colors shrink-0"
            >
              {savingGuests
                ? "Adding..."
                : pendingGuestEntries.size === 0
                  ? "Add"
                  : `Add ${pendingGuestEntries.size}`}
            </button>
          </div>

          {/* Staging tray. Each chip shows the assigned intent — tap the
              icon to flip Social ↔ Attend; tap × to remove from tray. */}
          <div className="rounded-lg border border-border bg-gray-50 px-2 py-1.5">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] uppercase tracking-wide text-muted">
                Selected ({pendingGuestEntries.size})
              </span>
              {pendingGuestEntries.size > 0 && (
                <button
                  type="button"
                  onClick={() => setPendingGuestEntries(new Map())}
                  className="text-[11px] text-danger font-medium hover:underline"
                >Clear all</button>
              )}
            </div>
            {pendingGuestEntries.size === 0 ? (
              <div className="text-[11px] text-muted italic">
                Tap players below to stage them. Default is 🎾 Social — tap the icon on a chip to flip to 👋 Attend.
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {pendingPlayers.map((p) => {
                  const intent = pendingGuestEntries.get(p.id) || "social";
                  return (
                    <div
                      key={p.id}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-action/10 text-foreground text-xs border border-action/30"
                    >
                      <span className="font-medium">{p.name}</span>
                      {p.gender && (
                        <span className={p.gender === "F" ? "text-pink-500" : "text-blue-500"}>
                          {p.gender === "F" ? "♀" : "♂"}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => toggleIntent(p.id)}
                        title={intent === "social" ? "Tap to flip to Attend" : "Tap to flip to Social"}
                        className="px-1"
                      >{intent === "social" ? "🎾" : "👋"}</button>
                      <button
                        type="button"
                        onClick={() => stagePlayer(p.id)}
                        className="text-muted px-1"
                        title="Remove from selection"
                      >×</button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Filter row mirrors Add Players: country (left, broadest),
              club toggle (middle), gender icons (right). */}
          <div className="flex items-center gap-2">
            <select
              value={addGuestCountry}
              onChange={(e) => setAddGuestCountry(e.target.value)}
              className="flex-1 border border-border rounded-lg px-2 py-1.5 text-xs bg-white"
            >
              <option value="">All countries</option>
              {COUNTRIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            {eventClubId && (
              <button
                type="button"
                onClick={() => setAddGuestClubFilter((cur) => (cur === "club" ? "all" : "club"))}
                title={`Only members of ${event.club?.name || "the club"}`}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
                  addGuestClubFilter === "club"
                    ? "bg-black text-white"
                    : "bg-gray-100 text-foreground"
                }`}
              >
                Club
              </button>
            )}
            {(["M", "F"] as const).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setAddGuestGender((cur) => (cur === g ? null : g))}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium ${addGuestGender === g ? "bg-selected text-white" : "bg-gray-100 text-foreground"}`}
              >
                <span className={addGuestGender === g ? "text-white" : g === "M" ? "text-blue-500" : "text-pink-500"}>
                  {g === "M" ? "♂" : "♀"}
                </span>
              </button>
            ))}
          </div>

          <ClearInput value={addGuestSearch} onChange={setAddGuestSearch} placeholder="Search by name..." className="text-sm" />

          <div className="flex items-center justify-between text-[11px] text-muted">
            <span>
              {available.length} available
              {addedGuestIds.size > 0 && ` · ${addedGuestIds.size} added so far`}
            </span>
          </div>

          {available.length === 0 ? (
            <p className="text-xs text-muted text-center py-6">No players match these filters</p>
          ) : (
            <div className="space-y-0.5">
              {available.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => stagePlayer(p.id)}
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
                    {(p.country || (p.clubs && p.clubs.length > 0)) && (
                      <div className="mt-0.5 flex items-center gap-1 flex-wrap">
                        {p.country && <span className="text-[10px] text-muted">{p.country}</span>}
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
          )}

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
  };

  const renderBulkSelect = () => {
    const eventPlayerIds = new Set(event.players.map((ep) => ep.player.id));
    // Build the club-member set from the enriched allPlayers list so the
    // PlayerSelector can offer a "Club" filter when the event has one.
    const eventClubId = event.club?.id || (event as unknown as { clubId?: string }).clubId || null;
    const clubMemberIds = eventClubId
      ? new Set(
          (allPlayers as unknown as { id: string; clubs?: { id: string }[] }[])
            .filter((p) => p.clubs?.some((c) => c.id === eventClubId))
            .map((p) => p.id),
        )
      : undefined;
    const clubLabel = "Club";
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-bold text-foreground">Add Players</h3>
          <button
            onClick={() => setBulkSelectMode(false)}
            className="bg-action text-white px-4 py-2 rounded-lg font-medium text-sm active:bg-action-dark transition-colors"
          >
            Done
          </button>
        </div>
        <PlayerSelector
          players={allPlayers as { id: string; name: string; gender?: string | null }[]}
          selectedIds={eventPlayerIds}
          recentIds={eventPlayerIds}
          clubMemberIds={clubMemberIds}
          clubLabel={clubLabel}
          onToggle={async (pid) => {
            if (eventPlayerIds.has(pid)) {
              const p = allPlayers.find((pl) => pl.id === pid);
              await removePlayer(pid, p?.name || "");
            } else {
              await addPlayerToEvent(pid);
            }
          }}
        />
      </div>
    );
  };

  const renderPlayers = () => {
    // Competition mode: summary across classes, no add/leave at event level
    if (event.competitionMode) {
      // Deduplicate players (can be in multiple classes)
      // Build unique player list with their class memberships
      const playerClasses = new Map<string, { player: typeof event.players[0]; classNames: string[] }>();
      const classes = event.classes || [];
      const classNameMap = new Map(classes.map((c: { id: string; name: string }) => [c.id, c.name]));
      for (const ep of event.players) {
        const existing = playerClasses.get(ep.player.id);
        const className = classNameMap.get((ep as unknown as { classId?: string }).classId || "") || "";
        if (existing) {
          if (className && !existing.classNames.includes(className)) existing.classNames.push(className);
        } else {
          playerClasses.set(ep.player.id, { player: ep, classNames: className ? [className] : [] });
        }
      }
      // Filter out players with no class, sort: females first then males
      const genderOrder = (g: string | null | undefined) => g === "F" ? 0 : g === "M" ? 1 : 2;
      const allPlayers = [...playerClasses.values()]
        .filter((e) => e.classNames.length > 0)
        .sort((a, b) =>
          genderOrder(a.player.player.gender) - genderOrder(b.player.player.gender) || a.player.player.name.localeCompare(b.player.player.name)
        );
      const femaleCount = allPlayers.filter((e) => e.player.player.gender === "F").length;
      const maleCount = allPlayers.filter((e) => e.player.player.gender === "M").length;

      return (
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-xl font-bold text-foreground">
              Players ({allPlayers.length})
            </h3>
            {(["F", "M"] as const).map((g) => (
              <button key={g} onClick={() => setPlayerSearch((prev) => prev === `__gender_${g}` ? "" : `__gender_${g}`)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${
                  playerSearch === `__gender_${g}` ? "bg-selected text-white" : "bg-gray-100 text-foreground"
                }`}>
                {g === "F" ? `♀ ${femaleCount}` : `♂ ${maleCount}`}
              </button>
            ))}
          </div>

          {allPlayers.length > 6 && (
            <ClearInput value={playerSearch.startsWith("__gender_") ? "" : playerSearch} onChange={setPlayerSearch} placeholder="Search participants..." className="text-base" />
          )}
          <div className="space-y-0">
            {allPlayers
              .filter((entry) => {
                if (playerSearch === "__gender_F") return entry.player.player.gender === "F";
                if (playerSearch === "__gender_M") return entry.player.player.gender === "M";
                return nameMatchesSearch(entry.player.player.name, playerSearch);
              })
              .map((entry) => {
                const p = entry.player.player;
                return (
                  <div key={p.id} className="flex items-center gap-2 py-2.5 px-3 border-b border-border last:border-b-0">
                    <PlayerAvatar name={p.name} size="sm" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1">
                        <span className="text-sm font-medium truncate">{p.name}</span>
                        {p.gender && (
                          <span className={`text-[10px] ${p.gender === "M" ? "text-blue-500" : "text-pink-500"}`}>
                            {p.gender === "M" ? "♂" : "♀"}
                          </span>
                        )}
                      </div>
                      <div className="flex gap-1 mt-0.5 flex-wrap">
                        {p.duprRating && <span className="text-[9px] bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded-full">DUPR {p.duprRating.toFixed(2)}</span>}
                        <span className="text-[9px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded-full">App {Math.round(p.rating)}</span>
                        {entry.classNames.map((cn) => (
                          <span key={cn} className="text-[9px] bg-gray-100 text-muted px-1.5 py-0.5 rounded-full">{cn}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      );
    }

    // Non-competition mode: standard player management
    if (bulkSelectMode && canManage) return renderBulkSelect();
    if (showAddGuest) return renderAddGuests();
    if (showAddPlayer && canManage) return renderAddPlayers();

    return (
      <div className="space-y-3 pt-2">
        {session?.user && !canManage && event.openSignup && (
          <div className="flex justify-end">
            {event.players.some((ep) => ep.player.id === (session.user as { id: string }).id) ? (
              <button onClick={unsignFromEvent} className="text-xs text-danger px-3 py-1.5 rounded hover:bg-red-50">Leave event</button>
            ) : (
              <button onClick={signupForEvent} className="text-sm bg-action text-white px-4 py-1.5 rounded-lg font-medium">Join</button>
            )}
          </div>
        )}
        {/* + Player above the filter row. Outlined (process-style)
            button, matches the convention of the club Add Member entry. */}
        {canManage && !bulkSelectMode && !showAddPlayer && !levelEditMode && (
          <div className="flex justify-end">
            <button
              onClick={() => {
                fetchAllPlayers();
                setAddPlayerSearch("");
                setAddPlayerGender(null);
                setAddPlayerCountry(
                  (session?.user as { country?: string | null } | undefined)?.country || "",
                );
                setAddPlayerClubFilter(event.club ? "club" : "all");
                setPendingPlayerIds(new Set());
                setAddedPlayerIds(new Set());
                setShowAddPlayer(true);
              }}
              className="text-action border border-action/30 px-4 py-2 rounded-lg font-medium text-sm hover:bg-action/5 active:bg-action/10 transition-colors"
            >
              + Player
            </button>
          </div>
        )}
        <div className="flex items-center gap-2">
          {event.players.length > 6 && (
            <ClearInput value={playerSearch} onChange={setPlayerSearch} placeholder="Search participants..." className="text-base flex-1" />
          )}
          {/* Home/Away toggle — only meaningful on league events with 2 teams.
              Click toggles in/out (no "Both" pill needed; deselected = both). */}
          {event.round && (event.leagueTeams?.length ?? 0) === 2 && (
            <div className="flex gap-1 shrink-0">
              {(["home", "away"] as const).map((side) => (
                <button key={side}
                  onClick={() => setPlayerTeamFilter((prev) => prev === side ? null : side)}
                  title={side === "home" ? "Home only" : "Away only"}
                  className={`px-2 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    playerTeamFilter === side ? "bg-selected text-white" : "bg-gray-100 text-foreground"
                  }`}>{side === "home" ? "🏠" : "✈️"}</button>
              ))}
            </div>
          )}
          {/* Gender toggle — click to filter to that gender, click again to clear.
              No "All" button: deselected = all. */}
          <div className="flex gap-1 shrink-0">
            {[
              { value: "M" as const, label: "♂" },
              { value: "F" as const, label: "♀" },
            ].map((g) => (
              <button key={g.label}
                onClick={() => setPlayerGenderFilter((prev) => prev === g.value ? null : g.value)}
                className={`px-2 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  playerGenderFilter === g.value ? "bg-selected text-white" : "bg-gray-100 text-foreground"
                }`}>{g.label}</button>
            ))}
          </div>
        </div>
        {/* Skill-level grouping is for non-league managed events. League
            events always render the 2-column-by-team view (in the next
            branch) regardless of the viewer's role. */}
        {canManage && !(event.round && (event.leagueTeams?.length ?? 0) === 2) ? (() => {
          const filtered = event.players.filter((ep) => nameMatchesSearch(ep.player.name, playerSearch) && (!playerGenderFilter || ep.player.gender === playerGenderFilter));
          const groups = new Map<number | "unset", typeof filtered>();
          for (const ep of filtered) {
            const key = ep.skillLevel ?? "unset";
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key)!.push(ep);
          }
          const playerMatchCounts = new Map<string, number>();
          for (const m of event.matches) for (const p of m.players) playerMatchCounts.set(p.playerId, (playerMatchCounts.get(p.playerId) || 0) + 1);
          // Late-joiner offset: stored on EventPlayer.matchCountOffset.
          // Effective count (used by the fairness algorithm) = real + offset.
          const playerOffsetMap = new Map<string, number>();
          for (const ep of event.players ?? []) {
            const off = (ep as { matchCountOffset?: number }).matchCountOffset;
            if (off && off > 0) playerOffsetMap.set(ep.player.id, off);
          }
          const matchCountLabel = (pid: string) => {
            const real = playerMatchCounts.get(pid) || 0;
            const off = playerOffsetMap.get(pid) || 0;
            return off > 0 ? `${real}+${off}m` : `${real}m`;
          };
          const matchCountTitle = (pid: string) => {
            const off = playerOffsetMap.get(pid) || 0;
            if (off === 0) return undefined;
            const real = playerMatchCounts.get(pid) || 0;
            return `Joined mid-event with +${off} starting offset. Effective: ${real + off}.`;
          };
          const rows: { key: number | "unset"; label: string }[] = [
            { key: 5, label: "L5" },
            { key: 4, label: "L4" },
            { key: 3, label: "L3" },
            { key: 2, label: "L2" },
            { key: 1, label: "L1" },
            { key: "unset", label: "Players registered for Event" },
          ];
          const assignLevel = (playerIds: string[], target: number | "unset") => {
            const level = target === "unset" ? null : target;
            for (const pid of playerIds) setSkillLevel(pid, level);
            setLevelSelectedIds(new Set());
            setLevelDragId(null);
            setLevelDragOver(null);
            setExpandedEmptyLevels(new Set());
          };
          const pickingTap = levelSelectedIds.size > 0;
          const handleDrop = (target: number | "unset") => {
            const pid = levelDragId;
            if (!pid) return;
            const ids = levelSelectedIds.has(pid) ? Array.from(levelSelectedIds) : [pid];
            assignLevel(ids, target);
          };
          return (
            <div className="space-y-2">
              <div className="flex items-center gap-2 px-1">
                <span className="text-xs text-muted">
                  {(() => {
                    const checkedIn = event.players.filter((ep) => ep.status === "checked_in").length;
                    const paused = event.players.filter((ep) => ep.status === "paused").length;
                    const notArrived = event.players.filter((ep) => ep.status === "registered").length;
                    const parts = [];
                    parts.push(`${checkedIn} active`);
                    if (paused > 0) parts.push(`${paused} paused`);
                    if (notArrived > 0) parts.push(`${notArrived} not arrived`);
                    return parts.join(" · ");
                  })()}
                </span>
                {levelEditMode && pickingTap && (
                  <button onClick={() => setLevelSelectedIds(new Set())} className="text-[11px] text-muted underline">Clear ({levelSelectedIds.size})</button>
                )}
                {levelEditMode && (
                  <button
                    onClick={async () => {
                      const ok = await confirmDialog({
                        title: "Recalculate from ratings?",
                        message: "Every player's level will be reset to the value computed from their DUPR or app rating. Manual overrides will be lost.",
                        danger: true,
                        confirmText: "Recalculate",
                      });
                      if (!ok) return;
                      const classes = event.classes || [];
                      for (const cls of classes) {
                        await fetch(`/api/events/${id}/pairing/skill-levels`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ action: "recalculate", classId: cls.id }),
                        });
                      }
                      await fetchEvent();
                    }}
                    className="text-[10px] text-action font-medium border border-action/30 px-2 py-1 rounded-lg"
                  >
                    Recalculate
                  </button>
                )}
                <div className="flex-1" />
                {event.players.some((ep) => ep.status === "registered") && !levelEditMode && (
                  <button
                    onClick={async () => {
                      const registered = event.players.filter((ep) => ep.status === "registered");
                      // Optimistic: flip all to checked_in immediately
                      setEvent((prev) => {
                        if (!prev) return prev;
                        return { ...prev, players: prev.players.map((ep) => ep.status === "registered" ? { ...ep, status: "checked_in" } : ep) };
                      });
                      // API calls in background
                      for (const ep of registered) {
                        fetch(`/api/events/${id}/players/${ep.player.id}/checkin`, { method: "POST" });
                      }
                      // Sync after all calls
                      setTimeout(() => fetchEvent(), 1000);
                    }}
                    className="text-[10px] text-action font-medium border border-action/30 px-2 py-1 rounded-lg"
                  >
                    <span className="w-3 h-3 bg-green-500 text-white rounded-full flex items-center justify-center text-[7px] font-bold inline-flex">✓</span> Check in all
                  </button>
                )}
                {/* + Player moved up above the filter row. */}
                <button
                  onClick={() => { setLevelEditMode((p) => !p); setLevelSelectedIds(new Set()); setRemoveMode(false); setPendingRemoveIds(new Set()); }}
                  className="text-[10px] text-action font-medium border border-action/30 px-2 py-1 rounded-lg"
                >
                  {levelEditMode ? "Done" : "Edit levels"}
                </button>
                {canManage && !levelEditMode && (
                  <button
                    onClick={() => {
                      setRemoveMode((p) => {
                        if (p) setPendingRemoveIds(new Set()); // closing = clear staged
                        return !p;
                      });
                    }}
                    className={`text-[10px] font-medium border px-2 py-1 rounded-lg ${
                      removeMode
                        ? "bg-gray-200 text-foreground border-gray-300 hover:bg-gray-300"
                        : "text-danger border-danger/40"
                    }`}
                    title={removeMode ? "Stage players for removal, then press Remove" : "Open remove-player mode"}
                  >
                    {removeMode ? "Cancel" : "Remove Player"}
                  </button>
                )}
              </div>
              {/* Remove-mode staging bar — shows directly below the
                  toolbar. Lists staged players as chips + a red "Remove N"
                  confirm button. */}
              {removeMode && (
                <div className="rounded-lg border border-danger/30 bg-red-50 px-2 py-1.5 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] uppercase tracking-wide text-danger font-semibold">
                      To remove ({pendingRemoveIds.size})
                    </span>
                    <div className="flex items-center gap-1.5">
                      {pendingRemoveIds.size > 0 && (
                        <button
                          type="button"
                          onClick={() => setPendingRemoveIds(new Set())}
                          className="text-[11px] text-danger font-medium hover:underline"
                        >Clear</button>
                      )}
                      <button
                        type="button"
                        onClick={removePendingPlayers}
                        disabled={pendingRemoveIds.size === 0 || removingPlayers}
                        className="px-3 py-1 rounded-lg text-xs font-semibold bg-danger text-white disabled:opacity-40 active:bg-red-700 transition-colors"
                      >
                        {removingPlayers ? "Removing..." : pendingRemoveIds.size === 0 ? "Remove" : `Remove ${pendingRemoveIds.size}`}
                      </button>
                    </div>
                  </div>
                  {pendingRemoveIds.size === 0 ? (
                    <div className="text-[11px] text-danger/70 italic">
                      Tap the <span className="not-italic">🗑️</span> next to each player to stage them for removal.
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {[...pendingRemoveIds].map((pid) => {
                        const ep = event.players.find((e) => e.player.id === pid);
                        const name = ep?.player.name || "?";
                        return (
                          <button
                            key={pid}
                            type="button"
                            onClick={() => setPendingRemoveIds((s) => { const n = new Set(s); n.delete(pid); return n; })}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white text-danger text-[11px] border border-danger/30 hover:bg-red-100"
                            title="Tap to unstage"
                          >
                            <span className="font-medium">{name}</span>
                            <span className="text-danger/70">×</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
              {rows.map((row) => {
                // Sort by name (A→Z). Used to be rating-DESC then name —
                // alphabetical is easier to scan when looking for a
                // specific person, and gender icon now sits before the
                // name so the row reads "♂ Ana", "♀ Beatriz", …
                const eps = (groups.get(row.key) || []).sort((a, b) =>
                  a.player.name.localeCompare(b.player.name),
                );
                const isOver = levelDragOver === row.key;
                const isEmpty = eps.length === 0;
                const expanded = expandedEmptyLevels.has(row.key);
                if (isEmpty && !levelEditMode) return null;

                return (
                  <div
                    key={String(row.key)}
                    onDragOver={levelEditMode ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (levelDragOver !== row.key) setLevelDragOver(row.key); } : undefined}
                    onDragLeave={levelEditMode ? () => setLevelDragOver(null) : undefined}
                    onDrop={levelEditMode ? (e) => { e.preventDefault(); handleDrop(row.key); } : undefined}
                    onClick={levelEditMode && pickingTap ? () => assignLevel(Array.from(levelSelectedIds), row.key) : undefined}
                    className={`bg-card rounded-xl border p-3 transition-colors ${
                      isOver ? "border-action border-2 bg-action/10"
                        : levelEditMode && pickingTap ? "border-action border-dashed border-2"
                        : "border-border"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-border">
                      <span className={`text-sm font-bold ${row.key === "unset" ? "text-muted" : ""}`}>
                        {row.label}
                      </span>
                      {levelEditMode && pickingTap ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); assignLevel(Array.from(levelSelectedIds), row.key); }}
                          className="bg-action text-white text-[11px] font-semibold px-3 py-1 rounded-full active:bg-action-dark"
                        >
                          Move {levelSelectedIds.size} here
                        </button>
                      ) : (
                        <span className="text-[10px] text-muted">{eps.length} player{eps.length === 1 ? "" : "s"}</span>
                      )}
                    </div>
                    {isEmpty ? (
                      <p className="text-[10px] text-muted italic">drop here</p>
                    ) : (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                        {eps.map((ep) => {
                          const isMe = ep.player.id === userId;
                          const selected = levelSelectedIds.has(ep.player.id);
                          const dragging = levelDragId === ep.player.id;
                          const isPaused = ep.status === "paused";
                          const isRegistered = ep.status === "registered";
                          const isCheckedIn = ep.status === "checked_in";
                          const stagedForRemoval = removeMode && pendingRemoveIds.has(ep.player.id);
                          return (
                            <div
                              key={ep.player.id}
                              draggable={levelEditMode}
                              onDragStart={levelEditMode ? (e) => { setLevelDragId(ep.player.id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", ep.player.id); } : undefined}
                              onDragEnd={levelEditMode ? () => { setLevelDragId(null); setLevelDragOver(null); } : undefined}
                              className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 min-w-0 transition-all ${
                                stagedForRemoval ? "bg-red-50 ring-1 ring-danger/40"
                                  : selected ? "bg-action text-white"
                                  : dragging ? "opacity-50 bg-gray-100"
                                  : isPaused ? "bg-amber-100 opacity-60"
                                  : isRegistered ? "bg-gray-50"
                                  : "bg-gray-50 hover:bg-gray-100"
                              }`}
                            >
                              {/* Name area: behavior depends on active mode.
                                  - level edit: tap = toggle selection
                                  - remove mode: tap = stage/unstage for removal
                                  - default: tap = toggle check-in */}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (levelEditMode) {
                                    setLevelSelectedIds((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(ep.player.id)) next.delete(ep.player.id);
                                      else next.add(ep.player.id);
                                      return next;
                                    });
                                  } else if (removeMode) {
                                    setPendingRemoveIds((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(ep.player.id)) next.delete(ep.player.id);
                                      else next.add(ep.player.id);
                                      return next;
                                    });
                                  } else {
                                    checkInPlayer(ep.player.id);
                                  }
                                }}
                                className="flex items-center gap-1.5 min-w-0 flex-1 text-left"
                              >
                                <span className={`relative shrink-0 ${isRegistered ? "opacity-40" : ""}`}>
                                  <PlayerAvatar name={ep.player.name} photoUrl={ep.player.photoUrl} size="xs" />
                                  {(isCheckedIn || isPaused) && (
                                    <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full flex items-center justify-center text-[7px] font-bold ${
                                      isPaused ? "bg-green-300 text-white" : "bg-green-500 text-white"
                                    }`}>✓</span>
                                  )}
                                </span>
                                {/* Gender icon sits BEFORE the name (♂ Ana,
                                    ♀ Beatriz, …) — easier to scan in a
                                    grid sorted alphabetically. */}
                                {ep.player.gender && (
                                  <span className={`text-[10px] shrink-0 ${ep.player.gender === "F" ? "text-pink-500" : "text-blue-500"}`}>
                                    {ep.player.gender === "F" ? "♀" : "♂"}
                                  </span>
                                )}
                                <div className="min-w-0 flex-1">
                                  <div className={`text-[11px] font-medium truncate ${
                                    selected ? "font-bold"
                                    : isPaused ? "line-through text-muted"
                                    : isRegistered ? "text-muted"
                                    : isMe ? "text-action font-bold"
                                    : ""
                                  }`}>{ep.player.name}</div>
                                </div>
                              </button>
                              {/* Match count + pause: tap = toggle pause.
                                  Replaced by a stage-for-removal toggle
                                  when removeMode is on. */}
                              {!levelEditMode && !removeMode && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); togglePausePlayer(ep.player.id); }}
                                  className={`flex items-center gap-0.5 shrink-0 px-1 py-0.5 rounded transition-colors ${
                                    isPaused ? "text-amber-600" : "text-muted hover:text-amber-600"
                                  }`}
                                  title={isPaused ? "Tap to unpause" : "Tap to pause"}
                                >
                                  <span className={`text-[10px] tabular-nums ${playerOffsetMap.has(ep.player.id) ? "text-blue-500" : ""}`} title={matchCountTitle(ep.player.id)}>{matchCountLabel(ep.player.id)}</span>
                                  <span className="text-[9px]">⏸</span>
                                </button>
                              )}
                              {!levelEditMode && removeMode && (() => {
                                const staged = pendingRemoveIds.has(ep.player.id);
                                return (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setPendingRemoveIds((s) => {
                                        const n = new Set(s);
                                        if (n.has(ep.player.id)) n.delete(ep.player.id);
                                        else n.add(ep.player.id);
                                        return n;
                                      });
                                    }}
                                    className={`flex items-center shrink-0 px-1.5 py-0.5 rounded transition-colors ${
                                      staged
                                        ? "bg-danger/10 ring-1 ring-danger/40 text-danger"
                                        : "text-danger hover:bg-red-50 active:bg-red-100"
                                    }`}
                                    title={staged ? `Unstage ${ep.player.name}` : `Stage ${ep.player.name} for removal`}
                                    aria-label={staged ? `Unstage ${ep.player.name}` : `Stage ${ep.player.name} for removal`}
                                  >
                                    <span className="text-sm">{staged ? "✓" : "🗑️"}</span>
                                  </button>
                                );
                              })()}
                              {levelEditMode && (
                                <span className={`text-[10px] tabular-nums shrink-0 ${selected ? "text-white/90" : playerOffsetMap.has(ep.player.id) ? "text-blue-500" : "text-muted"}`} title={matchCountTitle(ep.player.id)}>
                                  {matchCountLabel(ep.player.id)}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })() : event.round && (event.leagueTeams?.length ?? 0) === 2 ? (() => {
          // League event: render participants in two columns by team. Hide
          // the opposing team's column until BOTH teams mark "lineup ready",
          // unless the viewer is an organizer/admin.
          const allLeagueTeams = event.round!.league.teams || [];
          const ets = event.leagueTeams || [];
          const canSeeAll = isAdmin || canManage;
          // "My team" = any team in this event where the viewer is a roster
          // player, captain, or vice-captain. Captains/vices may not be on
          // the roster themselves — their authority alone unlocks visibility
          // of their own team's signed-up names (opponents stay hidden until
          // both teams mark lineup ready).
          const myTeamId = allLeagueTeams.find((t) =>
            ets.some((et) => et.teamId === t.id) &&
            (t.captainId === userId || t.viceCaptainId === userId || t.players.some((p) => p.playerId === userId)),
          )?.id ?? null;
          const bothReady = ets.every((et) => et.lineupReady);
          // Reality check: which players are actually placed in a lineup
          // slot for this event? Drives the participant-row icon — see
          // the row rendering below for the four cases.
          const linedUpPlayerIds = new Set<string>();
          for (const g of (event.leagueGames ?? [])) {
            for (const gp of g.gamePlayers) linedUpPlayerIds.add(gp.playerId);
          }
          const lineupFixed = bothReady;
          const teamColumn = (et: LeagueEventTeamLink) => {
            const fullTeam = allLeagueTeams.find((t) => t.id === et.teamId);
            const rosterIds = new Set((fullTeam?.players ?? []).map((p) => p.playerId));
            const isMyTeam = et.teamId === myTeamId;
            const hidden = !canSeeAll && !bothReady && !isMyTeam;
            // Adding to a team's roster is restricted to: captain/vice of
            // THIS team, league director/deputy, or app admin. Event-level
            // managers (event owner / event helpers) deliberately can't
            // add players to either team's roster — only league-level
            // people can manage rosters across teams.
            const isCaptainHere = !!userId && (fullTeam?.captainId === userId || fullTeam?.viceCaptainId === userId);
            const isLeagueAdmin = !!isLeagueOrganizerOfEvent;
            const canAddToTeam = isCaptainHere || isLeagueAdmin || isAdmin;
            // Include both roster sign-ups AND guests tagged to this team
            // (signupPreferences._guestTeamId === et.teamId). Guests render
            // with a "guest" badge so it's clear they aren't on the team
            // roster — see the row rendering below.
            const eps = event.players
              .filter((ep) => {
                if (rosterIds.has(ep.player.id)) return true;
                const prefs = (ep.signupPreferences || {}) as Record<string, unknown>;
                return typeof prefs._guestTeamId === "string" && prefs._guestTeamId === et.teamId;
              })
              .filter((ep) => nameMatchesSearch(ep.player.name, playerSearch) && (!playerGenderFilter || ep.player.gender === playerGenderFilter))
              .sort((a, b) => a.player.name.localeCompare(b.player.name));
            // Roster players who haven't signed up yet — eligible for the
            // "+ Add" picker. Note: these are full team rosters from the
            // league API; we expose name/photo via fullTeam.players.player.
            const signedUpIds = new Set(event.players.map((p) => p.player.id));
            type RosterPlayer = { playerId: string; player: { id: string; name: string; photoUrl?: string | null; gender?: string | null } };
            const rosterUnsigned = ((fullTeam?.players ?? []) as RosterPlayer[])
              .filter((tp) => !signedUpIds.has(tp.playerId))
              .sort((a, b) => a.player.name.localeCompare(b.player.name));
            return (
              <div key={et.teamId} className="min-w-0">
                <div className="text-[11px] font-bold text-foreground px-1 py-1 flex items-center gap-1">
                  {et.team.name}
                  {et.lineupReady && <span className="text-emerald-600 text-[10px]">✓ ready</span>}
                </div>
                {hidden ? (
                  <p className="text-[11px] text-muted italic px-1 py-2">
                    {eps.length} signed up — names revealed once both teams mark lineup ready.
                  </p>
                ) : eps.length === 0 ? (
                  <p className="text-[11px] text-muted italic px-1 py-2">No sign-ups yet.</p>
                ) : (
                  <div className="space-y-0.5">
                    {eps.map((ep) => {
                      // Reality-aware icon for the row:
                      //   - In a lineup slot → 🏆 (non-faded) regardless of phase
                      //   - "Can't come" → ❌ always
                      //   - Pre-lineup-fixed AND not in lineup → preferred icon, FADED
                      //     (their stated intent, still aspirational)
                      //   - Post-lineup-fixed AND not in lineup → social/attending
                      //     (they weren't picked; downgrade from "playing")
                      const prefs = (ep.signupPreferences || {}) as Record<string, { level?: string } | string | undefined>;
                      const sentinel = typeof prefs._intent === "string" ? prefs._intent : null;
                      const isGuest = !rosterIds.has(ep.player.id);
                      const hasAnyPlay = Object.entries(prefs).some(([k, v]) => k !== "_intent" && k !== "_guestTeamId" && typeof v === "object" && v !== null && (v.level === "prefer" || v.level === "ok"));
                      const preferred: "playing" | "social" | "attending" | "unavailable" =
                        ep.status === "unavailable" ? "unavailable"
                          : sentinel === "social" ? "social"
                          : sentinel === "attending" ? "attending"
                          : hasAnyPlay ? "playing"
                          : "attending";
                      const inLineup = linedUpPlayerIds.has(ep.player.id);
                      const ix: "playing" | "social" | "attending" | "unavailable" =
                        preferred === "unavailable" ? "unavailable"
                          : inLineup ? "playing"
                          : lineupFixed ? (sentinel === "social" || preferred === "social" ? "social" : "attending")
                          : preferred;
                      const ixIcon = ix === "playing" ? "🏆" : ix === "social" ? "🎾" : ix === "attending" ? "👋" : "❌";
                      // Fade the icon when it represents an unrealised
                      // preference (pre-fix, not yet in a lineup). Once
                      // the lineup is fixed OR the player IS in a slot,
                      // show it solid.
                      const iconFaded = !lineupFixed && !inLineup && preferred === "playing";
                      const isMe = ep.player.id === userId;
                      // Captain/vice of THIS team, league/event admin, or
                      // app admin can edit a player's prefs (and remove
                      // them) via the sign-up form. Self can edit their
                      // own. The pen for admins routes to the on-behalf
                      // sign-up flow which also offers a "Remove from
                      // event" button.
                      const canEdit = canAddToTeam || isMe;
                      // edit=1 is a hint for the sign-up page so its
                      // initial-render header says "Edit preferences"
                      // instead of "Sign up" before the API fetch lands.
                      const editHref = isMe
                        ? `/events/${event.id}/sign-up?edit=1`
                        : `/events/${event.id}/sign-up?for=${ep.player.id}&edit=1`;
                      const genderIcon = ep.player.gender ? (
                        <span className={`text-[10px] shrink-0 ${ep.player.gender === "F" ? "text-pink-500" : "text-blue-500"}`}>
                          {ep.player.gender === "F" ? "♀" : "♂"}
                        </span>
                      ) : null;
                      return (
                        <div key={ep.player.id} className={`flex items-center gap-1.5 px-1 py-1 rounded ${isGuest ? "bg-amber-50/60 border border-dashed border-amber-200" : ""}`}>
                          {/* Row body is plain text now — only the pen
                              icon at the end opens the preferences
                              page. Tapping the name itself does
                              nothing. */}
                          <PlayerAvatar name={ep.player.name} photoUrl={ep.player.photoUrl} size="xs" />
                          {genderIcon}
                          <span className={`flex-1 min-w-0 text-xs leading-tight break-words ${isMe ? "text-action font-bold" : "font-medium"} ${isGuest ? "italic" : ""} ${ix === "unavailable" ? "line-through text-muted" : ""}`}>
                            {ep.player.name}
                            {isGuest && <span className="text-[9px] text-amber-700 not-italic font-normal ml-1">(guest)</span>}
                          </span>
                          {ep.player.hasAccount === false && canAddToTeam && (
                            <span title="Unclaimed account" className="text-[9px] shrink-0 bg-amber-100 text-amber-700 px-1 rounded-full font-medium">⚠</span>
                          )}
                          {/* Always show the participation icon (no
                              inline flip), and a single pen icon when
                              the viewer can edit. Removal moves to
                              the bottom of the sign-up/preferences
                              page (consistent for roster + guests). */}
                          <span
                            className={`text-[11px] shrink-0 ${iconFaded ? "opacity-30" : ""}`}
                            title={
                              ix === "playing"
                                ? (inLineup ? "In lineup" : "Wants to play liga")
                                : ix === "social"
                                  ? "Social play"
                                  : ix === "attending"
                                    ? (lineupFixed && preferred === "playing" ? "Wasn't picked — attending" : "Just attending")
                                    : "Can't come"
                            }
                          >
                            {ixIcon}
                          </span>
                          {canEdit && (
                            <Link
                              href={editHref}
                              aria-label="Edit preferences"
                              className="text-muted hover:text-action shrink-0 px-1"
                            >
                              <PenIcon />
                            </Link>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          };
          // Full-width add-picker rendered BELOW the 2-column grid so player
          // names can wrap freely. One picker per team the viewer can add to.
          const teamAddPicker = (et: LeagueEventTeamLink) => {
            const fullTeam = allLeagueTeams.find((t) => t.id === et.teamId);
            const isCaptainHere = !!userId && (fullTeam?.captainId === userId || fullTeam?.viceCaptainId === userId);
            const isLeagueAdmin = !!isLeagueOrganizerOfEvent;
            const canAddToTeam = isCaptainHere || isLeagueAdmin || isAdmin;
            if (!canAddToTeam) return null;
            const signedUpIds = new Set(event.players.map((p) => p.player.id));
            type RosterPlayer = { playerId: string; player: { id: string; name: string; photoUrl?: string | null; gender?: string | null; hasAccount?: boolean } };
            const rosterUnsigned = ((fullTeam?.players ?? []) as RosterPlayer[])
              .filter((tp) => !signedUpIds.has(tp.playerId))
              .sort((a, b) => a.player.name.localeCompare(b.player.name));
            if (rosterUnsigned.length === 0) return null;
            const teamSelected = rosterUnsigned.filter((tp) => rosterAddSelected.has(tp.playerId));
            const allSelected = teamSelected.length === rosterUnsigned.length;
            const toggleAll = () => {
              setRosterAddSelected((prev) => {
                const next = new Set(prev);
                if (allSelected) rosterUnsigned.forEach((tp) => next.delete(tp.playerId));
                else rosterUnsigned.forEach((tp) => next.add(tp.playerId));
                return next;
              });
            };
            const togglePlayer = (pid: string) => {
              setRosterAddSelected((prev) => {
                const next = new Set(prev);
                if (next.has(pid)) next.delete(pid);
                else next.add(pid);
                return next;
              });
            };
            const onAddSelected = async () => {
              if (teamSelected.length === 0) return;
              setRosterAddSaving(true);
              const r = await fetch(`/api/events/${event.id}/signup-prefs`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ playerIds: teamSelected.map((tp) => tp.playerId) }),
              });
              setRosterAddSaving(false);
              if (!r.ok) {
                const d = await r.json().catch(() => ({}));
                await alertDialog(d.error || "Failed to add players", "Error");
                return;
              }
              setRosterAddSelected((prev) => {
                const next = new Set(prev);
                teamSelected.forEach((tp) => next.delete(tp.playerId));
                return next;
              });
              await fetchEvent();
            };
            // Uncontrolled <details> — the user manages open/closed
            // themselves. Previously we passed `open={teamSelected.length > 0}`
            // which auto-collapsed the picker when the last selected
            // player was deselected, which is not what anyone wants.
            return (
              <details key={`add-${et.teamId}`} className="mt-2 px-1">
                <summary className="text-xs text-action font-medium cursor-pointer">
                  + Add player to {et.team.name} ({rosterUnsigned.length})
                </summary>
                {/* Select all / Clear all sits INSIDE the collapsed area
                    so it doesn't compete with the summary text. */}
                <div className="mt-2 flex justify-end">
                  <button
                    type="button"
                    onClick={toggleAll}
                    className="text-[11px] text-muted hover:text-action underline"
                  >{allSelected ? "Clear all" : "Select all"}</button>
                </div>
                <div className="mt-1 space-y-1">
                  {rosterUnsigned.map((tp) => {
                    const selected = rosterAddSelected.has(tp.playerId);
                    return (
                      <button
                        key={tp.playerId}
                        type="button"
                        onClick={() => togglePlayer(tp.playerId)}
                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left border ${selected ? "border-action bg-action/10" : "border-border hover:bg-gray-50"}`}
                      >
                        <span className={`shrink-0 w-4 h-4 rounded border ${selected ? "bg-action border-action text-white text-[10px] flex items-center justify-center" : "border-border"}`}>
                          {selected ? "✓" : ""}
                        </span>
                        <PlayerAvatar name={tp.player.name} photoUrl={tp.player.photoUrl} size="xs" />
                        {tp.player.gender && <span className={`text-xs shrink-0 ${tp.player.gender === "F" ? "text-pink-500" : "text-blue-500"}`}>{tp.player.gender === "F" ? "♀" : "♂"}</span>}
                        <span className="text-sm flex-1">{tp.player.name}</span>
                        {tp.player.hasAccount === false && (
                          <span title="Unclaimed account" className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-medium">⚠ unclaimed</span>
                        )}
                      </button>
                    );
                  })}
                </div>
                {event.round?.league?.id && (
                  <div className="mt-2 pt-2 border-t border-border flex justify-end">
                    <Link
                      href={`/players/new?leagueId=${event.round.league.id}&teamId=${et.teamId}&returnTo=${encodeURIComponent(`/events/${event.id}`)}`}
                      className="text-[11px] text-action font-medium"
                    >+ New player</Link>
                  </div>
                )}
                {teamSelected.length > 0 && (
                  <button
                    type="button"
                    disabled={rosterAddSaving}
                    onClick={onAddSelected}
                    className="mt-2 w-full bg-action text-white text-sm font-semibold py-2 rounded-lg disabled:opacity-50"
                  >{rosterAddSaving ? "Adding…" : `Add ${teamSelected.length} to event`}</button>
                )}
              </details>
            );
          };
          // Per-team "Add guest" entry button. Opens the full-page guest
          // picker (renderAddGuests) tagged to this team. Visible to team
          // captain/vice, league organizer, app admin only.
          const teamGuestPicker = (et: LeagueEventTeamLink) => {
            const fullTeam = allLeagueTeams.find((t) => t.id === et.teamId);
            const isCaptainHere = !!userId && (fullTeam?.captainId === userId || fullTeam?.viceCaptainId === userId);
            const isLeagueAdmin = !!isLeagueOrganizerOfEvent;
            const canAddHere = isCaptainHere || isLeagueAdmin || isAdmin;
            if (!canAddHere) return null;
            const eventClubId = event.club?.id || (event as unknown as { clubId?: string }).clubId || null;
            const openPicker = () => {
              setAddGuestTeamId(et.teamId);
              setAddGuestSearch("");
              setAddGuestGender(null);
              setAddGuestCountry("");
              setAddGuestClubFilter(eventClubId ? "club" : "all");
              setPendingGuestEntries(new Map());
              setAddedGuestIds(new Set());
              setShowAddGuest(true);
              if (allPlayers.length === 0) void fetchAllPlayers();
            };
            return (
              <button
                key={`guest-${et.teamId}`}
                type="button"
                onClick={openPicker}
                className="mt-2 px-1 text-xs text-action font-medium text-left block"
              >
                + Add {et.team.name} Guest
              </button>
            );
          };
          // Determine home/away. Host team (event.hostTeamId) is home;
          // otherwise the first leagueTeam is treated as home.
          const homeTeamId = event.hostTeamId || ets[0]?.teamId;
          const awayTeamId = ets.find((et) => et.teamId !== homeTeamId)?.teamId;
          const visibleEts = playerTeamFilter === "home"
            ? ets.filter((et) => et.teamId === homeTeamId)
            : playerTeamFilter === "away"
            ? ets.filter((et) => et.teamId === awayTeamId)
            : ets;
          // Pickers stack full-width BELOW the team columns. Half-width
          // pickers (anchored under their team column) make long names
          // wrap into 3+ lines; the summary text "+ Add player to X"
          // already makes ownership unambiguous, so we go wide.
          return (
            <>
              <div className={visibleEts.length === 1 ? "" : "grid grid-cols-2 gap-2"}>
                {visibleEts.map((et) => teamColumn(et))}
              </div>
              {visibleEts.map((et) => teamAddPicker(et))}
              {visibleEts.map((et) => teamGuestPicker(et))}
            </>
          );
        })() : (
          <div className="space-y-0">
            {[...event.players]
              .sort((a, b) => a.player.name.localeCompare(b.player.name))
              .filter((ep) => nameMatchesSearch(ep.player.name, playerSearch) && (!playerGenderFilter || ep.player.gender === playerGenderFilter))
              .map((ep) => (
              <SwipeablePlayerRow key={ep.player.id} ep={ep} canManage={canManage} hasMatches={hasMatches}
                isSelf={ep.player.id === userId}
                skillLevel={editSkillSource === "manual" ? ep.skillLevel : undefined}
                onSkillLevel={editSkillSource === "manual" ? (lvl) => setSkillLevel(ep.player.id, lvl) : undefined}
                onCheckIn={ep.status === "registered" ? () => checkInPlayer(ep.player.id) : undefined}
                onPause={() => togglePausePlayer(ep.player.id)} onRemove={() => removePlayer(ep.player.id, ep.player.name)} />
            ))}
          </div>
        )}
        {canManage && (
          <p className="text-[11px] text-muted italic text-center mt-2">Tap name to check in/out · Tap matches/⏸ to pause</p>
        )}
      </div>
    );
  };

  // ── Section: Rounds ──
  // Category lookup for gender/format filtering. League games carry the
  // category via leagueGame.category; non-league matches fall back to
  // event.classes by classId.
  const passesMatchFilters = (m: Match) => {
    // Kind: empty Set = all kinds pass.
    if (matchKindFilter.size > 0) {
      const isPrincipal = m.leagueGame?.kind === "principal";
      const isFriendly = !!m.leagueGame && m.leagueGame.kind !== "principal";
      const isNonLeague = !m.leagueGame;
      const ok = (matchKindFilter.has("principal") && isPrincipal)
        || (matchKindFilter.has("friendly") && isFriendly)
        || (matchKindFilter.has("non-league") && isNonLeague);
      if (!ok) return false;
    }
    // Gender from category (league) or event class. "mix" passes any.
    if (matchGenderFilter) {
      const catGender = m.leagueGame?.category
        ? (m.leagueGame.category as unknown as { gender?: string }).gender
        : (event.classes?.find((c) => c.id === m.classId)?.gender ?? null);
      if (catGender && catGender !== "mix" && catGender !== matchGenderFilter) return false;
    }
    // Format from category. Schema-level format is "singles"/"doubles".
    if (matchFormatFilter) {
      const catFormat = m.leagueGame?.category
        ? (m.leagueGame.category as unknown as { format?: string }).format
        : (event.classes?.find((c) => c.id === m.classId)?.format ?? null);
      if (catFormat && catFormat !== matchFormatFilter) return false;
    }
    // Player-name search: any player on the match matches.
    if (matchPlayerSearch.trim()) {
      const q = matchPlayerSearch.trim().toLowerCase();
      const hit = m.players.some((p) => p.player.name.toLowerCase().includes(q));
      if (!hit) return false;
    }
    return true;
  };
  const completedMatches = event.matches.filter((m) => m.status === "completed").filter(passesMatchFilters);
  const pausedMatches = event.matches.filter((m) => m.status === "paused").filter(passesMatchFilters);
  const activeMatches = event.matches.filter((m) => m.status === "active").filter(passesMatchFilters);
  const pendingMatches = event.matches.filter((m) => m.status === "pending").filter(passesMatchFilters);
  // Sort key for league matches: scheduled time (set by the host captain on
  // the lineup builder) → court → fallback to round/court for non-league.
  const matchSortKey = (m: Match): [number, number, number] => {
    const ts = m.leagueGame?.scheduledAt ? new Date(m.leagueGame.scheduledAt).getTime() : Number.POSITIVE_INFINITY;
    const court = m.leagueGame?.courtNum ?? m.courtNum;
    return [ts, court, m.round];
  };
  const matchCmp = (a: Match, b: Match) => {
    const [at, ac, ar] = matchSortKey(a);
    const [bt, bc, br] = matchSortKey(b);
    return (at - bt) || (ac - bc) || (ar - br);
  };
  const freeCourts = Array.from({ length: event.numCourts }, (_, i) => i + 1)
    .filter((c) => !activeMatches.some((m) => m.courtNum === c) && !pendingMatches.some((m) => m.courtNum === c && m.players.length >= 2));

  const renderMatchCard = (match: Match) => {
    const team1 = match.players.filter((p) => p.team === 1);
    const team2 = match.players.filter((p) => p.team === 2);
    const isCompleted = match.status === "completed";
    const isActive = match.status === "active";
    const isPending = match.status === "pending";
    const isPaused = match.status === "paused";
    const isEditing = editingMatchId === match.id;
    const team1Score = isCompleted ? (team1[0]?.score ?? 0) : null;
    const team2Score = isCompleted ? (team2[0]?.score ?? 0) : null;
    // Use pending scores if available (during optimistic update)
    const displayScore1 = scores[match.id]?.team1 ? parseInt(scores[match.id].team1) : team1Score;
    const displayScore2 = scores[match.id]?.team2 ? parseInt(scores[match.id].team2) : team2Score;
    const team1Won = (displayScore1 ?? team1Score) !== null && (displayScore2 ?? team2Score) !== null && (displayScore1 ?? team1Score ?? 0) > (displayScore2 ?? team2Score ?? 0);
    const team2Won = (displayScore1 ?? team1Score) !== null && (displayScore2 ?? team2Score) !== null && (displayScore2 ?? team2Score ?? 0) > (displayScore1 ?? team1Score ?? 0);
    const isMatchPlayer = session?.user ? [...team1, ...team2].some((mp) => mp.playerId === (session.user as { id: string }).id) : false;
    const canScore = canManage || isMatchPlayer;
    const showInputs = canScore && (isActive || isPaused || isEditing);
    const isNextMatch = nextMatchIdSet.has(match.id);
    const isCourtFree = courtFreeMatchIds.has(match.id);
    const hasLiveScore = scorerMatchId === match.id && scorerLiveScore;

    // Pickle detection: one team scored 0 in a completed match
    const isPickle = isCompleted && displayScore1 !== null && displayScore2 !== null && (displayScore1 === 0 || displayScore2 === 0) && (displayScore1 + displayScore2 > 0);
    const pickleWinnerTeam = isPickle ? (displayScore1 === 0 ? 2 : 1) : null;

    // Court circle color
    const courtColor = isActive ? "bg-orange-500 text-white" : isPaused ? "bg-amber-500 text-white" : isCourtFree && isPending ? "bg-green-500 text-white" : isCompleted ? "bg-gray-300 text-white" : "bg-gray-100 text-muted";
    const statusText = isActive ? "In Play" : isPaused ? "Paused" : isPending && isCourtFree ? "Ready" : isPending && isNextMatch ? "Next" : "";

    const lg = match.leagueGame;
    return (
      <div key={match.id} className={`bg-card rounded-xl border overflow-hidden transition-all ${
        isActive ? "border-orange-400 shadow-md shadow-orange-100" : isPaused ? "border-amber-400" : isCourtFree && isPending ? "border-green-400 shadow-md shadow-green-100" : isMatchPlayer ? "border-action border-l-4" : "border-border"
      }`}>
        {lg && (() => {
          const isPrincipal = lg.kind === "principal";
          const isLeague = lg.kind === "league";
          const tone = isPrincipal ? "bg-emerald-50 text-emerald-700"
            : isLeague ? "bg-blue-50 text-blue-700"
            : "bg-gray-50 text-muted";
          const icon = isPrincipal ? "🏆" : isLeague ? "🎯" : "⚪";
          const label = isPrincipal ? "Principal" : isLeague ? "League" : "Extra";
          return (
            <div className={`flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium ${tone}`}>
              <span>{icon}</span>
              <span>{label}</span>
              <span className="text-muted ml-1">· {lg.category.name}</span>
            </div>
          );
        })()}
        <div className="flex items-center gap-2 px-2 py-2"
          onClick={() => setActionSheetMatchId(match.id)}>
          {/* Court number circle — start button for pending */}
          <div className="flex flex-col items-center shrink-0 min-w-[2.5rem]">
            {match.startedAt && <span className="text-[8px] text-muted">{new Date(match.startedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span>}
            {(isPending || isPaused) && canScore && match.players.length >= 2 ? (
              <button onClick={(e) => {
                e.stopPropagation();
                setEvent((prev) => prev ? { ...prev, matches: prev.matches.map((m) => m.id === match.id ? { ...m, status: "active", startedAt: new Date().toISOString() } : m) } : prev);
                setMatchTab("current");
                fetch(`/api/matches/${match.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "active" }) }).then(() => fetchEvent());
              }} className="w-10 h-10 rounded-full bg-green-500 text-white flex items-center justify-center shadow-sm hover:bg-green-600 active:bg-green-700 transition-colors relative" title="Start match">
                <span className="text-lg font-bold">▶</span>
                <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-gray-600 text-white text-[9px] font-bold flex items-center justify-center">{match.courtNum}</span>
              </button>
            ) : (
              <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold ${courtColor}`}>{match.courtNum}</div>
            )}
            {match.completedAt ? <span className="text-[8px] text-muted">{new Date(match.completedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span>
              : statusText ? <span className="text-[8px] text-muted">{statusText}</span> : null}
          </div>

          {/* Teams + scores */}
          <div className="flex-1 min-w-0">
          {(() => {
            const renderTeamRow = (teamPlayers: MatchPlayer[], teamNum: 1 | 2, won: boolean, scoreVal: number | null) => {
              const liveServerId = hasLiveScore ? scorerLiveScore?.serverId : undefined;
              const liveReceiverId = hasLiveScore ? scorerLiveScore?.receiverId : undefined;
              const p1 = teamPlayers[0];
              const p2 = teamPlayers[1];
              const nameColor = won && !isEditing ? "text-green-700" : "";
              const renderPlayerRow = (mp: MatchPlayer) => {
                const isServerPlayer = liveServerId === mp.player.id;
                const isReceiverPlayer = liveReceiverId === mp.player.id;
                const isMe = mp.playerId === userId;
                return (
                  <div key={mp.id} className="flex items-center gap-1.5">
                    <PlayerAvatar name={mp.player.name} photoUrl={mp.player.photoUrl} size="xs" />
                    <span className={`text-base truncate ${isMe ? "font-bold" : "font-medium"} ${nameColor}`}>{mp.player.name}</span>
                    {isServerPlayer && <span className="text-[8px] bg-green-500 text-white px-1 py-0 rounded-full font-bold">SRV</span>}
                    {isReceiverPlayer && <span className="text-[8px] bg-yellow-500 text-white px-1 py-0 rounded-full font-medium">RCV</span>}
                  </div>
                );
              };
              // Target score and winBy from format
              const cls = match.classId ? event.classes?.find((c: { id: string }) => c.id === match.classId) : event.classes?.[0];
              const fmt = match.matchFormat || cls?.scoringFormat || event.scoringFormat || "1x11";
              const targetScore = parseInt(fmt.replace(/^[13]x/, "").replace("R", "")) || 11;
              const matchWinBy = parseInt(cls?.winBy || "2") || 2;
              const teamKey = teamNum === 1 ? "team1" : "team2";
              const otherTeamKey = teamNum === 1 ? "team2" : "team1";
              const canQuickScore = showInputs && !hasLiveScore;
              return (
                <div className={`flex items-center gap-1 p-1.5 rounded-lg ${won && !isEditing ? "bg-green-50" : ""}`}
>
                  <div className="flex-1 min-w-0 space-y-0.5">
                    {teamPlayers.map((mp) => renderPlayerRow(mp))}
                  </div>
                  <div className="shrink-0 ml-1">
                    {isCompleted && !isEditing ? (
                      <span className={`text-2xl font-bold min-w-[2.5rem] text-center block ${won ? "text-green-600" : "text-gray-400"}`}>{scoreVal}</span>
                    ) : hasLiveScore ? (
                      <span className="text-2xl font-bold min-w-[2.5rem] text-center block text-orange-500 tabular-nums">{teamNum === 1 ? scorerLiveScore!.team1 : scorerLiveScore!.team2}</span>
                    ) : showInputs ? (
                      <div onClick={(e) => e.stopPropagation()}>
                        <ScorePicker value={scores[match.id]?.[teamKey] ?? ""} targetScore={targetScore} winBy={matchWinBy}
                          allowAnyScore={(() => {
                            const c = cls as unknown as { maxMinutes?: number | null; scoringFormat?: string };
                            const mm = c?.maxMinutes ?? 0;
                            return c?.scoringFormat === "timed" || mm > 0;
                          })()}
                          otherTeamScore={scores[match.id]?.[otherTeamKey] ?? ""}
                          teamLabel={teamPlayers.map((mp) => mp.player.name.split(" ")[0]).join(" & ")}
                          autoOpen={autoOpenScoreTeam?.matchId === match.id && autoOpenScoreTeam?.team === teamKey}
                          onAutoOpened={() => setAutoOpenScoreTeam(null)}
                          onChange={(v) => {
                            setMatchScore(match.id, teamKey, v);
                            // Auto-open other team's picker if it doesn't have a score yet
                            if (!scores[match.id]?.[otherTeamKey]) {
                              setTimeout(() => setAutoOpenScoreTeam({ matchId: match.id, team: otherTeamKey }), 300);
                            }
                          }}
                          onClearBoth={() => setScores((prev) => { const next = { ...prev }; delete next[match.id]; return next; })} />
                      </div>
                    ) : (
                      <span className="text-2xl font-bold min-w-[2.5rem] text-center block text-gray-400">-</span>
                    )}
                  </div>
                  {/* Confirmation checkbox — approval mode only */}
                  {isCompleted && !isEditing && match.rankingMode === "approval" && !match.scoreConfirmed && (() => {
                    const teamConfirmed = teamNum === 1 ? match.team1Confirmed : match.team2Confirmed;
                    const isMyTeam = teamPlayers.some((mp) => mp.playerId === userId);
                    const canConfirmThis = isMyTeam || canManage || match.scorerId === userId;
                    return (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!canConfirmThis) return;
                          if (teamConfirmed) return;
                          fetch(`/api/matches/${match.id}/score`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ team: teamNum }),
                          }).then(() => fetchEvent());
                        }}
                        disabled={!!teamConfirmed || !canConfirmThis}
                        className={`shrink-0 w-6 h-6 rounded flex items-center justify-center text-sm transition-all ${
                          teamConfirmed ? "bg-green-100 text-green-600" : canConfirmThis ? "bg-red-50 text-red-400 border border-red-200 hover:bg-red-100 cursor-pointer" : "bg-gray-50 text-gray-300 border border-gray-200"
                        }`}
                        title={teamConfirmed ? "Confirmed" : canConfirmThis ? "Tap to confirm" : "Waiting for confirmation"}
                      >
                        {teamConfirmed ? "☑" : "☐"}
                      </button>
                    );
                  })()}
                </div>
              );
            };
            return (
              <>
                {renderTeamRow(team1, 1, team1Won, displayScore1)}
                <div className="h-px bg-border mx-2" />
                {renderTeamRow(team2, 2, team2Won, displayScore2)}
              </>
            );
          })()}
          </div>

          {/* Status indicator — only for non-approval or fully confirmed */}
          {isCompleted && !isEditing && (match.rankingMode !== "approval" || match.scoreConfirmed) && (
            <span className="text-sm font-medium shrink-0 text-green-600">✓</span>
          )}
        </div>
        {/* Submit / Edit bar */}
        {showInputs && !isEditing && scores[match.id]?.team1 && scores[match.id]?.team2 && (
          <div className="px-2 pb-2">
            <button onClick={() => submitScore(match.id)}
              className="w-full bg-action-dark text-white py-3 rounded-lg font-bold text-lg transition-colors">Submit Score</button>
          </div>
        )}
        {isEditing && (
          <div className="flex gap-2 px-2 pb-2">
            <button onClick={() => editScore(match.id)} disabled={!scores[match.id]?.team1 || !scores[match.id]?.team2}
              className="flex-1 bg-action-dark text-white py-2.5 rounded-lg font-bold text-base disabled:opacity-50">Save</button>
            <button onClick={cancelEditMatch}
              className="flex-1 bg-gray-100 text-foreground py-2.5 rounded-lg font-medium text-base">Cancel</button>
          </div>
        )}
        {match.scorer && (
          <div className="px-2 pb-1.5 text-[9px] text-muted text-right">Scorer: {match.scorer.name}</div>
        )}
        {isPickle && (
          <div className="bg-amber-50 border-t border-amber-200 px-3 py-1.5 flex items-center gap-2">
            <span className="text-sm">🍺</span>
            <span className="text-[10px] text-amber-700 font-medium">
              Pickle! {pickleWinnerTeam === 1
                ? (team1.map((p) => p.player.name.split(" ")[0]).join(" & "))
                : (team2.map((p) => p.player.name.split(" ")[0]).join(" & "))
              } owe{team1.length > 1 || team2.length > 1 ? "" : "s"} a beer to the losers!
            </span>
            <span className="text-sm">🍺</span>
          </div>
        )}
      </div>
    );
  };

  // Schedule view for league events: matches both teams ticked, grouped
  // by court in a horizontal-scroll layout. Host captain / league admin
  // can edit time + court per row. Auto-fill propagates a row's time +
  // `scheduleDurationMin` down the same court until it hits another fixed
  // time (so manually pinned matches act as anchors).
  const renderLeagueSchedule = () => {
    if (!event.round || (event.leagueTeams?.length ?? 0) !== 2) return null;
    const allGames = event.leagueGames || [];
    const baseGames = allGames.filter((g) => g.team1Wants && g.team2Wants);
    if (baseGames.length === 0) return null;

    const numCourts = event.numCourts || 2;
    // Court start times: ISO string per court number. Recalc on the
    // server keys off these to compute scheduledAt for every match.
    // Merge optimistic local overrides on top of the server copy so
    // the operator's picker change shows instantly while the PATCH +
    // recalc finishes in the background. A null override means the
    // user just cleared that court's start time.
    const serverCourtStartTimes: Record<string, string> = (event.courtStartTimes || {}) as Record<string, string>;
    const courtStartTimes: Record<string, string> = (() => {
      const merged: Record<string, string> = { ...serverCourtStartTimes };
      for (const [k, v] of Object.entries(optimisticCourtStartTimes)) {
        if (v === null) delete merged[k];
        else merged[k] = v;
      }
      return merged;
    })();
    // Schedule the PATCH 1 s after the LAST courtStartTimes edit. Each
    // call replaces the pending payload so the operator can twiddle
    // pickers rapidly without burning N recalcs. The operator gets
    // immediate optimistic UI; the server-side reflow trails behind.
    const scheduleRecalc = (nextTimes: Record<string, string>) => {
      pendingCourtStartTimesRef.current = nextTimes;
      // The user is the active driver; reset the timer.
      if (recalcTimerRef.current) clearTimeout(recalcTimerRef.current);
      // Mark a recalc as "queued" so the spinner shows during the
      // debounce window too — otherwise the operator sees a 1 s gap
      // where nothing acknowledges their edit.
      setRecalcInFlight(1);
      recalcTimerRef.current = setTimeout(async () => {
        const payload = pendingCourtStartTimesRef.current;
        pendingCourtStartTimesRef.current = null;
        recalcTimerRef.current = null;
        if (!payload) return;
        const controller = new AbortController();
        recalcAbortRef.current = controller;
        try {
          await fetch(`/api/events/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ courtStartTimes: payload }),
            signal: controller.signal,
          });
          if (controller.signal.aborted) return;
          await swrEvent.mutate();
        } catch (err) {
          if ((err as { name?: string })?.name === "AbortError") return;
          // Network/server failure — surface but don't loop.
          // eslint-disable-next-line no-console
          console.error("courtStartTimes recalc failed", err);
        } finally {
          if (recalcAbortRef.current === controller) recalcAbortRef.current = null;
          // Drop the optimistic overlay only after SWR mutate returns
          // — otherwise the picker briefly flashes the previous value.
          setOptimisticCourtStartTimes({});
          setRecalcInFlight(0);
        }
      }, 1000);
    };
    const writeCourtStart = (n: number, iso: string | null) => {
      const next: Record<string, string> = { ...courtStartTimes };
      if (iso) next[String(n)] = iso;
      else delete next[String(n)];
      // Optimistic: paint the new time immediately so the operator
      // doesn't see "ages" of stale state while the server recalcs.
      setOptimisticCourtStartTimes((prev) => ({ ...prev, [String(n)]: iso }));
      scheduleRecalc(next);
    };
    const copyCourt1StartToAll = () => {
      const c1 = courtStartTimes["1"];
      if (!c1) return;
      const next: Record<string, string> = { ...courtStartTimes };
      for (let i = 2; i <= numCourts; i++) next[String(i)] = c1;
      setOptimisticCourtStartTimes((prev) => {
        const out = { ...prev };
        for (let i = 2; i <= numCourts; i++) out[String(i)] = c1;
        return out;
      });
      scheduleRecalc(next);
    };
    const cats = event.round.league.categories || [];
    const catById = new Map(cats.map((c) => [c.id, c]));
    const catName = (cid: string) => cats.find((c) => c.id === cid)?.name ?? "Category";
    const catSort = new Map<string, number>(cats.map((c, i) => [c.id, (c as { sortOrder?: number }).sortOrder ?? i]));

    const playerNameById = new Map<string, string>();
    for (const ep of event.players) playerNameById.set(ep.player.id, ep.player.name);
    for (const t of (event.round.league.teams || [])) {
      for (const tp of t.players) {
        const name = (tp as { player?: { name?: string } }).player?.name;
        if (name) playerNameById.set(tp.playerId, name);
      }
    }
    const teamShort = (tid: string) => {
      const t = (event.leagueTeams || []).find((lt) => lt.teamId === tid);
      return t?.team.name ?? "?";
    };

    // Apply the shared Matches-tab filters to the schedule too: kind,
    // category gender, category format, and player-name search.
    // Auto-arrange preview overlay: if active, swap each affected
    // game's courtNum/displayOrder so the grid renders the proposal.
    // We zero out scheduledAt for preview-touched rows so the
    // approximate-time recompute below (against the new court order)
    // takes effect — the server-side recalc on Approve will set the
    // real times.
    const games = baseGames.filter((g) => {
      if (matchKindFilter.size > 0) {
        const isPrincipal = g.kind === "principal";
        const isFriendly = g.kind === "league" || g.kind === "extra";
        const ok = (matchKindFilter.has("principal") && isPrincipal)
          || (matchKindFilter.has("friendly") && isFriendly);
        // Schedule has no "non-league" rows by construction.
        if (!ok) return false;
      }
      const cat = catById.get(g.categoryId) as unknown as { gender?: string; format?: string } | undefined;
      if (matchGenderFilter && cat?.gender && cat.gender !== "mix" && cat.gender !== matchGenderFilter) return false;
      if (matchFormatFilter && cat?.format && cat.format !== matchFormatFilter) return false;
      if (matchPlayerSearch.trim()) {
        const q = matchPlayerSearch.trim().toLowerCase();
        const hit = g.gamePlayers.some((gp) => {
          const name = playerNameById.get(gp.playerId);
          return name && name.toLowerCase().includes(q);
        });
        if (!hit) return false;
      }
      return true;
    }).map((g) => {
      if (!arrangePreview) return g;
      const ov = arrangePreview[g.id];
      if (!ov) return g;
      // Drop scheduledAt so the approximate-time recompute below
      // doesn't anchor against the OLD time when re-ordering for
      // preview. Anchored matches were excluded from compute so they
      // won't appear in the override map.
      return { ...g, courtNum: ov.courtNum, displayOrder: ov.displayOrder, scheduledAt: null };
    });

    type G = NonNullable<typeof event.leagueGames>[number];
    // Sort priority: manual displayOrder (NULLS LAST) > scheduledAt asc
    // > category sort > slotNumber. The displayOrder slot lets the user
    // drag a card up/down without changing its time.
    const sortGames = (arr: G[]) => arr.slice().sort((a, b) => {
      const oa = a.displayOrder ?? Number.POSITIVE_INFINITY;
      const ob = b.displayOrder ?? Number.POSITIVE_INFINITY;
      if (oa !== ob) return oa - ob;
      const ta = a.scheduledAt ? new Date(a.scheduledAt).getTime() : Number.POSITIVE_INFINITY;
      const tb = b.scheduledAt ? new Date(b.scheduledAt).getTime() : Number.POSITIVE_INFINITY;
      if (ta !== tb) return ta - tb;
      const ca = catSort.get(a.categoryId) ?? 0;
      const cb = catSort.get(b.categoryId) ?? 0;
      if (ca !== cb) return ca - cb;
      return (a.slotNumber ?? 0) - (b.slotNumber ?? 0);
    });

    // ── Auto-arrange heuristic (deterministic schedule planner) ─────
    // Greedy: order non-anchored real matches by (kind per policy →
    // category → slot). For each, pick the court where it can start
    // soonest without creating a player overlap/rushed conflict, with
    // a same-category bonus so a court tends to host the same
    // discipline back-to-back. Anchored matches are fixed points that
    // the greedy walks around.
    const computeArrangement = (
      policy: "principal-first" | "league-first",
    ): { gameId: string; courtNum: number; displayOrder: number }[] => {
      const BUFFER_MS = 10 * 60_000;
      const durMs = scheduleDurationMin * 60_000;
      const kindIdx = (k: string | undefined) => {
        if (k === "extra") return 99; // Friendly always last
        if (policy === "principal-first") return k === "principal" ? 0 : 1;
        return k === "league" ? 0 : 1;
      };
      const real = baseGames.filter((g) => !g.winnerId && !g.scheduleAnchored);
      const sorted = real.slice().sort((a, b) => {
        const ka = kindIdx(a.kind);
        const kb = kindIdx(b.kind);
        if (ka !== kb) return ka - kb;
        const ca = catSort.get(a.categoryId) ?? 999;
        const cb = catSort.get(b.categoryId) ?? 999;
        if (ca !== cb) return ca - cb;
        return (a.slotNumber ?? 0) - (b.slotNumber ?? 0);
      });
      // Per-court timeline pre-seeded with anchored matches as fixed
      // entries. Each entry holds startMs + categoryId so the same-
      // category bonus and projected-next-start work uniformly.
      type Slot = { gameId: string; startMs: number; categoryId: string };
      const timelines: Record<number, Slot[]> = {};
      for (let c = 1; c <= numCourts; c++) timelines[c] = [];
      const playerLastEnd = new Map<string, number>();
      for (const g of baseGames) {
        if (g.scheduleAnchored && g.scheduledAt && g.courtNum != null) {
          const s = new Date(g.scheduledAt).getTime();
          timelines[g.courtNum]?.push({ gameId: g.id, startMs: s, categoryId: g.categoryId });
          for (const gp of g.gamePlayers) {
            const prev = playerLastEnd.get(gp.playerId) ?? -Infinity;
            if (s + durMs > prev) playerLastEnd.set(gp.playerId, s + durMs);
          }
        }
      }
      const courtStartMs = (c: number): number => {
        const iso = courtStartTimes[String(c)];
        if (iso) return new Date(iso).getTime();
        return event.date ? new Date(event.date).getTime() : Date.now();
      };
      // Lexicographic priority per match:
      //   1) fewest player conflicts on this court,
      //   2) earliest match END time on this court (LPT-style:
      //      minimises the overall event makespan by pushing each
      //      match to the court that finishes soonest), then
      //   3) most matches already on this court for the same category
      //      (gentle clustering, only used as a tiebreaker so it can
      //      never trap matches on one court).
      for (const g of sorted) {
        let bestCourt = 1;
        let bestStart = 0;
        let bestEnd = Number.POSITIVE_INFINITY;
        let bestConflict = Number.POSITIVE_INFINITY;
        let bestSameCat = -1;
        for (let c = 1; c <= numCourts; c++) {
          const tl = timelines[c]!.slice().sort((a, b) => a.startMs - b.startMs);
          const lastEnd = tl.length > 0 ? tl[tl.length - 1]!.startMs + durMs : courtStartMs(c);
          const startMs = Math.max(lastEnd, courtStartMs(c));
          const endMs = startMs + durMs;
          let conflict = 0;
          for (const gp of g.gamePlayers) {
            const pe = playerLastEnd.get(gp.playerId) ?? -Infinity;
            const gap = startMs - pe;
            if (gap < 0) conflict += 1000;
            else if (gap < BUFFER_MS) conflict += 100;
          }
          const sameCat = tl.filter((t) => t.categoryId === g.categoryId).length;
          const better =
            conflict < bestConflict
            || (conflict === bestConflict && endMs < bestEnd)
            || (conflict === bestConflict && endMs === bestEnd && sameCat > bestSameCat);
          if (better) {
            bestCourt = c;
            bestStart = startMs;
            bestEnd = endMs;
            bestConflict = conflict;
            bestSameCat = sameCat;
          }
        }
        timelines[bestCourt]!.push({ gameId: g.id, startMs: bestStart, categoryId: g.categoryId });
        for (const gp of g.gamePlayers) {
          const prev = playerLastEnd.get(gp.playerId) ?? -Infinity;
          if (bestStart + durMs > prev) playerLastEnd.set(gp.playerId, bestStart + durMs);
        }
      }
      const assignments: { gameId: string; courtNum: number; displayOrder: number }[] = [];
      for (let c = 1; c <= numCourts; c++) {
        const tl = timelines[c]!.slice().sort((a, b) => a.startMs - b.startMs);
        let order = 1;
        for (const entry of tl) {
          const orig = baseGames.find((x) => x.id === entry.gameId);
          if (orig?.scheduleAnchored) continue;
          assignments.push({ gameId: entry.gameId, courtNum: c, displayOrder: order++ });
        }
      }
      return assignments;
    };
    const runArrange = () => {
      const assignments = computeArrangement(arrangePolicy);
      const map: Record<string, { courtNum: number; displayOrder: number }> = {};
      for (const a of assignments) map[a.gameId] = { courtNum: a.courtNum, displayOrder: a.displayOrder };
      setArrangePreview(map);
    };
    const cancelArrange = () => setArrangePreview(null);
    const approveArrange = async () => {
      if (!arrangePreview || !event.round) return;
      const assignments = Object.entries(arrangePreview).map(([gameId, ov]) => ({
        gameId, courtNum: ov.courtNum, displayOrder: ov.displayOrder,
      }));
      setArrangeApplying(true);
      setRecalcInFlight((c) => c + 1);
      try {
        await fetch(`/api/leagues/${event.round.league.id}/events/${id}/games/bulk-arrange`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assignments }),
        });
        await swrEvent.mutate();
        setArrangePreview(null);
      } finally {
        setArrangeApplying(false);
        setRecalcInFlight((c) => c - 1);
      }
    };

    // Preview-mode time projection: stamp approximate scheduledAt for
    // every preview-affected match so both buckets and conflict
    // detection reflect the proposal. Walk each court in displayOrder,
    // advancing by the default scheduleDurationMin. Per-cat overrides
    // get applied precisely on the server when the operator Approves.
    if (arrangePreview) {
      const previewDurMs = scheduleDurationMin * 60_000;
      // Index games by id so we can mutate via replacement.
      const byId = new Map(games.map((g) => [g.id, g] as const));
      for (let n = 1; n <= numCourts; n++) {
        const startIso = courtStartTimes[String(n)];
        if (!startIso) continue;
        const col = games
          .filter((g) => g.courtNum === n)
          .slice()
          .sort((a, b) => {
            const oa = a.displayOrder ?? Number.POSITIVE_INFINITY;
            const ob = b.displayOrder ?? Number.POSITIVE_INFINITY;
            return oa - ob;
          });
        let cursor = new Date(startIso).getTime();
        for (const g of col) {
          if (g.scheduleAnchored && g.scheduledAt) {
            cursor = new Date(g.scheduledAt).getTime();
          } else if (g.scheduledAt == null) {
            byId.set(g.id, { ...g, scheduledAt: new Date(cursor).toISOString() } as G);
          } else {
            cursor = new Date(g.scheduledAt).getTime();
          }
          cursor += previewDurMs;
        }
      }
      // Reflect projection back into the array (replace by id).
      for (let i = 0; i < games.length; i++) {
        const next = byId.get(games[i]!.id);
        if (next && next !== games[i]) games[i] = next;
      }
    }

    const buckets: Record<string, G[]> = { unassigned: [] };
    for (let n = 1; n <= numCourts; n++) buckets[String(n)] = [];
    for (const g of games) {
      const key = (g.courtNum == null) ? "unassigned" : String(g.courtNum);
      if (!buckets[key]) buckets[key] = [];
      buckets[key].push(g);
    }
    for (const k of Object.keys(buckets)) buckets[k] = sortGames(buckets[k]);

    // ── Scheduling conflict detection ───────────────────────────────
    // Models a realistic timeline that accounts for two things real
    // play-days always have:
    //   1. Matches run long. We pad each match's scheduled duration
    //      by DELAY_PCT (default 70%) — generous on purpose, matches
    //      go to long deuces, players talk, etc.
    //   2. Delays stack. If the 14:00 match on Court 1 runs to 15:00,
    //      the 14:30 match on the same court can't start until 15:00.
    //      We propagate forward: each match's realistic start is
    //      max(scheduled, previous-on-this-court realistic end).
    //
    // Per-match base duration is derived from the gap to the next
    // match on the SAME court (implicitly includes warmup time, since
    // the captain picked the next start accordingly). The last match
    // on each court falls back to the operator-set scheduleDurationMin
    // default.
    //
    // Conflicts are then evaluated per-player against the realistic
    // windows:
    //   • overlap — projected windows on different courts overlap.
    //   • rushed  — different courts, positive gap < BUFFER_MIN.
    // Same-court same-player consecutive matches can't overlap by
    // construction (b.realStart ≥ a.realEnd), so they're skipped.
    const BUFFER_MIN = 10;
    const DELAY_PCT = 0.7;
    const fallbackDurationMs = scheduleDurationMin * 60_000;
    const bufferMs = BUFFER_MIN * 60_000;
    const windowByGame = new Map<string, { realStart: number; realEnd: number; scheduledStart: number }>();
    for (let courtNum = 1; courtNum <= numCourts; courtNum++) {
      const col = (buckets[String(courtNum)] || [])
        .filter((g) => g.scheduledAt)
        .slice()
        .sort((a, b) => new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime());
      let prevRealEnd: number | null = null;
      for (let i = 0; i < col.length; i++) {
        const cur = col[i]!;
        const next = col[i + 1];
        const scheduledStart = new Date(cur.scheduledAt!).getTime();
        const baseDurMs = next
          ? Math.max(0, new Date(next.scheduledAt!).getTime() - scheduledStart) || fallbackDurationMs
          : fallbackDurationMs;
        const realDurMs: number = baseDurMs * (1 + DELAY_PCT);
        const realStart: number = prevRealEnd != null ? Math.max(scheduledStart, prevRealEnd) : scheduledStart;
        const realEnd: number = realStart + realDurMs;
        windowByGame.set(cur.id, { realStart, realEnd, scheduledStart });
        prevRealEnd = realEnd;
      }
    }
    type ConflictKind = "overlap" | "rushed";
    interface PerGameConflict {
      playerId: string;
      playerName: string;
      otherGameId: string;
      kind: ConflictKind;
      gapMin: number; // negative ⇒ overlapping
    }
    interface SummaryConflict {
      playerId: string;
      playerName: string;
      kind: ConflictKind;
      gapMin: number;
      a: G;
      b: G;
    }
    const conflictsByGame = new Map<string, PerGameConflict[]>();
    const conflictSummary: SummaryConflict[] = [];
    const playerGames = new Map<string, G[]>();
    for (const g of games) {
      if (!g.scheduledAt || g.courtNum == null) continue;
      for (const gp of g.gamePlayers) {
        const list = playerGames.get(gp.playerId) || [];
        list.push(g);
        playerGames.set(gp.playerId, list);
      }
    }
    for (const [playerId, plist] of playerGames.entries()) {
      if (plist.length < 2) continue;
      const sorted = plist.slice().sort((x, y) =>
        new Date(x.scheduledAt!).getTime() - new Date(y.scheduledAt!).getTime(),
      );
      for (let i = 0; i < sorted.length - 1; i++) {
        const a = sorted[i]!;
        const b = sorted[i + 1]!;
        // Same-court consecutive matches for the same player can't
        // overlap once we propagate delays — b.realStart is already
        // ≥ a.realEnd by construction. Skip to avoid noise.
        if (a.courtNum === b.courtNum) continue;
        const aWin = windowByGame.get(a.id);
        const bWin = windowByGame.get(b.id);
        if (!aWin || !bWin) continue;
        const gapMs = bWin.realStart - aWin.realEnd;
        let kind: ConflictKind | null = null;
        if (gapMs < 0) kind = "overlap";
        else if (gapMs < bufferMs) kind = "rushed";
        if (!kind) continue;
        const playerName = playerNameById.get(playerId) || "Player";
        const gapMin = Math.round(gapMs / 60_000);
        for (const pair of [{ self: a, other: b }, { self: b, other: a }]) {
          const arr = conflictsByGame.get(pair.self.id) || [];
          arr.push({ playerId, playerName, otherGameId: pair.other.id, kind, gapMin });
          conflictsByGame.set(pair.self.id, arr);
        }
        conflictSummary.push({ playerId, playerName, kind, gapMin, a, b });
      }
    }
    const hasConflicts = conflictSummary.length > 0;
    const overlapCount = conflictSummary.filter((c) => c.kind === "overlap").length;
    const rushedCount = conflictSummary.length - overlapCount;

    // Color-code each (a, b) conflict pair so the operator can match
    // a summary line to its two cards at a glance. Key is order-
    // independent so the same pair gets the same color regardless of
    // which match is "a" vs "b".
    const pairKeyOf = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    const PAIR_PALETTE: { dot: string; ring: string }[] = [
      { dot: "bg-rose-500", ring: "ring-rose-300" },
      { dot: "bg-amber-500", ring: "ring-amber-300" },
      { dot: "bg-emerald-500", ring: "ring-emerald-300" },
      { dot: "bg-sky-500", ring: "ring-sky-300" },
      { dot: "bg-violet-500", ring: "ring-violet-300" },
      { dot: "bg-fuchsia-500", ring: "ring-fuchsia-300" },
      { dot: "bg-cyan-500", ring: "ring-cyan-300" },
      { dot: "bg-lime-500", ring: "ring-lime-300" },
    ];
    const pairColorByKey = new Map<string, typeof PAIR_PALETTE[number]>();
    {
      let i = 0;
      for (const c of conflictSummary) {
        const key = pairKeyOf(c.a.id, c.b.id);
        if (!pairColorByKey.has(key)) {
          pairColorByKey.set(key, PAIR_PALETTE[i % PAIR_PALETTE.length]!);
          i++;
        }
      }
    }
    // Per match: every pair key it's part of (a card can be in
    // multiple pairs if 2+ players sharing different opponents both
    // collide with it). Used by the card renderer to stack chips.
    const pairKeysByGame = new Map<string, string[]>();
    for (const c of conflictSummary) {
      const key = pairKeyOf(c.a.id, c.b.id);
      for (const id of [c.a.id, c.b.id]) {
        const arr = pairKeysByGame.get(id) || [];
        if (!arr.includes(key)) arr.push(key);
        pairKeysByGame.set(id, arr);
      }
    }

    // Permission: host captain/vice OR league organizer OR admin can edit.
    const allLeagueTeams = event.round.league.teams || [];
    const host = allLeagueTeams.find((t) => t.id === event.hostTeamId);
    const isHostCaptain = !!userId && !!host && (host.captainId === userId || host.viceCaptainId === userId);
    const canEditSchedule = isAdmin || isLeagueOrganizerOfEvent || isHostCaptain;

    // Lineup visibility — pre-reveal show "Team A vs Team B"; post-reveal show players.
    const revealed = !!event.lineupTotalLocked
      || ((event.leagueTeams || []).length === 2 && (event.leagueTeams || []).every((lt) => lt.lineupReady));

    // Optimistic local patcher — fire-and-forget API call, refetch in
    // the background. Keeps the UI snappy even on slow networks.
    type SchedulePatch = { scheduledAt?: string | null; courtNum?: number | null; displayOrder?: number | null };
    const applyOptimistic = (gameId: string, patch: SchedulePatch) => {
      setEvent((prev) => prev ? ({
        ...prev,
        leagueGames: (prev.leagueGames || []).map((x) => x.id === gameId ? { ...x, ...patch } : x),
      }) : prev);
    };
    const patchSchedule = (gameId: string, patch: SchedulePatch) => {
      applyOptimistic(gameId, patch);
      // Fire-and-forget. Server validates + rejects on permission error.
      void fetch(`/api/leagues/${event.round!.league.id}/events/${event.id}/games/${gameId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }).then((r) => {
        if (!r.ok) {
          r.json().catch(() => ({})).then((d) => alertDialog(d?.error || "Failed to update schedule"));
        }
      }).finally(() => { fetchEvent(); });
    };

    const onTimeChange = (g: G, hhmm: string) => {
      if (!hhmm) { patchSchedule(g.id, { scheduledAt: null }); return; }
      const base = event.date ? new Date(event.date) : new Date();
      if (isNaN(base.getTime())) return;
      const [hh, rawMm] = hhmm.split(":").map((s) => parseInt(s, 10));
      if (Number.isNaN(hh) || Number.isNaN(rawMm)) return;
      // Native time pickers ignore the `step` attribute — snap to nearest
      // 5-minute boundary here; carry over when snap pushes to 60.
      let snappedMm = Math.round(rawMm / 5) * 5;
      let snappedHh = hh;
      if (snappedMm === 60) { snappedMm = 0; snappedHh = (snappedHh + 1) % 24; }
      base.setHours(snappedHh, snappedMm, 0, 0);
      patchSchedule(g.id, { scheduledAt: base.toISOString() });
    };

    const onCourtChange = (g: G, raw: string) => {
      const n = raw === "" ? null : parseInt(raw, 10);
      patchSchedule(g.id, { courtNum: n });
    };

    const clearTime = (g: G) => {
      patchSchedule(g.id, { scheduledAt: null });
    };

    // Auto-fill propagates from this row + duration onto subsequent rows
    // on the SAME court that don't already have a time. Stops on a fixed
    // time so manually pinned games act as anchors.
    const autoFillDown = (g: G) => {
      if (!g.scheduledAt || g.courtNum == null) return;
      const list = buckets[String(g.courtNum)] || [];
      const idx = list.findIndex((x) => x.id === g.id);
      if (idx < 0) return;
      let t = new Date(g.scheduledAt).getTime();
      for (let i = idx + 1; i < list.length; i++) {
        if (list[i].scheduledAt) break;
        t += scheduleDurationMin * 60_000;
        const iso = new Date(t).toISOString();
        patchSchedule(list[i].id, { scheduledAt: iso });
      }
    };

    const timeHHMM = (iso: string | null | undefined) => {
      if (!iso) return "";
      const d = new Date(iso);
      if (isNaN(d.getTime())) return "";
      return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    };

    // Cross-reference Match scores for completed games. Match has
    // `leagueGame` relation; we build a Map keyed by leagueGame.id.
    const matchByLeagueGameId = new Map<string, Match>();
    for (const m of event.matches) {
      if (m.leagueGame?.id) matchByLeagueGameId.set(m.leagueGame.id, m);
    }
    const teamScoresFor = (g: G): { t1: number | null; t2: number | null } => {
      const m = matchByLeagueGameId.get(g.id);
      if (!m) return { t1: null, t2: null };
      const p1 = m.players.find((p) => p.team === 1);
      const p2 = m.players.find((p) => p.team === 2);
      return {
        t1: p1?.score ?? null,
        t2: p2?.score ?? null,
      };
    };
    // Group revealed players by side: any gamePlayer whose id is in
    // team1's roster is team1; rest is team2. (Pre-reveal players are
    // hidden by the server-side filter — we get empty arrays then.)
    const team1RosterIds = new Set(
      (event.round.league.teams || []).find((t) => t.id === (event.leagueTeams || [])[0]?.teamId)?.players.map((p) => p.playerId) || [],
    );
    const playersBySide = (g: G) => {
      const t1Id = g.team1Id;
      const team1RostId = (event.round!.league.teams || []).find((t) => t.id === t1Id)?.players.map((p) => p.playerId);
      const t1Roster = new Set(team1RostId || []);
      const a: string[] = [], b: string[] = [];
      for (const gp of g.gamePlayers) {
        const name = playerNameById.get(gp.playerId) || "?";
        // Prefer the explicit team tag (1/2) set server-side; fall back
        // to roster heuristics for legacy rows where team is null.
        const t = gp.team;
        if (t === 1) a.push(name);
        else if (t === 2) b.push(name);
        else if (t1Roster.has(gp.playerId)) a.push(name);
        else b.push(name);
      }
      return { team1: a, team2: b };
    };
    // Silence unused — keeping for potential future use.
    void team1RosterIds;

    // ── Movement helpers (replaces drag-and-drop) ──
    // Each card has a toggle button on the left edge. Toggling it open
    // reveals a 4-direction D-pad anchored to the card; the user clicks
    // arrows to nudge the card up/down within a court column or left/
    // right across columns. The card retains visual focus across moves
    // because the popover travels with it.
    const movePosition = (g: G, delta: 1 | -1) => {
      const cur = g.courtNum ?? null;
      const col = sortGames(games.filter((x) => (x.courtNum ?? null) === cur));
      const idx = col.findIndex((x) => x.id === g.id);
      if (idx < 0) return;
      const targetIdx = idx + delta;
      if (targetIdx < 0 || targetIdx >= col.length) return;
      const swapped = [...col];
      [swapped[idx], swapped[targetIdx]] = [swapped[targetIdx], swapped[idx]];
      for (let i = 0; i < swapped.length; i++) {
        patchSchedule(swapped[i].id, { displayOrder: i });
      }
    };
    const moveCourt = (g: G, delta: 1 | -1) => {
      const cur = g.courtNum ?? null;
      // Column ordering: unassigned (null) → 1 → 2 → … → N
      let newCourt: number | null;
      if (delta === -1) {
        if (cur === null) return;        // already in unassigned (leftmost)
        newCourt = cur === 1 ? null : cur - 1;
      } else {
        if (cur === numCourts) return;   // already in last court
        newCourt = cur === null ? 1 : cur + 1;
      }
      const newCol = sortGames(games.filter((x) => (x.courtNum ?? null) === newCourt));
      patchSchedule(g.id, { courtNum: newCourt, displayOrder: newCol.length });
    };
    const colOf = (g: G) => sortGames(games.filter((x) => (x.courtNum ?? null) === (g.courtNum ?? null)));

    const renderGameRow = (g: G) => {
      const hhmm = timeHHMM(g.scheduledAt);
      const { t1: t1Score, t2: t2Score } = teamScoresFor(g);
      const sides = revealed ? playersBySide(g) : { team1: [], team2: [] };
      const isMoving = movingScheduleId === g.id;
      const col = colOf(g);
      const colIdx = col.findIndex((x) => x.id === g.id);
      const canUp = colIdx > 0;
      const canDown = colIdx >= 0 && colIdx < col.length - 1;
      const canLeft = (g.courtNum ?? null) !== null;
      const canRight = (g.courtNum ?? null) !== numCourts;
      // When the card is in "move mode" we replace its body with a
      // big 3×3 D-pad filling the card area. Keeps the card's size +
      // position stable so the user's eye/finger stays anchored.
      if (isMoving) {
        const arrowBtn = (label: string, enabled: boolean, onClick: () => void, title: string) => (
          <button
            type="button"
            disabled={!enabled}
            onClick={onClick}
            title={title}
            className="w-full aspect-square rounded-lg bg-gray-100 hover:bg-gray-200 active:bg-gray-300 disabled:opacity-25 disabled:cursor-not-allowed text-3xl font-bold flex items-center justify-center"
          >{label}</button>
        );
        return (
          <div key={g.id} className="relative border-2 border-action rounded-lg p-1.5 bg-white shadow-sm ring-2 ring-action/20">
            <div className="text-[10px] text-center text-muted truncate px-1 mb-1">
              {catName(g.categoryId)} · Match {g.slotNumber ?? "?"} · {teamShort(g.team1Id)} vs {teamShort(g.team2Id)}
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <div />
              {arrowBtn("↑", canUp, () => movePosition(g, -1), "Move up")}
              <div />
              {arrowBtn("←", canLeft, () => moveCourt(g, -1), "Move left (previous court)")}
              <button
                type="button"
                onClick={() => setMovingScheduleId(null)}
                className="w-full aspect-square rounded-lg bg-action text-white hover:brightness-110 text-xs font-bold flex items-center justify-center"
                title="Done"
              >Done</button>
              {arrowBtn("→", canRight, () => moveCourt(g, 1), "Move right (next court)")}
              <div />
              {arrowBtn("↓", canDown, () => movePosition(g, 1), "Move down")}
              <div />
            </div>
          </div>
        );
      }
      const rowConflicts = conflictsByGame.get(g.id) || [];
      const rowHasOverlap = rowConflicts.some((c) => c.kind === "overlap");
      const rowHasRushed = !rowHasOverlap && rowConflicts.some((c) => c.kind === "rushed");
      const conflictBorder = rowHasOverlap
        ? "border-red-400 ring-1 ring-red-200"
        : rowHasRushed
          ? "border-amber-400 ring-1 ring-amber-200"
          : "border-border";
      const rowPairKeys = pairKeysByGame.get(g.id) || [];
      // Bucket each pair by the relative direction of the OTHER match,
      // so the colored dot points the operator toward the conflicting
      // card: top/bottom for same-court order; left/right for an
      // adjacent court.
      const dotsByEdge: Record<"top" | "bottom" | "left" | "right", string[]> = {
        top: [], bottom: [], left: [], right: [],
      };
      for (const k of rowPairKeys) {
        const [a, b] = k.split("|");
        const otherId = a === g.id ? b : a;
        if (!otherId) continue;
        const other = games.find((x) => x.id === otherId);
        if (!other) continue;
        let edge: "top" | "bottom" | "left" | "right";
        if (other.courtNum != null && g.courtNum != null && other.courtNum !== g.courtNum) {
          edge = other.courtNum < g.courtNum ? "left" : "right";
        } else {
          const myOrd = g.displayOrder ?? Number.POSITIVE_INFINITY;
          const otOrd = other.displayOrder ?? Number.POSITIVE_INFINITY;
          edge = otOrd < myOrd ? "top" : "bottom";
        }
        dotsByEdge[edge].push(k);
      }
      const edgeClass: Record<"top" | "bottom" | "left" | "right", string> = {
        top: "absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2",
        bottom: "absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2",
        left: "absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2",
        right: "absolute right-0 top-1/2 translate-x-1/2 -translate-y-1/2",
      };
      const flexDir: Record<"top" | "bottom" | "left" | "right", string> = {
        top: "flex-row gap-0.5",
        bottom: "flex-row gap-0.5",
        left: "flex-col gap-0.5",
        right: "flex-col gap-0.5",
      };
      return (
        <div key={g.id} className={`relative ${conflictBorder} border rounded-lg p-2 pl-7 space-y-1.5 bg-white`}>
        {(Object.keys(dotsByEdge) as Array<keyof typeof dotsByEdge>).map((edge) => {
          const keys = dotsByEdge[edge];
          if (keys.length === 0) return null;
          return (
            <div key={edge} className={`${edgeClass[edge]} flex ${flexDir[edge]} z-10`}>
              {keys.map((k) => {
                const color = pairColorByKey.get(k);
                return (
                  <span
                    key={k}
                    title="Conflict pair — same colored dot on the other match"
                    className={`block w-2.5 h-2.5 rounded-full ring-2 ${color?.dot ?? "bg-amber-400"} ${color?.ring ?? "ring-amber-200"}`}
                    aria-hidden
                  />
                );
              })}
            </div>
          );
        })}
        {canEditSchedule && (
          <button
            type="button"
            onClick={() => {
              // Operator is about to manually reposition a match —
              // any pending/in-flight courtStartTimes recalc would
              // overwrite that, so drop it.
              cancelPendingRecalc();
              setMovingScheduleId(g.id);
            }}
            title="Move this match"
            className="absolute left-0 top-0 bottom-0 w-6 z-10 flex items-center justify-center select-none rounded-l-lg text-muted hover:text-foreground hover:bg-gray-50"
          >
            {/* Move icon — 4-arrow cross. */}
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <line x1="8" y1="2.5" x2="8" y2="13.5" />
              <line x1="2.5" y1="8" x2="13.5" y2="8" />
              <polyline points="6,4 8,2 10,4" />
              <polyline points="6,12 8,14 10,12" />
              <polyline points="4,6 2,8 4,10" />
              <polyline points="12,6 14,8 12,10" />
            </svg>
          </button>
        )}
        <div className="contents">
          <div className="flex items-center gap-1.5">
            {canEditSchedule ? (
              // Two-select time picker. We can't use <input type="time">
              // because iOS Safari ignores `step` and shows a per-minute
              // wheel. With native <select>s the minutes column is exactly
              // the 5-min set we define.
              (() => {
                const [hhStr, mmStr] = hhmm ? hhmm.split(":") : ["", ""];
                const hh = hhStr === "" ? null : parseInt(hhStr, 10);
                const mm = mmStr === "" ? null : parseInt(mmStr, 10);
                const FIVE_MINS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
                const HOURS = Array.from({ length: 24 }, (_, i) => i);
                const setHour = (newHh: number) => {
                  const minute = mm == null ? 0 : mm;
                  onTimeChange(g, `${String(newHh).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
                };
                const setMinute = (newMm: number) => {
                  if (hh == null) return; // need an hour first
                  onTimeChange(g, `${String(hh).padStart(2, "0")}:${String(newMm).padStart(2, "0")}`);
                };
                const isAnchored = !!g.scheduleAnchored;
                return (
                  <span className={`inline-flex items-center gap-0.5 tabular-nums rounded ${isAnchored ? "px-0.5 ring-1 ring-blue-300 bg-blue-50" : ""}`}>
                    <select
                      value={hh == null ? "" : String(hh)}
                      onChange={(e) => setHour(parseInt(e.target.value, 10))}
                      className={`border border-border rounded px-0.5 py-0.5 text-[11px] cursor-pointer ${isAnchored ? "bg-blue-50 text-blue-900 font-semibold" : "bg-white"}`}
                    >
                      <option value="" disabled>--</option>
                      {HOURS.map((h) => (
                        <option key={h} value={h}>{String(h).padStart(2, "0")}</option>
                      ))}
                    </select>
                    <span className="text-[11px]">:</span>
                    <select
                      value={mm == null ? "" : String(mm)}
                      onChange={(e) => setMinute(parseInt(e.target.value, 10))}
                      className={`border border-border rounded px-0.5 py-0.5 text-[11px] cursor-pointer ${isAnchored ? "bg-blue-50 text-blue-900 font-semibold" : "bg-white"}`}
                    >
                      <option value="" disabled>--</option>
                      {FIVE_MINS.map((m) => (
                        <option key={m} value={m}>{String(m).padStart(2, "0")}</option>
                      ))}
                    </select>
                  </span>
                );
              })()
            ) : (
              <span className={`text-[11px] font-semibold tabular-nums w-[60px] ${g.scheduleAnchored ? "text-blue-700" : ""}`}>
                {g.scheduleAnchored && hhmm && <span aria-hidden className="mr-0.5">📌</span>}
                {hhmm || <span className="text-muted font-normal">—</span>}
              </span>
            )}
            {canEditSchedule && hhmm && (
              <>
                {g.scheduleAnchored && (
                  <button
                    type="button"
                    title="Anchored — this start time is fixed and the auto-scheduler chains the next matches forward from here. Click to release the anchor and let this match's time be auto-derived."
                    onClick={async () => {
                      // Flip the pin off in SWR's cache RIGHT AWAY so
                      // the 📌 disappears the instant the operator
                      // taps it — the PATCH + recalc round-trip used
                      // to make this feel frozen.
                      await swrEvent.mutate(
                        (cur: Event | undefined) => {
                          if (!cur) return cur;
                          return {
                            ...cur,
                            leagueGames: (cur.leagueGames || []).map((x) =>
                              x.id === g.id ? { ...x, scheduleAnchored: false } : x,
                            ),
                          };
                        },
                        { revalidate: false },
                      );
                      try {
                        await fetch(`/api/leagues/${event.round!.league.id}/events/${id}/games/${g.id}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ scheduleAnchored: false }),
                        });
                      } finally {
                        fetchEvent();
                      }
                    }}
                    className="text-[10px] px-1 hover:opacity-70"
                    aria-label="Anchor (click to release)"
                  >📌</button>
                )}
                <button
                  type="button"
                  title="Clear time"
                  onClick={() => clearTime(g)}
                  className="text-muted hover:text-danger text-xs px-1"
                >✕</button>
                <button
                  type="button"
                  title={`Auto-fill subsequent times on this court (+${scheduleDurationMin}m each, stops at next fixed time)`}
                  onClick={() => autoFillDown(g)}
                  className="text-action hover:underline text-[10px] px-1 font-semibold"
                >↓ fill</button>
              </>
            )}
            <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded-full border ${g.kind === "principal" ? "border-emerald-400 text-emerald-700 bg-emerald-50" : g.kind === "league" ? "border-blue-400 text-blue-700 bg-blue-50" : "border-gray-300 text-muted bg-gray-50"}`}>
              {g.kind === "principal" ? "P" : g.kind === "league" ? "L" : "F"}
            </span>
          </div>
          <div className="text-[10px] uppercase tracking-wider text-muted font-medium">
            {catName(g.categoryId)} <span className="text-muted/70">· Match {g.slotNumber ?? "?"}</span>
          </div>
          {/* Two team rows. Always rendered so each card has the same
              shape, leaving a fixed-width slot on the right for the
              eventual score. Pre-reveal we show just the team name;
              post-reveal we add the player names below. */}
          <div className="space-y-1">
            <div className="flex items-baseline gap-1.5">
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-foreground truncate">{teamShort(g.team1Id)}</div>
                {sides.team1.length > 0 && (
                  <div className="text-[10px] text-muted leading-tight truncate">{sides.team1.join(", ")}</div>
                )}
              </div>
              <div className="w-8 text-right text-sm font-bold tabular-nums shrink-0">
                {t1Score != null ? t1Score : <span className="text-muted/40 font-normal">—</span>}
              </div>
            </div>
            <div className="flex items-baseline gap-1.5">
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-foreground truncate">{teamShort(g.team2Id)}</div>
                {sides.team2.length > 0 && (
                  <div className="text-[10px] text-muted leading-tight truncate">{sides.team2.join(", ")}</div>
                )}
              </div>
              <div className="w-8 text-right text-sm font-bold tabular-nums shrink-0">
                {t2Score != null ? t2Score : <span className="text-muted/40 font-normal">—</span>}
              </div>
            </div>
          </div>
          {canEditSchedule && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setCourtPickerGameId(courtPickerGameId === g.id ? null : g.id)}
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${g.courtNum != null ? "border-blue-400 bg-blue-50 text-blue-700" : "border-border bg-gray-50 text-muted"} hover:brightness-95`}
              >
                <span>{g.courtNum != null ? `Court ${g.courtNum}` : "no court"}</span>
                <span className="text-[9px] opacity-70">▾</span>
              </button>
              {courtPickerGameId === g.id && (
                <>
                  {/* Backdrop closes the popup on outside click. */}
                  <div className="fixed inset-0 z-30" onClick={() => setCourtPickerGameId(null)} />
                  <div className="absolute z-40 mt-1 left-0 bg-white border border-border rounded-lg shadow-lg p-2 flex flex-wrap gap-1.5 w-[180px]">
                    <button
                      type="button"
                      onClick={async () => { setCourtPickerGameId(null); await onCourtChange(g, ""); }}
                      className={`w-9 h-9 rounded-md border text-[11px] font-medium ${g.courtNum == null ? "border-action bg-action text-white" : "border-border hover:bg-gray-50 text-muted"}`}
                      title="No court"
                    >—</button>
                    {Array.from({ length: numCourts }, (_, i) => i + 1).map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={async () => { setCourtPickerGameId(null); await onCourtChange(g, String(n)); }}
                        className={`w-9 h-9 rounded-md border text-sm font-bold ${g.courtNum === n ? "border-action bg-action text-white" : "border-border hover:bg-gray-50 text-foreground"}`}
                      >{n}</button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        {rowConflicts.length > 0 && (() => {
          // Dedupe by player + kind for the inline pill — one player
          // could appear in multiple cross-references but we just want
          // a short summary on this card.
          const seen = new Set<string>();
          const items = rowConflicts.filter((c) => {
            const key = `${c.playerId}:${c.kind}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
          return (
            <div className={`text-[10px] rounded px-1.5 py-0.5 ${rowHasOverlap ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800"}`}>
              <span aria-hidden>⚠ </span>
              {items.map((c, i) => (
                <span key={`${c.playerId}-${i}`}>
                  {i > 0 ? "; " : ""}
                  <span className="font-semibold">{c.playerName}</span>{" "}
                  {c.kind === "overlap" ? "overlap" : `${c.gapMin}m gap`}
                </span>
              ))}
            </div>
          );
        })()}
        </div>
      );
    };

    // Categories actually used in this event's games. Filters the
    // league's full category list down to what the operator can
    // meaningfully override here.
    const usedCategoryIds = new Set(games.map((g) => g.categoryId));
    const availableCategories = cats.filter((c) => usedCategoryIds.has(c.id));
    const savedCatOverrides: Record<string, number> = (event.categoryDurationOverrides || {}) as Record<string, number>;

    const openCatPanel = () => {
      setEditedCatOverrides({ ...savedCatOverrides });
      setCatOverridesOpen(true);
    };
    const closeCatPanel = () => {
      setCatOverridesOpen(false);
    };
    const saveCatOverrides = async () => {
      setSavingCatOverrides(true);
      try {
        await fetch(`/api/events/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ categoryDurationOverrides: editedCatOverrides }),
        });
        fetchEvent();
        setCatOverridesOpen(false);
      } catch { /* silent */ } finally {
        setSavingCatOverrides(false);
      }
    };

    return (
      <div className={`${frameClass} p-3 space-y-2`}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="text-base font-bold">Schedule</div>
        </div>
        {canEditSchedule && (
          <div className="mt-3 flex items-end gap-6 flex-wrap">
            <div>
              <div className="text-[11px] text-muted mb-1">Per match (min)</div>
              <div className="flex items-center gap-2">
                <DurationStepper
                  compact
                  value={eventDurationOverride}
                  onChange={(next) => setEventDurationOverride(next)}
                  min={5}
                  max={180}
                />
                <span className="text-[10px] text-muted">round / league: {inheritedDurationMin} min</span>
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <button
                type="button"
                onClick={() => (catOverridesOpen ? closeCatPanel() : openCatPanel())}
                className="text-[11px] text-action font-semibold hover:underline inline-flex items-center gap-1"
                aria-expanded={catOverridesOpen}
              >
                <span className={`inline-block transition-transform ${catOverridesOpen ? "rotate-90" : ""}`}>▸</span>
                <span>Category overrides{Object.keys(savedCatOverrides).length > 0 ? ` (${Object.keys(savedCatOverrides).length})` : ""}</span>
              </button>
              {/* Collapsed view: just the categories that already have an override. */}
              {!catOverridesOpen && Object.keys(savedCatOverrides).length > 0 && (
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted">
                  {availableCategories
                    .filter((c) => savedCatOverrides[c.id] != null)
                    .map((c) => (
                      <span key={c.id}>{c.name}: <span className="text-foreground font-semibold tabular-nums">{savedCatOverrides[c.id]}</span></span>
                    ))}
                </div>
              )}
              {/* Expanded view: stepper per available category + Save. */}
              {catOverridesOpen && (
                <div className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-2 items-center max-w-sm">
                  {availableCategories.length === 0 && (
                    <span className="col-span-2 text-[11px] text-muted italic">No categories used in this event yet.</span>
                  )}
                  {availableCategories.flatMap((c) => {
                    const v = editedCatOverrides[c.id];
                    return [
                      <div key={`label-${c.id}`} className="text-[11px] text-foreground truncate">
                        <span className="text-muted">↳ </span>{c.name}
                      </div>,
                      <DurationStepper
                        key={`step-${c.id}`}
                        value={v ?? null}
                        compact
                        label={`Override duration for ${c.name}`}
                        onChange={(next) => {
                          setEditedCatOverrides((prev) => {
                            const out = { ...prev };
                            if (next == null) delete out[c.id];
                            else out[c.id] = next;
                            return out;
                          });
                        }}
                      />,
                    ];
                  })}
                  <div className="col-span-2 flex justify-end gap-2 mt-1">
                    <button
                      type="button"
                      onClick={closeCatPanel}
                      className="text-[11px] text-muted font-medium px-2 py-1 hover:text-foreground"
                    >Cancel</button>
                    <button
                      type="button"
                      onClick={saveCatOverrides}
                      disabled={savingCatOverrides}
                      className="text-[11px] text-white font-semibold bg-action hover:brightness-110 rounded-md px-3 py-1 disabled:opacity-50"
                    >{savingCatOverrides ? "Saving…" : "Save"}</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
        {canEditSchedule && (
          <p className="text-[10px] text-muted">– = inherit from round / league. Per-category overrides live in the Category overrides panel above.</p>
        )}
        {canEditSchedule && (
          arrangePreview ? (
            <div className="mb-2 rounded-xl border border-action/40 bg-action/5 p-2.5 flex items-center justify-between gap-2 text-[12px]">
              <span className="font-semibold text-action">
                Auto-arrange preview — Friendly matches always last. Review the schedule below.
              </span>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={cancelArrange}
                  disabled={arrangeApplying}
                  className="text-[11px] font-medium px-2 py-1 rounded-md text-muted hover:text-foreground hover:bg-white disabled:opacity-50"
                >Cancel</button>
                <button
                  type="button"
                  onClick={approveArrange}
                  disabled={arrangeApplying}
                  className="text-[11px] font-semibold bg-action text-white px-3 py-1 rounded-md hover:brightness-110 disabled:opacity-50"
                >{arrangeApplying ? "Applying…" : "Approve"}</button>
              </div>
            </div>
          ) : (
            <div className="mb-2 rounded-xl border border-border bg-white p-2.5 flex items-center justify-between gap-2 text-[12px]">
              <span className="font-semibold">Auto-arrange schedule</span>
              <div className="flex items-center gap-2 shrink-0">
                <select
                  value={arrangePolicy}
                  onChange={(e) => setArrangePolicy(e.target.value as "principal-first" | "league-first")}
                  className="text-[11px] border border-border rounded px-1.5 py-0.5 bg-white"
                >
                  <option value="principal-first">Principal → League → Friendly</option>
                  <option value="league-first">League → Principal → Friendly</option>
                </select>
                <button
                  type="button"
                  onClick={runArrange}
                  className="text-[11px] font-semibold border border-action text-action bg-white hover:bg-action/5 rounded-md px-3 py-1"
                >Run</button>
              </div>
            </div>
          )
        )}
        {recalcInFlight > 0 && (
          <div className="mb-2 rounded-xl border border-blue-200 bg-blue-50 p-2.5 flex items-center gap-2 text-[12px] text-blue-900">
            <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin shrink-0" />
            <span>Recalculating schedule…</span>
          </div>
        )}
        {hasConflicts && (
          <div className="mb-2 rounded-xl border border-amber-300 bg-amber-50 p-3 space-y-1.5">
            <div className="flex items-center gap-2 text-sm font-semibold text-amber-900">
              <span aria-hidden>⚠</span>
              <span>
                {conflictSummary.length} player {conflictSummary.length === 1 ? "conflict" : "conflicts"}
                {overlapCount > 0 && rushedCount > 0
                  ? ` (${overlapCount} overlapping, ${rushedCount} rushed)`
                  : overlapCount > 0
                    ? " (overlapping)"
                    : " (rushed)"}
              </span>
            </div>
            <ul className="space-y-0.5 text-[11px] text-amber-900">
              {conflictSummary.map((c, i) => {
                const aT = c.a.scheduledAt ? timeHHMM(c.a.scheduledAt) : "?";
                const bT = c.b.scheduledAt ? timeHHMM(c.b.scheduledAt) : "?";
                const aCourt = c.a.courtNum != null ? `C${c.a.courtNum}` : "—";
                const bCourt = c.b.courtNum != null ? `C${c.b.courtNum}` : "—";
                const verb = c.kind === "overlap" ? "overlap" : `rushed ${c.gapMin}m gap`;
                const pairColor = pairColorByKey.get(pairKeyOf(c.a.id, c.b.id));
                return (
                  <li key={`${c.playerId}-${i}`} className="flex items-center gap-1.5">
                    <span
                      className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${pairColor?.dot ?? "bg-amber-400"}`}
                      aria-hidden
                    />
                    <span>
                      <span className="font-semibold">{c.playerName}</span>
                      {" — "}
                      <span className={c.kind === "overlap" ? "text-red-700 font-medium" : ""}>{verb}</span>
                      {" — "}
                      {catName(c.a.categoryId)} {aT}/{aCourt} ↔ {catName(c.b.categoryId)} {bT}/{bCourt}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="text-[10px] text-amber-800 mt-1">
              Realistic timeline: each match is assumed to run {Math.round(DELAY_PCT * 100)}% longer than scheduled (base duration = gap to next match on the same court; {scheduleDurationMin}-min default for the last match). Delays cascade — a late start on a court pushes every following match on that court. Rushed warns when the projected gap between matches on different courts drops under {BUFFER_MIN} min.
            </p>
          </div>
        )}
        <div className="flex gap-2 overflow-x-auto -mx-3 px-3 pb-2">
          {/* Hide empty columns from display. The D-pad ← → arrows are
              still enabled based on the full column range (1..N), so
              moving INTO an empty column makes it appear. */}
          {buckets["unassigned"].length > 0 && (
            <div className="shrink-0 w-60 space-y-1.5 rounded-lg p-1.5 -m-1.5">
              <div className="text-[10px] uppercase tracking-wider text-muted font-bold px-1">Unassigned</div>
              {buckets["unassigned"].map(renderGameRow)}
            </div>
          )}
          {Array.from({ length: numCourts }, (_, i) => i + 1).map((n) => {
            const startIso = courtStartTimes[String(n)];
            const startD = startIso ? new Date(startIso) : null;
            const startHh = startD ? startD.getHours() : null;
            const startMm = startD ? startD.getMinutes() : null;
            const HOURS = Array.from({ length: 24 }, (_, i) => i);
            const FIVE_MINS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
            const setStart = (hh: number | null, mm: number | null) => {
              if (hh == null || mm == null) {
                writeCourtStart(n, null);
                return;
              }
              const base = event.date ? new Date(event.date) : new Date();
              base.setHours(hh, mm, 0, 0);
              writeCourtStart(n, base.toISOString());
            };
            const colGames = buckets[String(n)] || [];
            return (
              <div key={n} className="shrink-0 w-60 space-y-1.5 rounded-lg p-1.5 -m-1.5">
                <div className="flex items-center justify-between gap-1 px-1">
                  <span className="text-[10px] uppercase tracking-wider text-muted font-bold">Court {n}</span>
                  {canEditSchedule && n === 1 && numCourts > 1 && startIso && (
                    <button
                      type="button"
                      onClick={copyCourt1StartToAll}
                      title="Apply Court 1 start time to all other courts"
                      aria-label="Copy Court 1 start to all courts"
                      className="text-[10px] text-action font-semibold hover:underline"
                    >→ all</button>
                  )}
                </div>
                {canEditSchedule && (
                  <div className="flex items-center gap-0.5 px-1 text-[11px] tabular-nums">
                    <span className="text-muted text-[10px] mr-1">starts</span>
                    <select
                      value={startHh == null ? "" : String(startHh)}
                      onChange={(e) => setStart(parseInt(e.target.value, 10), startMm ?? 0)}
                      className="border border-border rounded px-0.5 py-0.5 bg-white cursor-pointer text-[11px]"
                    >
                      <option value="">--</option>
                      {HOURS.map((h) => <option key={h} value={h}>{String(h).padStart(2, "0")}</option>)}
                    </select>
                    <span>:</span>
                    <select
                      value={startMm == null ? "" : String(startMm)}
                      onChange={(e) => setStart(startHh ?? 0, parseInt(e.target.value, 10))}
                      disabled={startHh == null}
                      className="border border-border rounded px-0.5 py-0.5 bg-white cursor-pointer text-[11px] disabled:bg-gray-100"
                    >
                      <option value="">--</option>
                      {FIVE_MINS.map((m) => <option key={m} value={m}>{String(m).padStart(2, "0")}</option>)}
                    </select>
                    {startIso && (
                      <button type="button" onClick={() => writeCourtStart(n, null)} className="ml-1 text-muted hover:text-foreground text-[11px]" title="Clear start time">✕</button>
                    )}
                  </div>
                )}
                {!canEditSchedule && startIso && (
                  <div className="px-1 text-[11px] text-muted">starts {String(startHh).padStart(2, "0")}:{String(startMm).padStart(2, "0")}</div>
                )}
                {colGames.length > 0 ? colGames.map(renderGameRow) : (
                  <div className="text-[10px] text-muted/60 italic px-1">no matches yet</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderRounds = () => (
    <div>
      <AppHeader
        variant="hero-sub"
        back={{ label: heroTitle, href: `/events/${id}`, onClick: () => setActiveSection("overview") }}
        meta="Matches"
        action={canManage && !event.round ? { label: "Pairing", onClick: () => router.push(`/events/${id}/pairing`) } : undefined}
        onInvite={canManage && event.round ? () => setShareSheetOpen(true) : undefined}
        inviteKind={canManage && event.round ? "E" : undefined}
        inviteLabel={canManage && event.round ? "Share event invite" : undefined}
        onShareSchedule={event.round ? openScheduleShare : undefined}
        shareScheduleLabel={event.round ? "Share match-day schedule" : undefined}
      />

      <div className="px-4 space-y-3 pt-3">
        {/* Matches-tab filters — empty selection = all. Pills toggle on/off
            so users can stack filters. Search field goes on its own row. */}
        <div className="space-y-2">
          <ClearInput value={matchPlayerSearch} onChange={setMatchPlayerSearch} placeholder="Search player..." className="text-base" />
          <div className="flex gap-1 flex-wrap items-center">
            {event.round && ([
              { v: "principal" as const, label: "🏆 Principal" },
              { v: "friendly" as const,  label: "⚪ Friendly" },
              { v: "non-league" as const, label: "Non-league" },
            ]).map((f) => {
              const active = matchKindFilter.has(f.v);
              return (
                <button
                  key={f.v}
                  onClick={() => {
                    const next = new Set(matchKindFilter);
                    if (next.has(f.v)) next.delete(f.v); else next.add(f.v);
                    setMatchKindFilter(next);
                  }}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap ${active ? "bg-selected text-white" : "bg-gray-100 text-muted"}`}
                >{f.label}</button>
              );
            })}
          </div>
          <div className="flex gap-1 flex-wrap items-center">
            {/* Gender pills */}
            {([
              { v: "M" as const, label: "♂" },
              { v: "F" as const, label: "♀" },
            ]).map((g) => (
              <button
                key={g.v}
                onClick={() => setMatchGenderFilter((cur) => cur === g.v ? null : g.v)}
                title={g.v === "M" ? "Men" : "Women"}
                className={`px-2.5 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap ${matchGenderFilter === g.v ? "bg-selected text-white" : "bg-gray-100 text-foreground"}`}
              >{g.label}</button>
            ))}
            {/* Format pills */}
            {([
              { v: "doubles" as const, label: "👥", title: "Doubles" },
              { v: "singles" as const, label: "👤", title: "Singles" },
            ]).map((f) => (
              <button
                key={f.v}
                onClick={() => setMatchFormatFilter((cur) => cur === f.v ? null : f.v)}
                title={f.title}
                className={`px-2.5 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap ${matchFormatFilter === f.v ? "bg-selected text-white" : "bg-gray-100 text-foreground"}`}
              >{f.label}</button>
            ))}
          </div>
        </div>
        {renderLeagueSchedule()}
        {/* Active — orange */}
        {activeMatches.length > 0 && (
          <div className="bg-orange-50 -mx-4 px-4 py-3 border-y border-orange-200">
            <div className="flex items-center gap-2 mb-2"><div className="w-2 h-2 rounded-full bg-orange-500 animate-pulse" /><span className="text-xs font-bold text-orange-700 uppercase tracking-wider">In Play</span></div>
            <div className="space-y-2">{[...activeMatches].sort(matchCmp).map(renderMatchCard)}</div>
          </div>
        )}

        {/* Paused — amber */}
        {pausedMatches.length > 0 && (
          <div className="bg-amber-50 -mx-4 px-4 py-3 border-y border-amber-200">
            <div className="flex items-center gap-2 mb-2"><span className="text-xs font-bold text-amber-700 uppercase tracking-wider">Paused</span></div>
            <div className="space-y-2">{[...pausedMatches].sort(matchCmp).map(renderMatchCard)}</div>
          </div>
        )}

        {/* Pending — normal */}
        {pendingMatches.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2"><span className="text-xs font-bold text-blue-600 uppercase tracking-wider">Upcoming</span></div>
            <div className="space-y-2">{[...pendingMatches].sort(matchCmp).map(renderMatchCard)}</div>
          </div>
        )}

        {/* Completed — grey */}
        {completedMatches.length > 0 && (
          <div className="bg-gray-100 -mx-4 px-4 py-3 border-y border-gray-200">
            <div className="flex items-center gap-2 mb-2"><span className="text-xs font-bold text-muted uppercase tracking-wider">Completed</span></div>
            <div className="space-y-2">{[...completedMatches].sort((a, b) => b.round - a.round || a.courtNum - b.courtNum).map(renderMatchCard)}</div>
          </div>
        )}

        {/* Pickle summary */}
        {(() => {
          const pickles = completedMatches.filter((m) => {
            const t1 = m.players.filter((p) => p.team === 1);
            const t2 = m.players.filter((p) => p.team === 2);
            const s1 = t1[0]?.score ?? -1;
            const s2 = t2[0]?.score ?? -1;
            return (s1 === 0 || s2 === 0) && (s1 + s2 > 0);
          });
          if (pickles.length === 0) return null;
          return (
            <div className="bg-amber-50 rounded-xl border border-amber-200 p-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-base">🍺</span>
                <span className="text-xs font-bold text-amber-800 uppercase tracking-wider">Pickle Alert — Beers Owed!</span>
                <span className="text-base">🍺</span>
              </div>
              <div className="space-y-1">
                {pickles.map((m) => {
                  const t1 = m.players.filter((p) => p.team === 1);
                  const t2 = m.players.filter((p) => p.team === 2);
                  const s1 = t1[0]?.score ?? 0;
                  const winners = s1 === 0 ? t2 : t1;
                  const losers = s1 === 0 ? t1 : t2;
                  return (
                    <p key={m.id} className="text-[11px] text-amber-700">
                      Court {m.courtNum}: <span className="font-semibold">{winners.map((p) => p.player.name.split(" ")[0]).join(" & ")}</span>
                      {" "}owe a beer to {losers.map((p) => p.player.name.split(" ")[0]).join(" & ")}
                    </p>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {event.matches.length === 0 && <p className="text-center py-8 text-muted text-sm">No matches yet</p>}
      </div>
    </div>
  );

  /* Old tab-based match view removed — see renderRounds above */
  if (false as boolean) { return ( // dead code block for removed tabs
    <div>
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
        {([
          { key: "previous", label: "Previous", count: completedMatches.length },
          { key: "current", label: "Current", count: activeMatches.length },
          ...(pausedMatches.length > 0 ? [{ key: "paused" as const, label: "Paused", count: pausedMatches.length }] : []),
          { key: "future", label: "Future", count: pendingMatches.length },
        ] as const).map((t) => (
          <button key={t.key} onClick={() => setMatchTab(t.key)}
            className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${
              matchTab === t.key ? "bg-white text-foreground shadow-sm" : "text-muted hover:text-foreground"
            }`}>
            {t.label} {t.count > 0 && <span className="text-[10px] opacity-70">({t.count})</span>}
          </button>
        ))}
      </div>

      {/* Refresh button */}
      <div className="flex justify-end">
        <button onClick={() => fetchEvent()} className="text-xs text-muted hover:text-foreground flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-gray-100 transition-colors">
          🔄 Refresh scores
        </button>
      </div>


      {/* Current tab — active matches */}
      {matchTab === "current" && (
        <div className="space-y-2">
          {activeMatches.length === 0 ? (
            <p className="text-center py-6 text-muted text-sm">No matches in progress</p>
          ) : (
            activeMatches.sort((a, b) => a.courtNum - b.courtNum).map(renderMatchCard)
          )}
        </div>
      )}

      {/* Paused tab */}
      {matchTab === "paused" && (
        <div className="space-y-2">
          {pausedMatches.length === 0 ? (
            <p className="text-center py-6 text-muted text-sm">No paused matches</p>
          ) : (
            pausedMatches.sort((a, b) => a.courtNum - b.courtNum).map(renderMatchCard)
          )}
        </div>
      )}

      {/* Previous tab — completed matches */}
      {matchTab === "previous" && (
        <div className="space-y-2">
          {completedMatches.length === 0 ? (
            <p className="text-center py-6 text-muted text-sm">No completed matches yet</p>
          ) : (
            [...completedMatches].sort((a, b) => b.round - a.round || a.courtNum - b.courtNum).map(renderMatchCard)
          )}
        </div>
      )}

      {/* Future tab — actions + pending matches */}
      {matchTab === "future" && (
        <div className="space-y-3">
          {/* Action buttons */}
          {canManage && (
            <div className="space-y-2">
              {event.pairingMode !== "manual" && (
                <>
                  {!isIncremental && (
                    <div className="flex items-center gap-3 mb-2">
                      <label className="text-sm font-medium text-foreground">Rounds:</label>
                      <div className="flex items-center gap-0">
                        <button onClick={() => setNumRounds(Math.max(1, numRounds - 1))}
                          className="w-10 h-10 rounded-l-xl bg-gray-200 text-foreground font-bold text-xl flex items-center justify-center active:bg-gray-300">−</button>
                        <div className="w-10 h-10 bg-selected text-white font-bold text-xl flex items-center justify-center">{numRounds}</div>
                        <button onClick={() => setNumRounds(Math.min(20, numRounds + 1))}
                          className="w-10 h-10 rounded-r-xl bg-gray-200 text-foreground font-bold text-xl flex items-center justify-center active:bg-gray-300">+</button>
                      </div>
                    </div>
                  )}
                  <button onClick={generateMatches}
                    disabled={generating || activePlayers.length < minPlayers}
                    className="w-full bg-action text-white py-3 rounded-xl font-semibold text-base shadow-md active:bg-action-dark transition-colors disabled:opacity-50">
                    {generating ? "Generating..." : isIncremental ? "Generate Next Round" : `Generate ${numRounds} Round${numRounds > 1 ? "s" : ""}`}
                  </button>
                </>
              )}
              <button onClick={() => setActiveSection("manual")}
                className="w-full py-2.5 text-center rounded-xl text-sm font-semibold border border-primary text-primary hover:bg-primary/5 active:bg-primary/10 transition-colors">
                + Add Manual Match
              </button>
            </div>
          )}

          {/* Pending matches */}
          {pendingMatches.length === 0 ? (
            <p className="text-center py-4 text-muted text-sm">No pending matches</p>
          ) : (
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-muted uppercase tracking-wider">Pending ({pendingMatches.length})</h4>
              {pendingMatches.sort((a, b) => a.round - b.round || a.courtNum - b.courtNum).map(renderMatchCard)}
            </div>
          )}
        </div>
      )}

    </div>
  ); }

  // ── Section: Add Match Manually ──
  const renderManual = () => (
    <div className="space-y-3">
      {/* Court card */}
      <div className={`${frameClass} p-3`}>
        <div className="flex items-center gap-3">
        <span className="text-sm font-semibold text-muted">Court</span>
        <div className="flex gap-1.5">
          {Array.from({ length: event.numCourts }, (_, i) => i + 1).map((c) => (
            <button key={c} type="button" onClick={() => setManualCourt(c)}
              className={`w-10 h-10 rounded-xl font-bold text-lg flex items-center justify-center transition-all ${
                manualCourt === c ? "bg-selected text-white shadow-sm" : "bg-gray-100 text-foreground hover:bg-gray-200"
              }`}>{c}</button>
          ))}
        </div>
        </div>
      </div>

      {/* Players card */}
      <div className={`${frameClass} p-3`}>
        <div className="grid grid-cols-2 gap-3">
          {(() => {
            const manualMC = new Map<string, number>();
            for (const m of event.matches) for (const p of m.players) manualMC.set(p.playerId, (manualMC.get(p.playerId) || 0) + 1);
            const pool = event.players.filter((ep) => ep.status === "registered" || ep.status === "checked_in");
            return (<>
          <div>
            <label className="block text-sm font-semibold text-foreground mb-1">Team 1</label>
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {pool.filter((ep) => !manualTeam2.includes(ep.player.id)).map((ep) => (
                <button key={ep.player.id} type="button" onClick={() => toggleManualPlayer(ep.player.id, 1)}
                  className={`w-full text-left text-sm py-1.5 px-2 rounded transition-all flex items-center gap-1.5 ${
                    manualTeam1.includes(ep.player.id) ? "bg-blue-100 text-blue-800 font-medium" : "hover:bg-gray-50"
                  }`}>
                  <PlayerAvatar name={ep.player.name} photoUrl={ep.player.photoUrl} size="xs" />
                  <span className="truncate flex-1">{ep.player.name}</span>
                  <span className="text-[10px] text-muted tabular-nums shrink-0">{manualMC.get(ep.player.id) || 0}m</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-semibold text-foreground mb-1">Team 2</label>
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {pool.filter((ep) => !manualTeam1.includes(ep.player.id)).map((ep) => (
                <button key={ep.player.id} type="button" onClick={() => toggleManualPlayer(ep.player.id, 2)}
                  className={`w-full text-left text-sm py-1.5 px-2 rounded transition-all flex items-center gap-1.5 ${
                    manualTeam2.includes(ep.player.id) ? "bg-red-100 text-red-800 font-medium" : "hover:bg-gray-50"
                  }`}>
                  <PlayerAvatar name={ep.player.name} photoUrl={ep.player.photoUrl} size="xs" />
                  <span className="truncate flex-1">{ep.player.name}</span>
                  <span className="text-[10px] text-muted tabular-nums shrink-0">{manualMC.get(ep.player.id) || 0}m</span>
                </button>
              ))}
            </div>
          </div>
            </>);
          })()}
        </div>
      </div>
      {/* Match settings card */}
      <div className={`${frameClass} p-3 space-y-2`}>
        {/* Format + Win by */}
        <div className="flex gap-2">
          <div className="w-[55%]">
            <label className="block text-xs text-muted mb-1">Format</label>
            <select value={manualMatchFormat} onChange={(e) => setManualMatchFormat(e.target.value)}
              className="w-full border border-border rounded-lg px-2 py-1.5 text-sm bg-white">
              <option value="">{event.scoringFormat || "1x11"} (event default)</option>
              <option value="1x11">1 set to 11</option>
              <option value="1x15">1 set to 15</option>
              <option value="1x21">1 set to 21</option>
              <option value="3x11">Bo3 to 11</option>
              <option value="3x15">Bo3 to 15</option>
              <option value="1xR15">Rally to 15</option>
              <option value="1xR21">Rally to 21</option>
            </select>
            <p className="text-[10px] text-muted mt-0.5">
              {(() => { const fmt = manualMatchFormat || event.scoringFormat || "1x11"; return fmt.startsWith("3") ? `Best of 3 sets to ${fmt.replace(/^3x/, "").replace("R", "")}` : `1 set to ${fmt.replace(/^1x/, "").replace("R", "")}${fmt.includes("R") ? " (rally scoring)" : ""}`; })()}
            </p>
          </div>
          <div className="flex-1">
            <label className="block text-xs text-muted mb-1">Win by</label>
            <select value={manualWinBy} onChange={(e) => setManualWinBy(e.target.value)}
              className="w-full border border-border rounded-lg px-2 py-1.5 text-sm bg-white">
              <option value="">{(event.classes?.[0] as unknown as Record<string, string>)?.winBy || "2"} (event default)</option>
              <option value="1">1</option>
              <option value="2">2</option>
              <optgroup label="Win by 2 — golden point at N">
                {Array.from({ length: 14 }, (_, i) => i + 12).map((n) => (
                  <option key={`gp${n}`} value={`2_gp${n}`}>2 (GP@{n})</option>
                ))}
              </optgroup>
              <optgroup label="Cap to N (first to N wins)">
                {Array.from({ length: 14 }, (_, i) => i + 12).map((n) => (
                  <option key={`cap${n}`} value={`cap${n}`}>Cap {n}</option>
                ))}
              </optgroup>
            </select>
            <p className="text-[10px] text-muted mt-0.5">
              {(() => { const wb = manualWinBy || (event.classes?.[0] as unknown as Record<string, string>)?.winBy || "2"; return wb === "1" ? "First to target wins" : wb.includes("_gp") ? `Win by 2, golden point at ${wb.split("gp")[1]}` : "Must win by 2 points"; })()}
            </p>
          </div>
        </div>
        {/* Ranking */}
        <div>
          <label className="block text-xs text-muted mb-1">Ranking</label>
          <select value={manualRankingMode} onChange={(e) => setManualRankingMode(e.target.value)}
            className="w-full border border-border rounded-lg px-2 py-1.5 text-sm bg-white">
            <option value="">{(event.rankingMode || "ranked").charAt(0).toUpperCase() + (event.rankingMode || "ranked").slice(1)} (event default)</option>
            <option value="ranked">Ranked</option>
            <option value="approval">Approval</option>
            <option value="none">Unranked</option>
          </select>
          <p className="text-[10px] text-muted mt-0.5">
            {(() => { const rm = manualRankingMode || event.rankingMode || "ranked"; return rm === "ranked" ? "Scores count towards player rankings immediately" : rm === "approval" ? "Scores need confirmation by both teams or event admin" : "Scores recorded but don't affect rankings"; })()}
          </p>
        </div>
      </div>

      {/* League linkage toggle — only for new matches in league-attached events */}
      {event.round && !editingManualMatchId && (
        <div className={`${frameClass} p-3 space-y-2`}>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={manualFriendlyInLeague}
              onChange={(e) => setManualFriendlyInLeague(e.target.checked)}
              className="rounded"
            />
            <span className="text-sm font-medium">Friendly in league <span className="text-muted font-normal">(doesn&apos;t count for standings)</span></span>
          </label>
          {manualFriendlyInLeague && (
            <select value={manualLeagueCategoryId} onChange={(e) => setManualLeagueCategoryId(e.target.value)}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white">
              <option value="">Pick category…</option>
              {event.round.league.categories?.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={addManualMatch}
          disabled={manualTeam1.length === 0 || manualTeam2.length === 0 || (manualFriendlyInLeague && !manualLeagueCategoryId)}
          className="flex-1 bg-action text-white py-3 rounded-xl font-semibold text-lg active:bg-action-dark disabled:opacity-50"
        >{editingManualMatchId ? "Save Match" : "Create Match"}</button>
        <button onClick={() => { setManualTeam1([]); setManualTeam2([]); setEditingManualMatchId(null); setActiveSection("rounds"); }}
          className="px-4 py-3 rounded-xl text-sm font-medium text-muted bg-gray-100 hover:bg-gray-200">Cancel</button>
      </div>
    </div>
  );

  // ── Main render ──
  // When a class is selected in competition, show ClassStepFlow instead of section bar
  if (activeSection === "competition" && selectedClassId && event) {
    const cls = event.classes?.find((c: { id: string }) => c.id === selectedClassId);
    if (cls) {
      return (
        <div className="space-y-2">
          <ClassStepFlow
            eventId={id as string}
            eventName={event.name}
            eventDate={event.date}
            cls={cls as never}
            allClasses={(event.classes || []) as never}
            pairs={event.pairs}
            matches={event.matches}
            eventPlayers={event.players || []}
            canManage={canManage}
            numCourts={event.numCourts}
            onBack={() => { setSelectedClassId(null); fetchEvent(); if (!canManage) setActiveSection("overview"); }}
            onRefresh={fetchEvent}
          />
        </div>
      );
    }
  }

  // Competition mode: Players section without section bar
  if (event.competitionMode && activeSection === "players") {
    // Two-row back label for league events: short league name on row 1,
    // teams + round on row 2. Falls back to event.name for non-league.
    const backLabel = event.round ? leagueShortName(event.round.league) : event.name;
    const backSubtitle = event.round
      ? (() => {
          const teamNames = (event.leagueTeams || []).map((t) => t.team.name).join(" vs ");
          const roundLabel = event.round.name || `Round ${event.round.roundNumber}`;
          return teamNames ? `${teamNames} — ${roundLabel}` : roundLabel;
        })()
      : undefined;
    return (
      <div className="-mx-4">
        <AppHeader
          variant="hero-sub"
          back={{ label: backLabel, subtitle: backSubtitle, href: `/events/${id}`, onClick: () => setActiveSection("overview") }}
          meta="Participants"
          action={canManage ? { label: "+/- Player", onClick: () => { setBulkSelectMode(true); setBulkSearch(""); setBulkGenderFilter(null); fetchAllPlayers(); } } : undefined}
          onInvite={canManage && event.round ? () => setShareSheetOpen(true) : undefined}
          inviteKind={canManage && event.round ? "E" : undefined}
          inviteLabel={canManage && event.round ? "Share event invite" : undefined}
          onShareSchedule={event.round ? openScheduleShare : undefined}
          shareScheduleLabel={event.round ? "Share match-day schedule" : undefined}
        />
        <div className="px-4">
          {renderPlayers()}
        </div>
      </div>
    );
  }

  const renderActionSheet = () => {
    if (!actionSheetMatchId || !event) return null;
    const match = event.matches?.find((m: Match) => m.id === actionSheetMatchId);
    if (!match) return null;
    const t1 = match.players.filter((p: MatchPlayer) => p.team === 1);
    const t2 = match.players.filter((p: MatchPlayer) => p.team === 2);
    const isMatchCompleted = match.status === "completed";
    const isMatchActive = match.status === "active";
    const close = () => setActionSheetMatchId(null);
    return (
      <div className="fixed inset-0 z-[90] bg-black/50 flex items-end justify-center" onClick={close}>
        <div className="bg-white rounded-t-2xl w-full max-w-[600px] shadow-2xl mb-16 mx-auto" onClick={(e) => e.stopPropagation()}>
          <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mt-3 mb-2" />
          <div className="text-center px-4 pb-3 border-b border-border">
            <span className="text-sm font-semibold">Court {match.courtNum}</span>
            <span className="text-xs text-muted ml-2">{t1.map((p: MatchPlayer) => p.player.name.split(" ")[0]).join(" & ")} vs {t2.map((p: MatchPlayer) => p.player.name.split(" ")[0]).join(" & ")}</span>
          </div>
          <div className="flex p-3 gap-3">
            {/* Left column: Edit + Delete */}
            {canManage && (
              <div className="flex flex-col gap-1.5 w-24">
                {isMatchCompleted && (isOwner || isAdmin) ? (<>
                  <button onClick={async () => { close(); if (!await confirmDialog({ message: "Modify score? This affects rankings.", confirmText: "Edit" })) return; startEditMatch(match.id, match.players.filter((p: MatchPlayer) => p.team === 1)[0]?.score ?? 0, match.players.filter((p: MatchPlayer) => p.team === 2)[0]?.score ?? 0); }}
                    className="flex-1 py-2.5 rounded-xl text-xs font-medium border border-border bg-white hover:bg-gray-50 active:bg-gray-100 shadow-sm flex flex-col items-center gap-1">✏️ <span>Edit score</span></button>
                  <button onClick={async () => { close(); if (!await confirmDialog({ message: "Clear scores and revert match to active? Rankings will be reversed.", confirmText: "Clear", danger: true })) return; await fetch(`/api/matches/${match.id}/score`, { method: "DELETE" }); await fetchEvent(); }}
                    className="flex-1 py-2.5 rounded-xl text-xs font-medium border border-amber-200 bg-white text-amber-700 hover:bg-amber-50 active:bg-amber-100 shadow-sm flex flex-col items-center gap-1">🔄 <span>Clear scores</span></button>
                </>) : !isMatchCompleted ? (
                  <button onClick={() => { close(); openEditMatch(match.id); }}
                    className="flex-1 py-2.5 rounded-xl text-xs font-medium border border-border bg-white hover:bg-gray-50 active:bg-gray-100 shadow-sm flex flex-col items-center gap-1">✏️ <span>Edit</span></button>
                ) : null}
                {(isOwner || isAdmin) && (
                  <button onClick={() => { close(); deleteMatch(match.id); }}
                    className="flex-1 py-2.5 rounded-xl text-xs font-medium border border-red-200 bg-white text-danger hover:bg-red-50 active:bg-red-100 shadow-sm flex flex-col items-center gap-1">🗑️ <span>Delete</span></button>
                )}
              </div>
            )}
            {/* Right column: Actions */}
            <div className="flex-1 flex flex-col gap-1.5">
              {isMatchActive && (canManage || match.scorerId === userId) && (
                <button onClick={() => { setEvent((prev) => prev ? { ...prev, matches: prev.matches.map((m) => m.id === match.id ? { ...m, status: "paused" } : m) } : prev); setMatchTab("paused"); fetch(`/api/matches/${match.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "paused" }) }).then(() => fetchEvent()); close(); }}
                  className="py-2.5 rounded-xl text-xs font-medium border border-border bg-white hover:bg-gray-50 active:bg-gray-100 shadow-sm flex items-center justify-center gap-2">⏸️ Pause</button>
              )}
              {!isMatchCompleted && match.players.length >= 2 && (canManage || match.scorerId === userId) && (
                <button onClick={async () => { close(); if (match.scorerId === userId || (scorerMatchId === match.id && scorerLiveScore)) { setScorerMatchId(match.id); setScorerVisible(true); return; } if (match.scorerId && match.scorerId !== userId && !await confirmDialog({ message: `${match.scorer?.name || "Someone"} is scorer. Take over?` })) return; if (!match.scorerId && !await confirmDialog({ message: "Will you be the scorer?" })) return; await fetch(`/api/matches/${match.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scorerId: userId }) }); await fetchEvent(); setScorerMatchId(match.id); setScorerVisible(true); }}
                  className="py-2.5 rounded-xl text-xs font-medium border border-border bg-white hover:bg-gray-50 active:bg-gray-100 shadow-sm flex items-center justify-center gap-2">⚖️ Live scorer</button>
              )}
              {!isMatchCompleted && (
                <button onClick={() => { setFocusedMatchId(match.id); close(); }}
                  className="py-2.5 rounded-xl text-xs font-medium border border-border bg-white hover:bg-gray-50 active:bg-gray-100 shadow-sm flex items-center justify-center gap-2">📺 Focus view</button>
              )}
              {(canManage || match.scorerId === userId) && (
                <button onClick={() => { if (typeof window !== "undefined" && window.speechSynthesis?.speaking) stopAnnouncement(); else { const n1 = match.players.filter((p: MatchPlayer) => p.team === 1).map((p: MatchPlayer) => p.player.name); const n2 = match.players.filter((p: MatchPlayer) => p.team === 2).map((p: MatchPlayer) => p.player.name); sendAnnouncement(id as string, formatMatchAnnouncement(match.courtNum, n1, n2, event.pairingMode === "king_of_court")); } close(); }}
                  className="py-2.5 rounded-xl text-xs font-medium border border-border bg-white hover:bg-gray-50 active:bg-gray-100 shadow-sm flex items-center justify-center gap-2">🔊 {isMatchCompleted ? "Announce result" : "Announce"}</button>
              )}
              {isMatchCompleted && match.rankingMode === "approval" && !match.scoreConfirmed && (
                <button onClick={async () => { await fetch(`/api/matches/${match.id}/score`, { method: "PATCH" }); await fetchEvent(); close(); }}
                  className="py-2.5 rounded-xl text-xs font-medium border border-amber-200 bg-white text-amber-700 hover:bg-amber-50 active:bg-amber-100 shadow-sm flex items-center justify-center gap-2">✓ Confirm score</button>
              )}
            </div>
          </div>
          <div className="px-4 pb-4 pt-2">
            <button onClick={close} className="w-full py-3 rounded-xl bg-gray-100 text-sm font-medium">Cancel</button>
          </div>
        </div>
      </div>
    );
  };

  const renderFocusedMatch = () => {
    if (!focusedMatchId || !event) return null;
    const match = event.matches?.find((m: Match) => m.id === focusedMatchId);
    if (!match || match.status === "completed") { setFocusedMatchId(null); return null; }
    const t1 = match.players.filter((p: MatchPlayer) => p.team === 1);
    const t2 = match.players.filter((p: MatchPlayer) => p.team === 2);
    const liveT1 = scorerMatchId === match.id && scorerLiveScore ? scorerLiveScore.team1 : null;
    const liveT2 = scorerMatchId === match.id && scorerLiveScore ? scorerLiveScore.team2 : null;
    const liveServerId = scorerMatchId === match.id ? scorerLiveScore?.serverId : undefined;
    const liveReceiverId = scorerMatchId === match.id ? scorerLiveScore?.receiverId : undefined;
    const statusLabel = match.status === "active" ? "In Play" : match.status === "paused" ? "Paused" : "Pending";

    const renderFocusPlayer = (mp: MatchPlayer) => {
      const isServer = liveServerId === mp.player.id;
      const isReceiver = liveReceiverId === mp.player.id;
      return (
        <div key={mp.id} className={`flex-1 flex flex-col items-center justify-center rounded-lg p-2 transition-all ${
          isServer ? "border-4 border-green-400 bg-green-500/30 shadow-lg shadow-green-500/20 ring-2 ring-green-400/50"
          : isReceiver ? "border-2 border-yellow-400/60 bg-yellow-500/10"
          : "border border-white/10 bg-white/5"
        }`}>
          <PlayerAvatar name={mp.player.name} photoUrl={mp.player.photoUrl} size="sm" />
          <span className={`text-lg font-bold mt-0.5 ${isServer ? "text-green-300" : isReceiver ? "text-yellow-200" : "text-white/60"}`}>
            {mp.player.name}
          </span>
          {isServer && <span className="text-[10px] text-green-300 font-bold animate-pulse">● SRV</span>}
          {isReceiver && <span className="text-[9px] text-yellow-300/70 font-medium">RCV</span>}
        </div>
      );
    };

    return (
      <div className="fixed inset-0 z-[90] bg-black flex flex-col text-white">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-white/10">
          <button onClick={() => setFocusedMatchId(null)} className="text-sm text-white/60 hover:text-white">← Back</button>
          <span className="text-sm text-white/50">Court {match.courtNum} · {statusLabel}</span>
          <span className="text-xs text-white/30 animate-pulse">● Live</span>
        </div>

        {/* Score */}
        <div className="px-4 py-3">
          <div className="flex items-center justify-center gap-3 py-2">
            <div className="text-center">
              <div className="text-sm uppercase tracking-wider font-bold mb-0.5 text-blue-500">Team A</div>
              <span className={`text-7xl font-black tabular-nums ${liveT1 !== null ? "text-blue-500" : "text-white/20"}`}>{liveT1 ?? "-"}</span>
            </div>
            <span className="text-4xl text-white/20 self-end mb-2">—</span>
            <div className="text-center">
              <div className="text-sm uppercase tracking-wider font-bold mb-0.5 text-red-500">Team B</div>
              <span className={`text-7xl font-black tabular-nums ${liveT2 !== null ? "text-red-500" : "text-white/20"}`}>{liveT2 ?? "-"}</span>
            </div>
          </div>
        </div>

        {/* Court — horizontal like rally tracker */}
        <div className="flex-1 flex p-2 gap-1 min-h-0 border border-white/20 rounded-xl mx-2">
          {/* Left team (Team A) */}
          <div className="flex-1 flex flex-col gap-2">
            <div className="text-[10px] text-center uppercase tracking-wider font-medium mb-0.5 text-blue-300">Team A</div>
            {t1.map((mp) => renderFocusPlayer(mp))}
          </div>
          {/* Net */}
          <div className="flex flex-col items-center justify-center w-6 relative">
            <div className="absolute inset-y-6 w-0.5 bg-white/30 left-1/2 -translate-x-1/2" />
            <span className="text-[8px] text-white/40 uppercase tracking-widest font-bold z-10" style={{ writingMode: "vertical-lr" }}>NET</span>
          </div>
          {/* Right team (Team B) */}
          <div className="flex-1 flex flex-col gap-2">
            <div className="text-[10px] text-center uppercase tracking-wider font-medium mb-0.5 text-red-300">Team B</div>
            {t2.map((mp) => renderFocusPlayer(mp))}
          </div>
        </div>

        {/* Scorer */}
        {match.scorer && (
          <div className="text-center text-xs text-white/40 py-2">
            Scorer: {match.scorer.name}
          </div>
        )}
      </div>
    );
  };

  const renderScorerTracker = () => {
    if (!scorerMatchId || !event) return null;
    const match = event.matches?.find((m: Match) => m.id === scorerMatchId);
    if (!match) return null;
    const team1 = match.players.filter((p: MatchPlayer) => p.team === 1).map((p: MatchPlayer) => ({ id: p.player.id, name: p.player.name, photoUrl: p.player.photoUrl }));
    const team2 = match.players.filter((p: MatchPlayer) => p.team === 2).map((p: MatchPlayer) => ({ id: p.player.id, name: p.player.name, photoUrl: p.player.photoUrl }));
    const cls = match.classId ? event.classes?.find((c: { id: string }) => c.id === match.classId) : event.classes?.[0];
    const fmt = match.matchFormat || cls?.scoringFormat || event.scoringFormat || "1x11";
    const wb = cls?.winBy || "2";
    return (
      <ScorerTracker
        matchId={match.id}
        matchStatus={match.status}
        visible={scorerVisible}
        team1Players={team1}
        team2Players={team2}
        scoringFormat={fmt}
        winBy={wb}
        onStartMatch={async () => {
          await fetch(`/api/matches/${match.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "active" }) });
          fetchEvent();
        }}
        onSubmitScore={async (t1, t2) => {
          await fetch(`/api/matches/${match.id}/score`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ team1Score: t1, team2Score: t2 }),
          });
          setScorerMatchId(null);
          setScorerVisible(false);
          fetchEvent();
        }}
        onScoreChange={(t1, t2, sid, rid) => setScorerLiveScore({ team1: t1, team2: t2, serverId: sid, receiverId: rid })}
        onClose={() => setScorerVisible(false)}
      />
    );
  };

  if (activeSection !== "overview") {
    const sectionMeta = ({ when: "Event Data", admins: "Organizer", scoring: "Event Format", pairing: "Pairing", players: "Participants", pairs: "Pairs", rounds: "Matches", competition: "Competition", manual: "Manual Match" } as Record<string, string>)[activeSection] || activeSection;
    const handleBackToOverview = async () => {
      if (hasEdits) {
        const ok = await confirmDialog({ title: "Unsaved changes", message: "You have unsaved changes. Discard them?", confirmText: "Discard", danger: true });
        if (!ok) return;
        startEditEvent();
      }
      setActiveSection("overview");
    };
    const sectionAction = undefined;
    return (
      <div className="-mx-4">
        {!bulkSelectMode && !showAddPlayer && !showAddGuest && activeSection !== "rounds" && activeSection !== "manual" && (
          <AppHeader
            variant="hero-sub"
            back={{ label: heroTitle, href: `/events/${id}`, onClick: handleBackToOverview }}
            meta={sectionMeta}
            action={sectionAction}
            onInvite={canManage && event.round ? () => setShareSheetOpen(true) : undefined}
            inviteKind={canManage && event.round ? "E" : undefined}
            inviteLabel={canManage && event.round ? "Share event invite" : undefined}
            onShareSchedule={event.round ? openScheduleShare : undefined}
            shareScheduleLabel={event.round ? "Share match-day schedule" : undefined}
          />
        )}
        {/* Add-Player / Add-Guest mode keeps the event name visible in
            the hero header (as plain text, NOT a back chevron) and drops
            the section meta. The blue back link to "Players" lives below
            in the content area. */}
        {(showAddPlayer || showAddGuest) && (
          <AppHeader variant="hero-sub" title={heroTitle} />
        )}

        <div className="px-4 space-y-2">
        {activeSection === "when" && renderWhen()}
        {activeSection === "scoring" && renderScoring()}
        {activeSection === "pairing" && renderPairing()}
        {activeSection === "admins" && renderAdmins()}
        {activeSection === "players" && renderPlayers()}
        {activeSection === "pairs" && renderPairs()}

        {activeSection === "competition" && event && (
          <div className="space-y-3">
            {/* Ranking — always shown */}
            <div className={`${frameClass} p-4 space-y-3`}>
              <p className="text-xs text-muted">Do matches count towards app player rankings?</p>
              <div className="flex gap-2">
                {[
                  { value: "ranked", label: "Ranked" },
                  { value: "approval", label: "Approval" },
                  { value: "none", label: "Unranked" },
                ].map((m) => (
                  <button key={m.value} type="button" onClick={() => { setEditRankingMode(m.value); setHasEdits(true); }}
                    className={`flex-1 py-2.5 rounded-lg font-medium transition-all text-sm ${
                      editRankingMode === m.value ? "bg-selected text-white" : "bg-gray-100 text-foreground hover:bg-gray-200"
                    }`}>
                    {m.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted">
                {editRankingMode === "ranked" && "Scores count towards player rankings immediately."}
                {editRankingMode === "approval" && "Scores need confirmation by both teams or event admin."}
                {editRankingMode === "none" && "Scores recorded but don't affect rankings."}
              </p>
            </div>

            {/* Classes — only when competition mode is on */}
            {event.competitionMode && (
              <>
                <ClassesManager
                  eventId={id as string}
                  classes={event.classes || []}
                  canManage={canManage}
                  onRefresh={fetchEvent}
                  onClassSelect={(classId) => setSelectedClassId(classId)}
                />
                <SessionsManager
                  eventId={id as string}
                  sessions={(event as { sessions?: { id: string; name: string; date: string; endDate?: string | null; numCourts: number; status: string; _count?: { matches: number } }[] }).sessions || []}
                  canManage={canManage}
                  onRefresh={fetchEvent}
                />
                <CompetitionResults
                  eventId={id as string}
                  classes={(event.classes || []).map((c: { id: string; name: string }) => ({ id: c.id, name: c.name }))}
                  players={event.players.map((ep) => ({ playerId: ep.player.id, player: { id: ep.player.id, name: ep.player.name, emoji: ep.player.emoji } }))}
                  canManage={canManage}
                />
              </>
            )}
          </div>
        )}
        {renderActionSheet()}
        {renderFocusedMatch()}
        {renderScorerTracker()}
        </div>
        {activeSection === "rounds" && renderRounds()}
        {activeSection === "manual" && renderManual()}
      </div>
    );
  }

  const scoringFormatLabel = (v: string) => {
    const labels: Record<string, string> = { "1x7": "1 set to 7", "1x9": "1 set to 9", "1x11": "1 set to 11", "1x15": "1 set to 15", "3x11": "Bo3 to 11", "3x15": "Bo3 to 15", "1xR15": "Rally to 15", "1xR21": "Rally to 21", "3xR15": "Bo3 rally 15", "3xR21": "Bo3 rally 21" };
    return labels[v] || v;
  };
  const pairingLabel = (v: string) =>
    ({ random: "Random", skill_balanced: "Skill Balanced", mixed_gender: "Mixed Gender", skill_mixed_gender: "Skill + Mixed", king_of_court: "King of Court", swiss: "Swiss", manual: "Manual" }[v] || v);
  const rankingLabel = (v: string) =>
    ({ ranked: "Ranked", approval: "Approval", none: "Not counted" }[v] || v);

  // Tappable list-row inside a Card. Distinct from Card's stock rowClass —
  // this one has bottom-borders, hover/active states, full width.
  const rowClass = "flex justify-between items-center py-2.5 px-3 border-b border-border last:border-b-0 hover:bg-gray-50 active:bg-gray-100 cursor-pointer transition-colors w-full";
  const frameTitleClass = "text-[10px] text-muted px-3 pt-2 pb-1 uppercase tracking-wider font-medium";

  const scoringDisplay = scoringFormatLabel(event.scoringFormat || "1x11");

  // Competition mode overview: classes list
  if (event.competitionMode) {
    const classes = event.classes || [];
    const uniquePlayerIds = new Set(event.players.map((ep) => ep.player.id));
    return (
      <div className="space-y-3">
        {eventHeroHeader}
        {managerCard}

        {/* Total players */}
        <div className={`${frameClass} overflow-hidden`}>
          <button onClick={() => setActiveSection("players")} className={rowClass}>
            <span className="text-base font-bold text-foreground">Players</span>
            <span className="text-sm font-medium">{uniquePlayerIds.size} signed up</span>
          </button>
        </div>

        {/* Classes — each as its own card */}
        {classes.map((cls: { id: string; name: string; competitionPhase?: string | null; maxPlayers?: number | null }) => {
          const classPlayers = event.players.filter((ep) => (ep as unknown as { classId?: string }).classId === cls.id);
          const mCount = classPlayers.filter((ep) => ep.player.gender === "M").length;
          const fCount = classPlayers.filter((ep) => ep.player.gender === "F").length;
          const max = cls.maxPlayers;
          const phase = (cls.competitionPhase || "draft") as string;
          const phaseLabel: Record<string, string> = { draft: "Draft", open: "Open", closed: "Closed", groups: "Group", bracket: "Bracket", bracket_upper: "Bracket", bracket_lower: "Bracket", completed: "Done" };
          const phaseStr = phaseLabel[phase] || phase;
          return (
            <button key={cls.id} onClick={() => { fetchEvent(); setActiveSection("competition"); setSelectedClassId(cls.id); }}
              className={`w-full ${frameClass} p-4 active:bg-gray-50 transition-colors text-left`}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">{cls.name}</span>
                <span className="text-[10px] text-muted font-medium bg-gray-100 px-2 py-0.5 rounded-full">{phaseStr}</span>
              </div>
              <div className="text-xs mt-1">
                {mCount > 0 && <span className="text-blue-500">♂ {mCount}{max ? `/${max}` : ""}</span>}
                {mCount > 0 && fCount > 0 && <span className="text-muted mx-1">·</span>}
                {fCount > 0 && <span className="text-pink-500">♀ {fCount}{max ? `/${max}` : ""}</span>}
                {mCount === 0 && fCount === 0 && <span className="text-muted">No players yet</span>}
              </div>
            </button>
          );
        })}
        {canManage && (
          <button onClick={() => setActiveSection("competition")}
            className="w-full py-2.5 text-xs text-action font-medium rounded-xl border border-action/30 hover:bg-action/5">
            Manage Classes ›
          </button>
        )}

        {/* Ranking */}
        <div className={`${frameClass} overflow-hidden`}>
          <button onClick={() => { startEditEvent(); setActiveSection("competition"); }} className={rowClass}>
            <span className="text-base font-bold text-foreground">Ranking</span>
            <span className="flex-1 text-right">
              <span className="text-sm font-medium">{rankingLabel(event.rankingMode || "ranked")}</span>
              <span className="block text-[10px] text-muted">
                ({event.rankingMode === "ranked" ? "scores count towards rankings" : event.rankingMode === "approval" ? "confirmation by both teams or admin" : "scores not counted"})
              </span>
            </span>
            {canManage && <span className="text-muted/50 self-start mt-0.5 ml-3">{penIcon}</span>}
          </button>
        </div>

        {(isOwner || isAdmin) && (
          <div className="mt-10 pt-4 flex justify-center">
            <button
              type="button"
              onClick={deleteEvent}
              className="text-xs text-danger font-medium hover:underline"
            >
              Delete Event
            </button>
          </div>
        )}
      </div>
    );
  }

  // Non-competition overview
  return (
    <div className="space-y-3">
      {eventHeroHeader}
      {/* League banner — visible when event is attached to a league round */}
      {event.round && (() => {
        const r = event.round!;
        const teamNames = (event.leagueTeams || []).map((t) => t.team.name).join(" vs ");
        return (
          <Link
            href={`/leagues/${r.league.id}?tab=rounds`}
            className="block bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 text-sm hover:bg-emerald-100"
          >
            <div className="flex items-center gap-2">
              <span>🏆</span>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-emerald-900 truncate">
                  {leagueShortName(r.league)}{r.league.season ? ` · ${r.league.season}` : ""}
                </div>
                <div className="text-[11px] text-emerald-700 truncate">
                  {r.name || `Round ${r.roundNumber}`}{teamNames ? ` · ${teamNames}` : ""}
                </div>
              </div>
              <span className="text-emerald-700 text-xs">›</span>
            </div>
          </Link>
        );
      })()}
      {/* League event sign-up CTA — only shown to a player who is on one
          of the two teams playing this match-day. Mentions which team and
          which intent (playing / attending only / can't come). */}
      {event.round && userId && (() => {
        const allLeagueTeams = event.round!.league.teams || [];
        // event.leagueTeams is the 1-2 teams playing this event. Find which
        // (if any) of those teams the viewer is rostered on.
        const playingTeamIds = (event.leagueTeams || []).map((et) => et.teamId);
        const myTeam = allLeagueTeams.find((t) => playingTeamIds.includes(t.id) && t.players.some((p) => p.playerId === userId));
        if (!myTeam) return null;
        const myEp = event.players.find((ep) => ep.player.id === userId);
        const hasSignedUp = !!myEp;
        // Derive intent the same way the sign-up page does:
        //   unavailable → "can't come"
        //   no prefs / all "no" → "attending only"
        //   any prefer/ok → "playing"
        const prefs = (myEp?.signupPreferences ?? {}) as Record<string, { level: "prefer" | "ok" | "no"; note?: string }>;
        const hasAnyPlay = Object.values(prefs).some((p) => p.level === "prefer" || p.level === "ok");
        const intent: "playing" | "attending" | "unavailable" | "none" =
          !myEp ? "none"
          : myEp.status === "unavailable" ? "unavailable"
          : Object.keys(prefs).length === 0 || !hasAnyPlay ? "attending"
          : "playing";
        const cats = event.round!.league.categories || [];
        const prefRows = cats
          .map((c) => ({ cat: c, p: prefs[c.id] }))
          .filter(({ p }) => p && p.level !== "no");
        // Categories the user is actually assigned to in the lineup +
        // partner names (gamePlayers on the same team, excluding self).
        // Pre-reveal the server filters gamePlayers to your own side so
        // the partner lookup is safe to do client-side.
        const myTeamRosterIds = new Set(myTeam.players.map((p) => p.playerId));
        const playerNameById = new Map<string, string>();
        for (const ep of event.players) playerNameById.set(ep.player.id, ep.player.name);
        for (const t of allLeagueTeams) {
          for (const tp of t.players) {
            const name = (tp as { player?: { name?: string } }).player?.name;
            if (name) playerNameById.set(tp.playerId, name);
          }
        }
        const myGames = (event.leagueGames ?? [])
          .filter((g) => g.gamePlayers.some((gp) => gp.playerId === userId))
          .map((g) => {
            const cat = cats.find((c) => c.id === g.categoryId);
            const partners = g.gamePlayers
              .filter((gp) => gp.playerId !== userId && myTeamRosterIds.has(gp.playerId))
              .map((gp) => playerNameById.get(gp.playerId) || "?");
            return { cat, partners, scheduledAt: g.scheduledAt ?? null, courtNum: g.courtNum ?? null };
          })
          .filter((x): x is { cat: NonNullable<typeof x.cat>; partners: string[]; scheduledAt: string | null; courtNum: number | null } => !!x.cat);
        return (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-start justify-between gap-2">
            <div className="text-sm text-emerald-900 flex-1 min-w-0">
              {intent === "none" && (
                <span>Sign up for <strong>{myTeam.name}</strong> on this match-day.</span>
              )}
              {intent === "playing" && (
                <>
                  <div><strong>You&apos;re signed up to this event</strong> for {myTeam.name}.</div>
                  <div className="mt-2 grid grid-cols-[1fr_2fr] gap-3">
                    <div className="min-w-0">
                      <div className="text-[11px] text-muted mb-0.5">Preferred categories</div>
                      {prefRows.length === 0 ? (
                        <div className="text-[11px] text-muted italic">None picked.</div>
                      ) : (
                        <div className="space-y-0.5">
                          {prefRows.map(({ cat, p }) => {
                            const isPrefer = p!.level === "prefer";
                            return (
                              <div key={cat.id} className={`text-[11px] ${isPrefer ? "text-emerald-700 font-bold" : "text-foreground"}`}>
                                <span>{shortCategoryName(cat.name)}</span>
                                {p!.note && <span className="text-muted font-normal italic"> ({p!.note})</span>}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 border-l border-emerald-200 pl-3">
                      <div className="text-[11px] text-muted mb-0.5 grid grid-cols-[1fr_auto_auto] gap-x-2">
                        <span>Categories you play</span>
                        <span className="text-right w-10">Time</span>
                        <span className="text-right w-8">Court</span>
                      </div>
                      {myGames.length === 0 ? (
                        <div className="text-[11px] text-muted italic">Not picked yet.</div>
                      ) : (
                        <div className="space-y-0.5">
                          {myGames.map(({ cat, partners, scheduledAt, courtNum }) => {
                            const time = scheduledAt
                              ? new Date(scheduledAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                              : "TBD";
                            const court = courtNum != null ? String(courtNum) : "TBD";
                            return (
                              <div key={cat.id} className="grid grid-cols-[1fr_auto_auto] gap-x-2 items-baseline text-[11px]">
                                <span className="truncate">
                                  <span className="text-emerald-700 font-bold">{shortCategoryName(cat.name)}</span>
                                  {partners.length > 0 && (
                                    <span className="text-muted font-normal"> w {partners.join(", ")}</span>
                                  )}
                                </span>
                                <span className="text-right w-10 tabular-nums text-muted font-normal">{time}</span>
                                <span className="text-right w-8 tabular-nums text-muted font-normal">{court}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="text-[10px] text-muted italic mt-1">The captain decides who actually plays each match.</div>
                </>
              )}
              {intent === "attending" && (
                <>
                  <div><strong>You&apos;re coming but not playing</strong> league matches for {myTeam.name}.</div>
                  <div className="text-[11px]">Tap Edit to change your mind and pick categories.</div>
                </>
              )}
              {intent === "unavailable" && (
                <>
                  <div><strong>Marked as not available</strong> for {myTeam.name}.</div>
                  <div className="text-[11px]">Tap Edit to change.</div>
                </>
              )}
            </div>
            <Link href={hasSignedUp ? `/events/${id}/sign-up?edit=1` : `/events/${id}/sign-up`}
              className="bg-action text-white text-sm font-semibold px-3 py-1.5 rounded-lg whitespace-nowrap">
              {hasSignedUp ? "Edit" : "Sign up"}
            </Link>
          </div>
        );
      })()}

      {/* Lineup card — always shown on league events with 2 teams. Shows
          per-team lock status + event-wide reveal status. Captain/vice of
          a playing team additionally gets the "Build lineup" CTA. */}
      {event.round && (event.leagueTeams?.length ?? 0) === 2 && (() => {
        const allLeagueTeams = event.round!.league.teams || [];
        const playingTeamIds = (event.leagueTeams || []).map((et) => et.teamId);
        const myCaptainTeam = userId ? allLeagueTeams
          .filter((t) => playingTeamIds.includes(t.id))
          .find((t) => t.captainId === userId || t.viceCaptainId === userId) : null;
        const eventLocked = !!event.lineupTotalLocked;
        return (
          <div className={`${frameClass} p-3 space-y-2`}>
            <div className="flex items-center justify-between">
              <div className="text-base font-bold">Lineup</div>
              {eventLocked ? (
                <span className="text-sm font-semibold text-emerald-700 flex items-center gap-1">
                  <span className="text-lg leading-none">🔒</span>
                  Locked · revealed
                </span>
              ) : (
                <span className="text-sm text-muted flex items-center gap-1">
                  <span className="text-lg leading-none opacity-40">🔓</span>
                  Hidden until both teams lock
                </span>
              )}
            </div>
            <div className="space-y-1">
              {(event.leagueTeams || []).map((et) => (
                <div key={et.teamId} className="flex items-center justify-between text-xs">
                  <span className="text-foreground">{et.team.name}</span>
                  {et.lineupReady ? (
                    <span className="text-emerald-700 font-medium flex items-center gap-1">
                      <span className="text-[10px] leading-none">🔒</span>
                      Locked
                    </span>
                  ) : (
                    <span className="text-muted flex items-center gap-1">
                      <span className="text-[10px] leading-none opacity-40">🔓</span>
                      Unlocked
                    </span>
                  )}
                </div>
              ))}
            </div>
            {myCaptainTeam && (
              <Link
                href={`/leagues/${event.round!.league.id}/events/${event.id}/lineup/${myCaptainTeam.id}`}
                className="block mt-2 bg-blue-50 border border-blue-200 rounded-lg p-2.5 hover:bg-blue-100"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm text-blue-900">
                    <div><strong>Build lineup</strong> for {myCaptainTeam.name}</div>
                    <div className="text-[11px] text-muted">Tick the matches your team wants to play, then assign players.</div>
                  </div>
                  <span className="text-blue-700 text-lg">→</span>
                </div>
              </Link>
            )}
          </div>
        );
      })()}

      {/* ShareSheet for league events — opened from the header share
          icon (top-right, next to the bell). No dedicated body card;
          the icon in the header is the single, consistent affordance
          for "share invite" across every entity page. */}
      {canManage && event.round && (() => {
        const allLeagueTeams = event.round!.league.teams || [];
        const playingTeamIds = (event.leagueTeams || []).map((et) => et.teamId);
        const playingTeams = allLeagueTeams.filter((t) => playingTeamIds.includes(t.id));
        type TeamLite = { id: string; name: string; players: { playerId: string; player: { id: string; name: string; phone?: string | null; passwordHash?: string | null } }[] };
        const recipients: ShareRecipient[] = [];
        for (const t of playingTeams as TeamLite[]) {
          for (const tp of t.players) {
            recipients.push({
              id: tp.playerId,
              name: tp.player.name,
              phone: tp.player.phone ?? null,
              hasAccount: !!tp.player.passwordHash,
              hint: t.name,
            });
          }
        }
        const origin = typeof window !== "undefined" ? window.location.origin : "";
        const eventUrl = `${origin}/events/${event.id}`;
        const dateStr = new Date(event.date).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
        const timeStr = new Date(event.date).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
        const whenText = `${dateStr} · ${timeStr}`;
        const locationText = event.club?.name || null;
        const roundLbl = event.round!.name || `Round ${event.round!.roundNumber}`;
        const teamNames = playingTeams.map((t) => t.name).join(" vs ");
        const ctx: EventInviteContext = {
          inviterName: session?.user?.name || "Your captain",
          // Round is already on the contextLine — don't repeat it here.
          eventName: teamNames || roundLbl,
          whenText,
          locationText,
          organizerText: ownerName || null,
          eventUrl,
          contextLine: `${leagueShortName(event.round!.league)} · ${roundLbl}`,
        };
        const groupMessage = buildEventInviteGroup(ctx);
        const buildPersonal = (r: ShareRecipient, claimUrl: string) =>
          buildEventInvitePersonal(ctx, { name: r.name, claimUrl });
        return (
          <ShareSheet
            open={shareSheetOpen}
            onClose={() => setShareSheetOpen(false)}
            title="Invite to this match-day"
            blurb="Copy the group message into your WhatsApp group(s). Send each unclaimed player a personal link so they can claim their account."
            groupMessage={groupMessage}
            recipients={recipients}
            buildPersonal={buildPersonal}
          />
        );
      })()}

      {/* Match-day schedule share — open via the trophy glyph in the
          header. Anyone with view access can fire it; payload is the
          court-grouped schedule built by buildMatchDayShare. */}
      <ShareInviteModal
        open={!!scheduleShare}
        message={scheduleShare?.message ?? ""}
        title={scheduleShare?.title || "Share match-day"}
        emailSubject={scheduleShare?.title || "Match-day schedule"}
        onClose={() => setScheduleShare(null)}
      />

      {canManage && managerCard}

      {/* Event Data — name, date, time, status (managers only) */}
      {canManage && (
        <div className={`${frameClass} overflow-hidden`}>
          <div onClick={() => { startEditEvent(); setActiveSection("when"); }} className={rowClass} style={{ cursor: "pointer" }}>
            <span className="text-base font-bold text-foreground">Event Data</span>
            <span className="flex-1 text-right">
              <span className="text-sm font-medium">
                {new Date(event.date).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}
                {" · "}
                {new Date(event.date).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                {event.endDate && (
                  <>
                    {" – "}
                    {new Date(event.endDate).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                  </>
                )}
              </span>
              <span className="block text-[10px] text-muted">
                {eventDisplayLabel(event)}
              </span>
            </span>
            <span className="text-muted/50 self-start mt-0.5 ml-3">{penIcon}</span>
          </div>
        </div>
      )}

      {/* Players & Pairs — relabel "Participants" for league events since
          rosters can include attend-only signups, not just match players.
          Sits above Format because the participant count is the number
          most organizers check first when opening the event. */}
      <div className={`${frameClass} overflow-hidden`}>
        <button onClick={() => setActiveSection("players")} className={rowClass}>
          <span className="text-base font-bold text-foreground">{event.round ? "Participants" : "Players"}</span>
          <span className="text-sm font-medium flex-1 text-right">
            {(() => {
              const males = activePlayers.filter((ep) => ep.player.gender === "M").length;
              const females = activePlayers.filter((ep) => ep.player.gender === "F").length;
              return (
                <>
                  {activePlayers.length}
                  <span className="text-blue-500"> · {males}♂</span>
                  <span className="text-pink-500"> · {females}♀</span>
                  {pausedPlayers.length > 0 ? ` + ${pausedPlayers.length} paused` : ""}
                  {waitlistedPlayers.length > 0 ? ` + ${waitlistedPlayers.length} waitlist` : ""}
                </>
              );
            })()}
          </span>
        </button>
        {/* Per-team attendee breakdown for league events. Counts everyone who
            registered (status registered, including "just attending"). */}
        {event.round && (event.leagueTeams?.length ?? 0) > 0 && (() => {
          const allLeagueTeams = event.round.league.teams || [];
          const playingTeamIds = (event.leagueTeams || []).map((et) => et.teamId);
          const attendingByPlayerId = new Set(
            event.players.filter((p) => p.status !== "unavailable").map((p) => p.player.id),
          );
          const teamCounts = playingTeamIds.map((tid) => {
            const team = (event.leagueTeams || []).find((et) => et.teamId === tid)?.team;
            const fullTeam = allLeagueTeams.find((t) => t.id === tid);
            const count = (fullTeam?.players ?? []).filter((p) => attendingByPlayerId.has(p.playerId)).length;
            return { teamId: tid, name: team?.name ?? "Team", count };
          });
          if (teamCounts.length === 0) return null;
          return (
            <div className="px-3 pt-1 pb-2 flex flex-wrap gap-1.5">
              {teamCounts.map((tc) => (
                <span key={tc.teamId} className="text-[10px] bg-gray-100 px-2 py-0.5 rounded-full font-medium">
                  {tc.name}: <span className="font-bold">{tc.count}</span>
                </span>
              ))}
            </div>
          );
        })()}
        {event.format === "doubles" && event.pairs.length > 0 && (
          <button onClick={() => setActiveSection("pairs")} className={rowClass}>
            <span className="text-base font-bold text-foreground">Pairs</span>
            <span className="text-sm font-medium">
              {`${event.pairs.length} pair${event.pairs.length !== 1 ? "s" : ""}`}
            </span>
          </button>
        )}
      </div>

      {/* Format — managers only. Hidden for league events: format/scoring
          come from the league categories, set per-class. Sits below
          Players because format rarely changes after the event opens. */}
      {canManage && !event.round && (
        <div className={`${frameClass} overflow-hidden`}>
          <div onClick={() => { startEditEvent(); setActiveSection("scoring"); }} className={rowClass} style={{ cursor: "pointer" }}>
            <span className="text-base font-bold text-foreground">Format</span>
            <span className="flex-1 text-right">
              <span className="text-sm font-medium capitalize">{event.format} · {scoringDisplay}</span>
              {event.rankingMode !== "none" && (
                <span className="block text-[10px] text-muted">Ranked — {event.rankingMode === "approval" ? "approval" : "auto"}</span>
              )}
            </span>
            <span className="text-muted/50 self-start mt-0.5 ml-3">{penIcon}</span>
          </div>
        </div>
      )}

      {/* Pairing — managers only. Hidden for league events: pairings are
          driven by the lineup builder, not the auto-pairing engine. */}
      {canManage && !event.round && (
        <div className={`${frameClass} overflow-hidden`}>
          <div onClick={() => router.push(`/events/${id}/pairing`)} className={rowClass} style={{ cursor: "pointer" }}>
            <span className="text-base font-bold text-foreground">Pairing</span>
            <span className="text-sm font-medium flex-1 text-right">{pairingLabel(event.pairingMode)}</span>
            <span className="text-muted/50 self-start mt-0.5 ml-3">›</span>
          </div>
        </div>
      )}

      {/* Matches */}
      <div className={`${frameClass} overflow-hidden`}>
        <button onClick={() => setActiveSection("rounds")} className={rowClass}>
          <span className="text-base font-bold text-foreground flex-1 text-left">Matches</span>
          <span className="text-sm font-medium">
            {event.matches.length === 0
              ? "None"
              : (() => {
                  const completed = event.matches.filter((m) => m.status === "completed").length;
                  const pending = event.matches.filter((m) => m.status === "pending").length;
                  const active = event.matches.filter((m) => m.status === "active").length;
                  const parts = [];
                  if (completed > 0) parts.push(`${completed} played`);
                  if (active > 0) parts.push(`${active} active`);
                  if (pending > 0) parts.push(`${pending} pending`);
                  return parts.join(", ");
                })()}
          </span>
        </button>
      </div>

      {renderScorerTracker()}

      {(isOwner || isAdmin) && (
        <div className="mt-10 pt-4 flex justify-center">
          <button
            type="button"
            onClick={deleteEvent}
            className="text-xs text-danger font-medium hover:underline"
          >
            Delete Event
          </button>
        </div>
      )}
    </div>
  );
}
