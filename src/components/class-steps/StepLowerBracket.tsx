"use client";

import {
  CompetitionConfig,
  MATCH_FORMATS,
  getBracketStages,
  BRACKET_STAGE_LABELS,
} from "@/lib/competition/types";

interface StepLowerBracketProps {
  config: CompetitionConfig;
  canManage: boolean;
  updateConfig: (partial: Partial<CompetitionConfig>) => void;
}

export function StepLowerBracket({ config, canManage, updateConfig }: StepLowerBracketProps) {
  const numLower = config.numGroups * config.advanceToLower;
  const stages = getBracketStages(numLower);

  if (stages.length === 0) {
    return (
      <div className="bg-card rounded-xl border border-border p-4">
        <p className="text-sm text-muted text-center">No lower bracket stages. Adjust lower bracket advancement.</p>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-xl border border-border p-4 space-y-4">
      <div>
        <label className="block text-xs text-muted mb-1">Lower bracket match format</label>
        <p className="text-[10px] text-muted mb-2">{numLower} teams in lower bracket</p>
        <div className="space-y-1.5">
          {stages.map((stage) => (
            <div key={stage} className="flex items-center gap-2">
              <span className="text-xs text-muted w-20 shrink-0">{BRACKET_STAGE_LABELS[stage] || stage}</span>
              <select
                disabled={!canManage}
                value={config.lowerBracketFormats[stage] || "to_11"}
                onChange={(e) => {
                  const newFormats = { ...config.lowerBracketFormats };
                  newFormats[stage] = e.target.value;
                  const stageIdx = stages.indexOf(stage);
                  for (let i = stageIdx + 1; i < stages.length; i++) {
                    if (!config.lowerBracketFormats[stages[i]]) {
                      newFormats[stages[i]] = e.target.value;
                    }
                  }
                  updateConfig({ lowerBracketFormats: newFormats });
                }}
                className="flex-1 text-xs border border-border rounded-lg px-2 py-1.5"
              >
                {MATCH_FORMATS.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={config.lowerThirdPlace}
          disabled={!canManage}
          onChange={(e) => updateConfig({ lowerThirdPlace: e.target.checked })}
          className="rounded border-border" />
        3rd place match (lower bracket)
      </label>
    </div>
  );
}
