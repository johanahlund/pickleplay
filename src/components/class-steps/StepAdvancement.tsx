"use client";

import { CompetitionConfig } from "@/lib/competition/types";

interface StepAdvancementProps {
  config: CompetitionConfig;
  canManage: boolean;
  updateConfig: (partial: Partial<CompetitionConfig>) => void;
}

export function StepAdvancement({ config, canManage, updateConfig }: StepAdvancementProps) {
  const Toggle = ({ value, options, onChange }: {
    value: string | number;
    options: { value: string | number; label: string }[];
    onChange: (v: string | number) => void;
  }) => (
    <div className="flex gap-1">
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
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="block text-xs text-muted mb-1">Advance to upper bracket</label>
          <Toggle value={config.advanceToUpper} options={[
            { value: 1, label: "1" },
            { value: 2, label: "2" },
            { value: 3, label: "3" },
          ]} onChange={(v) => updateConfig({ advanceToUpper: v as number })} />
        </div>
        <div className="flex-1">
          <label className="block text-xs text-muted mb-1">Advance to lower bracket</label>
          <Toggle value={config.advanceToLower} options={[
            { value: 0, label: "None" },
            { value: 1, label: "1" },
            { value: 2, label: "2" },
          ]} onChange={(v) => updateConfig({ advanceToLower: v as number })} />
        </div>
      </div>

      <div className="flex gap-3">
        <div className="flex-1">
          <label className="block text-xs text-muted mb-1">Wildcards</label>
          <Toggle value={config.wildcardCount} options={[
            { value: 0, label: "0" },
            { value: 1, label: "1" },
            { value: 2, label: "2" },
          ]} onChange={(v) => updateConfig({ wildcardCount: v as number })} />
        </div>
        {config.wildcardCount > 0 && (
          <div className="flex-1">
            <label className="block text-xs text-muted mb-1">Wildcard criteria</label>
            <Toggle value={config.wildcardCriteria} options={[
              { value: "point_diff", label: "Pt diff" },
              { value: "wins", label: "Wins" },
              { value: "total_points", label: "Total pts" },
            ]} onChange={(v) => updateConfig({ wildcardCriteria: v as CompetitionConfig["wildcardCriteria"] })} />
          </div>
        )}
      </div>

      <div>
        <label className="block text-xs text-muted mb-1">Bracket seeding</label>
        <Toggle value={config.bracketSeeding} options={[
          { value: "cross_group", label: "Cross-group" },
          { value: "snake", label: "Snake" },
          { value: "random", label: "Random" },
        ]} onChange={(v) => updateConfig({ bracketSeeding: v as CompetitionConfig["bracketSeeding"] })} />
      </div>
    </div>
  );
}
