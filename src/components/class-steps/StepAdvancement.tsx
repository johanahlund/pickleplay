"use client";

import { CompetitionConfig } from "@/lib/competition/types";

interface StepAdvancementProps {
  config: CompetitionConfig;
  canManage: boolean;
  updateConfig: (partial: Partial<CompetitionConfig>) => void;
}

export function StepAdvancement({ config, canManage, updateConfig }: StepAdvancementProps) {
  const hasUpperBracket = config.advanceToUpper > 0;

  return (
    <div className="bg-card rounded-xl border border-border p-4 space-y-4">
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="block text-xs text-muted mb-1">Advance to upper bracket</label>
          <select
            disabled={!canManage}
            value={config.advanceToUpper}
            onChange={(e) => updateConfig({ advanceToUpper: parseInt(e.target.value) })}
            className="w-full border border-border rounded-lg px-3 py-2.5 text-sm font-medium"
          >
            <option value={0}>None (group only)</option>
            <option value={1}>1 per group</option>
            <option value={2}>2 per group</option>
            <option value={3}>3 per group</option>
          </select>
        </div>
        <div className="flex-1">
          <label className="block text-xs text-muted mb-1">Advance to lower bracket</label>
          <select
            disabled={!canManage}
            value={config.advanceToLower}
            onChange={(e) => updateConfig({ advanceToLower: parseInt(e.target.value) })}
            className="w-full border border-border rounded-lg px-3 py-2.5 text-sm font-medium"
          >
            <option value={0}>None</option>
            <option value={1}>1 per group</option>
            <option value={2}>2 per group</option>
          </select>
        </div>
      </div>

      {hasUpperBracket && (
        <>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-muted mb-1">Wildcards</label>
              <select
                disabled={!canManage}
                value={config.wildcardCount}
                onChange={(e) => updateConfig({ wildcardCount: parseInt(e.target.value) })}
                className="w-full border border-border rounded-lg px-3 py-2.5 text-sm font-medium"
              >
                <option value={0}>0</option>
                <option value={1}>1</option>
                <option value={2}>2</option>
              </select>
            </div>
            {config.wildcardCount > 0 && (
              <div className="flex-1">
                <label className="block text-xs text-muted mb-1">Wildcard criteria</label>
                <select
                  disabled={!canManage}
                  value={config.wildcardCriteria}
                  onChange={(e) => updateConfig({ wildcardCriteria: e.target.value as CompetitionConfig["wildcardCriteria"] })}
                  className="w-full border border-border rounded-lg px-3 py-2.5 text-sm font-medium"
                >
                  <option value="point_diff">Point diff</option>
                  <option value="wins">Wins</option>
                  <option value="total_points">Total points</option>
                </select>
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs text-muted mb-1">Bracket seeding</label>
            <select
              disabled={!canManage}
              value={config.bracketSeeding}
              onChange={(e) => updateConfig({ bracketSeeding: e.target.value as CompetitionConfig["bracketSeeding"] })}
              className="w-full border border-border rounded-lg px-3 py-2.5 text-sm font-medium"
            >
              <option value="cross_group">Cross-group</option>
              <option value="snake">Snake</option>
              <option value="random">Random</option>
            </select>
          </div>
        </>
      )}

      {!hasUpperBracket && (
        <p className="text-xs text-muted">Group stage only — no elimination bracket rounds.</p>
      )}
    </div>
  );
}
