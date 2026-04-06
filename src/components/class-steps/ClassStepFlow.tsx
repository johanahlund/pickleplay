"use client";

import { useState, useEffect, useCallback } from "react";
import {
  CompetitionConfig,
  DEFAULT_COMPETITION_CONFIG,
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
  numSets: number;
  scoringType: string;
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
  eventId, cls, allClasses, pairs, matches, canManage, numCourts, onBack, onRefresh,
}: ClassStepFlowProps) {
  const config: CompetitionConfig = cls.competitionConfig
    ? { ...DEFAULT_COMPETITION_CONFIG, ...(cls.competitionConfig as unknown as Partial<CompetitionConfig>) }
    : DEFAULT_COMPETITION_CONFIG;

  const hasLowerBracket = config.advanceToLower > 0;

  // Build dynamic step list
  const steps: StepDef[] = [
    { id: "category", label: "Category", shortLabel: "Cat", type: "config" },
    { id: "groups", label: "Groups", shortLabel: "Grps", type: "config" },
    { id: "advancement", label: "Advancement", shortLabel: "Adv", type: "config" },
    { id: "upper-config", label: "Upper Bracket", shortLabel: "Upper", type: "config" },
    ...(hasLowerBracket ? [{ id: "lower-config", label: "Lower Bracket", shortLabel: "Lower", type: "config" as const }] : []),
    { id: "players", label: "Players", shortLabel: "Players", type: "config" },
    { id: "draw-groups", label: "Draw Groups", shortLabel: "Draw", type: "action" },
    { id: "manage-upper", label: "Upper Bracket", shortLabel: "Upper", type: "action" },
    ...(hasLowerBracket ? [{ id: "manage-lower", label: "Lower Bracket", shortLabel: "Lower", type: "action" as const }] : []),
  ];

  const [currentStepIdx, setCurrentStepIdx] = useState(0);
  const currentStep = steps[currentStepIdx] || steps[0];

  // Auto-enable competition mode if not set
  useEffect(() => {
    if (!cls.competitionMode && canManage) {
      fetch(`/api/events/${eventId}/competition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "enable", classId: cls.id }),
      }).then(() => onRefresh());
    }
  }, [cls.competitionMode, cls.id, eventId, canManage, onRefresh]);

  // Filter pairs and matches to this class
  const classPairs = pairs.filter((p) => !p.classId || p.classId === cls.id);
  const classMatches = matches.filter((m) => !m.classId || m.classId === cls.id);

  const updateField = useCallback(async (field: string, value: unknown) => {
    await fetch(`/api/events/${eventId}/classes`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classId: cls.id, [field]: value }),
    });
    onRefresh();
  }, [eventId, cls.id, onRefresh]);

  const updateConfig = useCallback(async (partial: Partial<CompetitionConfig>) => {
    await fetch(`/api/events/${eventId}/competition`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update_config", config: partial, classId: cls.id }),
    });
    onRefresh();
  }, [eventId, cls.id, onRefresh]);

  const renderStep = () => {
    switch (currentStep.id) {
      case "category":
        return <StepCategory cls={cls} canManage={canManage} updateField={updateField} />;
      case "groups":
        return <StepGroups config={config} canManage={canManage} updateConfig={updateConfig} />;
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
            allClasses={allClasses.map((c) => ({ id: c.id, name: c.name }))}
            canManage={canManage}
            updateField={updateField}
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

  return (
    <div className="space-y-3">
      {/* Step bar */}
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
          <button onClick={onBack} className="text-xs text-action font-medium shrink-0">← Classes</button>
          <span className="text-sm font-bold text-foreground truncate px-2">{cls.name} — {currentStep.label}</span>
          <div className="flex gap-1 shrink-0">
            {currentStepIdx > 0 && (
              <button onClick={() => setCurrentStepIdx(currentStepIdx - 1)}
                className="text-xs text-muted px-2 py-1 rounded hover:bg-gray-100">‹ Prev</button>
            )}
            {currentStepIdx < steps.length - 1 && (
              <button onClick={() => setCurrentStepIdx(currentStepIdx + 1)}
                className="text-xs text-action font-medium px-2 py-1 rounded hover:bg-action/5">Next ›</button>
            )}
          </div>
        </div>
      </div>

      {/* Step content */}
      {renderStep()}
    </div>
  );
}
