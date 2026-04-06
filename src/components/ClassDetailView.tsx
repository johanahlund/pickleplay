"use client";

import { useState } from "react";
import { CompetitionView } from "./CompetitionView";
import { ClassPlayers } from "./ClassPlayers";

interface EventClassData {
  id: string;
  name: string;
  isDefault: boolean;
  format: string;
  gender: string;
  ageGroup: string;
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

interface ClassDetailViewProps {
  eventId: string;
  cls: EventClassData;
  allClasses: EventClassData[];
  pairs: unknown[];
  matches: unknown[];
  canManage: boolean;
  numCourts: number;
  onBack: () => void;
  onRefresh: () => void;
}

const SCORING_LABELS: Record<string, string> = {
  normal_9: "To 9", normal_11: "To 11", normal_15: "To 15",
  rally_15: "Rally 15", rally_21: "Rally 21", timed: "Timed",
};

const PAIRING_LABELS: Record<string, string> = {
  random: "Random", skill_balanced: "Skill Balanced",
  mixed_gender: "Mixed Gender", skill_mixed_gender: "Skill + Mixed",
  king_of_court: "King of Court", swiss: "Swiss", manual: "Manual",
};

export function ClassDetailView({
  eventId, cls, allClasses, pairs, matches, canManage, numCourts, onBack, onRefresh,
}: ClassDetailViewProps) {
  const [editing, setEditing] = useState(false);
  const [editMin, setEditMin] = useState(String(cls.minPlayers || ""));
  const [editMax, setEditMax] = useState(String(cls.maxPlayers || ""));
  const [editBelowMin, setEditBelowMin] = useState(cls.belowMinAction || "tbd");
  const [editMergeWith, setEditMergeWith] = useState(cls.mergeWithClassId || "");

  const scoringDisplay = `${cls.numSets === 1 ? "1 set" : "Best of 3"} ${(SCORING_LABELS[cls.scoringType] || cls.scoringType).toLowerCase()}`;

  const saveClassSettings = async () => {
    await fetch(`/api/events/${eventId}/classes`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        classId: cls.id,
        copyFromId: undefined, // not copying, just updating
      }),
    });
    // TODO: add direct class field updates
    setEditing(false);
    onRefresh();
  };

  const rowClass = "flex justify-between items-center py-2 px-3 border-b border-border last:border-b-0";

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="text-xs text-action font-medium">← Classes</button>
        <h3 className="text-base font-bold">{cls.name}</h3>
        <span className="w-16" />
      </div>

      {/* Class info */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className={rowClass}>
          <span className="text-sm text-muted">Format</span>
          <span className="text-sm font-medium capitalize">{cls.format}</span>
        </div>
        <div className={rowClass}>
          <span className="text-sm text-muted">Gender</span>
          <span className="text-sm font-medium capitalize">{cls.gender}</span>
        </div>
        <div className={rowClass}>
          <span className="text-sm text-muted">Age Group</span>
          <span className="text-sm font-medium">{cls.ageGroup}</span>
        </div>
        <div className={rowClass}>
          <span className="text-sm text-muted">Scoring</span>
          <span className="text-sm font-medium">{scoringDisplay}</span>
        </div>
        <div className={rowClass}>
          <span className="text-sm text-muted">Pairing</span>
          <span className="text-sm font-medium">{PAIRING_LABELS[cls.pairingMode] || cls.pairingMode}</span>
        </div>
        <div className={rowClass}>
          <span className="text-sm text-muted">Play Mode</span>
          <span className="text-sm font-medium capitalize">{(cls.playMode || "round_based").replace("_", " ")}</span>
        </div>
        <div className={rowClass}>
          <span className="text-sm text-muted">Ranking</span>
          <span className="text-sm font-medium capitalize">{cls.rankingMode}</span>
        </div>
      </div>

      {/* Limits */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className={rowClass}>
          <span className="text-sm text-muted">Min {cls.format === "doubles" ? "teams" : "players"}</span>
          <span className="text-sm font-medium">{cls.minPlayers || "No min"}</span>
        </div>
        <div className={rowClass}>
          <span className="text-sm text-muted">Max {cls.format === "doubles" ? "teams" : "players"}</span>
          <span className="text-sm font-medium">{cls.maxPlayers || "No max"}</span>
        </div>
        <div className={rowClass}>
          <span className="text-sm text-muted">If below min</span>
          <span className="text-sm font-medium">
            {cls.belowMinAction === "cancel" ? "Cancel class" :
             cls.belowMinAction === "merge" ? `Merge with ${allClasses.find((c) => c.id === cls.mergeWithClassId)?.name || "..."}` :
             "To be decided"}
          </span>
        </div>
      </div>

      {/* Cross-class bracket merge */}
      {cls.competitionMode && allClasses.length > 1 && (
        <div className="bg-card rounded-xl border border-border p-4 space-y-2">
          <h4 className="text-sm font-semibold">Bracket Merge</h4>
          <p className="text-[10px] text-muted">Link this class's elimination brackets with another class.</p>
          <div>
            <label className="block text-[10px] text-muted mb-1">Upper bracket → merge with lower bracket of:</label>
            <select value={cls.upperBracketMergeClassId || ""}
              onChange={async (e) => {
                await fetch(`/api/events/${eventId}/classes`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ classId: cls.id, copyFromId: undefined }),
                });
                onRefresh();
              }}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm">
              <option value="">None</option>
              {allClasses.filter((c) => c.id !== cls.id).map((c) => (
                <option key={c.id} value={c.id}>{c.name} (lower bracket)</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] text-muted mb-1">Lower bracket → merge with upper bracket of:</label>
            <select value={cls.lowerBracketMergeClassId || ""}
              onChange={async (e) => {
                onRefresh();
              }}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm">
              <option value="">None</option>
              {allClasses.filter((c) => c.id !== cls.id).map((c) => (
                <option key={c.id} value={c.id}>{c.name} (upper bracket)</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Players in this class */}
      <ClassPlayers eventId={eventId} classId={cls.id} format={cls.format} canManage={canManage} onRefresh={onRefresh} />

      {/* Competition settings for this class */}
      {cls.competitionMode && (
        <CompetitionView
          eventId={eventId}
          pairs={pairs as never}
          matches={matches as never}
          competitionMode={cls.competitionMode}
          competitionConfig={cls.competitionConfig as never}
          competitionPhase={cls.competitionPhase ?? null}
          canManage={canManage}
          numCourts={numCourts}
          onRefresh={onRefresh}
        />
      )}

      {/* Copy settings from another class */}
      {canManage && allClasses.length > 1 && (
        <div className="bg-card rounded-xl border border-border p-3">
          <label className="block text-xs text-muted mb-1">Copy all settings from another class</label>
          <div className="flex gap-1.5">
            {allClasses.filter((c) => c.id !== cls.id).map((source) => (
              <button key={source.id} onClick={async () => {
                if (confirm(`Copy all competition settings from "${source.name}" to "${cls.name}"?`)) {
                  await fetch(`/api/events/${eventId}/classes`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ classId: cls.id, copyFromId: source.id }),
                  });
                  onRefresh();
                }
              }}
                className="flex-1 py-2 rounded-lg text-xs font-medium bg-action/5 text-action border border-action/20 hover:bg-action/10 transition-colors">
                {source.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
