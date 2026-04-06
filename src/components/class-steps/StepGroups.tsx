"use client";

import { CompetitionConfig } from "@/lib/competition/types";

interface StepGroupsProps {
  config: CompetitionConfig;
  canManage: boolean;
  updateConfig: (partial: Partial<CompetitionConfig>) => void;
}

export function StepGroups({ config, canManage, updateConfig }: StepGroupsProps) {
  const Toggle = ({ value, options, onChange }: {
    value: string | number;
    options: { value: string | number; label: string }[];
    onChange: (v: string | number) => void;
  }) => (
    <div className="flex gap-1.5">
      {options.map((o) => (
        <button key={String(o.value)} onClick={() => canManage && onChange(o.value)}
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
        <label className="block text-xs text-muted mb-1">Groups</label>
        <div className="flex items-center gap-0">
          <button onClick={() => canManage && updateConfig({ numGroups: Math.max(1, config.numGroups - 1) })}
            className="w-12 h-12 rounded-l-xl bg-gray-200 text-foreground font-bold text-2xl flex items-center justify-center active:bg-gray-300">−</button>
          <div className="w-12 h-12 bg-selected text-white font-bold text-2xl flex items-center justify-center">{config.numGroups}</div>
          <button onClick={() => canManage && updateConfig({ numGroups: Math.min(10, config.numGroups + 1) })}
            className="w-12 h-12 rounded-r-xl bg-gray-200 text-foreground font-bold text-2xl flex items-center justify-center active:bg-gray-300">+</button>
        </div>
      </div>

      <div>
        <label className="block text-xs text-muted mb-1">Matches per matchup in group</label>
        <Toggle value={config.matchesPerMatchup} options={[
          { value: 1, label: "Once" },
          { value: 2, label: "Twice" },
        ]} onChange={(v) => updateConfig({ matchesPerMatchup: v as number })} />
      </div>

      <div>
        <label className="block text-xs text-muted mb-1">Group seeding</label>
        <select
          disabled={!canManage}
          value={config.groupSeeding}
          onChange={(e) => updateConfig({ groupSeeding: e.target.value as CompetitionConfig["groupSeeding"] })}
          className="w-full border border-border rounded-lg px-3 py-2.5 text-sm font-medium"
        >
          <option value="rating">App Rating</option>
          <option value="dupr">DUPR Rating</option>
          <option value="skill_level">Skill Level</option>
          <option value="random">Random</option>
        </select>
      </div>
    </div>
  );
}
