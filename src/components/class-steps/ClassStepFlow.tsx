"use client";

import { useState, useEffect, useCallback } from "react";
import {
  CompetitionConfig,
  DEFAULT_COMPETITION_CONFIG,
  getBracketStages,
  BRACKET_STAGE_SHORT,
  BRACKET_STAGE_LABELS,
} from "@/lib/competition/types";
import { PlayerAvatar } from "../PlayerAvatar";
import { PairRequests } from "../PairRequests";
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
function ClassPlayersInline({ eventId, classId, format, pairs }: {
  eventId: string;
  classId: string;
  format: string;
  pairs: { id: string; player1: PairPlayer; player2: PairPlayer; player1Id: string; player2Id: string }[];
}) {
  const [players, setPlayers] = useState<{ playerId: string; player: PairPlayer }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/events/${eventId}`).then((r) => r.ok ? r.json() : null).then((data) => {
      if (data) setPlayers((data.players || []).filter((ep: { classId?: string }) => ep.classId === classId));
      setLoading(false);
    });
  }, [eventId, classId]);

  if (loading) return <div className="p-3 text-xs text-muted">Loading...</div>;

  const pairedIds = new Set(pairs.flatMap((p) => [p.player1Id, p.player2Id]));
  const unpaired = players.filter((ep) => !pairedIds.has(ep.playerId));
  const males = unpaired.filter((ep) => ep.player.gender === "M");
  const females = unpaired.filter((ep) => ep.player.gender === "F");
  const other = unpaired.filter((ep) => ep.player.gender !== "M" && ep.player.gender !== "F");
  const isDoubles = format === "doubles";

  return (
    <div className="p-3 space-y-3">
      {/* Existing pairs */}
      {isDoubles && pairs.length > 0 && (
        <div>
          <div className="text-[10px] text-muted uppercase tracking-wider font-medium mb-1">Pairs ({pairs.length})</div>
          <div className="space-y-1">
            {pairs.map((pair) => (
              <div key={pair.id} className="flex items-center gap-2 py-1">
                <div className="flex -space-x-1"><PlayerAvatar name={pair.player1.name} size="xs" /><PlayerAvatar name={pair.player2.name} size="xs" /></div>
                <span className="text-xs font-medium">{pair.player1.name} & {pair.player2.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Available players by gender */}
      {unpaired.length > 0 && (
        <div>
          <div className="text-[10px] text-muted uppercase tracking-wider font-medium mb-1">
            {isDoubles ? "Looking for partner" : "Players"} ({unpaired.length})
          </div>
          {males.length > 0 && (
            <div className="mb-1">
              <span className="text-[9px] text-blue-500 font-medium">♂ Male ({males.length})</span>
              <div className="flex flex-wrap gap-1 mt-0.5">
                {males.map((ep) => (
                  <div key={ep.playerId} className="flex items-center gap-1 bg-blue-50 rounded-lg px-2 py-1">
                    <PlayerAvatar name={ep.player.name} size="xs" />
                    <span className="text-xs">{ep.player.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {females.length > 0 && (
            <div className="mb-1">
              <span className="text-[9px] text-pink-500 font-medium">♀ Female ({females.length})</span>
              <div className="flex flex-wrap gap-1 mt-0.5">
                {females.map((ep) => (
                  <div key={ep.playerId} className="flex items-center gap-1 bg-pink-50 rounded-lg px-2 py-1">
                    <PlayerAvatar name={ep.player.name} size="xs" />
                    <span className="text-xs">{ep.player.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {other.length > 0 && (
            <div>
              <div className="flex flex-wrap gap-1">
                {other.map((ep) => (
                  <div key={ep.playerId} className="flex items-center gap-1 bg-gray-50 rounded-lg px-2 py-1">
                    <PlayerAvatar name={ep.player.name} size="xs" />
                    <span className="text-xs">{ep.player.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Pair requests */}
      {isDoubles && players.length > 0 && (
        <PairRequests
          eventId={eventId}
          classId={classId}
          format={format}
          players={players.map((p) => ({ playerId: p.playerId, player: { id: p.player.id, name: p.player.name, emoji: p.player.emoji || "" } }))}
          existingPairPlayerIds={pairedIds}
          canManage={false}
          onPairCreated={() => {}}
        />
      )}
    </div>
  );
}

export function ClassStepFlow({
  eventId, cls: propsCls, allClasses, pairs, matches, canManage, numCourts, onBack, onRefresh,
}: ClassStepFlowProps) {
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
    { id: "upper-config", label: "Upper Bracket", shortLabel: "Upper", type: "config" },
    ...(hasLowerBracket ? [{ id: "lower-config", label: "Lower Bracket", shortLabel: "Lower", type: "config" as const }] : []),
    { id: "players", label: "Players", shortLabel: "Players", type: "config" },
    { id: "draw-groups", label: "Draw Groups", shortLabel: "Draw", type: "action" },
    { id: "manage-upper", label: "Upper Bracket", shortLabel: "Upper", type: "action" },
    ...(hasLowerBracket ? [{ id: "manage-lower", label: "Lower Bracket", shortLabel: "Lower", type: "action" as const }] : []),
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
        <div className={frameTitleClass}>Category</div>
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
        <div className={frameTitleClass}>Competition</div>
        <AdminRow stepId="groups" label="Groups">
          <span className="text-sm font-medium text-right">{(() => {
            const n = config.numGroups;
            const total = classPairs.length;
            // Group sizes
            const base = total > 0 ? Math.floor(total / n) : 0;
            const rem = total > 0 ? total % n : 0;
            const sizes = Array.from({ length: n }, (_, i) => base + (i < rem ? 1 : 0));
            const allSame = sizes.every((s) => s === sizes[0]);
            const sizeDesc = total === 0
              ? ""
              : allSame
                ? ` (${sizes[0]} teams)`
                : ` (${sizes.join("-")} teams)`;
            // Scoring
            const sf = cls.scoringFormat || "1x11";
            const sets = sf.startsWith("3") ? "best of 3" : "1 set";
            const isRally = sf.includes("R");
            const pts = sf.replace(/^[13]x/, "").replace("R", "");
            const scoring = `${sets} ${isRally ? "rally " : ""}to ${pts}`;
            const wb = cls.winBy || "2";
            const winBy = wb === "1" ? ", win by 1" : wb === "2" ? "" : `, cap ${wb.replace("cap", "")}`;
            const freq = config.matchesPerMatchup === 1 ? "1 match" : "2 matches";
            return `${n} Groups${sizeDesc}: ${freq} with ${scoring}${winBy}`;
          })()}</span>
        </AdminRow>
        {hasUpperBracket && (() => {
          const n = config.advanceToUpper;
          const teamDesc = n === 1 ? "Winner of each group" : `Top ${n} from each group`;
          const wcDesc = config.wildcardCount > 0 ? ` + ${config.wildcardCount} best runner-up${config.wildcardCount > 1 ? "s" : ""}` : "";
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
          if (config.upperThirdPlace) roundParts.push("3rd");
          return (
            <AdminRow stepId="advancement" label="Elimination">
              <span className="text-right">
                <span className="text-sm font-medium block">{teamDesc}{wcDesc} advance</span>
                <span className="text-xs text-muted block">{roundParts.join(", ")}</span>
              </span>
            </AdminRow>
          );
        })()}
        {!hasUpperBracket && (
          <AdminRow stepId="advancement" label="Elimination">
            <span className="text-sm font-medium text-muted">No bracket rounds</span>
          </AdminRow>
        )}
        {hasLowerBracket && (() => {
          const lower = config.advanceToLower;
          const upperN = config.advanceToUpper;
          const posStart = upperN + 1;
          const posEnd = upperN + lower;
          const teamDesc = lower === 1
            ? `#${posStart} in each group`
            : `#${posStart} and #${posEnd} in each group`;
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
          if (config.lowerThirdPlace) roundParts.push("3rd");
          return (
            <AdminRow stepId="lower-config" label="Consolation">
              <span className="text-right">
                <span className="text-sm font-medium block">{teamDesc} advance</span>
                <span className="text-xs text-muted block">{roundParts.join(", ")}</span>
              </span>
            </AdminRow>
          );
        })()}
      </div>

      {/* Players & Matches */}
      <div className={frameClass}>
        <div className={frameTitleClass}>Players & Matches</div>
        <button onClick={() => canManage ? setCurrentStepIdx(steps.findIndex((s) => s.id === "players")) : setShowPlayersExpand(!showPlayersExpand)} className={rowClass}>
          <span className="text-sm text-muted shrink-0">Players{cls.maxPlayers ? ` (max ${cls.maxPlayers})` : ""}</span>
          <span className="text-sm font-medium">
            {maleCount > 0 && <span className="text-blue-500">♂{maleCount}</span>}
            {maleCount > 0 && femaleCount > 0 && <span className="text-muted mx-1">·</span>}
            {femaleCount > 0 && <span className="text-pink-500">♀{femaleCount}</span>}
            {totalPlayers > 0 && <span className="text-muted ml-1">({classPairs.length} {cls.format === "doubles" ? "pairs" : "players"})</span>}
            {totalPlayers === 0 && <span className="text-muted">None yet</span>}
          </span>
        </button>
        {/* Expanded player view for non-admins */}
        {showPlayersExpand && !canManage && (
          <div className="border-t border-border">
            <ClassPlayersInline eventId={eventId} classId={cls.id} format={cls.format} pairs={classPairs as never} />
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
              <span className="text-sm text-muted">Elimination</span>
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
            <div className={rowStaticClass}>
              <span className="text-sm text-muted">Group Matches</span>
              <span className="text-sm font-medium">
                {groupMatches.length === 0 ? "Not started" : `${groupMatches.filter((m) => m.status === "completed").length}/${groupMatches.length} played`}
              </span>
            </div>
            <div className={rowStaticClass}>
              <span className="text-sm text-muted">Elimination</span>
              <span className="text-sm font-medium">
                {bracketMatches.filter((m) => m.bracketStage?.startsWith("upper_")).length === 0 ? "Not started" : `${bracketMatches.filter((m) => m.bracketStage?.startsWith("upper_") && m.status === "completed").length}/${bracketMatches.filter((m) => m.bracketStage?.startsWith("upper_")).length} played`}
              </span>
            </div>
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
      {/* Step bar — hidden on overview */}
      {!isOverview && (
        <div className="sticky z-30 bg-background pb-2 -mx-4 px-4 pt-2 shadow-sm" style={{ top: "var(--header-height, 0px)" }}>
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
        <div className="flex items-center justify-between">
          <button onClick={onBack} className="text-xs text-action font-medium shrink-0">← Classes</button>
          <h3 className="text-base font-bold text-center">{cls.name}</h3>
          <span className="w-16" />
        </div>
      ) : (
        <h3 className="text-base font-bold">{cls.name}</h3>
      )}

      {/* Step content or overview */}
      {isOverview ? renderOverview() : renderStep()}
    </div>
  );
}
