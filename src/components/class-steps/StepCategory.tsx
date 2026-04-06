"use client";

import { useState } from "react";

interface StepCategoryProps {
  cls: {
    format: string;
    gender: string;
    ageGroup: string;
    skillMin?: number | null;
    skillMax?: number | null;
  };
  canManage: boolean;
  updateField: (field: string, value: unknown) => void;
}

const LEVEL_PRESETS = [
  { label: "Open", min: null, max: null },
  { label: "2.5-3.5", min: 2.5, max: 3.5 },
  { label: "3.0-4.0", min: 3.0, max: 4.0 },
  { label: "3.5-4.5", min: 3.5, max: 4.5 },
  { label: "3.5+", min: 3.5, max: null },
  { label: "4.0+", min: 4.0, max: null },
  { label: "4.5+", min: 4.5, max: null },
];

function matchesPreset(
  skillMin: number | null | undefined,
  skillMax: number | null | undefined,
  preset: { min: number | null; max: number | null }
): boolean {
  const sMin = skillMin ?? null;
  const sMax = skillMax ?? null;
  return sMin === preset.min && sMax === preset.max;
}

export function StepCategory({ cls, canManage, updateField }: StepCategoryProps) {
  const isCustomLevel = !LEVEL_PRESETS.some((p) => matchesPreset(cls.skillMin, cls.skillMax, p));
  const [showCustom, setShowCustom] = useState(isCustomLevel);

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

  return (
    <div className="bg-card rounded-xl border border-border p-4 space-y-4">
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
        <Toggle field="ageGroup" value={cls.ageGroup} options={[
          { value: "open", label: "Open" },
          { value: "18+", label: "18+" },
          { value: "50+", label: "50+" },
          { value: "60+", label: "60+" },
        ]} />
      </div>
      <div>
        <label className="block text-xs text-muted mb-1">Level (DUPR)</label>
        <div className="flex gap-1.5 flex-wrap">
          {LEVEL_PRESETS.map((p) => {
            const active = matchesPreset(cls.skillMin, cls.skillMax, p);
            return (
              <button key={p.label} onClick={() => {
                if (!canManage) return;
                updateField("skillMin", p.min);
                updateField("skillMax", p.max);
                setShowCustom(false);
              }}
                className={`py-2 px-3 rounded-lg text-xs font-medium transition-all ${
                  active && !showCustom ? "bg-selected text-white" : "bg-gray-100 text-foreground hover:bg-gray-200"
                } ${!canManage ? "cursor-default" : ""}`}>
                {p.label}
              </button>
            );
          })}
          <button onClick={() => { if (canManage) setShowCustom(true); }}
            className={`py-2 px-3 rounded-lg text-xs font-medium transition-all ${
              showCustom ? "bg-selected text-white" : "bg-gray-100 text-foreground hover:bg-gray-200"
            } ${!canManage ? "cursor-default" : ""}`}>
            Custom
          </button>
        </div>
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
