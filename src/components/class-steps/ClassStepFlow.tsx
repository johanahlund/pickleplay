"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import useSWR, { mutate as globalMutate } from "swr";
import {
  CompetitionConfig,
  DEFAULT_COMPETITION_CONFIG,
  getBracketStages,
  BRACKET_STAGE_SHORT,
  BRACKET_STAGE_LABELS,
} from "@/lib/competition/types";
import { PlayerAvatar } from "../PlayerAvatar";
import { StepCategory } from "./StepCategory";
import { StepGroups } from "./StepGroups";
import { StepAdvancement } from "./StepAdvancement";
import { StepUpperBracket } from "./StepUpperBracket";
import { StepLowerBracket } from "./StepLowerBracket";
import { StepPlayers } from "./StepPlayers";
import { StepDrawGroups } from "./StepDrawGroups";
import { StepManageBracket } from "./StepManageBracket";

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
  classId?: string | null;
  groupLabel?: string | null;
  seed?: number | null;
}

interface Match {
  id: string;
  courtNum: number;
  round: number;
  status: string;
  classId?: string | null;
  groupLabel?: string | null;
  bracketStage?: string | null;
  bracketPosition?: number | null;
  matchFormat?: string | null;
  players: {
    id: string;
    playerId: string;
    team: number;
    score: number;
    player: PairPlayer;
  }[];
}

interface EventClassData {
  id: string;
  name: string;
  isDefault: boolean;
  format: string;
  gender: string;
  ageGroup: string;
  skillMin?: number | null;
  skillMax?: number | null;
  scoringFormat: string;
  winBy?: string;
  pairingMode: string;
  playMode?: string;
  rankingMode: string;
  minPlayers?: number | null;
  maxPlayers?: number | null;
  belowMinAction?: string | null;
  mergeWithClassId?: string | null;
  competitionMode?: string | null;
  competitionConfig?: Record<string, unknown> | null;
  competitionPhase?: string | null;
  upperBracketMergeClassId?: string | null;
  lowerBracketMergeClassId?: string | null;
}

interface ClassStepFlowProps {
  eventId: string;
  eventName: string;
  eventDate: string;
  cls: EventClassData;
  allClasses: EventClassData[];
  pairs: EventPair[];
  matches: Match[];
  canManage: boolean;
  numCourts: number;
  onBack: () => void;
  onRefresh: () => void;
}

interface StepDef {
  id: string;
  label: string;
  shortLabel: string;
  type: "config" | "action";
}

/** Inline player/pair view for non-admin users in class overview */
function ClassPlayersInline({ eventId, classId, format, classGender, userId }: {
  eventId: string;
  classId: string;
  format: string;
  classGender: string;
  userId?: string | null;
}) {
  const { data: eventData } = useSWR(`/api/events/${eventId}`, (url: string) => fetch(url).then((r) => r.ok ? r.json() : null), { revalidateOnFocus: true, dedupingInterval: 2000 });
  const { data: reqData } = useSWR(
    format === "doubles" ? `/api/events/${eventId}/classes/${classId}/pair-request` : null,
    (url: string) => fetch(url).then((r) => r.ok ? r.json() : []),
    { revalidateOnFocus: true }
  );

  const players: { playerId: string; player: PairPlayer }[] = (eventData?.players || []).filter((ep: { classId?: string }) => ep.classId === classId);
  const pairs: { id: string; player1: PairPlayer; player2: PairPlayer; player1Id: string; player2Id: string }[] = (eventData?.pairs || []).filter((p: { classId?: string }) => p.classId === classId);
  const pairRequests: { id: string; requesterId: string; requestedId: string; status: string }[] = reqData || [];
  const loading = !eventData;

  if (loading) return <div className="p-3 text-xs text-muted">Loading...</div>;

  const pairedIds = new Set(pairs.flatMap((p) => [p.player1Id, p.player2Id]));
  const unpaired = players.filter((ep) => !pairedIds.has(ep.playerId));
  const males = unpaired.filter((ep) => ep.player.gender === "M");
  const females = unpaired.filter((ep) => ep.player.gender === "F");
  const other = unpaired.filter((ep) => ep.player.gender !== "M" && ep.player.gender !== "F");
  const isDoubles = format === "doubles";

  const isMix = format === "doubles"; // show 2-col for all doubles

  // Check if user can request this player
  const myOutgoing = pairRequests.find((r) => r.requesterId === userId && r.status === "pending");
  const myIncoming = pairRequests.filter((r) => r.requestedId === userId && r.status === "pending");
  const userIsPaired = userId ? pairedIds.has(userId) : true;
  const userGender = userId ? players.find((p) => p.playerId === userId)?.player.gender : null;

  const sendRequest = async (partnerId: string) => {
    await fetch(`/api/events/${eventId}/classes/${classId}/pair-request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "request", partnerId }),
    });
    globalMutate(`/api/events/${eventId}/classes/${classId}/pair-request`);
  };

  const respondRequest = async (requestId: string, action: "accept" | "decline") => {
    await fetch(`/api/events/${eventId}/classes/${classId}/pair-request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, requestId }),
    });
    globalMutate(`/api/events/${eventId}/classes/${classId}/pair-request`);
    globalMutate(`/api/events/${eventId}`);
  };

  const cancelRequest = async (requestId: string) => {
    await fetch(`/api/events/${eventId}/classes/${classId}/pair-request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "cancel", requestId }),
    });
    globalMutate(`/api/events/${eventId}/classes/${classId}/pair-request`);
  };

  const PlayerCard = ({ player, playerId, isMe }: { player: PairPlayer; playerId: string; isMe?: boolean }) => {
    const incomingFromThem = myIncoming.find((r) => r.requesterId === playerId);
    const iSentToThem = myOutgoing?.requestedId === playerId;
    const canRequest = !userIsPaired && !isMe && !myOutgoing && userId;
    // For mix class: only request opposite gender
    const genderOk = classGender !== "mix" || !userGender || !player.gender || userGender !== player.gender;

    return (
    <div className="flex items-center gap-1.5 min-w-0 py-0.5">
      <PlayerAvatar name={player.name} size="xs" />
      <div className="min-w-0 flex-1">
        <div className={`text-xs font-medium truncate ${isMe ? "text-action" : ""}`}>{player.name}</div>
        <div className="text-[9px] text-muted">{Math.round(player.rating)}</div>
      </div>
      {!isMe && incomingFromThem && (
        <div className="flex gap-1 shrink-0">
          <button onClick={() => respondRequest(incomingFromThem.id, "accept")} className="text-[9px] bg-green-600 text-white px-1.5 py-0.5 rounded">Accept</button>
          <button onClick={() => respondRequest(incomingFromThem.id, "decline")} className="text-[9px] text-danger px-1 py-0.5 rounded hover:bg-red-50">✕</button>
        </div>
      )}
      {!isMe && iSentToThem && (
        <button onClick={() => cancelRequest(myOutgoing!.id)} className="text-[9px] text-muted px-1.5 py-0.5 rounded hover:bg-gray-100 shrink-0">Pending ✕</button>
      )}
      {canRequest && genderOk && !incomingFromThem && !iSentToThem && (
        <button onClick={() => sendRequest(playerId)} className="text-[9px] text-action px-1.5 py-0.5 rounded hover:bg-action/10 shrink-0">🤝</button>
      )}
    </div>
    );
  };

  // Sort pairs: user's pair first
  const sortedPairs = [...pairs].sort((a, b) => {
    const aIsMe = userId && (a.player1Id === userId || a.player2Id === userId) ? 0 : 1;
    const bIsMe = userId && (b.player1Id === userId || b.player2Id === userId) ? 0 : 1;
    return aIsMe - bIsMe;
  });

  return (
    <div className="p-3 space-y-3">
      {/* Pairs — 2 columns: left player | right player */}
      {isDoubles && pairs.length > 0 && (
        <div>
          <div className="text-[10px] text-muted uppercase tracking-wider font-medium mb-1.5">Pairs ({pairs.length})</div>
          <div className="space-y-1">
            {sortedPairs.map((pair) => {
              const isMyPair = userId && (pair.player1Id === userId || pair.player2Id === userId);
              const sameGender =
                (classGender === "mix" && pair.player1.gender && pair.player2.gender && pair.player1.gender === pair.player2.gender) ||
                (classGender === "male" && (pair.player1.gender === "F" || pair.player2.gender === "F")) ||
                (classGender === "female" && (pair.player1.gender === "M" || pair.player2.gender === "M"));
              // For mixed: female left, male right
              const p1Female = pair.player1.gender === "F";
              const left = p1Female ? pair.player1 : pair.player2;
              const right = p1Female ? pair.player2 : pair.player1;
              const leftId = p1Female ? pair.player1Id : pair.player2Id;
              const rightId = p1Female ? pair.player2Id : pair.player1Id;
              return (
                <div key={pair.id} className={`py-1.5 px-2 rounded-lg ${sameGender ? "bg-amber-50 border border-amber-200" : isMyPair ? "bg-action/5 border border-action/20" : "bg-gray-50"}`}>
                  <div className="flex items-center gap-2">
                    <div className="flex-1"><PlayerCard player={left} playerId={leftId} isMe={leftId === userId} /></div>
                    <span className="text-[9px] text-muted">&</span>
                    <div className="flex-1"><PlayerCard player={right} playerId={rightId} isMe={rightId === userId} /></div>
                  </div>
                  {isMyPair && (() => {
                    const myReq = pairRequests.find((r) => r.status === "accepted" && (r.requesterId === userId || r.requestedId === userId));
                    return myReq ? (
                      <div className="text-right mt-1">
                        <button onClick={async () => {
                          if (!confirm("Unpair?")) return;
                          if (!confirm("Are you really sure? You will need to find a new partner.")) return;
                          const r = await fetch(`/api/events/${eventId}/classes/${classId}/pair-request`, {
                            method: "POST", headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ action: "unpair", requestId: myReq.id }),
                          });
                          if (r.ok) { globalMutate(`/api/events/${eventId}`); }
                          else { const d = await r.json().catch(() => ({})); alert(d.error || "Cannot unpair"); }
                        }} className="text-[10px] text-danger hover:underline">Unpair</button>
                      </div>
                    ) : null;
                  })()}
                  {sameGender && <div className="text-[10px] text-amber-600 mt-1">Gender mismatch</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Looking for partner — 2 columns */}
      {isDoubles && unpaired.length > 0 && (
        <div>
          <div className="text-[10px] text-muted uppercase tracking-wider font-medium mb-1.5">Looking for partner ({unpaired.length})</div>
          <div className="flex">
            <div className="flex-1 space-y-1 pr-2">
              <div className="text-[9px] text-pink-500 font-medium mb-0.5">♀ ({females.length})</div>
              {females.map((ep) => <PlayerCard key={ep.playerId} player={ep.player} playerId={ep.playerId} isMe={ep.playerId === userId} />)}
              {females.length === 0 && <div className="text-[10px] text-muted">—</div>}
            </div>
            <div className="w-px border-l border-dashed border-gray-300" />
            <div className="flex-1 space-y-1 pl-2">
              <div className="text-[9px] text-blue-500 font-medium mb-0.5">♂ ({males.length})</div>
              {males.map((ep) => <PlayerCard key={ep.playerId} player={ep.player} playerId={ep.playerId} isMe={ep.playerId === userId} />)}
              {males.length === 0 && <div className="text-[10px] text-muted">—</div>}
            </div>
          </div>
          {other.length > 0 && (
            <div className="mt-1 space-y-1">
              {other.map((ep) => <PlayerCard key={ep.playerId} player={ep.player} playerId={ep.playerId} isMe={ep.playerId === userId} />)}
            </div>
          )}
        </div>
      )}

      {/* Singles player list */}
      {!isDoubles && players.length > 0 && (
        <div className="space-y-1">
          {[...females, ...males, ...other].map((ep) => (
            <PlayerCard key={ep.playerId} player={ep.player} playerId={ep.playerId} isMe={ep.playerId === userId} />
          ))}
        </div>
      )}

      {/* Incoming requests banner (if user has pending incoming) */}
      {isDoubles && !userIsPaired && myIncoming.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-xs text-amber-800">
          {myIncoming.length} partner request{myIncoming.length > 1 ? "s" : ""} — see 🤝 above to accept
        </div>
      )}
    </div>
  );
}

export function ClassStepFlow({
  eventId, eventName, eventDate, cls: propsCls, allClasses, pairs, matches, canManage, numCourts, onBack, onRefresh,
}: ClassStepFlowProps) {
  const { data: session } = useSession();
  const userId = (session?.user as { id?: string } | undefined)?.id;

  // Optimistic state: local overrides applied instantly before API responds
  const [fieldOverrides, setFieldOverrides] = useState<Record<string, unknown>>({});
  const [configOverrides, setConfigOverrides] = useState<Partial<CompetitionConfig>>({});

  // Merge optimistic overrides into cls
  const cls: EventClassData = { ...propsCls, ...fieldOverrides } as EventClassData;

  // Reset overrides when props change (API refresh arrived)
  useEffect(() => {
    setFieldOverrides({});
    setConfigOverrides({});
  }, [propsCls]);

  const baseConfig: CompetitionConfig = cls.competitionConfig
    ? { ...DEFAULT_COMPETITION_CONFIG, ...(cls.competitionConfig as unknown as Partial<CompetitionConfig>) }
    : DEFAULT_COMPETITION_CONFIG;
  const config: CompetitionConfig = { ...baseConfig, ...configOverrides };

  const hasUpperBracket = config.advanceToUpper > 0;
  const hasLowerBracket = config.advanceToLower > 0;

  // Build dynamic step list
  const steps: StepDef[] = [
    { id: "category", label: "Category", shortLabel: "Cat", type: "config" },
    { id: "groups", label: "Group Setup", shortLabel: "Grps", type: "config" },
    { id: "advancement", label: "Advancement", shortLabel: "Adv", type: "config" },
    { id: "upper-config", label: "Main Bracket", shortLabel: "Main", type: "config" },
    ...(hasLowerBracket ? [{ id: "lower-config", label: "Consolation", shortLabel: "Cons", type: "config" as const }] : []),
    { id: "players", label: "Players", shortLabel: "Players", type: "config" },
    { id: "draw-groups", label: "Draw Groups", shortLabel: "Draw", type: "action" },
    { id: "manage-upper", label: "Main Bracket", shortLabel: "Main", type: "action" },
    ...(hasLowerBracket ? [{ id: "manage-lower", label: "Consolation", shortLabel: "Cons", type: "action" as const }] : []),
  ];

  // -1 = overview, 0+ = steps
  const [currentStepIdx, setCurrentStepIdx] = useState(-1);
  const isOverview = currentStepIdx === -1;
  const currentStep = isOverview ? null : (steps[currentStepIdx] || steps[0]);

  // Auto-enable competition mode if not set
  useEffect(() => {
    if (!propsCls.competitionMode && canManage) {
      fetch(`/api/events/${eventId}/competition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "enable", classId: propsCls.id }),
      }).then(() => onRefresh());
    }
  }, [propsCls.competitionMode, propsCls.id, eventId, canManage, onRefresh]);

  // Filter pairs and matches to this class
  const classPairs = pairs.filter((p) => !p.classId || p.classId === cls.id);
  const classMatches = matches.filter((m) => !m.classId || m.classId === cls.id);

  const updateField = useCallback((field: string, value: unknown) => {
    // Optimistic: update local state instantly
    setFieldOverrides((prev) => ({ ...prev, [field]: value }));
    // Fire API in background
    fetch(`/api/events/${eventId}/classes`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classId: propsCls.id, [field]: value }),
    }).then(() => onRefresh());
  }, [eventId, propsCls.id, onRefresh]);

  const updateConfig = useCallback((partial: Partial<CompetitionConfig>) => {
    // Optimistic: merge into local config instantly
    setConfigOverrides((prev) => ({ ...prev, ...partial }));
    // Fire API in background
    fetch(`/api/events/${eventId}/competition`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update_config", config: partial, classId: propsCls.id }),
    }).then(() => onRefresh());
  }, [eventId, propsCls.id, onRefresh]);

  const PHASE_LABELS: Record<string, string> = {
    draft: "Draft", open: "Open", closed: "Closed", groups: "Group", bracket: "Bracket", bracket_upper: "Bracket", bracket_lower: "Bracket", completed: "Completed",
  };

  const renderStep = () => {
    if (!currentStep) return null;
    switch (currentStep.id) {
      case "category":
        return <StepCategory cls={cls} canManage={canManage} updateField={updateField} />;
      case "groups":
        return <StepGroups config={config} cls={cls} maxTeams={cls.maxPlayers ?? null} registeredTeams={classPairs.length} canManage={canManage} updateField={updateField} updateConfig={updateConfig} />;
      case "advancement":
        return <StepAdvancement config={config} canManage={canManage} updateConfig={updateConfig} />;
      case "upper-config":
        return <StepUpperBracket config={config} canManage={canManage} updateConfig={updateConfig} />;
      case "lower-config":
        return <StepLowerBracket config={config} canManage={canManage} updateConfig={updateConfig} />;
      case "players":
        return (
          <StepPlayers
            eventId={eventId}
            cls={cls}
            canManage={canManage}
            onRefresh={onRefresh}
          />
        );
      case "draw-groups":
        return (
          <StepDrawGroups
            eventId={eventId}
            classId={cls.id}
            config={config}
            pairs={classPairs as never}
            matches={classMatches as never}
            canManage={canManage}
            numCourts={numCourts}
            onRefresh={onRefresh}
          />
        );
      case "manage-upper":
        return <StepManageBracket bracket="upper" matches={classMatches as never} numCourts={numCourts} />;
      case "manage-lower":
        return <StepManageBracket bracket="lower" matches={classMatches as never} numCourts={numCourts} />;
      default:
        return null;
    }
  };

  const rowClass = "flex justify-between items-center py-2.5 px-3 border-b border-border last:border-b-0 hover:bg-gray-50 active:bg-gray-100 cursor-pointer transition-colors w-full";
  const rowStaticClass = "flex justify-between items-center py-2.5 px-3 border-b border-border last:border-b-0 w-full";
  const frameClass = "bg-card rounded-xl border border-border overflow-hidden";
  const frameTitleClass = "text-[10px] text-muted px-3 pt-2 pb-1 uppercase tracking-wider font-medium";

  const groupMatches = classMatches.filter((m) => m.groupLabel);
  const bracketMatches = classMatches.filter((m) => m.bracketStage);

  // Player gender counts from pairs
  const allPairPlayers = classPairs.flatMap((p) => [p.player1, p.player2]);
  const maleCount = allPairPlayers.filter((p) => p.gender === "M").length;
  const femaleCount = allPairPlayers.filter((p) => p.gender === "F").length;
  const totalPlayers = allPairPlayers.length;

  const [showPlayersExpand, setShowPlayersExpand] = useState(false);
  const [showGroupsExpand, setShowGroupsExpand] = useState(false);
  const [showUpperExpand, setShowUpperExpand] = useState(false);
  const [showLowerExpand, setShowLowerExpand] = useState(false);

  // Row helper: clickable for admins, static for others
  const AdminRow = ({ stepId, label, children }: { stepId: string; label: string; children: React.ReactNode }) =>
    canManage ? (
      <button onClick={() => setCurrentStepIdx(steps.findIndex((s) => s.id === stepId))} className={rowClass}>
        <span className="text-sm text-muted shrink-0">{label}</span>
        {children}
      </button>
    ) : (
      <div className={rowStaticClass}>
        <span className="text-sm text-muted shrink-0">{label}</span>
        {children}
      </div>
    );

  const renderOverview = () => (
    <div className="space-y-3">
      {/* Category summary */}
      <div className={frameClass}>
        <AdminRow stepId="category" label="Status">
          <span className="text-sm font-medium">{PHASE_LABELS[cls.competitionPhase || "open"] || "Setup"}</span>
        </AdminRow>
        <AdminRow stepId="category" label="Format">
          <span className="text-sm font-medium capitalize">
            {[
              cls.ageGroup !== "open" ? cls.ageGroup : null,
              cls.skillMin ? cls.skillMin.toFixed(1) : null,
              cls.gender === "open" ? "Any Gender" : cls.gender,
              cls.format,
            ].filter(Boolean).join(" · ")}
          </span>
        </AdminRow>
      </div>

      {/* Groups & Advancement */}
      <div className={frameClass}>
        <AdminRow stepId="groups" label="Group Stage">
          <span className="text-right">
            {(() => {
              const n = config.numGroups;
              const phase = cls.competitionPhase || "draft";
              const isClosed = ["closed", "groups", "bracket", "bracket_upper", "bracket_lower", "completed"].includes(phase);
              const registered = classPairs.length;
              const total = isClosed ? registered : (cls.maxPlayers || registered);
              const teamLabel = isClosed ? `${total} teams` : total > 0 ? `if ${total} teams` : "";
              // Group sizes
              const groupNames = "ABCDEFGHIJ";
              let groupLine = "";
              if (total > 0) {
                const base = Math.floor(total / n);
                const rem = total % n;
                const parts = Array.from({ length: n }, (_, i) => `${groupNames[i]} (${base + (i < rem ? 1 : 0)})`);
                groupLine = parts.join(", ");
              }
              // Scoring
              const sf = cls.scoringFormat || "1x11";
              const sets = sf.startsWith("3") ? "best of 3" : "1 set";
              const isRally = sf.includes("R");
              const pts = sf.replace(/^[13]x/, "").replace("R", "");
              const scoring = `${sets}${isRally ? " rally" : ""} to ${pts}`;
              const wb = cls.winBy || "2";
              const winBy = wb === "1" ? ", win by 1" : wb === "2" ? "" : `, cap ${wb.replace("cap", "")}`;
              const freq = config.matchesPerMatchup === 1 ? "1 match" : "2 matches";
              return (
                <>
                  <span className="text-sm font-medium block">{n} Groups {teamLabel ? `(${teamLabel})` : ""}</span>
                  {groupLine && <span className="text-xs text-muted block">{groupLine}</span>}
                  <span className="text-xs text-muted block">{freq} with {scoring}{winBy}</span>
                </>
              );
            })()}
          </span>
        </AdminRow>
        {hasUpperBracket && (() => {
          const n = config.advanceToUpper;
          const posDesc = n === 1 ? "N° 1" : `N° 1-${n}`;
          const wcDesc = config.wildcardCount > 0 ? ` + ${config.wildcardCount} WC` : "";
          const upperTeams = config.numGroups * n + config.wildcardCount;
          const stages = getBracketStages(upperTeams);
          const fmtShort = (fmt: string | undefined) => {
            if (!fmt || fmt === "to_11") return "1-11";
            if (fmt === "to_15") return "1-15";
            if (fmt === "to_21") return "1-21";
            if (fmt === "bo3_11") return "3-11";
            if (fmt === "bo3_15") return "3-15";
            if (fmt === "bo3_21") return "3-21";
            return fmt;
          };
          const roundParts = stages.map((s) => `${BRACKET_STAGE_SHORT[s] || s} (${fmtShort(config.upperBracketFormats[s])})`);
          if (config.upperThirdPlace) {
            // 3rd place uses same format as semifinal, or last stage format
            const sfFmt = config.upperBracketFormats["sf"] || config.upperBracketFormats[stages[stages.length - 1]];
            roundParts.push(`3rd (${fmtShort(sfFmt)})`);
          }
          return (
            <AdminRow stepId="advancement" label="Main Bracket">
              <span className="text-right">
                <span className="text-sm font-medium block">{posDesc} per group{wcDesc}</span>
                <span className="text-xs text-muted block">{roundParts.join(", ")}</span>
              </span>
            </AdminRow>
          );
        })()}
        {!hasUpperBracket && (
          <AdminRow stepId="advancement" label="Main Bracket">
            <span className="text-sm font-medium text-muted">No bracket rounds</span>
          </AdminRow>
        )}
        {hasLowerBracket && (() => {
          const lower = config.advanceToLower;
          const upperN = config.advanceToUpper;
          const posStart = upperN + 1;
          const posEnd = upperN + lower;
          const posDesc = lower === 1 ? `N° ${posStart}` : `N° ${posStart}-${posEnd}`;
          const lowerTeams = config.numGroups * lower;
          const stages = getBracketStages(lowerTeams);
          const fmtShort = (fmt: string | undefined) => {
            if (!fmt || fmt === "to_11") return "1-11";
            if (fmt === "to_15") return "1-15";
            if (fmt === "to_21") return "1-21";
            if (fmt === "bo3_11") return "3-11";
            if (fmt === "bo3_15") return "3-15";
            if (fmt === "bo3_21") return "3-21";
            return fmt;
          };
          const roundParts = stages.map((s) => `${BRACKET_STAGE_SHORT[s] || s} (${fmtShort(config.lowerBracketFormats[s])})`);
          if (config.lowerThirdPlace) {
            const sfFmt = config.lowerBracketFormats["sf"] || config.lowerBracketFormats[stages[stages.length - 1]];
            roundParts.push(`3rd (${fmtShort(sfFmt)})`);
          }
          return (
            <AdminRow stepId="lower-config" label="Consolation">
              <span className="text-right">
                <span className="text-sm font-medium block">{posDesc} per group</span>
                <span className="text-xs text-muted block">{roundParts.join(", ")}</span>
              </span>
            </AdminRow>
          );
        })()}
      </div>

      {/* Players & Matches */}
      <div className={frameClass}>
        <button onClick={() => canManage ? setCurrentStepIdx(steps.findIndex((s) => s.id === "players")) : setShowPlayersExpand(!showPlayersExpand)} className={rowClass}>
          <span className="text-sm text-muted shrink-0">{cls.format === "doubles" ? (cls.gender === "mix" ? "Player Pairs" : "Players") : "Players"}</span>
          <span className="text-sm font-medium flex-1 text-right">
            {totalPlayers > 0 ? (
              <>
                {maleCount > 0 && <span className="text-blue-500">♂ {maleCount}{cls.maxPlayers ? `/${cls.maxPlayers}` : ""}</span>}
                {maleCount > 0 && femaleCount > 0 && <span className="text-muted mx-1">·</span>}
                {femaleCount > 0 && <span className="text-pink-500">♀ {femaleCount}{cls.maxPlayers ? `/${cls.maxPlayers}` : ""}</span>}
              </>
            ) : (
              <span className="text-muted">None yet</span>
            )}
          </span>
          {!canManage && <span className={`text-muted text-xs ml-1 transition-transform ${showPlayersExpand ? "rotate-90" : ""}`}>›</span>}
        </button>
        {/* Expanded player view for non-admins */}
        {showPlayersExpand && !canManage && (
          <div className="border-t border-border">
            <ClassPlayersInline eventId={eventId} classId={cls.id} format={cls.format} classGender={cls.gender} userId={userId} />
          </div>
        )}
        {canManage ? (
          <>
            <button onClick={() => setCurrentStepIdx(steps.findIndex((s) => s.id === "draw-groups"))} className={rowClass}>
              <span className="text-sm text-muted">Group Matches</span>
              <span className="text-sm font-medium">
                {groupMatches.length === 0 ? "Not started" : `${groupMatches.filter((m) => m.status === "completed").length}/${groupMatches.length} played`}
              </span>
            </button>
            <button onClick={() => setCurrentStepIdx(steps.findIndex((s) => s.id === "manage-upper"))} className={rowClass}>
              <span className="text-sm text-muted">Main Bracket</span>
              <span className="text-sm font-medium">
                {bracketMatches.filter((m) => m.bracketStage?.startsWith("upper_")).length === 0 ? "Not started" : `${bracketMatches.filter((m) => m.bracketStage?.startsWith("upper_") && m.status === "completed").length}/${bracketMatches.filter((m) => m.bracketStage?.startsWith("upper_")).length} played`}
              </span>
            </button>
            {hasLowerBracket && (
              <button onClick={() => setCurrentStepIdx(steps.findIndex((s) => s.id === "manage-lower"))} className={rowClass}>
                <span className="text-sm text-muted">Consolation</span>
                <span className="text-sm font-medium">
                  {bracketMatches.filter((m) => m.bracketStage?.startsWith("lower_")).length === 0 ? "Not started" : `${bracketMatches.filter((m) => m.bracketStage?.startsWith("lower_") && m.status === "completed").length}/${bracketMatches.filter((m) => m.bracketStage?.startsWith("lower_")).length} played`}
                </span>
              </button>
            )}
          </>
        ) : (
          <>
            {groupMatches.length > 0 && (
              <>
                <button onClick={() => setShowGroupsExpand(!showGroupsExpand)} className={rowClass}>
                  <span className="text-sm text-muted">Group Matches</span>
                  <span className="text-sm font-medium flex-1 text-right">
                    {`${groupMatches.filter((m) => m.status === "completed").length}/${groupMatches.length} played`}
                  </span>
                  <span className={`text-muted text-xs ml-1 transition-transform ${showGroupsExpand ? "rotate-90" : ""}`}>›</span>
                </button>
                {showGroupsExpand && (
                  <div className="border-t border-border p-3 text-xs text-muted">Group standings and matches coming soon</div>
                )}
              </>
            )}
            {bracketMatches.filter((m) => m.bracketStage?.startsWith("upper_")).length > 0 && (
              <>
                <button onClick={() => setShowUpperExpand(!showUpperExpand)} className={rowClass}>
                  <span className="text-sm text-muted">Main Bracket</span>
                  <span className="text-sm font-medium flex-1 text-right">
                    {`${bracketMatches.filter((m) => m.bracketStage?.startsWith("upper_") && m.status === "completed").length}/${bracketMatches.filter((m) => m.bracketStage?.startsWith("upper_")).length} played`}
                  </span>
                  <span className={`text-muted text-xs ml-1 transition-transform ${showUpperExpand ? "rotate-90" : ""}`}>›</span>
                </button>
                {showUpperExpand && (
                  <div className="border-t border-border p-3 text-xs text-muted">Bracket matches coming soon</div>
                )}
              </>
            )}
            {hasLowerBracket && bracketMatches.filter((m) => m.bracketStage?.startsWith("lower_")).length > 0 && (
              <>
                <button onClick={() => setShowLowerExpand(!showLowerExpand)} className={rowClass}>
                  <span className="text-sm text-muted">Consolation</span>
                  <span className="text-sm font-medium flex-1 text-right">
                    {`${bracketMatches.filter((m) => m.bracketStage?.startsWith("lower_") && m.status === "completed").length}/${bracketMatches.filter((m) => m.bracketStage?.startsWith("lower_")).length} played`}
                  </span>
                  <span className={`text-muted text-xs ml-1 transition-transform ${showLowerExpand ? "rotate-90" : ""}`}>›</span>
                </button>
                {showLowerExpand && (
                  <div className="border-t border-border p-3 text-xs text-muted">Consolation matches coming soon</div>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* Delete class */}
      {canManage && !cls.isDefault && (
        <button onClick={() => {
          if (confirm(`Delete class "${cls.name}"? Players and matches in this class will be unlinked.`)) {
            fetch(`/api/events/${eventId}/classes`, {
              method: "DELETE",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ classId: cls.id }),
            }).then(() => { onRefresh(); onBack(); });
          }
        }}
          className="w-full py-2.5 text-xs text-danger font-medium rounded-xl border border-red-200 hover:bg-red-50">
          Delete Class
        </button>
      )}
    </div>
  );

  return (
    <div className="space-y-3">
      {/* Step bar — only for admins, hidden on overview */}
      {!isOverview && canManage && (
        <div className="sticky z-30 bg-background pb-2 -mx-4 px-4 pt-1 shadow-sm" style={{ top: "var(--header-height, 0px)" }}>
          <div className="text-center pb-1">
            <span className="text-xs font-semibold">{eventName}</span>
            <span className="text-[10px] text-muted ml-1.5">
              {new Date(eventDate).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}
              {" "}
              {new Date(eventDate).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
          <div className="flex gap-0.5">
            {steps.map((step, i) => (
              <button key={step.id} className="flex-1 text-center min-w-0" onClick={() => setCurrentStepIdx(i)}>
                <div className={`h-1 rounded-full transition-all duration-300 ${
                  i === currentStepIdx ? "bg-action" :
                  step.type === "action" ? "bg-green-200" : "bg-gray-200"
                }`} />
                <span className={`text-[7px] leading-tight mt-0.5 block truncate ${
                  i === currentStepIdx ? "text-action font-bold" : "text-foreground/50"
                }`}>
                  {step.shortLabel}
                </span>
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between mt-1.5">
            <span className="w-16" />
            <span className="text-sm font-bold text-foreground">{currentStep?.label}</span>
            <button onClick={() => setCurrentStepIdx(-1)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-action text-action active:bg-action/10 shrink-0 leading-tight text-center">
              Class<br/>Overview
            </button>
          </div>
        </div>
      )}

      {/* Class name header */}
      {isOverview ? (
        <div>
          <div className="flex items-center justify-between">
            <button onClick={onBack} className="text-xs text-action font-medium shrink-0">← Event</button>
            <span className="text-[10px] text-muted">
              {eventName} · {new Date(eventDate).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
              {" "}
              {new Date(eventDate).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
            </span>
            <span className="w-12" />
          </div>
          <h3 className="text-base font-bold text-center mt-1">{cls.name}</h3>
        </div>
      ) : (
        <h3 className="text-base font-bold">{cls.name}</h3>
      )}

      {/* Step content or overview */}
      {isOverview ? renderOverview() : renderStep()}
    </div>
  );
}
