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
  normal_9: "9", normal_11: "11", normal_15: "15",
  rally_15: "R15", rally_21: "R21", timed: "Time",
};

const PAIRING_OPTIONS = [
  { value: "random", icon: "🎲", label: "Random" },
  { value: "skill_balanced", icon: "📊", label: "Skill" },
  { value: "mixed_gender", icon: "👫", label: "Mixed" },
  { value: "skill_mixed_gender", icon: "📊👫", label: "Skill+Mix" },
  { value: "king_of_court", icon: "👑", label: "King" },
  { value: "swiss", icon: "🇨🇭", label: "Swiss" },
  { value: "manual", icon: "✏️", label: "Manual" },
];

export function ClassDetailView({
  eventId, cls, allClasses, pairs, matches, canManage, numCourts, onBack, onRefresh,
}: ClassDetailViewProps) {

  const updateField = async (field: string, value: unknown) => {
    await fetch(`/api/events/${eventId}/classes`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classId: cls.id, [field]: value }),
    });
    onRefresh();
  };

  const Toggle = ({ field, value, options }: { field: string; value: string | number; options: { value: string | number; label: string }[] }) => (
    <div className="flex gap-1.5">
      {options.map((o) => (
        <button key={String(o.value)} onClick={() => canManage && updateField(field, o.value)}
          className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${
            value === o.value ? "bg-selected text-white" : "bg-gray-100 text-foreground hover:bg-gray-200"
          } ${!canManage ? "cursor-default" : ""}`}>
          {o.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="text-xs text-action font-medium">← Classes</button>
        <h3 className="text-base font-bold">{cls.name}</h3>
        <span className="w-16" />
      </div>

      {/* Format */}
      <div className="bg-card rounded-xl border border-border p-4 space-y-3">
        <div>
          <label className="block text-xs text-muted mb-1">Format</label>
          <Toggle field="format" value={cls.format} options={[{ value: "doubles", label: "🤝 Doubles" }, { value: "singles", label: "👤 Singles" }]} />
        </div>
        <div>
          <label className="block text-xs text-muted mb-1">Gender</label>
          <Toggle field="gender" value={cls.gender} options={[{ value: "open", label: "Open" }, { value: "male", label: "Male" }, { value: "female", label: "Female" }, { value: "mix", label: "Mixed" }]} />
        </div>
        <div>
          <label className="block text-xs text-muted mb-1">Age Group</label>
          <Toggle field="ageGroup" value={cls.ageGroup} options={[{ value: "open", label: "Open" }, { value: "18+", label: "18+" }, { value: "50+", label: "50+" }, { value: "60+", label: "60+" }]} />
        </div>
      </div>

      {/* Scoring */}
      <div className="bg-card rounded-xl border border-border p-4 space-y-3">
        <div>
          <label className="block text-xs text-muted mb-1">Sets</label>
          <Toggle field="numSets" value={cls.numSets} options={[{ value: 1, label: "1 Set" }, { value: 3, label: "Best of 3" }]} />
        </div>
        <div>
          <label className="block text-xs text-muted mb-1">Scoring</label>
          <Toggle field="scoringType" value={cls.scoringType} options={Object.entries(SCORING_LABELS).map(([v, l]) => ({ value: v, label: l }))} />
        </div>
      </div>

      {/* Pairing */}
      <div className="bg-card rounded-xl border border-border p-4 space-y-3">
        <div>
          <label className="block text-xs text-muted mb-1">Pairing</label>
          <div className="flex gap-1.5">
            {PAIRING_OPTIONS.map((m) => (
              <button key={m.value} onClick={() => canManage && updateField("pairingMode", m.value)}
                className={`flex-1 py-2 rounded-lg text-center transition-all ${
                  cls.pairingMode === m.value ? "bg-selected text-white" : "bg-gray-100 hover:bg-gray-200"
                }`} title={m.label}>
                <span className="text-base">{m.icon}</span>
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-xs text-muted mb-1">Play Mode</label>
          <Toggle field="playMode" value={cls.playMode || "round_based"} options={[{ value: "round_based", label: "Round-based" }, { value: "continuous", label: "Continuous" }]} />
        </div>
        <div>
          <label className="block text-xs text-muted mb-1">Ranking</label>
          <Toggle field="rankingMode" value={cls.rankingMode} options={[{ value: "ranked", label: "Ranked" }, { value: "approval", label: "Approval" }, { value: "none", label: "Unranked" }]} />
        </div>
      </div>

      {/* Limits */}
      <div className="bg-card rounded-xl border border-border p-4 space-y-3">
        <h4 className="text-xs text-muted font-medium">Limits</h4>
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="block text-[10px] text-muted mb-1">Min {cls.format === "doubles" ? "teams" : "players"}</label>
            <input type="number" value={cls.minPlayers || ""} placeholder="No min" min="1"
              onChange={(e) => canManage && updateField("minPlayers", e.target.value ? parseInt(e.target.value) : null)}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="flex-1">
            <label className="block text-[10px] text-muted mb-1">Max {cls.format === "doubles" ? "teams" : "players"}</label>
            <input type="number" value={cls.maxPlayers || ""} placeholder="No max" min="1"
              onChange={(e) => canManage && updateField("maxPlayers", e.target.value ? parseInt(e.target.value) : null)}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm" />
          </div>
        </div>
        <div>
          <label className="block text-[10px] text-muted mb-1">If below minimum</label>
          <Toggle field="belowMinAction" value={cls.belowMinAction || "tbd"} options={[
            { value: "tbd", label: "To be decided" },
            { value: "cancel", label: "Cancel" },
            { value: "merge", label: "Merge" },
          ]} />
        </div>
      </div>

      {/* Cross-class merge */}
      {cls.competitionMode && allClasses.length > 1 && canManage && (
        <div className="bg-card rounded-xl border border-border p-4 space-y-2">
          <h4 className="text-xs text-muted font-medium">Bracket Merge</h4>
          <div>
            <label className="block text-[10px] text-muted mb-1">Upper bracket → merge with:</label>
            <select value={cls.upperBracketMergeClassId || ""}
              onChange={(e) => updateField("upperBracketMergeClassId", e.target.value || null)}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm">
              <option value="">None</option>
              {allClasses.filter((c) => c.id !== cls.id).map((c) => (
                <option key={c.id} value={c.id}>{c.name} (lower bracket)</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] text-muted mb-1">Lower bracket → merge with:</label>
            <select value={cls.lowerBracketMergeClassId || ""}
              onChange={(e) => updateField("lowerBracketMergeClassId", e.target.value || null)}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm">
              <option value="">None</option>
              {allClasses.filter((c) => c.id !== cls.id).map((c) => (
                <option key={c.id} value={c.id}>{c.name} (upper bracket)</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Players */}
      <ClassPlayers eventId={eventId} classId={cls.id} format={cls.format} canManage={canManage} onRefresh={onRefresh} />

      {/* Competition (groups, brackets) */}
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

      {/* Copy from another class */}
      {canManage && allClasses.length > 1 && (
        <div className="bg-card rounded-xl border border-border p-3">
          <label className="block text-xs text-muted mb-1">Copy all settings from</label>
          <div className="flex gap-1.5">
            {allClasses.filter((c) => c.id !== cls.id).map((source) => (
              <button key={source.id} onClick={async () => {
                if (confirm(`Copy all settings from "${source.name}"?`)) {
                  await fetch(`/api/events/${eventId}/classes`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ classId: cls.id, copyFromId: source.id }),
                  });
                  onRefresh();
                }
              }}
                className="flex-1 py-2 rounded-lg text-xs font-medium bg-action/5 text-action border border-action/20 hover:bg-action/10">
                {source.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
