"use client";

import { useState } from "react";

interface StepCategoryProps {
  cls: {
    format: string;
    gender: string;
    ageGroup: string;
    skillMin?: number | null;
    skillMax?: number | null;
    competitionPhase?: string | null;
  };
  canManage: boolean;
  updateField: (field: string, value: unknown) => void;
}

const LEVEL_OPTIONS = [
  { label: "Open", min: null, max: null },
  { label: "2.5-3.5", min: 2.5, max: 3.5 },
  { label: "3.0-4.0", min: 3.0, max: 4.0 },
  { label: "3.5-4.5", min: 3.5, max: 4.5 },
  { label: "3.5+", min: 3.5, max: null },
  { label: "4.0+", min: 4.0, max: null },
  { label: "4.5+", min: 4.5, max: null },
];

function getLevelLabel(skillMin: number | null | undefined, skillMax: number | null | undefined): string {
  const sMin = skillMin ?? null;
  const sMax = skillMax ?? null;
  const match = LEVEL_OPTIONS.find((p) => p.min === sMin && p.max === sMax);
  if (match) return match.label;
  if (sMin && sMax) return `${sMin}-${sMax}`;
  if (sMin) return `${sMin}+`;
  if (sMax) return `Up to ${sMax}`;
  return "Open";
}

const PHASE_LABELS: Record<string, { label: string; color: string }> = {
  groups: { label: "Group Stage", color: "bg-blue-100 text-blue-700" },
  bracket_upper: { label: "Upper Bracket", color: "bg-green-100 text-green-700" },
  bracket_lower: { label: "Lower Bracket", color: "bg-amber-100 text-amber-700" },
  completed: { label: "Completed", color: "bg-gray-100 text-gray-600" },
};

export function StepCategory({ cls, canManage, updateField }: StepCategoryProps) {
  const currentLevel = getLevelLabel(cls.skillMin, cls.skillMax);
  const isCustom = !LEVEL_OPTIONS.some((p) => p.label === currentLevel);
  const [showCustom, setShowCustom] = useState(isCustom);

  const Toggle = ({ field, value, options }: { field: string; value: string; options: { value: string; label: string }[] }) => (
    <div className="flex gap-1.5">
      {options.map((o) => (
        <button key={o.value} onClick={() => canManage && updateField(field, o.value)}
          className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${
            value === o.value ? "bg-selected text-white" : "bg-gray-100 text-foreground hover:bg-gray-200"
          } ${!canManage ? "cursor-default" : ""}`}>
          {o.label}
        </button>
      ))}
    </div>
  );

  const phase = cls.competitionPhase || "setup";
  const phaseInfo = PHASE_LABELS[phase] || { label: "Setup", color: "bg-gray-100 text-gray-600" };

  return (
    <div className="bg-card rounded-xl border border-border p-4 space-y-4">
      {/* Status */}
      <div className="flex items-center justify-between">
        <label className="text-xs text-muted">Status</label>
        <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${phaseInfo.color}`}>{phaseInfo.label}</span>
      </div>

      <div>
        <label className="block text-xs text-muted mb-1">Format</label>
        <Toggle field="format" value={cls.format} options={[
          { value: "doubles", label: "Doubles" },
          { value: "singles", label: "Singles" },
        ]} />
      </div>
      <div>
        <label className="block text-xs text-muted mb-1">Gender</label>
        <Toggle field="gender" value={cls.gender} options={[
          { value: "open", label: "Open" },
          { value: "male", label: "Male" },
          { value: "female", label: "Female" },
          { value: "mix", label: "Mixed" },
        ]} />
      </div>
      <div>
        <label className="block text-xs text-muted mb-1">Age Group</label>
        <select
          disabled={!canManage}
          value={cls.ageGroup}
          onChange={(e) => updateField("ageGroup", e.target.value)}
          className="w-full border border-border rounded-lg px-3 py-2.5 text-sm font-medium"
        >
          <option value="open">Open</option>
          <option value="18+">18+</option>
          <option value="35+">35+</option>
          <option value="50+">50+</option>
          <option value="55+">55+</option>
          <option value="60+">60+</option>
          <option value="65+">65+</option>
          <option value="70+">70+</option>
        </select>
      </div>
      <div>
        <label className="block text-xs text-muted mb-1">Level (DUPR)</label>
        <select
          disabled={!canManage}
          value={showCustom ? "__custom__" : currentLevel}
          onChange={(e) => {
            if (e.target.value === "__custom__") {
              setShowCustom(true);
              return;
            }
            setShowCustom(false);
            const preset = LEVEL_OPTIONS.find((p) => p.label === e.target.value);
            if (preset) {
              updateField("skillMin", preset.min);
              updateField("skillMax", preset.max);
            }
          }}
          className="w-full border border-border rounded-lg px-3 py-2.5 text-sm font-medium"
        >
          {LEVEL_OPTIONS.map((p) => (
            <option key={p.label} value={p.label}>{p.label}</option>
          ))}
          <option value="__custom__">Custom range...</option>
        </select>
        {showCustom && (
          <div className="flex gap-3 mt-2">
            <div className="flex-1">
              <label className="block text-[10px] text-muted mb-1">Min DUPR</label>
              <input type="number" step="0.5" min="1" max="8" value={cls.skillMin ?? ""}
                placeholder="No min"
                onChange={(e) => canManage && updateField("skillMin", e.target.value ? parseFloat(e.target.value) : null)}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm" />
            </div>
            <div className="flex-1">
              <label className="block text-[10px] text-muted mb-1">Max DUPR</label>
              <input type="number" step="0.5" min="1" max="8" value={cls.skillMax ?? ""}
                placeholder="No max"
                onChange={(e) => canManage && updateField("skillMax", e.target.value ? parseFloat(e.target.value) : null)}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
