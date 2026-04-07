"use client";

import { useState, useEffect, useCallback } from "react";
import {
  CompetitionConfig,
  DEFAULT_COMPETITION_CONFIG,
  getBracketStages,
  BRACKET_STAGE_SHORT,
  BRACKET_STAGE_LABELS,
} from "@/lib/competition/types";
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
  const frameClass = "bg-card rounded-xl border border-border overflow-hidden";
  const frameTitleClass = "text-[10px] text-muted px-3 pt-2 pb-1 uppercase tracking-wider font-medium";

  const groupMatches = classMatches.filter((m) => m.groupLabel);
  const bracketMatches = classMatches.filter((m) => m.bracketStage);

  const renderOverview = () => (
    <div className="space-y-3">
      {/* Category summary */}
      <div className={frameClass}>
        <div className={frameTitleClass}>Category</div>
        <button onClick={() => setCurrentStepIdx(steps.findIndex((s) => s.id === "category"))} className={rowClass}>
          <span className="text-sm text-muted">Status</span>
          <span className="text-sm font-medium">{PHASE_LABELS[cls.competitionPhase || "open"] || "Setup"}</span>
        </button>
        <button onClick={() => setCurrentStepIdx(steps.findIndex((s) => s.id === "category"))} className={rowClass}>
          <span className="text-sm text-muted">Format</span>
          <span className="text-sm font-medium capitalize">
            {[
              cls.ageGroup !== "open" ? cls.ageGroup : null,
              cls.skillMin ? cls.skillMin.toFixed(1) : null,
              cls.gender === "open" ? "Any Gender" : cls.gender,
              cls.format,
            ].filter(Boolean).join(" · ")}
          </span>
        </button>
      </div>

      {/* Groups & Advancement */}
      <div className={frameClass}>
        <div className={frameTitleClass}>Competition</div>
        <button onClick={() => setCurrentStepIdx(steps.findIndex((s) => s.id === "groups"))} className={rowClass}>
          <span className="text-sm text-muted">Groups</span>
          <span className="text-sm font-medium text-right">{(() => {
            const sf = cls.scoringFormat || "1x11";
            const sets = sf.startsWith("3") ? "best of 3" : "1 set";
            const isRally = sf.includes("R");
            const pts = sf.replace(/^[13]x/, "").replace("R", "");
            const scoring = `${sets} ${isRally ? "rally " : ""}to ${pts}`;
            const wb = cls.winBy || "2";
            const winBy = wb === "1" ? ", win by 1" : wb === "2" ? "" : `, cap ${wb.replace("cap", "")}`;
            const freq = config.matchesPerMatchup === 1 ? "once" : "twice";
            return `${config.numGroups} groups, play each other ${freq}, ${scoring}${winBy}`;
          })()}</span>
        </button>
        {hasUpperBracket && (() => {
          const n = config.advanceToUpper;
          const teamDesc = n === 1 ? "The winner of each group" : `Top ${n} from each group`;
          const wcDesc = config.wildcardCount > 0 ? ` + ${config.wildcardCount} best runner-up${config.wildcardCount > 1 ? "s" : ""}` : "";
          const upperTeams = config.numGroups * n + config.wildcardCount;
          const stages = getBracketStages(upperTeams);
          const formatDesc = (formats: Record<string, string>) => {
            const parts = stages.map((s) => {
              const fmt = formats[s];
              const label = BRACKET_STAGE_LABELS[s] || s;
              if (!fmt || fmt === "to_11") return `${label}: to 11`;
              if (fmt === "to_15") return `${label}: to 15`;
              if (fmt === "to_21") return `${label}: to 21`;
              if (fmt === "bo3_11") return `${label}: Bo3 to 11`;
              if (fmt === "bo3_15") return `${label}: Bo3 to 15`;
              if (fmt === "bo3_21") return `${label}: Bo3 to 21`;
              return `${label}: ${fmt}`;
            });
            if (config.upperThirdPlace) parts.push("3rd place match");
            return parts.join(". ");
          };
          return (
            <button onClick={() => setCurrentStepIdx(steps.findIndex((s) => s.id === "advancement"))} className={rowClass}>
              <span className="text-sm text-muted shrink-0">Elimination</span>
              <span className="text-sm font-medium text-right">{teamDesc}{wcDesc} advance. {formatDesc(config.upperBracketFormats)}</span>
            </button>
          );
        })()}
        {!hasUpperBracket && (
          <button onClick={() => setCurrentStepIdx(steps.findIndex((s) => s.id === "advancement"))} className={rowClass}>
            <span className="text-sm text-muted">Elimination</span>
            <span className="text-sm font-medium text-muted">No bracket rounds</span>
          </button>
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
          const formatDesc = (formats: Record<string, string>) => {
            const parts = stages.map((s) => {
              const fmt = formats[s];
              const label = BRACKET_STAGE_LABELS[s] || s;
              if (!fmt || fmt === "to_11") return `${label}: to 11`;
              if (fmt === "to_15") return `${label}: to 15`;
              if (fmt === "to_21") return `${label}: to 21`;
              if (fmt === "bo3_11") return `${label}: Bo3 to 11`;
              if (fmt === "bo3_15") return `${label}: Bo3 to 15`;
              if (fmt === "bo3_21") return `${label}: Bo3 to 21`;
              return `${label}: ${fmt}`;
            });
            if (config.lowerThirdPlace) parts.push("3rd place match");
            return parts.join(". ");
          };
          return (
            <button onClick={() => setCurrentStepIdx(steps.findIndex((s) => s.id === "lower-config"))} className={rowClass}>
              <span className="text-sm text-muted shrink-0">Consolation</span>
              <span className="text-sm font-medium text-right">{teamDesc} advance. {formatDesc(config.lowerBracketFormats)}</span>
            </button>
          );
        })()}
      </div>

      {/* Players & Matches */}
      <div className={frameClass}>
        <div className={frameTitleClass}>Players & Matches</div>
        <button onClick={() => setCurrentStepIdx(steps.findIndex((s) => s.id === "players"))} className={rowClass}>
          <span className="text-sm text-muted">Players</span>
          <span className="text-sm font-medium">
            {classPairs.length} pair{classPairs.length !== 1 ? "s" : ""}
            {(cls.minPlayers || cls.maxPlayers) ? ` · ${cls.minPlayers || "?"}–${cls.maxPlayers || "∞"}` : ""}
          </span>
        </button>
        <button onClick={() => setCurrentStepIdx(steps.findIndex((s) => s.id === "draw-groups"))} className={rowClass}>
          <span className="text-sm text-muted">Group Matches</span>
          <span className="text-sm font-medium">
            {groupMatches.length === 0 ? "Not started" : `${groupMatches.filter((m) => m.status === "completed").length}/${groupMatches.length} played`}
          </span>
        </button>
        <button onClick={() => setCurrentStepIdx(steps.findIndex((s) => s.id === "manage-upper"))} className={rowClass}>
          <span className="text-sm text-muted">Upper Bracket</span>
          <span className="text-sm font-medium">
            {bracketMatches.filter((m) => m.bracketStage?.startsWith("upper_")).length === 0 ? "Not started" : `${bracketMatches.filter((m) => m.bracketStage?.startsWith("upper_") && m.status === "completed").length}/${bracketMatches.filter((m) => m.bracketStage?.startsWith("upper_")).length} played`}
          </span>
        </button>
        {hasLowerBracket && (
          <button onClick={() => setCurrentStepIdx(steps.findIndex((s) => s.id === "manage-lower"))} className={rowClass}>
            <span className="text-sm text-muted">Lower Bracket</span>
            <span className="text-sm font-medium">
              {bracketMatches.filter((m) => m.bracketStage?.startsWith("lower_")).length === 0 ? "Not started" : `${bracketMatches.filter((m) => m.bracketStage?.startsWith("lower_") && m.status === "completed").length}/${bracketMatches.filter((m) => m.bracketStage?.startsWith("lower_")).length} played`}
            </span>
          </button>
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
